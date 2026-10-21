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

// Official marks of the runtimes (same as on the start screen), shown next to every agent.
const LOGOS = {
  "claude": "<svg viewBox=\"0 0 24 24\"><path d=\"m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z\"/></svg>",
  "codex": "<svg viewBox=\"0 0 24 24\"><path d=\"M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z\"/></svg>",
  "openclaw": "<svg viewBox=\"0 0 120 120\"><path d=\"M60 10C30 10 15 35 15 55c0 20 15 40 30 45v10h10v-10s5 2 10 0v10h10v-10c15-5 30-25 30-45 0-20-15-45-45-45Z\" fill=\"#e8453c\"/><path d=\"M20 45C5 40 0 50 5 60c5 10 15 5 20-5 3-7 0-10-5-10Z\" fill=\"#e8453c\"/><path d=\"M100 45c15-5 20 5 15 15-5 10-15 5-20-5-3-7 0-10 5-10Z\" fill=\"#e8453c\"/><path d=\"M45 15Q35 5 30 8M75 15q10-10 15-7\" stroke=\"#ff4d4d\" stroke-width=\"3\" stroke-linecap=\"round\" fill=\"none\"/><circle cx=\"45\" cy=\"35\" r=\"6\" fill=\"#050810\"/><circle cx=\"75\" cy=\"35\" r=\"6\" fill=\"#050810\"/><circle cx=\"46\" cy=\"34\" r=\"2.5\" fill=\"#00e5cc\"/><circle cx=\"76\" cy=\"34\" r=\"2.5\" fill=\"#00e5cc\"/></svg>",
  "dsh": "<svg viewBox=\"0 0 24 24\"><path d=\"M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .113.074.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45\"/></svg>"
};
function logo(id) {
  const t = document.createElement('template');
  t.innerHTML = LOGOS[id] ?? '';
  const svg = t.content.firstElementChild;
  if (svg) { svg.classList.add('mark'); svg.setAttribute('aria-hidden', 'true'); }
  return svg ?? document.createTextNode('');
}

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
    const to = el('span', 'to');
    for (const a of e.to) { const t = el('span', 'tag'); t.style.setProperty('--c', color(a)); t.append(logo(a), '@' + a); to.append(t, ' '); }
    d.append(to, el('span', 'body', e.s));
    return d;
  }
  d.classList.add('agent');
  d.style.setProperty('--c', color(e.who));
  const who = el('span', 'who');
  who.append(logo(e.who), `[${e.who}]`);
  d.append(who);
  const tl = el('div', 'tl');
  d.append(tl);
  d._tl = tl;
  d._steps = new Map();
  d._last = null;       // the text item being written to, if the last item is text
  d._meta = el('div', 'meta');
  d.append(d._meta);
  if (e.items) {
    for (const it of e.items) it.k === 'text' ? addText(d, it.s) : upsertStep(d, it);
  } else {
    // sessions from before the timeline: tool lines, then the text
    for (const t of e.tools ?? []) upsertStep(d, { id: t, kind: 'tool', name: t.split(' ')[0], title: t.split(' ').slice(1).join(' '), status: 'ok' });
    addText(d, e.s);
  }
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

const KIND_ICON = { tool: '▸', edit: '±', think: '∴', todo: '☰' };

