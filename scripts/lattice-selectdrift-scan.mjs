#!/usr/bin/env node
// Deterministic select-drift scanner — core/select-shape-drift (#196, dimension: quality).
//
// Flags two or more `select: { … }` projections of the SAME Prisma model whose
// key sets are near-identical but not equal. That is a hand-copied query that
// has since drifted: one copy learned a field the others never did.
//
// The incident behind the rule (#196, 2026-08-21): three endpoints built the
// same response object from hand-copied `prisma.result` selects. A field was
// added to exactly ONE of them. The consuming UI guarded on it
// (`{r.bookingId ? … : null}` — correct, since some rows legitimately lack it),
// so the missing field did not throw, did not log and did not fail a test. A
// button shipped to production invisible and an endpoint shipped with no
// working caller. Found by a screenshot.
//
// PURE STRUCTURE, NOT HEURISTIC — this rule reads no semantics and guesses
// nothing from identifier spelling. It extracts the top-level key set of every
// select block, groups the blocks by model, and compares the sets:
//
//     similarity = |A ∩ B| / |A ∪ B|          (Jaccard)
//     drift      = similarity >= threshold AND A != B
//
// The finding IS the symmetric difference — the keys on one side and not the
// other. Equal sets are duplication, not drift, and are silent by construction;
// unrelated projections of the same model fall below the threshold on the same
// arithmetic. Default threshold 0.70, overridable (see below) — it is the
// rule's only tunable, and nothing else in the decision is tunable at all.
//
// Because the verdict is set arithmetic over sets that are written out in the
// source, the rule needs NO schema facts to reach it. The schema is used only
// to sharpen WHICH blocks belong together:
//   1. it canonicalizes model identity, so `prisma.result` and a
//      `Prisma.ResultSelect` constant land in one group;
//   2. it resolves a nested relation select (`select: { booking: { select: … } }`)
//      to the model that select is actually on;
//   3. it rejects a `select:` whose keys are not that model's fields — the
//      cheap proof that a `.select` on some non-Prisma object is not a query;
//   4. two services in a monorepo that each declare a `Result` are kept apart,
//      because the group key carries the schema the file resolves against.
// A project with no discoverable schema still gets the top-level findings: the
// accessor names the model, and set comparison does the rest.
//
// A block whose shape is not statically decidable — a spread (`...base`), a
// computed key, a `select: SHARED_CONST` reference, a conditional value — is
// dropped from the corpus entirely, never partially read. Extracting a shared
// constant is the FIX for this rule, so a select that already went through one
// must not be reported as drifting from itself.
//
// Threshold configuration (env > config.yml > default), same precedence the
// tenant scanner established for its tenant keys:
//   1. env LATTICE_SELECT_DRIFT_THRESHOLD="0.8"
//   2. .lattice/config.yml line `select_drift_threshold: 0.8`
//   3. 0.70
//
// Output: one `file|line|tier|key|snippet` per hit on stdout; a count on
// stderr. Tier is LOW by design — the issue asked for a one-line note, not a
// blocking finding. The line is the drifted select; the snippet names the
// block it drifts from and the symmetric difference in both directions.
// Registry line (registration itself is not this file's business):
//   select-shape-drift|lattice-selectdrift-scan.mjs|quality
//
// The scan set (walk vs. LATTICE_SCAN_FILES, node_modules, .gitignore) is not
// this rule's business — it comes from the shared decision in
// lattice-scan-ignore.mjs (#132). One consequence is worth stating: the corpus
// a block is compared against IS the scan set, so a diff-scoped run
// (`audit-core --changed`) compares the changed files against each other. The
// full-tree run is the one that sees drift against an untouched endpoint.

import fs from "fs";
import path from "path";
import { scanTargets } from "./lattice-scan-ignore.mjs";

const root = process.argv[2] || ".";

const EXTS = new Set([".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs"]);
// Tests and generated clients copy selects on purpose — a fixture IS a copy.
const SKIP_FILE_RE =
  /(\.spec\.|\.test\.|_test\.|\/tests?\/|\/__tests__\/|\/migrations?\/|\.migration\.|\.d\.ts$)/;
// Scanner fixtures (intentional sample files) live under a `fixtures/` dir that
// may itself sit beneath `test/`. Those must be scanned, so a `fixtures/`
// segment overrides the skip above (cf. lattice-rowrewrite-scan.mjs).
const FIXTURE_RE = /\/fixtures?\//;

