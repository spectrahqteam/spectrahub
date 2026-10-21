// Terminal page: a read-only shell on the server, streamed line by line. No dependencies.
const out = document.getElementById('out');
const screen = document.getElementById('screen');
const cmd = document.getElementById('cmd');
const input = document.getElementById('input');
const typed = document.getElementById('typed');
const promptEl = document.getElementById('prompt');
const titleEl = document.getElementById('title');
const stateEl = document.getElementById('state');

const KEY = 'spectrahub.token';
const store = {
  get() { try { return localStorage.getItem(KEY); } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY, v); } catch { /* memory only */ } },
  clear() { try { localStorage.removeItem(KEY); } catch { /* nothing stored */ } },
};

// A login link (…/terminal#token=…) signs this browser in; the token leaves the address bar at once.
const fromLink = new URLSearchParams(location.hash.slice(1)).get('token');
if (fromLink) {
  store.set(fromLink);
  history.replaceState(null, '', location.pathname + location.search);
}
let token = fromLink || store.get();
let info = null;          // { user, host, cwdShort, commands }
let mode = 'login';       // 'login' | 'shell' | 'busy'
let running = null;       // AbortController of the running command
const past = [];  // commands typed this session
let hIndex = 0;
let draft = '';

// ---------- output ----------
const nearBottom = () => screen.scrollHeight - screen.scrollTop - screen.clientHeight < 40;
function stick(fn) {
  const follow = nearBottom();
  fn();
  if (follow) screen.scrollTop = screen.scrollHeight;
}
function line(text = '', cls) {
  stick(() => {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = text;
    out.append(div);
  });
}
function promptNodes() {
  const frag = document.createDocumentFragment();
  if (mode === 'login') {
    frag.append('token: ');
    return frag;
  }
  const u = document.createElement('span');
  u.className = 'p-user';
  u.textContent = `${info.user}@${info.host}`;
  const p = document.createElement('span');
  p.className = 'p-path';
  p.textContent = info.cwdShort;
  frag.append(u, ':', p, info.user === 'root' ? '# ' : '$ ');
  return frag;
}
function echo(text) {
  stick(() => {
    const div = document.createElement('div');
    div.append(promptNodes(), mode === 'login' ? '•'.repeat(text.length) : text);
    out.append(div);
  });
}