// One step of the agent's work: a line you can open for the output, the diff or the thinking.
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
  const open = row.classList.contains('open') || st.kind === 'todo';
  row.className = `step k-${st.kind} s-${st.status ?? 'running'}${open ? ' open' : ''}`;
  const [head, body] = row.children;
  const label = st.kind === 'think' ? 'myśli' : st.kind === 'todo' ? 'plan' : st.name || st.kind;
  const status = st.status === 'running' ? el('span', 'st-spin')
    : el('span', 'st-ok', st.status === 'error' ? `✗${st.exit != null ? ' ' + st.exit : ''}` : '✓');
  // under 50 ms means the runtime reported start and end together: no honest duration to show
  const time = st.ms >= 50 ? el('span', 'st-ms', st.ms < 1000 ? `${st.ms} ms` : `${(st.ms / 1000).toFixed(1)} s`) : '';
  const todos = st.todos ?? [];
  const summary = st.kind === 'think' ? (st.text ?? '').split('\n')[0]
    : st.kind === 'todo' ? `${todos.filter((t) => t.state === 'completed').length}/${todos.length}` : st.title ?? '';
  head.replaceChildren(el('span', 'st-ic', KIND_ICON[st.kind] ?? '▸'), el('b', 'st-name', label), el('span', 'st-title', summary), time, status);
  body.replaceChildren();
  if (st.kind === 'todo') {
    for (const t of todos) body.append(el('div', `todo t-${t.state}`, `${t.state === 'completed' ? '☑' : t.state === 'in_progress' ? '◐' : '☐'} ${t.text}`));
  } else if (st.kind === 'think') {
    body.append(el('div', 'st-think', st.text ?? ''));
  } else {
    if (st.kind === 'tool' && st.title) body.append(el('div', 'st-cmd', st.title));
    if (st.diff) body.append(diffEl(st.diff));
    if (st.output) body.append(el('pre', 'st-out', st.output));
    else if (!st.diff && st.status !== 'running') body.append(el('div', 'st-none', '(brak wyniku)'));
  }
}

function diffEl(df) {
  const box = el('div', 'diff');
  box.append(el('div', 'df-path', `${df.created ? 'nowy plik ' : ''}${df.path}`));
  const lines = (txt, cls, mark) => { for (const l of txt.split('\n').slice(0, 200)) box.append(el('div', cls, `${mark} ${l}`)); };
  if (df.old) lines(df.old, 'df-del', '-');
  if (df.new) lines(df.new, 'df-add', '+');
  return box;
}

function renderMeta(d, status) {
  const steps = [...d._steps.values()].filter((r) => !r.classList.contains('k-think')).length;
  const u = d._usage ?? {};
  const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const parts = [];
  if (steps) parts.push(`${steps} ${steps === 1 ? 'krok' : steps < 5 ? 'kroki' : 'kroków'}`);
  if (d._ms != null) parts.push(`${(d._ms / 1000).toFixed(1)} s`);
  if (u.input || u.output) parts.push(`${k(u.input ?? 0)} → ${k(u.output ?? 0)} tok`);
  if (u.cost != null) parts.push(`$${Number(u.cost).toFixed(2)}`);
  d._meta.textContent = parts.length ? (status === 'running' ? 'w toku · ' : '') + parts.join(' · ') : '';
}

