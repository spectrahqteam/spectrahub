// Work sessions: one conversation shared by several agents. Each agent keeps its own runtime
// session; before its turn it gets what the others said since it last spoke, so they work together.
// Runs live on the server, not in the browser tab: closing the phone does not stop an agent.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, normalize } from 'node:path';
import { codexLimits, PERMS, scan, turn, newRef } from './agents.js';

const CONTEXT_CHARS = 8000;
const sessions = new Map();     // id -> session (loaded lazily)
const listeners = new Map();    // id -> Set<fn>
const running = new Map();      // `${id}:${agent}` -> stop()

function dirOf(config) {
  const d = join(config.dir, 'data', 'sessions');
  mkdirSync(d, { recursive: true });
  return d;
}

function save(config, s) {
  const file = join(dirOf(config), `${s.id}.json`);
  writeFileSync(file + '.tmp', JSON.stringify(s));
  renameSync(file + '.tmp', file);
}

function load(config, id) {
  if (sessions.has(id)) return sessions.get(id);
  if (!/^[\w-]{6,64}$/.test(id)) return null;
  const file = join(dirOf(config), `${id}.json`);
  if (!existsSync(file)) return null;
  const s = JSON.parse(readFileSync(file, 'utf8'));
  for (const a of Object.values(s.agents)) a.state = 'idle';  // a restart ends any run in flight
  for (const e of s.log) if (e.status === 'running') { e.status = 'error'; e.error = 'przerwane: serwer SpectraHub został uruchomiony ponownie'; }
  // Sessions from before automatic names carry a date; name them after their first line instead.
  const first = s.log.find((e) => e.who === 'you' && e.s);
  if (first && /^sesja \d{4}-\d\d-\d\d \d\d:\d\d$/.test(s.title)) { s.title = titleFrom(first.s); s.autoTitle = false; save(config, s); }
  sessions.set(id, s);
  return s;
}

function titleFrom(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 48 ? t.slice(0, 47).trimEnd() + '…' : t;
}

function publish(id, event) {
  for (const fn of listeners.get(id) ?? []) fn(event);
}

export function subscribe(id, fn) {
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id).add(fn);
  return () => listeners.get(id)?.delete(fn);
}

