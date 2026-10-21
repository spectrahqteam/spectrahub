// Workspace: rail, panel and one window that is either the read-only shell or a session with agents.
// The chat is the terminal: lines with the author as prefix, @agent picks who answers. No dependencies.
const $ = (id) => document.getElementById(id);
const grid = $('grid');
const out = $('out');
const screen = $('screen');
const cmd = $('cmd');
const input = $('input');
const typed = $('typed');
const promptEl = $('prompt');
const titleEl = $('title');
const modeEl = $('mode');
const composer = $('composer');
const cInput = $('cInput');
const cPrompt = $('cPrompt');
const hints = $('hints');
const pTitle = $('pTitle');
const pBody = $('pBody');
const statusEl = $('status');
const topMeta = $('topMeta');
const crumb = $('crumb');

const COLORS = { claude: '#d97757', codex: '#e8e8e8', openclaw: '#e0512f', dsh: '#4d6bfe' };
const narrow = matchMedia('(max-width: 899px)');

// ---------- storage ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* memory only */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* nothing stored */ } },
};
const KEY = 'spectrahub.token';
const LAST = 'spectrahub.session';

// A login link (…/terminal#pair=…) carries a one-time code; it leaves the address bar at once.
const pairCode = new URLSearchParams(location.hash.slice(1)).get('pair');
if (pairCode) history.replaceState(null, '', location.pathname + location.search);

let token = store.get(KEY);
let info = null;            // { user, host, cwdShort, commands }
let agents = [];            // scanner result
let sessions = [];          // list for the panel
let view = 'shell';         // 'shell' | 'chat'
let panelName = 'sessions';

