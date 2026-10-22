// SpectraHub app: a full-screen chat with agents, a drawer with projects and sessions, sheets for
// models, usage and session options, a file viewer, and the read-only shell. No dependencies.
const $ = (id) => document.getElementById(id);
const app = $('app');
const out = $('out');
const screen = $('screen');
const cmd = $('cmd');
const input = $('input');
const typed = $('typed');
const promptEl = $('prompt');
const titleEl = $('title');
const subEl = $('subtitle');
const busyEl = $('busy');
const composer = $('composer');
const cInput = $('cInput');
const sendBtn = $('sendBtn');
const modelBtn = $('modelBtn');
const attEl = $('att');
const dList = $('dList');
const wide = matchMedia('(min-width: 900px)');

const COLORS = { claude: '#d97757', codex: '#e8e8e8', openclaw: '#e0512f', dsh: '#4d6bfe' };
const NAMES = { claude: 'Claude', codex: 'Codex', openclaw: 'OpenClaw', dsh: 'DeepSeek' };
const LOGOS = {
  "claude": "<svg viewBox=\"0 0 24 24\"><path d=\"m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z\"/></svg>",
  "codex": "<svg viewBox=\"0 0 24 24\"><path d=\"M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z\"/></svg>",
  "openclaw": "<svg viewBox=\"0 0 120 120\"><path d=\"M60 10C30 10 15 35 15 55c0 20 15 40 30 45v10h10v-10s5 2 10 0v10h10v-10c15-5 30-25 30-45 0-20-15-45-45-45Z\" fill=\"#e8453c\"/><path d=\"M20 45C5 40 0 50 5 60c5 10 15 5 20-5 3-7 0-10-5-10Z\" fill=\"#e8453c\"/><path d=\"M100 45c15-5 20 5 15 15-5 10-15 5-20-5-3-7 0-10 5-10Z\" fill=\"#e8453c\"/><path d=\"M45 15Q35 5 30 8M75 15q10-10 15-7\" stroke=\"#ff4d4d\" stroke-width=\"3\" stroke-linecap=\"round\" fill=\"none\"/><circle cx=\"45\" cy=\"35\" r=\"6\" fill=\"#050810\"/><circle cx=\"75\" cy=\"35\" r=\"6\" fill=\"#050810\"/><circle cx=\"46\" cy=\"34\" r=\"2.5\" fill=\"#00e5cc\"/><circle cx=\"76\" cy=\"34\" r=\"2.5\" fill=\"#00e5cc\"/></svg>",
  "dsh": "<svg viewBox=\"0 0 24 24\"><path d=\"M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .113.074.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45\"/></svg>"
};

// ---------- small helpers ----------
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const svgIcon = (d) => {
  const t = document.createElement('template');
  t.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  return t.content.firstElementChild;
};
const ICON = {
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  play: '<path d="M7 5v14l11-7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  share: '<path d="M12 15V3M7 8l5-5 5 5M5 13v7h14v-7"/>',
  file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  pin: '<path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  move: '<path d="M3 6h6l2 2h10v11H3z"/><path d="M10 14h6M13 11l3 3-3 3"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  tasks: '<path d="M4 6h16M4 12h10M4 18h7"/><circle cx="19" cy="17" r="3"/>',
  id: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h4M7 14h7"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  clear: '<path d="M4 20h16M7 16 17 6M14 6h3v3"/>',
};
function logo(id) {
  const t = document.createElement('template');
  t.innerHTML = LOGOS[id] ?? '';
  const svg = t.content.firstElementChild;
  if (svg) { svg.classList.add('mark'); svg.setAttribute('aria-hidden', 'true'); }
  return svg ?? document.createTextNode('');
}
const color = (id) => COLORS[id] ?? '#e8e8e8';
const nameOf = (id) => NAMES[id] ?? id;
const nearBottom = () => screen.scrollHeight - screen.scrollTop - screen.clientHeight < 80;
function stick(fn) { const f = nearBottom(); fn(); if (f) screen.scrollTop = screen.scrollHeight; }
const toBottom = () => { screen.scrollTop = screen.scrollHeight; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'teraz';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} godz`;
  return new Date(iso).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
}
const kb = (n) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} kB` : `${(n / 1048576).toFixed(1)} MB`);
const tok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n ?? 0));
function toast(text) {
  const t = el('div', 'toast', text);
  document.body.append(t);
  setTimeout(() => t.classList.add('out'), 1600);
  setTimeout(() => t.remove(), 2000);
}
async function clip(text, msg = 'skopiowano') {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch { toast('nie udało się skopiować'); }
}
async function shareText(title, text) {
  if (navigator.share) { try { await navigator.share({ title, text }); return; } catch { return; } }
  clip(text, 'skopiowano — wklej, gdzie chcesz');
}

// ---------- storage, auth ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* memory only */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* nothing stored */ } },
};
const KEY = 'spectrahub.token';
const LAST = 'spectrahub.session';
const OPEN = 'spectrahub.folders';
const pairCode = new URLSearchParams(location.hash.slice(1)).get('pair');
if (pairCode) history.replaceState(null, '', location.pathname + location.search);
let token = store.get(KEY);
let info = null;
let agents = [];
let catalog = {};
let sessions = [];
let projects = [];
let view = 'none';   // 'chat' | 'shell' | 'page' | 'none'

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  if (opts.body && typeof opts.body === 'string') headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401 && token) signedOut('sesja wygasła');
  return res;
}
const jpost = (path, body, method = 'POST') => api(path, { method, body: JSON.stringify(body ?? {}) });

async function readSSE(res, fn) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let cut;
    while ((cut = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const data = /^data: (.*)$/m.exec(frame)?.[1];
      if (data) fn(/^event: (.*)$/m.exec(frame)?.[1] ?? 'message', JSON.parse(data));
    }
  }
}

// ---------- drawer ----------
function openDrawer(open) {
  if (wide.matches) app.classList.toggle('collapsed', !open);
  else app.classList.toggle('drawer-open', open);
}
$('menuBtn').addEventListener('click', () => openDrawer(wide.matches ? app.classList.contains('collapsed') : !app.classList.contains('drawer-open')));
$('dClose').addEventListener('click', () => openDrawer(false));
$('scrim').addEventListener('click', () => { openDrawer(false); closeViewer(); });
const closeDrawerOnPhone = () => { if (!wide.matches) openDrawer(false); };

const openFolders = new Set(JSON.parse(store.get(OPEN) ?? '[]'));
function sessionRow(s) {
  const row = el('div', 'd-item');
  row.classList.toggle('on', view === 'chat' && chat.s?.id === s.id);
  const b = el('button', 'd-open');
  b.type = 'button';
  const marks = el('span', 'd-marks');
  for (const a of s.agents) marks.append(logo(a));
  b.append(marks, el('span', 'd-name', s.title));
  if (s.busy) b.append(el('span', 'dot-busy'));
  b.addEventListener('click', () => { closeDrawerOnPhone(); openSession(s.id); });
  const more = el('button', 'ib sm');
  more.type = 'button';
  more.setAttribute('aria-label', 'Opcje sesji');
  more.append(svgIcon(ICON.more));
  more.addEventListener('click', (e) => { e.stopPropagation(); sessionMenu(s); });
  row.append(b, more);
  return row;
}
function renderDrawer() {
  const q = $('dSearch').value.trim().toLowerCase();
  const hit = (s) => !q || s.title.toLowerCase().includes(q);
  const nodes = [];
  if (!info) { dList.replaceChildren(el('p', 'd-note', 'Zaloguj to urządzenie, aby zobaczyć sesje.')); return; }
  const pinned = sessions.filter((s) => s.pinned && hit(s));
  if (pinned.length) { nodes.push(el('div', 'd-sec', 'Przypięte')); pinned.forEach((s) => nodes.push(sessionRow(s))); }
  const head = el('div', 'd-sec');
  const add = el('button', 'd-sec-btn');
  add.type = 'button';
  add.append(svgIcon(ICON.plus), 'projekt');
  add.addEventListener('click', () => askText('Nowy projekt', '', 'utwórz', async (name) => { await jpost('/api/projects', { name }); await loadAll(); }));
  head.append('Projekty', add);
  nodes.push(head);
  if (!projects.length) nodes.push(el('p', 'd-note', 'Projekty grupują sesje jak foldery.'));
  for (const p of projects) {
    const inside = sessions.filter((s) => s.projectId === p.id && hit(s));
    const open = openFolders.has(p.id) || Boolean(q);
    const f = el('div', `d-folder${open ? ' open' : ''}`);
    const fb = el('button', 'd-open');
    fb.type = 'button';
    fb.append(svgIcon(ICON.folder), el('span', 'd-name', p.name), el('span', 'd-count', String(inside.length)));
    fb.addEventListener('click', () => {
      openFolders.has(p.id) ? openFolders.delete(p.id) : openFolders.add(p.id);
      store.set(OPEN, JSON.stringify([...openFolders]));
      renderDrawer();
    });
    const more = el('button', 'ib sm');
    more.type = 'button';
    more.setAttribute('aria-label', 'Opcje projektu');
    more.append(svgIcon(ICON.more));
    more.addEventListener('click', () => projectMenu(p));
    f.append(fb, more);
    nodes.push(f);
    if (open) {
      const box = el('div', 'd-in');
      if (!inside.length) box.append(el('p', 'd-note', 'pusto — przenieś tu sesję z jej menu'));
      inside.forEach((s) => box.append(sessionRow(s)));
      nodes.push(box);
    }
  }
  const loose = sessions.filter((s) => !s.projectId && !s.pinned && hit(s));
  nodes.push(el('div', 'd-sec', 'Ostatnie'));
  if (!loose.length) nodes.push(el('p', 'd-note', q ? 'brak wyników' : 'Nowa sesja: wybierasz agentów i piszecie razem.'));
  loose.forEach((s) => nodes.push(sessionRow(s)));
  dList.replaceChildren(...nodes);
  for (const b of document.querySelectorAll('#dNav button')) b.classList.toggle('on', view !== 'chat' && b.dataset.page === pageName);
}
$('dSearch').addEventListener('input', renderDrawer);
$('newBtn').addEventListener('click', () => { closeDrawerOnPhone(); openStart(); });
for (const b of document.querySelectorAll('#dNav button')) b.addEventListener('click', () => { closeDrawerOnPhone(); openPage(b.dataset.page); });
$('setBtn').addEventListener('click', () => { closeDrawerOnPhone(); openPage('settings'); });
$('meBtn').addEventListener('click', () => { closeDrawerOnPhone(); openPage('settings'); });

