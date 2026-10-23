// The server's files and each agent's own files. One viewer for both: code with line numbers,
// Markdown, pictures; secrets only after "show anyway"; agent files can be edited, compared with
// and restored from their earlier versions. Any file or folder — one, or many picked at once
// (hold a row, or "Zaznacz") — can be taken to an agent: a new conversation with it, or one
// already going. Uses the helpers of app.js and github.js (code view, Markdown, toolbar).
const FS_ICON = {
  dir: GH_ICON.dir, file: GH_ICON.file, lock: GH_ICON.lock,
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  special: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12h8"/>',
  ask: '<path d="M4 5h16v11H9l-5 4z"/><path d="M9 10h6"/>',
  edit: ICON.edit,
  down: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.3-5.6L4 8.7"/><path d="M4 4v4.7h4.7M12 8v4l3 2"/>',
  path: '<path d="M4 7h16M4 12h10M4 17h6"/>',
  id: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  spark: '<path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z"/>',
  brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a3 3 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>',
  folder2: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M8 13h8"/>',
};
const AF_GROUPS = {
  identity: ['Tożsamość i instrukcje', 'id', 'kim jest agent i jak ma pracować'],
  config: ['Konfiguracja', 'cog', 'model, uprawnienia, hooki, narzędzia'],
  skills: ['Skille, komendy i subagenci', 'spark', 'czego agent się nauczył'],
  memory: ['Pamięć', 'brain', 'co agent zapamiętał'],
  workspace: ['Folder pracy', 'folder2', 'pliki, które leżą przy agencie'],
  linked: ['Wskazane w instrukcjach', 'link', 'pliki, do których odsyłają instrukcje agenta'],
  projects: ['Projekty', 'dir', 'pliki agenta w projektach, w których pracował'],
  secret: ['Dane logowania', 'lock', 'zablokowane — pokazują się dopiero po potwierdzeniu'],
};
const fsIcon = (n) => svgIcon(FS_ICON[n] ?? n);
const fsRead = (path, reveal) => ghJson(`/api/fs/read?path=${encodeURIComponent(path)}${reveal ? '&reveal' : ''}`);
const fsRaw = (path, { download = false, reveal = false } = {}) => `/api/fs/raw?path=${encodeURIComponent(path)}${download ? '&download' : ''}${reveal ? '&reveal' : ''}`;
const shortPath = (p) => (info?.cwd && p.startsWith(`${info.cwd}/`) ? `~${p.slice(info.cwd.length)}` : p);
const dirnameOf = (p) => p.replace(/\/[^/]*$/, '') || '/';
const baseOf = (p) => p.replace(/\/+$/, '').split('/').pop() || '/';

function backButton(label, fn) {
  const b = el('button', 'gh-back');
  b.type = 'button';
  b.append(ghIcon('back'), el('span', null, label));
  b.addEventListener('click', fn);
  return b;
}

