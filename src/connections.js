// How each agent reaches its model: a subscription login or an API key. Read from the agent's own
// files and never changed there; SpectraHub only decides what it hands the agent's process at launch.
//   (not set)    — nothing is changed: the agent signs in the way it is set up
//   subscription — the agent's own login (an API key in the environment is taken away)
//   api          — an API key for this run (saved in SpectraHub, or already in its environment)
//   auto         — the subscription until its limit runs out, then the API key until it resets
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openclawStatus, readEnvFile, scan } from './agents.js';
import { readConfig, writeConfig } from './config.js';

export const AUTH_MODES = ['subscription', 'api', 'auto'];

// The variable each runtime reads a per-run API key from, and every one that would override its login.
const KEY_VAR = { claude: 'ANTHROPIC_API_KEY', codex: 'CODEX_API_KEY' };
const OVERRIDES = { claude: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'], codex: ['CODEX_API_KEY', 'OPENAI_API_KEY'] };
const KEY_SHAPE = { claude: /^sk-ant-[\w-]{20,}$/, codex: /^sk-[\w-]{20,}$/ };
export const SWITCHABLE = Object.keys(KEY_VAR);

const json = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const keysFile = (dir) => join(dir, 'keys.json');

function jwtClaims(token) {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
}

// The subscription login each agent keeps for itself: whether it is there and which plan.
function subscription(id) {
  if (id === 'claude') {
    const o = json(join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), '.credentials.json'))?.claudeAiOauth;
    return o?.refreshToken || o?.accessToken ? { plan: o.subscriptionType ?? null, where: 'logowanie Claude Code' } : null;
  }
  if (id === 'codex') {
    const a = json(join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'auth.json'));
    if (!a?.tokens?.refresh_token && !a?.tokens?.access_token) return null;
    const plan = jwtClaims(a.tokens.id_token)?.['https://api.openai.com/auth']?.chatgpt_plan_type ?? null;
    return { plan, where: 'logowanie ChatGPT w Codexie' };
  }
  return null;
}

// Where an API key for the agent can come from; the value itself never leaves this module.
function apiKey(dir, id) {
  const saved = json(keysFile(dir))?.[id];
  if (saved) return { key: saved, where: 'klucz zapisany w SpectraHub' };
  for (const name of OVERRIDES[id] ?? []) if (process.env[name]) return { key: process.env[name], where: `zmienna ${name} serwera` };
  if (id === 'codex') {
    const k = json(join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'auth.json'))?.OPENAI_API_KEY;
    if (k) return { key: k, where: 'klucz zapisany w Codexie' };
  }
  return null;
}

export function saveKey(dir, id, key) {
  if (!SWITCHABLE.includes(id)) return { error: 'ten agent nie przyjmuje klucza od SpectraHub' };
  const k = String(key ?? '').trim();
  if (k && !KEY_SHAPE[id].test(k)) return { error: id === 'claude' ? 'to nie wygląda na klucz Anthropic (sk-ant-…)' : 'to nie wygląda na klucz OpenAI (sk-…)' };
  const all = json(keysFile(dir)) ?? {};
  if (k) all[id] = k; else delete all[id];
  writeFileSync(keysFile(dir), JSON.stringify(all), { mode: 0o600 });
  chmodSync(keysFile(dir), 0o600);
  return { ok: true };
}

export function setMode(dir, config, id, mode) {
  if (!SWITCHABLE.includes(id) || (mode !== null && !AUTH_MODES.includes(mode))) return { error: 'nieznany agent albo tryb' };
  const saved = readConfig(dir) ?? {};
  saved.agentAuth = { ...saved.agentAuth, [id]: mode };
  if (mode === null) delete saved.agentAuth[id];
  writeConfig(dir, saved);
  config.agentAuth = saved.agentAuth;  // the running server sees it at once
  return { ok: true };
}

const modeOf = (config, id) => (AUTH_MODES.includes(config.agentAuth?.[id]) ? config.agentAuth[id] : null);

