import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { requestTerminal, getTerminal, approveTerminal, inputTerminal, resizeTerminal, stopTerminal, subscribeTerminal, closeTerminals } from '../src/pty.js';
import { saveHost } from '../src/hosts.js';

const dir = mkdtempSync(join(tmpdir(), 'spectrahub-pty-'));
const config = { dir, terminal: { cwd: dir, shell: '/bin/sh' } };
after(() => { closeTerminals(config); rmSync(dir, { recursive: true, force: true }); });

async function until(check, description) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`timed out: ${description}`);
}

test('a requested shell cannot execute until approved and denial cannot be reused', () => {
  const terminal = requestTerminal(config);
  assert.equal(terminal.state, 'pending');
  assert.equal(terminal.approvalScope, 'interactive-shell-until-closed');
  assert.throws(() => inputTerminal(config, terminal.id, { data: 'echo forbidden\n' }), { code: 409 });
  assert.equal(approveTerminal(config, terminal.id, { allow: false }).state, 'denied');
  assert.throws(() => approveTerminal(config, terminal.id, { allow: true }), { code: 409 });
  assert.throws(() => requestTerminal(config, { cols: -1 }), { code: 400 });
});

test('changing the SSH destination after a request requires a new approval', () => {
  const host = saveHost(config, { address: 'synthetic-one', label: 'Lab' });
  const terminal = requestTerminal(config, { hostId: host.id });
  saveHost(config, { address: 'synthetic-two' }, host.id);
  assert.throws(() => approveTerminal(config, terminal.id, { allow: true }), { code: 409 });
  stopTerminal(config, terminal.id);
});

test('a real PTY supports terminal size, interactive input, control-C, and reconnect without another shell', async () => {
  const terminal = requestTerminal(config, { cols: 90, rows: 31 });
  let output = '';
  let unsubscribe = subscribeTerminal(config, terminal.id, (event) => {
    if (event.type === 'data') output += event.data;
    if (event.type === 'snapshot') output = event.output;
  });
  approveTerminal(config, terminal.id, { allow: true });
  await until(() => getTerminal(config, terminal.id).state === 'running', 'PTY running');
  inputTerminal(config, terminal.id, { data: "test -t 0 && printf 'REAL_%s\\n' 'PTY'; stty size\n" });
  await until(() => output.includes('REAL_PTY') && /31 90\r?\n/.test(output), 'real tty and initial size');
  resizeTerminal(config, terminal.id, { cols: 100, rows: 40 });
  inputTerminal(config, terminal.id, { data: 'stty size\n' });
  await until(() => /40 100\r?\n/.test(output), 'resized tty');
  inputTerminal(config, terminal.id, { data: 'sleep 30\n' });
  await new Promise((resolve) => setTimeout(resolve, 100));
  inputTerminal(config, terminal.id, { data: '\x03' });
  inputTerminal(config, terminal.id, { data: "printf 'INT_%s\\n' 'OK'\n" });
  await until(() => output.includes('INT_OK'), 'control-C interrupts foreground job');
  unsubscribe();
  inputTerminal(config, terminal.id, { data: "printf 'RECON_%s\\n' 'NECT'\n" });
  await new Promise((resolve) => setTimeout(resolve, 100));
  let snapshot;
  unsubscribe = subscribeTerminal(config, terminal.id, (event) => { if (event.type === 'snapshot') snapshot = event; });
  assert.equal(snapshot.terminal.id, terminal.id);
  assert.match(snapshot.output, /RECON_NECT/);
  assert.match(snapshot.output, /REAL_PTY/);
  inputTerminal(config, terminal.id, { data: 'exit 7\n' });
  await until(() => getTerminal(config, terminal.id).state === 'exited', 'shell exit');
  assert.equal(getTerminal(config, terminal.id).exitCode, 7);
  unsubscribe();
});

test('stop closes an active PTY and refuses further input', async () => {
  const terminal = requestTerminal(config);
  approveTerminal(config, terminal.id, { allow: true });
  await until(() => getTerminal(config, terminal.id).state === 'running', 'PTY running');
  stopTerminal(config, terminal.id);
  await until(() => ['exited', 'error'].includes(getTerminal(config, terminal.id).state), 'PTY stopped');
  assert.throws(() => inputTerminal(config, terminal.id, { data: 'echo no\n' }), { code: 409 });
});

test('a stop queued immediately after approval is processed during startup', async () => {
  const terminal = requestTerminal(config);
  approveTerminal(config, terminal.id, { allow: true });
  stopTerminal(config, terminal.id);
  await until(() => ['exited', 'error'].includes(getTerminal(config, terminal.id).state), 'startup stop');
  assert.throws(() => inputTerminal(config, terminal.id, { data: 'echo no\n' }), { code: 409 });
});
