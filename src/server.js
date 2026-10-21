// Minimal HTTP server: static shell + health endpoints. No dependencies.
import { createServer as httpCreateServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION, paths, defaultDir } from './config.js';
import { authorize, createPairing, redeemPairing, runLine, terminalInfo } from './terminal.js';
import { scan } from './agents.js';
import { createSession, getSession, listSessions, send as sendTo, stop as stopRun, subscribe } from './sessions.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const WEB = join(ROOT, 'web');
const STARTED_AT = new Date();

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function healthBody(config) {
  const p = paths(config.dir);
  return {
    status: 'ok',
    product: 'spectrahub',
    version: VERSION,
    node: process.version,
    pid: process.pid,
    startedAt: STARTED_AT.toISOString(),
    uptimeSeconds: Math.round((Date.now() - STARTED_AT.getTime()) / 1000),
    configDir: p.dir,
    dataDir: existsSync(p.data) ? p.data : null,
    owner: config.owner ?? null,
  };
}

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  const target = resolve(join(WEB, normalize(rel)));
  if (!target.startsWith(WEB + sep) && target !== WEB) return send(res, 403, 'forbidden');
  let file = target;
  let info = await stat(file).catch(() => null);
  if (!info && !extname(file)) {  // /terminal → terminal.html
    file += '.html';
    info = await stat(file).catch(() => null);
  }
  if (!info) return send(res, 404, 'not found');
  if (info.isDirectory()) return serveStatic(res, join(urlPath, 'index.html'));
  try {
    send(res, 200, await readFile(file), TYPES[extname(file)] ?? 'application/octet-stream');
  } catch {
    send(res, 404, 'not found');
  }
}


// Humans who open /health in a browser get a readable page; tools still get JSON.
function healthPage(data) {
  const rows = Object.entries(data)
    .map(([k, v]) => `<tr><th>${k}</th><td>${String(v)}</td></tr>`)
    .join('');
  return `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SpectraHub — health</title>
<style>
body{margin:0;min-height:100dvh;background:#0a0a0a;color:#ded9d4;
  font-family:"DejaVu Sans Mono",ui-monospace,Menlo,monospace;font-size:13px;
  display:flex;align-items:center;justify-content:center;padding:22px}
.card{width:min(560px,100%);border:1px solid #201d1a;border-radius:12px;background:#0b0a0a;overflow:hidden}
header{height:38px;display:flex;align-items:center;gap:7px;padding:0 14px;background:#100e0d;border-bottom:1px solid #201d1a}
header i{width:11px;height:11px;border-radius:50%;display:block}
header i:nth-child(1){background:#ff5f57}header i:nth-child(2){background:#febc2e}header i:nth-child(3){background:#28c840}
header span{margin:0 auto;font-size:10.5px;color:#6b6560}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:9px 14px;border-bottom:1px solid #171614;font-weight:400;vertical-align:top}
th{color:#57524e;width:38%}
td{color:#ded9d4;word-break:break-all}
tr:last-child th,tr:last-child td{border-bottom:0}
.ok{color:#8fae8f}
footer{padding:12px 14px;border-top:1px solid #201d1a;display:flex;justify-content:space-between;font-size:10px}
a{color:#d97757;text-decoration:none}
</style></head><body>
<div class="card">
  <header><i></i><i></i><i></i><span>spectra — health</span></header>
  <table><tr><th>status</th><td class="ok">ok</td></tr>${rows}</table>
  <footer><span>to jest endpoint dla maszyn</span><a href="/">← wróć do startu</a></footer>
</div></body></html>`;
}

