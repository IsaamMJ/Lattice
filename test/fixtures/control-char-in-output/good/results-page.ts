// FIXTURE (clean) — core/control-char-in-output.
// The same stylesheet with the backslash doubled: JS unescapes one level and
// CSS receives the escape it was always meant to receive.
const STYLES = `
  .mk-q::before { content:'\\2013\\a0' }
`;

const HTML = `<html><head><style>${STYLES}</style></head><body>What is this?</body></html>`;

export function GET() {
  return new Response(HTML, { headers: { "content-type": "text/html" } });
}
