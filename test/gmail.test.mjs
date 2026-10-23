// Gmail, read only, against a stand-in IMAP server: no network, no real password.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'spectrahub-gm-'));
const PASS = 'abcdabcdabcdabcd';
const PDF = Buffer.from('%PDF-1.4 faktura');
const b64 = (s) => Buffer.from(s).toString('base64');

const RAW = [
  'From: =?UTF-8?B?' + b64('Łukasz Żak') + '?= <lukasz@example.com>',
  'To: ala@example.com',
  'Subject: =?UTF-8?B?' + b64('Faktura za październik') + '?=',
  'Date: Tue, 21 Oct 2026 10:00:00 +0200',
  'Content-Type: multipart/mixed; boundary="mix"',
  '',
  '--mix',
  'Content-Type: multipart/alternative; boundary="alt"',
  '',
  '--alt',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Dzie=C5=84 dobry, w za=C5=82=C4=85czniku faktura.',
  '--alt',
  'Content-Type: text/html; charset=utf-8',
  'Content-Transfer-Encoding: base64',
  '',
  b64('<p>Dzień dobry, <b>faktura</b> <img src="cid:logo@x"></p>'),
  '--alt--',
  '--mix',
  'Content-Type: image/png',
  'Content-ID: <logo@x>',
  'Content-Transfer-Encoding: base64',
  '',
  b64('PNGDATA'),
  '--mix',
  "Content-Type: application/pdf; name*=UTF-8''faktura%20%C5%BC.pdf",
  "Content-Disposition: attachment; filename*=UTF-8''faktura%20%C5%BC.pdf",
  'Content-Transfer-Encoding: base64',
  '',
  PDF.toString('base64'),
  '--mix--',
  '',
].join('\r\n');

const MAILS = [
  { seq: 1, uid: 101, flags: '\\Seen', labels: '\\Inbox "Faktury"', head: `From: =?UTF-8?B?${b64('Łukasz Żak')}?= <lukasz@example.com>\r\nSubject: =?UTF-8?B?${b64('Faktura za październik')}?=\r\nDate: Tue, 21 Oct 2026 10:00:00 +0200\r\nContent-Type: multipart/mixed; boundary="mix"\r\n\r\n` },
  { seq: 2, uid: 102, flags: '\\Seen \\Flagged', labels: '\\Inbox', head: 'From: "Bank" <bank@example.com>\r\nSubject: Wyciąg\r\nDate: bad date\r\nContent-Type: text/plain\r\n\r\n' },
  { seq: 3, uid: 103, flags: '', labels: '\\Inbox \\Important', head: 'From: ola@example.com\r\nSubject: Spotkanie jutro\r\nDate: Wed, 22 Oct 2026 08:00:00 +0000\r\n\r\n' },
];

let imap;
let server;
let base;
let auth;
const commands = [];

function summary(m) {
  const head = Buffer.from(m.head);
  return `* ${m.seq} FETCH (UID ${m.uid} FLAGS (${m.flags}) INTERNALDATE "21-Oct-2026 10:00:00 +0200" RFC822.SIZE 900 X-GM-LABELS (${m.labels}) X-GM-MSGID 1500${m.uid} BODY[HEADER.FIELDS (FROM TO SUBJECT DATE CONTENT-TYPE)] {${head.length}}\r\n${m.head})\r\n`;
}

