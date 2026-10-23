// The server's files and each agent's own files. One viewer for both: code with line numbers,
// Markdown, pictures; secrets only after "show anyway"; agent files can be edited (the old
// version is kept) and any file can be handed to a conversation. Uses the helpers of app.js
// and github.js (code view, Markdown, chips).
const FS_ICON = {
  dir: GH_ICON.dir, file: GH_ICON.file, lock: GH_ICON.lock,
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  special: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12h8"/>',
  send: '<path d="M4 12 20 4l-6 16-3-7z"/><path d="m11 13 9-9"/>',
  edit: ICON.edit,
  down: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  home: '<path d="M4 11 12 4l8 7v9H4z"/>',
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
  projects: ['Projekty', 'dir', 'pliki agenta w projektach, w których pracował'],
  secret: ['Dane logowania', 'lock', 'zablokowane — pokazują się dopiero po potwierdzeniu'],
};
const fsIcon = (n) => svgIcon(FS_ICON[n] ?? n);
const fsRead = (path, reveal) => ghJson(`/api/fs/read?path=${encodeURIComponent(path)}${reveal ? '&reveal' : ''}`);
const fsRaw = (path, { download = false, reveal = false } = {}) => `/api/fs/raw?path=${encodeURIComponent(path)}${download ? '&download' : ''}${reveal ? '&reveal' : ''}`;
const shortPath = (p) => (info?.cwd && p.startsWith(`${info.cwd}/`) ? `~${p.slice(info.cwd.length)}` : p);

function backButton(label, fn) {
  const b = el('button', 'gh-back');
  b.type = 'button';
  b.append(ghIcon('back'), el('span', null, label));
  b.addEventListener('click', fn);
  return b;
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

  const head = el('div', 'gh-fhead fs-head');
  head.append(fsIcon(f.kind === 'secret' ? 'lock' : 'file'));
  const t = el('div', 'fs-title');
  t.append(el('b', null, f.name), el('small', null, [f.target ? `→ ${shortPath(f.target)}` : shortPath(f.path), kb(f.size), f.mode, f.mtime ? ago(f.mtime) : ''].filter(Boolean).join(' · ')));
  head.append(t);

  const acts = el('div', 'fs-acts');
  const act = (icon, label, fn, cls = '') => { const b = el('button', `fs-act ${cls}`.trim()); b.type = 'button'; b.append(fsIcon(icon), el('span', null, label)); b.addEventListener('click', fn); acts.append(b); return b; };
  if (ctx.editable && f.kind === 'text') act('edit', 'Edytuj', () => fileEdit(f, ctx), 'primary');
  if (f.kind !== 'secret' && f.kind !== 'special' && f.kind !== 'dir') act('send', 'Wyślij do rozmowy', () => sendToChat(f.path, f.name, ctx.agent));
  if (f.kind === 'text') act(ICON.copy, 'Kopiuj', () => clip(f.text));
  if (['text', 'image', 'binary', 'large'].includes(f.kind) && f.size <= 50 * 1024 * 1024) {
    const a = el('a', 'fs-act');
    Object.assign(a, { href: fsRaw(f.path, { download: true, reveal }), download: f.name });
    a.append(fsIcon('down'), el('span', null, 'Pobierz'));
    acts.append(a);
  }

  const view = el('div', 'gh-fview fs-view');
  const isMd = /\.(md|markdown|mdx)$/i.test(f.name);
  const nodes = [back, head, acts];
  if (f.kind === 'text' && isMd) {
    const sw = el('div', 'effort');
    const show = (raw) => {
      for (const b of sw.children) b.classList.toggle('on', (b.dataset.raw === '1') === raw);
      view.replaceChildren(raw ? ghCode(f.text) : localMarkdown(f.text));
      fileView.raw = raw;
    };
    for (const [label, raw] of [['podgląd', false], ['kod', true]]) {
      const b = el('button', 'eff', label);
      b.type = 'button';
      b.dataset.raw = raw ? '1' : '0';
      b.addEventListener('click', () => show(raw));
      sw.append(b);
    }
    nodes.push(sw);
    show(Boolean(fileView.raw));
  } else if (f.kind === 'text') {
    view.append(f.text ? ghCode(f.text) : el('p', 's-note fs-empty', 'Plik jest pusty.'));
  } else if (f.kind === 'image') {
    const img = el('img', 'gh-img');
    img.src = fsRaw(f.path);
    img.alt = f.name;
    view.append(img);
  } else if (f.kind === 'secret') {
    const w = el('div', 'fs-secret');
    const go = el('button', 's-primary', 'pokaż mimo to');
    go.type = 'button';
    go.addEventListener('click', () => fileView(path, ctx, true));
    w.append(fsIcon('lock'), el('b', null, 'Ten plik wygląda na sekret'), el('p', null, 'Klucze, hasła albo tokeny. Pokażę go tylko na Twoje wyraźne życzenie — upewnij się, że nikt nie patrzy na ekran.'), go);
    view.append(w);
  } else {
    view.append(el('p', 's-note fs-empty', {
      binary: 'Plik binarny — możesz go pobrać.', large: 'Plik jest za duży na podgląd (ponad 2 MB) — możesz go pobrać.',
      special: 'To nie jest zwykły plik (urządzenie, kolejka albo gniazdo) — SpectraHub go nie otwiera.', dir: 'To jest folder.',
    }[f.kind] ?? 'Nie da się tego pokazać.'));
  }
  nodes.push(view);
  box.replaceChildren(...nodes);
}
const dirnameOf = (p) => p.replace(/\/[^/]*$/, '') || '/';