// ---------- sheets (bottom sheets on phones, panels on desktop) ----------
const sheetWrap = $('sheetWrap');
const sheetStack = [];
function openSheet(title, nodes, { push = false } = {}) {
  if (!push) sheetStack.length = 0;
  sheetStack.push({ title, nodes });
  drawSheet();
  sheetWrap.hidden = false;
  requestAnimationFrame(() => sheetWrap.classList.add('on'));
}
function drawSheet() {
  const top = sheetStack.at(-1);
  $('sTitle').textContent = top.title;
  $('sBack').hidden = sheetStack.length < 2;
  $('sBody').replaceChildren(...(typeof top.nodes === 'function' ? top.nodes() : top.nodes));
}
function closeSheet() {
  sheetWrap.classList.remove('on');
  setTimeout(() => { if (!sheetWrap.classList.contains('on')) sheetWrap.hidden = true; }, 220);
  sheetStack.length = 0;
}
$('sClose').addEventListener('click', closeSheet);
$('sBack').addEventListener('click', () => { sheetStack.pop(); drawSheet(); });
sheetWrap.addEventListener('click', (e) => { if (e.target === sheetWrap) closeSheet(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!sheetWrap.hidden) closeSheet();
  else if (!$('viewer').hidden) closeViewer();
  else if (app.classList.contains('drawer-open')) openDrawer(false);
});

function item(icon, label, onClick, { danger = false, sub = '', right = null } = {}) {
  const b = el('button', `s-item${danger ? ' danger' : ''}`);
  b.type = 'button';
  b.append(typeof icon === 'string' ? svgIcon(icon) : icon);
  const t = el('span', 's-txt');
  t.append(el('b', null, label));
  if (sub) t.append(el('small', null, sub));
  b.append(t);
  if (right) b.append(right);
  b.addEventListener('click', onClick);
  return b;
}
function group(...items) { const g = el('div', 's-group'); g.append(...items.filter(Boolean)); return g; }

function askText(title, value, action, done) {
  const f = el('form', 's-form');
  const inp = el('input');
  inp.value = value;
  inp.maxLength = 80;
  inp.autocomplete = 'off';
  const ok = el('button', 's-primary', action);
  ok.type = 'submit';
  f.append(inp, ok);
  f.addEventListener('submit', async (e) => { e.preventDefault(); if (!inp.value.trim()) return; closeSheet(); await done(inp.value.trim()); });
  openSheet(title, [f]);
  setTimeout(() => inp.focus(), 250);
}
function confirmSheet(title, text, action, done) {
  const ok = el('button', 's-primary danger', action);
  ok.type = 'button';
  ok.addEventListener('click', async () => { closeSheet(); await done(); });
  openSheet(title, [el('p', 's-note', text), ok]);
}

// ---------- session and project actions ----------
async function patchSession(id, patch) {
  const res = await jpost(`/api/sessions/${id}`, patch, 'PATCH');
  if (!res.ok) { toast('nie udało się'); return; }
  await loadSessions();
  if (chat.s?.id === id) { Object.assign(chat.s, (await res.json()).session ?? {}); renderHeader(); }
}
function moveSheet(s) {
  const pick = (pid) => async () => { closeSheet(); await patchSession(s.id, { projectId: pid }); toast(pid ? 'przeniesiono' : 'bez projektu'); };
  const rows = projects.map((p) => item(ICON.folder, p.name, pick(p.id), { right: s.projectId === p.id ? svgIcon(ICON.check) : null }));
  openSheet('Przenieś do projektu', [
    group(...rows, item(ICON.clear, 'bez projektu', pick(null), { right: !s.projectId ? svgIcon(ICON.check) : null })),
    group(item(ICON.plus, 'Nowy projekt…', () => askText('Nowy projekt', '', 'utwórz i przenieś', async (name) => {
      const r = await (await jpost('/api/projects', { name })).json();
      await patchSession(s.id, { projectId: r.project.id });
      await loadAll();
    }))),
  ], { push: sheetStack.length > 0 });
}
function sessionMenu(s) {
  const full = chat.s?.id === s.id ? chat.s : null;
  openSheet(s.title, [
    group(
      item(ICON.pin, s.pinned ? 'Odepnij' : 'Przypnij', async () => { closeSheet(); await patchSession(s.id, { pinned: !s.pinned }); }),
      item(ICON.edit, 'Zmień nazwę', () => askText('Zmień nazwę', s.title, 'zapisz', (title) => patchSession(s.id, { title }))),
      item(ICON.move, 'Przenieś do projektu', () => moveSheet(s), { sub: projects.find((p) => p.id === s.projectId)?.name ?? 'bez projektu' }),
    ),
    full && group(
      item(ICON.chart, 'Zużycie', () => usageSheet(true)),
      item(ICON.file, 'Pliki sesji', () => filesSheet(true), { sub: `${full.files?.length ?? 0}` }),
      item(ICON.tasks, 'Zadania w tle', () => runsSheet(true)),
    ),
    full && group(
      item(ICON.copy, 'Kopiuj rozmowę', () => { closeSheet(); clip(transcript(full)); }),
      item(ICON.share, 'Udostępnij rozmowę', () => { closeSheet(); shareText(full.title, transcript(full)); }),
      item(ICON.id, 'Kopiuj ID sesji', () => { closeSheet(); clip(full.id); }, { sub: full.id }),
    ),
    group(item(ICON.trash, 'Usuń sesję', () => confirmSheet('Usunąć sesję?', `„${s.title}” trafi do kosza na serwerze (data/sessions/trash). Agenci, którzy pracują, zostaną zatrzymani.`, 'usuń', async () => {
      await api(`/api/sessions/${s.id}`, { method: 'DELETE' });
      if (chat.s?.id === s.id) { chat.stream?.abort(); chat.s = null; store.del(LAST); showEmpty(); }
      await loadSessions();
      toast('usunięto');
    }), { danger: true })),
  ]);
}
function projectMenu(p) {
  openSheet(p.name, [
    group(
      item(ICON.plus, 'Nowa sesja w projekcie', () => { closeSheet(); closeDrawerOnPhone(); openStart(p.id); }),
      item(ICON.edit, 'Zmień nazwę', () => askText('Zmień nazwę projektu', p.name, 'zapisz', async (name) => { await jpost(`/api/projects/${p.id}`, { name }, 'PATCH'); await loadAll(); })),
    ),
    group(item(ICON.trash, 'Usuń projekt', () => confirmSheet('Usunąć projekt?', `Sesje z „${p.name}” zostaną, trafią do listy „Ostatnie”.`, 'usuń projekt', async () => {
      await api(`/api/projects/${p.id}`, { method: 'DELETE' });
      await loadAll();
    }), { danger: true })),
  ]);
}
function transcript(s) {
  const lines = [`# ${s.title}`, ''];
  for (const e of s.log) {
    if (e.who === 'system') continue;
    if (e.who === 'you') lines.push(`**Ty → ${e.to.map((a) => '@' + a).join(' ')}**`, '', e.s, '');
    else lines.push(`**${nameOf(e.who)}**`, '', e.s || '(bez tekstu)', '');
  }
  return lines.join('\n');
}

