// FIXTURE (clean) — core/control-char-in-output.
// A lone `\0` is the deliberate NUL-separator idiom (the `-z` protocol
// every git plumbing command speaks). Nothing hex follows it, so there is no
// truncated CSS escape to report.
const SEP = `\0`;

export function joinRecords(parts: string[]) {
  return parts.map((p) => `${p}\0`).join(SEP);
}
