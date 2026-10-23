import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rpcTurn } from '../src/agent-rpc.js';
import { turn } from '../src/agents.js';
import { apply as mountDshPermissions } from '../src/dsh-permissions.js';

// A protocol peer with a visible effect only AFTER an approval response. No models or network.
function fixture(kind = 'codex') {
  const dir = mkdtempSync(join(tmpdir(), 'spectrahub-approval-'));
  const bin = join(dir, 'runtime');
  const log = join(dir, 'frames.jsonl'), effect = join(dir, 'effect');
  writeFileSync(bin, `#!${process.execPath}
const fs = require('node:fs');
const readline = require('node:readline');
const log = ${JSON.stringify(log)}, effect = ${JSON.stringify(effect)}, kind = ${JSON.stringify(kind)};
fs.appendFileSync(log, JSON.stringify({argv:process.argv.slice(2)})+'\\n');
if (process.argv.includes('--dump-config')) { console.log('- id: agent-default-model\\n  config:\\n    provider: example\\n    model: test-model'); process.exit(0); }
if (process.argv.includes('sessions.patch')) { console.log('{}'); process.exit(0); }
const out = o => process.stdout.write(JSON.stringify({jsonrpc:'2.0',...o})+'\\n');
let promptId;
readline.createInterface({input:process.stdin}).on('line', line => {
 const d=JSON.parse(line); fs.appendFileSync(log,JSON.stringify(d)+'\\n');
 if (d.method==='initialize') return out({id:d.id,result:kind==='codex'?{}:{protocolVersion:1}});
 if (d.method==='thread/start'||d.method==='thread/resume') return out({id:d.id,result:{thread:{id:'thread-example'}}});
 if (d.method==='session/new'||d.method==='session/resume') return out({id:d.id,result:{sessionId:'session-example',configOptions:[]}});
 if (d.method==='turn/start') {
   out({id:d.id,result:{turn:{id:'turn-example'}}});
   out({method:'turn/started',params:{turn:{id:'turn-example'}}});
   if(d.params.input[0].text==='question') return out({id:42,method:'item/tool/requestUserInput',params:{questions:[{id:'choice',question:'Which?',header:'Choice',options:[{label:'A',description:'first'}]}]}});
   out({id:41,method:'unknown/execute',params:{command:'touch forbidden'}});
   return out({id:42,method:'item/commandExecution/requestApproval',params:{threadId:'thread-example',turnId:'turn-example',itemId:'command-example',command:'touch example',reason:'Create a fixture'}});
 }
 if(d.method==='session/prompt') {
   promptId=d.id;
   out({method:'session/update',params:{sessionId:'session-example',update:{sessionUpdate:'tool_call',toolCallId:'tool-example',title:'bash',rawInput:{command:'touch example'}}}});
   return out({id:42,method:'session/request_permission',params:{sessionId:'session-example',toolCall:{toolCallId:'tool-example'},options:[{optionId:'once',kind:'allow_once'},{optionId:'no',kind:'reject_once'}]}});
 }
 if(d.id===42) {
   const allowed=kind==='codex'?d.result?.decision==='accept':d.result?.outcome?.optionId==='once';
   if(allowed)fs.writeFileSync(effect,'approved');
   if(kind==='codex') {
     out({method:'item/completed',params:{item:{id:'message-example',type:'agentMessage',text:allowed?'allowed':'denied'}}});
     return out({method:'turn/completed',params:{turn:{id:'turn-example',status:'completed'}}});
   }
   out({method:'session/update',params:{sessionId:'session-example',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:allowed?'allowed':'denied'}}}});
   out({id:promptId,result:{stopReason:'end_turn'}});
 }
});
`);
  chmodSync(bin, 0o700);
  return { dir, bin, log, effect, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function drive(f, { kind = 'codex', decision = 'allow', perm = 'full', prompt = 'perform', started = false } = {}) {
  const events = [];
  let stop;
  const done = new Promise((resolve) => {
    stop = rpcTurn({ bin: f.bin, args: [], env: process.env, cwd: f.dir, protocol: kind, ref: started ? 'existing-example' : null, started, prompt, perm }, (e) => {
      events.push(e);
      if (e.type === 'ask') {
        assert.equal(existsSync(f.effect), false, 'effect has not happened while waiting');
        assert.equal(stop.answer('wrong-id', 'allow'), false);
        assert.equal(stop.answer(e.id, 'always'), false, 'no accidental persistent grant');
        assert.equal(stop.answer(e.id, decision, { Which: 'A', 'Which?': 'A' }), true);
        assert.equal(stop.answer(e.id, decision), false, 'answer consumed once');
      }
      if (e.type === 'done') resolve();
    });
  });
  await Promise.race([done, new Promise((_, reject) => { const t = setTimeout(() => { stop(); reject(new Error('fake protocol timed out')); }, 5000); t.unref(); })]);
  return { events, frames: existsSync(f.log) ? readFileSync(f.log, 'utf8').trim().split('\n').map(JSON.parse) : [] };
}

test('Codex native approval blocks effects, grants once, resumes, and rejects unknown protocol requests', async () => {
  const f = fixture();
  try {
    const { events, frames } = await drive(f, { started: true });
    assert.equal(readFileSync(f.effect, 'utf8'), 'approved');
    assert.equal(events.filter((e) => e.type === 'ask').length, 1);
    assert.equal(events.filter((e) => e.type === 'done').length, 1);
    assert.equal(frames.find((x) => x.method === 'thread/resume').params.sandbox, 'read-only');
    assert.equal(frames.find((x) => x.method === 'thread/resume').params.approvalPolicy, 'on-request');
    assert.equal(frames.find((x) => x.id === 41).error.code, -32601);
    assert.ok(!events.some((e) => e.type === 'error'));
  } finally { f.cleanup(); }
});

test('Codex native denial and read-only scope never execute the requested effect', async () => {
  for (const options of [{ decision: 'deny' }, { perm: 'read' }]) {
    const f = fixture();
    try {
      const { events, frames } = await drive(f, options);
      assert.equal(existsSync(f.effect), false);
      assert.equal(frames.find((x) => x.id === 42).result.decision, 'decline');
      if (options.perm === 'read') assert.equal(events.some((e) => e.type === 'ask'), false);
    } finally { f.cleanup(); }
  }
});

test('Codex native questions carry user text back using question IDs', async () => {
  const f = fixture();
  try {
    const { frames, events } = await drive(f, { prompt: 'question' });
    assert.equal(events.find((e) => e.type === 'ask').kind, 'question');
    assert.deepEqual(frames.find((x) => x.id === 42).result.answers, { choice: { answers: ['A'] } });
  } finally { f.cleanup(); }
});

test('ACP one-shot allow and deny reach the waiting runtime and retain tool details', async () => {
  for (const decision of ['allow', 'deny']) {
    const f = fixture('acp');
    try {
      const { events } = await drive(f, { kind: 'acp', decision });
      assert.equal(existsSync(f.effect), decision === 'allow');
      assert.equal(events.find((e) => e.type === 'ask').title, 'touch example');
      assert.ok(!events.some((e) => e.type === 'error'));
    } finally { f.cleanup(); }
  }
});

test('OpenClaw full turn waits before starting any process; refusal has no runtime side effects', async () => {
  const f = fixture('acp');
  try {
    const events = [];
    let stop;
    await new Promise((resolve) => {
      stop = turn({ id: 'openclaw', path: f.bin, agent: 'example', label: 'OpenClaw' }, { cwd: f.dir, perm: 'full', ref: 'test', prompt: 'perform' }, (e) => {
        events.push(e);
        if (e.type === 'ask') { assert.equal(existsSync(f.log), false); assert.match(e.description, /jednej tury/); stop.answer(e.id, 'deny'); }
        if (e.type === 'done') resolve();
      });
    });
    assert.equal(existsSync(f.log), false);
    assert.ok(events.some((e) => e.type === 'error'));
  } finally { f.cleanup(); }
});

test('OpenClaw approval configures only its own gateway session and relays a second native request', async () => {
  const f = fixture('acp');
  try {
    const events = [];
    let stop;
    await new Promise((resolve) => {
      stop = turn({ id: 'openclaw', path: f.bin, agent: 'example', label: 'OpenClaw' }, { cwd: f.dir, perm: 'full', ref: 'test', prompt: 'perform' }, (e) => {
        events.push(e);
        if (e.type === 'ask') stop.answer(e.id, 'allow');
        if (e.type === 'done') resolve();
      });
    });
    assert.equal(events.filter((e) => e.type === 'ask').length, 2);
    assert.equal(readFileSync(f.effect, 'utf8'), 'approved');
    const argv = readFileSync(f.log, 'utf8').trim().split('\n').map(JSON.parse).find((x) => x.argv?.includes('sessions.patch')).argv;
    assert.deepEqual(JSON.parse(argv[argv.indexOf('--params') + 1]), { key: 'agent:example:test', execAsk: 'always', execSecurity: 'allowlist' });
  } finally { f.cleanup(); }
});

test('unsupported or broken native protocol fails closed, without a legacy bypass', async () => {
  const f = fixture();
  try {
    writeFileSync(f.bin, `#!${process.execPath}\nconsole.log('unsupported transport');\n`);
    const { events } = await drive(f);
    assert.ok(events.some((e) => e.type === 'error' && /JSON-RPC/.test(e.s)));
    assert.equal(existsSync(f.effect), false);
  } finally { f.cleanup(); }
});

test('DSH uses a temporary ACP overlay while retaining the installed headless profile and model route', async () => {
  const f = fixture('acp');
  try {
    let stop, patchText;
    const events = [];
    await new Promise((resolve) => {
      stop = turn({ id: 'dsh', path: f.bin, label: 'DeepSeek Harness' }, { cwd: f.dir, perm: 'full', ref: null, prompt: 'perform' }, (e) => {
        events.push(e);
        if (e.type === 'ask') {
          const argv = readFileSync(f.log, 'utf8').trim().split('\n').map(JSON.parse).find((x) => x.argv?.includes('--patch')).argv;
          assert.deepEqual(argv.slice(0, 2), ['--profile', 'headless']);
          patchText = readFileSync(argv[argv.indexOf('--patch') + 1], 'utf8');
          assert.equal(stop.answer(e.id, 'allow'), true);
        }
        if (e.type === 'done') resolve();
      });
    });
    assert.match(patchText, /headless-runner\n  disabled: true/);
    assert.match(patchText, /"provider":"example","model":"test-model"/);
    assert.match(patchText, /@deepseek-ai\/dsh-acp/);
    assert.match(patchText, /inject: \[acpAppStartup, spectrahubPermissions\]/);
    assert.ok(!events.some((e) => e.type === 'error'));
    assert.equal(readFileSync(f.effect, 'utf8'), 'approved');
  } finally { f.cleanup(); }
});

test('DSH guard resets a resumed permissive session before admission and preserves earlier denials', async () => {
  const hooks = new Map();
  let ready = false;
  const session = { sandbox: 'danger-full-access', approval: 'never' };
  const ctx = {
    permissionPresets: {
      resolve: (mode) => ({ sandbox: mode, approval: 'ask' }),
      set: (s, mode) => { s.sandbox = mode; s.approval = 'ask'; },
      current: (s) => s.approval === 'ask' ? s.sandbox : 'custom',
    },
    sandboxPolicy: { resolve: ({ session: s }) => ({ mode: s.sandbox }) },
    on: (event, fn) => hooks.set(event, fn),
    provide: (name, value) => { ready = name === 'spectrahubPermissions' && value.ready; },
  };
  mountDshPermissions(ctx, { mode: 'workspace-write' });
  assert.equal(ready, true);
  hooks.get('agent/created')({ agent: { session } });
  assert.deepEqual(session, { sandbox: 'workspace-write', approval: 'ask' });
  const child = { header: { parentSession: 'parent-example' }, sandbox: 'read-only', approval: 'never' };
  hooks.get('agent/created')({ agent: { session: child } });
  assert.deepEqual(child, { header: { parentSession: 'parent-example' }, sandbox: 'read-only', approval: 'never' }, 'delegated limits are not broadened');
  const guard = hooks.get('tools/pre-execute');
  for (const name of ['write', 'bash', 'run_code', 'unknown_plugin_tool']) assert.equal((await guard({ name }, async () => ({ kind: 'allow' }))).kind, 'ask');
  assert.equal((await guard({ name: 'read' }, async () => ({ kind: 'allow' }))).kind, 'allow');
  assert.deepEqual(await guard({ name: 'write' }, async () => ({ kind: 'deny', reason: 'owner policy' })), { kind: 'deny', reason: 'owner policy' });
  mountDshPermissions(ctx, { mode: 'read-only' });
  hooks.get('agent/created')({ agent: { session } });
  assert.equal((await hooks.get('tools/pre-execute')({ name: 'write' }, async () => ({ kind: 'allow' }))).kind, 'deny');
});

test('DSH guard rejects a runtime that cannot enforce the selected session preset', () => {
  const hooks = new Map();
  const ctx = {
    permissionPresets: { resolve: () => ({ approval: 'ask' }), set() {}, current: () => 'danger-full-access' },
    sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
    on: (name, fn) => hooks.set(name, fn), provide() {},
  };
  mountDshPermissions(ctx, { mode: 'read-only' });
  assert.throws(() => hooks.get('agent/created')({ agent: { session: {} } }), /could not enforce/);
});
