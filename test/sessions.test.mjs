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
  const last = input.trim().split('\\n').filter((l) => l && !l.startsWith('(SpectraHub:')).pop();
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  out({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text' } } });
  for (const part of ['echo: ', last]) out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: part } } });
  out({ type: 'assistant', message: { id: 'm1', content: [{ type: 'thinking', thinking: 'najpierw przeczytam plik' }] } });
  out({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/tmp/x' } }] } });
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'zawartość x', is_error: false }] } });
  out({ type: 'assistant', message: { id: 'm2', content: [{ type: 'tool_use', id: 'tu2', name: 'Edit', input: { file_path: '/tmp/y', old_string: 'a', new_string: 'b' } }] } });
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu2', content: [{ type: 'text', text: 'edited' }] }] } });
  out({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.01, duration_ms: 5, usage: { input_tokens: 10, output_tokens: 3 } });
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

  let s;
  try {
  const sent = await api(`/api/sessions/${session.id}/send`, { method: 'POST', body: JSON.stringify({ to: ['claude'], text: 'pierwsza' }) });
  assert.equal(sent.status, 202);
  s = await waitIdle(session.id);
  const reply = s.log.at(-1);
  assert.equal(reply.who, 'claude');
  assert.equal(reply.s, 'echo: pierwsza');
  assert.equal(reply.status, 'done');
  const steps = reply.items.filter((i) => i.k === 'step');
  assert.deepEqual(steps.map((x) => [x.kind, x.name, x.status]), [['think', '', 'ok'], ['tool', 'Read', 'ok'], ['edit', 'Edit', 'ok']]);
  assert.equal(steps[1].title, '/tmp/x');
  assert.equal(steps[1].output, 'zawartość x');
  assert.deepEqual(steps[2].diff, { path: '/tmp/y', old: 'a', new: 'b' });
  assert.equal(steps[2].output, 'edited');
  assert.deepEqual(reply.items[0], { k: 'text', s: 'echo: pierwsza' }, 'items keep the order they happened in');
  assert.equal(reply.usage.cost, 0.01);

  await new Promise((r) => setTimeout(r, 50));
  } finally {
    controller.abort();  // an open event stream would keep the server from closing
    await stream;
  }
  assert.equal(events[0].type, 'snapshot');
  assert.ok(events.some((e) => e.type === 'delta' && e.s === 'pierwsza'));
  assert.ok(events.some((e) => e.type === 'step' && e.step.name === 'Read' && e.step.status === 'running'), 'a step shows before its result');
  assert.ok(events.some((e) => e.type === 'end' && e.status === 'done'));

  await api(`/api/sessions/${session.id}/send`, { method: 'POST', body: JSON.stringify({ to: ['claude'], text: 'druga' }) });
  s = await waitIdle(session.id);
  assert.equal(s.log.at(-1).s, 'echo: druga');
  const calls = readFileSync(argsLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const ref = s.agents.claude.ref;
  assert.deepEqual(calls.at(-2).slice(calls.at(-2).indexOf('--session-id'), calls.at(-2).indexOf('--session-id') + 2), ['--session-id', ref]);
  assert.deepEqual(calls.at(-1).slice(calls.at(-1).indexOf('--resume'), calls.at(-1).indexOf('--resume') + 2), ['--resume', ref]);
  assert.ok(!calls.at(-1).includes('--settings'), 'the agent keeps its own settings and hooks');
});

test('sessions are listed and survive on disk', async () => {
  const { sessions } = await (await api('/api/sessions')).json();
  assert.ok(sessions.length >= 1);
  assert.equal(sessions[0].title, 'test');
});

test('an unnamed session is named after its first line', async () => {
  const { session } = await (await api('/api/sessions', { method: 'POST', body: JSON.stringify({ agents: ['claude'] }) })).json();
  await api(`/api/sessions/${session.id}/send`, { method: 'POST', body: JSON.stringify({ to: ['claude'], text: '  sprawdź   dysk na serwerze  ' }) });
  const s = await waitIdle(session.id);
  assert.equal(s.title, 'sprawdź dysk na serwerze');
});