// ---- Threshold configuration ----------------------------------------------

const DEFAULT_THRESHOLD = 0.7;

function loadThreshold() {
  const parse = (raw) => {
    const n = Number(String(raw).trim());
    // A threshold outside (0,1) would make every pair — or no pair — drift.
    return Number.isFinite(n) && n > 0 && n < 1 ? n : null;
  };
  const env = process.env.LATTICE_SELECT_DRIFT_THRESHOLD;
  if (env && env.trim()) {
    const t = parse(env);
    if (t !== null) return t;
  }
  try {
    const cfg = fs.readFileSync(path.join(root, ".lattice", "config.yml"), "utf8");
    const m = cfg.match(/^\s*select_drift_threshold:\s*(.+)$/m);
    if (m) {
      const t = parse(m[1].replace(/^["']|["']$/g, ""));
      if (t !== null) return t;
    }
  } catch { /* no config — fall through */ }
  return DEFAULT_THRESHOLD;
}

const THRESHOLD = loadThreshold();

// ---- Prisma schema awareness ----------------------------------------------
//
// Discovery is the contract the tenant scanner established in #195 and the
// row-rewrite scanner reuses: per-FILE, memoized per directory, walking up from
// the file's own directory so a monorepo resolves each service against its own
// schema, stopping at a `.git` boundary so a scan never reaches out of the
// project. Locations, in order:
//   env LATTICE_PRISMA_SCHEMA          (a .prisma file OR a folder of them)
//   <dir>/prisma/schema.prisma
//   <dir>/prisma/schema/**.prisma      (Prisma 6+ multi-file schema folder)
//   <dir>/schema.prisma
//   package.json `"prisma": { "schema": … }`  /  prisma.config.* `schema: "…"`
//
// What this rule needs from the schema is a projection index: per model, the
// scalar field names it can select, and every relation field mapped to the
// model it points at (which is how a nested select is attributed).

const SCHEMA_MAX_UP = 24;          // hard bound on the upward walk
const SCHEMA_MEMO = new Map();     // dir -> { id, models } | null

function isFile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

// Every `*.prisma` under a schema FOLDER (Prisma's multi-file schema layout).
function prismaFilesIn(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) prismaFilesIn(p, out);
    else if (e.name.endsWith(".prisma")) out.push(p);
  }
  return out;
}

// A configured path may be a single file or a folder of schema files.
function schemaPathFiles(p) {
  if (isDir(p)) return prismaFilesIn(p);
  return isFile(p) ? [p] : [];
}

// Schema locations the project declares about itself.
function declaredSchemaPaths(dir) {
  const out = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    if (pkg && pkg.prisma && typeof pkg.prisma.schema === "string") {
      out.push(path.resolve(dir, pkg.prisma.schema));
    }
  } catch { /* absent or unparseable — not a schema signal */ }
  for (const name of ["prisma.config.ts", "prisma.config.mts", "prisma.config.js", "prisma.config.mjs"]) {
    let text;
    try { text = fs.readFileSync(path.join(dir, name), "utf8"); } catch { continue; }
    const m = text.match(/\bschema\s*:\s*["'`]([^"'`]+)["'`]/);
    if (m) out.push(path.resolve(dir, m[1]));
  }
  return out;
}

function schemaFilesAt(dir) {
  const files = [];
  const single = path.join(dir, "prisma", "schema.prisma");
  if (isFile(single)) files.push(single);
  files.push(...prismaFilesIn(path.join(dir, "prisma", "schema")));
  const flat = path.join(dir, "schema.prisma");
  if (isFile(flat)) files.push(flat);
  for (const p of declaredSchemaPaths(dir)) files.push(...schemaPathFiles(p));
  return [...new Set(files)];
}

// Prisma's grammar has line comments only (`//`, `///`). Strip them outside
// string literals so an attribute like `@default("https://x")` survives.
function stripPrismaComments(text) {
  let out = "", quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      out += c;
      if (c === "\\") { out += text[i + 1] ?? ""; i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; out += c; continue; }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    out += c;
  }
  return out;
}

// The `{ … }` body opened by the brace at `open`, or "" when it never closes.
function braceBody(text, open) {
  let depth = 0;
  for (let j = open; j < text.length; j++) {
    if (text[j] === "{") depth++;
    else if (text[j] === "}") { depth--; if (depth === 0) return text.slice(open + 1, j); }
  }
  return "";
}

// One `model`/`view` body -> the names it can project. Prisma fields are
// line-oriented, so a line IS the unit:
//   narrative   String
//   booking     Booking   @relation(fields: [bookingId], references: [id])
// A field whose TYPE is a declared model is a relation — which is why model
// names are collected in a first pass before any body is parsed.
function parseModelBody(body, modelNames) {
  const fields = new Set();          // selectable scalars
  const relations = new Map();       // relation field -> target model name
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("@@")) continue;    // block attributes
    const fm = line.match(/^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)(\[\])?(\?)?/);
    if (!fm) continue;
    const [, name, type] = fm;
    if (modelNames.has(type)) relations.set(name, type);
    else fields.add(name);
  }
  return { fields, relations };
}

