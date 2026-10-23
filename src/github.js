// GitHub, read only. The owner connects accounts with tokens of their own — several, private ones
// too — and SpectraHub shows what each token can see. Tokens stay on this server (github.json, 0600)
// and are never sent to the browser; nothing is ever written to GitHub.
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { extname, join } from 'node:path';

const API = process.env.SPECTRAHUB_GITHUB_API ?? 'https://api.github.com';  // tests point it at a stand-in
const NAME = /^[\w.-]{1,100}$/;
const file = (dir) => join(dir, 'github.json');
const load = (dir) => { try { return JSON.parse(readFileSync(file(dir), 'utf8')); } catch { return { accounts: [] }; } };
function store(dir, data) {
  writeFileSync(file(dir), JSON.stringify(data, null, 2), { mode: 0o600 });
  chmodSync(file(dir), 0o600);
}
const visible = ({ token: _t, ...a }) => a;

const cache = new Map();  // `${account}:${path}` -> { at, value }

class GitHubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function explain(status, body, headers) {
  if (status === 401) return 'GitHub odrzucił token — wygasł albo został odwołany';
  if (status === 403 && headers.get('x-ratelimit-remaining') === '0') {
    const at = Number(headers.get('x-ratelimit-reset')) * 1000;
    return `limit zapytań GitHub wyczerpany — odnowi się o ${new Date(at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (status === 403) return 'ten token nie ma dostępu do tego zasobu';
  if (status === 404) return 'nie ma tego albo token nie ma do tego dostępu';
  return body?.message ? `GitHub: ${body.message}` : `GitHub: HTTP ${status}`;
}

async function call(token, path, { accept = 'application/vnd.github+json' } = {}) {
  const res = await fetch(API + path, {
    headers: { Authorization: `Bearer ${token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'SpectraHub' },
    signal: AbortSignal.timeout(15000),
  }).catch(() => { throw new GitHubError(502, 'GitHub nie odpowiada'); });
  return res;
}

async function json(token, path) {
  const res = await call(token, path);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new GitHubError(res.status === 401 ? 401 : res.status === 404 ? 404 : res.status === 403 ? 403 : 502, explain(res.status, body, res.headers));
  return body;
}