// ---------- taking files to an agent ----------
// items: [{ path, name, dir }] — files go as attachments, folders are named in the message.
function askAgent(items, prefer = null) {
  if (!agents.length) { loadAgents().then(() => askAgent(items, prefer)); return; }
  const ready = agents.filter((a) => a.ready);
  const order = prefer ? [...ready.filter((a) => a.id === prefer), ...ready.filter((a) => a.id !== prefer)] : ready;
  const what = items.length === 1 ? (items[0].dir ? `folder ${items[0].name}` : items[0].name) : `${items.length} ${items.length < 5 ? 'elementy' : 'elementów'}`;
  const start = async (ids) => {
    const res = await jpost('/api/sessions', { agents: ids, title: sessionTitle(items) });
    if (!res.ok) return toast('nie udało się utworzyć rozmowy');
    await loadSessions();
    deliver((await res.json()).session.id, items, ids.length === 1 ? ids[0] : null);
  };
  const rows = order.map((a) => {
    const r = item(logo(a.id), `Nowa rozmowa z ${a.label}`, () => { closeSheet(); start([a.id]); },
      { sub: a.id === prefer ? 'to jego pliki' : 'osobna sesja, tylko ten agent', right: svgIcon(ICON.chevron) });
    r.style.setProperty('--c', color(a.id));
    return r;
  });
  if (ready.length > 1) rows.push(item(ICON.tasks, 'Nowa rozmowa ze wszystkimi', () => { closeSheet(); start(ready.map((a) => a.id)); }, { sub: 'każdy agent zobaczy te same pliki', right: svgIcon(ICON.chevron) }));
  const recent = sessions.slice(0, 8).map((s) => {
    const marks = el('span', 'd-marks');
    for (const a of (s.agents ?? []).slice(0, 3)) marks.append(logo(a));
    return item(marks, s.title, () => { closeSheet(); deliver(s.id, items, prefer && s.agents?.includes(prefer) ? prefer : null); }, { sub: `${(s.agents ?? []).map(nameOf).join(', ')} · ${ago(s.updatedAt)}` });
  });
  openSheet('Zapytaj agenta', [el('p', 's-note', `${what} — agent dostanie ${items.some((i) => !i.dir) ? 'pliki jako załączniki' : 'ścieżki'} i zacznie od Twojej wiadomości.`),
    group(...rows), ...(recent.length ? [el('div', 's-label', 'albo w trwającej rozmowie'), group(...recent)] : [])]);
}

function sessionTitle(items) {
  if (items.length === 1) return `${items[0].dir ? 'Folder' : 'Plik'}: ${items[0].name}`;
  const names = items.slice(0, 2).map((i) => i.name).join(', ');
  return `Pliki: ${names}${items.length > 2 ? ` (+${items.length - 2})` : ''}`;
}

async function deliver(sessionId, items, agent) {
  const attached = [];
  let refused = 0;
  for (const i of items.filter((x) => !x.dir)) {
    const r = await jpost(`/api/sessions/${sessionId}/attach`, { path: i.path, from: 'you' });
    if (r.ok) attached.push((await r.json()).file); else refused++;
  }
  const folders = items.filter((x) => x.dir);
  await openSession(sessionId);
  chat.files = attached;
  if (agent && chat.s.agents[agent]) chat.active = [agent];
  renderAttachments();
  renderComposer();
  const lines = [];
  if (attached.length === 1) lines.push(`Spójrz na plik ${attached[0].name} — porozmawiajmy o nim.`);
  else if (attached.length > 1) lines.push(`Spójrz na te pliki (${attached.length}) — porozmawiajmy o nich.`);
  if (folders.length) lines.push(`${attached.length ? 'I na' : 'Spójrz na'} ${folders.length === 1 ? 'folder' : 'te foldery'} na serwerze:`, ...folders.map((f) => `- ${f.path}`));
  cInput.value = lines.join('\n');
  autosize();
  updateSend();
  cInput.focus();
  if (refused) toast(`pominięto ${refused} — sekretów nie wysyłam do rozmowy`);
}

// ---------- picking many ----------
const PICK = { on: false, items: new Map(), prefer: null, redraw: null };
function pickStart(entry, prefer, redraw) {
  PICK.on = true;
  PICK.prefer = prefer;
  PICK.redraw = redraw;
  PICK.items.clear();
  if (entry) PICK.items.set(entry.path, entry);
  navigator.vibrate?.(12);
  redraw();
}
function pickEnd() { PICK.on = false; PICK.items.clear(); PICK.redraw?.(); }
function pickToggle(entry) {
  if (PICK.items.has(entry.path)) PICK.items.delete(entry.path); else PICK.items.set(entry.path, entry);
  PICK.redraw();
}
function pickBar() {
  if (!PICK.on) return null;
  const bar = el('div', 'pick-bar');
  const n = PICK.items.size;
  bar.append(el('b', null, n ? `zaznaczone: ${n}` : 'zaznacz pliki'));
  const cancel = el('button', 'tb text', 'Anuluj');
  cancel.type = 'button';
  cancel.addEventListener('click', pickEnd);
  const go = el('button', 'tb text primary');
  go.type = 'button';
  go.disabled = !n;
  go.append(fsIcon('ask'), el('span', null, 'Zapytaj agenta'));
  go.addEventListener('click', () => { const items = [...PICK.items.values()]; askAgent(items, PICK.prefer); });
  bar.append(el('span', 'sp'), cancel, go);
  return bar;
}

