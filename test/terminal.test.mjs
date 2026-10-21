// Terminal: owner-only, exact allowlist, streamed output, no shell.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start } from '../src/server.js';
import { ensureToken, tokenPath } from '../src/terminal.js';

let server;
let base;
let token;
const dir = mkdtempSync(join(tmpdir(), 'spectrahub-term-'));

before(async () => {
  server = await start({ dir, server: { host: '127.0.0.1', port: 0 }, terminal: { cwd: dir } });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

const run = (line, auth = token) => fetch(`${base}/api/terminal/run`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
  body: JSON.stringify({ line }),
});

function events(text) {
  return text.split('\n\n').filter(Boolean).map((frame) => ({
    event: /^event: (.*)$/m.exec(frame)[1],
    data: JSON.parse(/^data: (.*)$/m.exec(frame)[1]),
  }));
}

test('terminal is disabled until the owner creates a token', async () => {
  const res = await run('uptime', 'anything');
  assert.equal(res.status, 403);
});

test('token file is created owner-only', () => {
  token = ensureToken(dir);
  assert.ok(token.length >= 24);
  assert.equal(statSync(tokenPath(dir)).mode & 0o777, 0o600);
  assert.equal(ensureToken(dir), token, 'second call keeps the same token');
});

test('missing or wrong token is refused', async () => {
  assert.equal((await run('uptime', null)).status, 401);
  assert.equal((await run('uptime', token + 'x')).status, 401);
  assert.equal((await fetch(`${base}/api/terminal/info`)).status, 401);
});

test('info describes the prompt and the allowed commands', async () => {
  const res = await fetch(`${base}/api/terminal/info`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const info = await res.json();
  assert.equal(info.tty, false);
  assert.ok(info.user && info.host);
  assert.ok(info.commands.includes('uptime'));
});

test('an allowed command streams output and its exit code', async () => {
  const res = await run('pwd');
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const ev = events(await res.text());
  assert.equal(ev[0].event, 'out');
  assert.equal(ev[0].data.s.trim(), dir);
  assert.deepEqual(ev.at(-1).event, 'exit');

  const ev2 = events(await (await run('  date ')).text());
  assert.ok(ev2.some((e) => e.event === 'out' && e.data.s.trim()));
  assert.equal(ev2.at(-1).data.code, 0);
});

test('anything off the list is denied, including shell tricks', async () => {
  for (const line of ['rm -rf /', 'uptime; id', 'ls /etc', 'cat /etc/passwd', 'uptime && id', '$(id)', 'git push']) {
    const ev = events(await (await run(line)).text());
    assert.equal(ev.length, 1, line);
    assert.equal(ev[0].event, 'denied', line);
  }
});

test('the terminal page is served without its extension', async () => {
  const res = await fetch(`${base}/terminal`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /terminal\.js/);
});
