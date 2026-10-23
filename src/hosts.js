// Host definitions belong to the installation, never to the product repository.
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { homedir, hostname, loadavg, totalmem, freemem, uptime, cpus, release } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { spawn } from 'node:child_process';

const fail = (message, code = 400) => { throw Object.assign(new Error(message), { code }); };
const hostFile = (config) => join(config.dir, 'hosts.json');
const LOCAL = { id: 'local', kind: 'local', label: 'This server', address: 'localhost', services: [] };
const ADDRESS = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,252}$/;
const USER = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/;
const SERVICE = /^[a-zA-Z0-9][a-zA-Z0-9@_.:-]{0,127}$/;

function stored(config) {
  if (!existsSync(hostFile(config))) return [];
  const data = JSON.parse(readFileSync(hostFile(config), 'utf8'));
  if (!Array.isArray(data)) fail('invalid hosts file', 500);
  return data;
}

function persist(config, hosts) {
  mkdirSync(config.dir, { recursive: true, mode: 0o700 });
  const file = hostFile(config);
  const tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(hosts, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}

function clean(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('host object required');
  if (body.kind && body.kind !== 'ssh') fail('only SSH hosts can be added');
  const address = String(body.address ?? '').trim();
  if (!ADDRESS.test(address)) fail('a hostname, IP address or SSH alias is required');
  const user = String(body.user ?? '').trim();
  if (user && !USER.test(user)) fail('invalid SSH user');
  // An omitted port preserves the port of an existing ~/.ssh/config alias.
  const port = body.port == null || body.port === '' ? null : Number(body.port);
  if (port != null && (!Number.isInteger(port) || port < 1 || port > 65535)) fail('invalid SSH port');
  const label = String(body.label || address).trim();
  if (!label || label.length > 80 || /[\x00-\x1f\x7f]/.test(label)) fail('invalid host label');
  const identityFile = String(body.identityFile ?? '').trim();
  if (identityFile && (!isAbsolute(identityFile) || /[\x00-\x1f\x7f]/.test(identityFile) || identityFile.length > 4096)) fail('identityFile must be an absolute path on this server');
  const services = body.services ?? [];
  if (!Array.isArray(services) || services.length > 16 || services.some((s) => typeof s !== 'string' || !SERVICE.test(s))) fail('invalid service names');
  return { kind: 'ssh', label, address, user, port, identityFile, services: [...new Set(services)] };
}

export function listHosts(config) {
  return [{ ...LOCAL, label: config.hosts?.localLabel || LOCAL.label, services: config.hosts?.services ?? [] }, ...stored(config)];
}

export function getHost(config, id = 'local') {
  const host = listHosts(config).find((h) => h.id === id);
  if (!host) fail('no such host', 404);
  return host;
}

export function saveHost(config, body, id = null) {
  if (id === 'local') fail('the local host cannot be replaced');
  const hosts = stored(config);
  const index = id == null ? -1 : hosts.findIndex((h) => h.id === id);
  if (id != null && index < 0) fail('no such host', 404);
  if (index < 0 && hosts.length >= 32) fail('at most 32 SSH hosts are allowed');
  const host = { id: id ?? randomUUID(), ...clean(index < 0 ? body : { ...hosts[index], ...body }), updatedAt: new Date().toISOString() };
  if (index < 0) hosts.push(host); else hosts[index] = host;
  persist(config, hosts);
  return host;
}

export function deleteHost(config, id) {
  if (id === 'local') fail('the local host cannot be deleted');
  const hosts = stored(config);
  if (!hosts.some((h) => h.id === id)) fail('no such host', 404);
  persist(config, hosts.filter((h) => h.id !== id));
}

// argv has no shell interpolation. The target cannot begin with an option.
export function sshArgs(host, { tty = false, command = null } = {}) {
  const h = clean(host);
  const args = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3'];
  if (tty) args.push('-tt'); else args.push('-T');
  if (h.port != null) args.push('-p', String(h.port));
  if (h.user) args.push('-l', h.user);
  if (h.identityFile) args.push('-i', h.identityFile);
  args.push('--', h.address);
  if (command != null) args.push(command);
  return args;
}

const quote = (value) => `'${String(value).replace(/'/g, `'"'"'`)}'`;

export function terminalCommand(config, hostId = 'local', cwd = null) {
  const host = getHost(config, hostId);
  if (cwd != null && (typeof cwd !== 'string' || !isAbsolute(cwd) || /[\x00-\x1f\x7f]/.test(cwd) || cwd.length > 4096)) fail('cwd must be an absolute directory');
  if (host.kind === 'ssh') {
    const command = cwd ? `cd -- ${quote(cwd)} && exec "\${SHELL:-/bin/sh}" -l` : 'exec "${SHELL:-/bin/sh}" -l';
    return { command: 'ssh', args: sshArgs(host, { tty: true, command }), cwd: homedir(), host };
  }
  const directory = cwd || config.terminal?.cwd || homedir();
  try { if (!statSync(directory).isDirectory()) fail('cwd is not a directory'); } catch (e) { if (e.code === 400) throw e; fail('cwd is not an accessible directory'); }
  const shell = config.terminal?.shell || process.env.SHELL || '/bin/sh';
  if (!isAbsolute(shell) || /[\x00-\x1f\x7f]/.test(shell)) fail('invalid configured shell', 500);
  return { command: shell, args: ['-l'], cwd: directory, host };
}

function capture(command, args, { timeout = 15000, maxBytes = 256 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', size = 0, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    child.stdout.on('data', (chunk) => { size += chunk.length; if (size > maxBytes) child.kill('SIGKILL'); else out += chunk; });
    child.stderr.on('data', (chunk) => { if (err.length < 4096) err += chunk; });
    child.on('error', (error) => { clearTimeout(timer); reject(Object.assign(error, { code: 502 })); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(Object.assign(new Error('host did not answer in time'), { code: 504 }));
      if (size > maxBytes) return reject(Object.assign(new Error('host response exceeded the limit'), { code: 502 }));
      if (code !== 0) return reject(Object.assign(new Error(err.trim() || out.trim().slice(0, 4096) || `host command exited ${code}`), { code: 502 }));
      resolve(out);
    });
  });
}