// One row of a list: hold it (or right-click) to start picking, ⋯ for what can be done with it.
// entry: { path, name, dir, secret }, opts: { icon, title, sub, right, open, menu }
function pickRow(entry, opts) {
  const r = el('div', `pick-row${PICK.items.has(entry.path) ? ' picked' : ''}${entry.secret ? ' secret' : ''}`);
  const main = el('button', 'pick-main');
  main.type = 'button';
  const ic = el('span', 'pick-ic');
  ic.append(PICK.on ? fsIcon(PICK.items.has(entry.path) ? 'check' : 'special') : fsIcon(opts.icon));
  if (PICK.on) ic.classList.add('box');
  const t = el('span', 'pick-txt');
  t.append(el('b', null, opts.title));
  if (opts.sub) t.append(el('small', null, opts.sub));
  main.append(ic, t);
  if (opts.right) main.append(opts.right);
  let timer = null;
  let held = false;
  let x0 = 0;
  let y0 = 0;
  main.addEventListener('pointerdown', (e) => {
    held = false;
    x0 = e.clientX;
    y0 = e.clientY;
    timer = setTimeout(() => { held = true; if (!entry.secret || entry.dir) PICK.on ? pickToggle(entry) : pickStart(entry, opts.prefer, opts.redraw); }, 480);
  });
  const stop = () => clearTimeout(timer);
  main.addEventListener('pointermove', (e) => { if (Math.abs(e.clientX - x0) > 8 || Math.abs(e.clientY - y0) > 8) stop(); });
  main.addEventListener('pointerup', stop);
  main.addEventListener('pointercancel', stop);
  main.addEventListener('contextmenu', (e) => { e.preventDefault(); stop(); if (!held) { held = true; PICK.on ? pickToggle(entry) : pickStart(entry, opts.prefer, opts.redraw); } });
  main.addEventListener('click', () => {
    if (held) { held = false; return; }
    if (PICK.on) { if (!entry.secret || entry.dir) pickToggle(entry); else toast('sekretów nie wysyłam do rozmowy'); return; }
    opts.open();
  });
  const more = el('button', 'pick-more');
  more.type = 'button';
  more.setAttribute('aria-label', 'Więcej');
  more.append(fsIcon('more'));
  more.addEventListener('click', () => opts.menu());
  r.append(main, more);
  return r;
}

// What can be done with one file or folder.
function entryMenu(entry, { prefer, open, editable, agent, redraw }) {
  const rows = [
    item(FS_ICON.ask, 'Zapytaj agenta', () => { closeSheet(); askAgent([entry], prefer); }, { sub: entry.secret && !entry.dir ? 'sekretów nie wysyłam do rozmowy' : 'nowa rozmowa albo trwająca' }),
    item(FS_ICON.check, 'Zaznacz', () => { closeSheet(); pickStart(entry.secret && !entry.dir ? null : entry, prefer, redraw); }, { sub: 'wybierz więcej plików i folderów naraz' }),
    item(entry.dir ? FS_ICON.dir : FS_ICON.file, entry.dir ? 'Otwórz folder' : 'Otwórz', () => { closeSheet(); open(); }),
  ];
  if (editable && agent) rows.push(item(FS_ICON.history, 'Historia zmian', () => { closeSheet(); historyView(entry.path, agent, () => agentFilesPage(agent)); }, { sub: 'porównaj z poprzednimi wersjami i przywróć' }));
  if (!entry.dir) rows.push(item(FS_ICON.dir, 'Pokaż w folderze', () => { closeSheet(); fsPage(dirnameOf(entry.path)); }, { sub: 'w plikach serwera' }));
  rows.push(item(FS_ICON.path, 'Kopiuj ścieżkę', () => { closeSheet(); clip(entry.path, 'ścieżka skopiowana'); }, { sub: shortPath(entry.path) }));
  openSheet(entry.name, [group(...rows)]);
}