export function listSessions(config) {
  return readdirSync(dirOf(config)).filter((f) => f.endsWith('.json')).map((f) => {
    const s = load(config, f.slice(0, -5));
    return s && {
      id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt, agents: Object.keys(s.agents),
      projectId: s.projectId ?? null, pinned: Boolean(s.pinned), busy: Object.values(s.agents).some((a) => a.state === 'busy'),
    };
  }).filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// ---------- projects: folders for sessions ----------
function projectsFile(config) {
  mkdirSync(join(config.dir, 'data'), { recursive: true });
  return join(config.dir, 'data', 'projects.json');
}
export function listProjects(config) {
  try { return JSON.parse(readFileSync(projectsFile(config), 'utf8')); } catch { return []; }
}
function saveProjects(config, list) {
  writeFileSync(projectsFile(config) + '.tmp', JSON.stringify(list));
  renameSync(projectsFile(config) + '.tmp', projectsFile(config));
}
const COLOR = /^#[0-9a-f]{6}$/i;
const ICON = /^[a-z-]{2,20}$/;
export function createProject(config, name, look = {}) {
  const n = String(name ?? '').trim().slice(0, 60);
  if (!n) return { error: 'name required' };
  const p = { id: randomUUID().slice(0, 8), name: n, createdAt: new Date().toISOString(),
    icon: ICON.test(look.icon ?? '') ? look.icon : 'folder', color: COLOR.test(look.color ?? '') ? look.color : '#8c8c8c' };
  saveProjects(config, [...listProjects(config), p]);
  return { project: p };
}
export function updateProject(config, id, { name, icon, color }) {
  const list = listProjects(config);
  const p = list.find((x) => x.id === id);
  if (!p) return { error: 'no such project', code: 404 };
  if (String(name ?? '').trim()) p.name = String(name).trim().slice(0, 60);
  if (ICON.test(icon ?? '')) p.icon = icon;
  if (COLOR.test(color ?? '')) p.color = color;
  saveProjects(config, list);
  return { project: p };
}
// Removing a project keeps its sessions; they go back to the list without a folder.
export function deleteProject(config, id) {
  const list = listProjects(config);
  if (!list.some((x) => x.id === id)) return { error: 'no such project', code: 404 };
  saveProjects(config, list.filter((x) => x.id !== id));
  for (const sum of listSessions(config)) {
    if (sum.projectId !== id) continue;
    const s = load(config, sum.id);
    s.projectId = null;
    save(config, s);
  }
  return { ok: true };
}

// ---------- one session: rename, pin, move, models, delete ----------
export function updateSession(config, id, patch) {
  const s = load(config, id);
  if (!s) return { error: 'no such session', code: 404 };
  if (typeof patch.title === 'string' && patch.title.trim()) { s.title = patch.title.trim().slice(0, 80); s.autoTitle = false; }
  if (typeof patch.pinned === 'boolean') s.pinned = patch.pinned;
  if ('projectId' in patch) {
    if (patch.projectId && !listProjects(config).some((p) => p.id === patch.projectId)) return { error: 'no such project', code: 400 };
    s.projectId = patch.projectId || null;
  }
  if ('cwd' in patch) {
    const dir = validDir(patch.cwd);
    if (!dir) return { error: 'not a directory on this server', code: 400 };
    s.cwd = dir;
    s.cwdChosen = true;
  }
  for (const [agent, perm] of Object.entries(patch.perms ?? {})) if (s.agents[agent] && PERMS.includes(perm)) s.agents[agent].perm = perm;
  for (const [agent, m] of Object.entries(patch.models ?? {})) {
    if (!s.agents[agent]) continue;
    s.agents[agent].model = typeof m.model === 'string' ? m.model.slice(0, 120) : s.agents[agent].model;
    s.agents[agent].effort = typeof m.effort === 'string' ? m.effort.slice(0, 20) : s.agents[agent].effort;
  }
  save(config, s);
  publish(s.id, { type: 'meta', session: summary(s) });
  return { session: summary(s) };
}

function summary(s) {
  return { id: s.id, title: s.title, pinned: Boolean(s.pinned), projectId: s.projectId ?? null, cwd: s.cwd,
    agents: Object.fromEntries(Object.entries(s.agents).map(([k, a]) => [k, { model: a.model ?? '', effort: a.effort ?? '', perm: a.perm ?? 'full', state: a.state }])) };
}

// Deleting moves the session to data/sessions/trash, so it can be brought back by hand.
export function deleteSession(config, id) {
  const s = load(config, id);
  if (!s) return { error: 'no such session', code: 404 };
  stop(config, id);
  const trash = join(dirOf(config), 'trash');
  mkdirSync(trash, { recursive: true });
  renameSync(join(dirOf(config), `${id}.json`), join(trash, `${id}.json`));
  if (existsSync(filesDir(config, id, false))) renameSync(filesDir(config, id, false), join(trash, `${id}-files`));
  sessions.delete(id);
  publish(id, { type: 'deleted' });
  return { ok: true };
}

// ---------- files: what the user uploads and what the agents write ----------
const SECRET = /(^|\/)(\.env[^/]*|id_[a-z0-9]+|[^/]*\.(pem|key|p12|pfx)|auth\.json|credentials[^/]*|token)$/i;
const MAX_UPLOAD = 25 * 1024 * 1024;

function filesDir(config, id, make = true) {
  const d = join(dirOf(config), id + '-files');
  if (make) mkdirSync(d, { recursive: true });
  return d;
}

function guessType(name) {
  const e = extname(name).toLowerCase();
  return ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
    '.html': 'text/html', '.htm': 'text/html', '.json': 'application/json', '.md': 'text/markdown', '.csv': 'text/csv' })[e] ?? (/\.(txt|log|js|mjs|ts|tsx|jsx|css|py|sh|yml|yaml|toml|ini|conf|xml|sql|rs|go|java|c|h|cpp|rb|php)$/i.test(name) ? 'text/plain' : 'application/octet-stream');
}

