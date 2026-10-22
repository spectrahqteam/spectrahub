// Usage and limits per agent in a session, from each runtime's own records — never estimated.
//   Claude Code: its stream (result.modelUsage, rate_limit_event), kept on the session
//   Codex: its session file (token_count: last request, context window, plan limits, credits)
//   DeepSeek Harness: its session store (contextPressure, tokenUsage) and the DeepSeek balance API
//   OpenClaw: its run metadata (prompt tokens, context budget) and the provider's balance API
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { codexRollout, readEnvFile, scan } from './agents.js';

const balances = new Map();  // key hash -> { at, value }

// DeepSeek's own balance endpoint. The key never leaves this server.
async function deepseekBalance(key) {
  if (!key) return null;
  const id = createHash('sha256').update(key).digest('hex');
  const hit = balances.get(id);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  let value = null;
  try {
    const res = await fetch('https://api.deepseek.com/user/balance', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const d = await res.json();
      const b = d.balance_infos?.[0];
      if (b) value = { amount: Number(b.total_balance), currency: b.currency, available: d.is_available !== false, source: 'API DeepSeek' };
    } else value = { error: res.status === 401 ? 'klucz odrzucony przez DeepSeek' : `DeepSeek: HTTP ${res.status}` };
  } catch { value = { error: 'DeepSeek nie odpowiada' }; }
  balances.set(id, { at: Date.now(), value });
  return value;
}

// A key in a config may be the value itself, `${NAME}`, or {source: 'env', id: NAME}: then it is the
// variable from the service's own .env file, or from the environment of its running process.
function resolveRef(value, processName, envFile) {
  const name = typeof value === 'object' && value?.source === 'env' ? value.id : /^\$\{(\w+)\}$/.exec(String(value ?? ''))?.[1];
  if (!name) return typeof value === 'string' && value ? value : null;
  const m = [null, name];
  if (envFile) { const v = readEnvFile(envFile)[name]; if (v) return v; }
  if (process.env[m[1]]) return process.env[m[1]];
  for (const pid of readdirSync('/proc').filter((p) => /^\d+$/.test(p))) {
    try {
      if (!readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(processName)) continue;
      const pair = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').find((x) => x.startsWith(`${m[1]}=`));
      if (pair) return pair.slice(m[1].length + 1);
    } catch { /* gone or not ours */ }
  }
  return null;
}

function codex(st) {
  const f = st.ref && codexRollout(st.ref);
  if (!f) return {};
  let last = null;
  try { for (const line of readFileSync(f, 'utf8').split('\n')) if (line.includes('"token_count"')) last = line; } catch { return {}; }
  if (!last) return {};
  const p = JSON.parse(last).payload ?? {};
  const info = p.info ?? {};
  const r = p.rate_limits ?? {};
  const win = (x) => x && { label: x.window_minutes >= 10080 ? 'tydzień' : x.window_minutes >= 1440 ? 'doba' : `sesja (${Math.round(x.window_minutes / 60)} godz)`, used: (x.used_percent ?? 0) / 100, resetsAt: x.resets_at };
  return {
    context: info.last_token_usage && { used: info.last_token_usage.total_tokens, window: info.model_context_window ?? null },
    tokens: info.total_token_usage && { input: info.total_token_usage.input_tokens, output: info.total_token_usage.output_tokens + (info.total_token_usage.reasoning_output_tokens ?? 0), cached: info.total_token_usage.cached_input_tokens },
    limits: { windows: [win(r.primary), win(r.secondary)].filter(Boolean), plan: r.plan_type ?? null },
    credits: r.credits && !r.credits.unlimited ? { amount: Number(r.credits.balance ?? 0), currency: 'kredyty', available: r.credits.has_credits } : null,
    source: 'plik sesji Codexa',
  };
}

async function dsh(st, rt) {
  const env = { ...(rt?.launch?.envFile ? readEnvFile(rt.launch.envFile) : {}), ...(rt?.launch?.env ?? {}) };
  const home = env.DSH_HOME ?? process.env.DSH_HOME ?? join(homedir(), '.dsh');
  const out = { source: 'magazyn sesji DeepSeek Harness' };
  try {
    const rows = JSON.parse(readFileSync(join(home, 'storages', 'session_projcache', 'sessions', `${st.ref}.json`), 'utf8')).record?.rows ?? {};
    const cp = rows.contextPressure?.val;
    if (cp) out.context = { used: cp.pressureTokens ?? cp.surfaceTokens, window: cp.contextWindow ?? null };
    const t = rows.tokenUsage?.val?.totals;
    if (t) out.tokens = { input: (t.uncachedInputTokens ?? 0) + (t.cacheReadTokens ?? 0), output: t.outputTokens ?? 0, cached: t.cacheReadTokens ?? 0 };
  } catch { /* no session yet */ }
  out.balance = await deepseekBalance(env.DEEPSEEK_API_KEY ?? process.env.DEEPSEEK_API_KEY);
  return out;
}

async function openclaw(st) {
  const u = st.usage ?? {};
  const out = { context: u.context ? { used: u.context, window: u.contextWindow ?? null } : null, source: 'metadane OpenClaw' };
  if (String(u.model ?? '').startsWith('deepseek/')) {
    try {
      const home = process.env.OPENCLAW_HOME ?? join(homedir(), '.openclaw');
      const key = JSON.parse(readFileSync(join(home, 'openclaw.json'), 'utf8')).models?.providers?.deepseek?.apiKey;
      out.balance = await deepseekBalance(resolveRef(key, 'openclaw', join(home, '.env')));
    } catch { /* no provider config */ }
  }
  return out;
}

// Older sessions kept Claude's raw five_hour / seven_day; the sheet always gets a list.
function normalLimits(l) {
  if (!l || Array.isArray(l.windows)) return l ?? null;
  const w = l.windows ?? {};
  return { ...l, windows: [w.five_hour && { label: 'sesja (5 godz)', used: w.five_hour.utilization, resetsAt: w.five_hour.resetsAt },
    w.seven_day && { label: 'tydzień', used: w.seven_day.utilization, resetsAt: w.seven_day.resetsAt }].filter(Boolean) };
}

// Everything the usage sheet shows for one session.
export async function sessionUsage(s) {
  const runtimes = await scan();
  const agents = {};
  for (const [a, st] of Object.entries(s.agents)) {
    const u = st.usage ?? {};
    const base = {
      model: u.model ?? null, turns: u.turns ?? 0, cost: u.cost || null,
      tokens: { input: u.input ?? 0, output: u.output ?? 0 },
      context: u.context ? { used: u.context, window: u.contextWindow ?? null } : null,
      limits: normalLimits(st.limits), perm: st.perm ?? 'full',
    };
    let extra = {};
    if (a === 'claude') extra = { source: 'strumień Claude Code (limity od Anthropic)' };
    else if (a === 'codex') extra = codex(st);
    else if (a === 'dsh') extra = await dsh(st, runtimes.find((r) => r.id === 'dsh'));
    else if (a === 'openclaw') extra = await openclaw(st);
    agents[a] = { ...base, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v != null)) };
  }
  return { agents, at: new Date().toISOString() };
}