// ---------- one file ----------
// `ctx`: { back: [label, fn], agent: id when it is an agent's file, editable }
async function fileView(path, ctx = {}, reveal = false) {
  const box = el('div', 'page fsv');
  const back = backButton(...ctx.back);
  box.append(back, ghLoading('otwieram plik…'));
  out.replaceChildren(box);
  let f;
  try { f = await fsRead(path, reveal); } catch (e) { box.replaceChildren(back, ghError(e)); return; }
  titleEl.textContent = f.name;
  subEl.textContent = shortPath(dirnameOf(f.path));
  const entry = { path: f.path, name: f.name, dir: false, secret: f.kind === 'secret' };
  const head = fileHead(f.kind === 'secret' ? GH_ICON.lock : GH_ICON.file, f.name,
    [f.target ? `→ ${shortPath(f.target)}` : shortPath(f.path), kb(f.size), f.mtime ? ago(f.mtime) : ''].filter(Boolean).join(' · '));
  const isMd = /\.(md|markdown|mdx)$/i.test(f.name);
  const raw = Boolean(fileView.raw);
  const segments = f.kind === 'text' && isMd ? [['podgląd', false], ['kod', true]].map(([label, r]) => ({ label, on: raw === r, onClick: () => { fileView.raw = r; fileView(path, ctx, reveal); } })) : null;
  const canSend = !['secret', 'special', 'dir'].includes(f.kind);
  const bar = toolBar(segments, [
    ctx.editable && f.kind === 'text' && { icon: FS_ICON.edit, label: 'Edytuj', text: 'Edytuj', primary: true, onClick: () => fileEdit(f, ctx) },
    canSend && { icon: FS_ICON.ask, label: 'Zapytaj agenta', onClick: () => askAgent([entry], ctx.agent) },
    f.kind === 'text' && { icon: ICON.copy, label: 'Kopiuj treść', onClick: () => clip(f.text) },
    ['text', 'image', 'binary', 'large'].includes(f.kind) && f.size <= 50 * 1024 * 1024 && { icon: FS_ICON.down, label: 'Pobierz', href: fsRaw(f.path, { download: true, reveal }), download: f.name },
    { icon: FS_ICON.more, label: 'Więcej', onClick: () => entryMenu(entry, { prefer: ctx.agent, open: () => fileView(path, ctx, reveal), editable: ctx.editable, agent: ctx.agent, redraw: () => {} }) },
  ]);
  const view = el('div', 'gh-fview fs-view');
  if (f.kind === 'text') view.append(!f.text ? el('p', 's-note fs-empty', 'Plik jest pusty.') : isMd && !raw ? localMarkdown(f.text) : ghCode(f.text));
  else if (f.kind === 'image') { const img = el('img', 'gh-img'); img.src = fsRaw(f.path); img.alt = f.name; view.append(img); }
  else if (f.kind === 'secret') {
    const w = el('div', 'fs-secret');
    const go = el('button', 'tb text primary');
    go.type = 'button';
    go.append(el('span', null, 'pokaż mimo to'));
    go.addEventListener('click', () => fileView(path, ctx, true));
    w.append(fsIcon('lock'), el('b', null, 'Ten plik wygląda na sekret'), el('p', null, 'Klucze, hasła albo tokeny. Pokażę go tylko na Twoje wyraźne życzenie — upewnij się, że nikt nie patrzy na ekran.'), go);
    view.append(w);
  } else {
    view.append(el('p', 's-note fs-empty', {
      binary: 'Plik binarny — możesz go pobrać.', large: 'Plik jest za duży na podgląd (ponad 2 MB) — możesz go pobrać.',
      special: 'To nie jest zwykły plik (urządzenie, kolejka albo gniazdo) — SpectraHub go nie otwiera.', dir: 'To jest folder.',
    }[f.kind] ?? 'Nie da się tego pokazać.'));
  }
  box.replaceChildren(back, head, bar, view);
}