function localMarkdown(text) {
  const root = el('div', 'md');
  mdBlocks(text.replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, ''), root, {
    img: (src) => (/^https:\/\//i.test(src) ? src : null),
    link: (href, a) => { if (/^(https?:|mailto:)/i.test(href)) Object.assign(a, { href, target: '_blank', rel: 'noopener noreferrer' }); },
  });
  return root;
}

// Editing an agent's file: the whole text, saved in place; the old version goes to the backups.
function fileEdit(f, ctx) {
  const box = el('div', 'page fsv');
  const back = backButton('anuluj', () => fileView(f.path, ctx));
  const head = el('div', 'gh-fhead fs-head');
  head.append(fsIcon('edit'));
  const t = el('div', 'fs-title');
  t.append(el('b', null, f.name), el('small', null, f.target ? `zapis do ${shortPath(f.target)}` : shortPath(f.path)));
  head.append(t);
  const area = el('textarea', 'fs-edit');
  area.value = f.text;
  area.spellcheck = false;
  const save = el('button', 's-primary', 'Zapisz');
  save.type = 'button';
  const cancel = el('button', 's-primary ghost', 'Anuluj');
  cancel.type = 'button';
  cancel.addEventListener('click', () => fileView(f.path, ctx));
  save.addEventListener('click', async () => {
    if (area.value === f.text) return fileView(f.path, ctx);
    save.disabled = true;
    save.textContent = 'zapisuję…';
    const res = await api(`/api/agents/${encodeURIComponent(ctx.agent)}/file`, { method: 'PUT', body: JSON.stringify({ path: f.path, text: area.value, base: f.hash }) });
    const d = await res.json().catch(() => ({}));
    save.disabled = false;
    save.textContent = 'Zapisz';
    if (!res.ok) return toast(d.error ?? 'nie zapisano');
    toast('zapisano — poprzednia wersja jest w kopii zapasowej');
    fileView(f.path, ctx);
  });
  const row = el('div', 'fs-save');
  row.append(cancel, save);
  box.append(back, head, area, row, el('p', 's-note', 'Zmiana działa od następnej rozmowy z agentem. Poprzednia wersja trafia do ~/.spectrahub/backups, a jeśli ktoś zmienił plik w międzyczasie, zapis zostanie wstrzymany.'));
  out.replaceChildren(box);
  area.focus();
}