before(async () => {
  imap = createServer((sock) => {
    let buf = '';
    let pending = null;
    sock.write('* OK Gimap ready\r\n');
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (pending) { const p = pending; pending = null; p(line); continue; }
        commands.push(line);
        const [tag, ...rest] = line.split(' ');
        const cmd = rest.join(' ');
        const ok = (extra = '') => sock.write(`${extra}${tag} OK done\r\n`);
        if (/^LOGIN /.test(cmd)) cmd.endsWith(`"${PASS}"`) ? ok() : sock.write(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)\r\n`);
        else if (/^LIST /.test(cmd)) ok('* LIST (\\HasNoChildren) "/" "INBOX"\r\n* LIST (\\HasChildren \\Noselect) "/" "[Gmail]"\r\n* LIST (\\All \\HasNoChildren) "/" "[Gmail]/Wszystkie"\r\n* LIST (\\HasNoChildren \\Sent) "/" "[Gmail]/Wys&AUI-ane"\r\n* LIST (\\HasNoChildren) "/" "Faktury"\r\n');
        else if (/^STATUS /.test(cmd)) ok('* STATUS "INBOX" (MESSAGES 3 UNSEEN 1)\r\n');
        else if (/^EXAMINE /.test(cmd)) ok('* FLAGS (\\Seen)\r\n* 3 EXISTS\r\n* 0 RECENT\r\n');
        else if (/^FETCH 1:3 /.test(cmd)) ok(MAILS.map(summary).join(''));
        else if (/^UID SEARCH X-GM-RAW "faktura"$/.test(cmd)) ok('* SEARCH 101\r\n');
        else if (/^UID SEARCH CHARSET UTF-8 X-GM-RAW \{\d+\}$/.test(cmd)) { sock.write('+ go ahead\r\n'); pending = (q) => { commands.push(`literal ${q}`); ok(q === 'wyciąg' ? '* SEARCH 102\r\n' : '* SEARCH\r\n'); }; }
        else if (/^UID FETCH (\d+(,\d+)*) \(UID FLAGS INTERNALDATE/.test(cmd)) { const uids = cmd.split(' ')[2].split(',').map(Number); ok(MAILS.filter((m) => uids.includes(m.uid)).map(summary).join('')); }
        else if (/^UID FETCH 101 \(UID FLAGS X-GM-LABELS X-GM-MSGID X-GM-THRID BODY\.PEEK\[\]\)$/.test(cmd)) {
          const raw = Buffer.from(RAW);
          sock.write(`* 1 FETCH (UID 101 FLAGS (\\Seen) X-GM-LABELS (\\Inbox "Faktury") X-GM-MSGID 1500101 X-GM-THRID 1500101 BODY[] {${raw.length}}\r\n`);
          sock.write(raw);
          ok(')\r\n');
        } else if (/^LOGOUT/.test(cmd)) { sock.end('* BYE\r\n'); }
        else sock.write(`${tag} BAD unknown\r\n`);
      }
    });
    sock.on('error', () => {});
  });
  await new Promise((r) => imap.listen(0, '127.0.0.1', r));
  process.env.SPECTRAHUB_IMAP = `127.0.0.1:${imap.address().port}:plain`;
  const { start } = await import('../src/server.js');
  const { ensureToken } = await import('../src/terminal.js');
  auth = { Authorization: `Bearer ${ensureToken(dir)}`, 'Content-Type': 'application/json' };
  server = await start({ dir, server: { host: '127.0.0.1', port: 0 } });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  imap?.close();
  rmSync(dir, { recursive: true, force: true });
});

const api = (path, opts = {}) => fetch(base + path, { ...opts, headers: { ...auth, ...(opts.headers ?? {}) } });
let acc;

test('a mailbox is connected with an app password, which never leaves the server', async () => {
  assert.equal((await fetch(`${base}/api/gmail`)).status, 401);
  assert.equal((await api('/api/gmail', { method: 'POST', body: JSON.stringify({ email: 'ala@example.com', password: 'krótkie' }) })).status, 400);
  const wrong = await api('/api/gmail', { method: 'POST', body: JSON.stringify({ email: 'ala@example.com', password: 'zzzz zzzz zzzz zzzz' }) });
  assert.equal(wrong.status, 400);
  assert.match((await wrong.json()).error, /odrzucił logowanie/);
  const ok = await api('/api/gmail', { method: 'POST', body: JSON.stringify({ email: 'Ala@Example.com', password: 'abcd abcd abcd abcd', label: 'prywatna' }) });
  assert.equal(ok.status, 201);
  acc = (await ok.json()).account;
  assert.deepEqual([acc.email, acc.label, acc.password], ['ala@example.com', 'prywatna', undefined]);
  assert.ok(!(await (await api('/api/gmail')).text()).includes(PASS));
  assert.equal(statSync(join(dir, 'gmail.json')).mode & 0o777, 0o600);
});

test('folders, the newest messages and Gmail search', async () => {
  const { boxes } = await (await api(`/api/gmail/${acc.id}/boxes`)).json();
  assert.deepEqual(boxes.map((b) => [b.name, b.special]), [['INBOX', 'inbox'], ['Wszystkie', 'all'], ['Wysłane', 'sent'], ['Faktury', null]]);
  assert.equal(boxes[0].unseen, 1);

  const page = await (await api(`/api/gmail/${acc.id}/messages`)).json();
  assert.deepEqual(page.messages.map((m) => m.uid), [103, 102, 101], 'newest first');
  const [ola, bank, faktura] = page.messages;
  assert.deepEqual([ola.unread, ola.important, bank.starred, bank.date], [true, true, true, '2026-10-21T08:00:00.000Z'], 'a bad Date header falls back to the arrival time');
  assert.deepEqual([faktura.subject, faktura.from.name, faktura.files, faktura.labels], ['Faktura za październik', 'Łukasz Żak', true, ['Faktury']]);

  assert.deepEqual((await (await api(`/api/gmail/${acc.id}/messages?q=faktura`)).json()).messages.map((m) => m.uid), [101]);
  assert.deepEqual((await (await api(`/api/gmail/${acc.id}/messages?q=${encodeURIComponent('wyciąg')}`)).json()).messages.map((m) => m.uid), [102], 'non-ASCII searches go as a literal');
});

test('a message reads with its text, HTML, pictures and attachments', async () => {
  const { message: m } = await (await api(`/api/gmail/${acc.id}/message/101`)).json();
  assert.equal(m.subject, 'Faktura za październik');
  assert.equal(m.text, 'Dzień dobry, w załączniku faktura.');
  assert.match(m.html, /<b>faktura<\/b>/);
  assert.deepEqual(m.attachments.map((a) => [a.name, a.type, a.inline]), [['obraz logo@x', 'image/png', true], ['faktura ż.pdf', 'application/pdf', false]]);
  assert.equal(m.labels[0], 'Faktury');
  assert.match(m.url, /mail\.google\.com/);

  const pdf = m.attachments[1];
  const r = await api(`/api/gmail/${acc.id}/message/101/part/${pdf.id}`);
  assert.equal(r.headers.get('content-type'), 'application/octet-stream');
  assert.match(r.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''faktura%20%C5%BC\.pdf$/);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), PDF);
  const img = await api(`/api/gmail/${acc.id}/message/101/part/${m.attachments[0].id}`);
  assert.equal(img.headers.get('content-type'), 'image/png');

  const writes = commands.filter((c) => /\b(SELECT|STORE|COPY|MOVE|EXPUNGE|APPEND|DELETE|CREATE|RENAME)\b/.test(c) || /FETCH.*BODY\[(?!HEADER)/.test(c));
  assert.deepEqual(writes, [], 'only EXAMINE and BODY.PEEK: nothing is changed, nothing marked as read');
});

test('a mailbox can be disconnected', async () => {
  assert.equal((await api(`/api/gmail/${acc.id}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual((await (await api('/api/gmail')).json()).accounts, []);
});
