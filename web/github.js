// GitHub, read only: the accounts the owner connected with tokens of their own, every repository
// those tokens see, and inside each one the code, README, commits, pull requests and issues.
// Uses the helpers of app.js (el, api, openSheet, item, group, …). Nothing is written to GitHub.
const GH = { accounts: [], repos: [], errors: [], acc: 'all', q: '', loaded: false };
const GH_ICON = {
  mark: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="9" r="2"/><path d="M6 7v10M18 11c0 4-6 3-12 6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  dir: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  fork: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path d="M6 7v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7M12 12v5"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10M18 9c0 5-6 4-12 8"/>',
  commit: '<circle cx="12" cy="12" r="3.5"/><path d="M3 12h5.5M15.5 12H21"/>',
  pr: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6 7v10M18 17V9a3 3 0 0 0-3-3h-4M13 3.5 10.5 6 13 8.5"/>',
  issue: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="1.5"/>',
  out: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
};
const LANG = { JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', HTML: '#e34c26', CSS: '#663399', Shell: '#89e051', Go: '#00ADD8',
  Rust: '#dea584', Java: '#b07219', Kotlin: '#A97BFF', Swift: '#F05138', PHP: '#4F5D95', Ruby: '#701516', 'C#': '#178600', 'C++': '#f34b7d', C: '#555555',
  Vue: '#41b883', Svelte: '#ff3e00', Dart: '#00B4AB', Lua: '#000080', Dockerfile: '#384d54', 'Jupyter Notebook': '#DA5B0B', SCSS: '#c6538c', MDX: '#fcb32c' };

const ghIcon = (d) => svgIcon(GH_ICON[d] ?? d);
const ghPath = (acc, owner, name, sub = '') => `/api/github/${encodeURIComponent(acc)}/repo/${encodeURIComponent(owner)}/${encodeURIComponent(name)}${sub ? `/${sub}` : ''}`;
const plural = (n, one, few, many) => `${n} ${n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many}`;
// A face for an account or author; without a picture, its first letter.
function avatar(url, size = 20, name = '') {
  const i = url ? el('img', 'gh-ava') : el('span', 'gh-ava letter', (name.replace(/[^\p{L}\p{N}]/gu, '')[0] ?? '·').toUpperCase());
  if (url) { i.src = `${url}${url.includes('?') ? '&' : '?'}s=${size * 2}`; i.alt = ''; i.loading = 'lazy'; }
  i.style.width = i.style.height = `${size}px`;
  i.style.fontSize = `${Math.round(size * 0.5)}px`;
  return i;
}
function chip(label, cls = '') { return el('span', `gh-chip ${cls}`.trim(), label); }
async function ghJson(path) {
  const res = await api(path);
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
  return d;
}
function ghLoading(text = 'wczytuję z GitHuba…') { const p = el('div', 'gh-loading'); p.append(el('span', 'st-spin'), el('span', null, text)); return p; }
function ghError(e) { return el('p', 'gh-err', e.message ?? String(e)); }

// ---------- the page: accounts, then every repository they see ----------
async function githubPage() {
  setView('page');
  titleEl.textContent = 'GitHub';
  subEl.textContent = 'tylko podgląd';
  const box = el('div', 'page gh');
  box.append(ghLoading());
  out.replaceChildren(box);
  renderDrawer();
  try { GH.accounts = (await ghJson('/api/github')).accounts; } catch (e) { box.replaceChildren(ghError(e)); return; }
  if (!GH.accounts.length) return ghEmpty(box);
  if (!GH.loaded) await ghLoadRepos();
  ghList(box);
}

function ghEmpty(box) {
  subEl.textContent = 'nic nie podłączono';
  const hero = el('div', 'gh-hero');
  const ring = el('span', 'gh-ring');
  ring.append(ghIcon('mark'));
  const go = el('button', 's-primary', 'Podłącz konto GitHub');
  go.type = 'button';
  go.addEventListener('click', ghConnectSheet);
  hero.append(ring, el('b', null, 'Twoje repozytoria w jednym miejscu'),
    el('p', null, 'Kod, README, commity, pull requesty i zgłoszenia — także z prywatnych repozytoriów. Tylko podgląd: SpectraHub niczego na GitHubie nie zmienia.'),
    go, el('small', null, 'Możesz podłączyć kilka kont i organizacji, każde swoim tokenem.'));
  box.replaceChildren(hero);
}