test('adapters turn each runtime events into the same steps', async () => {
  const { adapters } = await import('../src/agents.js');
  const run = (a, lines, method = 'line') => {
    const out = [];
    const self = Object.create(adapters[a]);
    for (const l of lines) self[method](l, (e) => out.push(e));
    return out;
  };
  // Codex: command with output and exit code, wrapper removed
  const cx = run('codex', [
    { type: 'item.started', item: { id: 'i1', type: 'command_execution', command: "/bin/bash -c 'echo hi && ls'", status: 'in_progress' } },
    { type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: "/bin/bash -c 'echo hi && ls'", aggregated_output: 'hi\n', exit_code: 2 } },
    { type: 'item.started', item: { id: 'i2', type: 'command_execution', command: '/bin/bash -lc uptime' } },
    { type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 1, reasoning_output_tokens: 1 } },
  ]);
  assert.equal(cx.splice(2, 1)[0].title, 'uptime', 'unquoted shell wrapper is removed too');
  assert.deepEqual(cx[0], { type: 'step', id: 'i1', kind: 'tool', name: 'bash', title: 'echo hi && ls' });
  assert.deepEqual(cx[1], { type: 'step-end', id: 'i1', ok: false, exit: 2, output: 'hi\n' });
  assert.deepEqual(cx[2], { type: 'usage', input: 5, output: 2 }, 'the context comes from Codex session file, not the turn total');
  // DeepSeek Harness: thinking, tool call and result joined by callId, tokens per step
  const ds = run('dsh', [
    { type: 'thinking', text: 'plan' },
    { type: 'tool_call', callId: 'c1', tool: 'bash', input: { command: 'uptime' } },
    { type: 'tool_result', callId: 'c1', status: 'completed', result: 'up 9 days' },
    { type: 'status', phase: 'step_end', usage: { inputTokens: 3, outputTokens: 2, cacheReadTokens: 4 } },
  ]);
  assert.equal(ds[0].kind, 'think');
  assert.deepEqual(ds[1], { type: 'step', id: 'c1', kind: 'tool', name: 'bash', title: 'uptime' });
  assert.deepEqual(ds[2], { type: 'step-end', id: 'c1', ok: true, output: 'up 9 days' });
  assert.deepEqual(ds[3], { type: 'usage', input: 7, output: 2, context: null });
  // OpenClaw: steps read from its session file
  const oc = run('openclaw', [
    { type: 'message', id: 'x', message: { role: 'assistant', content: [{ type: 'toolCall', id: 't1', name: 'read', arguments: { path: '/etc/hostname' } }] } },
    { type: 'message', id: 'y', message: { role: 'toolResult', toolCallId: 't1', isError: false, content: [{ type: 'text', text: 'v5' }] } },
  ], 'tail');
  assert.deepEqual(oc, [
    { type: 'step', id: 't1', kind: 'tool', name: 'read', title: '/etc/hostname' },
    { type: 'step-end', id: 't1', ok: true, output: 'v5' },
  ]);
});