function localMarkdown(text) {
  const root = el('div', 'md');
  mdBlocks(text.replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, ''), root, {
    img: (src) => (/^https:\/\//i.test(src) ? src : null),
    link: (href, a) => { if (/^(https?:|mailto:)/i.test(href)) Object.assign(a, { href, target: '_blank', rel: 'noopener noreferrer' }); },
  });
  return root;
}

async function saveFile(agent, path, text, base) {
  const res = await api(`/api/agents/${encodeURIComponent(agent)}/file`, { method: 'PUT', body: JSON.stringify({ path, text, base }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) { toast(d.error ?? 'nie zapisano'); return false; }
  return true;
}

// Editing an agent's file: the whole text, saved in place; the old version goes to the backups.
function fileEdit(f, ctx) {
  const box = el('div', 'page fsv');
  const back = backButton('anuluj', () => fileView(f.path, ctx));
  const head = fileHead(FS_ICON.edit, f.name, f.target ? `zapis do ${shortPath(f.target)}` : shortPath(f.path));
  const area = el('textarea', 'fs-edit');
  area.value = f.text;
  area.spellcheck = false;
  const bar = toolBar(null, [
    { icon: FS_ICON.history, label: 'Historia zmian', onClick: () => historyView(f.path, ctx.agent, () => fileView(f.path, ctx)) },
    { icon: '<path d="M6 6l12 12M18 6 6 18"/>', label: 'Anuluj', text: 'Anuluj', onClick: () => fileView(f.path, ctx) },
    { icon: FS_ICON.check, label: 'Zapisz', text: 'Zapisz', primary: true, onClick: async () => {
      if (area.value === f.text) return fileView(f.path, ctx);
      if (await saveFile(ctx.agent, f.path, area.value, f.hash)) { toast('zapisano — poprzednia wersja jest w historii zmian'); fileView(f.path, ctx); }
    } },
  ]);
  box.append(back, head, bar, area, el('p', 's-note', 'Zmiana działa od następnej rozmowy z agentem. Poprzednia wersja trafia do historii zmian; jeśli ktoś zmienił plik w międzyczasie, zapis zostanie wstrzymany.'));
  out.replaceChildren(box);
  area.focus();
}

// ---------- history: earlier versions, compared with the current one, restorable ----------
async function historyView(path, agent, back) {
  const box = el('div', 'page fsv');
  const b = backButton('wróć', back);
  box.append(b, ghLoading('szukam poprzednich wersji…'));
  out.replaceChildren(box);
  titleEl.textContent = baseOf(path);
  subEl.textContent = 'historia zmian';
  let versions;
  let current;
  try {
    [versions, current] = await Promise.all([ghJson(`/api/agents/${encodeURIComponent(agent)}/history?path=${encodeURIComponent(path)}`).then((d) => d.versions), fsRead(path)]);
  } catch (e) { box.replaceChildren(b, ghError(e)); return; }
  const head = fileHead(FS_ICON.history, baseOf(path), shortPath(current.target ?? path));
  if (!versions.length) { box.replaceChildren(b, head, el('p', 's-note fs-empty', 'Nie ma jeszcze poprzednich wersji. Pojawią się po pierwszym zapisie w SpectraHub.')); return; }
  const list = el('div', 'gh-files');
  for (const v of versions) {
    const r = ghRow('history', new Date(v.at).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), `${kb(v.size)} · ${ago(v.at)}`, () => versionView(path, agent, v, current, () => historyView(path, agent, back)));
    r.querySelector('svg').replaceWith(fsIcon('history'));
    list.append(r);
  }
  box.replaceChildren(b, head, el('p', 's-note', 'Wersje sprzed zapisów w SpectraHub, od najnowszej. Dotknij, żeby zobaczyć różnice i przywrócić.'), list);
}

async function versionView(path, agent, v, current, back) {
  const box = el('div', 'page fsv');
  const b = backButton('historia', back);
  box.append(b, ghLoading());
  out.replaceChildren(box);
  let old;
  try { old = await fsRead(v.path); } catch (e) { box.replaceChildren(b, ghError(e)); return; }
  const head = fileHead(FS_ICON.history, `${baseOf(path)} · ${new Date(v.at).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`, 'czerwone — było w tej wersji, zielone — jest teraz');
  const view = el('div', 'gh-fview fs-view');
  view.append(lineDiff(old.text ?? '', current.text ?? ''));
  const bar = toolBar(null, [
    { icon: ICON.copy, label: 'Kopiuj tę wersję', onClick: () => clip(old.text ?? '') },
    { icon: FS_ICON.history, label: 'Przywróć tę wersję', text: 'Przywróć', primary: true, onClick: () => confirmSheet('Przywrócić tę wersję?',
      'Obecna treść trafi do historii, więc i ten krok da się cofnąć.', 'przywróć', async () => {
        if (await saveFile(agent, path, old.text ?? '', current.hash)) { toast('przywrócono'); fileView(path, { back: ['pliki agenta', () => agentFilesPage(agent)], agent, editable: true }); }
      }) },
  ]);
  box.replaceChildren(b, head, bar, view);
}

// A line diff (longest common subsequence) shown with a little context, like a review.
function lineDiff(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  if (x.length * y.length > 4_000_000) return el('p', 's-note fs-empty', 'Pliki są za duże, żeby je porównać tutaj.');
  const n = x.length;
  const m = y.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) { ops.push([' ', x[i]]); i++; j++; }
    else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) { ops.push(['-', x[i]]); i++; }  // what was, then what is
    else { ops.push(['+', y[j]]); j++; }
  }
  if (!ops.some((o) => o[0] !== ' ')) return el('p', 's-note fs-empty', 'Ta wersja jest taka sama jak obecna.');
  const pre = el('pre', 'gh-code fs-diff');
  const near = (k) => ops.slice(Math.max(0, k - 2), k + 3).some((o) => o[0] !== ' ');
  let gap = false;
  ops.forEach((o, k) => {
    if (o[0] === ' ' && !near(k)) { if (!gap) { pre.append(el('span', 'ln gap', '⋯')); gap = true; } return; }
    gap = false;
    const s = el('span', `ln ${o[0] === '+' ? 'add' : o[0] === '-' ? 'del' : ''}`);
    s.textContent = `${o[0]} ${o[1]}`;
    pre.append(s);
  });
  return pre;
}

