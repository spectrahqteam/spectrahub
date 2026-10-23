// An approved interactive shell, backed by a real POSIX pseudoterminal.
// Transport reconnects replay a bounded buffer; they do not create another shell.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { terminalCommand } from './hosts.js';

const BRIDGE = fileURLToPath(new URL('../bin/pty-bridge.py', import.meta.url));
const installations = new Map();
const MAX_OUTPUT = 1024 * 1024;
const MAX_INPUT = 64 * 1024;
const ACTIVE = new Set(['pending', 'starting', 'running', 'stopping']);
const fail = (message, code = 400) => { throw Object.assign(new Error(message), { code }); };
const registry = (config) => {
  if (!installations.has(config.dir)) installations.set(config.dir, new Map());
  return installations.get(config.dir);
};

function dimensions(cols = 80, rows = 24) {
  if (!Number.isInteger(cols) || cols < 10 || cols > 1000 || !Number.isInteger(rows) || rows < 2 || rows > 500) fail('invalid terminal size');
  return { cols, rows };
}

function lookup(config, id) {
  const terminal = registry(config).get(id);
  if (!terminal) fail('no such terminal (shells close when the server restarts)', 404);
  return terminal;
}

function view(t) {
  const { id, hostId, hostLabel, cwd, cols, rows, state, createdAt, startedAt, endedAt, exitCode, error } = t;
  return { id, hostId, hostLabel, cwd, cols, rows, state, createdAt, startedAt, endedAt, exitCode, error, approvalScope: 'interactive-shell-until-closed' };
}

function publish(t, event) {
  const message = { ...event, seq: ++t.seq };
  for (const listener of t.listeners) {
    try { listener(message); } catch { t.listeners.delete(listener); }
  }
}

function setState(t, state) {
  t.state = state;
  publish(t, { type: 'state', terminal: view(t) });
}

function write(t, message) {
  if (!t.child?.stdin.writable) fail('terminal is not writable', 409);
  if (t.child.stdin.writableLength > 1024 * 1024) fail('terminal input queue is full', 429);
  t.child.stdin.write(JSON.stringify(message) + '\n');
}

function touch(config, t) {
  clearTimeout(t.timer);
  const configured = Number(config.terminal?.idleTimeoutMs);
  const timeout = Math.max(60_000, Math.min(Number.isFinite(configured) && configured > 0 ? configured : 30 * 60_000, 24 * 60 * 60_000));
  t.timer = setTimeout(() => {
    t.error = 'closed after inactivity';
    stopTerminal(config, t.id);
  }, timeout);
  t.timer.unref();
}

export function requestTerminal(config, { hostId = 'local', cwd = null, cols = 80, rows = 24 } = {}) {
  const all = registry(config);
  if ([...all.values()].filter((t) => ACTIVE.has(t.state)).length >= 8) fail('at most eight terminals can be open', 429);
  // Reclaim old terminal buffers; closed sessions are not durable conversation data.
  for (const [id, t] of all) if (!ACTIVE.has(t.state) && Date.now() - Date.parse(t.endedAt || t.createdAt) > 60 * 60_000) all.delete(id);
  while (all.size >= 32) {
    const oldest = [...all.values()].find((t) => !ACTIVE.has(t.state));
    if (!oldest) break;
    all.delete(oldest.id);
  }
  const target = terminalCommand(config, hostId, cwd);
  const t = { id: randomUUID(), hostId, hostLabel: target.host.label, hostSignature: JSON.stringify(target.host), cwd: cwd || (target.host.kind === 'local' ? target.cwd : null), ...dimensions(cols, rows), state: 'pending', createdAt: new Date().toISOString(), output: '', seq: 0, listeners: new Set(), child: null, timer: null };
  all.set(t.id, t);
  touch(config, t);
  return view(t);
}

export function listTerminals(config) { return [...registry(config).values()].map(view); }
export function getTerminal(config, id) { return view(lookup(config, id)); }

