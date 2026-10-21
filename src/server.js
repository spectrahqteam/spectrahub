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

export function createServer(config) {
  return httpCreateServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health' || url.pathname === '/api/health') {
      const body = JSON.stringify(healthBody(config));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(body);
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