// Handing a file to a conversation: a new one with the agent, or one of the recent ones.
function sendToChat(path, name, agent) {
  const pick = async (sessionId) => {
    closeSheet();
    const r = await jpost(`/api/sessions/${sessionId}/attach`, { path, from: 'you' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return toast(d.error === 'refused: looks like a secret' ? 'sekretów nie wysyłam do rozmowy' : (d.error ?? 'nie udało się'));
    await openSession(sessionId);
    chat.files = [d.file];
    if (agent && chat.s.agents[agent]) chat.active = [agent];
    renderAttachments();
    renderComposer();
    cInput.value = `Spójrz na plik ${name} — porozmawiajmy o nim.`;
    autosize();
    updateSend();
    cInput.focus();
  };
  const rows = [];
  if (agent) {
    const r = item(logo(agent), `Nowa rozmowa z ${nameOf(agent)}`, async () => {
      const res = await jpost('/api/sessions', { agents: [agent], title: `Plik: ${name}` });
      if (!res.ok) return toast('nie udało się utworzyć rozmowy');
      await loadSessions();
      pick((await res.json()).session.id);
    }, { sub: 'agent dostanie plik w pierwszej wiadomości', right: svgIcon(ICON.chevron) });
    r.style.setProperty('--c', color(agent));
    rows.push(r);
  }
  const recent = [...sessions].sort((a, b) => Number(Boolean(agent && b.agents?.includes?.(agent))) - Number(Boolean(agent && a.agents?.includes?.(agent)))).slice(0, 8);
  const list = recent.map((s) => {
    const marks = el('span', 'd-marks');
    for (const a of (s.agents ?? []).slice(0, 3)) marks.append(logo(a));
    return item(marks, s.title, () => pick(s.id), { sub: `${(s.agents ?? []).map(nameOf).join(', ')} · ${ago(s.updatedAt)}` });
  });
  openSheet('Wyślij do rozmowy', [el('p', 's-note', `${name} trafi do rozmowy jako załącznik — agent dostanie jego ścieżkę i może go przeczytać.`),
    ...(rows.length ? [group(...rows)] : []), ...(list.length ? [el('div', 's-label', 'ostatnie rozmowy'), group(...list)] : [])]);
}

// ---------- an agent's files ----------
async function agentFilesPage(id) {
  pageName = 'agents';
  setView('page');
  const a = agents.find((x) => x.id === id);
  titleEl.textContent = a?.label ?? id;
  subEl.textContent = 'pliki agenta';
  const box = el('div', 'page fsv');
  const back = backButton('agenci', () => home('agents'));
  box.append(back, ghLoading('szukam plików agenta…'));
  out.replaceChildren(box);
  renderDrawer();
  let d;
  try { d = await ghJson(`/api/agents/${encodeURIComponent(id)}/files`); } catch (e) { box.replaceChildren(back, ghError(e)); return; }
  subEl.textContent = plural(d.files.length, 'plik', 'pliki', 'plików');
  const head = el('div', 'gh-head af-head');
  const top = el('div', 'gh-top');
  const lg = logo(id);
  lg.classList.add('af-logo');
  top.append(lg, el('b', 'af-name', d.agent.label));
  if (d.agent.name) top.append(chip(`@${d.agent.name}`));
  head.append(top, el('small', 'af-meta', [d.agent.version, d.agent.home ? `pracuje w ${shortPath(d.agent.home)}` : ''].filter(Boolean).join(' · ')));
  head.style.setProperty('--c', color(id));
  const chatBtn = el('button', 's-primary ghost af-chat');
  chatBtn.type = 'button';
  chatBtn.textContent = `Nowa rozmowa z ${nameOf(id)}`;
  chatBtn.addEventListener('click', async () => {
    const res = await jpost('/api/sessions', { agents: [id] });
    if (res.ok) { await loadSessions(); openSession((await res.json()).session.id); }
  });
  const nodes = [back, head];
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
      nodes.push(group(...list.filter((f) => !p || f.project === p).map((f) => {
        const right = el('span', 'af-right');
        if (f.target) right.append(fsIcon('link'));
        right.append(el('small', null, kb(f.size)));
        return item(fsIcon(f.secret ? 'lock' : 'file'), f.name, () => fileView(f.path, { ...ctx, editable: f.editable }),
          { sub: `${f.label} · ${shortPath(f.target ?? f.path)}`, right });
      })));
    }
  }
  if (d.files.length === 0) nodes.push(el('p', 's-note', 'Nie znalazłem plików tego agenta.'));
  nodes.push(chatBtn, el('p', 's-note', 'Pliki leżą tam, gdzie trzyma je sam agent. Edycja zapisuje w miejscu, a poprzednia wersja trafia do ~/.spectrahub/backups. Dane logowania można tylko obejrzeć — po potwierdzeniu.'));
  box.replaceChildren(...nodes);
}

