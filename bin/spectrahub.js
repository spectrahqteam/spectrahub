#!/usr/bin/env node
// spectrahub CLI: init, serve, status, doctor, service. Same commands for every install.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VERSION, defaultDir, paths, readConfig, writeConfig, newConfig } from '../src/config.js';
import { start } from '../src/server.js';
import { createPairing, ensureToken, loginLink, tokenPath } from '../src/terminal.js';

const PKG_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const cmd = args[0] ?? 'help';

function flag(name, fallback) {
  const i = args.indexOf('--' + name);
  if (i === -1) return fallback;
  const next = args[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

function need() {
  const dir = String(flag('dir', defaultDir()));
  const config = readConfig(dir);
  if (!config) {
    console.error(`no installation at ${dir}\nrun: spectrahub init`);
    process.exit(1);
  }
  return { dir, config: { ...config, dir } };
}

function unitPath(system) {
  return system
    ? '/etc/systemd/system/spectrahub.service'
    : join(homedir(), '.config', 'systemd', 'user', 'spectrahub.service');
}

function unitText({ dir, config, system }) {
  const bin = join(PKG_ROOT, 'bin', 'spectrahub.js');
  const lines = [
    '[Unit]',
    'Description=SpectraHub — self-hosted command center',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `Environment=SPECTRAHUB_HOME=${dir}`,
    `ExecStart=${process.execPath} ${bin} serve`,
    'Restart=always',
    'RestartSec=3',
  ];
  if (system) {
    lines.push('User=' + (process.env.SUDO_USER || userInfo().username));
  }
  lines.push('', '[Install]', 'WantedBy=' + (system ? 'multi-user.target' : 'default.target'), '');
  return lines.join('\n');
}

const commands = {
  help() {
    console.log(`spectrahub ${VERSION}

Usage: spectrahub <command> [options]

  init        create the install directory and config
              --dir PATH   (default ~/.spectrahub)
              --port N     (default 8787)
              --host ADDR  (default 127.0.0.1)
              --url URL    public address, used in the login link
  serve       run the server in the foreground
  status      print config, unit state and health of a running instance
  doctor      check the install and report every deviation
  service     install | uninstall the systemd unit
              --system     system-wide unit (needs root)
  attach      hand a file to a chat session: spectrahub attach FILE
              inside an agent run the session comes from SPECTRAHUB_SESSION;
              --session ID otherwise
  login       print a login link: open it and the browser is in (works once, 15 min)
              --ttl MIN    keep it valid longer, up to a week (still works once)
  token       print the owner token for the terminal (created on first use)
              --rotate     replace it; open sessions must log in again
  version     print version
`);
  },

  version() {
    console.log(VERSION);
  },

  async attach() {
    const { dir, config } = need();
    const file = args.slice(1).find((a) => !a.startsWith('--') && a !== flag('session', ''));
    const session = flag('session', process.env.SPECTRAHUB_SESSION);
    if (!file || typeof session !== 'string') {
      console.error('usage: spectrahub attach FILE [--session ID]   (SPECTRAHUB_SESSION is set inside agent runs)');
      process.exit(1);
    }
    const res = await fetch(`http://${config.server.host}:${config.server.port}/api/sessions/${session}/attach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ensureToken(dir)}` },
      body: JSON.stringify({ path: resolve(file), from: process.env.SPECTRAHUB_AGENT ?? 'agent' }),
    }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: e.message }) }));
    const body = await res.json();
    if (!res.ok) { console.error(`not attached: ${body.error ?? res.status}`); process.exit(1); }
    console.log(`attached: ${body.file.name} (${body.file.id})`);
  },

  login() {
    const { dir, config } = need();
    // --ttl MINUTES: keep the link valid longer (it still works once), up to a week
    const minutes = Math.min(Math.max(Number(flag('ttl', 15)) || 15, 1), 7 * 24 * 60);
    console.log(loginLink(config, createPairing(dir, minutes * 60_000)));
  },

  token() {
    const { dir } = need();
    const token = ensureToken(dir, { rotate: Boolean(flag('rotate', false)) });
    console.log(token);
    console.error(`stored in ${tokenPath(dir)} (owner only) — paste it into the terminal page once`);
  },

  init() {
    const dir = String(flag('dir', defaultDir()));
    const port = Number(flag('port', 8787));
    const host = String(flag('host', '127.0.0.1'));
    const existing = readConfig(dir);
    const config = existing ?? newConfig({ port, host });
    const url = flag('url', null);
    if (typeof url === 'string') config.publicUrl = url;
    const file = writeConfig(dir, config);
    ensureToken(dir);
    console.log(`installation: ${dir}`);
    console.log(`config:       ${file}`);
    console.log(`listen:       http://${config.server.host}:${config.server.port}`);
    console.log(`login link:   ${loginLink(config, createPairing(dir))}`);
    console.log('              open it in your browser within 15 minutes; it works once (new one: spectrahub login)');
    if (config.server.host !== '127.0.0.1') {
      console.log('warning: bound to a public address — put a reverse proxy with TLS in front');
    }
    console.log('');
    console.log('next:');
    console.log('  spectrahub serve            # try it in the foreground');
    console.log('  spectrahub service install  # run it as a service');
  },

  async serve() {
    const { config } = need();
    const port = flag('port', null);
    if (port) config.server.port = Number(port);
    const server = await start(config);
    import('../src/agents.js').then((m) => m.models({ wait: true })).catch(() => {});  // warm the model list (some CLIs are slow)
    const addr = `http://${config.server.host}:${config.server.port}`;
    console.log(`spectrahub ${VERSION} listening on ${addr}`);
    const stop = () => server.close(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  },

  status() {
    const { dir, config } = need();
    const unit = existsSync(unitPath(false)) ? unitPath(false) : existsSync(unitPath(true)) ? unitPath(true) : null;
    console.log(`version: ${VERSION}`);
    console.log(`home:    ${dir}`);
    console.log(`listen:  http://${config.server.host}:${config.server.port}`);
    console.log(`unit:    ${unit ?? 'not installed'}`);
    if (unit) {
      const active = spawnSync('systemctl', [unit.includes('/user/') ? '--user' : '--system', 'is-active', 'spectrahub'], { encoding: 'utf8' });
      console.log(`state:   ${(active.stdout || 'unknown').trim()}`);
    }
    const url = `http://${config.server.host}:${config.server.port}/health`;
    fetch(url).then(async (r) => {
      console.log(`health:  ${r.status} ${JSON.stringify(await r.json())}`);
    }).catch(() => console.log('health:  not reachable'));
  },

  async doctor() {
    const { dir, config } = need();
    const rows = [];
    const ok = (label, value, good) => rows.push([good ? 'ok  ' : 'FAIL', label, String(value)]);
    ok('node version', process.version, Number(process.versions.node.split('.')[0]) >= 20);
    ok('install dir', dir, existsSync(dir));
    ok('config file', paths(dir).config, existsSync(paths(dir).config));
    ok('web shell', join(PKG_ROOT, 'web', 'index.html'), existsSync(join(PKG_ROOT, 'web', 'index.html')));
    ok('data dir writable', paths(dir).data, existsSync(paths(dir).data));
    const unit = existsSync(unitPath(false)) ? unitPath(false) : existsSync(unitPath(true)) ? unitPath(true) : null;
    ok('systemd unit', unit ?? 'not installed', Boolean(unit));
    const health = await fetch(`http://${config.server.host}:${config.server.port}/health`).then((r) => r.status).catch(() => 0);
    ok('health endpoint', health || 'unreachable', health === 200);
    ok('bind address', config.server.host, true);
    ok('version', VERSION, true);
    for (const [mark, label, value] of rows) console.log(`${mark} ${label.padEnd(18)} ${value}`);
    const failed = rows.filter((r) => r[0] === 'FAIL').length;
    console.log('');
    console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
    process.exit(failed ? 1 : 0);
  },

  service() {
    const action = args[1] ?? 'install';
    const system = Boolean(flag('system', false));
    const { dir, config } = need();
    const unit = unitPath(system);
    if (action === 'install') {
      mkdirSync(resolve(unit, '..'), { recursive: true });
      writeFileSync(unit, unitText({ dir, config, system }));
      const sysctl = system ? ['--system'] : ['--user'];
      spawnSync('systemctl', [...sysctl, 'daemon-reload']);
      const enable = spawnSync('systemctl', [...sysctl, 'enable', '--now', 'spectrahub'], { encoding: 'utf8' });
      console.log(`unit:  ${unit}`);
      console.log(`state: ${(enable.stdout || enable.stderr || 'enabled').trim()}`);
      if (!system) {
        spawnSync('loginctl', ['enable-linger', userInfo().username]);
        console.log('hint:  user service enabled — survives logout via lingering');
      }
      console.log(`open:  http://${config.server.host}:${config.server.port}`);
      console.log(`login: ${loginLink(config, createPairing(dir))}  (once, 15 min)`);
    } else if (action === 'uninstall') {
      const sysctl = system ? ['--system'] : ['--user'];
      spawnSync('systemctl', [...sysctl, 'disable', '--now', 'spectrahub']);
      if (existsSync(unit)) unlinkSync(unit);
      spawnSync('systemctl', [...sysctl, 'daemon-reload']);
      console.log(`removed: ${unit}`);
    } else {
      console.error('usage: spectrahub service install|uninstall [--system]');
      process.exit(1);
    }
  },
};

const run = commands[cmd];
if (!run) {
  console.error(`unknown command: ${cmd}\n`);
  commands.help();
  process.exit(1);
}
await run();