function parseSchemaFiles(files) {
  const texts = [];
  for (const f of files) {
    try { texts.push(stripPrismaComments(fs.readFileSync(f, "utf8"))); } catch { /* unreadable */ }
  }
  if (!texts.length) return null;

  // Pass 1: every declared model/view name, across all schema files. A field's
  // type can only be classified as relation-vs-scalar once this set is whole.
  const modelNames = new Set();
  for (const t of texts) {
    const re = /(?:^|\n)\s*(?:model|view)\s+([A-Za-z_]\w*)\s*\{/g;
    let m;
    while ((m = re.exec(t))) modelNames.add(m[1]);
  }

  // Pass 2: bodies, indexed by the Prisma Client accessor. `model ResultToken`
  // is exposed as `prisma.resultToken` — the model name with a lower-cased
  // first letter. An all-lowercase alias is added too so an oddly-cased
  // accessor still resolves. `name` carries the declared spelling back, so a
  // finding says `Result`, not `result`.
  const models = new Map();
  for (const t of texts) {
    const re = /(?:^|\n)\s*(?:model|view)\s+([A-Za-z_]\w*)\s*\{/g;
    let m;
    while ((m = re.exec(t))) {
      const open = re.lastIndex - 1;
      const body = braceBody(t, open);
      re.lastIndex = open + body.length + 2;
      const parsed = { name: m[1], ...parseModelBody(body, modelNames) };
      models.set(m[1][0].toLowerCase() + m[1].slice(1), parsed);
      if (!models.has(m[1].toLowerCase())) models.set(m[1].toLowerCase(), parsed);
    }
  }
  return models.size ? models : null;
}

// A schema is identified by the files it was parsed from, so two services in a
// monorepo never share a comparison group even when both declare a `Result`.
function loadSchema(files) {
  const models = parseSchemaFiles(files);
  return models ? { id: files.slice().sort().join("\x00"), models } : null;
}

// An explicit env override short-circuits discovery entirely.
const SCHEMA_OVERRIDE = (() => {
  const p = process.env.LATTICE_PRISMA_SCHEMA;
  if (!p || !p.trim()) return null;
  return loadSchema(schemaPathFiles(path.resolve(p.trim())));
})();

// The schema governing `file`, or null when the project has none.
function schemaForFile(file) {
  if (SCHEMA_OVERRIDE) return SCHEMA_OVERRIDE;
  let dir = path.dirname(path.resolve(file));
  const seen = [];
  let result = null;
  for (let up = 0; up < SCHEMA_MAX_UP; up++) {
    if (SCHEMA_MEMO.has(dir)) { result = SCHEMA_MEMO.get(dir); break; }
    seen.push(dir);
    const found = schemaFilesAt(dir);
    if (found.length) { result = loadSchema(found); break; }
    // Stop at the repo boundary — a scan must not resolve a schema outside it.
    if (isDir(path.join(dir, ".git")) || isFile(path.join(dir, ".git"))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const d of seen) SCHEMA_MEMO.set(d, result);
  return result;
}

// ---- Source masking --------------------------------------------------------
//
// This rule reasons about SPANS — a call's arguments, an object literal, one
// key's value — so every brace it counts has to be real code. Comment bodies,
// string literals and regex literals are blanked (length and newlines
// preserved, so an offset in the masked text indexes the original exactly). A
// `{` inside a message string can then never unbalance a span, and the
// original text is still there when a quoted key's NAME has to be read back.
//
// Known limit: a template literal is blanked WHOLE, interpolations included, so
// a select written inside `${…}` is invisible to this rule. That is the safe
// direction — it costs recall, never precision.

const REGEX_PREV = /[=(,:[!&|?{};+\-*%~^<>]/;
const REGEX_KEYWORDS = new Set([
  "return", "typeof", "case", "in", "of", "new", "do", "else", "yield",
  "await", "delete", "void", "throw",
]);

// Does the `/` at `i` open a regex literal (rather than divide)? Decided from
// the previous significant character, the standard lexer disambiguation.
function startsRegex(src, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  if (j < 0) return true;
  if (REGEX_PREV.test(src[j])) return true;
  const word = src.slice(Math.max(0, j - 9), j + 1).match(/[A-Za-z]+$/);
  return !!word && REGEX_KEYWORDS.has(word[0]);
}

function maskLiterals(src) {
  const out = src.split("");
  const blank = (a, b) => {
    for (let k = Math.max(0, a); k < b && k < out.length; k++) {
      if (out[k] !== "\n") out[k] = " ";
    }
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      let j = i;
      while (j < src.length && src[j] !== "\n") j++;
      blank(i, j); i = j; continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      let j = i + 2;
      while (j < src.length && !(src[j] === "*" && src[j + 1] === "/")) j++;
      blank(i, Math.min(j + 2, src.length)); i = j + 2; continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === c) break;
        if (c !== "`" && src[j] === "\n") break;   // unterminated quote — stop at EOL
        j++;
      }
      blank(i + 1, j); i = j + 1; continue;
    }
    if (c === "/" && startsRegex(src, i)) {
      let j = i + 1, cls = false;
      while (j < src.length && src[j] !== "\n") {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "[") cls = true;
        else if (src[j] === "]") cls = false;
        else if (src[j] === "/" && !cls) break;
        j++;
      }
      blank(i + 1, j); i = j + 1; continue;
    }
    i++;
  }
  return out.join("");
}

// ---- Span helpers ----------------------------------------------------------
//
// Every helper works on the MASKED text and returns ABSOLUTE offsets, so a
// nested select keeps its own line number all the way down the recursion.

// Index of the `}` matching the `{` at `open`, or -1 when unbalanced.
function matchBrace(masked, open) {
  let depth = 0;
  for (let j = open; j < masked.length; j++) {
    if (masked[j] === "{") depth++;
    else if (masked[j] === "}") { depth--; if (depth === 0) return j; }
  }
  return -1;
}

// The argument text span of the call whose `(` sits at `open`, or null when the
// call never closes (nothing to reason about, so the caller skips).
function callArgs(masked, open) {
  let depth = 0;
  for (let j = open; j < masked.length; j++) {
    const c = masked[j];
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return { start: open + 1, end: j }; }
  }
  return null;
}