// ---------- start a session: scan with a radar, then pick agents ----------
const CANDIDATES = [['claude', 'Claude Code'], ['codex', 'Codex'], ['openclaw', 'OpenClaw'], ['dsh', 'DeepSeek Harness']];
function scanView() {
  const box = el('div', 'scan');
  const radar = el('div', 'radar');
  radar.append(el('i', 'sweep'), el('i', 'ring r1'), el('i', 'ring r2'), el('i', 'blip'));
  const t = el('div', 'scan-txt');
  t.append(el('b', null, 'skanuję serwer'), el('small', null, 'PATH · usługi systemd · npm'));
  const head = el('div', 'scan-head');
  head.append(radar, t);
  const list = el('div', 'scan-list');
  for (const [id, label] of CANDIDATES) {
    const row = el('div', 'scan-row');
    row.dataset.id = id;
    row.style.setProperty('--c', color(id));
    row.append(logo(id), el('span', 'nm', label), el('small', 'scan-st', 'szukam'));
    list.append(row);
  }
  box.append(head, list);
  return box;
}
async function scanInto(host, fresh = false) {
  const v = scanView();
  host.replaceChildren(v);
  const t0 = Date.now();
  await loadAgents(fresh);
  await sleep(Math.max(0, 900 - (Date.now() - t0)));
  for (const row of v.querySelectorAll('.scan-row')) {
    const a = agents.find((x) => x.id === row.dataset.id);
    row.classList.add(a?.ready ? 'found' : a?.installed ? 'partial' : 'missing');
    row.querySelector('.scan-st').textContent = a?.ready ? `✓ ${a.agent ? '@' + a.agent : 'gotowy'}` : a?.installed ? a.note ?? 'niedostępny' : 'nie znaleziono';
    await sleep(200);
  }
  v.classList.add('done');
  v.querySelector('.scan-txt b').textContent = `znaleziono ${agents.filter((a) => a.ready).length} z ${CANDIDATES.length}`;
  await sleep(400);
}
async function openStart(projectId = null) {
  const host = el('div');
  openSheet('Nowa sesja', [host]);
  await scanInto(host);
  if (sheetWrap.hidden) return;
  const list = el('div', 'pick');
  for (const a of agents.filter((x) => x.installed)) {
    const l = el('label');
    l.style.setProperty('--c', color(a.id));
    const box = el('input');
    box.type = 'checkbox';
    box.value = a.id;
    box.checked = a.ready;
    box.disabled = !a.ready;
    if (!a.ready) l.classList.add('off');
    l.append(box, logo(a.id), el('span', 'nm', a.label), el('small', null, a.ready ? (a.agent ? `@${a.id} · @${a.agent}` : `@${a.id}`) : a.note ?? 'niedostępny'));
    list.append(l);
  }
  const go = el('button', 's-primary', 'start');
  go.type = 'button';
  go.disabled = !agents.some((a) => a.ready);
  go.addEventListener('click', async () => {
    const picked = [...list.querySelectorAll('input:checked')].map((i) => i.value);
    if (!picked.length) return toast('wybierz co najmniej jednego agenta');
    go.disabled = true;
    const res = await jpost('/api/sessions', { agents: picked });
    if (!res.ok) { go.disabled = false; return toast('nie udało się otworzyć sesji'); }
    const { session } = await res.json();
    if (projectId) await jpost(`/api/sessions/${session.id}`, { projectId }, 'PATCH');
    closeSheet();
    await loadSessions();
    openSession(session.id);
  });
  const p = projectId ? projects.find((x) => x.id === projectId) : null;
  host.replaceChildren(el('p', 's-note', `Wybierz agentów. Każdy dostaje nową sesję i pracujecie razem w jednym oknie.${p ? ` Projekt: ${p.name}.` : ''} Nazwa powstanie z pierwszej wiadomości.`), list, go);
}

// ---------- chat ----------
const chat = { s: null, entries: new Map(), active: [], stream: null, files: [], uploading: 0 };
const KIND_ICON = { tool: '▸', edit: '±', think: '∴', todo: '☰' };

function promptNodes(mode, compact = false) {
  const frag = document.createDocumentFragment();
  if (mode === 'login' || !info) { frag.append('token: '); return frag; }
  const path = compact ? info.cwdShort.split('/').filter(Boolean).pop() ?? info.cwdShort : info.cwdShort;
  frag.append(el('span', 'p-user', `${info.user}@${info.host}`), ':', el('span', 'p-path', path), info.user === 'root' ? '# ' : '$ ');
  return frag;
}

function fileChip(f) {
  const b = el('button', 'fcard');
  b.type = 'button';
  const ic = el('span', 'f-ic');
  ic.append(svgIcon(f.type?.startsWith('image/') ? ICON.image : ICON.file));
  const t = el('span', 'f-txt');
  t.append(el('b', null, f.name), el('small', null, [f.type?.split('/')[1]?.toUpperCase() ?? 'PLIK', kb(f.size)].filter(Boolean).join(' · ')));
  b.append(ic, t, el('span', 'f-open', 'otwórz'));
  b.addEventListener('click', () => openFile(f));
  return b;
}
const fileById = (id) => chat.s?.files?.find((f) => f.id === id);

function entryEl(e) {
  const d = el('div', 'e');
  if (e.who === 'system') { d.classList.add('sys'); d.textContent = e.s; return d; }
  if (e.who === 'you') {
    d.classList.add('you');
    const line = el('div', 'you-line');
    line.append(promptNodes('shell', true));
    for (const a of e.to) { const t = el('span', 'tag'); t.style.setProperty('--c', color(a)); t.append(logo(a), '@' + a); line.append(t, ' '); }
    line.append(el('span', 'body', e.s));
    d.append(line);
    if (e.files?.length) { const fl = el('div', 'files'); for (const id of e.files) { const f = fileById(id); if (f) fl.append(fileChip(f)); } d.append(fl); }
    return d;
  }
  d.classList.add('agent');
  d.style.setProperty('--c', color(e.who));
  const head = el('div', 'a-head');
  const who = el('span', 'who');
  who.append(logo(e.who), nameOf(e.who));
  head.append(who);
  if (e.usage?.model) head.append(el('small', 'a-model', e.usage.model));
  d._head = head;
  d.append(head);
  d._tl = el('div', 'tl');
  d.append(d._tl);
  d._steps = new Map();
  d._last = null;
  d._files = el('div', 'files');
  d._meta = el('div', 'meta');
  d._acts = el('div', 'acts');
  d.append(d._files, d._meta, d._acts);
  d._entry = e;
  if (e.items) for (const it of e.items) it.k === 'text' ? addText(d, it.s) : upsertStep(d, it);
  else { for (const t of e.tools ?? []) upsertStep(d, { id: t, kind: 'tool', name: t.split(' ')[0], title: t.split(' ').slice(1).join(' '), status: 'ok' }); addText(d, e.s); }
  d._usage = e.usage ?? null;
  d._ms = e.ms ?? null;
  finish(d, e.status, e.error);
  return d;
}

function addText(d, text) {
  if (!text) return;
  if (!d._last) { d._last = el('div', 'body'); d._tl.append(d._last); }
  d._last.textContent += text;
}

function upsertStep(d, st) {
  let row = d._steps.get(st.id);
  if (!row) {
    row = el('div', 'step');
    const head = el('button', 'st-head');
    head.type = 'button';
    head.addEventListener('click', () => row.classList.toggle('open'));
    row.append(head, el('div', 'st-body'));
    d._steps.set(st.id, row);
    d._tl.append(row);
    d._last = null;
  }
  row._st = st;
  const open = row.classList.contains('open') || st.kind === 'todo';
  row.className = `step k-${st.kind} s-${st.status ?? 'running'}${open ? ' open' : ''}`;
  const [head, body] = row.children;
  const label = st.kind === 'think' ? 'myśli' : st.kind === 'todo' ? 'plan' : st.name || st.kind;
  const status = st.status === 'running' ? el('span', 'st-spin') : el('span', 'st-ok', st.status === 'error' ? `✗${st.exit != null ? ' ' + st.exit : ''}` : '✓');
  const time = st.ms >= 50 ? el('span', 'st-ms', st.ms < 1000 ? `${st.ms} ms` : `${(st.ms / 1000).toFixed(1)} s`) : '';
  const todos = st.todos ?? [];
  const summary = st.kind === 'think' ? (st.text ?? '').split('\n')[0] : st.kind === 'todo' ? `${todos.filter((t) => t.state === 'completed').length}/${todos.length}` : st.title ?? '';
  head.replaceChildren(el('span', 'st-ic', KIND_ICON[st.kind] ?? '▸'), el('b', 'st-name', label), el('span', 'st-title', summary), time, status);
  body.replaceChildren();
  if (st.kind === 'todo') for (const t of todos) body.append(el('div', `todo t-${t.state}`, `${t.state === 'completed' ? '☑' : t.state === 'in_progress' ? '◐' : '☐'} ${t.text}`));
  else if (st.kind === 'think') body.append(el('div', 'st-think', st.text ?? ''));
  else {
    if (st.kind === 'tool' && st.title) body.append(el('div', 'st-cmd', st.title));
    if (st.diff) body.append(diffEl(st.diff));
    if (st.output) body.append(el('pre', 'st-out', st.output));
    else if (!st.diff && st.status !== 'running') body.append(el('div', 'st-none', '(brak wyniku)'));
  }
}