// ANSI colour codes → spans. Keeps colour state across chunks of one command.
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
      const span = document.createElement('span');
      if (cls.length) span.className = cls.join(' ');
      span.textContent = s;
      block.append(span);
    };
    for (let m; (m = re.exec(text));) {
      put(text.slice(at, m.index));
      at = re.lastIndex;
      if (m[2] !== 'm') continue;  // only colours; other escapes are dropped
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

// ---------- input line ----------
function render() {
  const v = input.value;
  const shown = mode === 'login' ? '•'.repeat(v.length) : v;
  const pos = input.selectionStart ?? v.length;
  promptEl.replaceChildren(promptNodes());
  const cur = document.createElement('span');
  cur.className = 'cur';
  cur.textContent = shown[pos] ?? ' ';
  typed.replaceChildren(shown.slice(0, pos), cur, shown.slice(pos + 1));
}
function setMode(m) {
  mode = m;
  cmd.classList.toggle('hidden', m === 'busy');
  stateEl.className = 'state ' + (m === 'busy' ? 'busy' : m === 'shell' ? 'ok' : 'off');
  input.type = 'text';
  render();
  if (m !== 'busy') {
    screen.scrollTop = screen.scrollHeight;  // the new prompt is always in view
    input.focus({ preventScroll: true });
  }
}

// ---------- server ----------
async function api(path, opts = {}) {
  return fetch(path, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
}

async function connect() {
  if (!token) return askToken();
  let res;
  try { res = await api('/api/terminal/info'); } catch { line('brak połączenia z serwerem', 'err'); return askToken(); }
  if (res.status === 403) {
    line('terminal jest wyłączony na tym serwerze.', 'warn');
    line('właściciel włącza go poleceniem:  spectrahub token', 'note');
    return askToken();
  }
  if (res.status === 401) {
    token = null;
    store.clear();
    line('nieprawidłowy token', 'err');
    return askToken();
  }
  if (!res.ok) {
    line(`terminal niedostępny na tym serwerze (HTTP ${res.status})`, 'err');
    setMode('busy');
    return;
  }
  info = await res.json();
  titleEl.textContent = `${info.user}@${info.host}: ${info.cwdShort}`;
  line(`SpectraHub terminal · tylko odczyt · bez TTY · wpisz help`, 'note');
  setMode('shell');
}

function askToken() {
  line('podaj token właściciela (na serwerze: spectrahub token)', 'note');
  setMode('login');
}

async function run(text) {
  const controller = new AbortController();
  running = controller;
  setMode('busy');
  const block = document.createElement('div');
  out.append(block);
  const write = ansiWriter(block);
  try {
    const res = await api('/api/terminal/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line: text }),
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) { running = null; token = null; store.clear(); line('sesja wygasła', 'err'); return askToken(); }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let cut;
      while ((cut = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        const event = /^event: (.*)$/m.exec(frame)?.[1];
        const data = JSON.parse(/^data: (.*)$/m.exec(frame)?.[1] ?? 'null');
        if (event === 'out') write(data.s);
        else if (event === 'err') { const s = document.createElement('span'); s.className = 'err'; block.append(s); ansiWriter(s)(data.s); }
        else if (event === 'denied') line(`${text.split(' ')[0]}: niedozwolone w trybie tylko do odczytu (help: lista komend)`, 'err');
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') line('^C');
    else line(`błąd połączenia: ${err.message}`, 'err');
  }
  running = null;
  setMode('shell');
}

// ---------- commands typed by the user ----------
const builtins = {
  help() {
    line('dostępne komendy (tylko odczyt):', 'note');
    line('  ' + info.commands.join('  ·  '));
    line('  clear · history · settings · logout', 'note');
    line('Ctrl+C przerywa · Ctrl+L czyści · ↑↓ historia · Tab podpowiada', 'note');
  },
  clear() { out.replaceChildren(); },
  history() { past.forEach((h, i) => line(`${String(i + 1).padStart(4)}  ${h}`)); },
  logout() { token = null; store.clear(); info = null; out.replaceChildren(); askToken(); },
};

async function submit() {
  const text = input.value;
  input.value = '';
  echo(text);
  if (mode === 'login') {
    token = text.trim();
    if (token) store.set(token);
    return // ---------- settings ----------
const panel = document.getElementById('settings');
const tokenField = document.getElementById('s-token');
const linkFor = () => `${location.origin}/terminal#token=${token}`;
function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = old; }, 1400);
}
async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); flash(btn, 'skopiowano'); } catch { flash(btn, 'nie udało się'); }
}
function openSettings(show) {
  panel.hidden = !show;
  if (!show) return input.focus({ preventScroll: true });
  const has = Boolean(token && info);
  panel.classList.toggle('empty', !has);
  tokenField.textContent = has ? '•'.repeat(24) : '—';
  tokenField.dataset.shown = '';
}
document.getElementById('gear').addEventListener('click', () => openSettings(panel.hidden));
document.getElementById('s-close').addEventListener('click', () => openSettings(false));
document.getElementById('s-show').addEventListener('click', (e) => {
  const shown = tokenField.dataset.shown === '1';
  tokenField.textContent = shown ? '•'.repeat(24) : token;
  tokenField.dataset.shown = shown ? '' : '1';
  e.currentTarget.textContent = shown ? 'pokaż' : 'ukryj';
});
document.getElementById('s-copy').addEventListener('click', (e) => copy(token, e.currentTarget));
document.getElementById('s-link').addEventListener('click', (e) => copy(linkFor(), e.currentTarget));
document.getElementById('s-logout').addEventListener('click', () => { openSettings(false); builtins.logout(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) openSettings(false); });
builtins.settings = () => openSettings(true);

