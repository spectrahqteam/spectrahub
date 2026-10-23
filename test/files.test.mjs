// The server's files and each agent's own files, in a home folder of their own.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'spectrahub-files-'));
const dir = join(root, 'hub');
const home = join(root, 'home');
const project = join(root, 'proj');
const team = join(root, 'team');
const ola = join(root, 'ola');  // another user's home on the same server
let server;
let base;
let auth;

before(async () => {
  for (const d of [dir, join(home, '.claude', 'skills', 'raport'), join(home, '.claude', 'projects', '-proj', 'memory'), project, team, join(root, 'bin')]) mkdirSync(d, { recursive: true });
  writeFileSync(join(team, 'charlie.md'), '# Charlie\nTożsamość agenta.\n');
  mkdirSync(join(team, 'rules'), { recursive: true });
  writeFileSync(join(team, 'rules', 'team.md'), 'zasady zespołu\n');
  writeFileSync(join(team, 'GLOSSARY.md'), 'słownik\n');
  writeFileSync(join(project, 'notes.md'), 'see @rules/team.md\n');
  for (const d of [join(ola, '.openclaw', 'workspace'), join(ola, '.local', 'bin')]) mkdirSync(d, { recursive: true });
  writeFileSync(join(ola, '.openclaw', 'workspace', 'SOUL.md'), 'dusza agenta Oli\n');
  writeFileSync(join(ola, '.local', 'bin', 'codex'), `#!${process.execPath}\nconsole.log('codex-cli 0.0.1 (fake)')\n`);
  chmodSync(join(ola, '.local', 'bin', 'codex'), 0o755);
  symlinkSync(join(team, 'charlie.md'), join(home, '.claude', 'CLAUDE.md'));
  writeFileSync(join(home, '.claude', 'settings.json'), '{"model":"opus"}\n');
  writeFileSync(join(home, '.claude', '.credentials.json'), '{"claudeAiOauth":{"accessToken":"sekret"}}');
  writeFileSync(join(home, '.claude', 'skills', 'raport', 'SKILL.md'), '---\nname: raport\n---\n');
  writeFileSync(join(home, '.claude', 'projects', '-proj', 'memory', 'MEMORY.md'), '- pamięć\n');
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ projects: { [project]: {} } }));
  writeFileSync(join(project, 'CLAUDE.md'), 'zasady projektu\n');
  writeFileSync(join(root, 'bin', 'claude'), `#!${process.execPath}\nconsole.log('9.9.9 (fake)')\n`);
  chmodSync(join(root, 'bin', 'claude'), 0o755);
  writeFileSync(join(root, 'pixel.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  process.env.PATH = join(root, 'bin');
  process.env.HOME = home;
  process.env.SPECTRAHUB_SCAN_HOMES = `${home}:${ola}`;
  delete process.env.CLAUDE_CONFIG_DIR;
  const { start } = await import('../src/server.js');
  const { ensureToken } = await import('../src/terminal.js');
  auth = { Authorization: `Bearer ${ensureToken(dir)}`, 'Content-Type': 'application/json' };
  server = await start({ dir, server: { host: '127.0.0.1', port: 0 }, agents: { cwd: root } });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server?.close(); rmSync(root, { recursive: true, force: true }); });

const api = (path, opts = {}) => fetch(base + path, { ...opts, headers: { ...auth, ...(opts.headers ?? {}) } });
const q = (p) => encodeURIComponent(p);

test('the whole server can be browsed, read only; secrets and devices stay closed', async () => {
  assert.equal((await fetch(`${base}/api/fs/list?path=/`)).status, 401);
  const top = await (await api('/api/fs/list?path=/')).json();
  assert.equal(top.path, '/');
  assert.ok(top.entries.some((e) => e.name === 'etc'), 'the real root');
  const mine = await (await api(`/api/fs/list?path=${q(join(home, '.claude'))}`)).json();
  const link = mine.entries.find((e) => e.name === 'CLAUDE.md');
  assert.deepEqual([link.type, link.to, link.target], ['link', 'file', join(team, 'charlie.md')]);
  assert.equal(mine.entries.find((e) => e.name === '.credentials.json').secret, true);
  assert.equal(mine.entries[0].type, 'dir', 'folders first');

  const cred = join(home, '.claude', '.credentials.json');
  assert.equal((await (await api(`/api/fs/read?path=${q(cred)}`)).json()).kind, 'secret');
  assert.match((await (await api(`/api/fs/read?path=${q(cred)}&reveal`)).json()).text, /sekret/, 'shown only when asked for');
  assert.equal((await (await api('/api/fs/read?path=/dev/null')).json()).kind, 'special');
  assert.equal((await api(`/api/fs/raw?path=${q(cred)}`)).status, 403);
  const png = await api(`/api/fs/raw?path=${q(join(root, 'pixel.png'))}`);
  assert.equal(png.headers.get('content-type'), 'image/png');
  assert.equal((await api('/api/fs/list?path=/nie/ma/takiego')).status, 404);
  assert.equal((await api('/api/fs/list', { method: 'DELETE' })).status, 404, 'nothing deletes files');
});