async function ghLoadRepos() {
  GH.repos = [];
  GH.errors = [];
  const seen = new Set();
  await Promise.all(GH.accounts.map(async (a) => {
    try {
      for (const r of (await ghJson(`/api/github/${a.id}/repos`)).repos) {
        const key = r.full.toLowerCase();
        if (seen.has(key)) continue;  // the same repository through two tokens shows once
        seen.add(key);
        GH.repos.push({ ...r, acc: a.id });
      }
    } catch (e) { GH.errors.push({ acc: a, error: e.message }); }
  }));
  GH.repos.sort((x, y) => String(y.pushed).localeCompare(String(x.pushed)));
  GH.loaded = true;
}

function ghList(box) {
  const shown = () => GH.repos.filter((r) => (GH.acc === 'all' || r.acc === GH.acc)
    && (!GH.q || `${r.full} ${r.description} ${r.language ?? ''}`.toLowerCase().includes(GH.q.toLowerCase())));
  subEl.textContent = `${plural(GH.accounts.length, 'konto', 'konta', 'kont')} · ${plural(GH.repos.length, 'repozytorium', 'repozytoria', 'repozytoriów')}`;

  const accs = el('div', 'gh-accs');
  const accChip = (id, label, url) => {
    const b = el('button', `gh-acc${GH.acc === id ? ' on' : ''}`);
    b.type = 'button';
    if (url !== undefined) b.append(avatar(url, 18, label));
    b.append(el('span', null, label));
    b.addEventListener('click', () => { GH.acc = id; ghList(box); });
    return b;
  };
  accs.append(accChip('all', 'wszystkie'));
  for (const a of GH.accounts) accs.append(accChip(a.id, a.label ? `${a.login} · ${a.label}` : a.login, a.avatar));
  const add = el('button', 'gh-acc add');
  add.type = 'button';
  add.append(svgIcon(ICON.plus), el('span', null, 'konto'));
  add.addEventListener('click', ghAccountsSheet);
  accs.append(add);

  const search = el('label', 'gh-search');
  const inp = el('input');
  Object.assign(inp, { type: 'search', placeholder: 'szukaj repozytorium, języka, opisu', value: GH.q, autocomplete: 'off' });
  search.append(svgIcon('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'), inp);

  const grid = el('div', 'gh-grid');
  const draw = () => {
    const list = shown();
    grid.replaceChildren(...list.map(ghCard));
    if (!list.length) grid.append(el('p', 's-note', GH.q ? 'Nic nie pasuje do wyszukiwania.' : 'Ten token nie widzi żadnego repozytorium.'));
  };
  inp.addEventListener('input', () => { GH.q = inp.value.trim(); draw(); });
  draw();

  const refresh = el('button', 's-primary ghost', 'odśwież listę');
  refresh.type = 'button';
  refresh.addEventListener('click', async () => { box.replaceChildren(ghLoading()); await ghLoadRepos(); ghList(box); });
  box.replaceChildren(accs, search, ...GH.errors.map((x) => el('p', 'gh-err', `@${x.acc.login}: ${x.error}`)), grid, refresh);
}

function ghCard(r) {
  const c = el('button', 'gh-card');
  c.type = 'button';
  const top = el('div', 'gh-top');
  top.append(avatar(r.avatar, 20, r.owner));
  const nm = el('span', 'gh-name');
  nm.append(el('span', 'gh-owner', `${r.owner}/`), el('b', null, r.name));
  top.append(nm);
  if (r.private) { const l = chip('prywatne', 'lock'); l.prepend(ghIcon('lock')); top.append(l); }
  if (r.archived) top.append(chip('archiwum'));
  c.append(top);
  if (r.description) c.append(el('p', 'gh-desc', r.description));
  const meta = el('div', 'gh-meta');
  if (r.language) { const l = el('span', 'gh-lang', r.language); l.style.setProperty('--c', LANG[r.language] ?? '#8c8c8c'); meta.append(l); }
  if (r.stars) { const s = el('span'); s.append(ghIcon('star'), document.createTextNode(String(r.stars))); meta.append(s); }
  if (r.fork) meta.append(el('span', null, 'fork'));
  meta.append(el('span', null, `zmiany ${ago(r.pushed)}`));
  c.append(meta);
  c.addEventListener('click', () => ghRepo(r.acc, r.owner, r.name));
  return c;
}