// ---------- an agent's files ----------
async function agentFilesPage(id) {
  pageName = 'agents';
  setView('page');
  const a = agents.find((x) => x.id === id);
  titleEl.textContent = a?.label ?? id;
  subEl.textContent = 'pliki agenta';
  const box = el('div', 'page fsv');
  const back = backButton('agenci', () => { pickEnd(); home('agents'); });
  box.append(back, ghLoading('szukam plików agenta…'));
  out.replaceChildren(box);
  renderDrawer();
  let d;
  try { d = await ghJson(`/api/agents/${encodeURIComponent(id)}/files`); } catch (e) { box.replaceChildren(back, ghError(e)); return; }
  subEl.textContent = plural(d.files.length, 'plik', 'pliki', 'plików');
  PICK.on = false;
  PICK.items.clear();
  const draw = () => {
    const head = el('div', 'gh-head af-head');
    const top = el('div', 'gh-top');
    const lg = logo(id);
    lg.classList.add('af-logo');
    top.append(lg, el('b', 'af-name', d.agent.label));
    if (d.agent.name) top.append(chip(`@${d.agent.name}`));
    head.append(top, el('small', 'af-meta', [d.agent.version, d.agent.home ? `pracuje w ${shortPath(d.agent.home)}` : ''].filter(Boolean).join(' · ')));
    head.style.setProperty('--c', color(id));
    const tools = toolBar(null, [
      !PICK.on && { icon: FS_ICON.check, label: 'Zaznacz pliki', text: 'Zaznacz', onClick: () => pickStart(null, id, draw) },
      { icon: FS_ICON.ask, label: `Nowa rozmowa z ${nameOf(id)}`, text: 'Rozmowa', onClick: async () => {
        const res = await jpost('/api/sessions', { agents: [id] });
        if (res.ok) { await loadSessions(); openSession((await res.json()).session.id); }
      } },
    ]);
    tools.classList.add('af-tools');
    const nodes = [back, head, tools];
    const ctx = { back: [a?.label ?? id, () => agentFilesPage(id)], agent: id };
    for (const g of Object.keys(AF_GROUPS)) {
      const list = d.files.filter((f) => f.group === g);
      if (!list.length) continue;
      const [title, icon, hint] = AF_GROUPS[g];
      const lab = el('div', 'af-label');
      lab.append(fsIcon(icon), el('b', null, title), el('small', null, hint));
      nodes.push(lab);
      const byProject = g === 'projects' ? [...new Set(list.map((f) => f.project))] : [null];
      for (const p of byProject) {
        if (p) nodes.push(el('div', 'af-project', shortPath(p)));
        const grp = el('div', 'pick-list');
        for (const f of list.filter((x) => !p || x.project === p)) {
          const entry = { path: f.path, name: f.name, dir: false, secret: f.secret };
          const right = el('span', 'af-right');
          if (f.target) right.append(fsIcon('link'));
          right.append(el('small', null, kb(f.size)));
          const open = () => { pickEnd(); fileView(f.path, { ...ctx, editable: f.editable }); };
          grp.append(pickRow(entry, { icon: f.secret ? 'lock' : 'file', title: f.name, sub: `${f.label} · ${shortPath(f.target ?? f.path)}`, right, open, prefer: id, redraw: draw,
            menu: () => entryMenu(entry, { prefer: id, open, editable: f.editable, agent: id, redraw: draw }) }));
        }
        nodes.push(grp);
      }
    }
    if (!d.files.length) nodes.push(el('p', 's-note', 'Nie znalazłem plików tego agenta.'));
    nodes.push(el('p', 's-note', 'Przytrzymaj plik albo dotknij „Zaznacz”, żeby wybrać kilka i zapytać o nie agenta. Edycja zapisuje w miejscu, a poprzednia wersja trafia do historii zmian. Dane logowania można tylko obejrzeć — po potwierdzeniu.'));
    const bar = pickBar();
    if (bar) nodes.push(bar);
    box.replaceChildren(...nodes);
  };
  draw();
}

