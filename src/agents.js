// Agent runtimes: find what is installed, run one turn, normalise the output into a few events.
// Every adapter keeps the runtime's own session, so the next turn continues the same conversation.
import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { accessSync, constants, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';

// What the scanner looks for. `adapter: false` means we can see it but cannot drive it yet.
const RUNTIMES = [
  { id: 'claude', label: 'Claude Code', bins: ['claude'], adapter: true },
  { id: 'codex', label: 'Codex', bins: ['codex'], adapter: true },
  { id: 'openclaw', label: 'OpenClaw', bins: ['openclaw'], adapter: true },
  { id: 'hermes', label: 'Hermes', bins: ['hermes'], adapter: false },
  { id: 'deepseek', label: 'DeepSeek', bins: ['deepseek', 'deepseek-cli'], adapter: false },
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

let cache = null;
let cachedAt = 0;

// Installed runtimes with version; OpenClaw also reports which gateway agent answers by default.
export async function scan({ fresh = false } = {}) {
  if (cache && !fresh && Date.now() - cachedAt < 60_000) return cache;
  const found = await Promise.all(RUNTIMES.map(async (r) => {
    const path = r.bins.map(which).find(Boolean) ?? null;
    const out = { id: r.id, label: r.label, installed: Boolean(path), ready: Boolean(path) && r.adapter, path, version: null };
    if (!path) return out;
    out.version = (await run(path, ['--version'])).split('\n')[0].trim() || null;
    if (r.id === 'openclaw') {
      const list = await run(path, ['agents', 'list'], 15000);
      out.agent = /^- (\S+) \(default\)/m.exec(list)?.[1] ?? /^- (\S+)/m.exec(list)?.[1] ?? null;
      if (!out.agent) out.ready = false;
    }
    if (!r.adapter) out.note = 'znaleziony, brak adaptera';
    return out;
  }));
  cache = found;
  cachedAt = Date.now();
  return found;
}

const short = (s, n = 160) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// Claude Code: streamed text deltas, tool calls as one-line notes. Hooks of the host are off so an
// agent run here never writes into the operator's own memory or automations.
const claude = {
  argv(ref, started) {
    return ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--permission-mode', 'acceptEdits', '--settings', JSON.stringify({ disableAllHooks: true }),
      ...(started ? ['--resume', ref] : ['--session-id', ref]),
      '--allowedTools', 'Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'];
  },
  stdin: true,
  line(d, emit) {
    if (d.type === 'stream_event' && d.event?.type === 'content_block_delta' && d.event.delta?.type === 'text_delta') {
      emit({ type: 'text', s: d.event.delta.text });
    } else if (d.type === 'stream_event' && d.event?.type === 'content_block_start' && d.event.content_block?.type === 'text') {
      emit({ type: 'text', s: '', block: true });
    } else if (d.type === 'assistant') {
      for (const c of d.message?.content ?? []) {
        if (c.type !== 'tool_use') continue;
        const i = c.input ?? {};
        emit({ type: 'tool', s: `${c.name} ${short(String(i.command ?? i.file_path ?? i.pattern ?? i.url ?? i.description ?? ''))}`.trim() });
      }
    } else if (d.type === 'result') {
      if (d.is_error) emit({ type: 'error', s: String(d.result ?? d.subtype ?? 'error') });
      emit({ type: 'done', cost: d.total_cost_usd ?? null });
    }
  },
};

// Codex: whole messages and command steps; the thread id becomes our session reference.
const codex = {
  argv(ref, started) {
    const common = ['--json', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check'];
    return started ? ['exec', 'resume', ...common, ref, '-'] : ['exec', ...common, '-'];
  },
  stdin: true,
  line(d, emit) {
    if (d.type === 'thread.started') emit({ type: 'ref', ref: d.thread_id });
    else if (d.type === 'item.started' && d.item?.type === 'command_execution') emit({ type: 'tool', s: `bash ${short(d.item.command ?? '')}` });
    else if (d.type === 'item.completed' && d.item?.type === 'agent_message') emit({ type: 'text', s: d.item.text + '\n', block: true });
    else if (d.type === 'item.completed' && d.item?.type === 'file_change') emit({ type: 'tool', s: `edit ${short((d.item.changes ?? []).map((c) => c.path).join(', '))}` });
    else if (d.type === 'error' || d.type === 'turn.failed') emit({ type: 'error', s: String(d.message ?? d.error?.message ?? 'error') });
    else if (d.type === 'turn.completed') emit({ type: 'done' });
  },
};

// OpenClaw: one JSON document at the end; the reply stays here, nothing is delivered to channels.
const openclaw = {
  argv(ref, _started, { agent, file }) {
    return ['agent', '--agent', agent, '--session-id', ref, '--message-file', file, '--json', '--timeout', '600'];
  },
  stdin: false,
  whole(text, emit) {
    let d;
    try { d = JSON.parse(text); } catch { return emit({ type: 'error', s: short(text.trim() || 'brak odpowiedzi', 400) }); }
    for (const p of d.result?.payloads ?? []) if (p.text) emit({ type: 'text', s: p.text + '\n', block: true });
    if (d.status !== 'ok') emit({ type: 'error', s: String(d.summary ?? d.status) });
    emit({ type: 'done' });
  },
};

const ADAPTERS = { claude, codex, openclaw };

export function newRef(id) {
  return id === 'codex' ? null : id === 'openclaw' ? `spectrahub-${randomUUID()}` : randomUUID();
}

// Runs one turn. `emit` receives {type: text|tool|error|ref|done}; the returned function stops it.
export function turn(rt, { ref, started, prompt, cwd }, emit) {
  const a = ADAPTERS[rt.id];
  let file = null;
  if (rt.id === 'openclaw') {
    const dir = join(tmpdir(), 'spectrahub-msg');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    file = join(dir, `${randomUUID()}.txt`);
    writeFileSync(file, prompt, { mode: 0o600 });
  }
  const child = spawn(rt.path, a.argv(ref, started, { agent: rt.agent, file }), {
    cwd, env: { ...process.env, NO_COLOR: '1' }, stdio: [a.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });
  if (a.stdin) child.stdin.end(prompt);
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
