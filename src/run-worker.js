// One detached process owns one runtime turn across HTTP-server restarts.
import { appendFileSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { turn } from './agents.js';
import { atomic, processStamp } from './run-journal.js';

const dir = process.argv[2];
const spec = JSON.parse(readFileSync(join(dir, 'spec.json'), 'utf8'));
let bootstrap = '';
for await (const chunk of process.stdin) bootstrap += chunk;
const secrets = JSON.parse(bootstrap || '{}');
bootstrap = '';
const runtime = { ...spec.runtime, ...(spec.runtime.launch ? { launch: { ...spec.runtime.launch, env: secrets.launchEnv ?? {} } } : {}) };
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_DURATION_MS = 8 * 60 * 60 * 1000;
let bytes = 0;
let finished = false;
let control;
let poll;
let deadline;
const state = (status) => atomic(join(dir, 'state.json'), { pid: process.pid, stamp: processStamp(process.pid), status, updatedAt: Date.now() });
state('running');
function emit(event) {
  if (finished) return;
  const line = JSON.stringify(event) + '\n';
  bytes += Buffer.byteLength(line);
  if (bytes > MAX_BYTES && event.type !== 'done' && event.type !== 'error') {
    fail('Przekroczono limit dziennika jednej tury (64 MiB).');
    return;
  }
  appendFileSync(join(dir, 'events.jsonl'), line, { mode: 0o600 });
  if (event.type === 'done') {
    finished = true;
    clearInterval(poll);
    clearTimeout(deadline);
    state('done');
    // The adapter may still be closing stdout after its final event.
    setTimeout(() => { try { process.kill(-process.pid, 'SIGKILL'); } catch { process.exit(0); } }, 4000).unref();
  }
}
function fail(message) {
  if (finished) return;
  emit({ type: 'error', s: message, interrupted: true });
  control?.();
  emit({ type: 'done' });
}
try {
  control = turn(runtime, { ...spec.options, env: secrets.env ?? {} }, emit);
  if (!finished) poll = setInterval(() => {
    if (finished) return;
    const batch = [];
    for (const name of readdirSync(join(dir, 'commands')).filter((f) => f.endsWith('.json')).sort()) {
      const file = join(dir, 'commands', name);
      try { batch.push({ file, command: JSON.parse(readFileSync(file, 'utf8')) }); } catch { /* incomplete or invalid command */ }
    }
    // Cancellation wins over every answer already queued, regardless of UUID filename order.
    // Never deliver an allow after asking the runtime to stop.
    if (batch.some(({ command }) => command.type === 'stop')) {
      for (const { file } of batch) unlinkSync(file);
      fail('Przerwano na żądanie użytkownika.');
      return;
    }
    for (const { file, command: c } of batch) {
      if (finished) break;
      unlinkSync(file);
      if (c.type === 'answer') {
        const accepted = control.answer?.(c.ask, c.decision, c.answers);
        if (!accepted) emit({ type: 'answer-rejected', id: c.ask });
        else emit({ type: 'answer', id: c.ask, decision: c.decision, ...(c.answers ? { answers: c.answers } : {}) });
      }
    }
  }, 50);
  if (!finished) deadline = setTimeout(() => fail('Przekroczono maksymalny czas pracy agenta (8 godzin).'), MAX_DURATION_MS);
} catch (error) { fail(error.message); }
process.on('SIGTERM', () => fail('Przerwano proces wykonujący agenta.'));
process.on('SIGINT', () => fail('Przerwano proces wykonujący agenta.'));
process.on('uncaughtException', (error) => { fail(error.message); process.exit(1); });
