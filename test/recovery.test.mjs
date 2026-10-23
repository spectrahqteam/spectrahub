// A real HTTP-process crash must not repeat a runtime invocation or lose its approval.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureToken } from '../src/terminal.js';

const serverModule = new URL('../src/server.js', import.meta.url).href;
const sessionsModule = new URL('../src/sessions.js', import.meta.url).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label = 'condition') {
  for (let i = 0; i < 150; i++) { const value = await fn(); if (value) return value; await sleep(40); }
  throw new Error(`timed out waiting for ${label}`);
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'spectrahub-recovery-'));
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  const dir = join(root, 'data');
  for (const p of [bin, home, dir]) mkdirSync(p);
  const token = ensureToken(dir);
  const calls = join(root, 'calls');
  const decisions = join(root, 'decisions');
  writeFileSync(decisions, '');
  const release = join(root, 'release');
  const script = `#!${process.execPath}
const fs = require('node:fs');
if (process.argv.includes('--version')) { console.log('9.9.9 (fake)'); process.exit(0); }
if (process.argv.includes('--help')) { console.log('--input-format <format> --permission-prompt-tool <tool>'); process.exit(0); }
const out = (x) => process.stdout.write(JSON.stringify(x) + '\\n');
const text = (s) => out({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:s}}});
const done = () => out({type:'result',subtype:'success',result:'ok',is_error:false});
let input = '';
let called = false;
process.stdin.on('data', (b) => {
  input += b;
  let at;
  while ((at = input.indexOf('\\n')) >= 0) {
    const line = input.slice(0,at); input = input.slice(at+1);
    const m = JSON.parse(line);
    if (m.type === 'control_response') { fs.appendFileSync(${JSON.stringify(decisions)}, m.response.response.behavior + '\\n'); text('after:' + m.response.response.behavior); done(); }
    if (m.type !== 'user' || called) continue;
    called = true;
    fs.appendFileSync(${JSON.stringify(calls)}, 'invoked\\n');
    text('before;');
    if (m.message.content.includes('ASK')) {
      out({type:'control_request',request_id:'ask-recover',request:{subtype:'can_use_tool',tool_name:'Bash',input:{command:'fixture-write'},tool_use_id:'tool-recover'}});
    } else {
      const timer = setInterval(() => { if (fs.existsSync(${JSON.stringify(release)})) { clearInterval(timer); text('after;'); done(); } }, 30);
    }
  }
});
`;
  writeFileSync(join(bin, 'claude'), script); chmodSync(join(bin, 'claude'), 0o755);
  const config = { dir, server: { host: '127.0.0.1', port: 0 }, agents: { cwd: root } };
  const env = { ...process.env, PATH: bin, HOME: home, SPECTRAHUB_SCAN_HOMES: home };
  delete env.CLAUDE_CONFIG_DIR;
  let child;
  let base;
  const api = (path, opts = {}) => fetch(base + path, { ...opts, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  async function start() {
    child = spawn(process.execPath, ['--input-type=module', '-e', `import { start } from ${JSON.stringify(serverModule)}; import {recoverRuns} from ${JSON.stringify(sessionsModule)}; const config=${JSON.stringify(config)}; const server=await start(config); recoverRuns(config); console.log(server.address().port);`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '';
    child.stdout.on('data', (b) => { output += b; });
    child.stderr.on('data', (b) => { errors += b; });
    await until(() => /^\d+\n/.test(output) || (child.exitCode !== null && (() => { throw new Error(errors); })()), 'server start');
    base = `http://127.0.0.1:${parseInt(output, 10)}`;
  }
  async function kill() { if (child && child.exitCode === null && child.signalCode === null) { const p = once(child, 'exit'); child.kill('SIGKILL'); await p; } }
  async function session(id) { return (await (await api(`/api/sessions/${id}`)).json()).session; }
  async function create(message) {
    const created = await (await api('/api/sessions', { method: 'POST', body: JSON.stringify({ agents: ['claude'] }) })).json();
    const id = created.session.id;
    assert.equal((await api(`/api/sessions/${id}/send`, { method: 'POST', body: JSON.stringify({ to: ['claude'], text: message }) })).status, 202);
    return id;
  }
  async function cleanup() {
    if (child && child.exitCode === null && child.signalCode === null) {
      try { const list = await (await api('/api/sessions')).json(); for (const s of list.sessions ?? []) await api(`/api/sessions/${s.id}/stop`, { method:'POST',body:'{}' }); await sleep(150); } catch {}
    }
    await kill();
    // Stop any worker still alive even when a test failed before reopening the HTTP process.
    try {
      const { readdirSync } = await import('node:fs');
      for (const id of readdirSync(join(dir,'data','runs'))) {
        try { const s=JSON.parse(readFileSync(join(dir,'data','runs',id,'state.json'))); if (s.status==='running') process.kill(-s.pid,'SIGKILL'); } catch {}
      }
    } catch {}
    rmSync(root, { recursive: true, force: true });
  }
  return { root, dir, calls, decisions, release, api, start, kill, session, create, cleanup };
}

test('a runtime finishes while HTTP is down, then replays exactly once after restart', async () => {
  const f = fixture();
  try {
    await f.start();
    const id = await f.create('WAIT');
    await until(async () => (await f.session(id)).log.at(-1).s === 'before;', 'first fragment');
    await f.kill();
    writeFileSync(f.release, 'go');
    await sleep(200);
    await f.start();
    const s = await until(async () => { const s = await f.session(id); return s.log.at(-1).status === 'done' && s; }, 'recovered completion');
    assert.equal(s.log.at(-1).s, 'before;after;');
    assert.equal(readFileSync(f.calls, 'utf8'), 'invoked\n', 'a prompt was never replayed');
    assert.equal(s.agents.claude.state, 'idle');
    await f.kill(); await f.start();
    assert.equal((await f.session(id)).log.at(-1).s, 'before;after;', 'a second restart does not duplicate deltas');
  } finally { await f.cleanup(); }
});

test('a pending approval stays actionable across an HTTP-process crash', async () => {
  const f = fixture();
  try {
    await f.start(); const id = await f.create('ASK');
    await until(async () => (await f.session(id)).log.at(-1).items.some((i) => i.k === 'ask'), 'approval');
    await f.kill(); await f.start();
    const s = await f.session(id);
    assert.equal(s.log.at(-1).items.find((i) => i.k === 'ask').status, 'waiting');
    assert.equal((await f.api(`/api/sessions/${id}/answer`, { method: 'POST', body: JSON.stringify({ agent:'claude',ask:'ask-recover',decision:'allow' }) })).status, 200);
    const done = await until(async () => { const s=await f.session(id); return s.log.at(-1).status === 'done' && s; }, 'approval completion');
    assert.equal(done.log.at(-1).s, 'before;\nafter:allow');
    assert.equal(readFileSync(f.calls,'utf8'), 'invoked\n');
  } finally { await f.cleanup(); }
});

test('a lost worker is reported as interrupted without replaying its actions', async () => {
  const f = fixture();
  try {
    await f.start(); const id = await f.create('WAIT');
    const s = await until(async () => { const s=await f.session(id); return s.log.at(-1).s === 'before;' && s; });
    await f.kill();
    const state = JSON.parse(readFileSync(join(f.dir,'data','runs',s.log.at(-1).run.id,'state.json')));
    process.kill(-state.pid, 'SIGKILL');
    await f.start();
    const failed = await until(async () => { const s=await f.session(id); return s.log.at(-1).status === 'error' && s; }, 'interruption');
    assert.match(failed.log.at(-1).error, /Nie powtórzono poleceń/);
    assert.equal(readFileSync(f.calls,'utf8'), 'invoked\n');
    assert.equal(failed.agents.claude.state,'idle');
  } finally { await f.cleanup(); }
});

test('a prepared run never executes after a crash, and a dead worker with a partial journal ends', async () => {
  const { prepareRun, attachRun, atomic, runPath } = await import('../src/run-journal.js');
  const root = mkdtempSync(join(tmpdir(), 'spectrahub-journal-'));
  const config = { dir: root };
  const controls = [];
  try {
    const first = prepareRun(config, { id:'fixture',path:'/does-not-exist' }, { env:{ FIXTURE_API_KEY:'synthetic-secret-value' }, prompt:'fixture' }, {});
    const spec = readFileSync(join(runPath(config,first),'spec.json'),'utf8');
    assert.ok(!spec.includes('synthetic-secret-value'), 'credential values never enter a persisted launch spec');
    const events = [];
    controls.push(attachRun(config,first,0,(e) => events.push(e)));
    await until(() => events.some((e) => e.type === 'done'));
    assert.deepEqual(events.map((e) => e.type), ['error','done'], 'a committed but unlaunched turn is not started later');

    const second = prepareRun(config, { id:'fixture',path:'/does-not-exist' }, {prompt:'fixture'}, {});
    writeFileSync(join(runPath(config,second),'events.jsonl'), '{"type":"text","s":"kept"}\n{"type":');
    atomic(join(runPath(config,second),'state.json'), {status:'done',pid:999999999,stamp:'missing'});
    const restored = [];
    controls.push(attachRun(config,second,0,(e) => restored.push(e)));
    await until(() => restored.some((e) => e.type === 'done'));
    assert.deepEqual(restored.map((e) => e.type), ['text','error','done'], 'an incomplete trailing line cannot leave the UI busy forever');
    assert.equal(restored[0].s,'kept');
  } finally { for (const control of controls) control.detach(); rmSync(root,{recursive:true,force:true}); }
});

test('concurrent sends reserve an agent before discovering its runtime', async () => {
  const f = fixture();
  try {
    await f.start();
    const created = await (await f.api('/api/sessions', {method:'POST',body:JSON.stringify({agents:['claude']})})).json();
    const id = created.session.id;
    const send = () => f.api(`/api/sessions/${id}/send`,{method:'POST',body:JSON.stringify({to:['claude'],text:'WAIT'})});
    assert.deepEqual((await Promise.all([send(),send()])).map((r) => r.status).sort(),[202,409]);
    writeFileSync(f.release,'go');
    await until(async () => (await f.session(id)).log.at(-1).status === 'done');
    assert.equal(readFileSync(f.calls,'utf8'),'invoked\n');
  } finally { await f.cleanup(); }
});


test('Stop takes priority over an already queued Allow in the same worker batch', async () => {
  const f = fixture();
  let worker;
  try {
    await f.start();
    const id = await f.create('ASK');
    const s = await until(async () => { const s=await f.session(id); return s.log.at(-1).items.some((i) => i.k === 'ask') && s; }, 'approval');
    const runDir = join(f.dir, 'data', 'runs', s.log.at(-1).run.id);
    worker = JSON.parse(readFileSync(join(runDir, 'state.json'))).pid;
    process.kill(worker, 'SIGSTOP');
    // Wait for the worker to stop so both commands reach the same deterministic batch.
    await until(() => /\) T /.test(readFileSync(`/proc/${worker}/stat`, 'utf8')), 'stopped worker');
    writeFileSync(join(runDir, 'commands', '1000-a-allow.json'), JSON.stringify({type:'answer',ask:'ask-recover',decision:'allow'}));
    writeFileSync(join(runDir, 'commands', '1000-z-stop.json'), JSON.stringify({type:'stop'}));
    process.kill(worker, 'SIGCONT');
    const ended = await until(async () => { const s=await f.session(id); return s.log.at(-1).status === 'error' && s; }, 'cancelled turn');
    assert.match(ended.log.at(-1).error, /żądanie użytkownika/);
    await sleep(100);
    assert.equal(readFileSync(f.decisions, 'utf8'), '', 'the runtime never received Allow');
    assert.equal(readFileSync(f.calls, 'utf8'), 'invoked\n');
    const journal = readFileSync(join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(journal.filter((e) => e.type === 'done').length, 1);
    assert.ok(!journal.some((e) => e.type === 'answer'), 'no approval acknowledgement appears after Stop');
  } finally {
    if (worker) { try { process.kill(worker, 'SIGCONT'); } catch {} }
    await f.cleanup();
  }
});
