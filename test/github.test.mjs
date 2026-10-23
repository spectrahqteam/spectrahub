// GitHub, read only, against a stand-in for its API: no network, no real token.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'spectrahub-gh-'));
const GOOD = 'github_pat_' + 'a'.repeat(40);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
const b64 = (s) => Buffer.from(s).toString('base64');

const routes = {
  '/user': { login: 'ala', name: 'Ala', avatar_url: 'https://avatars.example/ala' },
  '/user/repos': [{ name: 'site', full_name: 'acme/site', owner: { login: 'acme', avatar_url: 'a' }, private: true, description: 'Strona', language: 'JavaScript',
    stargazers_count: 3, forks_count: 1, open_issues_count: 2, default_branch: 'main', pushed_at: '2026-10-20T10:00:00Z', html_url: 'https://github.com/acme/site' }],
  '/repos/acme/site': { name: 'site', full_name: 'acme/site', owner: { login: 'acme' }, private: true, default_branch: 'main', topics: ['web'], license: { spdx_id: 'MIT' } },
  '/repos/acme/site/branches': [{ name: 'main' }, { name: 'dev' }],
  '/repos/acme/site/readme': { path: 'README.md', content: b64('# Site\n\nHello'), encoding: 'base64' },
  '/repos/acme/site/contents/': [{ name: 'z.txt', path: 'z.txt', type: 'file', size: 4 }, { name: 'src', path: 'src', type: 'dir' }, { name: 'a.md', path: 'a.md', type: 'file', size: 9 }],
  '/repos/acme/site/contents/src/app.js': { name: 'app.js', path: 'src/app.js', size: 12, content: b64('console.log(1)'), encoding: 'base64' },
  '/repos/acme/site/contents/bin.dat': { name: 'bin.dat', path: 'bin.dat', size: 3, content: Buffer.from([1, 0, 2]).toString('base64'), encoding: 'base64' },
  '/repos/acme/site/commits': [{ sha: 'abc1234def', commit: { message: 'fix: one\n\nmore', author: { name: 'Ala', date: '2026-10-20T10:00:00Z' } }, author: { login: 'ala' } }],
  '/repos/acme/site/pulls': [{ number: 7, title: 'Nowa strona', user: { login: 'ola' }, draft: true, head: { ref: 'dev' }, base: { ref: 'main' }, labels: [{ name: 'ui', color: 'ff0000' }] }],
  '/repos/acme/site/issues': [{ number: 8, title: 'Błąd', user: { login: 'ola' }, comments: 2, labels: [] }, { number: 7, title: 'PR', pull_request: {} }],
};

let mock;
let server;
let base;
let auth;
const seen = [];

before(async () => {
  mock = createServer((req, res) => {
    const path = req.url.split('?')[0];
    seen.push({ path, query: req.url.split('?')[1] ?? '', accept: req.headers.accept });
    if (req.headers.authorization !== `Bearer ${GOOD}`) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"message":"Bad credentials"}'); }
    if (path === '/repos/acme/site/contents/logo.png' && req.headers.accept === 'application/vnd.github.raw') { res.writeHead(200); return res.end(PNG); }
    const body = routes[path];
    if (!body) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"message":"Not Found"}'); }
    res.writeHead(200, { 'Content-Type': 'application/json', ...(path === '/user' ? { 'x-oauth-scopes': '' } : {}) });
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  process.env.SPECTRAHUB_GITHUB_API = `http://127.0.0.1:${mock.address().port}`;
  const { start } = await import('../src/server.js');
  const { ensureToken } = await import('../src/terminal.js');
  auth = { Authorization: `Bearer ${ensureToken(dir)}`, 'Content-Type': 'application/json' };
  server = await start({ dir, server: { host: '127.0.0.1', port: 0 } });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  mock?.close();
  rmSync(dir, { recursive: true, force: true });
});

const api = (path, opts = {}) => fetch(base + path, { ...opts, headers: { ...auth, ...(opts.headers ?? {}) } });

test('accounts are connected with the owner\'s own token, which never leaves the server', async () => {
  assert.equal((await fetch(`${base}/api/github`)).status, 401);
  assert.equal((await api('/api/github', { method: 'POST', body: JSON.stringify({ token: 'hello' }) })).status, 400);
  const bad = await api('/api/github', { method: 'POST', body: JSON.stringify({ token: 'ghp_' + 'b'.repeat(36) }) });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /odrzucił token/);

  const ok = await api('/api/github', { method: 'POST', body: JSON.stringify({ token: GOOD, label: 'praca' }) });
  assert.equal(ok.status, 201);
  const { account } = await ok.json();
  assert.deepEqual([account.login, account.label, account.kind, account.token], ['ala', 'praca', 'fine-grained', undefined]);
  const listed = await (await api('/api/github')).text();
  assert.ok(!listed.includes(GOOD), 'the token is not listed');
  assert.equal(statSync(join(dir, 'github.json')).mode & 0o777, 0o600);
  assert.ok(readFileSync(join(dir, 'github.json'), 'utf8').includes(GOOD), 'it is kept on the server');
});

test('repositories, their front page, files, commits, pull requests and issues', async () => {
  const [acc] = (await (await api('/api/github')).json()).accounts;
  const at = `/api/github/${acc.id}`;
  const { repos } = await (await api(`${at}/repos`)).json();
  assert.deepEqual(repos.map((r) => [r.full, r.private, r.language, r.stars]), [['acme/site', true, 'JavaScript', 3]]);

  const { repo } = await (await api(`${at}/repo/acme/site`)).json();
  assert.deepEqual(repo.branches, ['main', 'dev']);
  assert.equal(repo.readme.text, '# Site\n\nHello');
  assert.equal(repo.license, 'MIT');

  const root = await (await api(`${at}/repo/acme/site/contents?path=`)).json();
  assert.deepEqual(root.dir.map((e) => e.name), ['src', 'a.md', 'z.txt'], 'folders first, then by name');
  const file = await (await api(`${at}/repo/acme/site/contents?path=src/app.js&ref=dev`)).json();
  assert.deepEqual([file.file.kind, file.file.text], ['text', 'console.log(1)']);
  assert.match(seen.at(-1).query, /ref=dev/);
  assert.equal((await (await api(`${at}/repo/acme/site/contents?path=bin.dat`)).json()).file.kind, 'binary');

  const raw = await api(`${at}/repo/acme/site/raw?path=logo.png`);
  assert.equal(raw.headers.get('content-type'), 'image/png');
  assert.match(raw.headers.get('content-security-policy'), /sandbox/);
  assert.deepEqual(Buffer.from(await raw.arrayBuffer()), PNG);

  assert.equal((await (await api(`${at}/repo/acme/site/commits`)).json()).commits[0].message, 'fix: one\n\nmore');
  assert.equal((await (await api(`${at}/repo/acme/site/pulls`)).json()).pulls[0].draft, true);
  assert.deepEqual((await (await api(`${at}/repo/acme/site/issues`)).json()).issues.map((i) => i.number), [8], 'pull requests are not issues');

  assert.equal((await api(`${at}/repo/acme/nope`)).status, 404);
  assert.equal((await api(`${at}/repo/a..b%2F/x`)).status, 400, 'odd names never reach GitHub');
  assert.equal((await api(`${at}/repos`, { method: 'POST' })).status, 405, 'nothing is ever written');
});

test('an account can be disconnected', async () => {
  const [acc] = (await (await api('/api/github')).json()).accounts;
  assert.equal((await api(`/api/github/${acc.id}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual((await (await api('/api/github')).json()).accounts, []);
  assert.equal((await api(`/api/github/${acc.id}/repos`)).status, 404);
});
