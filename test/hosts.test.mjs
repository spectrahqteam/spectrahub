import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listHosts, getHost, saveHost, deleteHost, sshArgs, terminalCommand, hostStats } from '../src/hosts.js';

const root = mkdtempSync(join(tmpdir(), 'spectrahub-hosts-'));
const config = { dir: root, terminal: { cwd: root, shell: '/bin/sh' } };
after(() => rmSync(root, { recursive: true, force: true }));

test('host definitions stay private, survive reload and never contain uploaded credentials', () => {
  assert.equal(listHosts(config)[0].id, 'local');
  const host = saveHost(config, { label: 'Lab', address: 'lab.example.test', user: 'operator', port: 2222, identityFile: '/keys/test-key', password: 'must-not-store', services: ['sample.service'] });
  assert.equal(getHost(config, host.id).address, 'lab.example.test');
  assert.equal(statSync(join(root, 'hosts.json')).mode & 0o777, 0o600);
  assert.ok(!readFileSync(join(root, 'hosts.json'), 'utf8').includes('must-not-store'));
  assert.equal(saveHost(config, { label: 'Renamed' }, host.id).label, 'Renamed');
  deleteHost(config, host.id);
  assert.throws(() => getHost(config, host.id), { code: 404 });
  assert.throws(() => deleteHost(config, 'local'), { code: 400 });
});

test('SSH targets and arguments cannot inject options or shell commands; host keys are checked', () => {
  for (const address of ['-oProxyCommand=bad', 'host;touch /tmp/x', 'host\nother', 'user@host', '$(touch /tmp/x)']) {
    assert.throws(() => saveHost(config, { address }), { code: 400 });
  }
  assert.throws(() => saveHost(config, { address: 'lab', user: 'a;whoami' }), { code: 400 });
  assert.throws(() => saveHost(config, { address: 'lab', port: 0 }), { code: 400 });
  assert.throws(() => saveHost(config, { address: 'lab', identityFile: '~/.ssh/key' }), { code: 400 });
  assert.throws(() => saveHost(config, { address: 'lab', services: ['--all'] }), { code: 400 });
  const host = saveHost(config, { address: 'lab-alias', user: 'operator', port: 2222, identityFile: '/tmp/a key' });
  const args = sshArgs(host, { tty: true, command: 'fixed-command' });
  assert.ok(args.includes('StrictHostKeyChecking=yes'));
  assert.ok(args.includes('BatchMode=yes'));
  assert.ok(!sshArgs({ address: 'alias-with-configured-port' }).includes('-p'), 'an omitted port preserves SSH alias settings');
  assert.deepEqual(args.slice(-3), ['--', 'lab-alias', 'fixed-command']);
  assert.equal(args[args.indexOf('-i') + 1], '/tmp/a key');
  const target = terminalCommand(config, host.id, "/tmp/a'b;$(touch /tmp/no)");
  assert.match(target.args.at(-1), /^cd -- '\/tmp\/a'"'"'b;\$\(touch \/tmp\/no\)' && exec/);
  assert.throws(() => terminalCommand(config, host.id, 'relative'), { code: 400 });
});

test('local monitoring returns real machine figures and a remote host uses only SSH argv', async () => {
  const local = await hostStats(config, 'local');
  assert.equal(local.host.id, 'local');
  assert.ok(local.memory.total > 0 && local.disk.total > 0);
  assert.equal(local.load.length, 3);
  const fakeBin = join(root, 'fake-bin');
  mkdirSync(fakeBin);
  const argFile = join(root, 'ssh-args.json');
  writeFileSync(join(fakeBin, 'ssh'), `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(argFile)}, JSON.stringify(process.argv.slice(2)));\nconsole.log(JSON.stringify({hostname:'synthetic',memory:{total:1024,free:512},disk:{total:2048,free:1024,used:1024},load:[0,0,0],uptime:9,services:[]}));\n`);
  chmodSync(join(fakeBin, 'ssh'), 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = fakeBin;
  try {
    const host = saveHost(config, { address: 'synthetic-host' });
    const stats = await hostStats(config, host.id);
    assert.equal(stats.hostname, 'synthetic');
    const args = JSON.parse(readFileSync(argFile, 'utf8'));
    assert.ok(args.includes('StrictHostKeyChecking=yes'));
    assert.match(args.at(-1), /^python3 -c /);
  } finally { process.env.PATH = previousPath; }
});
