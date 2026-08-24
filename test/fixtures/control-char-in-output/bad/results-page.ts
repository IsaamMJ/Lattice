// FIXTURE (intentionally defective) — core/control-char-in-output.
// The #196 incident: a CSS escape written inside a JS template literal.
// JS decodes first, so the octal escape and the NUL land in the stylesheet
// that renders next to the words "What is this?" on a results page.
const STYLES = `
  .mk-q::before { content:'\2013\0a0' }
`;

const HTML = `<html><head><style>${STYLES}</style></head><body>What is this?</body></html>`;

export function GET() {
  return new Response(HTML, { headers: { "content-type": "text/html" } });
}
