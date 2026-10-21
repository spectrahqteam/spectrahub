// Read-only terminal: an exact allowlist of command lines, run without a shell, streamed as SSE.
// No PTY (that would need a native dependency), so the client says "bez TTY" instead of pretending.
import { spawn } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, hostname, userInfo } from 'node:os';
import { join } from 'node:path';

const TIMEOUT_MS = 15_000;
const MAX_OUTPUT = 256 * 1024;

// Each allowed line maps to a fixed argv. Nothing typed by the user reaches argv.
const ALLOWED = {
  uptime: ['uptime'],
  df: ['df', '-h'],
  'df -h': ['df', '-h'],
  free: ['free', '-m'],
  'free -m': ['free', '-m'],
  whoami: ['whoami'],
  hostname: ['hostname'],
  date: ['date'],
  'uname -a': ['uname', '-a'],
  ls: ['ls', '--color=always'],
  'ls -la': ['ls', '-la', '--color=always'],
  'git status': ['git', '-c', 'color.status=always', 'status', '--short', '--branch'],
  'git log': ['git', 'log', '--oneline', '--decorate', '-n', '20', '--color=always'],
};

export function allowedCommands() {
  return [...Object.keys(ALLOWED), 'pwd'];
}

const PAIR_TTL_MS = 15 * 60_000;

// A login link carries a one-time pairing code, never the token itself. It sits in the #fragment,
// which browsers do not send to the server, and dies on first use or after 15 minutes.
export function loginLink(config, code) {
  const base = (config.publicUrl || `http://${config.server.host}:${config.server.port}`).replace(/\/+$/, '');
  return `${base}/terminal#pair=${code}`;
}

function pairFile(dir) {
  return join(dir, 'pairing.json');
}

function readPairs(dir) {
  try { return JSON.parse(readFileSync(pairFile(dir), 'utf8')).filter((p) => p.expires > Date.now() && !p.used); } catch { return []; }
}

function writePairs(dir, pairs) {
  writeFileSync(pairFile(dir), JSON.stringify(pairs) + '\n', { mode: 0o600 });
  chmodSync(pairFile(dir), 0o600);
}

export function createPairing(dir, ttlMs = PAIR_TTL_MS) {
  ensureToken(dir);
  const code = randomBytes(18).toString('base64url');
  writePairs(dir, [...readPairs(dir), { hash: digest(code).toString('hex'), expires: Date.now() + ttlMs, used: false }]);
  return code;
}

// Swaps a valid code for the owner token, once.
export function redeemPairing(dir, code) {
  if (typeof code !== 'string' || !code) return null;
  const hash = digest(code).toString('hex');
  const pairs = readPairs(dir);
  const hit = pairs.find((p) => p.hash === hash);
  if (!hit) return null;
  writePairs(dir, pairs.filter((p) => p !== hit));
  return ensureToken(dir);
}

export function tokenPath(dir) {
  return join(dir, 'token');
}

// Creates the owner token on first call; --rotate replaces it. The file is readable by the owner only.
export function ensureToken(dir, { rotate = false } = {}) {
  const file = tokenPath(dir);
  if (!rotate && existsSync(file)) return readFileSync(file, 'utf8').trim();
  const token = randomBytes(24).toString('base64url');
  writeFileSync(file, token + '\n', { mode: 0o600 });
  chmodSync(file, 0o600);
  return token;
}

function readToken(dir) {
  const file = tokenPath(dir);
  if (!existsSync(file)) return null;
  const token = readFileSync(file, 'utf8').trim();
  return token || null;
}

const digest = (s) => createHash('sha256').update(s).digest();

// 'disabled' when no token exists yet, 'denied' on a wrong or missing header, 'ok' otherwise.
export function authorize(req, dir) {
  const token = readToken(dir);
  if (!token) return 'disabled';
  const header = req.headers.authorization ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!given) return 'denied';
  return timingSafeEqual(digest(given), digest(token)) ? 'ok' : 'denied';
}

export function terminalInfo(config) {
  const cwd = config.terminal?.cwd ?? process.cwd();
  const home = homedir();
  return {
    user: userInfo().username,
    host: hostname(),
    cwd,
    cwdShort: cwd === home ? '~' : cwd.startsWith(home + '/') ? '~' + cwd.slice(home.length) : cwd,
    tty: false,
    commands: allowedCommands(),
  };
}

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Streams one allowed command. The child is killed when the client goes away or the time runs out.
export function runLine(config, line, res) {
  const cwd = config.terminal?.cwd ?? process.cwd();
  const key = String(line ?? '').trim().replace(/\s+/g, ' ');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });

  if (key === 'pwd') {
    sse(res, 'out', { s: cwd + '\n' });
    sse(res, 'exit', { code: 0, ms: 0 });
    return res.end();
  }
  const argv = ALLOWED[key];
  if (!argv) {
    sse(res, 'denied', { reason: 'not allowed', commands: allowedCommands() });
    return res.end();
  }

  const started = Date.now();
  let sent = 0;
  let finished = false;
  const child = spawn(argv[0], argv.slice(1), {
    cwd,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', HOME: homedir() },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
  const pipe = (stream, event) => stream.on('data', (chunk) => {
    if (sent >= MAX_OUTPUT) return;
    const s = chunk.toString('utf8');
    sent += s.length;
    sse(res, event, { s: sent > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT - (sent - s.length)) + '\n…output truncated\n' : s });
  });
  pipe(child.stdout, 'out');
  pipe(child.stderr, 'err');
  child.on('error', (err) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    sse(res, 'err', { s: `${argv[0]}: ${err.code === 'ENOENT' ? 'command not found' : err.message}\n` });
    sse(res, 'exit', { code: 127, ms: Date.now() - started });
    res.end();
  });
  child.on('close', (code, signal) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    sse(res, 'exit', { code: code ?? 128, signal, ms: Date.now() - started });
    res.end();
  });
  res.on('close', () => {
    if (!finished) child.kill('SIGTERM');
  });
}
