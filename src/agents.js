// Agent runtimes: find what is installed, run one turn, normalise the output into a few events.
// Every adapter keeps the runtime's own session, so the next turn continues the same conversation.
import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { accessSync, closeSync, constants, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { basename, delimiter, dirname, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

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

function which(bin) {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
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
function readEnvFile(file) {
  const env = {};
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=\s*(.*)\s*$/.exec(line);
      if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch { /* unreadable: the agent starts without it */ }
  return env;
}

// OpenClaw's default agent, from its own config (instant), else from its CLI (slow: it boots the app).
async function openclawAgent(path) {
  try {
    const home = process.env.OPENCLAW_HOME ?? join(homedir(), '.openclaw');
    const list = JSON.parse(readFileSync(join(home, 'openclaw.json'), 'utf8')).agents?.list ?? [];
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
    if (r.id === 'openclaw') {
      out.agent = await openclawAgent(path);
      if (!out.agent) { out.ready = false; out.note = 'nie podał swoich agentów'; }
    }
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

async function claudeModels(rt) {
  const settings = jsonFile(join(homedir(), '.claude', 'settings.json')) ?? {};
  return {
    configurable: true,
    models: [
      { id: '', label: 'domyślny agenta' },
      { id: 'fable', label: 'Fable', note: 'najnowszy Fable' },
      { id: 'opus', label: 'Opus', note: 'najnowszy Opus' },
      { id: 'sonnet', label: 'Sonnet', note: 'najnowszy Sonnet' },
      { id: 'haiku', label: 'Haiku', note: 'najnowszy Haiku' },
    ].map((m) => ({ ...m, efforts: CLAUDE_EFFORTS })),
    defaultModel: settings.model ?? null,
    defaultEffort: settings.effortLevel ?? null,
    effortLabel: 'effort',
  };
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

async function openclawModels(rt) {
  const out = await run(rt.path, ['models', 'list'], 45000);
  const rows = out.split('\n').slice(1).map((l) => l.trim().split(/\s{2,}/)).filter((c) => c.length >= 2 && c[0].includes('/'));
  const models = rows.map((c) => {
    const tags = c[c.length - 1] ?? '';
    return { id: c[0], label: c[0], configured: /configured|default/.test(tags), isDefault: /\bdefault\b/.test(tags),
      contextWindow: /^(\d+)k$/.test(c[2] ?? '') ? Number(c[2].slice(0, -1)) * 1000 : null, efforts: OPENCLAW_THINKING };
  }).sort((a, b) => Number(b.configured) - Number(a.configured));
  return {
    configurable: true,
    models: [{ id: '', label: 'domyślny agenta', efforts: OPENCLAW_THINKING }, ...models],
    defaultModel: models.find((m) => m.isDefault)?.id ?? null,
    defaultEffort: null,
    effortLabel: 'thinking',
  };
}

// Runtimes that only take their model from their own configuration say so.
const MODEL_SOURCES = { claude: claudeModels, codex: codexModels, openclaw: openclawModels };

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

// Claude Code: text deltas, every tool call with its result, thinking, todo list and cost.
// SpectraHub only opens a window to the agent: its own settings, instructions and hooks apply.
const claude = {
  argv(ref, started, o = {}) {
    return ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--permission-mode', 'acceptEdits',
      ...(o.model ? ['--model', o.model] : []), ...(o.effort ? ['--effort', o.effort] : []),
      ...(started ? ['--resume', ref] : ['--session-id', ref]),
      '--allowedTools', 'Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite'];
  },
  stdin: true,
  line(d, emit) {
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
function findRollout(thread) {
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
  const f = thread && findRollout(thread);
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
  argv(ref, started, o = {}) {
    const images = (o.images ?? []).flatMap((f) => ['-i', f]);  // before the other flags: -i takes several values
    const common = [...images, '--json', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check',
      ...(o.model ? ['-m', o.model] : []), ...(o.effort ? ['-c', `model_reasoning_effort="${o.effort}"`] : [])];
    return started ? ['exec', 'resume', ...common, ref, '-'] : ['exec', ...common, '-'];
  },
  stdin: true,
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
      emit({ type: 'usage', input: d.usage?.input_tokens ?? 0, output: (d.usage?.output_tokens ?? 0) + (d.usage?.reasoning_output_tokens ?? 0),
        context: (d.usage?.input_tokens ?? 0) + (d.usage?.output_tokens ?? 0) });
      emit({ type: 'limits-codex' });  // read from the rollout file once the turn is written
      emit({ type: 'done' });
    }
  },
};

// DeepSeek Harness: thinking, tool calls with results and tokens per step, from the headless profile.
const dsh = {
  argv(ref, started) {
    return ['--profile', 'headless', '--json', ...(started ? ['--session-id', ref] : []), '-'];
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
  argv(ref, _started, { agent, file, model, effort }) {
    return ['agent', '--agent', agent, '--session-id', ref, '--message-file', file, '--json', '--timeout', '600',
      ...(model ? ['--model', model] : []), ...(effort ? ['--thinking', effort] : [])];
  },
  stdin: false,
  tailFile(ref, rt) {
    const home = process.env.OPENCLAW_HOME ?? join(homedir(), '.openclaw');
    return join(home, 'agents', rt.agent, 'sessions', `${ref}.jsonl`);
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
  whole(text, emit) {
    let d;
    try { d = JSON.parse(text); } catch { return emit({ type: 'error', s: short(text.trim() || 'brak odpowiedzi', 400) }); }
    for (const p of d.result?.payloads ?? []) {
      if (p.text) emit({ type: 'text', s: p.text.trimEnd(), block: true });
      // files the agent hands over (mediaUrl / mediaUrls): local ones become file cards in the chat
      for (const m of [p.mediaUrl, ...(Array.isArray(p.mediaUrls) ? p.mediaUrls : [])].filter(Boolean)) {
        const path = String(m).startsWith('file://') ? decodeURIComponent(String(m).slice(7)) : String(m);
        if (path.startsWith('/')) emit({ type: 'file', path });
      }
    }
    const m = d.result?.meta?.agentMeta ?? {};
    const u = m.usage;
    if (u) {
      emit({ type: 'usage', input: (u.input ?? 0) + (u.cacheRead ?? 0), output: u.output ?? 0, ms: d.result?.meta?.durationMs ?? null,
        model: m.model ? `${m.provider ? m.provider + '/' : ''}${m.model}` : null, context: m.promptTokens ?? null, contextWindow: m.contextTokens ?? null });
    }
    if (d.status !== 'ok') emit({ type: 'error', s: String(d.summary ?? d.status) });
    emit({ type: 'done' });
  },
};

const ADAPTERS = { claude, codex, openclaw, dsh };
export { ADAPTERS as adapters };  // for tests

export function newRef(id) {
  return id === 'codex' || id === 'dsh' ? null : id === 'openclaw' ? `spectrahub-${randomUUID()}` : randomUUID();
}

// Runs one turn. `emit` receives {type: text|step|step-end|usage|limits|error|ref|done}; the returned function stops it.
export function turn(rt, { ref, started, prompt, cwd, model, effort, images, env: extra = {} }, emit) {
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
  const opts = { agent: rt.agent, file, model, effort, images };
  const [bin, args] = l ? [l.node, [l.script, ...a.argv(ref, started, opts)]] : [rt.path, a.argv(ref, started, opts)];
  const child = spawn(bin, args, {
    cwd: l?.cwd ?? cwd, env, stdio: [a.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });
  if (a.stdin) child.stdin.end(prompt);

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
  let buf = '';
  let all = '';
  let err = '';
  const finish = (e) => { if (!done) { done = true; emit(e); } };
  const relay = (e) => (e.type === 'done' ? finish(e) : emit(e));
  child.stdout.on('data', (chunk) => {
    const s = chunk.toString('utf8');
    if (!a.line) { all += s; return; }
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
    if (a.whole) a.whole(all, relay);
    if (!done) {
      if (signal) emit({ type: 'error', s: 'przerwano' });
      else if (code) emit({ type: 'error', s: short(err.trim().split('\n').pop() || `kod wyjścia ${code}`, 400) });
      finish({ type: 'done' });
    }
  });
  return () => { if (!done) child.kill('SIGTERM'); };
}