function diffEl(df) {
  const box = el('div', 'diff');
  box.append(el('div', 'df-path', `${df.created ? 'nowy plik ' : ''}${df.path}`));
  const lines = (txt, cls, mark) => { for (const l of txt.split('\n').slice(0, 300)) box.append(el('div', cls, `${mark} ${l}`)); };
  if (df.old) lines(df.old, 'df-del', '-');
  if (df.new) lines(df.new, 'df-add', '+');
  return box;
}
const diffCount = (df) => ({ add: df.new ? df.new.split('\n').length : 0, del: df.old ? df.old.split('\n').length : 0 });

function renderMeta(d, status) {
  const steps = [...d._steps.values()].filter((r) => !r.classList.contains('k-think')).length;
  const u = d._usage ?? {};
  const parts = [];
  if (steps) parts.push(`${steps} ${steps === 1 ? 'krok' : steps < 5 ? 'kroki' : 'kroków'}`);
  if (d._ms != null) parts.push(`${(d._ms / 1000).toFixed(1)} s`);
  if (u.input || u.output) parts.push(`${tok(u.input ?? 0)} → ${tok(u.output ?? 0)} tok`);
  if (u.cost != null) parts.push(`$${Number(u.cost).toFixed(2)}`);
  d._meta.textContent = parts.length ? (status === 'running' ? 'w toku · ' : '') + parts.join(' · ') : '';
  if (u.model && !d._head.querySelector('.a-model')) d._head.append(el('small', 'a-model', u.model));
}

// Files the agent wrote, and the action row: copy, read aloud, share, changes.
function renderFooter(d, status) {
  const edits = [...d._steps.values()].map((r) => r._st).filter((st) => st?.kind === 'edit');
  d._files.replaceChildren();
  const seen = new Set();
  for (const st of edits) for (const id of st.files ?? []) { if (seen.has(id)) continue; seen.add(id); const f = fileById(id); if (f) d._files.append(fileChip(f)); }
  d._acts.replaceChildren();
  if (status === 'running') return;
  const text = () => [...d._tl.querySelectorAll('.body')].map((b) => b.textContent).join('\n\n').trim();
  const act = (icon, label, fn) => { const b = el('button', 'ib sm'); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.append(svgIcon(icon)); b.addEventListener('click', () => fn(b)); return b; };
  d._acts.append(
    act(ICON.copy, 'Kopiuj odpowiedź', () => clip(text())),
    act(ICON.play, 'Czytaj na głos', (b) => speak(text(), b)),
    act(ICON.share, 'Udostępnij odpowiedź', () => shareText(`${nameOf(d._entry.who)} — ${chat.s?.title ?? ''}`, text())),
  );
  const diffs = edits.filter((st) => st.diff);
  if (edits.length) {
    const sum = diffs.reduce((a, st) => { const c = diffCount(st.diff); return { add: a.add + c.add, del: a.del + c.del }; }, { add: 0, del: 0 });
    const chip = el('button', 'diff-chip');
    chip.type = 'button';
    chip.append(el('b', null, 'Zmiany'));
    if (diffs.length) chip.append(el('span', 'add', `+${sum.add}`), el('span', 'del', `-${sum.del}`));
    else chip.append(el('span', null, `${edits.length} ${edits.length === 1 ? 'plik' : 'pliki'}`));
    chip.addEventListener('click', () => openSheet('Zmiany', edits.map((st) => st.diff ? diffEl(st.diff) : el('p', 's-note', st.title))));
    d._acts.append(chip);
  }
}

function finish(d, status, error) {
  if (!d._tl) return;
  d.querySelector(':scope > .live')?.remove();
  d.querySelector(':scope > .errline')?.remove();
  if (status === 'running') d._files.before(el('span', 'live'));
  if (error) d._files.before(el('div', 'errline', error));
  if (status === 'done' && !d._tl.querySelector('.body') && !error && !d._steps.size) addText(d, '(bez odpowiedzi tekstowej)');
  renderMeta(d, status);
  renderFooter(d, status);
}

let speaking = null;
function speak(text, btn) {
  if (!('speechSynthesis' in window)) return toast('czytanie na głos niedostępne');
  if (speaking) { speechSynthesis.cancel(); speaking.replaceChildren(svgIcon(ICON.play)); const was = speaking; speaking = null; if (was === btn) return; }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'pl-PL';
  u.onend = () => { btn.replaceChildren(svgIcon(ICON.play)); speaking = null; };
  btn.replaceChildren(svgIcon(ICON.pause));
  speaking = btn;
  speechSynthesis.speak(u);
}

function renderLog(s) {
  chat.entries.clear();
  const nodes = [];
  for (const e of s.log) { const d = entryEl(e); chat.entries.set(e.n, d); nodes.push(d); }
  out.replaceChildren(...nodes);
  toBottom();
}

function onEvent(e) {
  const s = chat.s;
  if (!s) return;
  const d = e.n != null ? chat.entries.get(e.n) : null;
  if (e.type === 'snapshot') { chat.s = e.session; renderLog(e.session); renderHeader(); renderComposer(); }
  else if (e.type === 'entry') {
    if (chat.entries.has(e.entry.n)) return;
    s.log.push(e.entry);
    const nd = entryEl(e.entry);
    chat.entries.set(e.entry.n, nd);
    stick(() => out.append(nd));
  } else if (e.type === 'delta') { if (d?._tl) stick(() => addText(d, e.s)); }
  else if (e.type === 'step') { if (d?._tl) stick(() => { upsertStep(d, e.step); renderMeta(d, 'running'); renderFooter(d, 'running'); }); }
  else if (e.type === 'usage') { if (d?._tl) { d._usage = e.usage; if (e.ms != null) d._ms = e.ms; renderMeta(d, e.ms != null ? 'done' : 'running'); } }
  else if (e.type === 'end') {
    if (d) stick(() => finish(d, e.status, e.error));
    const entry = s.log.find((x) => x.n === e.n);
    if (entry) entry.status = e.status;
  } else if (e.type === 'state') {
    if (s.agents[e.agent]) s.agents[e.agent].state = e.state;
    renderHeader(); renderComposer(); loadSessions();
  } else if (e.type === 'title') { s.title = e.title; renderHeader(); loadSessions(); }
  else if (e.type === 'files') { s.files = e.files; for (const nd of chat.entries.values()) if (nd._tl) renderFooter(nd, nd.querySelector(':scope > .live') ? 'running' : 'done'); }
  else if (e.type === 'limits') { if (s.agents[e.agent]) s.agents[e.agent].limits = e.limits; }
  else if (e.type === 'meta') { for (const [a, m] of Object.entries(e.session.agents ?? {})) Object.assign(s.agents[a] ?? {}, { model: m.model, effort: m.effort }); renderComposer(); }
  else if (e.type === 'deleted') { chat.s = null; showEmpty(); loadSessions(); }
}

async function follow(id) {
  chat.stream?.abort();
  const controller = new AbortController();
  chat.stream = controller;
  for (let wait = 1000; chat.s?.id === id && !controller.signal.aborted; wait = Math.min(wait * 2, 15000)) {
    try {
      const res = await api(`/api/sessions/${id}/events`, { signal: controller.signal });
      if (!res.ok) return;
      wait = 1000;
      await readSSE(res, (_ev, data) => onEvent(data));
    } catch (err) { if (err.name === 'AbortError') return; }
    await sleep(wait);
  }
}

function chatLine(text, cls = 'sys') { stick(() => out.append(el('div', `e ${cls}`, text))); }

async function openSession(id) {
  const res = await api(`/api/sessions/${id}`);
  if (!res.ok) { store.del(LAST); return showEmpty(); }
  const { session } = await res.json();
  chat.s = session;
  chat.active = [Object.keys(session.agents)[0]];
  chat.files = [];
  store.set(LAST, id);
  setView('chat');
  renderLog(session);
  renderHeader();
  renderComposer();
  renderAttachments();
  renderDrawer();
  follow(id);
}

function renderHeader() {
  busyEl.hidden = true;
  if (view === 'chat' && chat.s) {
    const names = Object.keys(chat.s.agents);
    titleEl.textContent = chat.s.title;
    subEl.textContent = `${names.map(nameOf).join(' · ')}${info ? ` · ${info.host}` : ''}`;
    busyEl.hidden = !Object.values(chat.s.agents).some((a) => a.state === 'busy');
  }
}

function agentModel(a) {
  const st = chat.s.agents[a];
  const cat = catalog[a];
  const m = st.model || cat?.defaultModel || '';
  const label = cat?.models?.find((x) => x.id === m)?.label ?? (m || 'domyślny');
  return { label, effort: st.effort || cat?.defaultEffort || '' };
}

