import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitQuote } from '../src/systemd.js';

test('service paths preserve spaces and literal systemd metacharacters; newlines are rejected', () => {
  assert.equal(unitQuote('SPECTRAHUB_HOME=/tmp/my install'), '"SPECTRAHUB_HOME=/tmp/my install"');
  assert.equal(unitQuote('/tmp/50%/$install', { exec: true }), '"/tmp/50%%/$$install"');
  assert.equal(unitQuote('/tmp/"quoted"'), '"/tmp/\\"quoted\\""');
  assert.throws(() => unitQuote('/tmp/x\nExecStart=bad'), /control/);
});
