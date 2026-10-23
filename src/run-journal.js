// Private, append-only worker journals. No provider credentials are stored here.
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, chmodSync, readFileSync, writeFileSync, renameSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER = fileURLToPath(new URL('./run-worker.js', import.meta.url));
const ID = /^[a-f0-9-]{36}$/;
const POLL_MS = 75;
const MAX_READ = 64 * 1024 * 1024;
const monitors = new Set();
export function runPath(config, id) {
  if (!ID.test(id)) throw new Error('invalid run id');
  return join(config.dir, 'data', 'runs', id);
}
export function readRun(config, id) {
  try { return JSON.parse(readFileSync(join(runPath(config, id), 'spec.json'), 'utf8')); } catch { return null; }
}
export function atomic(file, data) {
  const tmp = file + '.' + process.pid + '.tmp';
  writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}
export function processStamp(pid) {
  try {
    const s = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = s.slice(s.lastIndexOf(')') + 2).split(' ');
    return fields[0] === 'Z' ? null : fields[19];
  } catch { return null; }
}
function state(dir) {
  try { return JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')); } catch { return null; }
}
export function prepareRun(config, rt, options, context) {
  const id = randomUUID();
  const dir = runPath(config, id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  mkdirSync(join(dir, 'commands'), { mode: 0o700 });
  const { env = {}, ...safeOptions } = options;
  const launch = rt.launch ? { ...rt.launch, env: {} } : undefined;
  const spec = { id, createdAt: Date.now(), runtime: { ...rt, ...(launch ? { launch } : {}) }, options: safeOptions, context };
  atomic(join(dir, 'spec.json'), spec);
  writeFileSync(join(dir, 'events.jsonl'), '', { mode: 0o600 });
  atomic(join(dir, 'state.json'), { status: 'prepared', updatedAt: Date.now() });
  return id;
}

export function launchRun(config, id, rt, options) {
  const dir = runPath(config, id);
  // Only a pipe carries per-turn keys and service environment overrides to the worker.
  const child = spawn(process.execPath, [WORKER, dir], { detached: true, stdio: ['pipe', 'ignore', 'ignore'], env: process.env });
  child.stdin.on('error', () => {});
  child.stdin.end(JSON.stringify({ env: options.env ?? {}, launchEnv: rt.launch?.env ?? {} }));
  if (child.pid) atomic(join(dir, 'state.json'), { pid: child.pid, stamp: processStamp(child.pid), status: 'running', phase: 'starting', updatedAt: Date.now() });
  child.on('error', (error) => atomic(join(dir, 'state.json'), { status: 'failed', error: error.message }));
  child.unref();
  return child.pid;
}

// Reattaching reads only events beyond the cursor committed with the session snapshot.
// Nothing here launches or replays an agent's prompt.
export function attachRun(config, id, cursor, emit) {
  const dir = runPath(config, id);
  let offset = Number(cursor) || 0;
  let closed = false;
  let timer;
  const created = readRun(config, id)?.createdAt ?? 0;
  const close = () => { if (closed) return; closed = true; clearInterval(timer); monitors.delete(close); };
  const poll = () => {
    if (closed) return;
    try {
      const file = join(dir, 'events.jsonl');
      const size = statSync(file).size;
      if (size > offset) {
        const fd = openSync(file, 'r');
        const buf = Buffer.alloc(Math.min(size - offset, MAX_READ));
        const n = readSync(fd, buf, 0, buf.length, offset);
        closeSync(fd);
        let from = 0;
        for (let end; (end = buf.indexOf(10, from)) >= 0;) {
          const line = buf.subarray(from, end).toString('utf8');
          offset += end + 1 - from;
          from = end + 1;
          const event = JSON.parse(line);
          emit(event, offset);
          if (event.type === 'done') { close(); return; }
        }
        // More complete events remain: do not consider the worker dead until drained.
        if (offset < size && n === MAX_READ && from > 0) return;
      }
      const s = state(dir);
      const alive = s?.status === 'running' && s.pid && s.stamp && processStamp(s.pid) === s.stamp;
      // The worker may append its final event between our size snapshot and state read.
      if (!alive && statSync(file).size > size) return;
      if (!alive && (s || Date.now() - created > 10_000)) {
        emit({ type: 'error', interrupted: true, s: s?.error || 'Przerwano proces agenta. Nie powtórzono poleceń; wyślij dalszą wiadomość, aby kontynuować jego sesję.' }, offset);
        emit({ type: 'done' }, offset);
        close();
      }
    } catch (error) {
      // A missing journal is an interrupted run, never a reason to launch it again.
      emit({ type: 'error', interrupted: true, s: `Nie można odtworzyć pracy agenta: ${error.message}` }, offset);
      emit({ type: 'done' }, offset);
      close();
    }
  };
  const command = (data) => {
    const s = state(dir);
    if (closed || (s && s.status !== 'running')) return false;
    atomic(join(dir, 'commands', `${Date.now()}-${randomUUID()}.json`), data);
    return true;
  };
  const stop = () => command({ type: 'stop' });
  stop.answer = (ask, decision, answers) => command({ type: 'answer', ask, decision, answers });
  stop.detach = close;
  stop.poll = poll;
  timer = setInterval(poll, POLL_MS);
  timer.unref();
  monitors.add(close);
  // Allow the caller to commit the new run id before the first callback.
  queueMicrotask(poll);
  return stop;
}
export function detachRuns() { for (const close of [...monitors]) close(); }