// ---------- accounts ----------
function ghAccountsSheet() {
  openSheet('Konta GitHub', () => [
    group(...GH.accounts.map((a) => item(avatar(a.avatar, 26, a.login), a.label ? `${a.login} · ${a.label}` : a.login, () => confirmSheet(`Odłączyć @${a.login}?`,
      'Token zostanie usunięty z serwera. Na GitHubie możesz go też unieważnić w ustawieniach tokenów.', 'odłącz', async () => {
        await api(`/api/github/${a.id}`, { method: 'DELETE' });
        GH.loaded = false;
        githubPage();
      }), { sub: `${a.name ? `${a.name} · ` : ''}${a.kind === 'fine-grained' ? 'token fine-grained' : a.kind === 'classic' ? 'token classic' : 'token'} · od ${new Date(a.addedAt).toLocaleDateString('pl-PL')}`, right: svgIcon(ICON.trash) }))),
    (() => { const b = el('button', 's-primary', 'Podłącz kolejne konto'); b.type = 'button'; b.addEventListener('click', ghConnectSheet); return b; })(),
  ]);
}

function ghConnectSheet() {
  const f = el('form', 's-form gh-form');
  const label = el('input');
  Object.assign(label, { placeholder: 'nazwa, np. prywatne albo firma (opcjonalnie)', maxLength: 40, autocomplete: 'off' });
  const tok = el('input');
  Object.assign(tok, { type: 'password', placeholder: 'github_pat_… albo ghp_…', autocomplete: 'off', maxLength: 300 });
  const ok = el('button', 's-primary', 'połącz');
  ok.type = 'submit';
  f.append(label, tok, ok);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!tok.value.trim()) return tok.focus();
    ok.disabled = true;
    ok.textContent = 'sprawdzam token…';
    const res = await jpost('/api/github', { token: tok.value.trim(), label: label.value.trim() });
    const d = await res.json().catch(() => ({}));
    ok.disabled = false;
    ok.textContent = 'połącz';
    if (!res.ok) return toast(d.error ?? 'nie udało się');
    tok.value = '';
    closeSheet();
    toast(`połączono @${d.account.login}`);
    GH.loaded = false;
    githubPage();
  });
  const make = el('a', 'gh-link', 'Utwórz token na GitHubie');
  Object.assign(make, { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener noreferrer' });
  make.append(ghIcon('out'));
  const steps = el('ol', 'gh-steps');
  for (const s of ['Właściciel (Resource owner): Ty albo organizacja — dla każdej organizacji osobny token.',
    'Dostęp do repozytoriów: wszystkie albo wybrane.',
    'Uprawnienia repozytorium: Contents, Metadata, Pull requests, Issues — każde „Read-only”.']) steps.append(el('li', null, s));
  openSheet('Podłącz GitHub', [f, make, steps,
    el('p', 's-note', 'Token zostaje na tym serwerze (plik z prawami 600) i nigdy nie wraca do przeglądarki. Wystarczy uprawnienie tylko do odczytu — SpectraHub niczego na GitHubie nie zmienia.')], { push: sheetStack.length > 0 });
  setTimeout(() => tok.focus(), 250);
}

// ---------- one repository ----------
const GH_TABS = [['code', 'Kod', 'dir'], ['readme', 'README', 'book'], ['commits', 'Commity', 'commit'], ['pulls', 'PR', 'pr'], ['issues', 'Zgłoszenia', 'issue']];

async function ghRepo(acc, owner, name, opts = {}) {
  const v = { acc, owner, name, tab: opts.tab ?? 'code', path: opts.path ?? '', ref: opts.ref ?? null, file: null, repo: null, counts: {} };
  GH.view = v;
  titleEl.textContent = name;
  subEl.textContent = owner;
  const box = el('div', 'page gh');
  box.append(ghLoading());
  out.replaceChildren(box);
  try { v.repo = (await ghJson(ghPath(acc, owner, name))).repo; } catch (e) { box.replaceChildren(ghBack(), ghError(e)); return; }
  v.ref ??= v.repo.branch;
  subEl.textContent = `${owner} · ${v.repo.private ? 'prywatne' : 'publiczne'}`;
  ghDraw(box, v);
  Promise.all([ghJson(ghPath(acc, owner, name, 'pulls')).then((d) => { v.counts.pulls = d.pulls.length; }).catch(() => {}),
    ghJson(ghPath(acc, owner, name, 'issues')).then((d) => { v.counts.issues = d.issues.length; }).catch(() => {})])
    .then(() => { if (GH.view === v) ghCounts(box, v); });
}

function ghCounts(box, v) {
  for (const b of box.querySelectorAll('.gh-tab')) {
    const n = v.counts[b.dataset.tab];
    if (n == null) continue;
    (b.querySelector('small') ?? b.appendChild(el('small'))).textContent = String(n);
  }
}

function ghBack() {
  const b = el('button', 'gh-back');
  b.type = 'button';
  b.append(ghIcon('back'), el('span', null, 'repozytoria'));
  b.addEventListener('click', () => { GH.view = null; githubPage(); });
  return b;
}

function ghDraw(box, v) {
  const r = v.repo;
  const head = el('div', 'gh-head');
  const t = el('div', 'gh-top');
  t.append(avatar(r.avatar ?? GH.repos.find((x) => x.full === r.full)?.avatar, 24, r.owner));
  const nm = el('span', 'gh-name big');
  nm.append(el('span', 'gh-owner', `${r.owner}/`), el('b', null, r.name));
  t.append(nm);
  if (r.private) { const l = chip('prywatne', 'lock'); l.prepend(ghIcon('lock')); t.append(l); }
  head.append(t);
  if (r.description) head.append(el('p', 'gh-desc full', r.description));
  const meta = el('div', 'gh-meta');
  if (r.language) { const l = el('span', 'gh-lang', r.language); l.style.setProperty('--c', LANG[r.language] ?? '#8c8c8c'); meta.append(l); }
  for (const [icon, n] of [['star', r.stars], ['fork', r.forks]]) { const s = el('span'); s.append(ghIcon(icon), document.createTextNode(String(n))); meta.append(s); }
  if (r.license) meta.append(el('span', null, r.license));
  meta.append(el('span', null, `zmiany ${ago(r.pushed)}`));
  head.append(meta);
  if (r.topics?.length) { const tp = el('div', 'gh-topics'); for (const x of r.topics) tp.append(chip(x, 'topic')); head.append(tp); }

  const tools = el('div', 'gh-tools');
  const br = el('button', 'gh-branch');
  br.type = 'button';
  br.append(ghIcon('branch'), el('b', null, v.ref), svgIcon(ICON.chevron));
  br.addEventListener('click', () => openSheet('Gałąź', [group(...r.branches.map((b) => item(GH_ICON.branch, b, () => {
    closeSheet(); v.ref = b; v.path = ''; v.file = null; ghDraw(box, v);
  }, { sub: b === r.branch ? 'domyślna' : '', right: b === v.ref ? svgIcon(ICON.check) : null })))]));
  const gh = el('a', 'gh-open');
  Object.assign(gh, { href: r.url, target: '_blank', rel: 'noopener noreferrer', title: 'Otwórz na GitHubie' });
  gh.append(ghIcon('out'), el('span', null, 'GitHub'));
  tools.append(br, gh);

  const tabs = el('div', 'gh-tabs');
  for (const [id, label, icon] of GH_TABS) {
    if (id === 'readme' && !r.readme) continue;
    const b = el('button', `gh-tab${v.tab === id ? ' on' : ''}`);
    b.type = 'button';
    b.dataset.tab = id;
    b.append(ghIcon(icon), el('span', null, label));
    if (v.counts[id] != null) b.append(el('small', null, String(v.counts[id])));
    b.addEventListener('click', () => { v.tab = id; v.file = null; ghDraw(box, v); });
    tabs.append(b);
  }
  const body = el('div', 'gh-body');
  box.replaceChildren(ghBack(), head, tools, tabs, body);
  ghTab(body, v, box);
}

async function ghTab(body, v, box) {
  body.append(ghLoading());
  const r = v.repo;
  try {
    if (v.tab === 'readme') {
      body.replaceChildren(ghMarkdown(r.readme.text, v, r.readme.path));
    } else if (v.tab === 'code') {
      if (v.file) return ghFile(body, v, box);
      const d = await ghJson(`${ghPath(v.acc, v.owner, v.name, 'contents')}?path=${encodeURIComponent(v.path)}&ref=${encodeURIComponent(v.ref)}`);
      if (d.file) { v.file = d.file; return ghFile(body, v, box); }
      const list = el('div', 'gh-files');
      if (v.path) list.append(ghRow('dir', '..', '', () => { v.path = v.path.split('/').slice(0, -1).join('/'); ghDraw(box, v); }));
      for (const e of d.dir) {
        list.append(ghRow(e.type === 'dir' ? 'dir' : 'file', e.name, e.type === 'file' ? kb(e.size) : e.type === 'submodule' ? 'moduł' : '', () => {
          if (e.type === 'dir') { v.path = e.path; ghDraw(box, v); } else if (e.type === 'file') { v.path = e.path; v.file = { name: e.name, path: e.path, pending: true }; ghDraw(box, v); }
        }));
      }
      const readme = d.dir.find((e) => /^readme(\.md|\.markdown)?$/i.test(e.name));
      body.replaceChildren(ghCrumbs(v, box), list);
      if (readme && v.path && readme.size < 300_000) {
        const f = await ghJson(`${ghPath(v.acc, v.owner, v.name, 'contents')}?path=${encodeURIComponent(readme.path)}&ref=${encodeURIComponent(v.ref)}`).catch(() => null);
        if (f?.file?.text) body.append(el('div', 's-label', readme.name), ghMarkdown(f.file.text, v, readme.path));
      }
    } else if (v.tab === 'commits') {
      const { commits } = await ghJson(`${ghPath(v.acc, v.owner, v.name, 'commits')}?ref=${encodeURIComponent(v.ref)}`);
      body.replaceChildren(ghList2(commits, (c) => {
        const [first] = c.message.split('\n');
        return ghItem(first, [avatar(c.avatar, 16, c.author), `${c.author} · ${ago(c.date)}`], chip(c.sha.slice(0, 7), 'sha'), c.url);
      }, 'Brak commitów na tej gałęzi.'));
    } else if (v.tab === 'pulls') {
      const { pulls } = await ghJson(ghPath(v.acc, v.owner, v.name, 'pulls'));
      v.counts.pulls = pulls.length;
      body.replaceChildren(ghList2(pulls, (p) => ghItem(`#${p.number} ${p.title}`, [avatar(p.avatar, 16, p.author), `${p.author} · ${p.head} → ${p.base} · ${ago(p.updated)}`],
        [p.draft ? chip('szkic') : null, ...p.labels.map(ghLabel)], p.url), 'Nie ma otwartych pull requestów.'));
    } else if (v.tab === 'issues') {
      const { issues } = await ghJson(ghPath(v.acc, v.owner, v.name, 'issues'));
      v.counts.issues = issues.length;
      body.replaceChildren(ghList2(issues, (i) => ghItem(`#${i.number} ${i.title}`, [avatar(i.avatar, 16, i.author), `${i.author} · ${ago(i.updated)}${i.comments ? ` · ${plural(i.comments, 'komentarz', 'komentarze', 'komentarzy')}` : ''}`],
        i.labels.map(ghLabel), i.url), 'Nie ma otwartych zgłoszeń.'));
    }
  } catch (e) { body.replaceChildren(ghError(e)); }
}

function ghRow(icon, name, right, onClick) {
  const b = el('button', `gh-row ${icon}`);
  b.type = 'button';
  b.append(ghIcon(icon), el('span', 'gh-fname', name), el('small', null, right));
  b.addEventListener('click', onClick);
  return b;
}
function ghCrumbs(v, box) {
  const c = el('div', 'gh-crumbs');
  const parts = v.path ? v.path.split('/') : [];
  const go = (p) => () => { v.path = p; v.file = null; ghDraw(box, v); };
  const root = el('button', null, v.name);
  root.type = 'button';
  root.addEventListener('click', go(''));
  c.append(root);
  parts.forEach((p, i) => {
    c.append(el('span', null, '/'));
    const b = el('button', null, p);
    b.type = 'button';
    b.addEventListener('click', go(parts.slice(0, i + 1).join('/')));
    c.append(b);
  });
  return c;
}
function ghLabel(l) { const c = chip(l.name, 'label'); c.style.setProperty('--c', `#${/^[0-9a-f]{6}$/i.test(l.color) ? l.color : '8c8c8c'}`); return c; }
function ghList2(list, row, empty) {
  if (!list.length) return el('p', 's-note', empty);
  const g = el('div', 'gh-items');
  g.append(...list.map(row));
  return g;
}
function ghItem(title, sub, right, url) {
  const a = el('a', 'gh-item');
  Object.assign(a, { href: url, target: '_blank', rel: 'noopener noreferrer' });
  const t = el('div', 'gh-it');
  t.append(el('b', null, title));
  const s = el('small');
  for (const x of sub) s.append(typeof x === 'string' ? document.createTextNode(x) : x);
  t.append(s);
  a.append(t);
  const rr = el('span', 'gh-ir');
  for (const x of [].concat(right ?? [])) if (x) rr.append(x);
  a.append(rr);
  return a;
}

// A file: code with line numbers, a picture, or rendered Markdown; big and binary files open on GitHub.
async function ghFile(body, v, box) {
  if (v.file.pending) {
    try { v.file = (await ghJson(`${ghPath(v.acc, v.owner, v.name, 'contents')}?path=${encodeURIComponent(v.file.path)}&ref=${encodeURIComponent(v.ref)}`)).file; }
    catch (e) { body.replaceChildren(ghCrumbs(v, box), ghError(e)); return; }
  }
  const f = v.file;
  const head = el('div', 'gh-fhead');
  head.append(ghIcon('file'), el('b', null, f.name));
  const lines = f.text != null ? f.text.split('\n').length : null;
  head.append(el('small', null, [lines != null ? plural(lines, 'linia', 'linie', 'linii') : '', kb(f.size)].filter(Boolean).join(' · ')));
  const acts = el('span', 'gh-facts');
  if (f.text != null) { const cp = el('button', 'ib sm'); cp.type = 'button'; cp.title = 'Kopiuj'; cp.append(svgIcon(ICON.copy)); cp.addEventListener('click', () => clip(f.text)); acts.append(cp); }
  const open = el('a', 'ib sm');
  Object.assign(open, { href: f.url, target: '_blank', rel: 'noopener noreferrer', title: 'Otwórz na GitHubie' });
  open.append(ghIcon('out'));
  acts.append(open);
  head.append(acts);
  const view = el('div', 'gh-fview');
  const isMd = /\.(md|markdown|mdx)$/i.test(f.name);
  if (f.kind === 'image') {
    const img = el('img', 'gh-img');
    img.src = `${ghPath(v.acc, v.owner, v.name, 'raw')}?path=${encodeURIComponent(f.path)}&ref=${encodeURIComponent(v.ref)}`;
    img.alt = f.name;
    view.append(img);
  } else if (f.kind === 'text' && isMd && !v.rawMd) {
    view.append(ghMarkdown(f.text, v, f.path));
  } else if (f.kind === 'text') {
    view.append(ghCode(f.text));
  } else {
    view.append(el('p', 's-note', f.kind === 'binary' ? 'Plik binarny — otwórz go na GitHubie.' : 'Plik jest za duży na podgląd — otwórz go na GitHubie.'));
  }
  if (f.kind === 'text' && isMd) {
    const sw = el('div', 'effort');
    for (const [label, raw] of [['podgląd', false], ['kod', true]]) {
      const b = el('button', `eff${Boolean(v.rawMd) === raw ? ' on' : ''}`, label);
      b.type = 'button';
      b.addEventListener('click', () => { v.rawMd = raw; ghFile(body, v, box); });
      sw.append(b);
    }
    body.replaceChildren(ghCrumbs(v, box), head, sw, view);
  } else body.replaceChildren(ghCrumbs(v, box), head, view);
}

function ghCode(text) {
  const pre = el('pre', 'gh-code');
  const all = text.replace(/\n$/, '').split('\n');
  const max = 4000;
  const frag = document.createDocumentFragment();
  for (const line of all.slice(0, max)) { const s = el('span', 'ln'); s.textContent = line || ' '; frag.append(s); }
  pre.append(frag);
  pre.style.setProperty('--w', `${String(Math.min(all.length, max)).length + 1}ch`);
  if (all.length > max) { const box = el('div'); box.append(pre, el('p', 's-note', `Pokazano ${max} z ${all.length} linii — całość na GitHubie.`)); return box; }
  return pre;
}

// ---------- Markdown, built as elements: nothing from a repository is ever run as HTML ----------
function ghMarkdown(text, v, path = '') {
  const folder = path.split('/').slice(0, -1).join('/');
  const resolve = (p) => {
    const parts = (p.startsWith('/') ? p.slice(1) : (folder ? `${folder}/${p}` : p)).split('/');
    const outp = [];
    for (const x of parts) { if (x === '..') outp.pop(); else if (x && x !== '.') outp.push(x); }
    return outp.join('/');
  };
  const ctx = {
    img(src) {
      if (/^https:\/\//i.test(src)) return src;
      if (/^[a-z]+:/i.test(src) || src.startsWith('//')) return null;
      return `${ghPath(v.acc, v.owner, v.name, 'raw')}?path=${encodeURIComponent(resolve(src.split(/[?#]/)[0]))}&ref=${encodeURIComponent(v.ref)}`;
    },
    link(href, a) {
      if (/^(https?:|mailto:)/i.test(href)) { Object.assign(a, { href, target: '_blank', rel: 'noopener noreferrer' }); return; }
      if (href.startsWith('#') || /^[a-z]+:/i.test(href)) return;  // anchors and other schemes stay plain text
      a.href = '#';
      a.addEventListener('click', (e) => { e.preventDefault(); ghRepo(v.acc, v.owner, v.name, { tab: 'code', path: resolve(href.split('#')[0]), ref: v.ref }); });
    },
  };
  const root = el('div', 'md');
  mdBlocks(text.replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, ''), root, ctx);
  return root;
}

function mdBlocks(text, root, ctx) {
  const lines = text.split('\n');
  let i = 0;
  let para = [];
  const flush = () => { if (para.length) { const p = el('p'); mdInline(para.join(' '), p, ctx); root.append(p); para = []; } };
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if ((m = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/.exec(line))) {
      flush();
      const fence = m[1];
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) code.push(lines[i++]);
      i++;
      const pre = el('pre', 'md-pre');
      const c = el('code');
      c.textContent = code.join('\n');
      pre.append(c);
      if (m[2]) pre.dataset.lang = m[2];
      root.append(pre);
      continue;
    }
    if ((m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
      flush();
      const h = el(`h${Math.min(6, m[1].length + 1)}`);
      mdInline(m[2], h, ctx);
      root.append(h);
      i++;
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); root.append(el('hr')); i++; continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      const bq = el('blockquote');
      mdBlocks(q.join('\n'), bq, ctx);
      root.append(bq);
      continue;
    }
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      flush();
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim());
      const wrap = el('div', 'md-table');
      const t = el('table');
      const hr = el('tr');
      for (const c of cells(line)) { const th = el('th'); mdInline(c, th, ctx); hr.append(th); }
      t.append(hr);
      i += 2;
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) {
        const tr = el('tr');
        for (const c of cells(lines[i++])) { const td = el('td'); mdInline(c, td, ctx); tr.append(td); }
        t.append(tr);
      }
      wrap.append(t);
      root.append(wrap);
      continue;
    }
    if ((m = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(line))) {
      flush();
      const ordered = /\d/.test(m[2]);
      const list = el(ordered ? 'ol' : 'ul');
      const indent = m[1].length;
      while (i < lines.length) {
        const lm = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(lines[i]);
        if (!lm) {
          if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && list.lastChild) { list.lastChild.append(' '); mdInline(lines[i].trim(), list.lastChild, ctx); i++; continue; }
          break;
        }
        const li = el('li');
        if (lm[1].length > indent) li.classList.add('sub');
        let body = lm[3];
        const task = /^\[([ xX])\]\s+(.*)$/.exec(body);
        if (task) { li.classList.add('task'); li.append(el('span', `md-box${task[1] !== ' ' ? ' on' : ''}`)); body = task[2]; }
        mdInline(body, li, ctx);
        list.append(li);
        i++;
      }
      root.append(list);
      continue;
    }
    if (/^\s*<\/?[a-zA-Z][^>]*>\s*$/.test(line) || /^\s*<(p|div|h\d|picture|a|img|br|details|summary|table|center)[\s>]/i.test(line)) {
      flush();  // HTML in a README: keep its pictures and words, drop the tags
      const html = [];
      while (i < lines.length && lines[i].trim()) html.push(lines[i++]);
      const box = el('div', 'md-html');
      mdInline(html.join(' '), box, ctx);
      if (box.childNodes.length) root.append(box);
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    para.push(line.trim());
    i++;
  }
  flush();
}