// ---------- small helpers ----------
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const nearBottom = () => screen.scrollHeight - screen.scrollTop - screen.clientHeight < 60;
function stick(fn) {
  const follow = nearBottom();
  fn();
  if (follow) screen.scrollTop = screen.scrollHeight;
}
const toBottom = () => { screen.scrollTop = screen.scrollHeight; };
function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'teraz';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} godz`;
  return new Date(iso).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
}
const color = (id) => COLORS[id] ?? '#e8e8e8';

async function api(path, opts = {}) {
  return fetch(path, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } });
}

// Reads a text/event-stream response; calls fn(eventName, data) per frame.
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

// ---------- views: the shell and the chat share the window ----------
const shellOut = el('div');
const chatOut = el('div');
out.append(shellOut);

// The shell shows the full path like Ubuntu; the chat uses the folder name to keep lines short.
function promptNodes(mode, compact = false) {
  const frag = document.createDocumentFragment();
  if (mode === 'login' || !info) { frag.append('token: '); return frag; }
  const path = compact ? info.cwdShort.split('/').filter(Boolean).pop() ?? info.cwdShort : info.cwdShort;
  frag.append(el('span', 'p-user', `${info.user}@${info.host}`), ':', el('span', 'p-path', path), info.user === 'root' ? '# ' : '$ ');
  return frag;
}

function setView(v) {
  view = v;
  out.replaceChildren(v === 'shell' ? shellOut : chatOut);
  cmd.hidden = v !== 'shell';
  cmd.classList.toggle('hidden', v !== 'shell' || shell.mode === 'busy');
  composer.hidden = v !== 'chat';
  modeEl.textContent = v === 'shell' ? 'bez TTY' : '';
  if (v === 'shell') {
    titleEl.textContent = info ? `${info.user}@${info.host}: ${info.cwdShort}` : 'terminal';
    crumb.textContent = 'terminal';
    shell.render();
    if (!narrow.matches) input.focus({ preventScroll: true });
  } else {
    autosize();
    if (!narrow.matches) cInput.focus({ preventScroll: true });
  }
  toBottom();
  renderStatus();
  markRail();
}

// ---------- shell (read-only, allowlisted on the server) ----------
const shell = {
  mode: 'login',            // 'login' | 'shell' | 'busy'
  running: null,
  past: [],
  index: 0,
  draft: '',
  line(text = '', cls) { stick(() => shellOut.append(el('div', cls, text))); },
  echo(text) {
    stick(() => {
      const d = el('div');
      d.append(promptNodes(this.mode), this.mode === 'login' ? '•'.repeat(text.length) : text);
      shellOut.append(d);
    });
  },
  render() {
    const v = input.value;
    const shown = this.mode === 'login' ? '•'.repeat(v.length) : v;
    const pos = input.selectionStart ?? v.length;
    promptEl.replaceChildren(promptNodes(this.mode));
    const cur = el('span', 'cur', shown[pos] ?? ' ');
    typed.replaceChildren(shown.slice(0, pos), cur, shown.slice(pos + 1));
  },
  setMode(m) {
    this.mode = m;
    cmd.classList.toggle('hidden', m === 'busy' || view !== 'shell');
    this.render();
    if (m !== 'busy' && view === 'shell') { toBottom(); if (!narrow.matches || m === 'login') input.focus({ preventScroll: true }); }
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
      if (res.status === 401 || res.status === 403) { this.running = null; return signedOut('sesja wygasła'); }
      await readSSE(res, (event, data) => {
        if (event === 'out') write(data.s);
        else if (event === 'err') { const s = el('span', 'err'); block.append(s); ansiWriter(s)(data.s); }
        else if (event === 'denied') this.line(`${text.split(' ')[0]}: niedozwolone w trybie tylko do odczytu (help: lista komend)`, 'err');
      });
    } catch (err) {
      if (err.name === 'AbortError') this.line('^C');
      else this.line(`błąd połączenia: ${err.message}`, 'err');
    }
    this.running = null;
    this.setMode('shell');
  },
  builtins: {
    help() {
      shell.line('dostępne komendy (tylko odczyt):', 'note');
      shell.line('  ' + info.commands.join('  ·  '));
      shell.line('  clear · history · logout', 'note');
      shell.line('Ctrl+C przerywa · Ctrl+L czyści · ↑↓ historia · Tab podpowiada', 'note');
      shell.line('rozmowa z agentami: menu Sesje → Start sesja', 'note');
    },
    clear() { shellOut.replaceChildren(); },
    history() { shell.past.forEach((h, i) => shell.line(`${String(i + 1).padStart(4)}  ${h}`)); },
    logout() { logout(); },
  },
  async submit() {
    const text = input.value;
    input.value = '';
    this.echo(text);
    if (this.mode === 'login') {
      const t = text.trim();
      if (t) { token = t; store.set(KEY, t); }
      return connect();
    }
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
    else if (hits.length > 1) {
      this.echo(input.value);
      this.line(hits.join('  '));
      let p = hits[0];
      for (const h of hits) while (!h.startsWith(p)) p = p.slice(0, -1);
      if (p.length > v.length) input.value = p;
    }
  },
};

// ANSI colour codes → spans; keeps colour state across chunks of one command.
function ansiWriter(block) {
  let cls = [];
  let rest = '';
  return (chunk) => stick(() => {
    const text = rest + chunk;
    rest = '';
    const re = /\x1b\[([0-9;?]*)([A-Za-z])/g;
    let at = 0;
    const put = (s) => {
      if (!s) return;
      const span = el('span', cls.join(' ') || null, s);
      block.append(span);
    };
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
  if (e.key === 'ArrowUp' && shell.past.length) {
    e.preventDefault();
    if (shell.index === shell.past.length) shell.draft = input.value;
    shell.index = Math.max(0, shell.index - 1);
    input.value = shell.past[shell.index];
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    shell.index = Math.min(shell.past.length, shell.index + 1);
    input.value = shell.index === shell.past.length ? shell.draft : shell.past[shell.index];
  }
  requestAnimationFrame(() => shell.render());
});
for (const ev of ['input', 'select', 'keyup', 'click']) input.addEventListener(ev, () => shell.render());
input.addEventListener('focus', () => cmd.classList.add('focus'));
input.addEventListener('blur', () => cmd.classList.remove('focus'));
screen.addEventListener('click', () => {
  if (getSelection().toString()) return;
  if (view === 'shell' && shell.mode !== 'busy') input.focus({ preventScroll: true });
});
document.addEventListener('keydown', (e) => {
  if (shell.running && e.ctrlKey && (e.key === 'c' || e.key === 'C') && !getSelection().toString()) { e.preventDefault(); shell.running.abort(); }
});

// ---------- chat: a session with agents ----------
const chat = {
  s: null,                  // the open session
  entries: new Map(),       // n -> element
  active: [],               // who gets a line without @
  stream: null,             // AbortController of the event stream
};

function entryEl(e) {
  const d = el('div', 'e');
  if (e.who === 'system') { d.classList.add('sys'); d.textContent = e.s; return d; }
  if (e.who === 'you') {
    d.classList.add('you');
    d.append(promptNodes('shell', true));
    const to = el('span', null, e.to.map((a) => '@' + a).join(' ') + ' ');
    to.style.color = 'var(--accent)';
    d.append(to, el('span', 'body', e.s));
    return d;
  }
  d.classList.add('agent');
  d.style.setProperty('--c', color(e.who));
  d.append(el('span', 'who', `[${e.who}]`), ' ');
  const tools = el('span', 'tools');
  for (const t of e.tools ?? []) tools.append(el('span', null, t));
  const body = el('span', 'body', e.s);
  d.append(tools, body);
  d._tools = tools;
  d._body = body;
  finish(d, e.status, e.error);
  return d;
}

function finish(d, status, error) {
  d.querySelector('.live')?.remove();
  d.querySelector('.errline')?.remove();
  if (status === 'running') d.append(el('span', 'live'));
  if (error) d.append(el('span', 'errline', (d._body?.textContent ? '\n' : '') + error));
  if (status === 'done' && !d._body?.textContent && !error) d._body.textContent = '(bez odpowiedzi tekstowej)';
}

function renderLog(s) {
  chat.entries.clear();
  chatOut.replaceChildren();
  for (const e of s.log) {
    const d = entryEl(e);
    chat.entries.set(e.n, d);
    chatOut.append(d);
  }
  toBottom();
}

function onEvent(e) {
  const s = chat.s;
  if (!s) return;
  if (e.type === 'snapshot') {
    chat.s = e.session;
    renderLog(e.session);
    renderComposer();
  } else if (e.type === 'entry') {
    if (chat.entries.has(e.entry.n)) return;
    s.log.push(e.entry);
    const d = entryEl(e.entry);
    chat.entries.set(e.entry.n, d);
    stick(() => chatOut.append(d));
  } else if (e.type === 'delta') {
    const d = chat.entries.get(e.n);
    if (d?._body) stick(() => { d._body.textContent += e.s; });
  } else if (e.type === 'tool') {
    const d = chat.entries.get(e.n);
    if (d?._tools) stick(() => d._tools.append(el('span', null, e.s)));
  } else if (e.type === 'end') {
    const d = chat.entries.get(e.n);
    if (d) stick(() => finish(d, e.status, e.error));
  } else if (e.type === 'state') {
    if (s.agents[e.agent]) s.agents[e.agent].state = e.state;
    renderComposer();
    renderStatus();
  }
}

async function follow(id) {
  chat.stream?.abort();
  const controller = new AbortController();
  chat.stream = controller;
  for (let wait = 1000; chat.s?.id === id && !controller.signal.aborted; wait = Math.min(wait * 2, 15000)) {
    try {
      const res = await api(`/api/sessions/${id}/events`, { signal: controller.signal });
      if (res.status === 401) return signedOut('sesja wygasła');
      if (!res.ok) { chatLine(`nie mogę otworzyć sesji (HTTP ${res.status})`, 'err'); return; }
      wait = 1000;
      await readSSE(res, (_ev, data) => onEvent(data));
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
    await new Promise((r) => setTimeout(r, wait));  // dropped: reconnect, the snapshot fills the gap
  }
}

function chatLine(text, cls = 'sys') {
  stick(() => chatOut.append(el('div', `e ${cls}`, text)));
}

async function openSession(id) {
  const res = await api(`/api/sessions/${id}`);
  if (!res.ok) { store.del(LAST); return setView('shell'); }
  const { session } = await res.json();
  chat.s = session;
  chat.active = [Object.keys(session.agents)[0]];
  store.set(LAST, id);
  titleEl.textContent = session.title;
  crumb.textContent = session.title;
  renderLog(session);
  renderComposer();
  setView('chat');
  renderPanel();
  follow(id);
}

function renderComposer() {
  const s = chat.s;
  if (!s) return;
  const names = Object.keys(s.agents);
  chat.active = chat.active.filter((a) => names.includes(a));
  if (!chat.active.length) chat.active = [names[0]];
  const host = el('span', 'host');
  host.append(promptNodes('shell', true));
  cPrompt.replaceChildren(
    host,
    el('span', 'to', chat.active.length === names.length && names.length > 1 ? '@all' : chat.active.map((a) => '@' + a).join(' ')),
  );
  hints.replaceChildren();
  for (const a of names) {
    const b = el('button');
    b.type = 'button';
    b.style.setProperty('--c', color(a));
    b.classList.toggle('on', chat.active.includes(a) && chat.active.length === 1);
    b.append(el('span', `st ${s.agents[a].state === 'busy' ? 'busy' : ''}`), el('b', null, '@' + a));
    b.title = s.agents[a].state === 'busy' ? `${a} pracuje` : `pisz do ${a}`;
    b.addEventListener('click', () => { chat.active = [a]; renderComposer(); cInput.focus(); });
    hints.append(b);
  }
  if (names.length > 1) {
    const all = el('button');
    all.type = 'button';
    all.classList.toggle('on', chat.active.length === names.length);
    all.append(el('b', null, '@all'));
    all.addEventListener('click', () => { chat.active = [...names]; renderComposer(); cInput.focus(); });
    hints.append(all);
  }
  for (const c of ['/stop', '/clear', '/help']) {
    const b = el('button', null, c);
    b.type = 'button';
    b.addEventListener('click', () => command(c));
    hints.append(b);
  }
}

function autosize() {
  cInput.style.height = 'auto';
  cInput.style.height = Math.min(cInput.scrollHeight, 160) + 'px';
}

// Leading @names pick the recipients and stay picked; the rest of the line is the message.
function parseLine(text) {
  const names = Object.keys(chat.s.agents);
  const to = [];
  let rest = text;
  // an agent answers to its id and to the name its runtime gives it (e.g. @dsh or @hermes)
  const alias = Object.fromEntries(agents.filter((a) => a.agent && names.includes(a.id)).map((a) => [a.agent, a.id]));
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

async function command(line) {
  const [c, arg] = line.trim().split(/\s+/);
  if (c === '/clear') { chatOut.replaceChildren(); chat.entries.clear(); return; }
  if (c === '/help') {
    chatLine('@agent treść — pisze do agenta i zostaje przy nim · @all — do wszystkich naraz');
    chatLine('sam @agent — tylko przełącza odbiorcę · /stop [agent] — przerywa · /clear — czyści ekran');
    chatLine('Enter wysyła · Shift+Enter nowa linia · agenci widzą, co napisali pozostali');
    return;
  }
  if (c === '/stop') {
    const res = await api(`/api/sessions/${chat.s.id}/stop`, { method: 'POST', body: JSON.stringify(arg ? { agent: arg.replace(/^@/, '') } : {}) });
    const { stopped } = await res.json();
    chatLine(stopped ? `przerwano: ${stopped}` : 'nic nie pracuje');
    return;
  }
  chatLine(`nieznana komenda ${c} — /help`, 'err');
}

async function sendLine() {
  const raw = cInput.value;
  if (!raw.trim() || !chat.s) return;
  if (raw.trim().startsWith('/')) { cInput.value = ''; autosize(); return command(raw); }
  const p = parseLine(raw);
  if (p.unknown) { chatLine(`w tej sesji nie ma @${p.unknown}`, 'err'); return; }
  if (p.to.length) { chat.active = p.to; renderComposer(); }
  if (!p.text) { cInput.value = ''; autosize(); return; }
  cInput.value = '';
  autosize();
  const res = await api(`/api/sessions/${chat.s.id}/send`, { method: 'POST', body: JSON.stringify({ to: chat.active, text: p.text }) });
  if (res.status === 401) return signedOut('sesja wygasła');
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({}));
    chatLine(error?.startsWith('busy') ? `jeszcze pracuje: ${error.slice(6)} — poczekaj albo /stop` : `nie wysłano: ${error ?? res.status}`, 'err');
    cInput.value = raw;
    autosize();
  }
  toBottom();
}

cInput.addEventListener('input', autosize);
cInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendLine(); }
});
$('cSend').addEventListener('click', () => { sendLine(); cInput.focus(); });

// ---------- start a session ----------
const dlg = $('startDlg');
async function openStart() {
  const pick = $('pick');
  if (!agents.length) {
    pick.replaceChildren(el('p', 'p-note', 'szukam agentów na serwerze…'));
    $('startGo').disabled = true;
    if (!dlg.open) dlg.showModal();
    await loadAgents();
  }
  pick.replaceChildren();
  const ready = agents.filter((a) => a.ready);
  for (const a of agents.filter((x) => x.installed)) {
    const l = el('label');
    l.style.setProperty('--c', color(a.id));
    const box = el('input');
    box.type = 'checkbox';
    box.value = a.id;
    box.checked = a.ready;
    box.disabled = !a.ready;
    if (!a.ready) l.classList.add('off');
    l.append(box, el('span', 'nm', a.label), el('small', null, a.ready ? (a.agent ? `@${a.id} · @${a.agent}` : `@${a.id}`) : a.note ?? 'niedostępny'));
    pick.append(l);
  }
  if (!ready.length) pick.append(el('p', 'p-note', 'Nie znaleziono agenta, którego da się uruchomić. Zainstaluj Claude Code, Codex albo OpenClaw i zeskanuj ponownie.'));
  $('startGo').disabled = !ready.length;
  $('startTitle').value = '';
  if (!dlg.open) dlg.showModal();
}
$('startForm').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'start') return;
  e.preventDefault();
  const picked = [...dlg.querySelectorAll('.pick input:checked')].map((i) => i.value);
  if (!picked.length) return;
  const res = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ agents: picked, title: $('startTitle').value }) });
  dlg.close();
  if (!res.ok) { chatLine('nie udało się otworzyć sesji', 'err'); return; }
  const { session } = await res.json();
  await loadSessions();
  closePanel();
  openSession(session.id);
});

// ---------- panels ----------
const PANELS = {
  sessions: 'sesje',
  terminal: 'terminal',
  agents: 'agenci',
  files: 'pliki',
  github: 'github',
  servers: 'serwery',
  studio: 'spectrastudio',
  settings: 'ustawienia',
};
const SOON = {
  files: ['Drzewo plików i podgląd, tylko do odczytu, z listą dozwolonych katalogów.', '0.4.0'],
  github: ['Repozytoria, gałęzie i pull requesty — tylko odczyt.', '0.4.0'],
  servers: ['Karty hostów: dysk, RAM, uptime, usługi i mapa.', '0.5.0'],
  studio: ['Generowanie obrazów, wideo i audio.', 'osobny produkt'],
};

function markRail() {
  for (const b of document.querySelectorAll('.r-btn')) {
    const on = narrow.matches ? grid.classList.contains('open') && b.dataset.panel === panelName : b.dataset.panel === panelName;
    b.classList.toggle('on', on);
  }
}

function openPanel(name) {
  if (narrow.matches && grid.classList.contains('open') && panelName === name) return closePanel();
  panelName = name;
  renderPanel();
  if (narrow.matches) grid.classList.add('open');
  markRail();
}
function closePanel() {
  grid.classList.remove('open');
  markRail();
}

function sec(...nodes) {
  const d = el('div', 'p-sec');
  d.append(...nodes);
  return d;
}

function renderPanel() {
  pTitle.textContent = PANELS[panelName];
  const body = [];
  if (!info) {
    body.push(sec(el('p', 'p-note', 'Zaloguj to urządzenie: otwórz link logowania albo wpisz token w oknie terminala.')));
  } else if (panelName === 'sessions') {
    const b = el('button', 'p-btn', '+ start sesja');
    b.addEventListener('click', openStart);
    body.push(sec(b));
    if (!sessions.length) body.push(sec(el('p', 'p-note', 'Nie ma jeszcze sesji. Start sesja: wybierasz agentów, każdy dostaje nową sesję i piszecie razem.')));
    for (const s of sessions) {
      const it = el('button', 'p-item');
      it.classList.toggle('on', view === 'chat' && chat.s?.id === s.id);
      const small = el('small');
      for (const a of s.agents) { const c = el('span', 'chip'); c.style.setProperty('--c', color(a)); c.append(el('i'), a); small.append(c); }
      small.append(el('span', null, ago(s.updatedAt)));
      it.append(el('b', null, s.title), small);
      it.addEventListener('click', () => { closePanel(); openSession(s.id); });
      body.push(it);
    }
  } else if (panelName === 'terminal') {
    const b = el('button', 'p-btn', '>_ otwórz shell');
    b.addEventListener('click', () => { closePanel(); setView('shell'); });
    body.push(sec(b), sec(el('p', 'p-label', 'tryb'), el('p', 'p-note', 'Tylko odczyt, bez TTY. Działają komendy z listy:'), el('p', 'p-note', info.commands.join(' · '))));
  } else if (panelName === 'agents') {
    for (const a of agents) {
      const r = el('div', 'ag-row');
      r.append(el('span', `dotx ${a.ready ? 'ok' : a.installed ? 'warn' : ''}`));
      const g = el('div', 'grow');
      const name = el('b', null, a.label);
      name.style.color = a.installed ? color(a.id) : 'var(--dim)';
      const where = [a.version, a.agent && `agent ${a.agent}`, a.via].filter(Boolean).join(' · ');
      g.append(name, el('small', null, a.ready ? where : a.installed ? a.note ?? 'niedostępny' : 'nie znaleziono'));
      r.append(g);
      body.push(r);
    }
    const b = el('button', 'p-btn ghost', 'skanuj ponownie');
    b.addEventListener('click', async () => { b.textContent = 'skanuję…'; await loadAgents(true); renderPanel(); });
    body.push(sec(b), sec(el('p', 'p-note', 'Skaner szuka Claude Code, Codex, OpenClaw i DeepSeek Harness (Hermes): w PATH, w działających usługach systemd i w katalogach instalacji. Agenci w sesji działają z pełnymi uprawnieniami na tym serwerze.')));
  } else if (panelName === 'settings') {
    const kv = el('div', 'p-kv');
    kv.append(el('span', null, 'host'), el('code', null, `${info.user}@${info.host}`), el('span', null, 'katalog'), el('code', null, info.cwdShort));
    body.push(sec(el('p', 'p-label', 'serwer'), kv));
    const tok = el('code', null, '•'.repeat(24));
    const btns = el('div', 'p-row-btns');
    const show = el('button', null, 'pokaż');
    show.addEventListener('click', () => { const on = show.textContent === 'pokaż'; tok.textContent = on ? token : '•'.repeat(24); show.textContent = on ? 'ukryj' : 'pokaż'; });
    const copy = el('button', null, 'kopiuj');
    copy.addEventListener('click', () => clip(token, copy));
    btns.append(show, copy);
    body.push(sec(el('p', 'p-label', 'token tego urządzenia'), tok, btns));
    const linkBtns = el('div', 'p-row-btns');
    const linkText = el('code');
    const link = el('button', null, 'kopiuj link');
    link.addEventListener('click', async () => {
      const res = await api('/api/terminal/pair/new', { method: 'POST' });
      if (!res.ok) return flash(link, 'nie udało się');
      const url = `${location.origin}/terminal#pair=${(await res.json()).code}`;
      linkText.textContent = url;
      clip(url, link);
    });
    linkBtns.append(link);
    body.push(sec(el('p', 'p-label', 'zaloguj inne urządzenie'), el('p', 'p-note', 'Jednorazowy link: działa raz, przez 15 minut.'), linkText, linkBtns));
    body.push(sec(el('p', 'p-label', 'nowy token'), el('p', 'p-note', 'Na serwerze: spectrahub token --rotate — wszystkie urządzenia zalogują się ponownie.')));
    const out1 = el('div', 'p-row-btns');
    const lo = el('button', 'warn', 'wyloguj to urządzenie');
    lo.addEventListener('click', logout);
    out1.append(lo);
    body.push(sec(out1));
  } else {
    const [text, ver] = SOON[panelName];
    body.push(sec(el('p', 'p-note', text), el('span', 'soon', ver === 'osobny produkt' ? ver : `w planie · ${ver}`)));
  }
  pBody.replaceChildren(...body);
}

