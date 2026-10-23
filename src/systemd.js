// systemd uses its own quoted strings, specifiers and ExecStart variable expansion.
export function unitQuote(value, { exec = false } = {}) {
  const text = String(value);
  if (/[\x00-\x1f\x7f]/.test(text)) throw new Error('service paths must not contain control characters');
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%');
  return '"' + (exec ? escaped.replaceAll('$', () => '$$') : escaped) + '"';
}