const MD_INLINE = new RegExp([
  '(?<tick>`+)(?<code>[\\s\\S]*?)\\k<tick>',
  '!\\[(?<alt>[^\\]]*)\\]\\(\\s*<?(?<src>[^)\\s>]+)>?(?:\\s+"[^"]*")?\\s*\\)',
  '\\[(?<ltext>(?:[^\\[\\]]|\\[[^\\]]*\\])+)\\]\\(\\s*<?(?<href>[^)\\s>]+)>?(?:\\s+"[^"]*")?\\s*\\)',
  '<img\\b[^>]*?\\bsrc=["\'](?<isrc>[^"\']+)["\'][^>]*>',
  '<a\\b[^>]*?\\bhref=["\'](?<ahref>[^"\']+)["\'][^>]*>(?<atext>[\\s\\S]*?)<\\/a>',
  '(?<br><br\\s*\\/?>)',
  '<\\/?[a-zA-Z][^>]*>',
  '(?<b2>\\*\\*|__)(?<bold>[\\s\\S]+?)\\k<b2>',
  '\\*(?![\\s*])(?<em1>[^*]+?)\\*',
  '(?<![\\w])_(?![\\s_])(?<em2>[^_]+?)_(?![\\w])',
  '~~(?<del>[\\s\\S]+?)~~',
  '(?<url>https?:\\/\\/[^\\s<)\\]]+)',
].join('|'), 'g');

