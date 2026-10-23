// Agent runtimes: find what is installed, run one turn, normalise the output into a few events.
// Every adapter keeps the runtime's own session, so the next turn continues the same conversation.
import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { accessSync, closeSync, constants, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { basename, delimiter, dirname, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { rpcTurn } from './agent-rpc.js';

// What the scanner looks for, on any server: commands on PATH, then any running systemd service
// (system or user) whose program belongs to the runtime's npm package — recognised by package
// name, not by path or unit name — then the usual global npm folders.
// `adapter: false` means we can see it but cannot drive it yet.
const RUNTIMES = [
  { id: 'claude', label: 'Claude Code', bins: ['claude'], adapter: true },
  { id: 'codex', label: 'Codex', bins: ['codex'], adapter: true },
  { id: 'openclaw', label: 'OpenClaw', bins: ['openclaw'], adapter: true },
  // DeepSeek Harness, also known as Hermes on some installs.
  { id: 'dsh', label: 'DeepSeek Harness', bins: ['dsh', 'deepseek-harness', 'hermes'], pkg: '@deepseek-ai/dsh',
    scripts: ['/usr/lib/node_modules/@deepseek-ai/dsh/lib/bin.js', '/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js'],
    adapter: true },
];

// Homes to look in: this user's, root's and every one under /home — agents often belong to a
// regular user while SpectraHub runs as root, or the other way round. SPECTRAHUB_SCAN_HOMES
// (folders separated by ":") replaces the list for unusual layouts.
export function userHomes() {
  const set = process.env.SPECTRAHUB_SCAN_HOMES;
  let list = set ? set.split(':') : [homedir(), '/root'];
  if (!set) { try { list = list.concat(readdirSync('/home').map((n) => join('/home', n))); } catch { /* no /home */ } }
  const seen = new Set();
  return list.filter((h) => {
    try {
      const r = realpathSync(h);
      if (!statSync(r).isDirectory() || seen.has(r)) return false;
      seen.add(r);
      return true;
    } catch { return false; }
  });
}

// Where agents get installed besides PATH (a service starts with a short one): per-user
// installers (Claude Code in ~/.local/bin, Codex standalone), Node version managers, snaps.
function binDirs() {
  const dirs = (process.env.PATH ?? '').split(delimiter);
  for (const h of userHomes()) {
    dirs.push(...['.local/bin', '.npm-global/bin', '.bun/bin', '.volta/bin', '.claude/local', '.codex/packages/standalone/current/bin', '.local/share/pnpm', 'bin'].map((d) => join(h, d)));
    try { for (const v of readdirSync(join(h, '.nvm/versions/node')).sort().reverse()) dirs.push(join(h, '.nvm/versions/node', v, 'bin')); } catch { /* no nvm */ }
  }
  if (!process.env.SPECTRAHUB_SCAN_HOMES) dirs.push('/usr/local/bin', '/usr/bin', '/snap/bin');
  return [...new Set(dirs.filter(Boolean))];
}

function which(bin) {
  for (const dir of binDirs()) {
    const p = join(dir, bin);
    try { accessSync(p, constants.X_OK); return p; } catch { /* next */ }
  }
  return null;
}

function run(bin, args, ms = 8000) {
  return new Promise((ok) => {
    execFile(bin, args, { timeout: ms, encoding: 'utf8' }, (err, stdout) => ok(err ? '' : stdout));
  });
}

// The npm package a script belongs to: the nearest package.json above it.
function packageOf(script) {
  for (let d = dirname(script), i = 0; i < 5; i++, d = dirname(d)) {
    try { return JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')).name ?? null; } catch { /* go up */ }
  }
  return null;
}

// Running services, system and user, each with how it starts: one systemctl call per scope.
async function runningUnits() {
  const units = [];
  for (const scope of ['--system', '--user']) {
    const names = (await run('systemctl', [scope, 'list-units', '--type=service', '--state=running', '--no-legend', '--plain']))
      .split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((n) => n?.endsWith('.service'));
    if (!names.length) continue;
    const show = await run('systemctl', [scope, 'show', ...names, '-p', 'Id', '-p', 'ExecStart', '-p', 'WorkingDirectory', '-p', 'Environment', '-p', 'EnvironmentFiles'], 15000);
    for (const block of show.split(/\n\n+/)) if (block.trim()) units.push(block);
  }
  return units;
}

// systemd unit → how it starts the agent: the node script, its folder, environment and env file.
function fromUnit(show, pkg) {
  const exec = /argv\[\]=([^;]+);/.exec(show)?.[1]?.trim().split(/\s+/) ?? [];
  const script = exec.find((a) => a.endsWith('.js'));
  if (!script || !existsSync(script) || packageOf(script) !== pkg) return null;
  const env = {};
  for (const pair of (/^Environment=(.*)$/m.exec(show)?.[1] ?? '').split(/\s+/)) {
    const i = pair.indexOf('=');
    if (i > 0) env[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return {
    node: exec[0]?.endsWith('node') ? exec[0] : process.execPath,
    script,
    cwd: /^WorkingDirectory=(.+)$/m.exec(show)?.[1] || null,
    env,
    envFile: /^EnvironmentFiles=(\S+)/m.exec(show)?.[1] || null,
    unit: /^Id=(.+)$/m.exec(show)?.[1] ?? 'service',
  };
}

// KEY=value lines; values never leave the server, they only reach the agent's own process.
export function readEnvFile(file) {
  const env = {};
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=\s*(.*)\s*$/.exec(line);
      if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch { /* unreadable: the agent starts without it */ }
  return env;
}

export const openclawHome = () => process.env.OPENCLAW_HOME ?? join(homedir(), '.openclaw');
const openclawConfigPath = () => process.env.OPENCLAW_CONFIG_PATH ?? join(openclawHome(), 'openclaw.json');

// OpenClaw's default agent, from its own config (instant), else from its CLI (slow: it boots the app).
async function openclawAgent(path) {
  try {
    const list = JSON.parse(readFileSync(openclawConfigPath(), 'utf8')).agents?.list ?? [];
    const pick = list.find((a) => a.default) ?? list[0];
    if (pick?.id) return pick.id;
  } catch { /* no readable config: ask the CLI */ }
  const out = await run(path, ['agents', 'list'], 45000);
  return /^- (\S+) \(default\)/m.exec(out)?.[1] ?? /^- (\S+)/m.exec(out)?.[1] ?? null;
}

let cache = null;
let inflight = null;
let cachedAt = 0;

// Installed runtimes with version; OpenClaw also reports which gateway agent answers by default.
export async function scan({ fresh = false } = {}) {
  if (cache && !fresh && Date.now() - cachedAt < 60_000) return cache;
  inflight ??= doScan().finally(() => { inflight = null; });  // one scan at a time; callers share it
  return inflight;
}

async function doScan() {
  let units = null;
  const found = await Promise.all(RUNTIMES.map(async (r) => {
    let path = r.bins.map(which).find(Boolean) ?? null;
    let launch = null;  // node script run as the host runs it
    if (!path && r.pkg) {
      units ??= runningUnits();
      for (const show of await units) { launch = fromUnit(show, r.pkg); if (launch) break; }
    }
    if (!path && !launch) {
      const script = (r.scripts ?? []).find((f) => existsSync(f) && packageOf(f) === r.pkg);
      if (script) launch = { node: process.execPath, script, cwd: null, env: {}, envFile: null, unit: null };
    }
    const out = { id: r.id, label: r.label, installed: Boolean(path || launch), ready: Boolean(path || launch) && r.adapter, path: path ?? launch?.script ?? null, version: null };
    if (!out.installed) return out;
    if (launch) {
      out.via = launch.unit ? `usługa ${launch.unit}` : 'katalog instalacji';
      if (launch.cwd) out.workspace = launch.cwd;
      Object.defineProperty(out, 'launch', { value: launch, enumerable: false });  // never sent to the browser
    }
    const version = launch ? run(launch.node, [launch.script, '--version'], 15000) : run(path, ['--version']);
    out.version = (await version).split('\n')[0].trim() || null;
    if (r.id === 'dsh' && launch?.cwd) out.agent = basename(launch.cwd).toLowerCase();
    if (r.id === 'claude') {
      const help = await run(path, ['--help'], 15000);
      out.asks = /--input-format/.test(help) && /--permission-prompt-tool/.test(help);  // older Claude Code: plain text in, no prompts
    }
    if (r.id === 'openclaw') {
      out.agent = await openclawAgent(path);
      if (!out.agent) { out.ready = false; out.note = 'nie podał swoich agentów'; }
    }
    out.approvals = r.id === 'claude' ? (out.asks ? 'native' : 'turn') : r.id === 'openclaw' ? 'turn-and-native-exec' : 'native';
    if (!r.adapter) out.note = 'znaleziony, brak adaptera';
    return out;
  }));
  cache = found;
  cachedAt = Date.now();
  return found;
}

// ---------- models: what each runtime offers right now, read from the runtime itself ----------
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const OPENCLAW_THINKING = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max'];

function jsonFile(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

function tomlValue(file, key) {
  try { return new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm').exec(readFileSync(file, 'utf8'))?.[1] ?? null; } catch { return null; }
}

// Claude Code: the newest model of each family it knows, read from the installed program itself
// (with its long-context variant when it has one), and the effort levels its --help lists.
const claudeKnown = { key: null, value: null };
function claudeFamilies(path) {
  let real = path;
  try { real = realpathSync(path); } catch { /* keep the path */ }
  let key = real;
  try { key = `${real}:${statSync(real).mtimeMs}`; } catch { /* not there */ }
  if (claudeKnown.key === key) return claudeKnown.value;
  const best = new Map();  // family -> { major, minor, id, long }
  try {
    const text = readFileSync(real).toString('latin1');
    for (const m of text.matchAll(/claude-(fable|opus|sonnet|haiku)-(\d{1,2})(?:-(\d{1,2}))?(\[1m\])?(?![\d-])/g)) {
      const [, family, major, minor = '0', long] = m;
      const id = `claude-${family}-${major}${m[3] ? `-${m[3]}` : ''}`;
      const cur = best.get(family);
      const newer = !cur || Number(major) > cur.major || (Number(major) === cur.major && Number(minor) > cur.minor);
      if (newer) best.set(family, { major: Number(major), minor: Number(minor), id, long: Boolean(long) });
      else if (cur.id === id && long) cur.long = true;
    }
  } catch { /* unreadable: aliases only */ }
  claudeKnown.key = key;
  claudeKnown.value = best;
  return best;
}

async function claudeModels(rt) {
  const settings = jsonFile(join(homedir(), '.claude', 'settings.json')) ?? {};
  const help = await run(rt.path, ['--help'], 15000);
  const efforts = /--effort <level>[\s\S]{0,200}?\(([a-z, ]+)\)/.exec(help)?.[1]?.split(/,\s*/).filter(Boolean) ?? CLAUDE_EFFORTS;
  const names = { fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' };
  const models = [{ id: '', label: 'domyślny agenta', note: 'Claude Code wybiera według planu i ustawień', efforts }];
  for (const family of ['fable', 'opus', 'sonnet', 'haiku']) {
    const b = claudeFamilies(rt.path).get(family);
    if (!b) { models.push({ id: family, label: names[family], note: 'najnowszy', efforts }); continue; }
    const label = `${names[family]} ${b.major}${b.minor ? `.${b.minor}` : ''}`;
    models.push({ id: b.id, label, note: b.id, efforts });
    if (b.long) models.push({ id: `${b.id}[1m]`, label: `${label} · 1M`, note: 'milion tokenów kontekstu', efforts });
  }
  return { configurable: true, models, defaultModel: settings.model ?? null, defaultEffort: settings.effortLevel ?? null, effortLabel: 'effort' };
}

async function codexModels(rt) {
  const out = await run(rt.path, ['debug', 'models'], 30000);
  let list = [];
  try { const d = JSON.parse(out); list = Array.isArray(d) ? d : d.models ?? []; } catch { /* older codex */ }
  const conf = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'config.toml');
  return {
    configurable: true,
    models: [{ id: '', label: 'domyślny agenta', efforts: [] }, ...list.filter((m) => m.visibility !== 'hide').map((m) => ({
      id: m.slug, label: m.display_name ?? m.slug, note: m.description ?? '',
      efforts: (m.supported_reasoning_levels ?? []).map((l) => l.effort), defaultEffort: m.default_reasoning_level ?? null,
      contextWindow: m.context_window ? Math.round(m.context_window * (m.effective_context_window_percent ?? 100) / 100) : null,
    }))],
    defaultModel: tomlValue(conf, 'model'),
    defaultEffort: tomlValue(conf, 'model_reasoning_effort'),
    effortLabel: 'reasoning',
  };
}

// OpenClaw's own view of the agent SpectraHub talks to: its model, the models its config lets it
// switch to, and how each provider signs in. Read from `openclaw models status` (no provider calls),
// else straight from the config file.
let ocStatus = { at: 0, agent: null, value: null };
let ocFlight = null;
export async function openclawStatus(rt) {
  if (ocStatus.value && ocStatus.agent === rt.agent && Date.now() - ocStatus.at < 10 * 60_000) return ocStatus.value;
  ocFlight ??= (async () => {
    let d = null;
    try { d = JSON.parse(await run(rt.path, ['models', 'status', '--agent', rt.agent, '--json'], 60000)); } catch { /* read the config */ }
    if (!Array.isArray(d?.allowed)) d = { ...openclawFromConfig(rt.agent), auth: d?.auth ?? null };
    ocStatus = { at: Date.now(), agent: rt.agent, value: d };
    return d;
  })().finally(() => { ocFlight = null; });
  return ocFlight;
}

function openclawFromConfig(agent) {
  const cfg = jsonFile(openclawConfigPath()) ?? {};
  const def = cfg.agents?.defaults ?? {};
  const a = (cfg.agents?.list ?? []).find((x) => x.id === agent) ?? {};
  const pick = (m) => (typeof m === 'string' ? m : m?.primary) ?? null;
  const primary = pick(a.model) ?? pick(def.model);
  const allowed = Object.keys(a.models ?? def.models ?? {});
  const aliases = Object.fromEntries(Object.entries(a.models ?? def.models ?? {}).filter(([, v]) => v?.alias).map(([id, v]) => [v.alias, id]));
  return { resolvedDefault: primary, allowed: allowed.length ? allowed : [primary].filter(Boolean), aliases };
}

async function openclawModels(rt) {
  const st = await openclawStatus(rt);
  const cfg = jsonFile(openclawConfigPath()) ?? {};
  const agent = (cfg.agents?.list ?? []).find((x) => x.id === rt.agent) ?? {};
  const alias = Object.fromEntries(Object.entries(st.aliases ?? {}).map(([name, id]) => [id, name]));
  const main = st.resolvedDefault ?? st.defaultModel ?? null;
  const ids = [...new Set([main, ...st.allowed].filter(Boolean))];
  return {
    configurable: true,
    models: [{ id: '', label: 'domyślny agenta', efforts: OPENCLAW_THINKING },
      ...ids.map((id) => ({ id, label: id, note: [id === main ? `model agenta ${rt.agent}` : '', alias[id] ? `alias: ${alias[id]}` : ''].filter(Boolean).join(' · '), efforts: OPENCLAW_THINKING }))],
    defaultModel: main,
    defaultEffort: agent.thinkingDefault ?? cfg.agents?.defaults?.thinkingDefault ?? null,
    effortLabel: 'thinking',
    source: `konfiguracja OpenClaw · agent ${rt.agent}`,
  };
}

// DeepSeek Harness: the models DeepSeek offers to its key, its own reasoning levels, and the model
// its profile uses. A choice reaches it as a --patch overlay; its own files stay as they are.
const DSH_EFFORTS = ['off', 'low', 'high', 'max'];
const DSH_NAMES = { 'deepseek-flash': 'DeepSeek V4.1 Flash', 'deepseek-v4-pro': 'DeepSeek V4 Pro', 'deepseek-chat': 'DeepSeek Chat', 'deepseek-reasoner': 'DeepSeek Reasoner' };
function dshEnv(rt) { return { ...(rt?.launch?.envFile ? readEnvFile(rt.launch.envFile) : {}), ...(rt?.launch?.env ?? {}) }; }
// The model and reasoning level DeepSeek Harness really uses: its own composed profile
// (bundles, the profile's patch, the home patch), as `--dump-config` prints it.
const dshProf = { key: null, at: 0, value: null };
export async function dshProfile(rt) {
  const env = { ...process.env, ...dshEnv(rt) };
  const key = `${env.DSH_HOME ?? ''}:${rt?.path ?? ''}`;
  if (dshProf.key === key && Date.now() - dshProf.at < 10 * 60_000) return dshProf.value;
  const [bin, args] = rt?.launch ? [rt.launch.node, [rt.launch.script, '--profile', 'headless', '--dump-config']] : [rt?.path, ['--profile', 'headless', '--dump-config']];
  const out = bin ? await new Promise((ok) => execFile(bin, args, { env, timeout: 60000, encoding: 'utf8', maxBuffer: 16e6 }, (err, so) => ok(err ? '' : so))) : '';
  const block = /- id: agent-default-model[\s\S]*?(?=\n- id:|\n# ==|$)/.exec(out)?.[0] ?? '';
  const val = (k) => new RegExp(`^\\s+${k}:\\s*['"]?([^'"\\n]+)`, 'm').exec(block)?.[1]?.trim() ?? null;
  const value = { provider: val('provider') ?? 'deepseek-official', model: val('model'), effort: val('reasoningEffort') };
  Object.assign(dshProf, { key, at: Date.now(), value });
  return value;
}
async function dshModels(rt) {
  const prof = await dshProfile(rt);
  const deepseek = /deepseek/i.test(prof.provider ?? '');
  const key = deepseek ? dshEnv(rt).DEEPSEEK_API_KEY ?? process.env.DEEPSEEK_API_KEY : null;  // another provider: its profile's model only
  let ids = [];
  if (key) {
    try {
      const res = await fetch('https://api.deepseek.com/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
      if (res.ok) ids = ((await res.json()).data ?? []).map((m) => m.id).filter(Boolean);
    } catch { /* offline: the profile's model only */ }
  }
  if (prof.model && !ids.includes(prof.model)) ids.unshift(prof.model);
  return {
    configurable: true,
    models: [{ id: '', label: 'domyślny agenta', efforts: DSH_EFFORTS }, ...ids.map((id) => ({ id, label: DSH_NAMES[id] ?? id, note: [id, id === prof.model ? 'model profilu' : ''].filter(Boolean).join(' · '), efforts: DSH_EFFORTS }))],
    defaultModel: prof.model, defaultEffort: prof.effort ?? 'high', effortLabel: 'reasoning',  // DeepSeek's own default when the profile names none
    source: key ? 'API DeepSeek i profil DeepSeek Harness' : `profil DeepSeek Harness (${prof.provider})`,
  };
}
function dshPatch(rt, model, effort) {
  const prof = dshProf.value ?? { provider: 'deepseek-official', model: null, effort: null };  // read when the models were listed
  const dir = join(tmpdir(), 'spectrahub-dsh');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${(model || prof.model || 'default').replace(/[^\w.-]/g, '_')}-${effort || prof.effort || 'default'}.yml`);
  const lines = ['- id: agent-default-model', '  name: "@deepseek-ai/dsh-agent-default-model"', '  config:', `    provider: ${prof.provider}`];
  if (model || prof.model) lines.push(`    model: ${model || prof.model}`);
  if (effort || prof.effort) lines.push(`    reasoningEffort: ${effort || prof.effort}`);
  writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
  return file;
}

// Keep the owner's headless composition and change only its transport. The ACP route and
// approval service are composed on top for this process; no installed profile is rewritten.
export function dshAcpPatch(profile, model, effort, perm = 'read') {
  const dir = join(tmpdir(), 'spectrahub-dsh');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${randomUUID()}-acp.yml`);
  const config = { ...(profile.provider ? { provider: profile.provider } : {}), ...(model || profile.model ? { model: model || profile.model } : {}) };
  const mode = { read: 'read-only', write: 'workspace-write', full: 'danger-full-access' }[perm] ?? 'read-only';
  const presets = Object.fromEntries(['read-only', 'workspace-write', 'danger-full-access'].map((sandbox) => [sandbox, { sandbox, approval: 'ask' }]));
  const lines = [
    '- id: headless-startup', '  disabled: true', '- id: headless-runner', '  disabled: true',
    '- id: session-title-llm', '  disabled: true', '- id: approval', '  config:', '    policy: ask',
    '- id: permission', `  config: ${JSON.stringify({ presets })}`,
    '- insert:', '    - id: spectrahub-acp-startup', '      name: "@deepseek-ai/dsh-acp-app"',
    '    - id: spectrahub-permissions', `      name: ${JSON.stringify(fileURLToPath(new URL('./dsh-permissions.js', import.meta.url)))}`, `      config: ${JSON.stringify({ mode })}`,
    '    - id: spectrahub-acp', '      name: "@deepseek-ai/dsh-acp"', '      inject: [acpAppStartup, spectrahubPermissions]', `      config: ${JSON.stringify(config)}`,
  ];
  if (model || effort) lines.push('- id: agent-default-model', `  config: ${JSON.stringify({ ...config, ...(effort ? { reasoningEffort: effort } : {}) })}`);
  writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
  return file;
}

const MODEL_SOURCES = { claude: claudeModels, codex: codexModels, openclaw: openclawModels, dsh: dshModels };

// Each runtime's list is read on its own and cached; a slow CLI never holds up the others.
// Returns what is ready now, with `pending` naming the runtimes still being read.
const modelCache = new Map();   // id -> { at, value }
const modelFlight = new Map();  // id -> promise

function loadModelsOf(rt) {
  if (modelFlight.has(rt.id)) return modelFlight.get(rt.id);
  const src = MODEL_SOURCES[rt.id];
  const p = (async () => {
    try { return src ? await src(rt) : { configurable: false, models: [], note: 'model ustawia sam agent' }; }
    catch { return { configurable: false, models: [], note: 'nie udało się odczytać modeli' }; }
  })().then((value) => { modelCache.set(rt.id, { at: Date.now(), value }); return value; })
    .finally(() => modelFlight.delete(rt.id));
  modelFlight.set(rt.id, p);
  return p;
}

export async function models({ fresh = false, wait = false } = {}) {
  const ready = (await scan()).filter((r) => r.ready);
  const out = {};
  const pending = [];
  for (const rt of ready) {
    const c = modelCache.get(rt.id);
    if (!c || fresh || Date.now() - c.at > 10 * 60_000) {
      const p = loadModelsOf(rt);
      if (wait || !c) { if (wait) out[rt.id] = await p; else pending.push(rt.id); }
    }
    if (!out[rt.id] && modelCache.get(rt.id)) out[rt.id] = modelCache.get(rt.id).value;
  }
  // Claude's list needs no CLI call: give it at once rather than waiting for the next request.
  for (const id of [...pending]) {
    if (MODEL_SOURCES[id] === claudeModels) { out[id] = await modelFlight.get(id) ?? modelCache.get(id)?.value; pending.splice(pending.indexOf(id), 1); }
  }
  return pending.length ? { ...out, _pending: pending } : out;
}

const short = (s, n = 160) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// Long tool output keeps its head and tail, like a terminal you scroll back in.
export function clip(s, n = 6000) {
  s = String(s ?? '');
  if (s.length <= n) return s;
  const half = Math.floor(n / 2);
  return `${s.slice(0, half)}\n… (pominięto ${s.length - n} znaków) …\n${s.slice(-half)}`;
}

// One line saying what a tool is doing, from whatever its input calls the thing.
function titleOf(input) {
  const i = input ?? {};
  const t = i.command ?? i.cmd ?? i.file_path ?? i.path ?? i.filePath ?? i.pattern ?? i.url ?? i.query ?? i.description;
  return short(String(t ?? (Object.keys(i).length ? JSON.stringify(i) : '')).replace(/\s+/g, ' ').trim(), 200);
}

// A file edit as before/after text, when the tool input carries it.
function diffOf(input) {
  const i = input ?? {};
  const path = i.file_path ?? i.path ?? i.filePath ?? null;
  const pick = (...keys) => keys.map((k) => i[k]).find((v) => typeof v === 'string');
  const oldText = pick('old_string', 'oldText', 'old_str', 'old');
  const newText = pick('new_string', 'newText', 'new_str', 'new');
  if (path && oldText != null && newText != null) return { path, old: clip(oldText, 4000), new: clip(newText, 4000) };
  if (Array.isArray(i.edits) && path) {
    return { path, old: clip(i.edits.map((e) => e.old_string ?? '').join('\n⋯\n'), 4000), new: clip(i.edits.map((e) => e.new_string ?? '').join('\n⋯\n'), 4000) };
  }
  const content = pick('content', 'file_text', 'text');
  if (path && content != null) return { path, old: '', new: clip(content, 4000), created: true };
  return null;
}

// Tool call → step; edits carry a diff, todo tools carry the list.
function toolStep(id, name, input) {
  const step = { id, kind: 'tool', name, title: titleOf(input) };
  const diff = diffOf(input);
  if (diff) { step.kind = 'edit'; step.diff = diff; step.title = diff.path; }
  const todos = input?.todos ?? input?.items;
  if (/todo/i.test(name) && Array.isArray(todos)) {
    step.kind = 'todo';
    step.todos = todos.map((t) => ({ text: String(t.content ?? t.text ?? t.title ?? ''), state: t.status ?? (t.completed ? 'completed' : 'pending') }));
  }
  return step;
}

const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x.text ?? '').join('') : c == null ? '' : JSON.stringify(c));

// Three permission levels per agent, mapped onto what each runtime itself offers:
//   read  — reads and answers, changes nothing
//   write — may change files in the session's working folder, no shell for Claude
//   full  — everything the runtime can do (the owner's default)
export const PERMS = ['read', 'write', 'full'];
const CLAUDE_TOOLS = {
  read: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite'],
  write: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'WebFetch', 'WebSearch', 'TodoWrite'],
  full: ['Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite'],
};

// Claude Code: text deltas, every tool call with its result, thinking, todo list and cost.
// SpectraHub only opens a window to the agent: its own settings, instructions and hooks apply.
const claude = {
  argv(ref, started, o = {}) {
    const perm = PERMS.includes(o.perm) ? o.perm : 'full';
    const asks = o.asks !== false;  // anything outside the allowed tools is asked about in the chat
    return ['-p', ...(asks ? ['--input-format', 'stream-json', '--permission-prompt-tool', 'stdio'] : []), '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--permission-mode', o.advisory ? 'plan' : perm === 'read' ? 'default' : 'acceptEdits',
      ...(o.model ? ['--model', o.model] : []), ...(o.effort ? ['--effort', o.effort] : []),
      ...(started ? ['--resume', ref] : ['--session-id', ref]),
      ...(o.advisory
        ? ['--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}']
        : ['--allowedTools', ...CLAUDE_TOOLS[perm]])];
  },
  stdin: 'json',  // the message goes as one JSON line; stdin stays open for answers until the result
  line(d, emit) {
    if (d.type === 'control_request') {
      const r = d.request ?? {};
      if (r.subtype !== 'can_use_tool') return emit({ type: 'control-reply', id: d.request_id, error: 'nieobsługiwane w SpectraHub' });
      const question = r.tool_name === 'AskUserQuestion' && Array.isArray(r.input?.questions);
      return emit({ type: 'ask', id: d.request_id, kind: question ? 'question' : 'permission', tool: r.display_name ?? r.tool_name, toolName: r.tool_name,
        title: question ? '' : titleOf(r.input), description: r.description ?? r.input?.description ?? '', path: r.blocked_path ?? null,
        questions: question ? r.input.questions.map((q) => ({ question: q.question, header: q.header ?? '', multi: Boolean(q.multiSelect),
          options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description ?? '' })) })) : null,
        always: (r.permission_suggestions ?? []).length > 0, input: r.input, suggestions: r.permission_suggestions ?? [] });
    }
    const ev = d.type === 'stream_event' ? d.event : null;
    if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') emit({ type: 'text', s: ev.delta.text });
    else if (ev?.type === 'content_block_start' && ev.content_block?.type === 'text') emit({ type: 'text', s: '', block: true });
    else if (ev?.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
      emit({ type: 'step', id: ev.content_block.id, kind: 'tool', name: ev.content_block.name, title: '' });
    } else if (d.type === 'assistant') {
      for (const c of d.message?.content ?? []) {
        if (c.type === 'tool_use') emit({ type: 'step', ...toolStep(c.id, c.name, c.input) });
        else if (c.type === 'thinking' && c.thinking) emit({ type: 'step', id: `think-${d.message.id ?? ''}-${c.thinking.length}`, kind: 'think', text: clip(c.thinking, 8000), done: true });
      }
    } else if (d.type === 'user') {
      for (const c of Array.isArray(d.message?.content) ? d.message.content : []) {
        if (c.type === 'tool_result') emit({ type: 'step-end', id: c.tool_use_id, ok: !c.is_error, output: clip(textOf(c.content)) });
      }
    } else if (d.type === 'system' && d.subtype === 'init' && d.model) {
      emit({ type: 'usage', model: d.model });
    } else if (d.type === 'rate_limit_event' && d.rate_limit_info?.unifiedWindows) {
      const w = d.rate_limit_info.unifiedWindows;
      emit({ type: 'limits', status: d.rate_limit_info.status, windows: [
        w.five_hour && { label: 'sesja (5 godz)', used: w.five_hour.utilization, resetsAt: w.five_hour.resetsAt },
        w.seven_day && { label: 'tydzień', used: w.seven_day.utilization, resetsAt: w.seven_day.resetsAt },
      ].filter(Boolean) });
    } else if (d.type === 'result') {
      const u = d.usage ?? {};
      const last = (u.iterations ?? []).at(-1) ?? u;
      const mu = Object.values(d.modelUsage ?? {})[0] ?? {};
      emit({ type: 'usage', input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens ?? 0,
        cost: d.total_cost_usd ?? null, ms: d.duration_ms ?? null,
        context: (last.input_tokens ?? 0) + (last.cache_read_input_tokens ?? 0) + (last.cache_creation_input_tokens ?? 0) + (last.output_tokens ?? 0),
        contextWindow: mu.contextWindow ?? null });
      if (d.is_error) emit({ type: 'error', s: String(d.result ?? d.subtype ?? 'error') });
      emit({ type: 'done' });
    }
  },
};

// `/bin/bash -c 'cmd'` → `cmd`, the way it was typed.
function unwrap(command) {
  const c = String(command ?? '').trim();
  const m = /^(?:\/usr)?\/bin\/(?:ba|z)?sh\s+-l?c\s+(?:(['"])([\s\S]*)\1|([\s\S]+))$/.exec(c);
  return m ? (m[2] ?? m[3]).replace(/'"'"'/g, "'") : c;
}

// Codex keeps plan limits in its own session files (~/.codex/sessions/…/rollout-*-<thread>.jsonl).
const rollouts = new Map();  // thread id -> file
export function codexRollout(thread) {
  if (rollouts.has(thread)) return rollouts.get(thread);
  const root = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions');
  const walk = (dir, depth) => {
    let names = [];
    try { names = readdirSync(dir).sort().reverse(); } catch { return null; }
    for (const n of names) {
      const p = join(dir, n);
      if (n.endsWith('.jsonl') && n.includes(thread)) return p;
      if (depth < 3 && !n.includes('.')) { const hit = walk(p, depth + 1); if (hit) return hit; }
    }
    return null;
  };
  const f = walk(root, 0);
  if (f) rollouts.set(thread, f);
  return f;
}
export function codexLimits(thread) {
  const f = thread && codexRollout(thread);
  if (!f) return null;
  let last = null;
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) if (line.includes('"rate_limits"')) last = line;
  } catch { return null; }
  if (!last) return null;
  const r = JSON.parse(last).payload?.rate_limits;
  if (!r) return null;
  const win = (x) => x && { label: x.window_minutes >= 10080 ? 'tydzień' : x.window_minutes >= 1440 ? 'doba' : `sesja (${Math.round(x.window_minutes / 60)} godz)`, used: (x.used_percent ?? 0) / 100, resetsAt: x.resets_at };
  return { windows: [win(r.primary), win(r.secondary)].filter(Boolean), plan: r.plan_type ?? null };
}

// Codex: messages, commands with their output and exit code, file changes, plan and reasoning.
const codex = {
  // Historical exec event normalization is retained for recorded events and adapter tests.
  // Live turns exclusively use app-server; there is no non-interactive bypass fallback.
  line(d, emit) {
    const it = d.item;
    if (d.type === 'thread.started') emit({ type: 'ref', ref: d.thread_id });
    else if (it?.type === 'agent_message' && d.type === 'item.completed') emit({ type: 'text', s: it.text.trimEnd(), block: true });
    else if (it?.type === 'command_execution') {
      if (d.type === 'item.started') emit({ type: 'step', id: it.id, kind: 'tool', name: 'bash', title: short(unwrap(it.command), 200) });
      else if (d.type === 'item.completed') emit({ type: 'step-end', id: it.id, ok: it.exit_code === 0, exit: it.exit_code, output: clip(it.aggregated_output) });
    } else if (it?.type === 'reasoning' && d.type === 'item.completed' && it.text) {
      emit({ type: 'step', id: it.id, kind: 'think', text: clip(it.text, 8000), done: true });
    } else if (it?.type === 'file_change') {
      emit({ type: 'step', id: it.id, kind: 'edit', name: 'edit', title: (it.changes ?? []).map((c) => `${c.kind ?? ''} ${c.path}`.trim()).join(', ') });
      if (d.type === 'item.completed') emit({ type: 'step-end', id: it.id, ok: it.status !== 'failed' });
    } else if (it?.type === 'todo_list') {
      emit({ type: 'step', id: it.id, kind: 'todo', name: 'plan', todos: (it.items ?? []).map((t) => ({ text: t.text, state: t.completed ? 'completed' : 'pending' })) });
    } else if (it?.type === 'mcp_tool_call' || it?.type === 'web_search') {
      if (d.type === 'item.started') emit({ type: 'step', id: it.id, kind: 'tool', name: it.type === 'web_search' ? 'web' : `${it.server}.${it.tool}`, title: titleOf(it.arguments ?? { query: it.query }) });
      else if (d.type === 'item.completed') emit({ type: 'step-end', id: it.id, ok: it.status !== 'failed', output: clip(textOf(it.result?.content ?? it.result ?? '')) });
    } else if (d.type === 'error' || d.type === 'turn.failed') emit({ type: 'error', s: String(d.message ?? d.error?.message ?? 'error') });
    else if (d.type === 'turn.completed') {
      emit({ type: 'usage', input: d.usage?.input_tokens ?? 0, output: (d.usage?.output_tokens ?? 0) + (d.usage?.reasoning_output_tokens ?? 0) });
      emit({ type: 'limits-codex' });  // read from the rollout file once the turn is written
      emit({ type: 'done' });
    }
  },
};

// DeepSeek Harness: thinking, tool calls with results and tokens per step, from the headless profile.
const dsh = {
  argv(ref, started, o = {}) {
    return ['--profile', 'headless', ...(o.patch ? ['--patch', o.patch] : []), '--json', ...(started ? ['--session-id', ref] : []), '-'];
  },
  stdin: true,
  line(d, emit) {
    this.n ??= 0;
    this.usage ??= { input: 0, output: 0 };
    if (d.type === 'session') emit({ type: 'ref', ref: d.sessionId });
    else if (d.type === 'thinking' && d.text) emit({ type: 'step', id: `think-${this.n++}`, kind: 'think', text: clip(d.text, 8000), done: true });
    else if (d.type === 'text' && d.text) { this.said = true; emit({ type: 'text', s: d.text, block: true }); }
    else if (d.type === 'final' && d.text && !this.said) emit({ type: 'text', s: d.text, block: true });
    else if (d.type === 'tool_call') emit({ type: 'step', ...toolStep(d.callId, d.tool, d.input) });
    else if (d.type === 'tool_result') emit({ type: 'step-end', id: d.callId, ok: d.status === 'completed', output: clip(textOf(d.result)) });
    else if (d.type === 'error') emit({ type: 'error', s: String(d.message ?? d.error ?? 'error') });
    else if (d.type === 'status' && d.phase === 'step_end' && d.usage) {
      this.usage.input += (d.usage.inputTokens ?? 0) + (d.usage.cacheReadTokens ?? 0);
      this.usage.output += d.usage.outputTokens ?? 0;
      this.usage.context = d.usage.totalTokens ?? null;
      emit({ type: 'usage', ...this.usage });
    } else if (d.type === 'status' && d.phase === 'turn_end') {
      if (d.reason?.kind && d.reason.kind !== 'completed') emit({ type: 'error', s: `tura zakończona: ${d.reason.kind}` });
      emit({ type: 'done' });
    }
  },
};

// OpenClaw: the answer comes as one JSON document at the end, so the steps are read live from the
// session file the agent writes as it works. Nothing is delivered to channels.
const openclaw = {
  argv(ref, _started, { agent, file, model, effort, perm }) {
    return ['agent', ...(perm === 'read' || perm === 'write' ? ['--local'] : []), '--agent', agent, '--session-id', ref, '--message-file', file, '--json', '--timeout', '600',
      ...(model ? ['--model', model] : []), ...(effort ? ['--thinking', effort] : [])];
  },
  stdin: false,
  tailFile(ref, rt) {
    return join(openclawHome(), 'agents', rt.agent, 'sessions', `${ref}.jsonl`);
  },
  tail(d, emit) {
    const m = d.type === 'message' ? d.message : null;
    if (!m) return;
    if (m.role === 'assistant') {
      for (const c of Array.isArray(m.content) ? m.content : []) {
        if (c.type === 'toolCall') emit({ type: 'step', ...toolStep(c.id, c.name, c.arguments) });
        else if (c.type === 'thinking' && (c.thinking ?? c.text)) emit({ type: 'step', id: `think-${d.id}`, kind: 'think', text: clip(c.thinking ?? c.text, 8000), done: true });
      }
    } else if (m.role === 'toolResult') {
      emit({ type: 'step-end', id: m.toolCallId, ok: !m.isError, output: clip(textOf(m.content)) });
    }
  },
  // The answer is one JSON document; an embedded run (--local) may log lines before it and may keep
  // running after it, so the turn ends as soon as the document is complete.
  complete(text) {
    const i = text.search(/^\{$/m);
    if (i < 0 || !/\n\}\s*$/.test(text)) return false;
    try { JSON.parse(text.slice(i)); return true; } catch { return false; }
  },
  whole(text, emit) {
    let d;
    try { d = JSON.parse(text.slice(Math.max(0, text.search(/^\{$/m)))); }
    catch { return emit({ type: 'error', s: short(text.trim() || 'brak odpowiedzi', 400) }); }
    const r = d.result ?? d;  // through the gateway {status, result: {payloads, meta}}; embedded {payloads, meta}
    for (const p of r.payloads ?? []) {
      if (p.text) emit({ type: 'text', s: p.text.trimEnd(), block: true });
      // files the agent hands over (mediaUrl / mediaUrls): local ones become file cards in the chat
      for (const m of [p.mediaUrl, ...(Array.isArray(p.mediaUrls) ? p.mediaUrls : [])].filter(Boolean)) {
        let path = String(m);
        if (path.startsWith('file://')) { try { path = decodeURIComponent(path.slice(7)); } catch { continue; } }  // a broken link is skipped
        if (path.startsWith('/')) emit({ type: 'file', path });
      }
    }
    const m = r.meta?.agentMeta ?? {};
    const u = m.usage;
    if (u) {
      emit({ type: 'usage', input: (u.input ?? 0) + (u.cacheRead ?? 0), output: u.output ?? 0, ms: r.meta?.durationMs ?? null,
        model: m.model ? `${m.provider ? m.provider + '/' : ''}${m.model}` : null, context: m.promptTokens ?? null, contextWindow: m.contextTokens ?? null });
    }
    if (d.status ? d.status !== 'ok' : r.meta?.aborted) emit({ type: 'error', s: String(d.summary ?? d.status ?? 'przerwane') });
    emit({ type: 'done' });
  },
};

// OpenClaw takes no per-run tool limits through its gateway, so a limited turn runs embedded
// (--local) with a small config that includes the owner's own and only adds denials on top.
// The owner's config file is never written.
// Named by OpenClaw's own tool groups, so it holds on any install; plugin tools are left out
// entirely, since nothing tells what a plugin's tool may change.
const OPENCLAW_DENY = {
  read: ['group:runtime', 'write', 'edit', 'apply_patch', 'group:automation', 'group:messaging', 'group:nodes', 'group:ui', 'group:plugins',
    'sessions_send', 'sessions_spawn', 'subagents', 'image_generate', 'music_generate', 'video_generate'],
  write: ['group:runtime', 'group:automation', 'group:messaging', 'group:nodes', 'group:ui', 'group:plugins', 'sessions_send', 'sessions_spawn', 'subagents',
    'image_generate', 'music_generate', 'video_generate'],
};
function openclawLimits(perm) {
  const main = openclawConfigPath();
  const own = jsonFile(main)?.tools?.deny;  // JSON5 configs: we add ours, theirs still apply through the include
  const dir = join(tmpdir(), 'spectrahub-openclaw');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${perm}.json`);
  const tools = { deny: [...new Set([...(Array.isArray(own) ? own : []), ...OPENCLAW_DENY[perm]])], ...(perm === 'write' ? { fs: { workspaceOnly: true } } : {}) };
  writeFileSync(file, JSON.stringify({ $include: main, tools }), { mode: 0o600 });
  // the embedded run needs the provider keys the gateway would have: OpenClaw's own .env
  return { ...readEnvFile(join(openclawHome(), '.env')), OPENCLAW_CONFIG_PATH: file, OPENCLAW_INCLUDE_ROOTS: dirname(main) };
}

// The owner's answer to a prompt, as Claude Code expects it back on stdin. "Always" keeps the
// suggested rules for this session only: SpectraHub never writes the agent's settings.
claude.answer = (ask, decision, answers) => {
  let response;
  if (decision === 'deny') response = { behavior: 'deny', message: 'Użytkownik odmówił w SpectraHub.' };
  else {
    response = { behavior: 'allow', updatedInput: answers ? { ...ask.input, answers } : ask.input };
    if (decision === 'always') {
      const perms = ask.suggestions.filter((x) => ['addRules', 'addDirectories', 'setMode'].includes(x.type)).map((x) => ({ ...x, destination: 'session' }));
      if (perms.length) response.updatedPermissions = perms;
    }
  }
  return { type: 'control_response', response: { subtype: 'success', request_id: ask.id, response } };
};

const ADAPTERS = { claude, codex, openclaw, dsh };
export { ADAPTERS as adapters };  // for tests

// Whether Claude Code already keeps a conversation under this id (~/.claude/projects/<folder>/<id>.jsonl).
export function claudeHas(ref) {
  const root = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');
  try { return Boolean(ref) && readdirSync(root).some((d) => existsSync(join(root, d, `${ref}.jsonl`))); } catch { return false; }
}

export function newRef(id) {
  return id === 'codex' || id === 'dsh' ? null : id === 'openclaw' ? `spectrahub-${randomUUID()}` : randomUUID();
}

// Runs one turn. `emit` receives {type: text|step|step-end|usage|limits|error|ref|done}; the returned function stops it.
export function turn(rt, options, emit) {
  // Advisory sessions never inherit a wider permission chosen elsewhere in the app.
  // This is a runtime restriction, not operating-system isolation from its own account.
  if (options.advisory) options = { ...options, perm: 'read' };
  const { ref, started, prompt, cwd, model, effort, images, perm = 'read', ownCwd = false, env: extra = {}, drop = [] } = options;
  // OpenClaw's gateway exposes native exec prompts but does not constrain every plugin/tool
  // per invocation. The owner explicitly authorizes the selected scope for ONE turn first.
  // Older Claude builds likewise have no native prompt protocol. Denial never starts a process.
  if ((rt.id === 'openclaw' || (rt.id === 'claude' && rt.asks === false)) && perm !== 'read' && !options.scopeApproved) {
    const id = `scope:${randomUUID()}`;
    let inner = null, settled = false;
    const stop = () => { if (inner) inner(); else if (!settled) { settled = true; emit({ type: 'error', s: 'przerwano przed zgodą' }); emit({ type: 'done' }); } };
    stop.answer = (answerId, decision, answers) => {
      if (inner) return inner.answer?.(answerId, decision, answers) ?? false;
      if (settled || answerId !== id || !['allow', 'deny'].includes(decision)) return false;
      settled = true;
      if (decision === 'deny') { emit({ type: 'error', s: 'Użytkownik odmówił uruchomienia tury.' }); emit({ type: 'done' }); }
      else inner = turn(rt, { ...options, scopeApproved: true }, emit);
      return true;
    };
    queueMicrotask(() => { if (!settled) emit({ type: 'ask', id, kind: 'permission', tool: rt.label ?? rt.id,
      title: perm === 'full' ? 'Uruchomić turę z pełnym dostępem?' : 'Zezwolić na zapis w katalogu pracy?',
      description: `Zgoda dotyczy jednej tury w ${cwd}. ${perm === 'full' ? 'Runtime może wykonywać polecenia, zmieniać pliki i używać swoich integracji.' : 'Runtime może zmieniać pliki w katalogu pracy; powłoka pozostaje wyłączona.'} ${rt.id === 'openclaw' ? 'Pytania o polecenia, które zgłosi brama OpenClaw, pojawią się osobno. Pozostałe narzędzia nie mają osobnych potwierdzeń w tym trybie.' : 'Ta wersja Claude Code nie obsługuje osobnych pytań o narzędzia.'}`,
      path: cwd, always: false, scope: 'turn' }); });
    return stop;
  }
  if (rt.id === 'codex' || rt.id === 'dsh' || (rt.id === 'openclaw' && perm === 'full')) {
    let inner = null, cancelled = false, ended = false;
    const nativeEmit = (e) => { if (ended) return; if (e.type === 'done') ended = true; emit(e); };
    const stop = () => { cancelled = true; if (inner) inner(); else { nativeEmit({ type: 'error', s: 'przerwano' }); nativeEmit({ type: 'done' }); } };
    stop.answer = (...args) => inner?.answer?.(...args) ?? false;
    const launch = async () => {
      const l = rt.launch;
      const env = { ...process.env, ...(l?.envFile ? readEnvFile(l.envFile) : {}), ...(l?.env ?? {}), ...extra, NO_COLOR: '1' };
      if (rt.path && !l) env.PATH = [dirname(rt.path), env.PATH].filter(Boolean).join(delimiter);
      for (const k of drop) delete env[k];
      let args, patch, nativeModel = model;
      if (rt.id === 'codex') args = ['app-server', '--listen', 'stdio://', '-c', 'approval_policy="on-request"', '-c', 'sandbox_mode="read-only"'];
      else if (rt.id === 'openclaw') args = ['acp'];
      else {
        const profile = await dshProfile(rt);
        if (cancelled) return;
        patch = dshAcpPatch(profile, model, effort, perm);
        if (model && profile.provider) nativeModel = JSON.stringify([profile.provider, model]);
        // Changes start outside the sandbox and must pass the runtime's native approval seam.
        env.DSH_PERMISSION_MODE = 'read-only';
        args = ['--profile', 'headless', '--patch', patch];
      }
      if (cancelled) { if (patch) rmSync(patch, { force: true }); return; }
      inner = rpcTurn({ bin: l?.node ?? rt.path, args: l ? [l.script, ...args] : args, cwd: ownCwd ? cwd : l?.cwd ?? cwd, env,
        protocol: rt.id === 'codex' ? 'codex' : 'acp', ref, started, prompt, model: nativeModel, effort, images, perm,
        agent: rt.id === 'openclaw' ? rt.agent : null,
        configure: rt.id === 'openclaw' ? () => new Promise((resolve, reject) => {
          // A dedicated gateway session, never the agent's default/global settings. The bridge
          // relays every exec request and no persistent allowlist grant is ever sent back.
          const params = { key: `agent:${rt.agent}:${ref}`, execAsk: 'always', execSecurity: 'allowlist', ...(model ? { model } : {}) };
          execFile(rt.path, ['gateway', 'call', 'sessions.patch', '--json', '--params', JSON.stringify(params)], { env, timeout: 15000, maxBuffer: 1024 * 1024 }, (err) => {
            if (err) reject(new Error('OpenClaw: nie udało się ustawić obowiązkowych pytań o polecenia. Tura nie została uruchomiona.'));
            else resolve();
          });
        }) : null,
        cleanup: () => { if (patch) rmSync(patch, { force: true }); } }, nativeEmit);
    };
    launch().catch((e) => { nativeEmit({ type: 'error', s: String(e.message ?? e) }); nativeEmit({ type: 'done' }); });
    return stop;
  }
  return legacyTurn(rt, options, emit);
}

function legacyTurn(rt, { ref, started, prompt, cwd, model, effort, images, perm, advisory = false, ownCwd = false, env: extra = {}, drop = [] }, emit) {
  const a = Object.create(ADAPTERS[rt.id]);  // per-run state (e.g. dsh: did text already stream)
  let file = null;
  if (rt.id === 'openclaw') {
    const dir = join(tmpdir(), 'spectrahub-msg');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    file = join(dir, `${randomUUID()}.txt`);
    writeFileSync(file, prompt, { mode: 0o600 });
  }
  const l = rt.launch;
  const env = { ...process.env, ...(l?.envFile ? readEnvFile(l.envFile) : {}), ...(l?.env ?? {}), ...extra, NO_COLOR: '1' };
  if (rt.path && !l) env.PATH = [dirname(rt.path), env.PATH].filter(Boolean).join(delimiter);  // found outside PATH: its node may sit next to it
  if (rt.id === 'dsh') env.DSH_PERMISSION_MODE = { read: 'read-only', write: 'workspace-write', full: 'danger-full-access' }[perm] ?? 'workspace-write';
  if (rt.id === 'openclaw' && (perm === 'read' || perm === 'write')) Object.assign(env, openclawLimits(perm));
  for (const k of drop) delete env[k];  // e.g. an API key that must not override the subscription
  const opts = { agent: rt.agent, file, model, effort, images, perm, advisory, asks: rt.asks, patch: rt.id === 'dsh' && (model || effort) ? dshPatch(rt, model, effort) : null };
  const [bin, args] = l ? [l.node, [l.script, ...a.argv(ref, started, opts)]] : [rt.path, a.argv(ref, started, opts)];
  const child = spawn(bin, args, {
    cwd: ownCwd ? cwd : l?.cwd ?? cwd, env, stdio: [a.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });
  // Prompts the agent sends while it works wait here for the owner's answer.
  const asks = new Map();
  const write = (obj) => { if (!child.stdin.destroyed && child.stdin.writable) child.stdin.write(JSON.stringify(obj) + '\n'); };
  const jsonIn = a.stdin === 'json' && rt.asks !== false;
  if (jsonIn) write({ type: 'user', message: { role: 'user', content: prompt } });
  else if (a.stdin) child.stdin.end(prompt);

  // Live steps from a file the agent appends to while it works (OpenClaw).
  let tailTimer = null;
  let poll = () => {};
  if (a.tailFile) {
    const path = a.tailFile(ref, rt);
    let offset = existsSync(path) ? statSync(path).size : 0;
    let rest = '';
    poll = () => {
      if (!existsSync(path)) return;
      const size = statSync(path).size;
      if (size <= offset) return;
      const fd = openSync(path, 'r');
      const chunk = Buffer.alloc(size - offset);
      readSync(fd, chunk, 0, chunk.length, offset);
      closeSync(fd);
      offset = size;
      const lines = (rest + chunk.toString('utf8')).split('\n');
      rest = lines.pop();
      for (const line of lines) {
        try { a.tail(JSON.parse(line), (e) => emit(e)); } catch { /* partial or foreign line */ }
      }
    };
    tailTimer = setInterval(poll, 400);
  }
  let done = false;
  let settled = false;  // a whole-document answer already handed over
  let buf = '';
  let all = '';
  let err = '';
  const finish = (e) => { if (!done) { done = true; emit(e); } };
  const relay = (e) => {
    if (e.type === 'control-reply') return write({ type: 'control_response', response: { subtype: 'error', request_id: e.id, error: e.error } });
    if (e.type === 'ask') {
      // A tool request cannot widen an advisory turn, even if an older peer ignores --tools.
      if (advisory && e.kind !== 'question') return write(a.answer(e, 'deny'));
      asks.set(e.id, e); const { input: _i, suggestions: _s, ...shown } = e; return emit(shown);
    }
    if (e.type === 'done') { if (jsonIn) child.stdin.end(); return finish(e); }
    return emit(e);
  };
  child.stdout.on('data', (chunk) => {
    const s = chunk.toString('utf8');
    if (!a.line) {
      all += s;
      if (!settled && a.complete?.(all)) {
        settled = true;
        if (tailTimer) { clearInterval(tailTimer); tailTimer = null; poll(); }
        a.whole(all, relay);
        setTimeout(() => { if (child.exitCode == null && child.signalCode == null) child.kill('SIGTERM'); }, 3000);  // done, but held open
      }
      return;
    }
    buf += s;
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const l = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!l) continue;
      try { a.line(JSON.parse(l), relay); } catch { /* not JSON: progress noise */ }
    }
  });
  child.stderr.on('data', (c) => { err = (err + c.toString('utf8')).slice(-2000); });
  child.on('error', (e) => { emit({ type: 'error', s: e.message }); finish({ type: 'done' }); });
  child.on('close', (code, signal) => {
    if (tailTimer) { clearInterval(tailTimer); poll(); }
    if (file) rmSync(file, { force: true });
    if (a.whole && !settled) a.whole(all, relay);
    if (!done) {
      if (signal) emit({ type: 'error', s: 'przerwano' });
      else if (code) emit({ type: 'error', s: short(err.trim().split('\n').pop() || `kod wyjścia ${code}`, 400) });
      finish({ type: 'done' });
    }
  });
  const stop = () => { if (!done) child.kill('SIGTERM'); };
  // answer(id, 'allow' | 'always' | 'deny', answers?) → false when nothing waits under that id
  stop.answer = (id, decision, answers) => {
    const ask = asks.get(id);
    if (!ask || done || !a.answer) return false;
    asks.delete(id);
    write(a.answer(ask, decision, answers));
    return true;
  };
  return stop;
}
