// Sessions with agents, against fake runtimes on PATH: no network, no cost.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'spectrahub-sess-'));
const bin = join(dir, 'bin');
const argsLog = join(dir, 'claude-args.log');
const keyLog = join(dir, 'claude-key.log');

// A stand-in for Claude Code: answers "echo: <last line of the prompt>" in its stream-json format.
const fakeClaude = `#!${process.execPath}
const fs = require('fs');
if (process.argv.includes('--version')) { console.log('9.9.9 (fake)'); process.exit(0); }
if (process.argv.includes('--help')) { console.log('  --input-format <format>\\n  --permission-prompt-tool <tool>\\n  --effort <level>  Effort level (low, medium, high, xhigh, max)'); process.exit(0); }
fs.appendFileSync(${JSON.stringify(argsLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
let buf = '';
let handled = false;
let waiting = null;
process.stdin.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.type === 'control_response' && waiting) { const w = waiting; waiting = null; w(o.response.response); }
    else if (o.type === 'user' && !handled) { handled = true; turn(String(o.message.content)); }
  }
});
function reply(text) {
  out({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text' } } });
  out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
  out({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.01, duration_ms: 5, usage: { input_tokens: 10, output_tokens: 3 } });
}
function turn(input) {
  fs.appendFileSync(${JSON.stringify(keyLog)}, (process.env.ANTHROPIC_API_KEY ?? '-') + '\\n');
  fs.writeFileSync(${JSON.stringify(join(dir, 'last-prompt.txt'))}, input);
  if (input.includes('LIMIT') && !process.env.ANTHROPIC_API_KEY) {
    out({ type: 'result', subtype: 'success', is_error: true, result: 'Claude AI usage limit reached|1792700000' });
    return;
  }
  if (input.includes('Ankieta od użytkownika')) return reply('2\\nBo druga opcja jest prostsza.');
  if (input.includes('ASK')) {
    out({ type: 'control_request', request_id: 'req-1', request: { subtype: 'can_use_tool', tool_name: 'Bash', display_name: 'Bash', input: { command: 'touch /tmp/x', description: 'Create x' },
      description: 'Create x', permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'touch /tmp/x' }], behavior: 'allow', destination: 'localSettings' }], tool_use_id: 'tu9' } });
    waiting = (r) => reply('decision: ' + r.behavior + ' ' + JSON.stringify(r.updatedPermissions ?? null));
    return;
  }
  const last = input.trim().split('\\n').filter((l) => l && !l.startsWith('(SpectraHub:')).pop();
  out({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text' } } });
  for (const part of ['echo: ', last]) out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: part } } });
  out({ type: 'assistant', message: { id: 'm1', content: [{ type: 'thinking', thinking: 'najpierw przeczytam plik' }] } });
  out({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/tmp/x' } }] } });
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'zawartość x', is_error: false }] } });
  out({ type: 'assistant', message: { id: 'm2', content: [{ type: 'tool_use', id: 'tu2', name: 'Edit', input: { file_path: '/tmp/y', old_string: 'a', new_string: 'b' } }] } });
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu2', content: [{ type: 'text', text: 'edited' }] }] } });
  out({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.01, duration_ms: 5, usage: { input_tokens: 10, output_tokens: 3 } });
}
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
  process.env.SPECTRAHUB_SCAN_HOMES = dir;  // and no agent from this server's homes
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

test('terminal helper sessions retain their advisory scope through the ordinary chat API', async () => {
  const { createSession } = await import('../src/sessions.js');
  const config = { dir, agents: { cwd: dir } };
  const { session } = await createSession(config, { agents: ['claude'], cwd: dir, terminalAssistant: true, perms: { claude: 'full' } });
  assert.equal(session.terminalAssistant, true);
  assert.equal(session.agents.claude.perm, 'read');
  for (const patch of [{ perms: { claude: 'full' } }, { perms: { claude: 'write' } }, { cwd: dir }]) {
    assert.equal((await api(`/api/sessions/${session.id}`, { method: 'PATCH', body: JSON.stringify(patch) })).status, 403);
  }
  assert.equal((await api(`/api/sessions/${session.id}/send`, { method: 'POST', body: JSON.stringify({ to: ['claude'], text: 'Explain a shell command.' }) })).status, 202);
  const finished = await waitIdle(session.id);
  assert.equal(finished.agents.claude.perm, 'read');
  assert.equal(finished.terminalAssistant, true);
  const calls = readFileSync(argsLog, 'utf8').trim().split('\n').map(JSON.parse);
  const last = calls.at(-1);
  assert.ok(last.includes('--tools'), 'advisory scope reaches the runtime, including normal chat sends');
  assert.equal(last[last.indexOf('--tools') + 1], '');
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
  // Claude Code too old to ask: the message goes as plain text, nothing waits for answers
  const oldArgs = adapters.claude.argv('r', false, { asks: false });
  assert.ok(!oldArgs.includes('--input-format') && !oldArgs.includes('--permission-prompt-tool'));
  assert.ok(adapters.claude.argv('r', false, {}).includes('--permission-prompt-tool'));
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
  const secret = join(dir, '.env.replacement');
  writeFileSync(secret, 'FIXTURE_SECRET=synthetic-only');
  rmSync(out);
  symlinkSync(secret, out);
  const replaced = await api(`/api/sessions/${session.id}/files/${file.id}`);
  assert.equal(replaced.status, 403, 'a known attachment is checked again after becoming a symlink to a secret');
  assert.ok(!(await replaced.text()).includes('synthetic-only'), 'secret bytes are never returned');

});

test('the owner can set the name the app greets', async () => {
  const res = await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ displayName: '  Ala ' }) });
  assert.deepEqual(await res.json(), { displayName: 'Ala' });
  const info = await (await api('/api/terminal/info')).json();
  assert.equal(info.displayName, 'Ala');
});

test('each agent signs in the way the owner picks: subscription, API key, or auto when the plan runs out', async () => {
  const lastKey = () => readFileSync(keyLog, 'utf8').trim().split('\n').at(-1);
  const turn = async (text) => {
    const { session } = await (await api('/api/sessions', { method: 'POST', body: JSON.stringify({ agents: ['claude'] }) })).json();
    await api(`/api/sessions/${session.id}/send`, { method: 'POST', body: JSON.stringify({ to: ['claude'], text }) });
    return waitIdle(session.id);
  };
  const key = 'sk-ant-api03-' + 'x'.repeat(40);
  assert.equal((await api('/api/connections/claude/key', { method: 'PATCH', body: JSON.stringify({ key: 'nie-klucz' }) })).status, 400);
  assert.equal((await api('/api/connections/claude/key', { method: 'PATCH', body: JSON.stringify({ key }) })).status, 200);
  const listed = await (await api('/api/connections')).text();
  assert.ok(!listed.includes(key), 'the key never goes back to the browser');
  assert.equal(JSON.parse(listed).agents.find((a) => a.id === 'claude').api.saved, true);

  await api('/api/connections/claude', { method: 'PATCH', body: JSON.stringify({ mode: 'api' }) });
  let s = await turn('na kluczu');
  assert.equal(lastKey(), key);
  assert.equal(s.log.at(-1).via, 'api');

  process.env.ANTHROPIC_API_KEY = 'sk-ant-z-srodowiska-' + 'y'.repeat(30);
  await api('/api/connections/claude', { method: 'PATCH', body: JSON.stringify({ mode: 'subscription' }) });
  await turn('na subskrypcji');
  assert.equal(lastKey(), '-', 'a key in the environment does not override the subscription');
  delete process.env.ANTHROPIC_API_KEY;

  await api('/api/connections/claude', { method: 'PATCH', body: JSON.stringify({ mode: 'auto' }) });
  s = await turn('LIMIT');
  const reply = s.log.at(-1);
  assert.equal(reply.status, 'done');
  assert.equal(reply.via, 'api');
  assert.ok(reply.items.some((i) => i.k === 'step' && /limit subskrypcji/.test(i.title)), 'the switch is shown in the reply');
  assert.match(reply.s, /echo: LIMIT/);

  await api('/api/connections/claude', { method: 'PATCH', body: JSON.stringify({ mode: null }) });
  await api('/api/connections/claude/key', { method: 'PATCH', body: JSON.stringify({ key: '' }) });
  await turn('jak agent');
  assert.equal(lastKey(), '-', 'with no mode set nothing is handed over');
});

test('a limited OpenClaw turn runs embedded with a config that includes the owner\'s and only adds denials', async () => {
  const { adapters } = await import('../src/agents.js');
  const args = adapters.openclaw.argv('r1', true, { agent: 'a', file: '/tmp/m', perm: 'read' });
  assert.equal(args[1], '--local');
  assert.ok(!adapters.openclaw.argv('r1', true, { agent: 'a', file: '/tmp/m', perm: 'full' }).includes('--local'));
  const out = [];
  adapters.openclaw.whole('[agents] starting\n{\n "status": "ok",\n "result": { "payloads": [{ "text": "hej" }] }\n}\n', (e) => out.push(e));
  assert.deepEqual(out.slice(0, 1), [{ type: 'text', s: 'hej', block: true }], 'log lines before the answer are skipped');
  // an embedded run answers without the gateway envelope, and the turn ends once the document is whole
  const local = '{\n  "payloads": [{ "text": "ok" }],\n  "meta": { "agentMeta": { "provider": "deepseek", "model": "v4", "usage": { "input": 5, "output": 1 } } }\n}\n';
  assert.equal(adapters.openclaw.complete(local.slice(0, 30)), false);
  assert.equal(adapters.openclaw.complete('[log]\n' + local), true);
  const got = [];
  adapters.openclaw.whole(local, (e) => got.push(e));
  assert.deepEqual(got.map((e) => e.type), ['text', 'usage', 'done']);
  assert.equal(got[1].model, 'deepseek/v4');
});

test('an agent asks for permission while it works and the owner answers in the chat', async () => {
  const { session } = await (await api('/api/sessions', { method: 'POST', body: JSON.stringify({ agents: ['claude'] }) })).json();
  await api(`/api/sessions/${session.id}/send`, { method: 'POST', body: JSON.stringify({ to: ['claude'], text: 'ASK about it' }) });
  let ask;
  for (let i = 0; i < 100 && !ask; i++) {
    const { session: s } = await (await api(`/api/sessions/${session.id}`)).json();
    ask = s.log.at(-1).items?.find((x) => x.k === 'ask');
    if (!ask) await new Promise((r) => setTimeout(r, 50));
  }
  assert.deepEqual([ask.kind, ask.tool, ask.title, ask.status, ask.always], ['permission', 'Bash', 'touch /tmp/x', 'waiting', true]);
  const say = (body) => api(`/api/sessions/${session.id}/answer`, { method: 'POST', body: JSON.stringify(body) });
  assert.equal((await say({ agent: 'claude', ask: ask.id, decision: 'maybe' })).status, 400);
  assert.equal((await say({ agent: 'claude', ask: ask.id, decision: 'always' })).status, 200);
  assert.equal((await say({ agent: 'claude', ask: ask.id, decision: 'allow' })).status, 409, 'one answer per question');
  const s = await waitIdle(session.id);
  const reply = s.log.at(-1);
  assert.match(reply.s, /decision: allow/);
  assert.match(reply.s, /"destination":"session"/, '"always" stays in this session; the agent\'s settings are not written');
  assert.equal(reply.items.find((x) => x.k === 'ask').status, 'always');
});

test('a poll: every agent picks an option and says why; the owner can vote too', async () => {
  const { session } = await (await api('/api/sessions', { method: 'POST', body: JSON.stringify({ agents: ['claude'] }) })).json();
  assert.equal((await api(`/api/sessions/${session.id}/poll`, { method: 'POST', body: JSON.stringify({ question: 'Który?', options: ['A'] }) })).status, 400);
  assert.equal((await api(`/api/sessions/${session.id}/poll`, { method: 'POST', body: JSON.stringify({ question: 'Który wybrać?', options: ['Pierwszy', 'Drugi'] }) })).status, 202);
  let s = await waitIdle(session.id);
  const p = s.log.find((e) => e.poll);
  assert.match(readFileSync(join(dir, 'last-prompt.txt'), 'utf8'), /1\) Pierwszy\n2\) Drugi/);
  assert.deepEqual(p.poll.votes.claude, { option: 1, reason: 'Bo druga opcja jest prostsza.' });
  const { readVote } = await import('../src/sessions.js');
  const five = ['0–20%', '20–40%', '40–60%', '60–70%', '80–100%'];
  assert.deepEqual(readVote('Zaczynam audyt.\nSprawdzam testy (42/42).\n\n**4**\nBo brakuje terminala.', five), { option: 3, reason: 'Bo brakuje terminala.' }, 'progress notes before the vote do not count');
  assert.equal(readVote('Opcja 2: bo tak', five).option, 1);
  assert.equal(readVote('nie wiem', five).option, null);
  assert.equal((await api(`/api/sessions/${session.id}/vote`, { method: 'POST', body: JSON.stringify({ n: p.n, option: 0 }) })).status, 200);
  s = (await (await api(`/api/sessions/${session.id}`)).json()).session;
  assert.equal(s.log.find((e) => e.poll).poll.votes.you.option, 0);
});
