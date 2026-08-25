#!/usr/bin/env node
// Deterministic control-character scanner — core/control-char-in-output (#196, dimension: quality).
//
// Flags control characters that ship inside a rendered payload, and the source
// spellings that silently produce them. Three sub-rules, one family:
//
//   1. A literal C0/C1 control byte (anything but tab/newline/carriage return)
//      sitting in the source — in a string, template, or regex literal, in
//      code, or in a comment. It is invisible in every editor, it makes the
//      file report as BINARY to git/grep/diff, and when the literal reaches a
//      response body the browser draws a replacement glyph.
//   2. Inside a template literal, a backslash followed by a digit. `\0` is NUL
//      and `\1`-`\7` are legacy octal escapes; both are almost always a CSS or
//      unicode escape that needed its backslash DOUBLED. TypeScript errors on
//      the invalid ones (TS1487) — `\0` compiles silently, which is exactly
//      why it ships. A LONE `\0` is spared: with no hex behind it there is no
//      truncated escape, only the deliberate NUL-separator idiom.
//   3. Bonus, same family: a stray backtick inside a template literal
//      terminates the string. `tsc` catches the wreckage but reports it
//      hundreds of lines below the cause; the value here is the DIAGNOSIS —
//      pointing at the backtick itself.
//
// The incident behind the rule (#196, 2026-08-20): a CSS escape written inside
// a JS template literal intended an en-dash plus a non-breaking space —
//     const STYLES = `.mk-q::before { content:'\2013\0a0' }`;
// JS decodes FIRST: `\201` is an octal escape (U+0081) and `\0` is NUL, so four
// control characters shipped to every customer next to the words "What is
// this?" on a medical results page. No exception, no log, no failing test —
// found by a human looking at the product. Lattice's own worker carried the
// same defect (#199): a sanitiser regex written as a range whose two bounds
// were literal 0x00 and 0x1F bytes.
//
// PARSED, NOT PATTERN-MATCHED — sub-rules 2 and 3 are undecidable from lines of
// text, because "inside a template literal" is a lexical fact. So this scanner
// LEXES each file: a JS/TS state machine that tracks strings, template literals
// (with `${}` substitution nesting), regex literals — including character
// classes, where `/` does not close — and both comment forms. Every control
// character is then attributed to the construct that actually contains it, and
// an escape only counts when the lexer says it is template TEXT rather than
// code inside a substitution. `String.raw` templates are exempt by tag, not by
// spelling, and `\\0` (the correct doubling) never fires because the lexer
// consumes the escaped backslash as a pair.
//
// TIER IS A REACHABILITY QUESTION, NOT A FILENAME ONE — "customer-facing render
// path" is decided by a bounded intra-file taint pass over the LEXED code (the
// literal bodies masked out, so a sink named inside a string is not a sink):
// identifiers that reach a response sink are seeded from the sink's own
// argument list and propagated backwards through assignments, so
//     const HTML = `<style>${STYLES}</style>`; return new Response(HTML, ...)
// makes STYLES render-reachable in two hops. HIGH when the literal's owner is
// reachable, MEDIUM otherwise, LOW inside a comment (invisible bytes, but not
// output).
//
// Output: one `file|line|tier|key|snippet` per hit on stdout; a count on
// stderr. Control characters are rendered as \xNN in the snippet — emitting the
// raw byte would corrupt the pipe this contract is read from.
// Registry line (registration itself is not this file's business):
//   control-char-in-output|lattice-ctrlchar-scan.mjs|quality
//
// The scan set (walk vs. LATTICE_SCAN_FILES, node_modules, .gitignore) is not
// this rule's business — it comes from the shared decision in
// lattice-scan-ignore.mjs (#132).

import fs from "fs";
import { scanTargets } from "./lattice-scan-ignore.mjs";

const root = process.argv[2] || ".";