// One account's GET, cached for a minute: browsing back and forth stays fast and within limits.
async function get(acc, path, ttl = 60_000) {
  const key = `${acc.id}:${path}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await json(acc.token, path);
  cache.set(key, { at: Date.now(), value });
  return value;
}

function account(dir, id) {
  const a = load(dir).accounts.find((x) => x.id === id);
  if (!a) throw new GitHubError(404, 'nie ma takiego konta GitHub');
  return a;
}

function repoPath(owner, name) {
  if (!NAME.test(owner) || !NAME.test(name)) throw new GitHubError(400, 'zła nazwa repozytorium');
  return `/repos/${owner}/${name}`;
}
const encPath = (p) => String(p ?? '').split('/').filter((x) => x && x !== '..' && x !== '.').map(encodeURIComponent).join('/');
const refQuery = (ref) => (ref ? `?ref=${encodeURIComponent(ref)}` : '');

export function accounts(dir) {
  return load(dir).accounts.map(visible);
}

// A token is checked with GitHub before it is kept; the account shows who it belongs to.
export async function connect(dir, { token, label }) {
  const t = String(token ?? '').trim();
  if (!/^(gh[pousr]_|github_pat_)[\w]{20,}$/.test(t)) throw new GitHubError(400, 'to nie wygląda na token GitHub (ghp_… albo github_pat_…)');
  const res = await call(t, '/user');
  const me = await res.json().catch(() => null);
  if (!res.ok) throw new GitHubError(400, explain(res.status, me, res.headers));
  const data = load(dir);
  const acc = {
    id: randomUUID().slice(0, 8),
    login: me.login, name: me.name ?? null, avatar: me.avatar_url ?? null,
    label: String(label ?? '').trim().slice(0, 40) || null,
    kind: t.startsWith('github_pat_') ? 'fine-grained' : t.startsWith('ghp_') ? 'classic' : 'token',
    scopes: res.headers.get('x-oauth-scopes') || null,
    addedAt: new Date().toISOString(),
    token: t,
  };
  data.accounts.push(acc);
  store(dir, data);
  return visible(acc);
}

export function disconnect(dir, id) {
  const data = load(dir);
  const before = data.accounts.length;
  data.accounts = data.accounts.filter((a) => a.id !== id);
  if (data.accounts.length === before) throw new GitHubError(404, 'nie ma takiego konta GitHub');
  store(dir, data);
  for (const k of cache.keys()) if (k.startsWith(`${id}:`)) cache.delete(k);
}

// Every repository the token can see, most recently pushed first.
export async function repos(dir, id) {
  const acc = account(dir, id);
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const list = await get(acc, `/user/repos?per_page=100&sort=pushed&page=${page}`);
    out.push(...list);
    if (list.length < 100) break;
  }
  return out.map((r) => ({
    owner: r.owner?.login, name: r.name, full: r.full_name, private: Boolean(r.private), description: r.description ?? '',
    language: r.language ?? null, stars: r.stargazers_count ?? 0, forks: r.forks_count ?? 0, issues: r.open_issues_count ?? 0,
    branch: r.default_branch, pushed: r.pushed_at, archived: Boolean(r.archived), fork: Boolean(r.fork), avatar: r.owner?.avatar_url ?? null,
    url: r.html_url,
  }));
}

// The repository's front page: details, its README as text, and its branches.
export async function repo(dir, id, owner, name) {
  const acc = account(dir, id);
  const base = repoPath(owner, name);
  const [r, branches, readme] = await Promise.all([
    get(acc, base),
    get(acc, `${base}/branches?per_page=100`).catch(() => []),
    get(acc, `${base}/readme`).catch(() => null),
  ]);
  return {
    owner: r.owner?.login, avatar: r.owner?.avatar_url ?? null, name: r.name, full: r.full_name, private: Boolean(r.private), description: r.description ?? '',
    language: r.language ?? null, stars: r.stargazers_count ?? 0, forks: r.forks_count ?? 0, watchers: r.subscribers_count ?? 0,
    branch: r.default_branch, pushed: r.pushed_at, url: r.html_url, homepage: r.homepage || null, topics: r.topics ?? [],
    license: r.license?.spdx_id && r.license.spdx_id !== 'NOASSERTION' ? r.license.spdx_id : null, size: r.size ?? null,
    branches: branches.map((b) => b.name),
    readme: readme?.content ? { path: readme.path, text: Buffer.from(readme.content, readme.encoding ?? 'base64').toString('utf8') } : null,
  };
}

const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif']);

// A folder lists its entries; a file comes back as text when it is text.
export async function contents(dir, id, owner, name, path, ref) {
  const acc = account(dir, id);
  const d = await get(acc, `${repoPath(owner, name)}/contents/${encPath(path)}${refQuery(ref)}`);
  if (Array.isArray(d)) {
    return { dir: d.map((e) => ({ name: e.name, path: e.path, type: e.type, size: e.type === 'file' ? e.size : null }))
      .sort((a, b) => (a.type === 'dir') === (b.type === 'dir') ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1) };
  }
  const f = { name: d.name, path: d.path, size: d.size, url: d.html_url };
  if (IMAGE.has(extname(d.name).toLowerCase())) return { file: { ...f, kind: 'image' } };
  if (d.content == null || d.encoding === 'none') return { file: { ...f, kind: 'large' } };
  const buf = Buffer.from(d.content, d.encoding ?? 'base64');
  if (buf.subarray(0, 8000).includes(0)) return { file: { ...f, kind: 'binary' } };
  return { file: { ...f, kind: 'text', text: buf.toString('utf8') } };
}

export async function commits(dir, id, owner, name, ref) {
  const acc = account(dir, id);
  const list = await get(acc, `${repoPath(owner, name)}/commits?per_page=40${ref ? `&sha=${encodeURIComponent(ref)}` : ''}`);
  return list.map((c) => ({
    sha: c.sha, message: c.commit?.message ?? '', author: c.author?.login ?? c.commit?.author?.name ?? '',
    avatar: c.author?.avatar_url ?? null, date: c.commit?.author?.date ?? null, url: c.html_url,
  }));
}

export async function pulls(dir, id, owner, name) {
  const acc = account(dir, id);
  const list = await get(acc, `${repoPath(owner, name)}/pulls?state=open&per_page=50`);
  return list.map((p) => ({
    number: p.number, title: p.title, author: p.user?.login ?? '', avatar: p.user?.avatar_url ?? null, draft: Boolean(p.draft),
    updated: p.updated_at, head: p.head?.ref, base: p.base?.ref, labels: (p.labels ?? []).map((l) => ({ name: l.name, color: l.color })), url: p.html_url,
  }));
}

export async function issues(dir, id, owner, name) {
  const acc = account(dir, id);
  const list = await get(acc, `${repoPath(owner, name)}/issues?state=open&per_page=50`);
  return list.filter((i) => !i.pull_request).map((i) => ({
    number: i.number, title: i.title, author: i.user?.login ?? '', avatar: i.user?.avatar_url ?? null, comments: i.comments ?? 0,
    updated: i.updated_at, labels: (i.labels ?? []).map((l) => ({ name: l.name, color: l.color })), url: i.html_url,
  }));
}

const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.bmp': 'image/bmp', '.avif': 'image/avif' };

// The bytes of one file, for pictures in the viewer and in READMEs. Up to 10 MB.
export async function raw(dir, id, owner, name, path, ref) {
  const acc = account(dir, id);
  const res = await call(acc.token, `${repoPath(owner, name)}/contents/${encPath(path)}${refQuery(ref)}`, { accept: 'application/vnd.github.raw' });
  if (!res.ok) throw new GitHubError(res.status === 404 ? 404 : 502, explain(res.status, null, res.headers));
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 10 * 1024 * 1024) throw new GitHubError(413, 'plik za duży do podglądu');
  return { type: TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream', body: buf };
}

export { GitHubError };