// Adds a file to the session's list (deduplicated by path); it can then be opened from the chat.
function track(s, path, from) {
  if (!path || !isAbsolute(path)) return null;
  const p = normalize(path);
  let f = s.files?.find((x) => x.path === p);
  if (!f) {
    f = { id: randomUUID().slice(0, 8), path: p, name: basename(p), type: guessType(p), from, at: new Date().toISOString() };
    (s.files ??= []).push(f);
  }
  try { f.size = statSync(p).size; } catch { /* written later or gone */ }
  return f;
}

export function saveUpload(config, id, { name, type, data }) {
  const s = load(config, id);
  if (!s) return { error: 'no such session', code: 404 };
  if (data.length > MAX_UPLOAD) return { error: 'too large', code: 413 };
  const safe = basename(String(name || 'plik')).replace(/[^\w.\- ]+/g, '_').slice(-80) || 'plik';
  const path = join(filesDir(config, id), `${Date.now().toString(36)}-${safe}`);
  writeFileSync(path, data);
  const f = track(s, path, 'you');
  if (type && type !== 'application/octet-stream') f.type = type;
  f.name = safe;
  save(config, s);
  publish(s.id, { type: 'files', files: s.files });
  return { file: f };
}

// Hands a file on this server to the chat (spectrahub attach, OpenClaw media, paths agents name).
export function attachFile(config, id, { path, from = 'agent' }) {
  const s = load(config, id);
  if (!s) return { error: 'no such session', code: 404 };
  if (typeof path !== 'string' || !isAbsolute(path)) return { error: 'absolute path required', code: 400 };
  if (SECRET.test(path)) return { error: 'refused: looks like a secret', code: 403 };
  let st;
  try { st = statSync(path); } catch { return { error: 'no such file', code: 404 }; }
  if (!st.isFile()) return { error: 'not a file', code: 400 };
  const who = s.agents[from] ? from : 'agent';
  const f = track(s, path, who);
  const reply = [...s.log].reverse().find((e) => e.who === who && e.status === 'running');
  if (reply) addReplyFile(s, reply, f);
  save(config, s);
  publish(s.id, { type: 'files', files: s.files });
  return { file: f };
}

function addReplyFile(s, reply, f) {
  if (!f || (reply.files ??= []).includes(f.id)) return;
  reply.files.push(f.id);
  publish(s.id, { type: 'reply-files', n: reply.n, files: reply.files });
}

