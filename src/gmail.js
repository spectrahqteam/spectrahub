// Gmail, read only, over IMAP with an app password (Google account → Security → App passwords).
// The owner connects one or more mailboxes. SpectraHub only examines them (EXAMINE, BODY.PEEK):
// nothing is sent, moved, deleted or marked as read. Passwords stay in gmail.json (0600) and are
// never sent to the browser. No dependencies: a small IMAP client and a MIME reader live here.
import net from 'node:net';
import tls from 'node:tls';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const SERVER = process.env.SPECTRAHUB_IMAP ?? 'imap.gmail.com:993';  // tests: 127.0.0.1:<port>:plain
const PAGE = 40;
const file = (dir) => join(dir, 'gmail.json');
const load = (dir) => { try { return JSON.parse(readFileSync(file(dir), 'utf8')); } catch { return { accounts: [] }; } };
function store(dir, data) {
  writeFileSync(file(dir), JSON.stringify(data, null, 2), { mode: 0o600 });
  chmodSync(file(dir), 0o600);
}
const visible = ({ password: _p, ...a }) => a;

export class GmailError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- IMAP ----------
// One response record: its text, with literals cut out into `lits` and marked \0<n>\0 in place.
class Imap {
  constructor() { this.buf = Buffer.alloc(0); this.n = 0; this.queue = Promise.resolve(); this.cur = null; this.lit = 0; }

  connect() {
    const [host, port, mode] = SERVER.split(':');
    return new Promise((ok, fail) => {
      const s = mode === 'plain' ? net.connect(Number(port), host) : tls.connect({ host, port: Number(port), servername: host });
      this.sock = s;
      s.setTimeout(30_000, () => s.destroy(new Error('Gmail nie odpowiada')));
      s.on('data', (d) => this.data(d));
      s.on('error', (e) => this.fail(new GmailError(502, e.message === 'Gmail nie odpowiada' ? e.message : 'nie udało się połączyć z Gmailem')));
      s.on('close', () => { this.closed = true; this.fail(new GmailError(502, 'połączenie z Gmailem zostało zamknięte')); });
      this.waiting = { greeting: true, ok, fail };
    });
  }

  data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.lit) {
        if (this.buf.length < this.lit) return;
        this.cur.lits.push(this.buf.subarray(0, this.lit));
        this.cur.text += `\0${this.cur.lits.length - 1}\0`;
        this.buf = this.buf.subarray(this.lit);
        this.lit = 0;
        continue;
      }
      const i = this.buf.indexOf('\r\n');
      if (i < 0) return;
      const line = this.buf.subarray(0, i).toString('utf8');
      this.buf = this.buf.subarray(i + 2);
      this.cur ??= { text: '', lits: [] };
      const m = /\{(\d+)\}$/.exec(line);
      if (m) { this.cur.text += line.slice(0, m.index); this.lit = Number(m[1]); if (!this.lit) this.cur.text += '""'; continue; }
      this.cur.text += line;
      const rec = this.cur;
      this.cur = null;
      this.record(rec);
    }
  }

  record(r) {
    const w = this.waiting;
    if (!w) return;
    if (w.greeting) { this.waiting = null; return /^\* (OK|PREAUTH)/i.test(r.text) ? w.ok() : w.fail(new GmailError(502, 'Gmail odrzucił połączenie')); }
    if (r.text.startsWith('+')) { const c = w.cont; w.cont = null; c?.(); return; }
    if (!r.text.startsWith(`${w.tag} `)) { w.lines.push(r); return; }
    this.waiting = null;
    const status = r.text.slice(w.tag.length + 1);
    if (/^OK/i.test(status)) w.ok(w.lines);
    else w.fail(Object.assign(new GmailError(502, status.replace(/^(NO|BAD)\s*(\[[^\]]*\]\s*)?/i, '').trim() || 'Gmail odmówił'), { imap: status }));
  }

  fail(e) { const w = this.waiting; this.waiting = null; w?.fail(e); }

  // One command at a time; a string with characters outside ASCII goes as a literal.
  run(cmd, lit = null) {
    const p = this.queue.catch(() => {}).then(() => new Promise((ok, fail) => {
      if (this.closed) return fail(new GmailError(502, 'połączenie z Gmailem zostało zamknięte'));
      const tag = `S${++this.n}`;
      const body = lit ? Buffer.from(lit, 'utf8') : null;
      this.waiting = { tag, lines: [], ok, fail, cont: body ? () => this.sock.write(Buffer.concat([body, Buffer.from('\r\n')])) : null };
      this.sock.write(body ? `${tag} ${cmd} {${body.length}}\r\n` : `${tag} ${cmd}\r\n`);
    }));
    this.queue = p;
    return p;
  }

  close() { if (!this.closed) { this.closed = true; this.sock?.end('Z LOGOUT\r\n'); } }
}

