// Gmail, read only: mailboxes the owner connected with app passwords. Folders and labels, a list
// newest first, Gmail search, and a reader that shows mail safely: HTML runs in a sandbox without
// scripts, and pictures from the internet stay blocked until asked for. Uses the helpers of app.js.
const GMAIL_LOGO = '<path fill="#4285f4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6"/><path fill="#34a853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15"/><path fill="#fbbc04" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2"/><path fill="#ea4335" d="M72 74V48l24 18 24-18v26L96 92"/><path fill="#c5221f" d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2"/>';
const GM = { accounts: [], acc: null, boxes: [], box: 'INBOX', q: '', list: [], next: null, total: 0 };
const GM_BOX = { inbox: 'Odebrane', starred: 'Oznaczone', important: 'Ważne', sent: 'Wysłane', drafts: 'Wersje robocze', all: 'Wszystkie', spam: 'Spam', trash: 'Kosz' };
const GM_ORDER = ['inbox', 'starred', 'important', 'sent', 'drafts', 'all', 'spam', 'trash'];
const GM_ICON = {
  clip: '<path d="m20 12-8.5 8.5a5 5 0 0 1-7-7L13 5a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 8"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
  img: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 9"/>',
};

function gmailLogo(size = 20) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '52 42 88 66');
  s.setAttribute('class', 'gmail-logo');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = GMAIL_LOGO;
  s.style.width = `${size}px`;
  return s;
}
// A sender's letter on a colour of its own, so a list is easy to scan.
function gmFace(who, size = 34) {
  const name = who?.name || who?.email || '?';
  const f = el('span', 'gm-face', (name.replace(/[^\p{L}\p{N}]/gu, '')[0] ?? '?').toUpperCase());
  let h = 0;
  for (const ch of who?.email ?? name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  f.style.cssText = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px;--h:${h}`;
  return f;
}
const gmWho = (a) => (a ? a.name || a.email : '');
const gmApi = (path) => `/api/gmail/${encodeURIComponent(GM.acc)}${path}`;
function gmWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('pl-PL', d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'numeric', year: '2-digit' });
}

async function gmailPage() {
  setView('page');
  titleEl.textContent = 'Gmail';
  subEl.textContent = 'tylko podgląd';
  const box = el('div', 'page gm');
  box.append(ghLoading('łączę z Gmailem…'));
  out.replaceChildren(box);
  renderDrawer();
  try { GM.accounts = (await ghJson('/api/gmail')).accounts; } catch (e) { box.replaceChildren(ghError(e)); return; }
  if (!GM.accounts.length) return gmEmpty(box);
  if (!GM.accounts.some((a) => a.id === GM.acc)) { GM.acc = GM.accounts[0].id; GM.boxes = []; GM.box = 'INBOX'; }
  gmMailbox(box);
}

function gmEmpty(box) {
  subEl.textContent = 'nic nie podłączono';
  const hero = el('div', 'gh-hero');
  const ring = el('span', 'gh-ring gm-ring');
  ring.append(gmailLogo(40));
  const go = el('button', 's-primary gm-go');
  go.type = 'button';
  go.append(gmailLogo(18), el('span', null, 'Podłącz Gmail'));
  go.addEventListener('click', gmConnectSheet);
  hero.append(ring, el('b', null, 'Twoja poczta w SpectraHub'),
    el('p', null, 'Odebrane, etykiety i wyszukiwanie jak w Gmailu. Tylko podgląd: SpectraHub niczego nie wysyła, nie usuwa i nie oznacza jako przeczytane.'),
    go, el('small', null, 'Możesz podłączyć kilka skrzynek, każdą jej hasłem aplikacji.'));
  box.replaceChildren(hero);
}

function gmConnectSheet() {
  const f = el('form', 's-form gh-form');
  const email = el('input');
  Object.assign(email, { type: 'email', placeholder: 'adres@gmail.com', autocomplete: 'off', required: true });
  const pass = el('input');
  Object.assign(pass, { type: 'password', placeholder: 'hasło aplikacji: xxxx xxxx xxxx xxxx', autocomplete: 'off', maxLength: 40 });
  const label = el('input');
  Object.assign(label, { placeholder: 'nazwa, np. prywatna albo firma (opcjonalnie)', maxLength: 40, autocomplete: 'off' });
  const ok = el('button', 's-primary gm-go');
  ok.type = 'submit';
  ok.append(gmailLogo(18), el('span', null, 'połącz'));
  f.append(email, pass, label, ok);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!email.value.trim()) return email.focus();
    if (!pass.value.trim()) return pass.focus();
    ok.disabled = true;
    ok.lastChild.textContent = 'loguję do Gmaila…';
    const res = await jpost('/api/gmail', { email: email.value.trim(), password: pass.value, label: label.value.trim() });
    const d = await res.json().catch(() => ({}));
    ok.disabled = false;
    ok.lastChild.textContent = 'połącz';
    if (!res.ok) return toast(d.error ?? 'nie udało się');
    pass.value = '';
    closeSheet();
    toast(`połączono ${d.account.email}`);
    GM.acc = d.account.id;
    GM.boxes = [];
    GM.box = 'INBOX';
    gmailPage();
  });
  const link = (text, href) => { const a = el('a', 'gh-link', text); Object.assign(a, { href, target: '_blank', rel: 'noopener noreferrer' }); a.append(ghIcon('out')); return a; };
  const steps = el('ol', 'gh-steps');
  steps.append(el('li', null, 'Włącz weryfikację dwuetapową na koncie Google.'), el('li', null, 'Utwórz hasło aplikacji, np. o nazwie „SpectraHub”.'), el('li', null, 'Wklej tutaj adres i 16 liter hasła — spacje mogą zostać.'));
  openSheet('Podłącz Gmail', [f, steps, link('Weryfikacja dwuetapowa', 'https://myaccount.google.com/signinoptions/twosv'), link('Hasła aplikacji Google', 'https://myaccount.google.com/apppasswords'),
    el('p', 's-note', 'Hasło aplikacji zostaje na tym serwerze (plik z prawami 600) i nigdy nie wraca do przeglądarki. Unieważnisz je w każdej chwili na koncie Google. W kontach firmowych (Workspace) hasła aplikacji może wyłączyć administrator.')],
  { push: sheetStack.length > 0 });
  setTimeout(() => email.focus(), 250);
}

function gmAccountsSheet() {
  openSheet('Skrzynki Gmail', () => [
    group(...GM.accounts.map((a) => item(gmFace({ email: a.email }, 26), a.label ? `${a.email} · ${a.label}` : a.email, () => confirmSheet(`Odłączyć ${a.email}?`,
      'Hasło aplikacji zostanie usunięte z serwera. Na koncie Google możesz je też unieważnić.', 'odłącz', async () => {
        await api(`/api/gmail/${a.id}`, { method: 'DELETE' });
        GM.acc = null;
        gmailPage();
      }), { sub: `od ${new Date(a.addedAt).toLocaleDateString('pl-PL')}`, right: svgIcon(ICON.trash) }))),
    (() => { const b = el('button', 's-primary', 'Podłącz kolejną skrzynkę'); b.type = 'button'; b.addEventListener('click', gmConnectSheet); return b; })(),
  ]);
}

// ---------- a mailbox ----------
async function gmMailbox(box, { keep = false } = {}) {
  const acc = GM.accounts.find((a) => a.id === GM.acc);
  subEl.textContent = acc.email;
  const head = el('div', 'gm-headrow');
  const accs = el('div', 'gh-accs');
  for (const a of GM.accounts) {
    const b = el('button', `gh-acc${a.id === GM.acc ? ' on' : ''}`);
    b.type = 'button';
    b.append(gmFace({ email: a.email }, 18), el('span', null, a.label ?? a.email));
    b.addEventListener('click', () => { GM.acc = a.id; GM.boxes = []; GM.box = 'INBOX'; GM.q = ''; gmMailbox(box); });
    accs.append(b);
  }
  const add = el('button', 'gh-acc add');
  add.type = 'button';
  add.append(svgIcon(ICON.plus), el('span', null, 'skrzynka'));
  add.addEventListener('click', gmAccountsSheet);
  accs.append(add);
  head.append(accs);

  const folders = el('div', 'gm-folders');
  const search = el('form', 'gh-search');
  const inp = el('input');
  Object.assign(inp, { type: 'search', placeholder: 'szukaj jak w Gmailu: from:, is:unread, has:attachment', value: GM.q, autocomplete: 'off', enterKeyHint: 'search' });
  search.append(svgIcon('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'), inp);
  search.addEventListener('submit', (e) => { e.preventDefault(); GM.q = inp.value.trim(); inp.blur(); gmLoad(listEl, true); });
  const listEl = el('div', 'gm-list');
  box.replaceChildren(head, folders, search, listEl);

  if (!GM.boxes.length) {
    folders.append(ghLoading('wczytuję foldery…'));
    try { GM.boxes = (await ghJson(gmApi('/boxes'))).boxes; } catch (e) { box.replaceChildren(head, ghError(e)); return; }
  }
  gmFolders(folders, listEl);
  if (keep && GM.list.length) gmRender(listEl); else gmLoad(listEl, true);
}

function gmFolders(folders, listEl) {
  folders.replaceChildren();
  const specials = GM.boxes.filter((b) => b.special).sort((a, b) => GM_ORDER.indexOf(a.special) - GM_ORDER.indexOf(b.special));
  const labels = GM.boxes.filter((b) => !b.special);
  const pick = (path) => () => { GM.box = path; GM.q = ''; gmFolders(folders, listEl); gmLoad(listEl, true); folders.parentElement.querySelector('.gh-search input').value = ''; };
  for (const b of specials) {
    const c = el('button', `gm-folder${GM.box === b.path ? ' on' : ''}`);
    c.type = 'button';
    c.append(el('span', null, GM_BOX[b.special] ?? b.name));
    if (b.unseen) c.append(el('small', null, String(b.unseen)));
    c.addEventListener('click', pick(b.path));
    folders.append(c);
  }
  if (labels.length) {
    const current = labels.find((b) => b.path === GM.box);
    const c = el('button', `gm-folder${current ? ' on' : ''}`);
    c.type = 'button';
    c.append(svgIcon(GM_ICON.tag), el('span', null, current ? current.name : 'Etykiety'));
    c.addEventListener('click', () => openSheet('Etykiety', [group(...labels.map((b) => item(GM_ICON.tag, b.name, () => { closeSheet(); pick(b.path)(); },
      { right: b.path === GM.box ? svgIcon(ICON.check) : null })))]));
    folders.append(c);
  }
}

async function gmLoad(listEl, fresh) {
  if (fresh) { GM.list = []; GM.next = null; listEl.replaceChildren(ghLoading(GM.q ? 'szukam…' : 'wczytuję wiadomości…')); }
  const all = GM.boxes.find((b) => b.special === 'all');
  const where = GM.q && all ? all.path : GM.box;  // a search looks through all mail, like Gmail does
  const qs = new URLSearchParams({ box: where });
  if (GM.q) qs.set('q', GM.q);
  if (!fresh && GM.next) qs.set('before', GM.next);
  try {
    const d = await ghJson(gmApi(`/messages?${qs}`));
    GM.list.push(...d.messages.map((m) => ({ ...m, box: where })));
    GM.next = d.next;
    GM.total = d.total;
    gmRender(listEl);
  } catch (e) { listEl.replaceChildren(ghError(e)); }
}

function gmRender(listEl) {
  if (!GM.list.length) { listEl.replaceChildren(el('p', 's-note', GM.q ? 'Nic nie znaleziono.' : 'Pusto.')); return; }
  const rows = GM.list.map((m) => {
    const r = el('button', `gm-row${m.unread ? ' unread' : ''}`);
    r.type = 'button';
    const main = el('span', 'gm-main');
    const top = el('span', 'gm-top');
    top.append(el('b', 'gm-from', gmWho(m.from) || '(bez nadawcy)'), el('small', 'gm-when', gmWhen(m.date)));
    const sub = el('span', 'gm-subj');
    if (m.important) sub.append(el('i', 'gm-imp'));
    sub.append(el('span', null, m.subject));
    const tags = el('span', 'gm-tags');
    for (const l of m.labels.slice(0, 3)) tags.append(chip(l, 'gm-label'));
    if (m.files) tags.append(svgIcon(GM_ICON.clip));
    if (m.starred) { const s = svgIcon(GM_ICON.star); s.classList.add('gm-star'); tags.append(s); }
    main.append(top, sub);
    if (tags.childNodes.length) main.append(tags);
    r.append(gmFace(m.from), main);
    r.addEventListener('click', () => gmOpen(m));
    return r;
  });
  const info = el('p', 'gm-count', GM.q ? `wyniki: ${GM.total}` : `${GM.total} w folderze`);
  listEl.replaceChildren(info, ...rows);
  if (GM.next) {
    const more = el('button', 's-primary ghost', 'starsze wiadomości');
    more.type = 'button';
    more.addEventListener('click', async () => { more.disabled = true; more.textContent = 'wczytuję…'; await gmLoad(listEl, false); });
    listEl.append(more);
  }
}

// ---------- one message ----------
async function gmOpen(m) {
  const box = el('div', 'page gm');
  const back = el('button', 'gh-back');
  back.type = 'button';
  const folder = GM.boxes.find((b) => b.path === GM.box);
  back.append(ghIcon('back'), el('span', null, GM.q ? 'wyniki wyszukiwania' : GM_BOX[folder?.special] ?? folder?.name ?? 'poczta'));
  back.addEventListener('click', () => { titleEl.textContent = 'Gmail'; const b = el('div', 'page gm'); out.replaceChildren(b); gmMailbox(b, { keep: true }); });
  box.append(back, ghLoading('otwieram wiadomość…'));
  out.replaceChildren(box);
  out.parentElement?.scrollTo?.(0, 0);
  let d;
  try { d = (await ghJson(gmApi(`/message/${m.uid}?box=${encodeURIComponent(m.box)}`))).message; } catch (e) { box.replaceChildren(back, ghError(e)); return; }
  titleEl.textContent = d.subject || '(bez tematu)';

  const head = el('div', 'gm-msg');
  const subj = el('h2', 'gm-title', d.subject || '(bez tematu)');
  head.append(subj);
  if (d.labels.length) { const t = el('div', 'gh-topics'); for (const l of d.labels) t.append(chip(l, 'gm-label')); head.append(t); }
  const who = el('div', 'gm-who');
  const from = d.from[0];
  const meta = el('div', 'gm-wmeta');
  const name = el('b', null, gmWho(from));
  meta.append(name);
  if (from?.name) meta.append(el('small', 'gm-addr', from.email));
  const to = [...d.to, ...d.cc].map(gmWho).join(', ');
  if (to) meta.append(el('small', null, `do: ${to}`));
  who.append(gmFace(from, 40), meta, el('small', 'gm-date', d.date ? new Date(d.date).toLocaleString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''));
  head.append(who);
  if (d.url) {
    const open = el('a', 'gh-open gm-open');
    Object.assign(open, { href: d.url, target: '_blank', rel: 'noopener noreferrer' });
    open.append(gmailLogo(14), el('span', null, 'Otwórz w Gmailu'));
    head.append(open);
  }

  const files = d.attachments.filter((a) => !a.inline);
  const fileRow = el('div', 'gm-files');
  for (const a of files) {
    const f = el('a', 'gm-file');
    Object.assign(f, { href: gmApi(`/message/${d.uid}/part/${encodeURIComponent(a.id)}?box=${encodeURIComponent(m.box)}`), download: a.name });
    f.append(svgIcon(a.type.startsWith('image/') ? GM_ICON.img : ICON.file), el('span', null, a.name), el('small', null, kb(a.size)));
    fileRow.append(f);
  }

  const body = el('div', 'gm-body');
  if (d.html) gmHtml(body, d, m.box, false);
  else body.append(gmText(d.text ?? ''));
  box.replaceChildren(back, head, ...(files.length ? [fileRow] : []), body);
}

function gmText(text) {
  const p = el('div', 'gm-text');
  const re = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    p.append(document.createTextNode(text.slice(last, m.index)));
    const a = el('a', null, m[0]);
    Object.assign(a, { href: m[0], target: '_blank', rel: 'noopener noreferrer' });
    p.append(a);
    last = re.lastIndex;
  }
  p.append(document.createTextNode(text.slice(last)));
  return p;
}

// HTML mail in a sandbox: no scripts, no forms, links open outside; pictures of the message itself
// load from this server, pictures from the internet (often tracking) only when asked for.
function gmHtml(body, d, box, remote) {
  const parts = Object.fromEntries(d.attachments.filter((a) => a.cid).map((a) => [a.cid, gmApi(`/message/${d.uid}/part/${encodeURIComponent(a.id)}?box=${encodeURIComponent(box)}`)]));
  const html = d.html
    .replace(/<(script|iframe|object|embed|form|noscript)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|iframe|object|embed|meta|link|base|form)\b[^>]*>/gi, '')
    .replace(/\bcid:([^"'\s)>]+)/gi, (all, id) => parts[id] ?? parts[decodeURIComponent(id)] ?? all);
  const remoteRefs = /(src|background)=["']?https?:|url\(\s*["']?https?:/i.test(html);
  const csp = `default-src 'none'; img-src data: ${location.origin}${remote ? ' https: http:' : ''}; style-src 'unsafe-inline'${remote ? ' https:' : ''}; font-src data:${remote ? ' https:' : ''}`;
  const frame = el('iframe', 'gm-frame');
  frame.setAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.title = d.subject || 'wiadomość';
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank">`
    + '<style>html{background:#fff}body{margin:0;padding:18px;font:14px/1.55 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#202124;word-break:break-word}img{max-width:100%;height:auto}a{color:#1a73e8}</style>'
    + `</head><body>${html}</body></html>`;
  // a newsletter wider than the screen is scaled down once; the height follows its pictures as they load
  const height = () => { const doc = frame.contentDocument; if (doc?.body) frame.style.height = `${Math.ceil(doc.documentElement.getBoundingClientRect().height) + 2}px`; };
  frame.addEventListener('load', () => {
    const doc = frame.contentDocument;
    if (!doc?.body) return;
    const sw = doc.documentElement.scrollWidth;
    if (sw > frame.clientWidth + 4) doc.body.style.zoom = String(Math.max(0.4, frame.clientWidth / sw));
    height();
    try { new ResizeObserver(height).observe(doc.body); } catch { /* older browsers: the first height stays */ }
  });
  const nodes = [];
  if (remoteRefs && !remote) {
    const bar = el('div', 'gm-remote');
    const show = el('button', null, 'pokaż obrazki');
    show.type = 'button';
    show.addEventListener('click', () => gmHtml(body, d, box, true));
    bar.append(svgIcon(GM_ICON.img), el('span', null, 'Obrazki z internetu są zablokowane — mogą zdradzić nadawcy, że otwierasz wiadomość.'), show);
    nodes.push(bar);
  }
  body.replaceChildren(...nodes, frame);
}