function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = old; }, 1400);
}
async function clip(text, btn) {
  try { await navigator.clipboard.writeText(text); flash(btn, 'skopiowano'); } catch { flash(btn, 'zaznacz i skopiuj'); }
}

for (const b of document.querySelectorAll('.r-btn')) b.addEventListener('click', () => openPanel(b.dataset.panel));
$('pClose').addEventListener('click', closePanel);
$('scrim').addEventListener('click', closePanel);
narrow.addEventListener('change', () => { grid.classList.remove('open'); markRail(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && grid.classList.contains('open')) closePanel(); });

// ---------- status ----------
function renderStatus() {
  const parts = [];
  const ready = agents.filter((a) => a.ready).length;
  topMeta.replaceChildren();
  if (info) topMeta.append('agenci ', el('b', null, `${ready}/${agents.length}`), ' · ', el('b', null, info.host));
  if (view === 'chat' && chat.s) {
    parts.push(['sesja', chat.s.title]);
    for (const [a, st] of Object.entries(chat.s.agents)) parts.push([a, st.state === 'busy' ? 'pracuje' : 'gotowy']);
  } else {
    parts.push(['shell', 'tylko odczyt']);
  }
  statusEl.replaceChildren(...parts.map(([k, v], i) => {
    const s = el('span', i > 1 ? 'wide' : null);
    s.append(k + ' ', el('b', v === 'pracuje' ? 'ok' : null, v));
    return s;
  }));
}

