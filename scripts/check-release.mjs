// Check source and the actual npm payload before publishing. Never print matched secret values.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceAllow = /^(?:\.gitignore|LICENSE|README\.md|package(?:-lock)?\.json|(?:src|test|scripts)\/[\w.-]+\.(?:js|mjs)|bin\/[\w-]+\.(?:js|py)|web\/[\w-]+\.(?:js|css|html|png|webmanifest)|docs\/(?:INSTALL|ARCHITECTURE|ROADMAP|DECISIONS)\.md|\.github\/workflows\/[\w-]+\.ya?ml)$/;
const packageAllow = /^(?:LICENSE|README\.md|package\.json|src\/[\w-]+\.js|bin\/[\w-]+\.(?:js|py)|web\/[\w-]+\.(?:js|css|html|png|webmanifest)|docs\/(?:INSTALL|ARCHITECTURE|ROADMAP|DECISIONS)\.md)$/;
const problems = [];
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const signatures = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['credential', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{40,})\b/],
  ['installation-specific path', new RegExp('/srv/' + 'spectra(?:/|\\b)')],
  ['home installation path', /\/(?:root|home\/[^\s/'"`]+)\/\.(?:spectrahub|ssh|codex|claude|openclaw)\//],
];
for (const file of files) {
  if (!sourceAllow.test(file)) { problems.push(`${file}: outside the source allowlist`); continue; }
  if (file.endsWith('.png')) continue;
  const data = readFileSync(resolve(root, file), 'utf8');
  for (const [label, regex] of signatures) if (regex.test(data)) problems.push(`${file}: ${label}`);
  if (statSync(resolve(root, file)).size > 2 * 1024 * 1024) problems.push(`${file}: unexpectedly large source file`);
}
const pack = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }))[0];
for (const file of pack.files) if (!packageAllow.test(file.path)) problems.push(`${file.path}: outside the installation allowlist`);
for (const required of ['bin/spectrahub.js', 'bin/pty-bridge.py', 'src/run-worker.js', 'web/infrastructure.js', 'web/terminal.html', 'docs/INSTALL.md']) {
  if (!pack.files.some((f) => f.path === required)) problems.push(`${required}: missing from installation`);
}
if (problems.length) {
  console.error('Release check failed:\n' + [...new Set(problems)].map((p) => `- ${p}`).join('\n'));
  process.exitCode = 1;
} else console.log(`Release check passed: ${files.length} source files; ${pack.files.length} installation files; private state excluded.`);
