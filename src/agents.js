// Agent runtimes: find what is installed, run one turn, normalise the output into a few events.
// Every adapter keeps the runtime's own session, so the next turn continues the same conversation.
import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { basename, delimiter, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

// What the scanner looks for, on any server: commands on PATH, then any running systemd service
// (system or user) whose program belongs to the runtime's npm package — recognised by package
// name, not by path or unit name — then the usual global npm folders.
// `adapter: false` means we can see it but cannot drive it yet.
const RUNTIMES = [
  { id: 'claude', label: 'Claude Code', bins: ['claude'], adapter: true },
  { id: 'codex', label: 'Codex', bins: ['codex'], adapter: true },
  { id: 'openclaw', label: 'OpenClaw', bins: ['openclaw'], adapter: true },
  // DeepSeek Harness, also known as Hermes on some installs.
  { id: 'dsh', label: 'DeepSeek Harness', bins: ['dsh', 'deepseek-harness', 'hermes'], pkg: '@deepseek-ai/dsh',
    scripts: ['/usr/lib/node_modules/@deepseek-ai/dsh/lib/bin.js', '/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js'],
    adapter: true },
];

function which(bin) {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const p = join(dir, bin);
    try { accessSync(p, constants.X_OK); return p; } catch { /* next */ }
  }
  return null;
}

function run(bin, args, ms = 8000) {
  return new Promise((ok) => {
    execFile(bin, args, { timeout: ms, encoding: 'utf8' }, (err, stdout) => ok(err ? '' : stdout));
  });
}