// ---------- sign in / out ----------
async function pair(code) {
  try {
    const res = await fetch('/api/terminal/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    if (res.ok) { token = (await res.json()).token; store.set(KEY, token); shell.line('to urządzenie jest zalogowane', 'note'); }
    else shell.line('link logowania został już użyty albo wygasł — poproś o nowy (spectrahub login)', 'err');
  } catch { shell.line('brak połączenia z serwerem', 'err'); }
}

function askToken() {
  info = null;
  setView('shell');
  shell.line('podaj token właściciela albo otwórz link logowania (na serwerze: spectrahub login)', 'note');
  shell.setMode('login');
  renderPanel();
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
  token = null;
  store.del(KEY);
  store.del(LAST);
  chat.stream?.abort();
  chat.s = null;
  info = null;
  shellOut.replaceChildren();
  chatOut.replaceChildren();
  closePanel();
  askToken();
}

async function loadAgents(fresh) {
  const res = await api(`/api/agents${fresh ? '?fresh' : ''}`);
  if (res.ok) agents = (await res.json()).agents;
  renderStatus();
}
async function loadSessions() {
  const res = await api('/api/sessions');
  if (res.ok) sessions = (await res.json()).sessions;
  if (panelName === 'sessions') renderPanel();
}

async function connect() {
  if (pairCode && !token) await pair(pairCode);
  if (!token) return askToken();
  let res;
  try { res = await api('/api/terminal/info'); } catch { shell.line('brak połączenia z serwerem', 'err'); return askToken(); }
  if (res.status === 403) {
    shell.line('terminal jest wyłączony na tym serwerze.', 'warn');
    shell.line('właściciel włącza go poleceniem:  spectrahub token', 'note');
    return askToken();
  }
  if (res.status === 401) return signedOut('nieprawidłowy token');
  if (!res.ok) { shell.line(`warsztat niedostępny na tym serwerze (HTTP ${res.status})`, 'err'); shell.setMode('busy'); return; }
  info = await res.json();
  shell.line('SpectraHub · shell tylko do odczytu · bez TTY · help', 'note');
  shell.setMode('shell');
  await Promise.all([loadAgents(), loadSessions()]);
  renderPanel();
  const last = store.get(LAST);
  if (last && sessions.some((s) => s.id === last)) openSession(last);
  else setView('shell');
}

setView('shell');
renderPanel();
connect();