const quote = (s) => `"${String(s).replace(/[\\"]/g, '\\$&')}"`;

// Nested lists of an IMAP response: atoms as strings, NIL as null, literals as Buffers.
function sexp(rec, from = 0) {
  const s = rec.text;
  let i = from;
  const read = () => {
    while (s[i] === ' ') i++;
    if (s[i] === '(') {
      i++;
      const list = [];
      for (;;) {
        while (s[i] === ' ') i++;
        if (s[i] === ')') { i++; return list; }
        if (i >= s.length) return list;
        list.push(read());
      }
    }
    if (s[i] === '"') {
      let out = '';
      i++;
      while (i < s.length && s[i] !== '"') { if (s[i] === '\\') i++; out += s[i++]; }
      i++;
      return out;
    }
    if (s[i] === '\0') { const j = s.indexOf('\0', i + 1); const lit = rec.lits[Number(s.slice(i + 1, j))]; i = j + 1; return lit; }
    const start = i;
    while (i < s.length && s[i] !== ' ' && s[i] !== ')' && s[i] !== '(') {
      if (s[i] === '[') { const j = s.indexOf(']', i); i = j < 0 ? s.length : j + 1; continue; }
      i++;
    }
    const atom = s.slice(start, i);
    return atom === 'NIL' ? null : atom;
  };
  const out = [];
  while (i < s.length) { const before = i; out.push(read()); if (i === before) i++; }
  return out;
}

// Mailbox names travel in modified UTF-7 (RFC 3501): "Wys&AUI-ane" is "Wysłane".
function mutf7(s) {
  return String(s ?? '').replace(/&([^-]*)-/g, (_, b) => {
    if (!b) return '&';
    const bytes = Buffer.from(b.replace(/,/g, '/'), 'base64');
    let out = '';
    for (let k = 0; k + 1 < bytes.length; k += 2) out += String.fromCharCode((bytes[k] << 8) | bytes[k + 1]);
    return out;
  });
}

// ---------- MIME ----------
function decoder(charset) {
  const cs = String(charset ?? 'utf-8').trim().toLowerCase().replace(/^(us-)?ascii$/, 'utf-8');
  try { return new TextDecoder(cs); } catch { return new TextDecoder('latin1'); }
}
const asText = (buf, charset) => decoder(charset).decode(buf);

function qp(s, header = false) {
  const src = header ? s.replace(/_/g, ' ') : s.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) { bytes.push(parseInt(src.slice(i + 1, i + 3), 16)); i += 2; }
    else { const c = src.charCodeAt(i); if (c < 128) bytes.push(c); else bytes.push(...Buffer.from(src[i], 'utf8')); }
  }
  return Buffer.from(bytes);
}

// =?utf-8?B?…?= and =?iso-8859-2?Q?…?= in headers; neighbouring encoded words join without a space.
export function words(s) {
  return String(s ?? '').replace(/(=\?[^?]+\?[bBqQ]\?[^?]*\?=)\s+(?==\?)/g, '$1')
    .replace(/=\?([^?*]+)(?:\*[^?]*)?\?([bBqQ])\?([^?]*)\?=/g, (_, cs, enc, data) => {
      try { return asText(enc.toUpperCase() === 'B' ? Buffer.from(data, 'base64') : qp(data, true), cs); } catch { return data; }
    });
}

function headerMap(text) {
  const map = new Map();
  for (const line of text.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(line.slice(i + 1).trim());
  }
  return map;
}
const first = (h, k) => h.get(k)?.[0] ?? '';
const iso = (v) => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null; };