// The npm package a script belongs to: the nearest package.json above it.
function packageOf(script) {
  for (let d = dirname(script), i = 0; i < 5; i++, d = dirname(d)) {
    try { return JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')).name ?? null; } catch { /* go up */ }
  }
  return null;
}

// Running services, system and user, each with how it starts: one systemctl call per scope.
async function runningUnits() {
  const units = [];
  for (const scope of ['--system', '--user']) {
    const names = (await run('systemctl', [scope, 'list-units', '--type=service', '--state=running', '--no-legend', '--plain']))
      .split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((n) => n?.endsWith('.service'));
    if (!names.length) continue;
    const show = await run('systemctl', [scope, 'show', ...names, '-p', 'Id', '-p', 'ExecStart', '-p', 'WorkingDirectory', '-p', 'Environment', '-p', 'EnvironmentFiles'], 15000);
    for (const block of show.split(/\n\n+/)) if (block.trim()) units.push(block);
  }
  return units;
}

// systemd unit → how it starts the agent: the node script, its folder, environment and env file.
function fromUnit(show, pkg) {
  const exec = /argv\[\]=([^;]+);/.exec(show)?.[1]?.trim().split(/\s+/) ?? [];
  const script = exec.find((a) => a.endsWith('.js'));
  if (!script || !existsSync(script) || packageOf(script) !== pkg) return null;
  const env = {};
  for (const pair of (/^Environment=(.*)$/m.exec(show)?.[1] ?? '').split(/\s+/)) {
    const i = pair.indexOf('=');
    if (i > 0) env[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return {
    node: exec[0]?.endsWith('node') ? exec[0] : process.execPath,
    script,
    cwd: /^WorkingDirectory=(.+)$/m.exec(show)?.[1] || null,
    env,
    envFile: /^EnvironmentFiles=(\S+)/m.exec(show)?.[1] || null,
    unit: /^Id=(.+)$/m.exec(show)?.[1] ?? 'service',
  };
}

// KEY=value lines; values never leave the server, they only reach the agent's own process.
function readEnvFile(file) {
  const env = {};
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=\s*(.*)\s*$/.exec(line);
      if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch { /* unreadable: the agent starts without it */ }
  return env;
}

let cache = null;
let cachedAt = 0;

// Installed runtimes with version; OpenClaw also reports which gateway agent answers by default.
export async function scan({ fresh = false } = {}) {
  if (cache && !fresh && Date.now() - cachedAt < 60_000) return cache;
  let units = null;
  const found = await Promise.all(RUNTIMES.map(async (r) => {
    let path = r.bins.map(which).find(Boolean) ?? null;
    let launch = null;  // node script run as the host runs it
    if (!path && r.pkg) {
      units ??= runningUnits();
      for (const show of await units) { launch = fromUnit(show, r.pkg); if (launch) break; }
    }
    if (!path && !launch) {
      const script = (r.scripts ?? []).find((f) => existsSync(f) && packageOf(f) === r.pkg);
      if (script) launch = { node: process.execPath, script, cwd: null, env: {}, envFile: null, unit: null };
    }
    const out = { id: r.id, label: r.label, installed: Boolean(path || launch), ready: Boolean(path || launch) && r.adapter, path: path ?? launch?.script ?? null, version: null };
    if (!out.installed) return out;
    if (launch) {
      out.via = launch.unit ? `usługa ${launch.unit}` : 'katalog instalacji';
      if (launch.cwd) out.workspace = launch.cwd;
      Object.defineProperty(out, 'launch', { value: launch, enumerable: false });  // never sent to the browser
    }
    const version = launch ? run(launch.node, [launch.script, '--version'], 15000) : run(path, ['--version']);
    out.version = (await version).split('\n')[0].trim() || null;
    if (r.id === 'dsh' && launch?.cwd) out.agent = basename(launch.cwd).toLowerCase();
    if (r.id === 'openclaw') {
      const list = await run(path, ['agents', 'list'], 15000);
      out.agent = /^- (\S+) \(default\)/m.exec(list)?.[1] ?? /^- (\S+)/m.exec(list)?.[1] ?? null;
      if (!out.agent) out.ready = false;
    }
    if (!r.adapter) out.note = 'znaleziony, brak adaptera';
    return out;
  }));
  cache = found;
  cachedAt = Date.now();
  return found;
}

const short = (s, n = 160) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// Claude Code: streamed text deltas, tool calls as one-line notes. SpectraHub only opens a window to
// the agent: its own settings, instructions and hooks apply as they would in a terminal.
const claude = {
  argv(ref, started) {
    return ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--permission-mode', 'acceptEdits',
      ...(started ? ['--resume', ref] : ['--session-id', ref]),
      '--allowedTools', 'Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'];
  },
  stdin: true,
  line(d, emit) {
    if (d.type === 'stream_event' && d.event?.type === 'content_block_delta' && d.event.delta?.type === 'text_delta') {
      emit({ type: 'text', s: d.event.delta.text });
    } else if (d.type === 'stream_event' && d.event?.type === 'content_block_start' && d.event.content_block?.type === 'text') {
      emit({ type: 'text', s: '', block: true });
    } else if (d.type === 'assistant') {
      for (const c of d.message?.content ?? []) {
        if (c.type !== 'tool_use') continue;
        const i = c.input ?? {};
        emit({ type: 'tool', s: `${c.name} ${short(String(i.command ?? i.file_path ?? i.pattern ?? i.url ?? i.description ?? ''))}`.trim() });
      }
    } else if (d.type === 'result') {
      if (d.is_error) emit({ type: 'error', s: String(d.result ?? d.subtype ?? 'error') });
      emit({ type: 'done', cost: d.total_cost_usd ?? null });
    }
  },
};

// Codex: whole messages and command steps; the thread id becomes our session reference.
const codex = {
  argv(ref, started) {
    const common = ['--json', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check'];
    return started ? ['exec', 'resume', ...common, ref, '-'] : ['exec', ...common, '-'];
  },
  stdin: true,
  line(d, emit) {
    if (d.type === 'thread.started') emit({ type: 'ref', ref: d.thread_id });
    else if (d.type === 'item.started' && d.item?.type === 'command_execution') emit({ type: 'tool', s: `bash ${short(d.item.command ?? '')}` });
    else if (d.type === 'item.completed' && d.item?.type === 'agent_message') emit({ type: 'text', s: d.item.text + '\n', block: true });
    else if (d.type === 'item.completed' && d.item?.type === 'file_change') emit({ type: 'tool', s: `edit ${short((d.item.changes ?? []).map((c) => c.path).join(', '))}` });
    else if (d.type === 'error' || d.type === 'turn.failed') emit({ type: 'error', s: String(d.message ?? d.error?.message ?? 'error') });
    else if (d.type === 'turn.completed') emit({ type: 'done' });
  },
};

// DeepSeek Harness: the headless profile writes run events; the session id continues the talk.
const dsh = {
  argv(ref, started) {
    return ['--profile', 'headless', '--json', ...(started ? ['--session-id', ref] : []), '-'];
  },
  stdin: true,
  line(d, emit) {
    if (d.type === 'session') emit({ type: 'ref', ref: d.sessionId });
    else if (d.type === 'text' && d.text) { this.said = true; emit({ type: 'text', s: d.text }); }
    else if (d.type === 'final' && d.text && !this.said) emit({ type: 'text', s: d.text, block: true });
    else if (/tool/.test(d.type ?? '')) emit({ type: 'tool', s: short(`${d.name ?? d.tool ?? d.type} ${d.input?.command ?? d.input?.path ?? d.summary ?? ''}`.trim()) });
    else if (d.type === 'error') emit({ type: 'error', s: String(d.message ?? d.error ?? 'error') });
    else if (d.type === 'status' && d.phase === 'turn_end') {
      if (d.reason?.kind && d.reason.kind !== 'completed') emit({ type: 'error', s: `tura zakończona: ${d.reason.kind}` });
      emit({ type: 'done' });
    }
  },
};

// OpenClaw: one JSON document at the end; the reply stays here, nothing is delivered to channels.
const openclaw = {
  argv(ref, _started, { agent, file }) {
    return ['agent', '--agent', agent, '--session-id', ref, '--message-file', file, '--json', '--timeout', '600'];
  },
  stdin: false,
  whole(text, emit) {
    let d;
    try { d = JSON.parse(text); } catch { return emit({ type: 'error', s: short(text.trim() || 'brak odpowiedzi', 400) }); }
    for (const p of d.result?.payloads ?? []) if (p.text) emit({ type: 'text', s: p.text + '\n', block: true });
    if (d.status !== 'ok') emit({ type: 'error', s: String(d.summary ?? d.status) });
    emit({ type: 'done' });
  },
};

const ADAPTERS = { claude, codex, openclaw, dsh };

export function newRef(id) {
  return id === 'codex' || id === 'dsh' ? null : id === 'openclaw' ? `spectrahub-${randomUUID()}` : randomUUID();
}

// Runs one turn. `emit` receives {type: text|tool|error|ref|done}; the returned function stops it.
export function turn(rt, { ref, started, prompt, cwd }, emit) {
  const a = Object.create(ADAPTERS[rt.id]);  // per-run state (e.g. dsh: did text already stream)
  let file = null;
  if (rt.id === 'openclaw') {
    const dir = join(tmpdir(), 'spectrahub-msg');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    file = join(dir, `${randomUUID()}.txt`);
    writeFileSync(file, prompt, { mode: 0o600 });
  }
  const l = rt.launch;
  const env = { ...process.env, ...(l?.envFile ? readEnvFile(l.envFile) : {}), ...(l?.env ?? {}), NO_COLOR: '1' };
  const [bin, args] = l ? [l.node, [l.script, ...a.argv(ref, started, { agent: rt.agent, file })]] : [rt.path, a.argv(ref, started, { agent: rt.agent, file })];
  const child = spawn(bin, args, {
    cwd: l?.cwd ?? cwd, env, stdio: [a.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });
  if (a.stdin) child.stdin.end(prompt);
  let done = false;
  let buf = '';
  let all = '';
  let err = '';
  const finish = (e) => { if (!done) { done = true; emit(e); } };
  const relay = (e) => (e.type === 'done' ? finish(e) : emit(e));
  child.stdout.on('data', (chunk) => {
    const s = chunk.toString('utf8');
    if (!a.line) { all += s; return; }
    buf += s;
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const l = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!l) continue;
      try { a.line(JSON.parse(l), relay); } catch { /* not JSON: progress noise */ }
    }
  });
  child.stderr.on('data', (c) => { err = (err + c.toString('utf8')).slice(-2000); });
  child.on('error', (e) => { emit({ type: 'error', s: e.message }); finish({ type: 'done' }); });
  child.on('close', (code, signal) => {
    if (file) rmSync(file, { force: true });
    if (a.whole) a.whole(all, relay);
    if (!done) {
      if (signal) emit({ type: 'error', s: 'przerwano' });
      else if (code) emit({ type: 'error', s: short(err.trim().split('\n').pop() || `kod wyjścia ${code}`, 400) });
      finish({ type: 'done' });
    }
  });
  return () => { if (!done) child.kill('SIGTERM'); };
}