function renderComposer() {
  const s = chat.s;
  if (!s) return;
  const names = Object.keys(s.agents);
  chat.active = chat.active.filter((a) => names.includes(a));
  if (!chat.active.length) chat.active = [names[0]];
  const all = chat.active.length === names.length && names.length > 1;
  modelBtn.replaceChildren();
  modelBtn.style.setProperty('--c', all ? 'var(--ink)' : color(chat.active[0]));
  if (all) modelBtn.append(el('b', null, '@all'), el('small', null, `${names.length} agentów`));
  else {
    const a = chat.active[0];
    const m = agentModel(a);
    modelBtn.append(logo(a), el('b', null, nameOf(a)), el('small', null, [m.label, m.effort].filter(Boolean).join(' · ')));
  }
  modelBtn.append(svgIcon(ICON.chevron));
  cInput.placeholder = all ? 'Napisz do wszystkich…' : `Napisz do @${chat.active[0]}…`;
  updateSend();
}

const activeBusy = () => chat.s && chat.active.some((a) => chat.s.agents[a]?.state === 'busy');
function updateSend() {
  const stop = activeBusy() && !cInput.value.trim();
  sendBtn.classList.toggle('stop', stop);
  sendBtn.replaceChildren(svgIcon(stop ? ICON.stop : '<path d="M12 19V5M5 12l7-7 7 7"/>'));
  sendBtn.setAttribute('aria-label', stop ? 'Zatrzymaj' : 'Wyślij');
  sendBtn.disabled = !stop && !cInput.value.trim() && !chat.files.length;
}

function autosize() { cInput.style.height = 'auto'; cInput.style.height = Math.min(cInput.scrollHeight, 200) + 'px'; }

// The agent sheet: who gets the next line, and with which model and effort.
function modelSheet() {
  const s = chat.s;
  const names = Object.keys(s.agents);
  const build = () => {
    const rows = names.map((a) => {
      const m = agentModel(a);
      const right = el('span', 's-right');
      if (s.agents[a].state === 'busy') right.append(el('span', 'dot-busy'));
      if (chat.active.length === 1 && chat.active[0] === a) right.append(svgIcon(ICON.check));
      const r = item(logo(a), nameOf(a), () => { chat.active = [a]; renderComposer(); closeSheet(); cInput.focus(); }, { sub: [m.label, m.effort].filter(Boolean).join(' · '), right });
      r.style.setProperty('--c', color(a));
      return r;
    });
    const nodes = [el('div', 's-label', 'Pisz do'), group(...rows, names.length > 1 && item(ICON.tasks, 'Wszyscy (@all)', () => { chat.active = [...names]; renderComposer(); closeSheet(); }, { right: chat.active.length === names.length && names.length > 1 ? svgIcon(ICON.check) : null }))];
    nodes.push(el('div', 's-label', 'Model i moc'));
    nodes.push(group(...names.map((a) => {
      const m = agentModel(a);
      const r = item(logo(a), `${nameOf(a)}: ${m.label}`, () => agentModelSheet(a), { sub: catalog[a]?.configurable === false ? catalog[a].note : `moc: ${m.effort || 'domyślna'}`, right: svgIcon(ICON.chevron) });
      r.style.setProperty('--c', color(a));
      return r;
    })));
    nodes.push(group(item(ICON.shield, 'Uprawnienia agentów', () => {}, { sub: 'pełne — decyzja właściciela; agenci działają według własnych zasad' })));
    return nodes;
  };
  openSheet('Agent i model', build);
}
function agentModelSheet(a) {
  const cat = catalog[a];
  const st = chat.s.agents[a];
  const save = async (patch) => {
    await jpost(`/api/sessions/${chat.s.id}`, { models: { [a]: { model: st.model ?? '', effort: st.effort ?? '', ...patch } } }, 'PATCH');
    Object.assign(st, patch);
    renderComposer();
    drawSheet();
  };
  openSheet(nameOf(a), () => {
    if (!cat) return [el('p', 's-note', 'Wczytuję modele z agenta… (odświeży się samo)')];
    if (!cat.configurable) return [el('p', 's-note', `${cat.note}. Zmień model w konfiguracji agenta.`)];
    const cur = st.model ?? '';
    const curModel = cat.models.find((m) => m.id === cur) ?? cat.models[0];
    const models = group(...cat.models.map((m) => item(logo(a), m.label, () => save({ model: m.id, effort: m.efforts?.includes(st.effort) ? st.effort : '' }), {
      sub: [m.id === '' && cat.defaultModel ? cat.defaultModel : '', m.note, m.contextWindow ? `${tok(m.contextWindow)} kontekstu` : '', m.configured ? 'skonfigurowany' : ''].filter(Boolean).join(' · '),
      right: m.id === cur ? svgIcon(ICON.check) : null,
    })));
    const efforts = (curModel?.efforts?.length ? curModel.efforts : cat.models.find((m) => m.efforts?.length)?.efforts) ?? [];
    const eff = el('div', 'effort');
    for (const e of ['', ...efforts]) {
      const b = el('button', `eff${(st.effort ?? '') === e ? ' on' : ''}`, e || 'domyślna');
      b.type = 'button';
      b.addEventListener('click', () => save({ effort: e }));
      eff.append(b);
    }
    return [el('div', 's-label', 'Model'), models, el('div', 's-label', `Moc (${cat.effortLabel ?? 'effort'})`), eff,
      el('p', 's-note', `Domyślnie: ${cat.defaultModel ?? 'model agenta'}${cat.defaultEffort ? ` · ${cat.defaultEffort}` : ''}. Wyższa moc = dokładniej, dłużej i drożej.`)];
  }, { push: true });
}