test('an agent\'s own files are found, grouped, and can be edited safely', async () => {
  const { agent, files } = await (await api('/api/agents/claude/files')).json();
  assert.equal(agent.id, 'claude');
  const by = (name) => files.find((f) => f.name === name && (name !== 'CLAUDE.md' || f.group === 'identity'));
  assert.deepEqual([by('CLAUDE.md').group, by('CLAUDE.md').target], ['identity', join(team, 'charlie.md')]);
  assert.equal(by('settings.json').group, 'config');
  assert.equal(by('raport/SKILL.md').group, 'skills', 'a skill is named by its folder');
  assert.equal(by('MEMORY.md').group, 'memory');
  assert.deepEqual([by('.credentials.json').group, by('.credentials.json').editable], ['secret', false]);
  assert.equal(files.find((f) => f.group === 'projects').path, join(project, 'CLAUDE.md'), 'the projects it was used in');

  const path = join(home, '.claude', 'CLAUDE.md');
  const opened = await (await api(`/api/fs/read?path=${q(path)}`)).json();
  const save = (body) => api('/api/agents/claude/file', { method: 'PUT', body: JSON.stringify(body) });
  const ok = await save({ path, text: '# Charlie\nNowa tożsamość.\n', base: opened.hash });
  assert.equal(ok.status, 200);
  assert.equal(readFileSync(join(team, 'charlie.md'), 'utf8'), '# Charlie\nNowa tożsamość.\n', 'written through the link');
  assert.ok(lstatSync(path).isSymbolicLink(), 'the link stays a link');
  const backups = readdirSync(join(dir, 'backups', new Date().toISOString().slice(0, 10)));
  assert.equal(readFileSync(join(dir, 'backups', new Date().toISOString().slice(0, 10), backups[0]), 'utf8'), '# Charlie\nTożsamość agenta.\n', 'the old version is kept');

  assert.equal((await save({ path, text: 'x', base: opened.hash })).status, 409, 'a newer change is not overwritten');
  const settings = join(home, '.claude', 'settings.json');
  const bad = await save({ path: settings, text: '{"model":', base: (await (await api(`/api/fs/read?path=${q(settings)}`)).json()).hash });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /JSON/);
  assert.equal((await save({ path: join(home, '.claude', '.credentials.json'), text: '{}' })).status, 403, 'credentials are never edited here');
  assert.equal((await save({ path: '/etc/hostname', text: 'x' })).status, 403, 'only files the scanner found');
  assert.ok(existsSync(settings) && readFileSync(settings, 'utf8') === '{"model":"opus"}\n');
});

test('the scanner finds agents and their files wherever they were put', async () => {
  const { agents } = await (await api('/api/agents?fresh')).json();
  assert.equal(agents.find((a) => a.id === 'codex').installed, true, 'an agent in ~/.local/bin, outside PATH');
  const oc = await (await api('/api/agents/openclaw/files')).json();
  const soul = oc.files.find((f) => f.name === 'SOUL.md');
  assert.equal(soul.path, join(ola, '.openclaw', 'workspace', 'SOUL.md'), "OpenClaw's default workspace, with no config at all");
  assert.match(soul.label, /użytkownik ola/, 'files of another user say whose they are');

  writeFileSync(join(team, 'charlie.md'), '# Charlie\nZasady: @rules/team.md oraz [słownik](GLOSSARY.md), a `https://x.y/a.md` to nie plik.\n');
  const cl = await (await api('/api/agents/claude/files')).json();
  const linked = cl.files.filter((f) => f.group === 'linked').map((f) => [f.path, f.label]);
  assert.deepEqual(linked, [[join(team, 'rules', 'team.md'), 'wskazany w CLAUDE.md'], [join(team, 'GLOSSARY.md'), 'wskazany w CLAUDE.md']], 'files the instructions point to, relative to the instruction file');
});

test('a file can be handed to a conversation as the owner\'s attachment', async () => {
  const { session } = await (await api('/api/sessions', { method: 'POST', body: JSON.stringify({ agents: ['claude'] }) })).json();
  const r = await api(`/api/sessions/${session.id}/attach`, { method: 'POST', body: JSON.stringify({ path: join(project, 'CLAUDE.md'), from: 'you' }) });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).file.from, 'you');
});
