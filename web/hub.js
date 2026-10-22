// Start screen motion: draws the branches from the mark to each tile, reveals each tile
// when its branch reaches it, then keeps comets running along the branches. No dependencies.
const NS = 'http://www.w3.org/2000/svg';
const map = document.getElementById('map');
const svg = map.querySelector('.traces');
const core = map.querySelector('.core');
const word = map.querySelector('.word');
const tiles = [...map.querySelectorAll('.tile')];
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const desktop = matchMedia('(min-width: 1024px)');

const DRAW_START = 650;   // ms after load, once the mark has settled
const DRAW_MS = 750;
const LOWER_DELAY = 300;  // the lower row starts after the side wires
const LINK_MS = 520;      // phones: each link from one row of tiles to the next
const TAIL = 34;          // comet tail length in px
const SPEED = 0.085;      // px per ms
const HOT_SPEED = 0.26;

let comets = [];
let first = true;
let hot = null;
let startAt = 0;
const owner = new Map();  // branch path -> tile

// Layout box relative to the map; offset* ignores the entrance and hover transforms.
function box(el) {
  let l = 0, t = 0, n = el;
  while (n && n !== map) { l += n.offsetLeft; t += n.offsetTop; n = n.offsetParent; }
  const w = el.offsetWidth, h = el.offsetHeight;
  return { l, t, w, h, r: l + w, b: t + h, cx: l + w / 2, cy: t + h / 2 };
}

// Polyline with rounded elbows.
function rounded(points, radius) {
  const pts = points.map(([x, y]) => [Math.round(x), Math.round(y)])
    .filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const l1 = Math.hypot(x1 - x0, y1 - y0), l2 = Math.hypot(x2 - x1, y2 - y1);
    const k = Math.min(radius, l1 / 2, l2 / 2);
    d += ` L${x1 + (x0 - x1) / l1 * k},${y1 + (y0 - y1) / l1 * k}`;
    d += ` Q${x1},${y1} ${x1 + (x2 - x1) / l2 * k},${y1 + (y2 - y1) / l2 * k}`;
  }
  const end = pts[pts.length - 1];
  return `${d} L${end[0]},${end[1]}`;
}

// Desktop: straight wires to the side tiles, a stem and a bus to the lower row.
function desktopTraces() {
  const c = box(core);
  const w = box(word);
  const gap = Math.round(c.w * 0.24);  // breathing room around the bare logo
  const traces = [];
  const joints = [];
  const stemTop = w.b + 12;
  for (const tile of tiles) {
    const n = box(tile);
    if (n.t < c.cy && n.b > c.cy) {
      const fromX = n.r <= c.l ? c.l - gap : c.r + gap;
      const toX = n.r <= c.l ? n.r : n.l;
      traces.push({ tile, pts: [[fromX, c.cy], [toX, c.cy]], delay: DRAW_START });
    } else if (n.t > c.b) {
      const bus = stemTop + (n.t - stemTop) * 0.55;
      traces.push({ tile, pts: [[c.cx, stemTop], [c.cx, bus], [n.cx, bus], [n.cx, n.t]], delay: DRAW_START + LOWER_DELAY });
      if (Math.abs(n.cx - c.cx) > 1) joints.push([c.cx, bus]);
    }
  }
  return { traces, joints: joints.slice(0, 1) };
}