// Usage: per agent tokens, context, cost; Claude plan limits.
function bar(frac, label, right) {
  const w = el('div', 'u-bar');
  const t = el('div', 'u-row');
  t.append(el('span', null, label), el('span', null, right));
  const track = el('div', 'u-track');
  const fill = el('i');
  fill.style.width = `${Math.min(100, Math.max(0, frac * 100)).toFixed(1)}%`;
  if (frac > 0.85) fill.classList.add('hot');
  track.append(fill);
  w.append(t, track);
  return w;
}
function resetIn(ts) {
  const s = ts - Date.now() / 1000;
  if (s <= 0) return 'reset teraz';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h >= 24 ? `reset ${new Date(ts * 1000).toLocaleString('pl-PL', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : `reset za ${h ? `${h} godz ` : ''}${m} min`;
}
async function usageSheet(push = false) {
  const res = await api(`/api/sessions/${chat.s.id}`);
  if (res.ok) chat.s = { ...chat.s, ...(await res.json()).session };
  const s = chat.s;
  const nodes = [];
  let total = 0;
  for (const [a, st] of Object.entries(s.agents)) {
    const u = st.usage ?? {};
    total += u.cost ?? 0;
    const card = el('div', 'u-card');
    card.style.setProperty('--c', color(a));
    const h = el('div', 'u-head');
    h.append(logo(a), el('b', null, nameOf(a)), el('small', null, u.model ?? agentModel(a).label));
    card.append(h);
    const win = u.contextWindow ?? catalog[a]?.models?.find((m) => m.id === (st.model || catalog[a]?.defaultModel))?.contextWindow;
    if (u.context && win) card.append(bar(u.context / win, 'okno kontekstu', `${tok(u.context)} z ${tok(win)} · ${Math.round(u.context / win * 100)}%`));
    else if (u.context) card.append(el('div', 'u-row', `kontekst: ${tok(u.context)} tok`));
    const kv = el('div', 'u-kv');
    kv.append(el('span', null, 'tury'), el('b', null, String(u.turns ?? 0)), el('span', null, 'tokeny'), el('b', null, `${tok(u.input ?? 0)} → ${tok(u.output ?? 0)}`));
    if (u.cost) kv.append(el('span', null, 'koszt'), el('b', null, `$${u.cost.toFixed(2)}`));
    card.append(kv);
    const w = st.limits?.windows;
    if (w) {
      card.append(el('div', 's-label', 'limity planu'));
      if (w.five_hour) card.append(bar(w.five_hour.utilization, 'sesja (5 godz)', `${Math.round(w.five_hour.utilization * 100)}% · ${resetIn(w.five_hour.resetsAt)}`));
      if (w.seven_day) card.append(bar(w.seven_day.utilization, 'tydzień', `${Math.round(w.seven_day.utilization * 100)}% · ${resetIn(w.seven_day.resetsAt)}`));
    }
    nodes.push(card);
  }
  nodes.unshift(el('p', 's-note', total ? `Łączny koszt sesji: $${total.toFixed(2)} (tam, gdzie agent go podaje).` : 'Koszt podaje tylko część agentów; reszta liczy się w ich planach.'));
  openSheet('Zużycie', nodes, { push });
}
function filesSheet(push = false) {
  const files = chat.s?.files ?? [];
  openSheet('Pliki sesji', files.length ? [group(...files.map((f) => item(ICON.file, f.name, () => { closeSheet(); openFile(f); }, { sub: `${f.from === 'you' ? 'od Ciebie' : `od ${nameOf(f.from)}`} · ${kb(f.size)}` })))] : [el('p', 's-note', 'Nie ma jeszcze plików. Dodaj je przyciskiem + albo poproś agenta o plik.')], { push });
}
async function runsSheet(push = false) {
  const { runs } = await (await api('/api/runs')).json();
  openSheet('Zadania w tle', runs.length ? [group(...runs.map((r) => {
    const stopB = el('button', 'ib sm');
    stopB.type = 'button';
    stopB.setAttribute('aria-label', 'Zatrzymaj');
    stopB.append(svgIcon(ICON.stop));
    stopB.addEventListener('click', async (e) => { e.stopPropagation(); await jpost(`/api/sessions/${r.session}/stop`, { agent: r.agent }); runsSheet(); });
    const row = item(logo(r.agent), `${nameOf(r.agent)} pracuje`, () => { closeSheet(); openSession(r.session); }, { sub: r.title, right: stopB });
    row.style.setProperty('--c', color(r.agent));
    return row;
  }))] : [el('p', 's-note', 'Żaden agent teraz nie pracuje.')], { push });
}

// ---------- composer ----------
function parseLine(text) {
  const names = Object.keys(chat.s.agents);
  const alias = Object.fromEntries(agents.filter((a) => a.agent && names.includes(a.id)).map((a) => [a.agent, a.id]));
  const to = [];
  let rest = text;
  for (let m; (m = /^\s*@([\w-]+)\s*/.exec(rest));) {
    const n = m[1].toLowerCase();
    if (n === 'all' || n === 'wszyscy') to.push(...names);
    else if (names.includes(n)) to.push(n);
    else if (alias[n]) to.push(alias[n]);
    else return { unknown: n };
    rest = rest.slice(m[0].length);
  }
  return { to: [...new Set(to)], text: rest.trim() };
}

async function sendLine() {
  if (activeBusy() && !cInput.value.trim()) {
    for (const a of chat.active) await jpost(`/api/sessions/${chat.s.id}/stop`, { agent: a });
    return;
  }
  const raw = cInput.value;
  if ((!raw.trim() && !chat.files.length) || !chat.s) return;
  if (chat.uploading) return toast('poczekaj, aż pliki się wyślą');
  if (raw.trim() === '/clear') { cInput.value = ''; out.replaceChildren(); return; }
  const p = parseLine(raw);
  if (p.unknown) return toast(`w tej sesji nie ma @${p.unknown}`);
  if (p.to.length) { chat.active = p.to; renderComposer(); }
  const text = p.text || (chat.files.length ? 'Zobacz załączone pliki.' : '');
  if (!text) { cInput.value = ''; autosize(); return; }
  const attachments = chat.files.map((f) => f.id);
  cInput.value = '';
  autosize();
  const res = await jpost(`/api/sessions/${chat.s.id}/send`, { to: chat.active, text, attachments });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({}));
    toast(error?.startsWith('busy') ? `jeszcze pracuje: ${error.slice(6)}` : `nie wysłano: ${error ?? res.status}`);
    cInput.value = raw;
    autosize();
  } else { chat.files = []; renderAttachments(); }
  updateSend();
  toBottom();
}
cInput.addEventListener('input', () => { autosize(); updateSend(); });
cInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && wide.matches) { e.preventDefault(); sendLine(); }
});
sendBtn.addEventListener('click', () => { sendLine(); if (wide.matches) cInput.focus(); });
modelBtn.addEventListener('click', () => { modelSheet(); if (Object.keys(catalog).length < Object.keys(chat.s?.agents ?? {}).length) loadModels(); });

// attachments
function renderAttachments() {
  attEl.replaceChildren(...chat.files.map((f) => {
    const c = el('div', `a-chip${f.pending ? ' pending' : ''}`);
    if (f.thumb) { const im = el('img'); im.src = f.thumb; im.alt = ''; c.append(im); } else c.append(svgIcon(ICON.file));
    c.append(el('span', null, f.name));
    const x = el('button', 'x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Usuń załącznik');
    x.addEventListener('click', () => { chat.files = chat.files.filter((y) => y !== f); renderAttachments(); updateSend(); });
    c.append(x);
    return c;
  }));
  attEl.hidden = !chat.files.length;
}
async function upload(fileList) {
  for (const file of fileList) {
    const f = { name: file.name, pending: true, thumb: file.type.startsWith('image/') ? URL.createObjectURL(file) : null };
    chat.files.push(f);
    chat.uploading++;
    renderAttachments();
    try {
      const res = await api(`/api/sessions/${chat.s.id}/files`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file });
      if (!res.ok) throw new Error(res.status === 413 ? 'plik większy niż 25 MB' : String(res.status));
      Object.assign(f, (await res.json()).file, { pending: false });
    } catch (err) {
      chat.files = chat.files.filter((y) => y !== f);
      toast(`nie wysłano ${file.name}: ${err.message}`);
    }
    chat.uploading--;
    renderAttachments();
    updateSend();
  }
}
for (const id of ['pickFiles', 'pickPhotos', 'pickCamera']) $(id).addEventListener('change', (e) => { upload([...e.target.files]); e.target.value = ''; });
$('plusBtn').addEventListener('click', () => {
  const tile = (icon, label, id) => { const b = el('button', 'tile'); b.type = 'button'; b.append(svgIcon(icon), el('span', null, label)); b.addEventListener('click', () => { closeSheet(); $(id).click(); }); return b; };
  const tiles = el('div', 'tiles');
  tiles.append(tile(ICON.camera, 'Aparat', 'pickCamera'), tile(ICON.image, 'Zdjęcia', 'pickPhotos'), tile(ICON.file, 'Pliki', 'pickFiles'));
  openSheet('Dodaj', [tiles, el('p', 's-note', 'Pliki trafiają na serwer do tej sesji, a agenci dostają ich ścieżki. Do 25 MB na plik.'),
    group(item(ICON.shield, 'Uprawnienia agentów', () => {}, { sub: 'pełne — agenci mogą czytać i zmieniać pliki' }))]);
});

// dictation
let recog = null;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) $('micBtn').hidden = true;
$('micBtn').addEventListener('click', () => {
  if (recog) { recog.stop(); return; }
  recog = new SR();
  recog.lang = 'pl-PL';
  recog.interimResults = true;
  recog.continuous = true;
  const base = cInput.value ? cInput.value.replace(/\s*$/, ' ') : '';
  recog.onresult = (ev) => { cInput.value = base + [...ev.results].map((r) => r[0].transcript).join(''); autosize(); updateSend(); };
  recog.onend = () => { recog = null; $('micBtn').classList.remove('rec'); };
  recog.onerror = () => toast('dyktowanie niedostępne');
  $('micBtn').classList.add('rec');
  recog.start();
});

// ---------- file viewer: full screen on phones, beside the chat on desktop ----------
let viewing = null;
async function openFile(f) {
  const v = $('viewer');
  viewing = { f, blob: null };
  $('vName').textContent = f.name;
  $('vMeta').textContent = [f.type, kb(f.size), f.from === 'you' ? 'od Ciebie' : f.from ? `od ${nameOf(f.from)}` : ''].filter(Boolean).join(' · ');
  const body = $('vBody');
  body.replaceChildren(el('p', 's-note', 'wczytuję…'));
  v.hidden = false;
  app.classList.add('viewing');
  const res = await api(`/api/sessions/${chat.s.id}/files/${f.id}`);
  if (!res.ok) { const { error } = await res.json().catch(() => ({})); body.replaceChildren(el('p', 's-note', `Nie można otworzyć: ${error ?? res.status}`)); return; }
  const blob = await res.blob();
  viewing.blob = blob;
  const url = URL.createObjectURL(blob);
  viewing.url = url;
  const t = f.type ?? blob.type;
  if (t.startsWith('image/')) { const im = el('img', 'v-img'); im.src = url; im.alt = f.name; body.replaceChildren(im); }
  else if (t.startsWith('video/')) { const vd = el('video', 'v-media'); vd.src = url; vd.controls = true; vd.playsInline = true; body.replaceChildren(vd); }
  else if (t.startsWith('audio/')) { const au = el('audio', 'v-media'); au.src = url; au.controls = true; body.replaceChildren(au); }
  else if (t === 'application/pdf') { const fr = el('iframe', 'v-frame'); fr.src = url; fr.title = f.name; body.replaceChildren(fr); }
  else if (t.startsWith('text/') || t === 'application/json' || blob.size < 2_000_000) {
    const text = await blob.text();
    if (/[\x00-\x08\x0e-\x1f]/.test(text.slice(0, 2000))) { body.replaceChildren(el('p', 's-note', 'Plik binarny — pobierz go, aby otworzyć.')); return; }
    const code = el('div', 'v-code');
    text.split('\n').slice(0, 5000).forEach((line, i) => { const r = el('div', 'v-line'); r.append(el('span', 'v-ln', String(i + 1)), el('span', null, line)); code.append(r); });
    if (t === 'text/html') {
      const tabs = el('div', 'v-tabs');
      const prev = el('iframe', 'v-frame');
      prev.setAttribute('sandbox', '');
      prev.srcdoc = text;
      const show = (which) => { body.replaceChildren(tabs, which); tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b._w === which)); };
      for (const [label, w] of [['kod', code], ['podgląd', prev]]) { const b = el('button', null, label); b.type = 'button'; b._w = w; b.addEventListener('click', () => show(w)); tabs.append(b); }
      show(code);
    } else body.replaceChildren(code);
  } else body.replaceChildren(el('p', 's-note', 'Tego typu nie da się podejrzeć — pobierz plik.'));
}
function closeViewer() {
  $('viewer').hidden = true;
  app.classList.remove('viewing');
  if (viewing?.url) URL.revokeObjectURL(viewing.url);
  viewing = null;
}
$('vClose').addEventListener('click', closeViewer);
$('vDown').addEventListener('click', () => {
  if (!viewing?.blob) return;
  const a = el('a');
  a.href = viewing.url;
  a.download = viewing.f.name;
  a.click();
});
$('vShare').addEventListener('click', async () => {
  if (!viewing?.blob) return;
  const file = new File([viewing.blob], viewing.f.name, { type: viewing.blob.type });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: viewing.f.name }); } catch { /* cancelled */ } }
  else toast('udostępnianie plików niedostępne — użyj pobierania');
});

// ---------- header menu ----------
$('moreBtn').addEventListener('click', () => {
  if (view === 'chat' && chat.s) return sessionMenu(sessions.find((x) => x.id === chat.s.id) ?? { ...chat.s, agents: Object.keys(chat.s.agents) });
  openSheet('SpectraHub', [group(
    item(ICON.plus, 'Nowa sesja', () => { closeSheet(); openStart(); }),
    item(ICON.tasks, 'Zadania w tle', () => runsSheet(true)),
    view === 'shell' && item(ICON.clear, 'Wyczyść terminal', () => { closeSheet(); shellOut.replaceChildren(); }),
  )]);
});

// ---------- views ----------
const shellOut = el('div');
let pageName = null;
function setView(v) {
  view = v;
  cmd.hidden = v !== 'shell';
  composer.hidden = v !== 'chat';
  screen.classList.toggle('as-page', v === 'page' || v === 'none');
  if (v !== 'chat') { chat.stream?.abort(); }
  if (v === 'shell') {
    out.replaceChildren(shellOut);
    titleEl.textContent = 'Terminal';
    subEl.textContent = info ? `${info.user}@${info.host} · tylko odczyt · bez TTY` : 'zaloguj się';
    shell.render();
    if (wide.matches || shell.mode === 'login') input.focus({ preventScroll: true });
    toBottom();
  }
  renderHeader();
  renderDrawer();
}
function showEmpty() {
  pageName = null;
  setView('none');
  titleEl.textContent = 'SpectraHub';
  subEl.textContent = info ? `${info.user}@${info.host}` : '';
  const box = el('div', 'empty');
  const mark = el('span', 'empty-mark');
  mark.append(document.querySelector('.brand-mark').cloneNode(true));
  const b = el('button', 's-primary', 'Nowa sesja');
  b.type = 'button';
  b.addEventListener('click', () => openStart());
  box.append(mark, el('b', null, 'Z kim dziś pracujemy?'), el('p', null, 'Wybierz agentów, a każdy dostanie nową sesję. Piszecie razem w jednym oknie.'), b);
  const recent = sessions.slice(0, 4);
  if (recent.length) {
    const g = group(...recent.map((s) => { const r = item(el('span', 'd-marks'), s.title, () => openSession(s.id), { sub: ago(s.updatedAt) }); s.agents.forEach((a) => r.firstChild.append(logo(a))); return r; }));
    box.append(el('div', 's-label', 'Ostatnie sesje'), g);
  }
  out.replaceChildren(box);
}
const SOON = {
  files: ['Pliki', 'Drzewo plików i podgląd, tylko do odczytu, z listą dozwolonych katalogów. Pliki z rozmów są już w menu sesji.', '0.4.0'],
  github: ['GitHub', 'Repozytoria, gałęzie i pull requesty — tylko odczyt.', '0.4.0'],
  servers: ['Serwery', 'Karty hostów: dysk, RAM, uptime, usługi i mapa.', '0.5.0'],
  studio: ['SpectraStudio', 'Generowanie obrazów, wideo i audio.', 'osobny produkt'],
};
async function openPage(name) {
  pageName = name;
  if (name === 'shell') { setView('shell'); return; }
  setView('page');
  const box = el('div', 'page');
  if (name === 'agents') {
    titleEl.textContent = 'Agenci';
    subEl.textContent = 'znalezieni na tym serwerze';
    const host = el('div');
    const again = el('button', 's-primary ghost', 'skanuj ponownie');
    again.type = 'button';
    again.addEventListener('click', async () => { await scanInto(host, true); drawAgents(); });
    const drawAgents = () => host.replaceChildren(group(...agents.map((a) => {
      const r = item(logo(a.id), a.label, () => {}, { sub: a.ready ? [a.version, a.agent && `@${a.agent}`, a.via].filter(Boolean).join(' · ') : a.installed ? a.note ?? 'niedostępny' : 'nie znaleziono', right: el('span', `dotx ${a.ready ? 'ok' : a.installed ? 'warn' : ''}`) });
      r.style.setProperty('--c', color(a.id));
      return r;
    })));
    box.append(host, again, el('p', 's-note', 'Skaner szuka Claude Code, Codex, OpenClaw i DeepSeek Harness: w PATH, w działających usługach systemd i w katalogach npm. Agenci w sesji działają według własnych ustawień i hooków, z pełnymi uprawnieniami.'));
    out.replaceChildren(box);
    await scanInto(host);
    drawAgents();
  } else if (name === 'settings') {
    titleEl.textContent = 'Ustawienia';
    subEl.textContent = info ? `${info.user}@${info.host}` : '';
    const tokCode = el('code', null, '•'.repeat(24));
    let shown = false;
    box.append(
      el('div', 's-label', 'serwer'),
      group(item(ICON.id, `${info?.user}@${info?.host}`, () => {}, { sub: info?.cwdShort })),
      el('div', 's-label', 'to urządzenie'),
      group(
        item(ICON.shield, 'Token', () => { shown = !shown; tokCode.textContent = shown ? token : '•'.repeat(24); }, { right: tokCode }),
        item(ICON.copy, 'Kopiuj token', () => clip(token)),
        item(ICON.share, 'Zaloguj inne urządzenie', async () => {
          const res = await jpost('/api/terminal/pair/new', {});
          if (!res.ok) return toast('nie udało się');
          const url = `${location.origin}/terminal#pair=${(await res.json()).code}`;
          if (navigator.share) { try { await navigator.share({ title: 'SpectraHub', url }); return; } catch { /* fall back */ } }
          clip(url, 'link skopiowany — działa raz, 15 min');
        }, { sub: 'jednorazowy link, ważny 15 minut' }),
      ),
      el('div', 's-label', 'aplikacja'),
      group(item(ICON.plus, 'Dodaj do ekranu głównego', async () => {
        if (installPrompt) { installPrompt.prompt(); installPrompt = null; return; }
        openSheet('Dodaj do ekranu głównego', [el('p', 's-note', 'W menu przeglądarki wybierz „Dodaj do ekranu głównego” (Chrome, DuckDuckGo) albo „Udostępnij → Do ekranu początkowego” (Safari). SpectraHub otworzy się wtedy jak aplikacja, na pełnym ekranie.'),
          el('p', 's-note', 'Logowanie pamięta też ciasteczko ważne rok, więc wyczyszczenie danych strony nie wyloguje Cię, dopóki ciasteczko zostaje. W DuckDuckGo oznacz stronę jako „Fireproof”, żeby przycisk ognia go nie kasował.')]);
      }, { sub: 'otwieraj SpectraHub jak aplikację' })),
      el('p', 's-note', 'Nowy token: na serwerze „spectrahub token --rotate” — wszystkie urządzenia zalogują się ponownie.'),
      group(item(ICON.trash, 'Wyloguj to urządzenie', () => logout(), { danger: true })),
    );
    out.replaceChildren(box);
  } else {
    const [t, text, ver] = SOON[name];
    titleEl.textContent = t;
    subEl.textContent = ver === 'osobny produkt' ? ver : `w planie · ${ver}`;
    box.append(el('p', 's-note big', text));
    out.replaceChildren(box);
  }
  renderDrawer();
}