connect();
  }
  const t = text.trim();
  if (!t) { screen.scrollTop = screen.scrollHeight; return render(); }
  if (past[past.length - 1] !== t) past.push(t);
  hIndex = past.length;
  draft = '';
  if (builtins[t]) { builtins[t](); return render(); }
  return run(t);
}

function complete() {
  if (mode !== 'shell') return;
  const v = input.value.trimStart();
  const all = [...info.commands, ...Object.keys(builtins)];
  const hits = all.filter((c) => c.startsWith(v));
  if (hits.length === 1) input.value = hits[0];
  else if (hits.length > 1) {
    echo(input.value);
    line(hits.join('  '));
    let p = hits[0];
    for (const h of hits) while (!h.startsWith(p)) p = p.slice(0, -1);
    input.value = p.length > v.length ? p : input.value;
  }
}

input.addEventListener('keydown', (e) => {
  if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
    if (input.selectionStart !== input.selectionEnd) return;  // let copy work on a selection
    e.preventDefault();
    if (running) return running.abort();
    echo(input.value + '^C');
    input.value = '';
    return render();
  }
  if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); out.replaceChildren(); return render(); }
  if (e.key === 'Enter') { e.preventDefault(); return submit(); }
  if (e.key === 'Tab') { e.preventDefault(); complete(); return render(); }
  if (mode !== 'shell') return;
  if (e.key === 'ArrowUp' && past.length) {
    e.preventDefault();
    if (hIndex === past.length) draft = input.value;
    hIndex = Math.max(0, hIndex - 1);
    input.value = past[hIndex];
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    hIndex = Math.min(past.length, hIndex + 1);
    input.value = hIndex === past.length ? draft : past[hIndex];
  }
  requestAnimationFrame(render);
});
// Ctrl+C while a command runs and the input is hidden.
document.addEventListener('keydown', (e) => {
  if (running && e.ctrlKey && (e.key === 'c' || e.key === 'C') && !getSelection().toString()) { e.preventDefault(); running.abort(); }
});
for (const ev of ['input', 'select', 'keyup', 'click']) input.addEventListener(ev, render);
input.addEventListener('focus', () => cmd.classList.add('focus'));
input.addEventListener('blur', () => cmd.classList.remove('focus'));
screen.addEventListener('click', () => { if (!getSelection().toString() && mode !== 'busy') input.focus({ preventScroll: true }); });

// ---------- settings ----------
const panel = document.getElementById('settings');
const tokenField = document.getElementById('s-token');
const linkFor = () => `${location.origin}/terminal#token=${token}`;
function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = old; }, 1400);
}
async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); flash(btn, 'skopiowano'); } catch { flash(btn, 'nie udało się'); }
}
function openSettings(show) {
  panel.hidden = !show;
  if (!show) return input.focus({ preventScroll: true });
  const has = Boolean(token && info);
  panel.classList.toggle('empty', !has);
  tokenField.textContent = has ? '•'.repeat(24) : '—';
  tokenField.dataset.shown = '';
}
document.getElementById('gear').addEventListener('click', () => openSettings(panel.hidden));
document.getElementById('s-close').addEventListener('click', () => openSettings(false));
document.getElementById('s-show').addEventListener('click', (e) => {
  const shown = tokenField.dataset.shown === '1';
  tokenField.textContent = shown ? '•'.repeat(24) : token;
  tokenField.dataset.shown = shown ? '' : '1';
  e.currentTarget.textContent = shown ? 'pokaż' : 'ukryj';
});
document.getElementById('s-copy').addEventListener('click', (e) => copy(token, e.currentTarget));
document.getElementById('s-link').addEventListener('click', (e) => copy(linkFor(), e.currentTarget));
document.getElementById('s-logout').addEventListener('click', () => { openSettings(false); builtins.logout(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) openSettings(false); });
builtins.settings = () => openSettings(true);

connect();
