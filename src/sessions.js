// Work sessions: one conversation shared by several agents. Each agent keeps its own runtime
// session; before its turn it gets what the others said since it last spoke, so they work together.
// Runs live on the server, not in the browser tab: closing the phone does not stop an agent.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { scan, turn, newRef } from './agents.js';

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
  sessions.set(id, s);
  return s;
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
    return s && { id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt, agents: Object.keys(s.agents) };
  }).filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getSession(config, id) {
  return load(config, id);
}

export async function createSession(config, { agents, title }) {
  const ready = (await scan()).filter((r) => r.ready);
  const picked = [...new Set(agents)].filter((id) => ready.some((r) => r.id === id));
  if (!picked.length) return { error: 'no ready agent selected' };
  const now = new Date().toISOString();
  const s = {
    id: randomUUID().slice(0, 13),
    title: String(title || '').trim().slice(0, 80) || `sesja ${now.slice(0, 16).replace('T', ' ')}`,
    createdAt: now,
    updatedAt: now,
    cwd: config.agents?.cwd ?? config.terminal?.cwd ?? process.cwd(),
    agents: Object.fromEntries(picked.map((id) => [id, { ref: newRef(id), started: false, synced: now, state: 'idle' }])),
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
export async function send(config, id, { to, text }) {
  const s = load(config, id);
  if (!s) return { error: 'no such session', code: 404 };
  const targets = (to.includes('all') ? Object.keys(s.agents) : to).filter((a) => s.agents[a]);
  if (!targets.length) return { error: 'no such agent in this session', code: 400 };
  const busy = targets.filter((a) => s.agents[a].state === 'busy');
  if (busy.length) return { error: `busy: ${busy.join(', ')}`, code: 409 };
  const runtimes = await scan();
  const mine = add(config, s, { who: 'you', to: targets, s: text });
  mine.done = mine.at;

  for (const agent of targets) {
    const rt = runtimes.find((r) => r.id === agent && r.ready);
    const st = s.agents[agent];
    const others = catchUp(s, agent, mine.n);
    st.synced = new Date().toISOString();
    const prompt = others
      ? `Rozmowa zespołowa w SpectraHub. Od Twojej ostatniej odpowiedzi:\n${others}\n\n---\nWiadomość do Ciebie:\n${text}`
      : text;
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
    const stop = turn(rt, { ref: st.ref, started: st.started, prompt, cwd: s.cwd }, (e) => {
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
        } else {
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
      } else if (e.type === 'ref') {
        st.ref = e.ref;
      } else if (e.type === 'error') {
        reply.error = e.s;
      } else if (e.type === 'done') {
        running.delete(`${s.id}:${agent}`);
        if (st.ref) st.started = true;
        reply.s = reply.s.trimEnd();
        reply.status = reply.error ? 'error' : 'done';
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