// ---------- shell (read-only, allowlisted on the server) ----------
const shell = {
  mode: 'login', running: null, past: [], index: 0, draft: '',
  line(text = '', cls) { stick(() => shellOut.append(el('div', cls, text))); },
  echo(text) { stick(() => { const d = el('div'); d.append(promptNodes(this.mode), this.mode === 'login' ? '•'.repeat(text.length) : text); shellOut.append(d); }); },
  render() {
    const v = input.value;
    const shown = this.mode === 'login' ? '•'.repeat(v.length) : v;
    const pos = input.selectionStart ?? v.length;
    promptEl.replaceChildren(promptNodes(this.mode));
    typed.replaceChildren(shown.slice(0, pos), el('span', 'cur', shown[pos] ?? ' '), shown.slice(pos + 1));
  },
  setMode(m) {
    this.mode = m;
    cmd.classList.toggle('hidden', m === 'busy');
    this.render();
    if (m !== 'busy' && view === 'shell') { toBottom(); if (wide.matches || m === 'login') input.focus({ preventScroll: true }); }
  },
  async run(text) {
    const controller = new AbortController();
    this.running = controller;
    this.setMode('busy');
    const block = el('div');
    shellOut.append(block);
    const write = ansiWriter(block);
    try {
      const res = await api('/api/terminal/run', { method: 'POST', body: JSON.stringify({ line: text }), signal: controller.signal });
      if (!res.ok) { this.running = null; this.setMode('shell'); return; }
      await readSSE(res, (event, data) => {
        if (event === 'out') write(data.s);
        else if (event === 'err') { const s = el('span', 'err'); block.append(s); ansiWriter(s)(data.s); }
        else if (event === 'denied') this.line(`${text.split(' ')[0]}: niedozwolone w trybie tylko do odczytu (help: lista komend)`, 'err');
      });
    } catch (err) { this.line(err.name === 'AbortError' ? '^C' : `błąd połączenia: ${err.message}`, err.name === 'AbortError' ? null : 'err'); }
    this.running = null;
    this.setMode('shell');
  },
  builtins: {
    help() { shell.line('dostępne komendy (tylko odczyt):', 'note'); shell.line('  ' + info.commands.join('  ·  ')); shell.line('  clear · history · logout', 'note'); shell.line('Ctrl+C przerywa · Ctrl+L czyści · ↑↓ historia · Tab podpowiada', 'note'); },
    clear() { shellOut.replaceChildren(); },
    history() { shell.past.forEach((h, i) => shell.line(`${String(i + 1).padStart(4)}  ${h}`)); },
    logout() { logout(); },
  },
  async submit() {
    const text = input.value;
    input.value = '';
    this.echo(text);
    if (this.mode === 'login') { const t = text.trim(); if (t) { token = t; store.set(KEY, t); } return connect(); }
    const t = text.trim();
    if (!t) { toBottom(); return this.render(); }
    if (this.past.at(-1) !== t) this.past.push(t);
    this.index = this.past.length;
    this.draft = '';
    if (this.builtins[t]) { this.builtins[t](); return this.render(); }
    return this.run(t);
  },
  complete() {
    if (this.mode !== 'shell') return;
    const v = input.value.trimStart();
    const hits = [...info.commands, ...Object.keys(this.builtins)].filter((c) => c.startsWith(v));
    if (hits.length === 1) input.value = hits[0];
    else if (hits.length > 1) { this.echo(input.value); this.line(hits.join('  ')); let p = hits[0]; for (const h of hits) while (!h.startsWith(p)) p = p.slice(0, -1); if (p.length > v.length) input.value = p; }
  },
};
function ansiWriter(block) {
  let cls = [];
  let rest = '';
  return (chunk) => stick(() => {
    const text = rest + chunk;
    rest = '';
    const re = /\x1b\[([0-9;?]*)([A-Za-z])/g;
    let at = 0;
    const put = (s) => { if (s) block.append(el('span', cls.join(' ') || null, s)); };
    for (let m; (m = re.exec(text));) {
      put(text.slice(at, m.index));
      at = re.lastIndex;
      if (m[2] !== 'm') continue;
      for (const n of (m[1] || '0').split(';').map(Number)) {
        if (n === 0) cls = [];
        else if (n === 39) cls = cls.filter((c) => c[0] !== 'f');
        else if ([1, 2, 4].includes(n)) cls.push('a' + n);
        else if ((n >= 30 && n <= 37) || (n >= 90 && n <= 97)) cls = [...cls.filter((c) => c[0] !== 'f'), 'f' + n];
      }
    }
    const tail = text.slice(at);
    const esc = tail.lastIndexOf('\x1b');
    if (esc !== -1 && tail.length - esc < 16) { put(tail.slice(0, esc)); rest = tail.slice(esc); } else put(tail);
  });
}
input.addEventListener('keydown', (e) => {
  if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
    if (input.selectionStart !== input.selectionEnd) return;
    e.preventDefault();
    if (shell.running) return shell.running.abort();
    shell.echo(input.value + '^C');
    input.value = '';
    return shell.render();
  }
  if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); shellOut.replaceChildren(); return shell.render(); }
  if (e.key === 'Enter') { e.preventDefault(); return shell.submit(); }
  if (e.key === 'Tab') { e.preventDefault(); shell.complete(); return shell.render(); }
  if (shell.mode !== 'shell') return;
  if (e.key === 'ArrowUp' && shell.past.length) { e.preventDefault(); if (shell.index === shell.past.length) shell.draft = input.value; shell.index = Math.max(0, shell.index - 1); input.value = shell.past[shell.index]; }
  else if (e.key === 'ArrowDown') { e.preventDefault(); shell.index = Math.min(shell.past.length, shell.index + 1); input.value = shell.index === shell.past.length ? shell.draft : shell.past[shell.index]; }
  requestAnimationFrame(() => shell.render());
});
for (const ev of ['input', 'select', 'keyup', 'click']) input.addEventListener(ev, () => shell.render());
input.addEventListener('focus', () => cmd.classList.add('focus'));
input.addEventListener('blur', () => cmd.classList.remove('focus'));
screen.addEventListener('click', () => { if (view === 'shell' && !getSelection().toString() && shell.mode !== 'busy') input.focus({ preventScroll: true }); });