// Phones and portrait: a stem from the name to the first row, a bus from a single tile to the two
// under it, and a straight link from each tile to the one below; each row draws once the one above is in.
function gridTraces() {
  const w = box(word);
  const c = box(core);
  const rows = [];
  for (const t of [...tiles].sort((a, b) => box(a).t - box(b).t || box(a).l - box(b).l)) {
    const b = box(t);
    const row = rows.find((r) => Math.abs(r.t - b.t) < 8);
    row ? row.tiles.push(t) : rows.push({ t: b.t, tiles: [t] });
  }
  const traces = [];
  const joints = [];
  let at = DRAW_START;
  rows.forEach((row, i) => {
    const ms = i === 0 ? DRAW_MS : LINK_MS;
    for (const t of row.tiles) {
      const n = box(t);
      if (i === 0) { traces.push({ tile: t, pts: [[c.cx, w.b + 12], [c.cx, n.t]], delay: at, ms }); continue; }
      const above = rows[i - 1].tiles.map(box);
      const from = above.length === 1 ? above[0] : above.reduce((a, b) => (Math.abs(b.cx - n.cx) < Math.abs(a.cx - n.cx) ? b : a));
      if (Math.abs(from.cx - n.cx) < 2) traces.push({ tile: t, pts: [[n.cx, from.b], [n.cx, n.t]], delay: at, ms });
      else {
        const bus = from.b + (n.t - from.b) / 2;
        traces.push({ tile: t, pts: [[from.cx, from.b], [from.cx, bus], [n.cx, bus], [n.cx, n.t]], delay: at, ms });
        if (!joints.length || joints.at(-1)[1] !== bus) joints.push([from.cx, bus]);
      }
    }
    at += ms - 80;
  });
  return { traces, joints };
}

function el(name, attrs) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

// Reveal each tile when its branch arrives; CSS delays cover no-JS.
function revealAt(tile, ms) {
  tile.style.animationDelay = `${Math.round(ms)}ms, 0s, 0s`;
}


function build() {
  const animate = first && !reduce.matches;
  const { traces, joints } = desktop.matches ? desktopTraces() : gridTraces();
  svg.replaceChildren();
  comets = [];
  owner.clear();

  for (const tr of traces) {
    const path = el('path', { d: rounded(tr.pts, 12), class: `tr${tr.tile === hot ? ' hot' : ''}` });
    svg.append(path);
    owner.set(path, tr.tile);
    const len = path.getTotalLength();
    const [ex, ey] = tr.pts[tr.pts.length - 1];
    const ms = tr.ms || DRAW_MS;
    const done = tr.delay + ms;

    if (animate) {
      path.style.strokeDasharray = `${len}`;
      path.style.strokeDashoffset = `${len}`;
      path.style.transition = `stroke-dashoffset ${ms}ms cubic-bezier(.45,.05,.25,1) ${tr.delay}ms, stroke .35s ease, opacity .35s ease`;
      requestAnimationFrame(() => requestAnimationFrame(() => { path.style.strokeDashoffset = '0'; }));
      revealAt(tr.tile, done - 200);
    }

    const end = el('circle', { cx: Math.round(ex), cy: Math.round(ey), r: 2.6, class: 'end' });
    const ring = el('circle', { cx: Math.round(ex), cy: Math.round(ey), r: 3, class: 'ring' });
    if (animate) end.style.setProperty('--d', `${done - 80}ms`);
    else end.style.animation = 'none';
    svg.append(ring, end);

    if (reduce.matches) continue;
    const count = Math.max(1, Math.round(len / 420));
    const tl = Math.min(TAIL, len * 0.6);
    const cycle = Math.max(len, 300);  // short links rest between runs instead of flickering
    for (let j = 0; j < count; j++) {
      const tail = el('path', { d: path.getAttribute('d'), class: 'comet', 'stroke-dasharray': `${tl} ${len + TAIL}`, opacity: 0 });
      const halo = el('circle', { r: 5, class: 'halo', opacity: 0 });
      const head = el('circle', { r: 1.8, class: 'head', opacity: 0 });
      svg.append(tail, halo, head);
      const ys = tr.pts.map((p) => p[1]);
      comets.push({ y0: Math.min(...ys), y1: Math.max(...ys), path, len, tl, cycle, tile: tr.tile, tail, halo, head, ring, t: (cycle / count) * j + Math.random() * cycle * 0.3 });
    }
  }
  for (const [x, y] of joints) svg.append(el('circle', { cx: Math.round(x), cy: Math.round(y), r: 3, class: 'jn' }));

  if (animate) startAt = performance.now() + Math.max(...traces.map((t) => t.delay + (t.ms || DRAW_MS))) + 300;
  first = false;
}

