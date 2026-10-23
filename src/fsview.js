// The server's files, read only: any folder from / down, any regular file up to a preview limit.
// Secrets (keys, tokens, .env, credentials) show only after an explicit "show anyway"; devices,
// pipes and sockets are listed but never opened, so a read can never hang on them.
import { closeSync, lstatSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, extname, resolve } from 'node:path';

const PREVIEW = 2 * 1024 * 1024;
const MAX_ENTRIES = 3000;
export const RAW_LIMIT = 50 * 1024 * 1024;

export class FsError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Files whose content is a credential. They can be listed; their content needs a second "yes".
const SECRET = /(^|\/)(\.env(\.[^/]*)?|[^/]*\.env|id_(rsa|ed25519|ecdsa|dsa)(?![^/]*\.pub$)[^/]*|[^/]*\.(pem|key|p12|pfx|kdbx|keystore|jks)|auth\.json|auth-profiles\.json|\.?credentials[^/]*|[^/]*token[^/]*|\.netrc|\.git-credentials|\.npmrc|\.pypirc|shadow|gshadow|keys\.json|github\.json|gmail\.json|secrets?(\.[^/]*)?)$/i;
export const isSecret = (path) => SECRET.test(path) || (/\/\.ssh\/[^/]+$/.test(path) && !/\.pub$|known_hosts$|authorized_keys$|config$/.test(path));

const IMAGE = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon' };
export const imageType = (path) => IMAGE[extname(path).toLowerCase()] ?? null;

let names = null;
function owners() {
  if (names && Date.now() - names.at < 60_000) return names;
  const map = (file) => {
    const m = new Map();
    try { for (const l of readFileSync(file, 'utf8').split('\n')) { const p = l.split(':'); if (p.length > 2) m.set(Number(p[2]), p[0]); } } catch { /* no such file */ }
    return m;
  };
  names = { at: Date.now(), users: map('/etc/passwd'), groups: map('/etc/group') };
  return names;
}

function modeString(mode) {
  const t = (mode & 0o170000) === 0o040000 ? 'd' : (mode & 0o170000) === 0o120000 ? 'l' : '-';
  let s = t;
  for (const shift of [6, 3, 0]) {
    const b = (mode >> shift) & 7;
    s += (b & 4 ? 'r' : '-') + (b & 2 ? 'w' : '-') + (b & 1 ? 'x' : '-');
  }
  return s;
}

function kindOf(st) {
  if (st.isDirectory()) return 'dir';
  if (st.isFile()) return 'file';
  if (st.isSymbolicLink()) return 'link';
  return 'special';
}

export function clean(path) {
  const p = resolve('/', String(path ?? '/'));
  return p;
}

// One folder: folders first, then files, by name. Links show where they point.
export function list(path) {
  const dir = clean(path);
  let st;
  try { st = statSync(dir); } catch (e) { throw new FsError(e.code === 'EACCES' ? 403 : 404, e.code === 'EACCES' ? 'brak dostępu' : 'nie ma takiego folderu'); }
  if (!st.isDirectory()) throw new FsError(400, 'to nie jest folder');
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { throw new FsError(403, e.code === 'EACCES' ? 'brak dostępu do folderu' : 'nie udało się odczytać folderu'); }
  const { users, groups } = owners();
  const out = [];
  for (const d of entries.slice(0, MAX_ENTRIES)) {
    const full = dir === '/' ? `/${d.name}` : `${dir}/${d.name}`;
    let l;
    try { l = lstatSync(full); } catch { out.push({ name: d.name, path: full, type: 'special', size: null }); continue; }
    const e = { name: d.name, path: full, type: kindOf(l), size: l.isFile() ? l.size : null, mtime: l.mtime.toISOString(),
      mode: modeString(l.mode), owner: users.get(l.uid) ?? String(l.uid), group: groups.get(l.gid) ?? String(l.gid) };
    if (l.isSymbolicLink()) {
      try {
        e.target = realpathSync(full);
        const t = statSync(full);
        e.to = kindOf(t);
        if (t.isFile()) e.size = t.size;
      } catch { e.to = 'broken'; }
    }
    if (e.type === 'file' || e.to === 'file') e.secret = isSecret(full) || (e.target ? isSecret(e.target) : false);
    out.push(e);
  }
  const dirLike = (e) => e.type === 'dir' || e.to === 'dir';
  out.sort((a, b) => (dirLike(a) === dirLike(b) ? a.name.localeCompare(b.name, 'pl') : dirLike(a) ? -1 : 1));
  return { path: dir, parent: dir === '/' ? null : dirname(dir), entries: out, total: entries.length, truncated: entries.length > MAX_ENTRIES };
}

export const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

// One file for the viewer: text when it is text, otherwise what it is and why it is not shown.
export function read(path, { reveal = false } = {}) {
  const p = clean(path);
  let st;
  try { st = statSync(p); } catch (e) { throw new FsError(e.code === 'EACCES' ? 403 : 404, e.code === 'EACCES' ? 'brak dostępu' : 'nie ma takiego pliku'); }
  let target = null;
  try { const real = realpathSync(p); if (real !== p) target = real; } catch { /* keep the path */ }
  const base = { path: p, name: basename(p), target, size: st.size, mtime: st.mtime.toISOString(), mode: modeString(st.mode) };
  if (st.isDirectory()) return { ...base, kind: 'dir' };
  if (!st.isFile()) return { ...base, kind: 'special' };
  if ((isSecret(p) || (target && isSecret(target))) && !reveal) return { ...base, kind: 'secret' };
  if (imageType(p)) return { ...base, kind: 'image' };
  if (st.size > PREVIEW) return { ...base, kind: 'large' };
  let buf;
  try {
    const fd = openSync(p, 'r');
    try {
      const chunk = Buffer.alloc(PREVIEW + 1);
      const n = readSync(fd, chunk, 0, chunk.length, 0);  // files in /proc report size 0 and still have content
      buf = chunk.subarray(0, n);
    } finally { closeSync(fd); }
  } catch (e) { throw new FsError(e.code === 'EACCES' ? 403 : 500, e.code === 'EACCES' ? 'brak dostępu' : 'nie udało się odczytać pliku'); }
  if (buf.length > PREVIEW) return { ...base, kind: 'large' };
  if (buf.subarray(0, 8000).includes(0)) return { ...base, kind: 'binary' };
  return { ...base, kind: 'text', text: buf.toString('utf8'), hash: hash(buf) };
}

// The bytes of a regular file, for pictures and downloads.
export function raw(path, { reveal = false } = {}) {
  const p = clean(path);
  let st;
  try { st = statSync(p); } catch { throw new FsError(404, 'nie ma takiego pliku'); }
  if (!st.isFile()) throw new FsError(400, 'to nie jest zwykły plik');
  if (st.size > RAW_LIMIT) throw new FsError(413, 'plik większy niż 50 MB');
  if (isSecret(p) && !reveal) throw new FsError(403, 'plik wygląda na sekret');
  try { return { name: basename(p), type: imageType(p), data: readFileSync(p) }; } catch { throw new FsError(403, 'brak dostępu'); }
}
