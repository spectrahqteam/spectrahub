import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { turn } from '../src/agents.js';

function fixture(kind) {
  const dir = mkdtempSync(join(tmpdir(), 'spectrahub-advisory-'));
  const bin = join(dir, 'peer');
  const frames = join(dir, 'frames.jsonl');
  const effect = join(dir, 'effect');
  writeFileSync(bin, `#!${process.execPath}
const fs = require('node:fs');
const readline = require('node:readline');
const kind = ${JSON.stringify(kind)}, frames = ${JSON.stringify(frames)}, effect = ${JSON.stringify(effect)};
fs.appendFileSync(frames,JSON.stringify({argv:process.argv.slice(2),auth:process.env.SPECTRAHUB_TEST_AUTH})+'\\n');
const out = o => process.stdout.write(JSON.stringify(o)+'\\n');
if(kind==='unsupported') { process.stderr.write('unknown option --tools'); process.exit(2); }
readline.createInterface({input:process.stdin}).on('line',line=>{
 const d=JSON.parse(line); fs.appendFileSync(frames,JSON.stringify(d)+'\\n');
 if(kind==='claude'){
  if(d.type==='user')return out({type:'control_request',request_id:'write',request:{subtype:'can_use_tool',tool_name:'Bash',input:{command:'touch example'},permission_suggestions:[{type:'setMode',mode:'bypassPermissions'}]}});
  if(d.type==='control_response'&&d.response.request_id==='write'){
   if(d.response.response.behavior==='allow')fs.writeFileSync(effect,'ran');
   return out({type:'control_request',request_id:'question',request:{subtype:'can_use_tool',tool_name:'AskUserQuestion',input:{questions:[{question:'Which shell?',options:[{label:'sh'}]}]}}});
  }
  if(d.type==='control_response'&&d.response.request_id==='question')return out({type:'result',result:'advice',is_error:false});
 }
 if(kind==='codex'){
  if(d.method==='initialize')return out({id:d.id,result:{}});
  if(d.method==='thread/start')return out({id:d.id,result:{thread:{id:'example-thread'}}});
  if(d.method==='turn/start'){
   out({id:d.id,result:{turn:{id:'example-turn'}}});
   return out({id:77,method:'item/commandExecution/requestApproval',params:{threadId:'example-thread',turnId:'example-turn',itemId:'write',command:'touch example'}});
  }
  if(d.id===77){
   if(d.result?.decision==='accept')fs.writeFileSync(effect,'ran');
   return out({method:'turn/completed',params:{turn:{id:'example-turn',status:'completed'}}});
  }
 }
});
`);
  chmodSync(bin, 0o700);
  return { dir, bin, frames, effect, close: () => rmSync(dir, { recursive: true, force: true }) };
}

async function drive(peer, id, asks = true) {
  const events = [];
  let stop;
  let timer;
  await new Promise((resolve, reject) => {
    timer = setTimeout(() => { stop?.(); reject(new Error('advisory peer timed out')); }, 5000);
    stop = turn({ id, path: peer.bin, label: id, asks }, {
      cwd: peer.dir, ref: null, prompt: 'Explain a shell command.', perm: 'full', advisory: true,
      env: { SPECTRAHUB_TEST_AUTH: 'retained' },
    }, (event) => {
      events.push(event);
      if (event.type === 'ask') {
        assert.equal(event.kind, 'question', 'advisory tool requests must never reach an allow card');
        assert.equal(stop.answer(event.id, 'allow', { 'Which shell?': 'sh' }), true);
      }
      if (event.type === 'done') { clearTimeout(timer); resolve(); }
    });
  });
  return { events, frames: readFileSync(peer.frames, 'utf8').trim().split('\n').map(JSON.parse) };
}

test('Claude advisory disables tools and MCP, denies a peer tool escalation, and retains questions and authentication', async () => {
  const peer = fixture('claude');
  try {
    const { events, frames } = await drive(peer, 'claude');
    const argv = frames[0].argv;
    assert.equal(argv[argv.indexOf('--tools') + 1], '');
    assert.ok(argv.includes('--strict-mcp-config'));
    assert.deepEqual(JSON.parse(argv[argv.indexOf('--mcp-config') + 1]), { mcpServers: {} });
    assert.ok(!argv.includes('--bare'), 'subscription authentication must remain available');
    assert.equal(frames[0].auth, 'retained');
    assert.equal(existsSync(peer.effect), false);
    assert.equal(frames.find((f) => f.response?.request_id === 'write').response.response.behavior, 'deny');
    assert.deepEqual(frames.find((f) => f.response?.request_id === 'question').response.response.updatedInput.answers, { 'Which shell?': 'sh' });
    assert.equal(events.filter((e) => e.type === 'ask').length, 1);
  } finally { peer.close(); }
});

test('Codex advisory overrides an accidental full permission and refuses native escalation', async () => {
  const peer = fixture('codex');
  try {
    const { events, frames } = await drive(peer, 'codex');
    const start = frames.find((f) => f.method === 'thread/start').params;
    assert.equal(start.sandbox, 'read-only');
    assert.equal(start.approvalPolicy, 'never');
    assert.equal(frames.find((f) => f.id === 77).result.decision, 'decline');
    assert.equal(existsSync(peer.effect), false);
    assert.equal(events.some((e) => e.type === 'ask'), false);
  } finally { peer.close(); }
});

test('an older advisory runtime rejecting the restrictions fails without unrestricted fallback', async () => {
  const peer = fixture('unsupported');
  try {
    const { events, frames } = await drive(peer, 'claude', false);
    assert.ok(events.some((e) => e.type === 'error' && /--tools/.test(e.s)));
    assert.equal(frames.filter((f) => f.argv).length, 1);
    assert.equal(existsSync(peer.effect), false);
  } finally { peer.close(); }
});