// ---------- sign in / out, loading ----------
async function pair(code) {
  try {
    const res = await fetch('/api/terminal/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    if (res.ok) { token = (await res.json()).token; store.set(KEY, token); toast('to urządzenie jest zalogowane'); }
    else shell.line('link logowania został już użyty albo wygasł — poproś o nowy (spectrahub login)', 'err');
  } catch { shell.line('brak połączenia z serwerem', 'err'); }
}
function askToken() {
  info = null;
  setView('shell');
  titleEl.textContent = 'Zaloguj się';
  subEl.textContent = 'link logowania albo token właściciela';
  shell.line('podaj token właściciela albo otwórz link logowania (na serwerze: spectrahub login)', 'note');
  shell.setMode('login');
}
function signedOut(msg) {
  token = null;
  store.del(KEY);
  chat.stream?.abort();
  chat.s = null;
  if (msg) shell.line(msg, 'err');
  askToken();
}
function logout() {
  fetch('/api/terminal/logout', { method: 'POST' }).catch(() => {});  // drop the login cookie too
  token = null;
  store.del(KEY);
  store.del(LAST);
  chat.stream?.abort();
  chat.s = null;
  info = null;
  shellOut.replaceChildren();
  askToken();
}
async function loadAgents(fresh) { const r = await api(`/api/agents${fresh ? '?fresh' : ''}`); if (r.ok) agents = (await r.json()).agents; }
// Model lists arrive per agent; while some are still being read, ask again and redraw an open sheet.
async function loadModels() {
  const r = await api('/api/models');
  if (!r.ok) return;
  const { _pending: pending, ...m } = (await r.json()).models;
  catalog = { ...catalog, ...m };
  if (view === 'chat') renderComposer();
  if (!sheetWrap.hidden) drawSheet();
  if (pending?.length) setTimeout(loadModels, 2000);
}
async function loadSessions() { const r = await api('/api/sessions'); if (r.ok) sessions = (await r.json()).sessions; renderDrawer(); }
async function loadProjects() { const r = await api('/api/projects'); if (r.ok) projects = (await r.json()).projects; }
async function loadAll() { await Promise.all([loadSessions(), loadProjects()]); renderDrawer(); }

async function connect() {
  if (pairCode && !token) await pair(pairCode);
  let res;
  // No token in this browser's storage: the login cookie may still be there (it outlives wiped storage).
  try { res = await api('/api/terminal/info'); } catch { shell.line('brak połączenia z serwerem', 'err'); return askToken(); }
  if (res.status === 401 && !token) return askToken();
  if (res.status === 403) { shell.line('terminal jest wyłączony na tym serwerze — właściciel włącza go poleceniem: spectrahub token', 'warn'); return askToken(); }
  if (!res.ok) return;
  info = await res.json();
  if (info.token && !token) { token = info.token; store.set(KEY, token); }
  delete info.token;
  $('avatar').textContent = (info.user[0] ?? '·').toUpperCase();
  $('meTxt').textContent = `${info.user}@${info.host}`;
  shell.line('SpectraHub · shell tylko do odczytu · bez TTY · help', 'note');
  shell.setMode('shell');
  await Promise.all([loadAll(), loadAgents()]);
  loadModels();
  const last = store.get(LAST);
  if (last && sessions.some((s) => s.id === last)) openSession(last);
  else showEmpty();
}

screen.addEventListener('scroll', () => document.querySelector('.main').classList.toggle('scrolled', screen.scrollTop > 4), { passive: true });
let installPrompt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
wide.addEventListener('change', () => { app.classList.remove('drawer-open'); });
if (wide.matches) app.classList.remove('collapsed');
showEmpty();
connect();