const EXTS = new Set([".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs"]);
const TEST_RE = /(\.spec\.|\.test\.|_test\.|\/tests?\/|\/__tests__\/)/;
// Scanner fixtures (intentional sample files) live under a `fixtures/` dir that
// may itself sit beneath `test/`. Those must be scanned, so a `fixtures/`
// segment overrides the test-skip above (cf. lattice-resilience-scan.mjs).
const FIXTURE_RE = /\/fixtures?\//;
// Generated bundles are one enormous line and carry no author intent. The
// build-output directories are already pruned by the shared ignore decision;
// this catches a bundle committed somewhere else.
const MAX_BYTES = 2 * 1024 * 1024;

// ---- The characters ---------------------------------------------------------
//
// C0 minus the three whitespace controls JS source legitimately contains, plus
// DEL and the whole C1 block (U+0080-U+009F) — which is where a mis-decoded
// octal escape like `\201` lands. Written as escapes on purpose: spelling this
// class with literal bytes is the very bug the rule exists to catch (#199).
const CTRL_G = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

// What a CSS or unicode escape is made of, and therefore what tells a truncated
// one (`\0a0`) apart from a deliberate NUL separator (`\0` and nothing more).
const HEX_DIGIT = /[0-9a-fA-F]/;

// ---- Lexer ------------------------------------------------------------------

const CODE = "code";
const LINE_COMMENT = "line-comment";
const BLOCK_COMMENT = "block-comment";
const STRING = "string";
const TEMPLATE = "template";
const REGEX = "regex";

// Words after which a `/` opens a regex literal rather than dividing. Anything
// else that ends an identifier is an operand, so `/` after it is division.
const REGEX_PRECEDERS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "throw", "case", "do", "else", "yield", "await",
]);

// Reserved words never count as a value for the taint pass.
const KEYWORDS = new Set([
  "await", "break", "case", "catch", "class", "const", "continue", "debugger",
  "default", "delete", "do", "else", "enum", "export", "extends", "false",
  "finally", "for", "function", "if", "implements", "import", "in",
  "instanceof", "interface", "let", "new", "null", "package", "private",
  "protected", "public", "return", "static", "super", "switch", "this",
  "throw", "true", "try", "typeof", "var", "void", "while", "with", "yield",
  "as", "async", "from", "of", "readonly", "satisfies", "type", "keyof",
  "string", "number", "boolean", "any", "unknown", "never", "undefined",
]);

// A `/` that cannot open a regex: `/>` closes a JSX element, `/=` is an
// assignment operator, and a regex effectively never starts with whitespace at
// a position where JSX makes the alternative reading plausible. Misreading a
// regex as division only downgrades WHERE a control character is attributed
// (regex literal -> code); it never loses the hit.
function canStartRegex(next) {
  return next !== undefined && !/[\s>=]/.test(next);
}