// ---------- the server's files ----------
const FS = { path: null, filter: '' };
async function fsPage(path = FS.path ?? '/') {
  pageName = 'servers';
  setView('page');
  titleEl.textContent = 'Pliki serwera';
  const box = el('div', 'page fsv');
  const back = backButton('serwery', () => { pickEnd(); home('vps'); });
  box.append(back, ghLoading('czytam folder…'));
  out.replaceChildren(box);
  renderDrawer();
  let d;
  try { d = await ghJson(`/api/fs/list?path=${encodeURIComponent(path)}`); } catch (e) { box.replaceChildren(back, fsQuick(), ghError(e)); return; }
  if (d.path !== FS.path) { FS.filter = ''; if (!PICK.on) PICK.items.clear(); }
  FS.path = d.path;
  subEl.textContent = d.path;

  const crumbs = el('div', 'gh-crumbs fs-crumbs');
  const parts = d.path.split('/').filter(Boolean);
  const rootB = el('button', null, '/');
  rootB.type = 'button';
  rootB.addEventListener('click', () => fsPage('/'));
  crumbs.append(rootB);
  parts.forEach((p, i) => {
    if (i) crumbs.append(el('span', null, '/'));
    const b = el('button', null, p);
    b.type = 'button';
    b.addEventListener('click', () => fsPage(`/${parts.slice(0, i + 1).join('/')}`));
    crumbs.append(b);
  });

  const search = el('label', 'gh-search fs-search');
  const inp = el('input');
  Object.assign(inp, { type: 'search', placeholder: 'filtruj w tym folderze', value: FS.filter, autocomplete: 'off' });
  search.append(svgIcon('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'), inp);
  const listEl = el('div', 'pick-list fs-list');
  const barSlot = el('div');
  const ctx = { back: ['folder', () => fsPage(FS.path)] };
  const draw = () => {
    const rows = [];
    if (d.parent && !FS.filter && !PICK.on) rows.push(ghRow('dir', '..', '', () => fsPage(d.parent)));
    for (const e of d.entries.filter((x) => !FS.filter || x.name.toLowerCase().includes(FS.filter.toLowerCase()))) {
      const isDir = e.type === 'dir' || e.to === 'dir';
      const entry = { path: e.path, name: e.name, dir: isDir, secret: Boolean(e.secret) };
      const icon = e.secret ? 'lock' : isDir ? 'dir' : e.type === 'special' ? 'special' : 'file';
      const open = () => (isDir ? fsPage(e.path) : e.type === 'special' || e.to === 'broken' ? toast('tego nie da się otworzyć') : fileView(e.path, ctx));
      const right = el('small', 'fs-meta', [e.size != null && !isDir ? kb(e.size) : '', e.mtime ? ago(e.mtime) : ''].filter(Boolean).join(' · '));
      const sub = [e.type === 'link' ? `→ ${e.target ?? 'nie istnieje'}` : '', wide.matches ? `${e.mode ?? ''} ${e.owner ?? ''}`.trim() : ''].filter(Boolean).join(' · ');
      rows.push(pickRow(entry, { icon, title: e.name, sub, right, open, redraw: draw, menu: () => entryMenu(entry, { open, redraw: draw }) }));
    }
    listEl.replaceChildren(...rows);
    if (!d.entries.length) listEl.append(el('p', 's-note fs-empty', 'Folder jest pusty.'));
    barSlot.replaceChildren(...[pickBar()].filter(Boolean));
    tools.replaceWith(tools = fsTools());
  };
  const fsTools = () => {
    const t = toolBar(null, [!PICK.on && { icon: FS_ICON.check, label: 'Zaznacz pliki i foldery', text: 'Zaznacz', onClick: () => pickStart(null, null, draw) },
      { icon: FS_ICON.ask, label: 'Zapytaj agenta o ten folder', text: 'Zapytaj o folder', onClick: () => askAgent([{ path: d.path, name: baseOf(d.path), dir: true }]) }]);
    t.classList.add('af-tools');
    return t;
  };
  let tools = fsTools();
  inp.addEventListener('input', () => { FS.filter = inp.value.trim(); draw(); });
  const meta = el('p', 'gm-count', `${plural(d.total, 'element', 'elementy', 'elementów')}${d.truncated ? ' · pokazano pierwsze 3000' : ''} · tylko podgląd · przytrzymaj, żeby zaznaczyć`);
  box.replaceChildren(back, fsQuick(d.path), crumbs, tools, search, meta, listEl, barSlot);
  draw();
}

function fsQuick(current) {
  const q = el('div', 'fs-places');
  const home = info?.cwd ?? '/root';
  for (const [label, p] of [['/', '/'], ['~', home], ['etc', '/etc'], ['srv', '/srv'], ['opt', '/opt'], ['var/log', '/var/log'], ['tmp', '/tmp']]) {
    const b = el('button', current === p ? 'on' : '', label);
    b.type = 'button';
    b.addEventListener('click', () => { pickEnd(); fsPage(p); });
    q.append(b);
  }
  return q;
}
