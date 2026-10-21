// Smoke test: the server answers, serves the shell and refuses traversal.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start } from '../src/server.js';

let server;
let base;
const dir = mkdtempSync(join(tmpdir(), 'spectrahub-test-'));

before(async () => {
  server = await start({ dir, server: { host: '127.0.0.1', port: 0 } });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

test('health reports the product and version', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.product, 'spectrahub');
  assert.match(body.version, /^\d+\.\d+\.\d+$/);
});

test('shell is served at the root', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /SpectraHub/);
});

test('stylesheet is served', async () => {
  const res = await fetch(`${base}/styles.css`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/css/);
});

test('unknown paths return 404', async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
});

test('path traversal is refused', async () => {
  const res = await fetch(`${base}/..%2f..%2fetc%2fpasswd`);
  assert.ok([403, 404].includes(res.status), `got ${res.status}`);
});