export function approveTerminal(config, id, { allow } = {}) {
  const t = lookup(config, id);
  if (t.state !== 'pending') fail('this terminal has already been decided', 409);
  if (typeof allow !== 'boolean') fail('allow must be a boolean');
  if (!allow) {
    clearTimeout(t.timer);
    t.endedAt = new Date().toISOString();
    setState(t, 'denied');
    return view(t);
  }
  // Resolve again: a removed/edited host never inherits an earlier command silently.
  const target = terminalCommand(config, t.hostId, t.cwd);
  if (JSON.stringify(target.host) !== t.hostSignature) fail('host changed; request a new terminal', 409);
  t.startedAt = new Date().toISOString();
  setState(t, 'starting');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|HOME|USER|LOGNAME|LANG|LC_[A-Z_]+|SHELL|SSH_AUTH_SOCK|TZ)$/.test(key)));
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  const child = spawn('python3', ['-u', BRIDGE], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  t.child = child;
  let lines = '', stderr = '';
  const decoder = new StringDecoder('utf8');
  child.stdin.on('error', () => {});
  child.stdout.on('data', (chunk) => {
    lines += chunk;
    let end;
    while ((end = lines.indexOf('\n')) >= 0) {
      const line = lines.slice(0, end);
      lines = lines.slice(end + 1);
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.type === 'ready' && t.state === 'starting') setState(t, 'running');
      if (message.type === 'data') {
        const data = decoder.write(Buffer.from(message.data, 'base64'));
        t.output = (t.output + data).slice(-MAX_OUTPUT);
        publish(t, { type: 'data', data });
      }
      if (message.type === 'exit') t.exitCode = message.code;
      if (message.type === 'error') t.error = String(message.message).slice(0, 1000);
    }
  });
  child.stderr.on('data', (chunk) => { if (stderr.length < 4096) stderr += chunk; });
  child.on('error', (error) => { t.error = error.code === 'ENOENT' ? 'Python 3 is required for the PTY terminal' : error.message; });
  child.on('close', (code, signal) => {
    clearTimeout(t.timer);
    const tail = decoder.end();
    if (tail) { t.output = (t.output + tail).slice(-MAX_OUTPUT); publish(t, { type: 'data', data: tail }); }
    t.endedAt = new Date().toISOString();
    t.exitCode ??= code;
    if (code && !t.error && stderr) t.error = stderr.trim().slice(0, 1000);
    setState(t, t.error ? 'error' : 'exited');
    publish(t, { type: 'exit', code: t.exitCode, signal });
    t.child = null;
  });
  write(t, { command: target.command, args: target.args, cwd: target.cwd, cols: t.cols, rows: t.rows });
  touch(config, t);
  return view(t);
}

export function inputTerminal(config, id, { data } = {}) {
  const t = lookup(config, id);
  if (t.state !== 'running') fail('terminal is not running', 409);
  if (typeof data !== 'string' || Buffer.byteLength(data) > MAX_INPUT) fail('terminal input must be a string of at most 64 KiB');
  write(t, { type: 'input', data: Buffer.from(data).toString('base64') });
  touch(config, t);
  return { ok: true };
}

export function resizeTerminal(config, id, { cols, rows } = {}) {
  const t = lookup(config, id);
  if (!ACTIVE.has(t.state)) fail('terminal is closed', 409);
  Object.assign(t, dimensions(cols, rows));
  if (t.child) write(t, { type: 'resize', cols, rows });
  return view(t);
}

export function stopTerminal(config, id) {
  const t = lookup(config, id);
  clearTimeout(t.timer);
  if (t.state === 'stopping') return view(t);
  if (t.child) {
    setState(t, 'stopping');
    try { write(t, { type: 'stop' }); } catch { t.child.kill('SIGTERM'); }
    const child = t.child;
    const timer = setTimeout(() => { if (child.exitCode == null) child.kill('SIGKILL'); }, 4000);
    timer.unref();
  } else if (ACTIVE.has(t.state)) {
    t.endedAt = new Date().toISOString();
    setState(t, 'denied');
  }
  return view(t);
}

export function subscribeTerminal(config, id, callback) {
  const t = lookup(config, id);
  t.listeners.add(callback);
  callback({ type: 'snapshot', terminal: view(t), output: t.output, seq: t.seq });
  return () => t.listeners.delete(callback);
}

export function closeTerminals(config) {
  for (const t of registry(config).values()) if (ACTIVE.has(t.state)) stopTerminal(config, t.id);
}