// Lex `text` into contiguous regions, plus the facts sub-rules 2 and 3 need.
// Delimiters belong to the construct they open or close, so the code left over
// after masking is genuine code: for `` `a${x}b` `` the two template chunks
// (including the backticks, `${` and `}`) are TEMPLATE and only `x` is CODE.
function lex(text) {
  const n = text.length;
  const regions = [];
  const templates = [];    // { open, close|null, tagged }
  const escapes = [];      // { offset, seq } — backslash+digit in template TEXT
  let unterminated = null; // { kind, open }

  let i = 0;
  let codeStart = 0;
  let mode = CODE;
  let tplStart = 0;
  let tplRec = null;
  // Frames: { t:"tpl", rec } for a live template, { t:"sub", braces } for the
  // code inside a `${}` substitution.
  const stack = [];
  let prevOperand = false;

  const emitCode = (upto) => {
    if (upto > codeStart) regions.push({ start: codeStart, end: upto, kind: CODE });
  };

  while (i < n) {
    if (mode === TEMPLATE) {
      const c = text[i];
      if (c === "\\") {
        const d = text[i + 1];
        // `\\` is consumed as a pair here, which is precisely why the correct
        // doubling (`\\2013`) never reaches the digit test below.
        if (d !== undefined && d >= "0" && d <= "9") {
          escapes.push({ offset: i, seq: "\\" + d });
        }
        i += 2;
        continue;
      }
      if (c === "`") {
        regions.push({ start: tplStart, end: i + 1, kind: TEMPLATE });
        tplRec.close = i;
        stack.pop();
        i += 1;
        codeStart = i;
        mode = CODE;
        prevOperand = true;
        const top = stack[stack.length - 1];
        tplRec = top && top.t === "tpl" ? top.rec : null;
        continue;
      }
      if (c === "$" && text[i + 1] === "{") {
        regions.push({ start: tplStart, end: i + 2, kind: TEMPLATE });
        stack.push({ t: "sub", braces: 0 });
        i += 2;
        codeStart = i;
        mode = CODE;
        prevOperand = false;
        continue;
      }
      i += 1;
      continue;
    }

    // ---- code mode ----
    const c = text[i];

    if (c === "/" && text[i + 1] === "/") {
      emitCode(i);
      let j = i + 2;
      while (j < n && text[j] !== "\n") j++;
      regions.push({ start: i, end: j, kind: LINE_COMMENT });
      i = j;
      codeStart = i;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      emitCode(i);
      let j = i + 2;
      while (j < n && !(text[j] === "*" && text[j + 1] === "/")) j++;
      const end = j < n ? j + 2 : n;
      regions.push({ start: i, end, kind: BLOCK_COMMENT });
      if (j >= n) unterminated = unterminated || { kind: BLOCK_COMMENT, open: i };
      i = end;
      codeStart = i;
      continue;
    }
    if (c === "/" && !prevOperand && canStartRegex(text[i + 1])) {
      // Scan the candidate BEFORE closing the code region: a `/` that turns out
      // not to open a regex has to stay part of the surrounding code, and an
      // early emitCode would leave two overlapping regions behind.
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        const d = text[j];
        if (d === "\\") { j += 2; continue; }
        if (d === "\n") break;                 // unterminated — not a regex
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) { closed = true; j++; break; }
        j++;
      }
      if (closed) {
        emitCode(i);
        while (j < n && /[a-z]/.test(text[j])) j++;   // flags
        regions.push({ start: i, end: j, kind: REGEX });
        i = j;
        codeStart = i;
        prevOperand = true;
        continue;
      }
      // Not a regex after all — treat `/` as the operator it is.
      prevOperand = false;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      emitCode(i);
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const d = text[j];
        if (d === "\\") { j += 2; continue; }
        if (d === "\n") break;
        if (d === c) { closed = true; j++; break; }
        j++;
      }
      regions.push({ start: i, end: j, kind: STRING });
      if (!closed) unterminated = unterminated || { kind: STRING, open: i };
      i = j;
      codeStart = i;
      prevOperand = true;
      continue;
    }
    if (c === "`") {
      emitCode(i);
      // A template is TAGGED when an operand precedes it (String.raw`...`,
      // css`...`, styled.div`...`). Only String.raw is exempt from the escape
      // rule — its whole point is the raw text; a css`` tag is exactly the
      // render path this rule cares about.
      const before = text.slice(Math.max(0, i - 64), i);
      const tagM = before.match(/([A-Za-z_$][\w$.]*)\s*$/);
      const tagged = prevOperand ? (tagM ? tagM[1] : "?") : null;
      tplRec = { open: i, close: null, tagged };
      templates.push(tplRec);
      stack.push({ t: "tpl", rec: tplRec });
      tplStart = i;
      i += 1;
      mode = TEMPLATE;
      continue;
    }
    if (c === "}") {
      const top = stack[stack.length - 1];
      if (top && top.t === "sub") {
        if (top.braces === 0) {
          emitCode(i);
          stack.pop();
          const t = stack[stack.length - 1];
          tplRec = t && t.t === "tpl" ? t.rec : null;
          tplStart = i;              // the `}` belongs to the template region
          i += 1;
          mode = TEMPLATE;
          continue;
        }
        top.braces -= 1;
      }
      prevOperand = true;
      i += 1;
      continue;
    }
    if (c === "{") {
      const top = stack[stack.length - 1];
      if (top && top.t === "sub") top.braces += 1;
      prevOperand = false;
      i += 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(text[j])) j++;
      prevOperand = !REGEX_PRECEDERS.has(text.slice(i, j));
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && /[\w.]/.test(text[j])) j++;
      prevOperand = true;
      i = j;
      continue;
    }
    if (/\s/.test(c)) { i += 1; continue; }
    prevOperand = c === ")" || c === "]";
    i += 1;
  }

  if (mode === TEMPLATE) {
    regions.push({ start: tplStart, end: n, kind: TEMPLATE });
    const openFrame = stack.filter((f) => f.t === "tpl").pop();
    unterminated = { kind: TEMPLATE, open: openFrame ? openFrame.rec.open : tplStart };
  } else {
    emitCode(n);
  }

  regions.sort((a, b) => a.start - b.start);
  return { regions, templates, escapes, unterminated };
}

