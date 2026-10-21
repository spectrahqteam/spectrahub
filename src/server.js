// Minimal HTTP server: static shell + health endpoints. No dependencies.
import { createServer as httpCreateServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION, paths } from './config.js';

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
  try {
    const info = await stat(target);
    if (info.isDirectory()) return serveStatic(res, join(urlPath, 'index.html'));
    const body = await readFile(target);
    send(res, 200, body, TYPES[extname(target)] ?? 'application/octet-stream');
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
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
    return serveStatic(res, url.pathname);
  });
}

export function start(config) {
  const { host, port } = config.server;
  const server = createServer(config);
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => ok(server));
  });
}