// A fixed, read-only collector. Only validated service names are supplied as JSON.
const COLLECTOR = `import json,os,platform,shutil,socket,subprocess,sys
mem={}
with open('/proc/meminfo') as f:
 for line in f:
  k,v=line.split(':',1); mem[k]=int(v.split()[0])*1024
with open('/proc/uptime') as f: up=float(f.read().split()[0])
disk=shutil.disk_usage('/')
services=[]
for unit in json.loads(sys.argv[1]):
 try:
  p=subprocess.run(['systemctl','is-active',unit],capture_output=True,text=True,timeout=3)
  services.append({'name':unit,'state':p.stdout.strip() or 'unknown'})
 except Exception: services.append({'name':unit,'state':'unavailable'})
print(json.dumps({'hostname':socket.gethostname(),'os':platform.system(),'release':platform.release(),'cpus':os.cpu_count(),'load':list(os.getloadavg()),'uptime':up,'memory':{'total':mem['MemTotal'],'free':mem.get('MemAvailable',mem.get('MemFree',0))},'disk':{'total':disk.total,'free':disk.free,'used':disk.used},'services':services}))`;

export async function hostStats(config, id = 'local') {
  const host = getHost(config, id);
  if (host.kind === 'ssh') {
    const command = `python3 -c ${quote(COLLECTOR)} ${quote(JSON.stringify(host.services ?? []))}`;
    const output = await capture('ssh', sshArgs(host, { command }));
    let metrics;
    try { metrics = JSON.parse(output); } catch { fail('host returned invalid metrics (Python 3 is required)', 502); }
    return { host, ...metrics, checkedAt: new Date().toISOString() };
  }
  const disk = await statfs('/');
  const services = await Promise.all((host.services ?? []).map(async (name) => {
    if (!SERVICE.test(name)) return { name, state: 'invalid' };
    try { return { name, state: (await capture('systemctl', ['is-active', name], { timeout: 4000 })).trim() }; }
    catch (error) { return { name, state: /inactive|failed/.exec(error.message)?.[0] ?? 'unavailable' }; }
  }));
  return { host, hostname: hostname(), os: process.platform, release: release(), cpus: cpus().length, load: loadavg(), uptime: uptime(), memory: { total: totalmem(), free: freemem() }, disk: { total: disk.blocks * disk.bsize, free: disk.bavail * disk.bsize, used: (disk.blocks - disk.bfree) * disk.bsize }, services, checkedAt: new Date().toISOString() };
}
