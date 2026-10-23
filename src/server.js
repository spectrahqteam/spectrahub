// Minimal HTTP server: static shell + health endpoints. No dependencies.
import { createServer as httpCreateServer } from 'node:http';
import { readFile, readdir, stat, statfs } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { existsSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { cpus, freemem, homedir, hostname, loadavg, release, totalmem, type as osType, uptime } from 'node:os';
import { fileURLToPath } from 'node:url';
import { VERSION, paths, defaultDir, readConfig, writeConfig } from './config.js';
import { authCookie, authorize, cookieToken, createPairing, redeemPairing, runLine, terminalInfo } from './terminal.js';
import { models, scan } from './agents.js';
import { sessionUsage } from './usage.js';
import { connections, saveKey, setMode } from './connections.js';
import * as github from './github.js';
import * as gmail from './gmail.js';
import {
  attachFile, createProject, createSession, deleteProject, deleteSession, getSession, listProjects, listSessions, recentFiles, runs, saveUpload,
  send as sendTo, sessionFile, stop as stopRun, subscribe, updateProject, updateSession,
} from './sessions.js';

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
  '.webmanifest': 'application/manifest+json; charset=utf-8',
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

function readRaw(req, limit) {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { fail(Object.assign(new Error('too large'), { code: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
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

// GitHub, read only: accounts the owner connected, and what each of their tokens can see.
//   /api/github                                   GET list · POST {token, label} connect
//   /api/github/:acc                              DELETE disconnect
//   /api/github/:acc/repos                        GET every repository the token sees
//   /api/github/:acc/repo/:owner/:name[/:what]    GET details+README · contents · commits · pulls · issues · raw
async function githubRoute(req, res, url, dir, json) {
  const [acc, what, owner, name, sub] = url.pathname.split('/').slice(3).filter(Boolean).map(decodeURIComponent);
  const q = url.searchParams;
  try {
    if (!acc && req.method === 'GET') return json(200, { accounts: github.accounts(dir) });
    if (!acc && req.method === 'POST') {
      let b = {};
      try { b = JSON.parse(await readBody(req)); } catch { return send(res, 400, 'bad request'); }
      return json(201, { account: await github.connect(dir, b) });
    }
    if (acc && !what && req.method === 'DELETE') { github.disconnect(dir, acc); return json(200, { ok: true }); }
    if (req.method !== 'GET') return send(res, 405, 'method not allowed');
    if (what === 'repos' && !owner) return json(200, { repos: await github.repos(dir, acc) });
    if (what === 'repo' && owner && name) {
      if (!sub) return json(200, { repo: await github.repo(dir, acc, owner, name) });
      if (sub === 'contents') return json(200, await github.contents(dir, acc, owner, name, q.get('path'), q.get('ref')));
      if (sub === 'commits') return json(200, { commits: await github.commits(dir, acc, owner, name, q.get('ref')) });
      if (sub === 'pulls') return json(200, { pulls: await github.pulls(dir, acc, owner, name) });
      if (sub === 'issues') return json(200, { issues: await github.issues(dir, acc, owner, name) });
      if (sub === 'raw') {
        const f = await github.raw(dir, acc, owner, name, q.get('path'), q.get('ref'));
        res.writeHead(200, { 'Content-Type': f.type, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'" });
        return res.end(f.body);
      }
    }
    return send(res, 404, 'not found');
  } catch (e) {
    return json(e instanceof github.GitHubError ? e.status : 500, { error: e instanceof github.GitHubError ? e.message : 'błąd serwera' });
  }
}

// Gmail, read only: mailboxes the owner connected with app passwords.
//   /api/gmail                                    GET list · POST {email, password, label} connect
//   /api/gmail/:acc                               DELETE disconnect
//   /api/gmail/:acc/boxes                         GET folders and labels
//   /api/gmail/:acc/messages?box=&before=&q=      GET newest first, a page at a time, or a Gmail search
//   /api/gmail/:acc/message/:uid[/part/:id]?box=  GET one message · one attachment's bytes
async function gmailRoute(req, res, url, dir, json) {
  const [acc, what, uid, sub, pid] = url.pathname.split('/').slice(3).filter(Boolean).map(decodeURIComponent);
  const q = url.searchParams;
  const box = q.get('box') || 'INBOX';
  try {
    if (!acc && req.method === 'GET') return json(200, { accounts: gmail.accounts(dir) });
    if (!acc && req.method === 'POST') {
      let b = {};
      try { b = JSON.parse(await readBody(req)); } catch { return send(res, 400, 'bad request'); }
      return json(201, { account: await gmail.connect(dir, b) });
    }
    if (acc && !what && req.method === 'DELETE') { gmail.disconnect(dir, acc); return json(200, { ok: true }); }
    if (req.method !== 'GET') return send(res, 405, 'method not allowed');
    if (what === 'boxes') return json(200, { boxes: await gmail.boxes(dir, acc) });
    if (what === 'messages') return json(200, await gmail.messages(dir, acc, { box, before: q.get('before'), q: (q.get('q') ?? '').slice(0, 300) }));
    if (what === 'message' && /^\d+$/.test(uid ?? '')) {
      if (!sub) return json(200, { message: await gmail.message(dir, acc, { box, uid }) });
      if (sub === 'part' && pid) {
        const f = await gmail.attachment(dir, acc, { box, uid, part: pid });
        const image = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(f.type);
        res.writeHead(200, {
          'Content-Type': image ? f.type : 'application/octet-stream', 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': `${image ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
          'Content-Security-Policy': "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
        });
        return res.end(f.data);
      }
    }
    return send(res, 404, 'not found');
  } catch (e) {
    return json(e instanceof gmail.GmailError ? e.status : 500, { error: e instanceof gmail.GmailError ? e.message : 'błąd serwera' });
  }
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
    if (!token) return json(401, { error: 'link used or expired' });
    res.setHeader('Set-Cookie', authCookie(req, token));
    return json(200, { token });
  }
  if (url.pathname === '/api/terminal/logout' && req.method === 'POST') {
    res.setHeader('Set-Cookie', authCookie(req, null));
    return json(200, { ok: true });
  }
  const auth = authorize(req, dir);
  if (auth === 'disabled') return send(res, 403, JSON.stringify({ error: 'terminal disabled', hint: 'spectrahub token' }), 'application/json; charset=utf-8');
  if (auth !== 'ok') return send(res, 401, JSON.stringify({ error: 'unauthorized' }), 'application/json; charset=utf-8');
  if (url.pathname === '/api/agents' && req.method === 'GET') {
    return json(200, { agents: await scan({ fresh: url.searchParams.has('fresh') }) });
  }
  if (url.pathname === '/api/models' && req.method === 'GET') {
    return json(200, { models: await models({ fresh: url.searchParams.has('fresh') }) });
  }
  if (url.pathname === '/api/runs' && req.method === 'GET') return json(200, { runs: runs({ ...config, dir }) });
  if (url.pathname === '/api/files/recent' && req.method === 'GET') return json(200, { files: recentFiles({ ...config, dir }) });
  if (url.pathname === '/api/system' && req.method === 'GET') return json(200, await systemInfo(config));
  if (url.pathname === '/api/fs/dirs' && req.method === 'GET') return json(200, await listDirs(url.searchParams.get('path')));
  if (url.pathname === '/api/settings' && req.method === 'PATCH') {
    let b = {};
    try { b = JSON.parse(await readBody(req)); } catch { return send(res, 400, 'bad request'); }
    const name = String(b.displayName ?? '').trim().slice(0, 40);
    const saved = readConfig(dir) ?? {};
    saved.displayName = name || null;
    writeConfig(dir, saved);
    config.displayName = saved.displayName;  // the running server sees it at once
    return json(200, { displayName: saved.displayName });
  }
  // How each agent signs in: subscription, API key or auto. Keys go in, never out.
  if (url.pathname === '/api/connections' && req.method === 'GET') return json(200, { agents: await connections({ ...config, dir }) });
  const conn = /^\/api\/connections\/(\w+)(\/key)?$/.exec(url.pathname);
  if (conn && req.method === 'PATCH') {
    let b = {};
    try { b = JSON.parse(await readBody(req)); } catch { return send(res, 400, 'bad request'); }
    const r = conn[2] ? saveKey(dir, conn[1], b.key) : setMode(dir, config, conn[1], b.mode);
    return json(r.error ? 400 : 200, r);
  }
  if (url.pathname.startsWith('/api/github')) return githubRoute(req, res, url, dir, json);
  if (url.pathname.startsWith('/api/gmail')) return gmailRoute(req, res, url, dir, json);
  if (url.pathname.startsWith('/api/projects')) return projectRoute(req, res, url, { ...config, dir }, json);
  if (url.pathname.startsWith('/api/sessions')) return sessionRoute(req, res, url, { ...config, dir }, json);
  if (url.pathname === '/api/terminal/pair/new' && req.method === 'POST') {
    return json(200, { code: createPairing(dir), ttlMinutes: 15 });
  }
  if (url.pathname === '/api/terminal/info' && req.method === 'GET') {
    // A device that signed in with the token gets the cookie too; one signed in by the cookie
    // gets the token back, so the page can keep working where storage was wiped.
    const viaCookie = !String(req.headers.authorization ?? '').startsWith('Bearer ');
    const token = viaCookie ? cookieToken(req) : String(req.headers.authorization).slice(7).trim();
    res.setHeader('Set-Cookie', authCookie(req, token));
    return json(200, { ...terminalInfo(config), ...(viaCookie ? { token } : {}) });
  }
  if (url.pathname === '/api/terminal/run' && req.method === 'POST') {
    let line;
    try { line = JSON.parse(await readBody(req)).line; } catch { return send(res, 400, 'bad request'); }
    if (typeof line !== 'string') return send(res, 400, 'bad request');
    return runLine(config, line, res);
  }
  return send(res, 404, 'not found');
}

// This server, measured now: the VPS home shows it.
async function systemInfo(config) {
  let disk = null;
  try { const f = await statfs('/'); disk = { total: f.blocks * f.bsize, free: f.bavail * f.bsize }; } catch { /* not supported */ }
  let os = null;
  try { os = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(await readFile('/etc/os-release', 'utf8'))?.[1] ?? null; } catch { /* not linux */ }
  return {
    host: hostname(), os: os ?? `${osType()} ${release()}`, uptime: Math.round(uptime()), load: loadavg().map((x) => Math.round(x * 100) / 100),
    cpus: cpus().length, memory: { total: totalmem(), free: freemem() }, disk, version: VERSION, at: new Date().toISOString(),
  };
}

// Folders under a path, for choosing where agents work. Directories only, nothing is read.
async function listDirs(path) {
  const base = path && isAbsolute(path) ? normalize(path) : homedir();
  let entries = [];
  try { entries = await readdir(base, { withFileTypes: true }); } catch { return { path: base, parent: dirname(base), dirs: [], error: 'nie można otworzyć' }; }
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort((a, b) => a.localeCompare(b)).slice(0, 300);
  return { path: base, parent: base === '/' ? null : dirname(base), dirs, home: homedir() };
}

// Folders for sessions.
async function projectRoute(req, res, url, config, json) {
  const id = url.pathname.split('/').filter(Boolean)[2];
  const body = async () => { try { return JSON.parse(await readBody(req)); } catch { return {}; } };
  if (!id && req.method === 'GET') return json(200, { projects: listProjects(config) });
  if (!id && req.method === 'POST') { const b = await body(); const r = createProject(config, b.name, b); return r.error ? json(400, r) : json(201, r); }
  if (id && req.method === 'PATCH') { const r = updateProject(config, id, await body()); return r.error ? json(r.code ?? 400, r) : json(200, r); }
  if (id && req.method === 'DELETE') { const r = deleteProject(config, id); return r.error ? json(r.code ?? 400, r) : json(200, r); }
  return send(res, 405, 'method not allowed');
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
  if (action === 'usage' && req.method === 'GET') return json(200, await sessionUsage(s));
  if (!action && req.method === 'PATCH') { const r = updateSession(config, id, (await body()) ?? {}); return r.error ? json(r.code ?? 400, r) : json(200, r); }
  if (!action && req.method === 'DELETE') { const r = deleteSession(config, id); return r.error ? json(r.code ?? 400, r) : json(200, r); }
  if (action === 'attach' && req.method === 'POST') {
    const b = (await body()) ?? {};
    const r = attachFile(config, id, { path: b.path, from: b.from });
    return r.error ? json(r.code ?? 400, r) : json(201, r);
  }
  if (action === 'files' && req.method === 'POST' && !parts[4]) {
    let data;
    try { data = await readRaw(req, 25 * 1024 * 1024); } catch (e) { return json(e.code ?? 400, { error: e.message }); }
    let name = 'plik';
    try { name = decodeURIComponent(req.headers['x-file-name'] ?? 'plik'); } catch { /* keep default */ }
    const r = saveUpload(config, id, { name, type: req.headers['content-type'], data });
    return r.error ? json(r.code ?? 400, r) : json(201, r);
  }
  if (action === 'files' && req.method === 'GET' && parts[4]) {
    const r = sessionFile(config, id, parts[4]);
    if (r.error) return json(r.code ?? 400, r);
    const name = encodeURIComponent(r.file.name);
    res.writeHead(200, {
      'Content-Type': r.file.type.startsWith('text/') || r.file.type === 'application/json' ? `${r.file.type}; charset=utf-8` : r.file.type,
      'Content-Length': r.file.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${url.searchParams.has('download') ? 'attachment' : 'inline'}; filename*=UTF-8''${name}`,
      'Content-Security-Policy': "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'",
    });
    return createReadStream(r.path).pipe(res);
  }
  if (action === 'send' && req.method === 'POST') {
    const b = await body();
    if (!b || typeof b.text !== 'string' || !b.text.trim() || !Array.isArray(b.to)) return send(res, 400, 'bad request');
    const r = await sendTo(config, id, { to: b.to, text: b.text.slice(0, 20000), attachments: Array.isArray(b.attachments) ? b.attachments.slice(0, 20) : [] });
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
    if (/^\/api\/(terminal\/|agents$|models$|runs$|settings$|system$|connections(\/|$)|github(\/|$)|gmail(\/|$)|fs\/dirs$|files\/recent$|projects(\/|$)|sessions(\/|$))/.test(url.pathname)) return terminalRoute(req, res, url, config);
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