function readBody(req, limit = 4096) {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { fail(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

// Owner routes (terminal, agents, sessions): 403 until a token exists, 401 on a wrong one.
async function terminalRoute(req, res, url, config) {
  const dir = config.dir ?? defaultDir();
  const json = (code, body) => send(res, code, JSON.stringify(body), 'application/json; charset=utf-8');
  // A one-time code from a login link buys the token; no other route works without it.
  if (url.pathname === '/api/terminal/pair' && req.method === 'POST') {
    let code;
    try { code = JSON.parse(await readBody(req)).code; } catch { return send(res, 400, 'bad request'); }
    const token = redeemPairing(dir, code);
    return token ? json(200, { token }) : json(401, { error: 'link used or expired' });
  }
  const auth = authorize(req, dir);
  if (auth === 'disabled') return send(res, 403, JSON.stringify({ error: 'terminal disabled', hint: 'spectrahub token' }), 'application/json; charset=utf-8');
  if (auth !== 'ok') return send(res, 401, JSON.stringify({ error: 'unauthorized' }), 'application/json; charset=utf-8');
  if (url.pathname === '/api/agents' && req.method === 'GET') {
    return json(200, { agents: await scan({ fresh: url.searchParams.has('fresh') }) });
  }
  if (url.pathname.startsWith('/api/sessions')) return sessionRoute(req, res, url, { ...config, dir }, json);
  if (url.pathname === '/api/terminal/pair/new' && req.method === 'POST') {
    return json(200, { code: createPairing(dir), ttlMinutes: 15 });
  }
  if (url.pathname === '/api/terminal/info' && req.method === 'GET') {
    return send(res, 200, JSON.stringify(terminalInfo(config)), 'application/json; charset=utf-8');
  }
  if (url.pathname === '/api/terminal/run' && req.method === 'POST') {
    let line;
    try { line = JSON.parse(await readBody(req)).line; } catch { return send(res, 400, 'bad request'); }
    if (typeof line !== 'string') return send(res, 400, 'bad request');
    return runLine(config, line, res);
  }
  return send(res, 404, 'not found');
}

// Work sessions with agents. Events stream as SSE over a GET that carries the token header.
async function sessionRoute(req, res, url, config, json) {
  const body = async () => { try { return JSON.parse(await readBody(req, 64 * 1024)); } catch { return null; } };
  const parts = url.pathname.split('/').filter(Boolean);  // api, sessions, :id, :action
  const [, , id, action] = parts;
  if (!id) {
    if (req.method === 'GET') return json(200, { sessions: listSessions(config) });
    if (req.method === 'POST') {
      const b = await body();
      if (!b || !Array.isArray(b.agents)) return send(res, 400, 'bad request');
      const r = await createSession(config, b);
      return r.error ? json(400, r) : json(201, r);
    }
    return send(res, 405, 'method not allowed');
  }
  const s = getSession(config, id);
  if (!s) return json(404, { error: 'no such session' });
  if (!action && req.method === 'GET') return json(200, { session: s });
  if (action === 'send' && req.method === 'POST') {
    const b = await body();
    if (!b || typeof b.text !== 'string' || !b.text.trim() || !Array.isArray(b.to)) return send(res, 400, 'bad request');
    const r = await sendTo(config, id, { to: b.to, text: b.text.slice(0, 20000) });
    return r.error ? json(r.code ?? 400, r) : json(202, r);
  }
  if (action === 'stop' && req.method === 'POST') {
    const b = (await body()) ?? {};
    return json(200, { stopped: stopRun(config, id, b.agent) });
  }
  if (action === 'events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });
    const write = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    write({ type: 'snapshot', session: s });
    const off = subscribe(id, write);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => { off(); clearInterval(ping); });
    return;
  }
  return send(res, 404, 'not found');
}

export function createServer(config) {
  return httpCreateServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health' || url.pathname === '/api/health') {
      const payload = healthBody(config);
      const wantsHtml = (req.headers.accept ?? '').includes('text/html');
      if (wantsHtml && url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(healthPage(payload));
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(payload));
    }
    if (url.pathname === '/api/version') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ product: 'spectrahub', version: VERSION }));
    }
    if (/^\/api\/(terminal\/|agents$|sessions(\/|$))/.test(url.pathname)) return terminalRoute(req, res, url, config);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
    return serveStatic(res, url.pathname);
  });
}

export function start(config) {
  const { host, port } = config.server;
  const server = createServer(config);
  scan().catch(() => {});  // warm the agent scan so the first "start sesja" does not wait
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => ok(server));
  });
}
