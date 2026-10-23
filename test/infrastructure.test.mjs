import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureToken } from '../src/terminal.js';
import { closeTerminals } from '../src/pty.js';

const dir = mkdtempSync(join(tmpdir(), 'spectrahub-infrastructure-'));
const config = { dir, server: { host: '127.0.0.1', port: 0 }, terminal: { cwd: dir, shell: '/bin/sh' } };
let server, base, token;
const previousPath = process.env.PATH;
const previousHomes = process.env.SPECTRAHUB_SCAN_HOMES;
const controllers = [];

before(async () => {
  // The server scanner sees no installed agent; Python and stty are the only
  // external commands this synthetic installation needs for its real PTY test.
  const python = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  symlinkSync(python, join(bin, 'python3'));
  symlinkSync('/usr/bin/stty', join(bin, 'stty'));
  process.env.PATH = bin;
  process.env.SPECTRAHUB_SCAN_HOMES = dir;
  token = ensureToken(dir);
  const { start } = await import('../src/server.js');
  server = await start(config);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  controllers.forEach((c) => c.abort());
  closeTerminals(config);
  server?.closeAllConnections();
  if (server) await new Promise((resolve) => server.close(resolve));
  process.env.PATH = previousPath;
  if (previousHomes == null) delete process.env.SPECTRAHUB_SCAN_HOMES; else process.env.SPECTRAHUB_SCAN_HOMES = previousHomes;
  rmSync(dir, { recursive: true, force: true });
});

const api = (path, method = 'GET', body) => fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

async function until(check, label) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`timed out: ${label}`);
}

async function stream(path) {
  const controller = new AbortController();
  controllers.push(controller);
  const response = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  const events = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const done = (async () => {
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (frame.startsWith('data: ')) events.push(JSON.parse(frame.slice(6)));
        }
      }
    } catch (error) { if (error.name !== 'AbortError') throw error; }
  })();
  return { events, close: async () => { controller.abort(); await done; } };
}

test('host and PTY routes require owner authentication', async () => {
  for (const path of ['/api/hosts', '/api/hosts/local/stats', '/api/terminal/sessions']) {
    assert.equal((await fetch(base + path)).status, 401);
    assert.equal((await fetch(base + path, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  }
  assert.equal((await fetch(base + '/api/terminal/sessions', { method: 'POST', body: '{}' })).status, 401);
});

test('hosts can be saved, changed and removed; local and SSH argument boundaries are enforced', async () => {
  const list = await (await api('/api/hosts')).json();
  assert.equal(list.hosts[0].id, 'local');
  assert.equal((await api('/api/hosts/local', 'DELETE')).status, 400);
  assert.equal((await api('/api/hosts/local', 'PATCH', { label: 'other' })).status, 400);
  for (const payload of [null, [], { address: '-oProxyCommand=bad' }, { address: 'a;touch /tmp/no' }, { address: 'test', port: 65536 }]) {
    assert.equal((await api('/api/hosts', 'POST', payload)).status, 400);
  }
  const create = await api('/api/hosts', 'POST', { address: 'synthetic.example.test', label: 'Lab' });
  assert.equal(create.status, 201);
  const { host } = await create.json();
  assert.equal((await api(`/api/hosts/${host.id}`, 'PATCH', { label: 'Updated' })).status, 200);
  assert.equal((await (await api('/api/hosts')).json()).hosts.find((h) => h.id === host.id).label, 'Updated');
  const stats = await (await api('/api/hosts/local/stats')).json();
  assert.ok(stats.stats.memory.total > 0 && stats.stats.disk.total > 0);
  const terminal = (await (await api('/api/terminal/sessions', 'POST', { hostId: host.id })).json()).terminal;
  assert.equal((await api(`/api/hosts/${host.id}`, 'DELETE')).status, 409);
  assert.equal((await api(`/api/terminal/sessions/${terminal.id}/approve`, 'POST', { allow: false })).status, 200);
  assert.equal((await api(`/api/hosts/${host.id}`, 'DELETE')).status, 200);
});

test('terminal requests remain pending, reject input and cannot run after denial', async () => {
  for (const body of [null, [], { cols: 2 }]) assert.equal((await api('/api/terminal/sessions', 'POST', body)).status, 400);
  const response = await api('/api/terminal/sessions', 'POST', { hostId: 'local' });
  assert.equal(response.status, 201);
  const { terminal } = await response.json();
  assert.equal(terminal.state, 'pending');
  const path = `/api/terminal/sessions/${terminal.id}`;
  assert.equal((await api(path + '/input', 'POST', { data: 'touch should-not-exist\n' })).status, 409);
  assert.equal(existsSync(join(dir, 'should-not-exist')), false);
  assert.equal((await api(path + '/approve', 'POST', { allow: false })).status, 200);
  assert.equal((await api(path + '/approve', 'POST', { allow: true })).status, 409);
  assert.equal((await (await api(path)).json()).terminal.state, 'denied');
});

test('approved PTY works through HTTP and SSE, resizes, reconnects and closes', async () => {
  const { terminal } = await (await api('/api/terminal/sessions', 'POST', { cols: 88, rows: 29 })).json();
  const path = `/api/terminal/sessions/${terminal.id}`;
  let sse = await stream(path + '/events');
  await until(() => sse.events.some((e) => e.type === 'snapshot' && e.terminal.state === 'pending'), 'pending snapshot');
  assert.equal((await api(path + '/approve', 'POST', { allow: true })).status, 200);
  await until(() => sse.events.some((e) => e.type === 'state' && e.terminal.state === 'running'), 'running state');
  assert.equal((await api(path + '/input', 'POST', { data: "test -t 0 && printf 'HTTP_%s\\n' 'PTY'; stty size\n" })).status, 200);
  const output = () => sse.events.filter((e) => e.type === 'data').map((e) => e.data).join('');
  await until(() => output().includes('HTTP_PTY') && /29 88\r?\n/.test(output()), 'actual tty output');
  assert.equal((await api(path + '/resize', 'POST', { cols: 97, rows: 37 })).status, 200);
  await api(path + '/input', 'POST', { data: 'stty size\n' });
  await until(() => /37 97\r?\n/.test(output()), 'resized output');
  await sse.close();
  await api(path + '/input', 'POST', { data: "printf 'DETACHED_%s\\n' 'OK'\n" });
  await new Promise((resolve) => setTimeout(resolve, 100));
  sse = await stream(path + '/events');
  await until(() => sse.events.some((e) => e.type === 'snapshot' && e.output.includes('DETACHED_OK')), 'reconnect buffer');
  assert.equal((await api(path, 'DELETE')).status, 200);
  await until(() => sse.events.some((e) => e.type === 'exit'), 'exit event');
  assert.equal((await api(path + '/input', 'POST', { data: 'no\n' })).status, 409);
  await sse.close();
});