// A comet reaching its tile flashes the joint where the branch meets it.
function arrive(c) {
  c.ring.animate(
    [{ opacity: 0.8, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(3.4)' }],
    { duration: 800, easing: 'cubic-bezier(.2,.6,.3,1)' },
  );
}

let last = 0;
function frame(now) {
  const dt = last ? Math.min(64, now - last) : 16;
  last = now;
  if (now >= startAt) {
    const top = map.getBoundingClientRect().top;
    for (const c of comets) {
      if (c.y0 + top > innerHeight + 40 || c.y1 + top < -40) continue;
      const next = c.t + dt * (c.tile === hot ? HOT_SPEED : SPEED);
      if (c.t < c.len && next >= c.len) arrive(c);
      c.t = next % c.cycle;
      const p = c.path.getPointAtLength(Math.min(c.t, c.len));
      const edge = Math.min(24, c.len / 3);
      const fade = c.t > c.len ? 0 : Math.max(0, Math.min(1, c.t / edge, (c.len - c.t) / edge));
      c.tail.setAttribute('stroke-dashoffset', c.tl - c.t);
      c.tail.setAttribute('opacity', fade * 0.55);
      c.head.setAttribute('cx', p.x); c.head.setAttribute('cy', p.y); c.head.setAttribute('opacity', fade);
      c.halo.setAttribute('cx', p.x); c.halo.setAttribute('cy', p.y); c.halo.setAttribute('opacity', fade * 0.22);
    }
  }
  requestAnimationFrame(frame);
}

// Hovering a tile lights its branch and speeds up its comets.
function setHot(tile) {
  hot = tile;
  map.classList.toggle('has-hot', Boolean(tile));
  for (const [path, t] of owner) path.classList.toggle('hot', Boolean(tile) && t === tile);
}

for (const tile of tiles) {
  tile.addEventListener('pointerenter', () => setHot(tile));
  tile.addEventListener('pointerleave', () => setHot(null));
  tile.addEventListener('focus', () => setHot(tile));
  tile.addEventListener('blur', () => setHot(null));
}

// Only tiles on screen animate their drawings.
const io = new IntersectionObserver((entries) => {
  for (const e of entries) e.target.classList.toggle('live', e.isIntersecting);
});
for (const t of tiles) io.observe(t);


// The dots light up around the pointer or finger, and drift a little with the mouse.
let spotTimer = 0;
function spot(x, y) {
  const r = map.getBoundingClientRect();
  map.style.setProperty('--px', `${Math.round(x - r.left)}px`);
  map.style.setProperty('--py', `${Math.round(y - r.top)}px`);
  map.style.setProperty('--spot', '1');
  clearTimeout(spotTimer);
  spotTimer = setTimeout(() => map.style.setProperty('--spot', '0'), 1400);
  if (!reduce.matches && desktop.matches) {
    map.style.setProperty('--mx', ((x - r.left) / r.width - 0.5).toFixed(3));
    map.style.setProperty('--my', ((y - r.top) / r.height - 0.5).toFixed(3));
  }
}
map.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') spot(e.clientX, e.clientY); });
map.addEventListener('pointerleave', () => map.style.setProperty('--spot', '0'));

let queued = false;
let layoutKey = '';
const relayout = () => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    const key = [core, word, ...tiles].map((e) => { const b = box(e); return `${b.l},${b.t},${b.w},${b.h}`; }).join(';');
    if (key === layoutKey) return;
    layoutKey = key;
    build();
  });
};
const ro = new ResizeObserver(relayout);
ro.observe(map);
for (const t of tiles) ro.observe(t);
desktop.addEventListener('change', relayout);
requestAnimationFrame(frame);
