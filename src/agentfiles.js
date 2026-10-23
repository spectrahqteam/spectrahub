// Each agent's own files: what it reads to know who it is, how it works and what it remembers.
// Found where each runtime keeps them — in every user's home on the server, at the defaults the
// runtime uses and at the places its config points to, in the projects it worked in — plus the
// notes kept next to it and the files its instructions refer to (`@file` imports, links, paths).
// They can be read and edited; a save keeps the previous version in ~/.spectrahub/backups and
// refuses to overwrite a newer change.
import { copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { readEnvFile, scan, userHomes } from './agents.js';
import { FsError, hash, isSecret } from './fsview.js';

const json = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const real = (p) => { try { return realpathSync(p); } catch { return p; } };
function files(dir, test = () => true, depth = 1) {
  const out = [];
  const walk = (d, left) => {
    let names = [];
    try { names = readdirSync(d); } catch { return; }
    for (const n of names.sort()) {
      if (n === 'node_modules' || n === '.git') continue;
      const p = join(d, n);
      if (isDir(p)) { if (left > 0 && !n.startsWith('.')) walk(p, left - 1); }  // hidden folders: trash, caches, sync state
      else if (isFile(p) && test(n, p)) out.push(p);
      if (out.length > 200) return;
    }
  };
  walk(dir, depth - 1);
  return out;
}
const md = (n) => /\.md$/i.test(n);
const skill = (n) => n === 'SKILL.md';
// The notes people keep next to an agent: identity and working files at the top of its folder.
const IDENTITY = /^(AGENTS|AGENTS\.override|CLAUDE|CLAUDE\.local|GEMINI|SOUL|IDENTITY|USER|TOOLS|HEARTBEAT|BOOT|BOOTSTRAP|MEMORY|PERSONA|RULES|INSTRUCTIONS)\.md$/i;
const tilde = (p, home) => (typeof p === 'string' ? (p === '~' ? home : p.startsWith('~/') ? join(home, p.slice(2)) : p) : null);

// Every home on the server; the one SpectraHub runs as also honours the runtimes' env overrides.
function homes() {
  const own = real(homedir());
  return userHomes().map((h) => ({ h, own: real(h) === own, user: basename(h) }));
}

function claudeSpots({ h, own }) {
  const home = own ? process.env.CLAUDE_CONFIG_DIR ?? join(h, '.claude') : join(h, '.claude');
  if (!isDir(home) && !isFile(join(h, '.claude.json'))) return [];
  const spots = [
    ['identity', join(home, 'CLAUDE.md'), 'instrukcje dla każdej sesji'],
    ['config', join(home, 'settings.json'), 'ustawienia: model, uprawnienia, hooki'],
    ['config', join(home, 'settings.local.json'), 'ustawienia lokalne'],
    ['config', join(h, '.claude.json'), 'stan i serwery MCP'],
    ['config', join(home, 'keybindings.json'), 'skróty klawiszowe'],
    ['secret', join(home, '.credentials.json'), 'logowanie (subskrypcja)'],
  ];
  for (const f of files(join(home, 'agents'), md, 2)) spots.push(['skills', f, 'subagent']);
  for (const f of files(join(home, 'commands'), md, 3)) spots.push(['skills', f, 'komenda']);
  for (const f of files(join(home, 'skills'), skill, 4)) spots.push(['skills', f, 'skill']);
  for (const f of files(join(home, 'output-styles'), md, 1)) spots.push(['skills', f, 'styl odpowiedzi']);
  for (const f of files(join(home, 'projects'), md, 3).filter((x) => x.includes('/memory/'))) spots.push(['memory', f, 'pamięć projektu']);
  for (const dir of Object.keys(json(join(h, '.claude.json'))?.projects ?? {})) {
    for (const [name, label] of [['CLAUDE.md', 'instrukcje projektu'], ['CLAUDE.local.md', 'instrukcje prywatne projektu'], ['.claude/CLAUDE.md', 'instrukcje projektu'],
      ['.claude/settings.json', 'ustawienia projektu'], ['.claude/settings.local.json', 'ustawienia lokalne projektu'], ['.mcp.json', 'serwery MCP projektu']]) spots.push(['projects', join(dir, name), label, dir]);
    for (const f of files(join(dir, '.claude', 'agents'), md, 1)) spots.push(['projects', f, 'subagent projektu', dir]);
    for (const f of files(join(dir, '.claude', 'commands'), md, 2)) spots.push(['projects', f, 'komenda projektu', dir]);
    for (const f of files(join(dir, '.claude', 'skills'), skill, 3)) spots.push(['projects', f, 'skill projektu', dir]);
  }
  return spots;
}

function codexSpots({ h, own }) {
  const home = own ? process.env.CODEX_HOME ?? join(h, '.codex') : join(h, '.codex');
  if (!isDir(home)) return [];
  const spots = [
    ['identity', join(home, 'AGENTS.md'), 'instrukcje dla każdej sesji'],
    ['identity', join(home, 'AGENTS.override.md'), 'instrukcje nadrzędne'],
    ['config', join(home, 'config.toml'), 'ustawienia: model, sandbox, projekty, MCP'],
    ['config', join(home, 'hooks.json'), 'hooki'],
    ['secret', join(home, 'auth.json'), 'logowanie (ChatGPT albo klucz)'],
    ['secret', join(home, '.credentials.json'), 'dane logowania'],
  ];
  for (const f of files(join(home, 'prompts'), md, 2)) spots.push(['skills', f, 'prompt']);
  for (const f of files(join(home, 'skills'), skill, 4)) spots.push(['skills', f, 'skill']);
  for (const f of files(join(h, '.agents', 'skills'), skill, 3)) spots.push(['skills', f, 'skill (wspólny)']);
  for (const f of files(join(home, 'rules'), () => true, 1)) spots.push(['config', f, 'reguły poleceń']);
  for (const f of files(join(home, 'hooks'), () => true, 1)) spots.push(['config', f, 'hook']);
  for (const f of files(join(home, 'memories'), md, 2)) spots.push(['memory', f, 'pamięć']);
  let toml = '';
  try { toml = readFileSync(join(home, 'config.toml'), 'utf8'); } catch { /* none */ }
  for (const dir of [...toml.matchAll(/^\[projects\."([^"]+)"\]/gm)].map((m) => m[1]).filter((d) => d !== '/')) {
    for (const [name, label] of [['AGENTS.md', 'instrukcje projektu'], ['AGENTS.override.md', 'instrukcje nadrzędne projektu'], ['.codex/config.toml', 'ustawienia projektu']]) spots.push(['projects', join(dir, name), label, dir]);
    for (const d of ['.codex/skills', '.agents/skills']) for (const f of files(join(dir, d), skill, 3)) spots.push(['projects', f, 'skill projektu', dir]);
  }
  return spots;
}

// OpenClaw: every state folder (~/.openclaw and ~/.openclaw-<profile>), its config, and every
// workspace — the ones the config names and the defaults OpenClaw uses when it names none.
function openclawSpots({ h, own }) {
  const states = new Set();
  if (own && process.env.OPENCLAW_HOME) states.add(process.env.OPENCLAW_HOME);
  states.add(join(h, '.openclaw'));
  try { for (const n of readdirSync(h)) if (/^\.openclaw-[\w.-]+$/.test(n)) states.add(join(h, n)); } catch { /* unreadable home */ }
  const spots = [];
  for (const state of [...states].filter(isDir)) {
    const conf = own && process.env.OPENCLAW_CONFIG_PATH && state === (process.env.OPENCLAW_HOME ?? join(h, '.openclaw')) ? process.env.OPENCLAW_CONFIG_PATH : join(state, 'openclaw.json');
    const cfg = json(conf) ?? {};
    spots.push(['config', conf, 'konfiguracja: agenci, modele, narzędzia, kanały'], ['config', join(state, 'exec-approvals.json'), 'zgody na polecenia'], ['secret', join(state, '.env'), 'klucze dostawców']);
    for (const f of files(join(state, 'skills'), skill, 3)) spots.push(['skills', f, 'skill']);
    const workspaces = new Map();
    const add = (p, who) => { const w = tilde(p, h); if (w && isDir(w) && !workspaces.has(real(w))) workspaces.set(real(w), [w, who]); };
    add(cfg.agents?.defaults?.workspace, 'domyślny workspace');
    if (own && process.env.OPENCLAW_WORKSPACE_DIR) add(process.env.OPENCLAW_WORKSPACE_DIR, 'workspace');
    add(join(state, 'workspace'), cfg.agents?.defaults?.workspace ? 'stary domyślny workspace (konfiguracja wskazuje inny)' : 'domyślny workspace');
    for (const a of cfg.agents?.list ?? []) {
      add(a.workspace ?? join(state, `workspace-${a.id}`), `agent ${a.name ?? a.id}`);
      for (const [n, g, l] of [['models.json', 'config', 'modele agenta'], ['auth-profiles.json', 'secret', 'profile logowania']]) spots.push([g, join(state, 'agents', a.id, 'agent', n), `${l} ${a.id}`]);
    }
    try { for (const n of readdirSync(state)) if (/^workspace-[\w.-]+$/.test(n)) add(join(state, n), n.replace(/^workspace-/, 'workspace ')); } catch { /* none */ }
    if (isFile(join(h, 'openclaw', 'AGENTS.md')) || isFile(join(h, 'openclaw', 'SOUL.md'))) add(join(h, 'openclaw'), 'stary workspace ~/openclaw');
    for (const [, [ws, who]] of workspaces) {
      for (const f of files(ws, (n) => IDENTITY.test(n), 1)) spots.push(['identity', f, who]);
      for (const f of files(ws, (n) => md(n) && !IDENTITY.test(n), 1)) spots.push(['workspace', f, who, ws]);
      const memory = files(join(ws, 'memory'), md, 2).map((f) => [f, statSync(f).mtimeMs]).sort((a, b) => b[1] - a[1]).slice(0, 30);
      for (const [f] of memory) spots.push(['memory', f, `pamięć · ${who}`]);
      for (const f of files(join(ws, 'skills'), skill, 3)) spots.push(['skills', f, `skill · ${who}`]);
    }
  }
  return spots;
}

// DeepSeek Harness: its home, the folder its service works in, and the folders its sessions
// worked in (it keeps them in its session store).
function dshSpots({ h, own }, rt) {
  const env = own ? { ...(rt?.launch?.envFile ? readEnvFile(rt.launch.envFile) : {}), ...(rt?.launch?.env ?? {}) } : {};
  const home = own ? env.DSH_HOME ?? process.env.DSH_HOME ?? join(h, '.dsh') : join(h, '.dsh');
  const spots = [];
  if (own && rt?.launch?.envFile) spots.push(['secret', rt.launch.envFile, 'klucze i ustawienia usługi']);
  if (!isDir(home) && !(own && rt?.launch?.cwd)) return spots;
  for (const n of ['settings.yaml', 'settings.yml', 'settings.json', 'config.json', 'settings.yaml.imported']) spots.push(['config', join(home, n), 'ustawienia']);
  spots.push(['identity', join(home, 'AGENTS.md'), 'instrukcje dla każdej sesji']);
  for (const n of ['.env', '.credentials.yaml']) spots.push(['secret', join(home, n), 'dane logowania']);
  for (const f of files(join(home, 'profiles'), (n) => /^cordis(\.patch)?\.ya?ml$/.test(n), 2)) spots.push(['config', f, `profil ${basename(dirname(f))}`]);
  for (const f of files(join(home, 'skills'), skill, 3)) spots.push(['skills', f, 'skill']);
  for (const f of files(join(h, '.agents', 'skills'), skill, 3)) spots.push(['skills', f, 'skill (wspólny)']);
  const folders = new Map();
  if (own && rt?.launch?.cwd) folders.set(rt.launch.cwd, 'folder pracy');
  let n = 0;
  for (const f of files(join(home, 'storages', 'session_projcache', 'sessions'), (x) => x.endsWith('.json'), 1)) {
    if (n++ > 300) break;
    const wd = json(f)?.record?.rows?.workingDirectory?.val;
    const path = typeof wd === 'string' ? wd : wd?.path ?? wd?.cwd;
    if (path && !folders.has(path) && folders.size < 15) folders.set(path, 'folder sesji');
  }
  for (const [cwd, who] of folders) {
    for (const f of files(cwd, (x) => IDENTITY.test(x), 1)) spots.push(['identity', f, who]);
    spots.push(['config', join(cwd, '.dsh-project'), 'projekt'], ['identity', join(cwd, '.dsh', 'AGENTS.md'), 'instrukcje projektu']);
    if (who === 'folder pracy') for (const f of files(cwd, (x) => md(x) && !IDENTITY.test(x), 1)) spots.push(['workspace', f, who, cwd]);
    for (const d of ['.dsh/skills', '.agents/skills']) for (const f of files(join(cwd, d), skill, 3)) spots.push(['skills', f, 'skill projektu']);
  }
  return spots;
}

const SOURCES = { claude: claudeSpots, codex: codexSpots, openclaw: openclawSpots, dsh: dshSpots };
export const GROUPS = ['identity', 'config', 'skills', 'memory', 'workspace', 'linked', 'projects', 'secret'];

// The files an instruction file points at: Claude's `@path` imports, Markdown links and
// `paths` in backticks, relative to the file — that is how people wire in files of their own.
const REF = /(?:^|\s)@((?:~|\.{1,2})?\/?[\w.\-/]+\.(?:md|txt|json|ya?ml|toml))|\]\(((?!https?:|mailto:|#)[^)\s#]+\.(?:md|txt|json|ya?ml|toml))(?:#[^)]*)?\)|`((?:~|\.{1,2}|\/)?[\w.\-/]*[\w-]\.(?:md|json|ya?ml|toml))`/gm;
function references(path, text, home) {
  const base = dirname(real(path));
  const out = new Set();
  for (const m of text.matchAll(REF)) {
    const ref = m[1] ?? m[2] ?? m[3];
    if (!ref || ref.length > 300) continue;
    const p = ref.startsWith('~') ? tilde(ref, home) : isAbsolute(ref) ? ref : resolve(base, ref);
    if (isFile(p)) out.add(p);
    if (out.size >= 20) break;
  }
  return [...out];
}

const lastScan = new Map();  // agent -> { at, paths: Set } — what may be edited

// Every file that exists, with what it is for; links show the file they point to.
export async function agentFiles(id) {
  const rt = (await scan()).find((r) => r.id === id);
  if (!SOURCES[id]) throw new FsError(404, 'nie ma takiego agenta');
  const seen = new Set();
  const out = [];
  const put = (group, path, label, project, user) => {
    let l;
    try { l = lstatSync(path); } catch { return null; }
    const target = real(path);
    if (seen.has(target) || !isFile(target)) return null;
    seen.add(target);
    const st = statSync(target);
    const secret = group === 'secret' || isSecret(path) || isSecret(target);
    const name = basename(path) === 'SKILL.md' ? `${basename(dirname(path))}/SKILL.md` : basename(path);  // skills differ by their folder
    const f = { group: secret ? 'secret' : group, path, target: l.isSymbolicLink() ? target : null, name, label: user ? `${label} · użytkownik ${user}` : label,
      project: project ?? null, size: st.size, mtime: st.mtime.toISOString(), secret, editable: !secret && st.size <= 1024 * 1024 };
    out.push(f);
    return f;
  };
  for (const home of homes()) {
    for (const [group, path, label, project] of SOURCES[id](home, rt)) put(group, path, label, project, home.own ? null : home.user);
  }
  for (const f of out.filter((x) => ['identity', 'projects'].includes(x.group) && /\.md$/i.test(x.name) && x.size < 300_000)) {
    let text = '';
    try { text = readFileSync(f.path, 'utf8'); } catch { continue; }
    for (const p of references(f.path, text, homedir())) put('linked', p, `wskazany w ${f.name}`, null, null);
  }
  if (!out.length && !rt?.installed) throw new FsError(404, 'tego agenta nie ma na serwerze');
  lastScan.set(id, { at: Date.now(), paths: new Set(out.filter((f) => f.editable).map((f) => f.path)) });
  return { agent: { id, label: rt?.label ?? id, version: rt?.version ?? null, name: rt?.agent ?? null, home: rt?.launch?.cwd ?? null }, files: out };
}

// The earlier versions of a file kept by the saves, newest first: when, how big, and where.
export function history(dir, path) {
  const key = `__${real(path).replace(/^\//, '').replace(/\//g, '__')}`;
  const out = [];
  let days = [];
  try { days = readdirSync(join(dir, 'backups')); } catch { return out; }
  for (const day of days) {
    let names = [];
    try { names = readdirSync(join(dir, 'backups', day)); } catch { continue; }
    for (const n of names) {
      const m = /^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z(__.*)$/.exec(n);
      if (!m || m[6] !== key) continue;
      const p = join(dir, 'backups', day, n);
      out.push({ path: p, at: `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`, size: statSync(p).size });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

// Saving: only a file the scanner found, only if nobody changed it since it was opened (`base`),
// and JSON that was valid stays valid. The old version goes to the backups first.
export async function saveAgentFile(dir, id, { path, text, base }) {
  let allowed = lastScan.get(id);
  if (!allowed || Date.now() - allowed.at > 10 * 60_000) { await agentFiles(id); allowed = lastScan.get(id); }
  if (!allowed.paths.has(path)) throw new FsError(403, 'tego pliku nie można tu edytować');
  if (typeof text !== 'string' || text.length > 1024 * 1024) throw new FsError(400, 'zła treść');
  const target = realpathSync(path);
  const before = readFileSync(target);
  if (base && hash(before) !== base) throw new FsError(409, 'plik zmienił się w międzyczasie — otwórz go ponownie');
  if (/\.json$/i.test(target)) {
    let wasJson = true;
    try { JSON.parse(before.toString('utf8')); } catch { wasJson = false; }
    if (wasJson) {
      try { JSON.parse(text); } catch (e) { throw new FsError(400, `to nie jest poprawny JSON: ${e.message}`); }
    }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backups = join(dir, 'backups', stamp.slice(0, 10));
  mkdirSync(backups, { recursive: true, mode: 0o700 });
  const backup = join(backups, `${stamp}__${target.replace(/^\//, '').replace(/\//g, '__')}`);
  copyFileSync(target, backup);
  writeFileSync(target, text);  // in place: the file keeps its owner, mode and the links that point to it
  const after = Buffer.from(text);
  return { path, hash: hash(after), size: after.length, backup, mtime: new Date().toISOString() };
}