// "text/html; charset=utf-8" → { value, params }, with RFC 2231 names (filename*=UTF-8''…, name*0*=…).
function withParams(v) {
  const parts = [];
  let cur = '';
  let q = false;
  for (const ch of String(v ?? '')) {
    if (ch === '"') q = !q;
    if (ch === ';' && !q) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  const params = {};
  const ext = {};
  for (const p of parts.slice(1)) {
    const i = p.indexOf('=');
    if (i < 0) continue;
    const key = p.slice(0, i).trim().toLowerCase();
    let val = p.slice(i + 1).trim().replace(/^"(.*)"$/s, '$1').replace(/\\(.)/g, '$1');
    const m = /^([^*]+)\*(?:(\d+)\*?)?$/.exec(key);
    if (m) { (ext[m[1]] ??= []).push([Number(m[2] ?? 0), val, key.endsWith('*')]); continue; }
    params[key] = words(val);
  }
  for (const [k, pieces] of Object.entries(ext)) {
    pieces.sort((a, b) => a[0] - b[0]);
    let charset = 'utf-8';
    const out = pieces.map(([n, val, encoded]) => {
      if (n === 0 && encoded && /^[^']*'[^']*'/.test(val)) { const [cs, , rest] = val.split("'"); charset = cs || 'utf-8'; val = rest; }
      return encoded ? asText(Buffer.from(val.replace(/%([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1'), charset) : val;
    }).join('');
    params[k] = out;
  }
  return { value: parts[0].trim().toLowerCase(), params };
}

function decodeBody(buf, cte) {
  const e = String(cte ?? '').trim().toLowerCase();
  if (e === 'base64') return Buffer.from(buf.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  if (e === 'quoted-printable') return qp(buf.toString('latin1'));
  return buf;
}

// A message as a tree of parts; leaves keep their decoded bytes.
function part(buf, id = '1') {
  let cut = buf.indexOf('\r\n\r\n');
  let skip = 4;
  if (cut < 0) { cut = buf.indexOf('\n\n'); skip = 2; }
  if (cut < 0) { cut = buf.length; skip = 0; }
  const h = headerMap(buf.subarray(0, cut).toString('latin1'));
  const body = buf.subarray(Math.min(buf.length, cut + skip));
  const ct = withParams(first(h, 'content-type') || 'text/plain; charset=us-ascii');
  const cd = withParams(first(h, 'content-disposition'));
  const p = { id, h, type: ct.value, params: ct.params, disposition: cd.value, name: cd.params.filename ?? ct.params.name ?? null,
    cid: first(h, 'content-id').replace(/^<|>$/g, '') || null };
  if (ct.value.startsWith('multipart/') && ct.params.boundary) {
    const b = Buffer.from(`--${ct.params.boundary}`);
    const kids = [];
    let at = body.indexOf(b);
    while (at >= 0) {
      const start = body.indexOf('\n', at) + 1;
      if (body.subarray(at + b.length, at + b.length + 2).toString() === '--' || start <= 0) break;
      let next = body.indexOf(b, start);
      if (next < 0) next = body.length;
      let end = next;
      if (body[end - 1] === 0x0a) end--;
      if (body[end - 1] === 0x0d) end--;
      kids.push(part(body.subarray(start, end), `${id}.${kids.length + 1}`));
      at = next < body.length ? next : -1;
    }
    p.children = kids;
  } else if (ct.value === 'message/rfc822') {
    p.children = [part(decodeBody(body, first(h, 'content-transfer-encoding')), `${id}.1`)];
  } else {
    p.data = decodeBody(body, first(h, 'content-transfer-encoding'));
  }
  return p;
}

function leaves(p, out = []) {
  if (p.children) for (const c of p.children) leaves(c, out);
  else out.push(p);
  return out;
}

function addresses(v) {
  const out = [];
  let cur = '';
  let q = false;
  let angle = false;
  for (const ch of words(v)) {
    if (ch === '"') q = !q;
    if (ch === '<') angle = true;
    if (ch === '>') angle = false;
    if (ch === ',' && !q && !angle) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((a) => a.trim()).filter(Boolean).map((a) => {
    const m = /^(.*?)\s*<([^>]+)>$/.exec(a);
    return m ? { name: m[1].replace(/^"|"$/g, '').trim() || null, email: m[2].trim() } : { name: null, email: a.replace(/^<|>$/g, '') };
  });
}

// What the reader needs: the headers, the HTML or text body, and the attachments.
export function readMessage(raw) {
  const root = part(raw);
  const all = leaves(root);
  const isAttachment = (p) => p.disposition === 'attachment' || (p.name && !p.type.startsWith('text/'));
  const html = all.find((p) => p.type === 'text/html' && !isAttachment(p));
  const text = all.find((p) => p.type === 'text/plain' && !isAttachment(p));
  const files = all.filter((p) => p !== html && p !== text && (isAttachment(p) || p.cid || !p.type.startsWith('text/')));
  const h = root.h;
  return {
    subject: words(first(h, 'subject')),
    from: addresses(first(h, 'from')), to: addresses(h.get('to')?.join(', ') ?? ''), cc: addresses(h.get('cc')?.join(', ') ?? ''),
    replyTo: addresses(first(h, 'reply-to')),
    date: iso(first(h, 'date')),
    html: html ? asText(html.data, html.params.charset).slice(0, 3_000_000) : null,
    text: text ? asText(text.data, text.params.charset).slice(0, 1_000_000) : null,
    attachments: files.map((p) => ({ id: p.id, name: p.name ?? (p.cid ? `obraz ${p.cid}` : 'załącznik'), type: p.type, size: p.data?.length ?? 0,
      cid: p.cid, inline: Boolean(p.cid) && p.disposition !== 'attachment' })),
  };
}

export function messagePart(raw, id) {
  const p = leaves(part(raw)).find((x) => x.id === id);
  return p ? { name: p.name ?? 'załącznik', type: p.type || 'application/octet-stream', data: p.data } : null;
}

// ---------- accounts and connections ----------
const pool = new Map();  // account id -> { imap, box, timer, chain }

function account(dir, id) {
  const a = load(dir).accounts.find((x) => x.id === id);
  if (!a) throw new GmailError(404, 'nie ma takiej skrzynki');
  return a;
}

async function open(email, password) {
  const c = new Imap();
  await c.connect();
  try { await c.run(`LOGIN ${quote(email)} ${quote(password)}`); }
  catch (e) {
    c.close();
    throw new GmailError(400, /AUTHENTICATIONFAILED|Invalid credentials/i.test(e.imap ?? e.message)
      ? 'Gmail odrzucił logowanie — sprawdź adres i hasło aplikacji'
      : /IMAP access|disabled/i.test(e.message) ? 'IMAP jest wyłączony na tym koncie' : e.message);
  }
  return c;
}

// Work on one account's connection, one request at a time; it closes after two idle minutes.
function withMailbox(dir, id, work) {
  const acc = account(dir, id);
  let slot = pool.get(id);
  if (!slot) { slot = { chain: Promise.resolve() }; pool.set(id, slot); }
  const run = slot.chain.catch(() => {}).then(async () => {
    clearTimeout(slot.timer);
    if (!slot.imap || slot.imap.closed) { slot.imap = await open(acc.email, acc.password); slot.box = null; }
    try { return await work(slot.imap, slot, acc); }
    catch (e) { if (slot.imap?.closed) slot.imap = null; throw e; }  // a refused command keeps the connection
    finally { slot.timer = setTimeout(() => { slot.imap?.close(); slot.imap = null; }, 120_000); slot.timer.unref?.(); }
  });
  slot.chain = run;
  return run;
}

async function examine(c, slot, box) {
  if (slot.box === box) return slot.exists;
  const lines = await c.run(`EXAMINE ${quote(box)}`);
  slot.box = box;
  slot.exists = Number(/^\* (\d+) EXISTS/im.exec(lines.map((l) => l.text).join('\n'))?.[1] ?? 0);
  return slot.exists;
}

export function accounts(dir) {
  return load(dir).accounts.map(visible);
}

export async function connect(dir, { email, password, label }) {
  const e = String(email ?? '').trim().toLowerCase();
  const p = String(password ?? '').replace(/\s+/g, '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new GmailError(400, 'podaj adres Gmail');
  if (!/^[a-z]{16}$/i.test(p)) throw new GmailError(400, 'hasło aplikacji ma 16 liter (Google pokazuje je w czterech grupach)');
  const c = await open(e, p);
  c.close();
  const data = load(dir);
  const acc = { id: randomUUID().slice(0, 8), email: e, label: String(label ?? '').trim().slice(0, 40) || null, addedAt: new Date().toISOString(), password: p };
  data.accounts = data.accounts.filter((a) => a.email !== e);  // connecting again replaces the old password
  data.accounts.push(acc);
  store(dir, data);
  return visible(acc);
}

export function disconnect(dir, id) {
  const data = load(dir);
  const before = data.accounts.length;
  data.accounts = data.accounts.filter((a) => a.id !== id);
  if (data.accounts.length === before) throw new GmailError(404, 'nie ma takiej skrzynki');
  store(dir, data);
  const slot = pool.get(id);
  slot?.imap?.close();
  pool.delete(id);
}

const SPECIAL = { '\\inbox': 'inbox', '\\flagged': 'starred', '\\sent': 'sent', '\\drafts': 'drafts', '\\all': 'all', '\\junk': 'spam', '\\trash': 'trash', '\\important': 'important' };

// The mailbox's folders and labels; special ones are recognised by their role, not their name.
export function boxes(dir, id) {
  return withMailbox(dir, id, async (c) => {
    const lines = await c.run('LIST "" "*"');
    const list = [];
    for (const r of lines) {
      if (!/^\* LIST /i.test(r.text)) continue;
      const [flags, , name] = sexp(r, 7);
      const f = (flags ?? []).map((x) => String(x).toLowerCase());
      if (f.includes('\\noselect')) continue;
      const path = String(name);
      const special = path.toUpperCase() === 'INBOX' ? 'inbox' : f.map((x) => SPECIAL[x]).find(Boolean) ?? null;
      list.push({ path, name: mutf7(path.replace(/^\[Gmail\]\//, '')), special });
    }
    const inbox = list.find((b) => b.special === 'inbox');
    if (inbox) {
      const st = (await c.run('STATUS "INBOX" (MESSAGES UNSEEN)')).map((l) => l.text).join(' ');
      inbox.unseen = Number(/UNSEEN (\d+)/i.exec(st)?.[1] ?? 0);
      inbox.total = Number(/MESSAGES (\d+)/i.exec(st)?.[1] ?? 0);
    }
    return list;
  });
}

const SUMMARY = '(UID FLAGS INTERNALDATE RFC822.SIZE X-GM-LABELS X-GM-MSGID BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE CONTENT-TYPE)])';

function summaries(lines) {
  const out = [];
  for (const r of lines) {
    const m = /^\* \d+ FETCH /i.exec(r.text);
    if (!m) continue;
    const kv = sexp(r, m[0].length)[0] ?? [];
    const o = {};
    for (let i = 0; i + 1 < kv.length; i += 2) o[String(kv[i]).toUpperCase().replace(/^BODY\[HEADER.*$/, 'HEADER')] = kv[i + 1];
    const h = headerMap(Buffer.isBuffer(o.HEADER) ? o.HEADER.toString('latin1') : String(o.HEADER ?? ''));
    const flags = (o.FLAGS ?? []).map(String);
    const labels = (o['X-GM-LABELS'] ?? []).map((x) => mutf7(String(x)));
    out.push({
      uid: Number(o.UID), subject: words(first(h, 'subject')) || '(bez tematu)', from: addresses(first(h, 'from'))[0] ?? null, to: addresses(first(h, 'to')),
      date: iso(first(h, 'date')) ?? iso(o.INTERNALDATE),
      size: Number(o['RFC822.SIZE'] ?? 0), unread: !flags.includes('\\Seen'), starred: flags.includes('\\Flagged'),
      files: /multipart\/mixed/i.test(first(h, 'content-type')),
      labels: labels.filter((l) => !/^\\(Inbox|Sent|Important|Starred|Draft|Drafts|All|Spam|Trash)$/i.test(l)),
      important: labels.some((l) => /^\\Important$/i.test(l)),
      msgid: o['X-GM-MSGID'] ? BigInt(o['X-GM-MSGID']).toString(16) : null,
    });
  }
  return out.sort((a, b) => b.uid - a.uid);
}

// The newest messages of a folder, PAGE at a time (`before`: the position to continue from),
// or what a Gmail search finds (the same words as in Gmail: from:, is:unread, has:attachment…).
export function messages(dir, id, { box = 'INBOX', before = null, q = '' } = {}) {
  return withMailbox(dir, id, async (c, slot) => {
    if (!before) slot.box = null;  // a fresh list counts the folder again
    const exists = await examine(c, slot, box);
    if (q) {
      const ascii = /^[\x20-\x7e]*$/.test(q);
      const found = ascii ? await c.run(`UID SEARCH X-GM-RAW ${quote(q)}`) : await c.run('UID SEARCH CHARSET UTF-8 X-GM-RAW', q);
      const uids = found.flatMap((r) => (/^\* SEARCH/i.test(r.text) ? r.text.slice(8).trim().split(/\s+/).filter(Boolean).map(Number) : []));
      const below = before ? uids.filter((u) => u < Number(before)) : uids;
      const pick = below.slice(-PAGE);
      const list = pick.length ? summaries(await c.run(`UID FETCH ${pick.join(',')} ${SUMMARY}`)) : [];
      return { messages: list, total: uids.length, next: below.length > PAGE ? String(Math.min(...pick)) : null };
    }
    const top = before ? Number(before) - 1 : exists;
    if (top < 1) return { messages: [], total: exists, next: null };
    const from = Math.max(1, top - PAGE + 1);
    const list = summaries(await c.run(`FETCH ${from}:${top} ${SUMMARY}`));
    return { messages: list, total: exists, next: from > 1 ? String(from) : null };
  });
}

const raws = new Map();  // `${id}:${box}:${uid}` -> { at, raw }: attachments are cut from the message just read

async function rawMessage(c, slot, id, box, uid) {
  const key = `${id}:${box}:${uid}`;
  const hit = raws.get(key);
  if (hit && Date.now() - hit.at < 300_000) return hit;
  await examine(c, slot, box);
  const lines = await c.run(`UID FETCH ${Number(uid)} (UID FLAGS X-GM-LABELS X-GM-MSGID X-GM-THRID BODY.PEEK[])`);
  const r = lines.find((l) => /^\* \d+ FETCH /i.test(l.text));
  if (!r) throw new GmailError(404, 'nie ma takiej wiadomości');
  const kv = sexp(r, /^\* \d+ FETCH /i.exec(r.text)[0].length)[0] ?? [];
  const o = {};
  for (let i = 0; i + 1 < kv.length; i += 2) o[String(kv[i]).toUpperCase()] = kv[i + 1];
  const raw = Buffer.isBuffer(o['BODY[]']) ? o['BODY[]'] : Buffer.from(String(o['BODY[]'] ?? ''));
  if (raw.length > 25 * 1024 * 1024) throw new GmailError(413, 'wiadomość jest za duża na podgląd');
  const entry = { at: Date.now(), raw, o };
  raws.set(key, entry);
  for (const [k, v] of raws) if (Date.now() - v.at > 300_000 || raws.size > 20) raws.delete(k);
  return entry;
}

export function message(dir, id, { box = 'INBOX', uid }) {
  return withMailbox(dir, id, async (c, slot, acc) => {
    const { raw, o } = await rawMessage(c, slot, id, box, uid);
    const flags = (o.FLAGS ?? []).map(String);
    const labels = (o['X-GM-LABELS'] ?? []).map((x) => mutf7(String(x)));
    const msgid = o['X-GM-MSGID'] ? BigInt(o['X-GM-MSGID']).toString(16) : null;
    return { uid: Number(uid), ...readMessage(raw), unread: !flags.includes('\\Seen'), starred: flags.includes('\\Flagged'),
      labels: labels.filter((l) => !/^\\/.test(l)), msgid,
      url: msgid ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(acc.email)}#all/${msgid}` : null };
  });
}

export function attachment(dir, id, { box = 'INBOX', uid, part: pid }) {
  return withMailbox(dir, id, async (c, slot) => {
    const { raw } = await rawMessage(c, slot, id, box, uid);
    const p = messagePart(raw, String(pid));
    if (!p) throw new GmailError(404, 'nie ma takiego załącznika');
    return p;
  });
}

export const _test = { sexp, mutf7, Imap };