test('projects hold sessions; sessions can be renamed, pinned, moved and deleted', async () => {
  const pr = await (await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Serwery' }) })).json();
  assert.equal(pr.project.name, 'Serwery');
  const { session } = await (await api('/api/sessions', { method: 'POST', body: JSON.stringify({ agents: ['claude'], title: 'do przeniesienia' }) })).json();
  const patched = await (await api(`/api/sessions/${session.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'nowa nazwa', pinned: true, projectId: pr.project.id }) })).json();
  assert.deepEqual([patched.session.title, patched.session.pinned, patched.session.projectId], ['nowa nazwa', true, pr.project.id]);
  assert.equal((await api(`/api/sessions/${session.id}`, { method: 'PATCH', body: JSON.stringify({ projectId: 'nope' }) })).status, 400);
  await api(`/api/projects/${pr.project.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'VPS' }) });
  assert.equal((await (await api('/api/projects')).json()).projects.find((p) => p.id === pr.project.id).name, 'VPS');
  await api(`/api/projects/${pr.project.id}`, { method: 'DELETE' });
  const listed = (await (await api('/api/sessions')).json()).sessions.find((x) => x.id === session.id);
  assert.equal(listed.projectId, null, 'removing a project keeps its sessions');
  assert.equal((await api(`/api/sessions/${session.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await api(`/api/sessions/${session.id}`)).status, 404);
  const { existsSync } = await import('node:fs');
  assert.ok(existsSync(join(dir, 'data', 'sessions', 'trash', `${session.id}.json`)), 'deleted sessions go to the trash');
});

test('uploads reach the agent as files on the server; only known files can be read back', async () => {
  const { session } = await (await api('/api/sessions', { method: 'POST', body: JSON.stringify({ agents: ['claude'] }) })).json();
  const up = await fetch(`${base}/api/sessions/${session.id}/files`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain', 'X-File-Name': encodeURIComponent('notatka ą.txt') }, body: 'treść pliku',
  });
  assert.equal(up.status, 201);
  const { file } = await up.json();
  assert.equal(file.name, 'notatka _.txt');
  const read = await api(`/api/sessions/${session.id}/files/${file.id}`);
  assert.equal(read.status, 200);
  assert.equal(await read.text(), 'treść pliku');
  assert.match(read.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await api(`/api/sessions/${session.id}/files/zzzz`)).status, 404);

  await api(`/api/sessions/${session.id}`, { method: 'PATCH', body: JSON.stringify({ models: { claude: { model: 'opus', effort: 'high' } } }) });
  await api(`/api/sessions/${session.id}/send`, { method: 'POST', body: JSON.stringify({ to: ['claude'], text: 'przeczytaj', attachments: [file.id] }) });
  await waitIdle(session.id);
  const prompt = readFileSync(join(dir, 'last-prompt.txt'), 'utf8');
  assert.ok(prompt.includes(file.path), 'the prompt names the uploaded file');
  const args = readFileSync(argsLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2), ['--model', 'opus']);
  assert.deepEqual(args.slice(args.indexOf('--effort'), args.indexOf('--effort') + 2), ['--effort', 'high']);
  const s = (await (await api(`/api/sessions/${session.id}`)).json()).session;
  assert.equal(s.agents.claude.usage.turns, 1);
  assert.equal(s.agents.claude.usage.cost, 0.01);
});

test('files agents write with shell commands or name in the reply reach the chat; attach hands any file over', async () => {
  const { writtenBy, namedIn } = await import('../src/sessions.js');
  assert.deepEqual(writtenBy("cat > /srv/x/strona.html <<'EOF'"), ['/srv/x/strona.html']);
  assert.deepEqual(writtenBy('ls > /dev/null'), []);
  assert.deepEqual(namedIn('gotowe: `/tmp/a.json` i /srv/b.html.'), ['/tmp/a.json', '/srv/b.html']);

  const { session } = await (await api('/api/sessions', { method: 'POST', body: JSON.stringify({ agents: ['claude'] }) })).json();
  const out = join(dir, 'raport.txt');
  writeFileSync(out, 'gotowy raport');
  const r = await api(`/api/sessions/${session.id}/attach`, { method: 'POST', body: JSON.stringify({ path: out, from: 'claude' }) });
  assert.equal(r.status, 201);
  const { file } = await r.json();
  assert.equal(file.from, 'claude');
  assert.equal((await (await api(`/api/sessions/${session.id}/files/${file.id}`)).text()), 'gotowy raport');
  assert.equal((await api(`/api/sessions/${session.id}/attach`, { method: 'POST', body: JSON.stringify({ path: join(dir, 'token') }) })).status, 403, 'secrets are refused');
  assert.equal((await api(`/api/sessions/${session.id}/attach`, { method: 'POST', body: JSON.stringify({ path: 'relative.txt' }) })).status, 400);
});

test('the owner can set the name the app greets', async () => {
  const res = await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ displayName: '  Ala ' }) });
  assert.deepEqual(await res.json(), { displayName: 'Ala' });
  const info = await (await api('/api/terminal/info')).json();
  assert.equal(info.displayName, 'Ala');
});
