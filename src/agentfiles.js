// Each agent's own files: what it reads to know who it is, how it works and what it remembers.
// Found where each runtime keeps them (its home folder, its config, its workspaces and the projects
// it was used in) plus the notes its owner put next to it. They can be read and edited; a save
// keeps the previous version in ~/.spectrahub/backups and refuses to overwrite a newer change.
import { copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { openclawHome, readEnvFile, scan } from './agents.js';
import { FsError, hash, isSecret } from './fsview.js';

const json = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
function files(dir, test = () => true, depth = 1) {
  const out = [];
  const walk = (d, left) => {
    let names = [];
    try { names = readdirSync(d); } catch { return; }
    for (const n of names.sort()) {
      if (n === 'node_modules' || n === '.git') continue;
      if (n.startsWith('.') && isDir(join(d, n))) continue;  // hidden folders: trash, caches, sync state
      const p = join(d, n);
      if (isDir(p)) { if (left > 0) walk(p, left - 1); } else if (isFile(p) && test(n, p)) out.push(p);
      if (out.length > 200) return;
    }
  };
  walk(dir, depth - 1);
  return out;
}
const md = (n) => /\.md$/i.test(n);
const skill = (n) => n === 'SKILL.md';
// The notes people keep next to an agent: identity and working files at the top of its folder.
const IDENTITY = /^(AGENTS|AGENTS\.override|CLAUDE|CLAUDE\.local|GEMINI|SOUL|IDENTITY|USER|TOOLS|HEARTBEAT|BOOT|BOOTSTRAP|MEMORY|OPERATIONS|PERSONA|RULES|INSTRUCTIONS)\.md$/i;

function claudeSpots() {
  const home = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  const spots = [
    ['identity', join(home, 'CLAUDE.md'), 'instrukcje dla każdej sesji'],
    ['identity', '/etc/claude-code/CLAUDE.md', 'instrukcje firmowe (zarządzane)'],
    ['config', join(home, 'settings.json'), 'ustawienia: model, uprawnienia, hooki'],
    ['config', join(home, 'settings.local.json'), 'ustawienia lokalne'],
    ['config', join(homedir(), '.claude.json'), 'stan i serwery MCP'],
    ['config', '/etc/claude-code/managed-settings.json', 'ustawienia zarządzane'],
    ['config', join(home, 'keybindings.json'), 'skróty klawiszowe'],
    ['secret', join(home, '.credentials.json'), 'logowanie (subskrypcja)'],
  ];
  for (const f of files(join(home, 'agents'), md, 2)) spots.push(['skills', f, 'subagent']);
  for (const f of files(join(home, 'commands'), md, 3)) spots.push(['skills', f, 'komenda']);
  for (const f of files(join(home, 'skills'), skill, 4)) spots.push(['skills', f, 'skill']);
  for (const f of files(join(home, 'output-styles'), md, 1)) spots.push(['skills', f, 'styl odpowiedzi']);
  for (const p of files(join(home, 'projects'), md, 3).filter((f) => f.includes('/memory/'))) spots.push(['memory', p, 'pamięć projektu']);
  const projects = Object.keys(json(join(homedir(), '.claude.json'))?.projects ?? {});
  for (const dir of projects) {
    for (const [name, label] of [['CLAUDE.md', 'instrukcje projektu'], ['CLAUDE.local.md', 'instrukcje prywatne projektu'], ['.claude/settings.json', 'ustawienia projektu'],
      ['.claude/settings.local.json', 'ustawienia lokalne projektu'], ['.mcp.json', 'serwery MCP projektu']]) spots.push(['projects', join(dir, name), label, dir]);
    for (const f of files(join(dir, '.claude', 'agents'), md, 1)) spots.push(['projects', f, 'subagent projektu', dir]);
    for (const f of files(join(dir, '.claude', 'commands'), md, 2)) spots.push(['projects', f, 'komenda projektu', dir]);
    for (const f of files(join(dir, '.claude', 'skills'), skill, 3)) spots.push(['projects', f, 'skill projektu', dir]);
  }
  return spots;
}

function codexSpots() {
  const home = process.env.CODEX_HOME ?? join(homedir(), '.codex');
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
  for (const f of files(join(home, 'rules'), () => true, 1)) spots.push(['config', f, 'reguły poleceń']);
  for (const f of files(join(home, 'hooks'), () => true, 1)) spots.push(['config', f, 'hook']);
  for (const f of files(join(home, 'memories'), md, 2)) spots.push(['memory', f, 'pamięć']);
  let toml = '';
  try { toml = readFileSync(join(home, 'config.toml'), 'utf8'); } catch { /* none */ }
  const projects = [...toml.matchAll(/^\[projects\."([^"]+)"\]/gm)].map((m) => m[1]).filter((d) => d !== '/');
  for (const dir of projects) {
    for (const [name, label] of [['AGENTS.md', 'instrukcje projektu'], ['AGENTS.override.md', 'instrukcje nadrzędne projektu'], ['.codex/config.toml', 'ustawienia projektu']]) spots.push(['projects', join(dir, name), label, dir]);
    for (const f of files(join(dir, '.codex', 'skills'), skill, 3)) spots.push(['projects', f, 'skill projektu', dir]);
  }
  return spots;
}

function openclawSpots() {
  const home = openclawHome();
  const conf = process.env.OPENCLAW_CONFIG_PATH ?? join(home, 'openclaw.json');
  const cfg = json(conf) ?? {};
  const spots = [
    ['config', conf, 'konfiguracja: agenci, modele, narzędzia, kanały'],
    ['config', join(home, 'exec-approvals.json'), 'zgody na polecenia'],
    ['secret', join(home, '.env'), 'klucze dostawców'],
  ];
  for (const f of files(join(home, 'skills'), skill, 3)) spots.push(['skills', f, 'skill']);
  const workspaces = new Map();
  if (cfg.agents?.defaults?.workspace) workspaces.set(cfg.agents.defaults.workspace, 'domyślny workspace');
  for (const a of cfg.agents?.list ?? []) {
    if (a.workspace) workspaces.set(a.workspace, `agent ${a.name ?? a.id}`);
    for (const f of [['models.json', 'config', 'modele agenta'], ['auth-profiles.json', 'secret', 'profile logowania']]) spots.push([f[1], join(home, 'agents', a.id, 'agent', f[0]), `${f[2]} ${a.id}`]);
  }
  for (const [ws, who] of workspaces) {
    for (const f of files(ws, (n) => IDENTITY.test(n), 1)) spots.push(['identity', f, who]);
    for (const f of files(ws, (n) => md(n) && !IDENTITY.test(n), 1)) spots.push(['workspace', f, who, ws]);
    const memory = files(join(ws, 'memory'), md, 2).map((f) => [f, statSync(f).mtimeMs]).sort((a, b) => b[1] - a[1]).slice(0, 30);
    for (const [f] of memory) spots.push(['memory', f, `pamięć · ${who}`]);
    for (const f of files(join(ws, 'skills'), skill, 3)) spots.push(['skills', f, `skill · ${who}`]);
  }
  return spots;
}

function dshSpots(rt) {
  const env = { ...(rt?.launch?.envFile ? readEnvFile(rt.launch.envFile) : {}), ...(rt?.launch?.env ?? {}) };
  const home = env.DSH_HOME ?? process.env.DSH_HOME ?? join(homedir(), '.dsh');
  const cwd = rt?.launch?.cwd ?? null;
  const spots = [];
  if (rt?.launch?.envFile) spots.push(['secret', rt.launch.envFile, 'klucze i ustawienia usługi']);
  for (const n of ['settings.yaml', 'settings.yml', 'settings.json', 'config.json', 'settings.yaml.imported']) spots.push(['config', join(home, n), 'ustawienia']);
  spots.push(['identity', join(home, 'AGENTS.md'), 'instrukcje dla każdej sesji']);
  for (const n of ['.env', '.credentials.yaml']) spots.push(['secret', join(home, n), 'dane logowania']);
  for (const f of files(join(home, 'profiles'), (n) => /^cordis(\.patch)?\.ya?ml$/.test(n), 2)) spots.push(['config', f, `profil ${basename(dirname(f))}`]);
  for (const f of files(join(home, 'skills'), skill, 3)) spots.push(['skills', f, 'skill']);
  for (const f of files(join(homedir(), '.agents', 'skills'), skill, 3)) spots.push(['skills', f, 'skill (wspólny)']);
  if (cwd) {
    for (const f of files(cwd, (n) => IDENTITY.test(n), 1)) spots.push(['identity', f, 'folder pracy']);
    spots.push(['config', join(cwd, '.dsh-project'), 'projekt']);
    for (const f of files(cwd, (n) => md(n) && !IDENTITY.test(n), 1)) spots.push(['workspace', f, 'folder pracy', cwd]);
    for (const d of ['.dsh/skills', '.agents/skills']) for (const f of files(join(cwd, d), skill, 3)) spots.push(['skills', f, 'skill projektu']);
    spots.push(['identity', join(cwd, '.dsh', 'AGENTS.md'), 'instrukcje projektu']);
  }
  return spots;
}

const SOURCES = { claude: claudeSpots, codex: codexSpots, openclaw: openclawSpots, dsh: dshSpots };
export const GROUPS = ['identity', 'config', 'skills', 'memory', 'workspace', 'projects', 'secret'];

const lastScan = new Map();  // agent -> { at, paths: Set } — what may be edited

// Every file that exists, with what it is for; links show the file they point to.
export async function agentFiles(id) {
  const rt = (await scan()).find((r) => r.id === id);
  if (!rt?.installed || !SOURCES[id]) throw new FsError(404, 'nie ma takiego agenta');
  const seen = new Set();
  const out = [];
  for (const [group, path, label, project] of SOURCES[id](rt)) {
    let l;
    try { l = lstatSync(path); } catch { continue; }
    let real = path;
    try { real = realpathSync(path); } catch { continue; }
    if (seen.has(real) || !isFile(real)) continue;
    seen.add(real);
    const st = statSync(real);
    const secret = group === 'secret' || isSecret(path) || isSecret(real);
    const name = basename(path) === 'SKILL.md' ? `${basename(dirname(path))}/SKILL.md` : basename(path);  // skills differ by their folder
    out.push({ group: secret ? 'secret' : group, path, target: l.isSymbolicLink() ? real : null, name, label, project: project ?? null,
      size: st.size, mtime: st.mtime.toISOString(), secret, editable: !secret && st.size <= 1024 * 1024 });
  }
  lastScan.set(id, { at: Date.now(), paths: new Set(out.filter((f) => f.editable).map((f) => f.path)) });
  return { agent: { id: rt.id, label: rt.label, version: rt.version, name: rt.agent ?? null, home: rt.launch?.cwd ?? null }, files: out };
}

// Saving: only a file the scanner found, only if nobody changed it since it was opened (`base`),
// and JSON that was valid stays valid. The old version goes to the backups first.
export async function saveAgentFile(dir, id, { path, text, base }) {
  let allowed = lastScan.get(id);
  if (!allowed || Date.now() - allowed.at > 10 * 60_000) { await agentFiles(id); allowed = lastScan.get(id); }
  if (!allowed.paths.has(path)) throw new FsError(403, 'tego pliku nie można tu edytować');
  if (typeof text !== 'string' || text.length > 1024 * 1024) throw new FsError(400, 'zła treść');
  const real = realpathSync(path);
  const before = readFileSync(real);
  if (base && hash(before) !== base) throw new FsError(409, 'plik zmienił się w międzyczasie — otwórz go ponownie');
  if (/\.json$/i.test(real)) {
    let wasJson = true;
    try { JSON.parse(before.toString('utf8')); } catch { wasJson = false; }
    if (wasJson) {
      try { JSON.parse(text); } catch (e) { throw new FsError(400, `to nie jest poprawny JSON: ${e.message}`); }
    }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backups = join(dir, 'backups', stamp.slice(0, 10));
  mkdirSync(backups, { recursive: true, mode: 0o700 });
  const backup = join(backups, `${stamp}__${real.replace(/^\//, '').replace(/\//g, '__')}`);
  copyFileSync(real, backup);
  writeFileSync(real, text);  // in place: the file keeps its owner, mode and the links that point to it
  const after = Buffer.from(text);
  return { path, hash: hash(after), size: after.length, backup, mtime: new Date().toISOString() };
}