// ---------- the server's files ----------
const FS = { path: null, filter: '' };
async function fsPage(path = FS.path ?? '/') {
  pageName = 'servers';
  setView('page');
  titleEl.textContent = 'Pliki serwera';
  const box = el('div', 'page fsv');
  const back = backButton('serwery', () => home('vps'));
  box.append(back, ghLoading('czytam folder…'));
  out.replaceChildren(box);
  renderDrawer();
  let d;
  try { d = await ghJson(`/api/fs/list?path=${encodeURIComponent(path)}`); } catch (e) { box.replaceChildren(back, ghError(e), fsQuick()); return; }
  if (d.path !== FS.path) FS.filter = '';
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

  const search = el('label', 'gh-search');
  const inp = el('input');
  Object.assign(inp, { type: 'search', placeholder: 'filtruj w tym folderze', value: FS.filter, autocomplete: 'off' });
  search.append(svgIcon('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'), inp);
  const listEl = el('div', 'gh-files fs-list');
  const ctx = { back: ['folder', () => fsPage(FS.path)] };
  const draw = () => {
    const rows = [];
    if (d.parent && !FS.filter) rows.push(ghRow('dir', '..', '', () => fsPage(d.parent)));
    for (const e of d.entries.filter((x) => !FS.filter || x.name.toLowerCase().includes(FS.filter.toLowerCase()))) {
      const isDir = e.type === 'dir' || e.to === 'dir';
      const icon = e.secret ? 'lock' : isDir ? 'dir' : e.type === 'special' ? 'special' : 'file';
      const b = el('button', `gh-row fs-row ${isDir ? 'dir' : ''} ${e.secret ? 'secret' : ''}`);
      b.type = 'button';
      const nm = el('span', 'fs-name');
      nm.append(el('span', 'gh-fname', e.name));
      if (e.type === 'link') nm.append(el('small', 'fs-to', `→ ${e.target ?? 'nie istnieje'}`));
      b.append(fsIcon(icon), nm, el('small', 'fs-meta', [e.size != null && !isDir ? kb(e.size) : '', e.mtime ? ago(e.mtime) : ''].filter(Boolean).join(' · ')),
        el('small', 'fs-mode', `${e.mode ?? ''} ${e.owner ?? ''}`.trim()));
      b.addEventListener('click', () => (isDir ? fsPage(e.path) : e.type === 'special' || e.to === 'broken' ? toast('tego nie da się otworzyć') : fileView(e.path, ctx)));
      rows.push(b);
    }
    listEl.replaceChildren(...rows);
    if (!d.entries.length) listEl.append(el('p', 's-note fs-empty', 'Folder jest pusty.'));
  };
  inp.addEventListener('input', () => { FS.filter = inp.value.trim(); draw(); });
  draw();
  const meta = el('p', 'gm-count', `${plural(d.total, 'element', 'elementy', 'elementów')}${d.truncated ? ' · pokazano pierwsze 3000' : ''} · tylko podgląd`);
  box.replaceChildren(back, fsQuick(d.path), crumbs, search, meta, listEl);
}

function fsQuick(current) {
  const q = el('div', 'gh-accs fs-quick');
  const home = info?.cwd ?? '/root';
  for (const [label, p] of [['/', '/'], ['~', home], ['/etc', '/etc'], ['/srv', '/srv'], ['/opt', '/opt'], ['/var/log', '/var/log'], ['/tmp', '/tmp']]) {
    const b = el('button', `gh-acc${current === p ? ' on' : ''}`);
    b.type = 'button';
    b.append(el('span', null, label));
    b.addEventListener('click', () => fsPage(p));
    q.append(b);
  }
  return q;
}