function mdInline(text, into, ctx) {
  const re = new RegExp(MD_INLINE.source, 'g');  // its own position: this runs nested
  let last = 0;
  let m;
  const textNode = (s) => { if (s) into.append(document.createTextNode(s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'))); };
  const image = (src, alt) => { const u = ctx.img(src); if (u) { const img = el('img'); img.src = u; img.alt = alt; img.loading = 'lazy'; into.append(img); } };
  const link = (inner, href) => { const a = el('a'); mdInline(inner, a, ctx); ctx.link(href, a); into.append(a); };
  while ((m = re.exec(text))) {
    if (!m[0]) { re.lastIndex++; continue; }
    textNode(text.slice(last, m.index));
    last = re.lastIndex;
    const g = m.groups;
    if (g.tick) { const c = el('code'); c.textContent = g.code; into.append(c); }
    else if (g.src != null) image(g.src, g.alt);
    else if (g.href != null) link(g.ltext, g.href);
    else if (g.isrc != null) image(g.isrc, '');
    else if (g.ahref != null) link(g.atext, g.ahref);
    else if (g.br) into.append(el('br'));
    else if (g.bold != null) { const b = el('strong'); mdInline(g.bold, b, ctx); into.append(b); }
    else if (g.em1 != null || g.em2 != null) { const em = el('em'); mdInline(g.em1 ?? g.em2, em, ctx); into.append(em); }
    else if (g.del != null) { const d = el('del'); mdInline(g.del, d, ctx); into.append(d); }
    else if (g.url) { const u = g.url.replace(/[.,;:!?]+$/, ''); const a = el('a', null, u); ctx.link(u, a); into.append(a); textNode(g.url.slice(u.length)); }
    // any other tag is dropped; the words around it stay
  }
  textNode(text.slice(last));
}
