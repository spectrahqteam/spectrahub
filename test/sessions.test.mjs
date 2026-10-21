// Sessions with agents, against fake runtimes on PATH: no network, no cost.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'spectrahub-sess-'));
const bin = join(dir, 'bin');
const argsLog = join(dir, 'claude-args.log');

// A stand-in for Claude Code: answers "echo: <last line of the prompt>" in its stream-json format.
const fakeClaude = `#!${process.execPath}
const fs = require('fs');
if (process.argv.includes('--version')) { console.log('9.9.9 (fake)'); process.exit(0); }
fs.appendFileSync(${JSON.stringify(argsLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  const last = input.trim().split('\\n').pop();
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  out({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text' } } });
  for (const part of ['echo: ', last]) out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: part } } });
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/tmp/x' } }] } });
  out({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0 });
  fs.writeFileSync(${JSON.stringify(join(dir, 'last-prompt.txt'))}, input);
});
`;

let server;
let base;
let token;
let auth;

before(async () => {
  const { mkdirSync } = await import('node:fs');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), fakeClaude);
  chmodSync(join(bin, 'claude'), 0o755);
  process.env.PATH = bin;  // only the fake runtime is visible
  const { start } = await import('../src/server.js');
  const { ensureToken } = await import('../src/terminal.js');
  token = ensureToken(dir);
  auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  server = await start({ dir, server: { host: '127.0.0.1', port: 0 }, agents: { cwd: dir } });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

const api = (path, opts = {}) => fetch(base + path, { ...opts, headers: { ...auth, ...(opts.headers ?? {}) } });

async function waitIdle(id) {
  for (let i = 0; i < 100; i++) {
    const { session } = await (await api(`/api/sessions/${id}`)).json();
    if (Object.values(session.agents).every((a) => a.state === 'idle') && session.log.every((e) => e.status !== 'running')) return session;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('agent did not finish');
}

test('agents and sessions need the owner token', async () => {
  assert.equal((await fetch(`${base}/api/agents`)).status, 401);
  assert.equal((await fetch(`${base}/api/sessions`)).status, 401);
});

test('the scanner reports what is installed and what can be driven', async () => {
  const { agents } = await (await api('/api/agents?fresh')).json();
  const claude = agents.find((a) => a.id === 'claude');
  assert.equal(claude.installed, true);
  assert.equal(claude.ready, true);
  assert.match(claude.version, /fake/);
  assert.equal(agents.find((a) => a.id === 'codex').installed, false);
  assert.deepEqual(agents.map((a) => a.id).sort(), ['claude', 'codex', 'dsh', 'openclaw']);
  assert.ok(agents.every((a) => !('launch' in JSON.parse(JSON.stringify(a)))), 'launch details stay on the server');
});

test('a session starts only with agents that are ready', async () => {
  const bad = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ agents: ['codex'] }) });
  assert.equal(bad.status, 400);
});

test('a turn streams the reply, then the agent resumes its own session', async () => {
  const created = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ agents: ['claude'], title: 'test' }) });
  assert.equal(created.status, 201);
  const { session } = await created.json();

  // events stream: snapshot first, then the reply as it comes
  const controller = new AbortController();
  const events = [];
  const stream = api(`/api/sessions/${session.id}/events`, { signal: controller.signal }).then(async (res) => {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (frame.startsWith('data: ')) events.push(JSON.parse(frame.slice(6)));
      }
    }
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, 100));

  const sent = await api(`/api/sessions/${session.id}/send`, { method: 'POST', body: JSON.stringify({ to: ['claude'], text: 'pierwsza' }) });
  assert.equal(sent.status, 202);
  let s = await waitIdle(session.id);
  const reply = s.log.at(-1);
  assert.equal(reply.who, 'claude');
  assert.equal(reply.s, 'echo: pierwsza');
  assert.deepEqual(reply.tools, ['Read /tmp/x']);
  assert.equal(reply.status, 'done');

  await new Promise((r) => setTimeout(r, 50));
  controller.abort();
  await stream;
  assert.equal(events[0].type, 'snapshot');
  assert.ok(events.some((e) => e.type === 'delta' && e.s === 'pierwsza'));
  assert.ok(events.some((e) => e.type === 'end' && e.status === 'done'));

  await api(`/api/sessions/${session.id}/send`, { method: 'POST', body: JSON.stringify({ to: ['claude'], text: 'druga' }) });
  s = await waitIdle(session.id);
  assert.equal(s.log.at(-1).s, 'echo: druga');
  const calls = readFileSync(argsLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const ref = s.agents.claude.ref;
  assert.deepEqual(calls.at(-2).slice(calls.at(-2).indexOf('--session-id'), calls.at(-2).indexOf('--session-id') + 2), ['--session-id', ref]);
  assert.deepEqual(calls.at(-1).slice(calls.at(-1).indexOf('--resume'), calls.at(-1).indexOf('--resume') + 2), ['--resume', ref]);
  assert.ok(calls.at(-1).includes('--settings'), 'host hooks are switched off');
});

test('sessions are listed and survive on disk', async () => {
  const { sessions } = await (await api('/api/sessions')).json();
  assert.ok(sessions.length >= 1);
  assert.equal(sessions[0].title, 'test');
});