// End offset of the value that starts at `start`: balanced across {} [] () and
// stopped at this value's own top-level comma or at `limit`.
function valueEnd(masked, start, limit) {
  let curly = 0, square = 0, round = 0;
  for (let j = start; j < limit; j++) {
    const c = masked[j];
    if (c === "{") curly++;
    else if (c === "}") { if (curly === 0) return j; curly--; }
    else if (c === "[") square++;
    else if (c === "]") { if (square === 0) return j; square--; }
    else if (c === "(") round++;
    else if (c === ")") { if (round === 0) return j; round--; }
    else if (c === "," && !curly && !square && !round) return j;
  }
  return limit;
}

// Top-level entries of the object literal whose `{` sits at `open`, as
// `{ name, start, end }` with absolute offsets — or null when the shape is not
// statically decidable. null means "unknown", never "empty": a spread, a
// computed key or a shorthand key makes the WHOLE block unreadable, and half a
// key set would compare as drift against its own complete copy.
//
// The key NAME is read from the original source because masking blanks the
// inside of a quoted key (`"id"` -> `"  "`); offsets are preserved by masking,
// so the two texts index identically.
function objectEntries(masked, orig, open) {
  const close = matchBrace(masked, open);
  if (close < 0) return null;
  const entries = [];
  let i = open + 1;
  while (i < close) {
    while (i < close && /[\s,]/.test(masked[i])) i++;
    if (i >= close) break;
    const km = /^(?:(["'])[^]*?\1|[A-Za-z_$][\w$]*)\s*:/.exec(masked.slice(i, close));
    if (!km) return null;                       // spread, computed key, shorthand
    const keyText = orig.slice(i, i + km[0].length).replace(/\s*:$/, "").trim();
    const name = keyText.replace(/^["']|["']$/g, "");
    if (!name) return null;
    let vs = i + km[0].length;
    while (vs < close && /\s/.test(masked[vs])) vs++;
    if (vs >= close) return null;
    const ve = valueEnd(masked, vs, close);
    // `keyAt` is where the KEY starts — the offset a finding points at, so a
    // `select:` whose brace opens on the next line still reports its own line.
    entries.push({ name, keyAt: i, start: vs, end: ve });
    i = ve + 1;
  }
  return entries;
}

// The object literal that starts at or just after `from` (skipping whitespace),
// or -1 when the next thing is not one.
function objectAt(masked, from, limit) {
  let i = from;
  while (i < limit && /\s/.test(masked[i])) i++;
  return i < limit && masked[i] === "{" ? i : -1;
}

// ---- Select blocks ---------------------------------------------------------

// Prisma delegate operations whose argument object accepts `select` (and, for
// the ones that read relations, `include`).
const SELECT_OPS = new Set([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany",
  "create", "createManyAndReturn", "update", "updateManyAndReturn", "upsert", "delete",
]);

// `prisma.result.findMany(` / `tx.resultToken.update(` — the segment left of the
// operation names the model. The accessor itself is deliberately NOT matched
// against a list of client names: which variable holds the client is a naming
// convention, and this rule does not read naming conventions.
const CALL_RE = new RegExp(
  "\\b[A-Za-z_$][\\w$]*(?:\\s*\\.\\s*[A-Za-z_$][\\w$]*)*?\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\.\\s*(" +
  [...SELECT_OPS].join("|") + ")\\s*\\(", "g"
);

// A generated select type names its model outright: `Prisma.ResultSelect`.
// Three spellings reach the same literal — an annotation, a `satisfies`, and
// `Prisma.validator<…>()( … )`.
const SELECT_TYPE_RE = /\bPrisma\s*\.\s*([A-Z]\w*)Select\b/g;

// Start offset of the `{` this select TYPE annotates, or -1.
function literalForSelectType(masked, afterType) {
  // `const s: Prisma.ResultSelect = { … }` / `Prisma.ResultSelect<ExtArgs> = { … }`
  const ahead = masked.slice(afterType, afterType + 200);
  const asAnnotation = /^\s*(?:<[^<>]*>)?\s*=(?!=|>)/.exec(ahead);
  if (asAnnotation) return objectAt(masked, afterType + asAnnotation[0].length, masked.length);
  // `Prisma.validator<Prisma.ResultSelect>()({ … })`
  const asValidator = /^\s*>\s*\(\s*\)\s*\(/.exec(ahead);
  if (asValidator) return objectAt(masked, afterType + asValidator[0].length, masked.length);
  // `{ … } satisfies Prisma.ResultSelect` — walk back over `satisfies` to the
  // literal's closing brace, then back to the brace that opened it.
  const behind = masked.slice(Math.max(0, afterType - 260), afterType);
  const sat = /\}\s*satisfies\s+Prisma\s*\.\s*[A-Z]\w*Select\s*$/.exec(behind);
  if (sat) {
    const closeAt = Math.max(0, afterType - 260) + sat.index;
    let depth = 0;
    for (let j = closeAt; j >= 0; j--) {
      if (masked[j] === "}") depth++;
      else if (masked[j] === "{") { depth--; if (depth === 0) return j; }
    }
  }
  return -1;
}

// The key set of the select object at `open`, or null when it is not decidable
// or not a projection of `model`. Nested relation selects are pushed onto
// `pending` with the model the schema says they are on.
//
// Prisma semantics decide membership, not appearance: `field: false` is NOT
// selected, `field: true` is, and a relation key with an object value is a
// selected field AND a select block of its own. Anything else — a variable, a
// ternary, a spread — makes the block undecidable.
function selectKeys(ctx, model, open, pending, extracted) {
  const entries = objectEntries(ctx.masked, ctx.orig, open);
  if (!entries) return null;
  if (!entries.length) return null;
  const entry = ctx.schema ? (ctx.schema.models.get(model) || ctx.schema.models.get(model.toLowerCase())) : null;
  const keys = new Set();
  for (const e of entries) {
    // The schema knows this model, so a key it does not declare proves the
    // object is not a select on it — some other library's `.select`, or a
    // client extension. Undecidable, not a finding.
    if (entry && !e.name.startsWith("_") && !entry.fields.has(e.name) && !entry.relations.has(e.name)) {
      return null;
    }
    const value = ctx.masked.slice(e.start, e.end).trim();
    if (value === "false") continue;                 // explicitly not projected
    if (value === "true") { keys.add(e.name); continue; }
    if (ctx.masked[e.start] === "{") {
      keys.add(e.name);
      // A relation key's object carries the nested projection. Attributing it
      // needs the schema — without one the nesting is simply not followed.
      const target = entry ? entry.relations.get(e.name) : null;
      if (target) {
        const sub = objectEntries(ctx.masked, ctx.orig, e.start);
        if (sub) {
          for (const s of sub) {
            if ((s.name === "select" || s.name === "include") && ctx.masked[s.start] === "{") {
              pending.push({
                model: target[0].toLowerCase() + target.slice(1),
                at: s.start, keyAt: s.keyAt, kind: s.name,
                extracted: extracted === true,
              });
            }
          }
        }
      }
      continue;
    }
    return null;                                     // dynamic value — unreadable
  }
  return keys.size ? keys : null;
}

// ---- Scan ------------------------------------------------------------------

// An explicit single FILE argument is scanned as-is (the self-test affordance);
// a directory goes through the shared scan-set decision. Path-based skips only
// apply to the directory walk, so a fixture can be checked directly.
function targets(target) {
  const env = process.env.LATTICE_SCAN_FILES;
  if (!env || !env.trim()) {
    try { if (fs.statSync(target).isFile()) return { files: [target], explicit: true }; }
    catch { /* not a path we can stat — treat as a walk root */ }
  }
  return { files: scanTargets(target, EXTS), explicit: false };
}

// Line number (1-based) of an offset, from a prefix table built once per file.
function lineTable(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return (off) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= off) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

const { files, explicit } = targets(root);

// The corpus: every decidable select block in the scan set, grouped by
// `<schema id>::<model accessor>`.
const groups = new Map();
let undecided = 0;

for (const file of files) {
  const norm = file.replace(/\\/g, "/");
  if (!explicit && SKIP_FILE_RE.test(norm) && !FIXTURE_RE.test(norm)) continue;
  let orig;
  try { orig = fs.readFileSync(file, "utf8"); } catch { continue; }
  if (!/select\s*:|Select\b/.test(orig)) continue;          // cheap reject

  const masked = maskLiterals(orig);
  const schema = schemaForFile(file);
  const ctx = { masked, orig, schema };
  const lines = orig.split(/\r?\n/);
  const lineOf = lineTable(orig);

  // `pending` is the work list: a select block to read, on a known model. Call
  // sites and typed constants seed it; nested relation selects extend it as
  // they are discovered, so one loop handles arbitrary nesting depth.
  const pending = [];

  CALL_RE.lastIndex = 0;
  let m;
  while ((m = CALL_RE.exec(masked))) {
    const [, model, op] = m;
    if (!SELECT_OPS.has(op)) continue;
    const span = callArgs(masked, CALL_RE.lastIndex - 1);
    if (!span) continue;
    CALL_RE.lastIndex = span.end;
    const argOpen = objectAt(masked, span.start, span.end);
    if (argOpen < 0) continue;
    const args = objectEntries(masked, orig, argOpen);
    if (!args) continue;
    for (const a of args) {
      if ((a.name === "select" || a.name === "include") && masked[a.start] === "{") {
        pending.push({ model, at: a.start, keyAt: a.keyAt, kind: a.name });
      }
    }
  }

  SELECT_TYPE_RE.lastIndex = 0;
  while ((m = SELECT_TYPE_RE.exec(masked))) {
    const at = literalForSelectType(masked, SELECT_TYPE_RE.lastIndex);
    if (at < 0) continue;
    // A constant annotated `Prisma.XSelect` is the EXTRACTED form — the shared
    // definition this rule exists to encourage. It is compared only against
    // other extracted constants (see groupKey below), never against the inline
    // literals it was extracted from, or adopting the fix would raise a finding.
    pending.push({ model: m[1][0].toLowerCase() + m[1].slice(1), at, keyAt: at, kind: "select", extracted: true });
  }

  const seen = new Set();
  while (pending.length) {
    const job = pending.shift();
    if (seen.has(job.at)) continue;
    seen.add(job.at);

    const entry = schema ? (schema.models.get(job.model) || schema.models.get(job.model.toLowerCase())) : null;
    // Gate — when the project HAS a schema, a model it does not declare is not
    // a Prisma model, so the `.findMany` was somebody else's method. Guessing
    // is exactly what this rule refuses to do.
    if (schema && !entry) { undecided++; continue; }

    // An `include` block is not a projection (it means "all scalars, plus
    // these"), so it contributes no key set — only the nested selects inside it.
    const keys = selectKeys(ctx, job.model, job.at, pending, job.extracted);
    if (job.kind === "include") continue;
    if (!keys) { undecided++; continue; }

    const groupKey = `${schema ? schema.id : ""}\x00${job.model.toLowerCase()}\x00${job.extracted ? "extracted" : "inline"}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { display: entry ? entry.name : job.model, blocks: [] });
    }
    const line = lineOf(job.keyAt ?? job.at);
    groups.get(groupKey).blocks.push({
      file, line, keys,
      sig: [...keys].sort().join(","),
      src: (lines[line - 1] || "").trim().slice(0, 90),
    });
  }
}

// ---- Drift ------------------------------------------------------------------

const jaccard = (a, b) => {
  let shared = 0;
  for (const k of a) if (b.has(k)) shared++;
  return { shared, sim: shared / (a.size + b.size - shared) };
};

const fmt = (list) => {
  if (!list.length) return "(none)";
  return list.slice(0, 6).join(", ") + (list.length > 6 ? `, +${list.length - 6} more` : "");
};

const hits = [];
for (const { display, blocks } of groups.values()) {
  // Order by site, not by walk order, so the pairing a finding reports is the
  // same whether the scan came from a walk or from LATTICE_SCAN_FILES.
  blocks.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));

  // One entry per DISTINCT key set. Identical copies are duplication, not
  // drift — this rule has nothing to say about them, and collapsing them here
  // is what keeps a select used in ten places from producing ten findings.
  const sigs = [];
  const bySig = new Map();
  for (const b of blocks) {
    if (bySig.has(b.sig)) continue;
    bySig.set(b.sig, b);
    sigs.push(b);
  }

  // Each drifted shape gets ONE note, naming its nearest earlier neighbour.
  // Linear in the number of distinct shapes, so a model with many projections
  // cannot flood the report with every pair of a clique.
  for (let i = 1; i < sigs.length; i++) {
    let best = null;
    for (let j = 0; j < i; j++) {
      const { shared, sim } = jaccard(sigs[i].keys, sigs[j].keys);
      if (sim >= THRESHOLD && (!best || sim > best.sim)) best = { sim, shared, peer: sigs[j] };
    }
    if (!best) continue;
    const here = [...sigs[i].keys].filter((k) => !best.peer.keys.has(k)).sort();
    const there = [...best.peer.keys].filter((k) => !sigs[i].keys.has(k)).sort();
    const union = sigs[i].keys.size + best.peer.keys.size - best.shared;
    hits.push({
      file: sigs[i].file,
      line: sigs[i].line,
      key: `${display}.select`,
      snippet: `${sigs[i].src} [drifts from ${best.peer.file}:${best.peer.line} — ` +
        `${best.shared}/${union} keys shared; here only: ${fmt(here)}; there only: ${fmt(there)}]`,
    });
  }
}

// Emit in ascending file/line order: `audit-core` derives finding slugs (and
// their -1/-2 disambiguating suffixes) from emission order, so a stable order
// keeps slugs stable across runs.
hits.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || a.key.localeCompare(b.key)));
for (const h of hits) {
  console.log([h.file, h.line, "LOW", h.key, h.snippet.replace(/\|/g, "/")].join("|"));
}

console.error(
  `# select-shape-drift: ${hits.length} hit(s) (threshold ${THRESHOLD})` +
  (undecided ? ` (${undecided} select block(s) undecided)` : "")
);
