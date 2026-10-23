// Native approval transports: Codex app-server and Agent Client Protocol (ACP).
// No tool is executed by this client. Unknown requests fail closed, and grants are one-shot.
import { spawn } from 'node:child_process';

const clip = (v, n = 12000) => String(v ?? '').slice(0, n);
const text = (v) => typeof v === 'string' ? v : Array.isArray(v) ? v.map((x) => x.content?.text ?? x.text ?? '').join('\n') : '';

export function rpcTurn({ bin, args, cwd, env, protocol, ref, started, prompt, model, effort, images = [], perm = 'read', agent, configure, cleanup = () => {} }, emit) {
  const child = spawn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  const asks = new Map();
  const steps = new Map();
  const textItems = new Set();
  let next = 1, buffer = '', errors = '', finished = false, sessionId = null, turnId = null, prompting = false;
  const write = (frame) => { if (!child.stdin.destroyed && child.stdin.writable) child.stdin.write(JSON.stringify(frame) + '\n'); };
  const notify = (method, params) => write({ jsonrpc: '2.0', method, params });
  const finish = (error) => {
    if (finished) return;
    finished = true;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('transport closed')); }
    pending.clear(); asks.clear();
    if (error) emit({ type: 'error', s: clip(error, 600) });
    emit({ type: 'done' });
    child.stdin.end();
    const timer = setTimeout(() => { if (child.exitCode == null) child.kill('SIGTERM'); }, 1500);
    timer.unref();
  };
  const request = (method, params, timeout = 60000) => new Promise((resolve, reject) => {
    if (finished) return reject(new Error('transport closed'));
    const id = `hub-${next++}`;
    const timer = timeout ? setTimeout(() => { pending.delete(id); reject(new Error(`${method}: brak odpowiedzi runtime`)); }, timeout) : null;
    pending.set(id, { resolve, reject, timer });
    write({ jsonrpc: '2.0', id, method, params });
  });
  const reply = (id, result) => write({ jsonrpc: '2.0', id, result });
  const reject = (id) => write({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Unsupported client operation; denied by SpectraHub' } });

  function permission(frame) {
    const p = frame.params ?? {};
    const id = `rpc:${String(frame.id)}`;
    let shown, answer;
    if (protocol === 'codex' && ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(frame.method)) {
      const files = frame.method.includes('fileChange');
      const changes = files ? steps.get(p.itemId)?.changes ?? [] : [];
      shown = { kind: 'permission', tool: files ? 'Zmiana plików' : 'Polecenie', title: clip(p.command ?? (changes.length ? changes.map((c) => c.path).join(', ') : p.reason ?? p.grantRoot ?? p.itemId), 1200),
        description: clip([p.reason, ...changes.map((c) => `${c.path}\n${c.diff ?? ''}`)].filter(Boolean).join('\n')), path: p.cwd ?? p.grantRoot ?? null, always: false };
      answer = (decision) => ({ decision: decision === 'deny' ? 'decline' : 'accept' });
    } else if (protocol === 'codex' && frame.method === 'item/permissions/requestApproval') {
      shown = { kind: 'permission', tool: 'Dostęp', title: clip(p.reason ?? 'Rozszerzenie dostępu na czas tury'), description: 'Zgoda obowiązuje do końca bieżącej tury: ' + clip(JSON.stringify(p.permissions ?? {})), always: false, scope: 'turn' };
      answer = (decision) => ({ permissions: decision === 'deny' ? {} : p.permissions ?? {}, scope: 'turn' });
    } else if (protocol === 'codex' && frame.method === 'item/tool/requestUserInput') {
      shown = { kind: 'question', tool: 'Pytanie', title: '', description: '', always: false,
        questions: (p.questions ?? []).map((q) => ({ question: q.question, header: q.header ?? q.id, multi: false, options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description ?? '' })) })) };
      answer = (decision, answers = {}) => ({ answers: decision === 'deny' ? {} : Object.fromEntries((p.questions ?? []).map((q) => [q.id, { answers: [].concat(answers[q.question] ?? answers[q.id] ?? '') }])) });
    } else if (protocol === 'acp' && frame.method === 'session/request_permission' && p.sessionId === sessionId) {
      const tool = { ...(steps.get(p.toolCall?.toolCallId) ?? {}), ...p.toolCall };
      const allow = p.options?.find((o) => o.kind === 'allow_once');
      const deny = p.options?.find((o) => o.kind === 'reject_once');
      // Never turn "allow once" into an allow-always option, even on older peers.
      if (!allow || !deny) { reply(frame.id, { outcome: { outcome: 'cancelled' } }); return; }
      shown = { kind: 'permission', tool: tool.title ?? tool.kind ?? 'Narzędzie', title: clip(tool.rawInput?.command ?? tool.rawInput?.path ?? tool.title ?? tool.toolCallId, 1200),
        description: clip(tool.rawInput ? JSON.stringify(tool.rawInput) : 'Zgoda jednorazowa na wskazaną operację.'), always: false };
      answer = (decision) => ({ outcome: { outcome: 'selected', optionId: decision === 'deny' ? deny.optionId : allow.optionId } });
    } else { reject(frame.id); return; }
    // Read-only is a hard session choice. A runtime cannot escalate it through the UI.
    if (perm === 'read' && shown.kind === 'permission') { reply(frame.id, answer('deny')); return; }
    asks.set(id, { wireId: frame.id, answer });
    emit({ type: 'ask', id, scope: 'once', ...shown });
  }

  function codexEvent(method, p) {
    if (method === 'turn/started') turnId = p.turn?.id;
    else if (method === 'item/agentMessage/delta') {
      const first = !textItems.has(p.itemId); textItems.add(p.itemId);
      emit({ type: 'text', s: p.delta ?? '', block: first });
    } else if (method === 'item/started' || method === 'item/completed') {
      const it = p.item ?? {}, done = method.endsWith('/completed');
      if (it.id) steps.set(it.id, it);
      if (it.type === 'agentMessage') {
        if (done && !textItems.has(it.id)) emit({ type: 'text', s: it.text ?? '', block: true });
      } else if (it.type === 'commandExecution') {
        if (!done) emit({ type: 'step', id: it.id, kind: 'tool', name: 'bash', title: clip(it.command, 1200) });
        else emit({ type: 'step-end', id: it.id, ok: it.exitCode === 0, exit: it.exitCode, output: clip(it.aggregatedOutput) });
      } else if (it.type === 'fileChange') {
        emit({ type: 'step', id: it.id, kind: 'edit', name: 'edit', title: (it.changes ?? []).map((c) => c.path).join(', ') });
        if (done) emit({ type: 'step-end', id: it.id, ok: it.status === 'completed' });
      } else if (it.type === 'reasoning' && done) {
        emit({ type: 'step', id: it.id, kind: 'think', text: (it.summary ?? it.content ?? []).join('\n'), done: true });
      } else if (it.type === 'mcpToolCall' || it.type === 'webSearch') {
        if (!done) emit({ type: 'step', id: it.id, kind: 'tool', name: it.tool ?? 'web', title: clip(JSON.stringify(it.arguments ?? it.action ?? {}), 1000) });
        else emit({ type: 'step-end', id: it.id, ok: it.status === 'completed', output: clip(text(it.result?.content)) });
      }
    } else if (method === 'turn/plan/updated') {
      emit({ type: 'step', id: `plan:${p.turnId}`, kind: 'todo', name: 'plan', todos: (p.plan ?? []).map((x) => ({ text: x.step, state: x.status })) });
    } else if (method === 'thread/tokenUsage/updated') {
      const u = p.tokenUsage?.last ?? p.tokenUsage?.total ?? {};
      emit({ type: 'usage', input: u.inputTokens ?? 0, output: u.outputTokens ?? 0, context: u.totalTokens ?? null, contextWindow: p.tokenUsage?.modelContextWindow });
    } else if (method === 'turn/completed') {
      emit({ type: 'limits-codex' });
      finish(p.turn?.status === 'completed' ? null : p.turn?.error?.message ?? `Codex: ${p.turn?.status ?? 'nieznany wynik tury'}`);
    } else if (method === 'error' && !p.willRetry) finish(p.error?.message ?? 'Codex: błąd');
  }

  function acpEvent(method, p) {
    if (method !== 'session/update' || p.sessionId !== sessionId || !prompting) return;
    const u = p.update ?? {};
    if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') emit({ type: 'text', s: u.content.text, block: Boolean(u.messageId && !textItems.has(u.messageId)) }), textItems.add(u.messageId);
    else if (u.sessionUpdate === 'agent_thought_chunk') emit({ type: 'step', id: u.messageId ?? `think:${next++}`, kind: 'think', text: clip(u.content?.text), done: true });
    else if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') {
      const tool = { ...(steps.get(u.toolCallId) ?? {}), ...u };
      steps.set(u.toolCallId, tool);
      if (u.sessionUpdate === 'tool_call') emit({ type: 'step', id: u.toolCallId, kind: u.kind === 'edit' ? 'edit' : 'tool', name: u.title ?? u.kind, title: clip(u.rawInput?.command ?? u.rawInput?.path ?? u.title, 1200) });
      if (u.status === 'completed' || u.status === 'failed') emit({ type: 'step-end', id: u.toolCallId, ok: u.status === 'completed', output: clip(text(u.content)) });
    } else if (u.sessionUpdate === 'usage_update') emit({ type: 'usage', context: u.used, contextWindow: u.size });
  }

  function frame(d) {
    if (d.method && Object.hasOwn(d, 'id')) return permission(d);
    if (d.method) return protocol === 'codex' ? codexEvent(d.method, d.params ?? {}) : acpEvent(d.method, d.params ?? {});
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id); clearTimeout(p.timer);
    if (d.error) p.reject(new Error(d.error.message ?? 'runtime protocol error'));
    else p.resolve(d.result);
  }
  child.stdin.on('error', (e) => { if (!finished) finish(e.message); });
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    if (buffer.length > 8 * 1024 * 1024) return finish('Runtime przekroczył limit ramki protokołu.');
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1);
      if (!line) continue;
      let d;
      try { d = JSON.parse(line); } catch { return finish('Runtime nie obsługuje wymaganego protokołu JSON-RPC.'); }
      try { frame(d); } catch (e) { finish(e.message); }
    }
  });
  child.stderr.on('data', (c) => { errors = (errors + c).slice(-2000); });
  child.on('error', (e) => finish(e.message));
  child.on('close', (code) => { cleanup(); if (!finished) finish(clip(errors.trim().split('\n').pop() || `Runtime zakończył protokół przed wynikiem (${code}).`, 600)); });

  (async () => {
    if (protocol === 'codex') {
      await request('initialize', { clientInfo: { name: 'spectrahub', title: 'SpectraHub', version: '0.3.0' }, capabilities: { experimentalApi: true } });
      notify('initialized', {});
      // Start restrictive: changes and non-trusted commands are decided through native requests.
      const common = { cwd, sandbox: 'read-only', approvalPolicy: perm === 'read' ? 'never' : 'on-request', approvalsReviewer: 'user', ...(model ? { model } : {}) };
      const result = await request(started && ref ? 'thread/resume' : 'thread/start', { ...common, ...(started && ref ? { threadId: ref } : {}) });
      sessionId = result.thread?.id;
      if (!sessionId) throw new Error('Codex nie zwrócił identyfikatora wątku.');
      emit({ type: 'ref', ref: sessionId });
      await request('turn/start', { threadId: sessionId, input: [{ type: 'text', text: prompt }, ...images.map((path) => ({ type: 'localImage', path }))], cwd, approvalPolicy: common.approvalPolicy, approvalsReviewer: 'user', ...(model ? { model } : {}), ...(effort ? { effort } : {}) }, 60000);
    } else {
      const init = await request('initialize', { protocolVersion: 1, clientInfo: { name: 'spectrahub', version: '0.3.0' }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
      if (init.protocolVersion !== 1) throw new Error('Nieobsługiwana wersja ACP.');
      // OpenClaw's gateway session key is stable across bridge processes. DSH resumes by session ID.
      let method = 'session/new', params = { cwd, mcpServers: [] };
      if (agent) params._meta = { sessionKey: `agent:${agent}:${ref}`, prefixCwd: true };
      else if (started && ref) { method = 'session/resume'; params.sessionId = ref; }
      const result = await request(method, params);
      sessionId = result.sessionId ?? (method === 'session/resume' ? ref : null);
      if (!sessionId) throw new Error('Runtime ACP nie zwrócił identyfikatora sesji.');
      emit({ type: 'ref', ref: agent ? ref : sessionId });
      if (configure) await configure();
      if (effort && agent) await request('session/set_mode', { sessionId, modeId: effort });
      if (!agent && (model || effort)) {
        for (const [id, value] of [['model', model], ['reasoning_effort', effort]]) {
          if (!value) continue;
          const option = result.configOptions?.find((o) => o.id === id);
          const values = (option?.options ?? []).flatMap((o) => o.options ?? [o]);
          const chosen = values.find((o) => o.value === value || o.name === value || (id === 'model' && o.value?.endsWith('/' + value)));
          if (!chosen) throw new Error(`Runtime nie udostępnia wybranego ${id}: ${value}`);
          await request('session/set_config_option', { sessionId, configId: id, value: chosen.value });
        }
      }
      prompting = true;
      const resultPrompt = await request('session/prompt', { sessionId, prompt: [{ type: 'text', text: prompt }], ...(agent ? { _meta: { deliver: false } } : {}) }, 0);
      finish(['end_turn', 'stop_sequence'].includes(resultPrompt.stopReason) ? null : `Runtime: ${resultPrompt.stopReason ?? 'nieznany wynik tury'}`);
    }
  })().catch((e) => finish(e.message));

  const stop = () => {
    if (finished) return;
    if (sessionId) {
      if (protocol === 'codex' && turnId) request('turn/interrupt', { threadId: sessionId, turnId }, 1000).catch(() => {});
      else notify('session/cancel', { sessionId });
    }
    finish('przerwano');
    child.kill('SIGTERM');
  };
  stop.answer = (id, decision, answers) => {
    const ask = asks.get(id);
    if (finished || !ask || !['allow', 'deny'].includes(decision)) return false;
    asks.delete(id); reply(ask.wireId, ask.answer(decision, answers)); return true;
  };
  return stop;
}