// Paths a shell command writes to: > file, >> file, tee file, cp/mv … dest, -o/-O file.
const WRITES = [/(?:^|[\s;|&])\d?>>?\s*(['"]?)(\/[^\s'";|&<>]+)\1/g, /\btee\s+(?:-a\s+)?(['"]?)(\/[^\s'";|&<>]+)\1/g,
  /\b(?:cp|mv|install)\s+(?:-\S+\s+)*\S+\s+(['"]?)(\/[^\s'";|&<>]+)\1\s*(?:$|[;|&])/gm, /\s-[oO]\s+(['"]?)(\/[^\s'";|&<>]+)\1/g];
function writtenBy(command) {
  const out = new Set();
  for (const re of WRITES) for (const m of String(command ?? '').matchAll(re)) out.add(m[2]);
  return [...out].filter((p) => !p.startsWith('/dev/'));
}
// Absolute paths named in a reply.
function namedIn(text) {
  return [...new Set([...String(text ?? '').matchAll(/(?:^|[\s`'"(\[])(\/(?:[\w.@+-]+\/)*[\w.@+-]+\.[A-Za-z0-9]{1,8})(?=$|[\s`'"),.:;\]])/gm)].map((m) => m[1]))];
}
export { writtenBy, namedIn };  // for tests

// Keeps a file only if it was written while this turn ran: naming an old file does not attach it.
function freshFile(path, since) {
  try { const st = statSync(path); return st.isFile() && st.mtimeMs >= since - 2000; } catch { return false; }
}

// A file may be read only if this session knows it: uploaded here or written by its agents.
export function sessionFile(config, id, fileId) {
  const s = load(config, id);
  if (!s) return { error: 'no such session', code: 404 };
  const f = s.files?.find((x) => x.id === fileId);
  if (!f) return { error: 'no such file', code: 404 };
  if (SECRET.test(f.path)) return { error: 'refused: looks like a secret', code: 403 };
  let st;
  try { st = statSync(f.path); } catch { return { error: 'file is gone', code: 410 }; }
  if (!st.isFile()) return { error: 'not a file', code: 400 };
  return { file: { ...f, size: st.size }, path: f.path };
}

// The newest files across sessions, for the Files home.
export function recentFiles(config, limit = 12) {
  const all = [];
  for (const sum of listSessions(config)) {
    const s = load(config, sum.id);
    for (const f of s.files ?? []) all.push({ session: s.id, title: s.title, file: f });
  }
  return all.sort((a, b) => String(b.file.at).localeCompare(String(a.file.at))).slice(0, limit);
}

// Every running turn on this server, for the "background tasks" view.
export function runs(config) {
  return [...running.keys()].map((key) => {
    const [id, agent] = key.split(':');
    const s = sessions.get(id);
    return s && { session: id, title: s.title, agent };
  }).filter(Boolean);
}

export function getSession(config, id) {
  return load(config, id);
}

// A working folder must be an existing directory given by its absolute path.
function validDir(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) return null;
  try { return statSync(path).isDirectory() ? normalize(path) : null; } catch { return null; }
}

export async function createSession(config, { agents, title, cwd, perms = {} }) {
  const ready = (await scan()).filter((r) => r.ready);
  const picked = [...new Set(agents)].filter((id) => ready.some((r) => r.id === id));
  if (!picked.length) return { error: 'no ready agent selected' };
  const now = new Date().toISOString();
  const s = {
    id: randomUUID().slice(0, 13),
    title: String(title || '').trim().slice(0, 80) || `sesja ${now.slice(0, 16).replace('T', ' ')}`,
    autoTitle: !String(title || '').trim(),
    createdAt: now,
    updatedAt: now,
    cwd: validDir(cwd) ?? config.agents?.cwd ?? config.terminal?.cwd ?? process.cwd(),
    cwdChosen: Boolean(validDir(cwd)),
    agents: Object.fromEntries(picked.map((id) => [id, { ref: newRef(id), started: false, synced: now, state: 'idle', perm: PERMS.includes(perms[id]) ? perms[id] : 'full' }])),
    log: [{ n: 0, who: 'system', s: `sesja otwarta · agenci: ${picked.join(', ')}`, at: now }],
  };
  sessions.set(s.id, s);
  save(config, s);
  return { session: s };
}

function add(config, s, entry) {
  entry.n = s.log.length;
  entry.at = new Date().toISOString();
  s.log.push(entry);
  s.updatedAt = entry.at;
  publish(s.id, { type: 'entry', entry });
  return entry;
}

// What `agent` has not seen yet: everything finished by the others since its last turn began.
// Replies still streaming are left for the next turn, when they are complete.
function catchUp(s, agent, skip) {
  const since = s.agents[agent].synced;
  const lines = s.log
    .filter((e) => e.n !== skip && e.who !== 'system' && e.who !== agent && e.s && e.done && e.done > since)
    .map((e) => (e.who === 'you' ? `[użytkownik → ${e.to.join(', ')}] ${e.s}` : `[${e.who}] ${e.s}`));
  const text = lines.join('\n');
  return text.length > CONTEXT_CHARS ? '…' + text.slice(-CONTEXT_CHARS) : text;
}

function setState(s, agent, state) {
  s.agents[agent].state = state;
  publish(s.id, { type: 'state', agent, state });
}

// Sends the user's line to the chosen agents; each answers in its own entry, streamed as it comes.
export async function send(config, id, { to, text, attachments = [] }) {
  const s = load(config, id);
  if (!s) return { error: 'no such session', code: 404 };
  const targets = (to.includes('all') ? Object.keys(s.agents) : to).filter((a) => s.agents[a]);
  if (!targets.length) return { error: 'no such agent in this session', code: 400 };
  const busy = targets.filter((a) => s.agents[a].state === 'busy');
  if (busy.length) return { error: `busy: ${busy.join(', ')}`, code: 409 };
  const runtimes = await scan();
  const files = attachments.map((fid) => s.files?.find((f) => f.id === fid)).filter(Boolean);
  const mine = add(config, s, { who: 'you', to: targets, s: text, ...(files.length ? { files: files.map((f) => f.id) } : {}) });
  if (s.autoTitle) {  // an unnamed session takes its name from the first line
    s.title = titleFrom(text);
    s.autoTitle = false;
    publish(s.id, { type: 'title', title: s.title });
  }
  mine.done = mine.at;

  for (const agent of targets) {
    const rt = runtimes.find((r) => r.id === agent && r.ready);
    const st = s.agents[agent];
    const others = catchUp(s, agent, mine.n);
    st.synced = new Date().toISOString();
    const attached = files.length
      ? `\n\nZałączniki od użytkownika (pliki na tym serwerze):\n${files.map((f) => `- ${f.path} (${f.type}${f.size != null ? `, ${f.size} B` : ''})`).join('\n')}`
      : '';
    const prompt = (others
      ? `Rozmowa zespołowa w SpectraHub. Od Twojej ostatniej odpowiedzi:\n${others}\n\n---\nWiadomość do Ciebie:\n${text}`
      : text) + attached;
    // The reply is a timeline: text and steps (tools, edits, thinking, plan) in the order they happened.
    const reply = add(config, s, { who: agent, s: '', items: [], status: 'running' });
    const began = Date.now();
    if (!rt) {
      reply.status = 'error';
      reply.error = 'agent niedostępny na tym serwerze';
      publish(s.id, { type: 'end', n: reply.n, status: 'error', error: reply.error });
      continue;
    }
    setState(s, agent, 'busy');
    const images = files.filter((f) => f.type.startsWith('image/')).map((f) => f.path);
    const hint = st.started ? '' : '\n\n(SpectraHub: jeśli przygotujesz plik dla użytkownika, podaj w odpowiedzi jego pełną ścieżkę — pojawi się w czacie jako plik do otwarcia.)';
    const env = { SPECTRAHUB_SESSION: s.id, SPECTRAHUB_AGENT: agent, SPECTRAHUB_HOME: config.dir };
    const stop = turn(rt, { ref: st.ref, started: st.started, prompt: prompt + hint, cwd: s.cwd, ownCwd: Boolean(s.cwdChosen),
      model: st.model || null, effort: st.effort || null, perm: st.perm ?? 'full', images, env }, (e) => {
      if (e.type === 'text') {
        const last = reply.items.at(-1);
        const s1 = last?.k === 'text' && e.block && last.s && !last.s.endsWith('\n') ? '\n' + e.s : e.s;
        if (!s1) return;
        if (last?.k === 'text') last.s += s1;
        else reply.items.push({ k: 'text', s: s1 });
        reply.s += (reply.s && !reply.s.endsWith('\n') && last?.k !== 'text' ? '\n' : '') + s1;
        publish(s.id, { type: 'delta', n: reply.n, s: s1 });
      } else if (e.type === 'step' || e.type === 'step-end') {
        let step = reply.items.find((i) => i.k === 'step' && i.id === e.id);
        if (!step) {
          step = { k: 'step', id: e.id, kind: e.kind ?? 'tool', name: e.name ?? '', title: '', status: 'running', t0: Date.now() };
          reply.items.push(step);
        }
        if (e.type === 'step') {
          for (const key of ['kind', 'name', 'title', 'text', 'diff', 'todos']) if (e[key] != null && e[key] !== '') step[key] = e[key];
          if (e.done) step.status = 'ok';
          if (step.kind === 'edit') {  // files the agent writes can be opened from the chat
            const paths = step.diff?.path ? [step.diff.path] : String(step.title ?? '').split(/[\s,]+/).filter((x) => x.startsWith('/'));
            const tracked = paths.map((p) => track(s, p, agent)).filter(Boolean);
            if (tracked.length) { step.files = tracked.map((f) => f.id); publish(s.id, { type: 'files', files: s.files }); }
          }
        } else {
          for (const fid of step.files ?? []) track(s, s.files.find((f) => f.id === fid)?.path, agent);  // size after writing
          if (step.kind === 'tool') {  // shell writes (cat > f, tee, cp, -o) count as files too
            const made = writtenBy(step.title).filter((p) => freshFile(p, began)).map((p) => track(s, p, agent)).filter(Boolean);
            if (made.length) { step.files = made.map((f) => f.id); made.forEach((f) => addReplyFile(s, reply, f)); publish(s.id, { type: 'files', files: s.files }); }
          }
          step.status = e.ok === false ? 'error' : 'ok';
          if (e.output != null) step.output = e.output;
          if (e.exit != null) step.exit = e.exit;
          step.ms = Date.now() - step.t0;
        }
        publish(s.id, { type: 'step', n: reply.n, step });
      } else if (e.type === 'usage') {
        const { type: _t, ...u } = e;
        reply.usage = { ...reply.usage, ...Object.fromEntries(Object.entries(u).filter(([, v]) => v != null)) };
        publish(s.id, { type: 'usage', n: reply.n, usage: reply.usage });
      } else if (e.type === 'limits') {
        st.limits = { windows: e.windows, status: e.status, at: new Date().toISOString() };
        publish(s.id, { type: 'limits', agent, limits: st.limits });
      } else if (e.type === 'file') {
        const f = track(s, e.path, agent);
        if (f) { addReplyFile(s, reply, f); publish(s.id, { type: 'files', files: s.files }); }
      } else if (e.type === 'limits-codex') {
        const l = codexLimits(st.ref);
        if (l) { st.limits = { ...l, at: new Date().toISOString() }; publish(s.id, { type: 'limits', agent, limits: st.limits }); }
      } else if (e.type === 'ref') {
        st.ref = e.ref;
      } else if (e.type === 'error') {
        reply.error = e.s;
      } else if (e.type === 'done') {
        running.delete(`${s.id}:${agent}`);
        if (st.ref) st.started = true;
        reply.s = reply.s.trimEnd();
        reply.status = reply.error ? 'error' : 'done';
        for (const p of namedIn(reply.s)) if (freshFile(p, began) && !SECRET.test(p)) addReplyFile(s, reply, track(s, p, agent));
        if (reply.files?.length) publish(s.id, { type: 'files', files: s.files });
        const u = reply.usage ?? {};
        const tot = (st.usage ??= { input: 0, output: 0, cost: 0, turns: 0 });  // running totals for the usage view
        tot.input += u.input ?? 0;
        tot.output += u.output ?? 0;
        tot.cost += u.cost ?? 0;
        tot.turns += 1;
        for (const k of ['model', 'context', 'contextWindow']) if (u[k] != null) tot[k] = u[k];
        reply.ms = Date.now() - began;
        for (const i of reply.items) if (i.k === 'step' && i.status === 'running') i.status = reply.error ? 'error' : 'ok';
        publish(s.id, { type: 'usage', n: reply.n, usage: reply.usage ?? {}, ms: reply.ms });
        reply.done = new Date().toISOString();
        s.updatedAt = reply.done;
        publish(s.id, { type: 'end', n: reply.n, status: reply.status, error: reply.error ?? null });
        setState(s, agent, 'idle');
        save(config, s);
      }
    });
    running.set(`${s.id}:${agent}`, stop);
  }
  save(config, s);
  return { ok: true, targets };
}

export function stop(config, id, agent) {
  let n = 0;
  for (const [key, fn] of running) {
    if (key.startsWith(`${id}:`) && (!agent || key === `${id}:${agent}`)) { fn(); n++; }
  }
  return n;
}