// The lexed source with every literal body and comment blanked to spaces —
// newlines preserved so offsets and line numbers still line up. This is what
// the taint pass reads, so a sink name that only appears inside a string or a
// comment is not mistaken for a call.
function maskLiterals(text, regions) {
  const out = [];
  let cursor = 0;
  for (const r of regions) {
    if (r.start > cursor) out.push(text.slice(cursor, r.start));
    const body = text.slice(Math.max(r.start, cursor), r.end);
    out.push(r.kind === CODE ? body : body.replace(/[^\n]/g, " "));
    cursor = Math.max(cursor, r.end);
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out.join("");
}

// ---- Render-path reachability ----------------------------------------------
//
// Sinks that put bytes in front of a person: an HTTP response body, a DOM
// write, a server-side render, an outgoing mail body.
const SINK_CALL =
  /\b(?:new\s+(?:Response|NextResponse)|Response\.json|NextResponse\.(?:json|rewrite)|(?:res|reply|response|ctx|c)\.(?:send|write|end|json|html|render|type|body)|render(?:ToString|ToStaticMarkup|ToReadableStream|ToPipeableStream)|document\.write|sendMail|writeHead)\s*\(/g;
// Assignment-shaped sinks: the body is everything up to the end of statement.
const SINK_ASSIGN =
  /(?:\.(?:innerHTML|outerHTML)\s*=|dangerouslySetInnerHTML\s*[:=]|\b(?:ctx|context|c)\.body\s*=|\bhtml\s*:)/g;

const IDENT_G = /[A-Za-z_$][\w$]*/g;
// An initializer region starts AT the `=` (or the `:`), never after it. A
// trailing `\s*` would swallow the blank lines a masked multi-line template
// collapses to, and the region would then begin PAST the literal it is meant to
// own — which is precisely the case this rule cares about.
const DECL_G = /(?:(?:const|let|var)\s+|^\s*|[{,(]\s*)([A-Za-z_$][\w$]*)\s*(?::\s*[^=;{}()]{0,60})?=(?!=)/gm;
const PROP_G = /([A-Za-z_$][\w$]*)\s*:/g;

const STMT_CAP = 20000;
const STMT_BREAK = /^\s*(?:const|let|var|function|class|export|import|return|if|for|while|switch|try|\})/;

// End of the statement starting at `from`, in masked code. A `;` at depth zero
// ends it; so does a line that starts a new statement. A newline alone does
// NOT, because a blanked multi-line template literal is nothing but newlines
// and its initializer has to keep containing it.
function statementEnd(masked, from) {
  const cap = Math.min(masked.length, from + STMT_CAP);
  let depth = 0;
  let i = from;
  while (i < cap) {
    const c = masked[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") { if (depth === 0) return i; depth--; }
    else if (c === ";" && depth === 0) return i;
    else if (c === "\n" && depth === 0) {
      const lineStart = i + 1;
      const nl = masked.indexOf("\n", lineStart);
      const line = masked.slice(lineStart, nl === -1 ? cap : nl);
      if (STMT_BREAK.test(line)) return i;
    }
    i++;
  }
  return cap;
}

function identsIn(s) {
  const out = [];
  IDENT_G.lastIndex = 0;
  let m;
  while ((m = IDENT_G.exec(s))) if (!KEYWORDS.has(m[0])) out.push(m[0]);
  return out;
}

// Argument region of the call whose `(` sits at `open`, balanced.
function callArgs(masked, open) {
  let depth = 0;
  for (let i = open; i < masked.length && i < open + STMT_CAP; i++) {
    const c = masked[i];
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return [open + 1, i]; }
  }
  return [open + 1, Math.min(masked.length, open + 400)];
}

// Which identifiers reach a response sink, and where the sink bodies are.
// Seeded from the sink's own arguments and propagated BACKWARDS through
// assignments: if `HTML` reaches a sink and `HTML` was built from `STYLES`,
// then `STYLES` reaches it too.
function renderReach(masked) {
  const regions = [];
  const seeds = new Set();

  SINK_CALL.lastIndex = 0;
  let m;
  while ((m = SINK_CALL.exec(masked))) {
    const open = masked.lastIndexOf("(", m.index + m[0].length - 1);
    if (open < m.index) continue;
    const [s, e] = callArgs(masked, open);
    regions.push([s, e]);
    for (const id of identsIn(masked.slice(s, e))) seeds.add(id);
  }
  SINK_ASSIGN.lastIndex = 0;
  while ((m = SINK_ASSIGN.exec(masked))) {
    const s = m.index + m[0].length;
    const e = statementEnd(masked, s);
    regions.push([s, e]);
    for (const id of identsIn(masked.slice(s, e))) seeds.add(id);
  }

  // name -> initializer regions
  const defs = new Map();
  const addDef = (name, s, e) => {
    if (KEYWORDS.has(name)) return;
    let a = defs.get(name);
    if (!a) defs.set(name, (a = []));
    if (a.length < 32) a.push([s, e]);
  };
  DECL_G.lastIndex = 0;
  while ((m = DECL_G.exec(masked))) {
    const s = m.index + m[0].length;
    addDef(m[1], s, statementEnd(masked, s));
  }

  const tainted = new Set(seeds);
  const queue = [...seeds];
  let budget = 20000;
  while (queue.length && budget-- > 0) {
    const name = queue.pop();
    for (const [s, e] of defs.get(name) || []) {
      for (const id of identsIn(masked.slice(s, e))) {
        if (!tainted.has(id)) { tainted.add(id); queue.push(id); }
      }
    }
  }

  // Owner lookup needs object properties too (`{ html: STYLES }`), but those
  // must not widen the taint set above, so they are added after the fixpoint.
  PROP_G.lastIndex = 0;
  while ((m = PROP_G.exec(masked))) {
    const s = m.index + m[0].length;
    addDef(m[1], s, statementEnd(masked, s));
  }

  return { tainted, regions, defs };
}

// The binding a literal at `offset` belongs to: the innermost initializer that
// contains it.
function ownerOf(reach, offset) {
  let best = null;
  let bestStart = -1;
  for (const [name, spans] of reach.defs) {
    for (const [s, e] of spans) {
      if (offset >= s && offset < e && s > bestStart) { bestStart = s; best = name; }
    }
  }
  return best;
}

function onRenderPath(reach, offset) {
  for (const [s, e] of reach.regions) if (offset >= s && offset < e) return true;
  const owner = ownerOf(reach, offset);
  return owner !== null && reach.tainted.has(owner);
}

// ---- Reporting helpers ------------------------------------------------------

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}
function lineOf(starts, offset) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

function codePointName(cp) {
  return "U+" + cp.toString(16).toUpperCase().padStart(4, "0");
}

// Render control characters visibly. Emitting the raw byte would corrupt the
// `file|line|tier|key|snippet` pipe this contract is read from — the #199
// incident is literally a NUL in a source line.
function visible(s) {
  return s.replace(CTRL_G, (ch) => {
    const cp = ch.codePointAt(0);
    return cp <= 0xff
      ? "\\x" + cp.toString(16).toUpperCase().padStart(2, "0")
      : "\\u" + cp.toString(16).toUpperCase().padStart(4, "0");
  });
}
function snippetAt(text, starts, line, note) {
  const start = starts[line - 1];
  const end = line < starts.length ? starts[line] - 1 : text.length;
  let src = visible(text.slice(start, end)).trim().slice(0, 120);
  if (note) src += " [" + note + "]";
  return src.replace(/\|/g, "/").replace(/\s+/g, " ");
}

// ---- Sub-rule 3: which backtick was the stray one ---------------------------
//
// The gate is decidable and costs nothing: a file that ends INSIDE a template
// literal is lexically broken, and an odd raw backtick count says the same
// thing independently. Only when both agree do we look for the cause, so the
// diagnosis below never fires on a healthy file.
//
// The cause is a template CLOSE followed by text that cannot follow a JS
// expression but reads perfectly as the CSS or comment content it really is.
const IMPOSSIBLE_FOLLOWERS = [
  /^\*\//,                                             // we were inside a comment
  /^@(?:media|supports|keyframes|import|font-face|layer)\b/,
  /^[A-Za-z-]{2,}\s*:\s*[^;{}\n]{1,80};/,              // a CSS declaration
  /^[.#][A-Za-z_-][^{};\n]{0,80}\{/,                   // .sel { / #sel {
  /^[A-Za-z][\w-]*(?:\s*[:.#[][^{};\n]{0,60})?\s*\{/,  // el::before { / a:hover {
];

function diagnoseStrayBacktick(text, templates) {
  for (const t of templates) {
    if (t.close === null) continue;
    const after = text.slice(t.close + 1, t.close + 200).replace(/^\s+/, "");
    if (IMPOSSIBLE_FOLLOWERS.some((re) => re.test(after))) return t.close;
  }
  return null;
}

// ---- Scan -------------------------------------------------------------------

// An explicit single FILE argument is scanned as-is; a directory goes through
// the shared scan-set decision. That affordance matters for this rule in
// particular: the stray-backtick diagnosis is something you run on the one file
// the compiler is complaining about. Path-based skips only apply to the
// directory walk, so a fixture can be checked directly.
function targets(target) {
  const env = process.env.LATTICE_SCAN_FILES;
  if (!env || !env.trim()) {
    try { if (fs.statSync(target).isFile()) return { files: [target], explicit: true }; }
    catch { /* not a path we can stat — treat as a walk root */ }
  }
  return { files: scanTargets(target, EXTS), explicit: false };
}

const { files: TARGETS, explicit } = targets(root);

let count = 0;
for (const file of TARGETS) {
  const norm = file.replace(/\\/g, "/");
  if (!explicit && TEST_RE.test(norm) && !FIXTURE_RE.test(norm)) continue;
  let text;
  try {
    if (fs.statSync(file).size > MAX_BYTES) continue;
    text = fs.readFileSync(file, "utf8");
  } catch { continue; }
  if (!text) continue;

  const { regions, templates, escapes, unterminated } = lex(text);
  const starts = lineIndex(text);
  let reach = null;
  const reachable = (offset) => {
    if (!reach) reach = renderReach(maskLiterals(text, regions));
    return onRenderPath(reach, offset);
  };

  const kindAt = (offset) => {
    let lo = 0, hi = regions.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = regions[mid];
      if (offset < r.start) hi = mid - 1;
      else if (offset >= r.end) lo = mid + 1;
      else return r.kind;
    }
    return CODE;
  };

  const hits = [];
  const seen = new Set();
  const add = (line, tier, key, note) => {
    const dedupe = line + "|" + key;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    hits.push({ line, tier, key, snippet: snippetAt(text, starts, line, note) });
  };

  // --- Sub-rule 1: literal control characters ---
  CTRL_G.lastIndex = 0;
  let m;
  while ((m = CTRL_G.exec(text))) {
    const offset = m.index;
    const kind = kindAt(offset);
    const name = codePointName(m[0].codePointAt(0));
    let tier;
    let where;
    if (kind === LINE_COMMENT || kind === BLOCK_COMMENT) {
      tier = "LOW";
      where = "in a comment";
    } else if (kind === CODE) {
      tier = "MEDIUM";
      where = "in code";
    } else {
      const rendered = reachable(offset);
      tier = rendered ? "HIGH" : "MEDIUM";
      where =
        "in a " +
        (kind === TEMPLATE ? "template literal" : kind === REGEX ? "regex literal" : "string literal") +
        (rendered ? ", on a render path" : "");
    }
    add(lineOf(starts, offset), tier, "ctrl-" + name, "literal " + name + " " + where);
  }

  // --- Sub-rule 2: backslash + digit inside template TEXT ---
  for (const e of escapes) {
    const tpl = templates.find((t) => e.offset > t.open && (t.close === null || e.offset < t.close));
    if (tpl && tpl.tagged === "String.raw") continue;   // raw text is the point
    const d = e.seq[1];
    const next = text[e.offset + 2] || "";
    // A LONE `\0` — nothing hex behind it — is the deliberate NUL idiom: a
    // `-z` protocol separator, a record delimiter on a pipe. The defect this
    // sub-rule is after always has the REST of the escape following it
    // (`\0a0`, `\2013`), because the author wrote a multi-character CSS or
    // unicode escape and JS ate the first one-to-three characters of it. That
    // is a fact about the source, so it is read from the source — not from a
    // "this one is intentional" comment a real bug could also carry.
    if (d === "0" && !HEX_DIGIT.test(next)) continue;
    // The whole escape the author meant to write, so the finding can quote it
    // and quote the doubled form that fixes it.
    const run = (text.slice(e.offset, e.offset + 16).match(/^\\[0-9][0-9a-fA-F]*/) || [e.seq])[0];
    let key;
    let what;
    if (d === "0" && !(next >= "0" && next <= "9")) {
      key = "nul-escape";
      what = run + " decodes to NUL before CSS sees it";
    } else if (d >= "8") {
      key = "bad-escape";
      what = run + " is not a valid escape (TS1487)";
    } else {
      key = "octal-escape";
      what = run + " decodes to a legacy octal escape before CSS sees it";
    }
    const tier = reachable(e.offset) ? "HIGH" : "MEDIUM";
    add(lineOf(starts, e.offset), tier, key, what + "; write \\" + run);
  }

  // --- Sub-rule 3: the stray backtick that broke the file ---
  if (unterminated && unterminated.kind === TEMPLATE) {
    const ticks = (text.match(/`/g) || []).length;
    if (ticks % 2 === 1) {
      const openLine = lineOf(starts, unterminated.open);
      const stray = diagnoseStrayBacktick(text, templates);
      if (stray !== null) {
        add(
          lineOf(starts, stray),
          "MEDIUM",
          "stray-backtick",
          "this backtick ends the template literal early; the compiler reports it at line " + openLine
        );
      } else {
        add(openLine, "MEDIUM", "unterminated-template", "template literal is never closed");
      }
    }
  }

  // Emit in ascending line order: `audit-core` derives finding slugs (and their
  // -1/-2 disambiguating suffixes) from emission order, so a stable order keeps
  // slugs stable across runs.
  hits.sort((a, b) => a.line - b.line || a.key.localeCompare(b.key));
  for (const h of hits) {
    console.log([file, h.line, h.tier, h.key, h.snippet].join("|"));
    count++;
  }
}

console.error(`# control-char-in-output: ${count} hit(s)`);