function finish(d, status, error) {
  if (!d._tl) return;
  d.querySelector(':scope > .live')?.remove();
  d.querySelector(':scope > .errline')?.remove();
  if (status === 'running') d._meta.before(el('span', 'live'));
  if (error) d._meta.before(el('div', 'errline', error));
  if (status === 'done' && !d._tl.querySelector('.body') && !error && !d._steps.size) addText(d, '(bez odpowiedzi tekstowej)');
  renderMeta(d, status);
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
    if (d?._tl) stick(() => addText(d, e.s));
  } else if (e.type === 'step') {
    const d = chat.entries.get(e.n);
    if (d?._tl) stick(() => { upsertStep(d, e.step); renderMeta(d, 'running'); });
  } else if (e.type === 'usage') {
    const d = chat.entries.get(e.n);
    if (d?._tl) { d._usage = e.usage; if (e.ms != null) d._ms = e.ms; renderMeta(d, e.ms != null ? 'done' : 'running'); }
  } else if (e.type === 'end') {
    const d = chat.entries.get(e.n);
    if (d) stick(() => finish(d, e.status, e.error));
  } else if (e.type === 'title') {
    s.title = e.title;
    titleEl.textContent = crumb.textContent = e.title;
    renderStatus();
    loadSessions();
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
    (() => {
      const to = el('span', 'to');
      if (chat.active.length === names.length && names.length > 1) to.append('@all');
      else for (const a of chat.active) to.append(logo(a), '@' + a, ' ');
      return to;
    })(),
  );
  hints.replaceChildren();
  for (const a of names) {
    const b = el('button');
    b.type = 'button';
    b.style.setProperty('--c', color(a));
    b.classList.toggle('on', chat.active.includes(a) && chat.active.length === 1);
    b.append(el('span', `st ${s.agents[a].state === 'busy' ? 'busy' : ''}`), logo(a), el('b', null, '@' + a));
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
  // an agent answers to its id and to the name its own runtime gives it (OpenClaw agent, Harness workspace)
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

// ---------- agent scan: a radar while the server looks, then each runtime lights up or fades ----------
const CANDIDATES = [['claude', 'Claude Code'], ['codex', 'Codex'], ['openclaw', 'OpenClaw'], ['dsh', 'DeepSeek Harness']];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function scanView() {
  const box = el('div', 'scan');
  const radar = el('div', 'radar');
  radar.append(el('i', 'sweep'), el('i', 'ring r1'), el('i', 'ring r2'), el('i', 'blip'));
  const head = el('div', 'scan-head');
  head.append(radar, (() => { const t = el('div', 'scan-txt'); t.append(el('b', null, 'skanuję serwer'), el('small', null, 'PATH · usługi systemd · npm')); return t; })());
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

// Plays the result onto the scan view row by row, then resolves.
async function revealScan(box) {
  for (const row of box.querySelectorAll('.scan-row')) {
    const a = agents.find((x) => x.id === row.dataset.id);
    row.classList.add(a?.ready ? 'found' : a?.installed ? 'partial' : 'missing');
    row.querySelector('.scan-st').textContent = a?.ready ? `✓ ${a.agent ? '@' + a.agent : 'gotowy'}` : a?.installed ? a.note ?? 'niedostępny' : 'nie znaleziono';
    await sleep(220);
  }
  box.classList.add('done');
  box.querySelector('.scan-txt b').textContent = `znaleziono ${agents.filter((a) => a.ready).length} z ${CANDIDATES.length}`;
  await sleep(450);
}

// Runs a scan with the animation in `host`; the server keeps a fresh result for a minute.
async function scanInto(host, fresh = false) {
  const view = scanView();
  host.replaceChildren(view);
  const started = Date.now();
  await loadAgents(fresh);
  await sleep(Math.max(0, 900 - (Date.now() - started)));  // long enough to be seen, never longer than the scan
  await revealScan(view);
}

// ---------- start a session ----------
const dlg = $('startDlg');
async function openStart() {
  const pick = $('pick');
  $('startGo').disabled = true;
  if (!dlg.open) dlg.showModal();
  await scanInto(pick);
  if (!dlg.open) return;
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
    l.append(box, logo(a.id), el('span', 'nm', a.label), el('small', null, a.ready ? (a.agent ? `@${a.id} · @${a.agent}` : `@${a.id}`) : a.note ?? 'niedostępny'));
    pick.append(l);
  }
  if (!ready.length) pick.append(el('p', 'p-note', 'Nie znaleziono agenta, którego da się uruchomić. Zainstaluj Claude Code, Codex albo OpenClaw i zeskanuj ponownie.'));
  $('startGo').disabled = !ready.length;
  if (!dlg.open) dlg.showModal();
}
$('startForm').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'start') return;
  e.preventDefault();
  const picked = [...dlg.querySelectorAll('.pick input:checked')].map((i) => i.value);
  if (!picked.length) return;
  const res = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ agents: picked }) });
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
      for (const a of s.agents) { const c = el('span', 'chip'); c.style.setProperty('--c', color(a)); c.append(logo(a), a); small.append(c); }
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
      r.append(el('span', `dotx ${a.ready ? 'ok' : a.installed ? 'warn' : ''}`), logo(a.id));
      const g = el('div', 'grow');
      const name = el('b', null, a.label);
      name.style.color = a.installed ? color(a.id) : 'var(--dim)';
      const where = [a.version, a.agent && `agent ${a.agent}`, a.via].filter(Boolean).join(' · ');
      g.append(name, el('small', null, a.ready ? where : a.installed ? a.note ?? 'niedostępny' : 'nie znaleziono'));
      r.append(g);
      body.push(r);
    }
    const b = el('button', 'p-btn ghost', 'skanuj ponownie');
    b.addEventListener('click', async () => {
      const host = el('div');
      pBody.replaceChildren(host);
      await scanInto(host, true);
      renderPanel();
    });
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