// A plan window that is used up and not yet reset (Claude also says "rejected" outright).
export function limitHit(limits, now = Date.now()) {
  if (!limits) return false;
  if (limits.status === 'rejected') return true;
  return (limits.windows ?? []).some((w) => w.used >= 1 && (!w.resetsAt || (w.resetsAt > 1e12 ? w.resetsAt : w.resetsAt * 1000) > now));
}
export const LIMIT_TEXT = /usage limit|rate.?limit|limit (reached|exceeded)|hit your .*limit|quota|out of credits/i;

// What the agent's process gets for this turn: env to add, env to remove, and which way it goes.
export function launchAuth(config, id, { limits, force } = {}) {
  if (!SWITCHABLE.includes(id)) return { env: {}, drop: [], via: null };
  const mode = modeOf(config, id);
  const key = apiKey(config.dir, id);
  if (!mode && !force) {  // as the agent is set up: say which way it goes, change nothing
    const envKey = OVERRIDES[id].some((n) => process.env[n]);
    return { env: {}, drop: [], via: envKey ? 'api' : subscription(id) ? 'subscription' : null, mode, canFallBack: false };
  }
  const via = force ?? (mode === 'auto' ? (limitHit(limits) && key ? 'api' : 'subscription') : mode);
  if (via === 'api' && !key) return { error: 'tryb API, ale nie ma klucza — dodaj go w Ustawieniach → Agenci', via };
  if (via === 'api') return { env: { [KEY_VAR[id]]: key.key }, drop: OVERRIDES[id].filter((n) => n !== KEY_VAR[id]), via, mode, canFallBack: false };
  return { env: {}, drop: OVERRIDES[id], via, mode, canFallBack: mode === 'auto' && Boolean(key) };
}

const PLAN = { pro: 'Pro', max: 'Max', team: 'Team', enterprise: 'Enterprise', plus: 'Plus', prolite: 'Pro Lite', business: 'Business', free: 'Free' };
const planName = (p) => (p ? PLAN[p] ?? p : null);

// Everything the settings page shows: one row per installed agent. No key values, only where they are.
export async function connections(config) {
  const out = [];
  for (const rt of (await scan()).filter((r) => r.installed)) {
    const row = { id: rt.id, label: rt.label, switchable: SWITCHABLE.includes(rt.id) };
    if (row.switchable) {
      const sub = subscription(rt.id);
      const key = apiKey(config.dir, rt.id);
      row.subscription = sub ? { plan: planName(sub.plan), where: sub.where } : null;
      row.api = key ? { where: key.where, saved: key.where === 'klucz zapisany w SpectraHub' } : null;
      row.mode = modeOf(config, rt.id);
      row.keyHint = rt.id === 'claude' ? 'klucz Anthropic (sk-ant-…)' : 'klucz OpenAI (sk-…)';
    } else if (rt.id === 'dsh') {
      const env = { ...(rt.launch?.envFile ? readEnvFile(rt.launch.envFile) : {}), ...(rt.launch?.env ?? {}) };
      row.api = env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY ? { where: 'klucz DeepSeek w konfiguracji usługi' } : null;
      row.note = 'DeepSeek nie ma subskrypcji — działa tylko na kluczu API.';
    } else if (rt.id === 'openclaw' && rt.ready) {
      try {
        const st = await openclawStatus(rt);
        const used = new Set([st.resolvedDefault, ...(st.allowed ?? [])].filter(Boolean).map((m) => m.split('/')[0]));
        row.providers = (st.auth?.providers ?? []).filter((p) => used.has(p.provider)).map((p) => ({
          provider: p.provider,
          kind: p.effective?.kind === 'oauth' || p.profiles?.oauth > 0 ? 'subscription' : 'api',
          where: p.effective?.kind === 'env' ? `zmienna ${String(p.env?.source ?? '').replace(/^env:\s*/, '')}` : p.effective?.kind ?? '',
        }));
      } catch { /* status unreadable: no providers listed */ }
      row.note = 'OpenClaw łączy się przez swoich dostawców; trasę wybiera model (dostawca z kluczem API albo z logowaniem).';
    }
    out.push(row);
  }
  return out;
}
