#!/usr/bin/env node
// Deterministic row-rewrite scanner — core/row-rewrite-in-tx (#196, dimension: resilience).
//
// Flags a row holding durable, customer-facing identity being DELETED and
// re-CREATED inside one transaction — an upsert written as a rewrite. The
// create sets only the columns it names; every other column silently reverts
// to its schema default, and any generated identity (a `@default(uuid())`
// token that is already in a URL a customer holds) is minted anew while the
// link they were sent still points at the deleted row.
//
// The incident behind the rule (#196, 2026-08-20): a results pipeline ran
//     await tx.resultToken.deleteMany({ where: { result: { bookingId } } });
//     await tx.result.deleteMany({ where: { bookingId } });
//     // ...then created a fresh Result and a fresh ResultToken
// Five callers could trigger a re-run; each minted a NEW /r/:token, so the URL
// already sent to the customer pointed at a deleted row. The same delete
// silently discarded `retestReminderOptIn` (a choice the customer made),
// `retestReminderSentAt` (so the reminder could fire twice),
// `suggestionsDeliveryStatus` and the token's `viewCount`. No exception, no
// log, no failing test.
//
// DECIDABLE, NOT HEURISTIC — the schema already says which rows are meant to
// be transient. A child whose foreign key declares `onDelete: Cascade` dies
// with its parent by design, and replacing it wholesale is the documented
// pattern (in that repo: `BiomarkerValue`, `AiSuggestion`). A child being
// HAND-deleted to get past its own foreign key — no cascade on the relation —
// is the signature. So both gates are read from `prisma/schema.prisma`, never
// guessed from identifier spelling:
//   1. the model has no cascading FK   -> the row is durable, not transient
//   2. the create does not set every defaulted/nullable column -> real loss
// Both must hold. A model the schema does not declare — or a project with no
// schema at all — is UNDECIDED and is never reported; stderr says how many
// candidates were skipped that way. A required column with no default is left
// out of the loss set on purpose: omitting it fails LOUDLY, which is not this
// rule's failure mode.
//
// Output: one `file|line|tier|key|snippet` per hit on stdout; a count on
// stderr. The line is the DELETE — the statement to turn into an update/upsert
// — and the snippet names the columns that will silently reset.
// Registry line (registration itself is not this file's business):
//   row-rewrite-in-tx|lattice-rowrewrite-scan.mjs|resilience
//
// The scan set (walk vs. LATTICE_SCAN_FILES, node_modules, .gitignore) is not
// this rule's business — it comes from the shared decision in
// lattice-scan-ignore.mjs (#132).

import fs from "fs";
import path from "path";
import { scanTargets } from "./lattice-scan-ignore.mjs";

const root = process.argv[2] || ".";

const EXTS = new Set([".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs"]);
// Tests and migrations rewrite rows on purpose — a seed/backfill IS a rewrite.
const SKIP_FILE_RE =
  /(\.spec\.|\.test\.|_test\.|\/tests?\/|\/__tests__\/|\/migrations?\/|\.migration\.)/;
// Scanner fixtures (intentional sample files) live under a `fixtures/` dir that
// may itself sit beneath `test/`. Those must be scanned, so a `fixtures/`
// segment overrides the skip above (cf. lattice-resilience-scan.mjs).
const FIXTURE_RE = /\/fixtures?\//;

// ---- Prisma schema awareness ----------------------------------------------
//
// Discovery is the same contract the tenant scanner established in #195:
// per-FILE, memoized per directory, walking up from the file's own directory
// so a monorepo resolves each service against its own schema, stopping at a
// `.git` boundary so a scan never reaches out of the project. Locations, in
// order:
//   env LATTICE_PRISMA_SCHEMA          (a .prisma file OR a folder of them)
//   <dir>/prisma/schema.prisma
//   <dir>/prisma/schema/**.prisma      (Prisma 6+ multi-file schema folder)
//   <dir>/schema.prisma
//   package.json `"prisma": { "schema": … }`  /  prisma.config.* `schema: "…"`
//
// What this rule needs from the schema is richer than a key index: per model,
// every scalar column with its default/optionality, and every FK relation with
// its `onDelete` referential action.

const SCHEMA_MAX_UP = 24;          // hard bound on the upward walk
const SCHEMA_MEMO = new Map();     // dir -> parsed model index | null

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

// One `model`/`view` body -> its columns and its FK relations. Prisma fields
// are line-oriented, so a line IS the unit:
//   viewCount   Int       @default(0)
//   result      Result    @relation(fields: [resultId], references: [id])
// A field whose TYPE is a declared model is a relation, never a column — which
// is why model names are collected in a first pass before any body is parsed.
function parseModelBody(body, modelNames) {
  const fields = [];       // scalar columns, in declaration order
  const relations = [];    // FK-owning (child-side) relations
  const relFields = [];    // every relation field -> the model it points at
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("@@")) continue;    // block attributes
    const fm = line.match(/^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)(\[\])?(\?)?/);
    if (!fm) continue;
    const [, name, type, list, optional] = fm;
    const attrs = line.slice(fm[0].length);
    if (modelNames.has(type)) {
      // The field name a nested write uses (`data: { token: { create: … } }`)
      // is this relation field; the type is the model it creates.
      relFields.push({ field: name, model: type });
      // Only the side that declares `fields:` owns the FK, and only that side
      // can carry a referential action.
      const rm = attrs.match(/@relation\s*\(([^)]*)\)/);
      if (rm) {
        const fk = rm[1].match(/\bfields\s*:\s*\[([^\]]*)\]/);
        if (fk) {
          const od = rm[1].match(/\bonDelete\s*:\s*([A-Za-z]+)/);
          relations.push({
            field: name,
            fkFields: fk[1].split(",").map((s) => s.trim()).filter(Boolean),
            onDelete: od ? od[1] : null,
          });
        }
      }
      continue;
    }
    fields.push({
      name,
      list: !!list,
      optional: !!optional,
      hasDefault: /(^|[^@])@default\s*\(/.test(attrs),
      updatedAt: /(^|[^@])@updatedAt\b/.test(attrs),
    });
  }
  return { fields, relations, relFields };
}

function parseSchemaFiles(files) {
  const texts = [];
  for (const f of files) {
    try { texts.push(stripPrismaComments(fs.readFileSync(f, "utf8"))); } catch { /* unreadable */ }
  }
  if (!texts.length) return null;

  // Pass 1: every declared model/view name, across all schema files. A field's
  // type can only be classified as relation-vs-column once this set is whole.
  const modelNames = new Set();
  for (const t of texts) {
    const re = /(?:^|\n)\s*(?:model|view)\s+([A-Za-z_]\w*)\s*\{/g;
    let m;
    while ((m = re.exec(t))) modelNames.add(m[1]);
  }

  // Pass 2: bodies.
  const index = new Map();
  for (const t of texts) {
    const re = /(?:^|\n)\s*(?:model|view)\s+([A-Za-z_]\w*)\s*\{/g;
    let m;
    while ((m = re.exec(t))) {
      const open = re.lastIndex - 1;
      const body = braceBody(t, open);
      re.lastIndex = open + body.length + 2;
      const parsed = parseModelBody(body, modelNames);
      // Prisma Client exposes `model ResultToken` as `prisma.resultToken` —
      // the model name with a lower-cased first letter. An all-lowercase alias
      // is added too so an oddly-cased accessor still resolves.
      index.set(m[1][0].toLowerCase() + m[1].slice(1), parsed);
      if (!index.has(m[1].toLowerCase())) index.set(m[1].toLowerCase(), parsed);
    }
  }
  return index.size ? index : null;
}

// An explicit env override short-circuits discovery entirely.
const SCHEMA_OVERRIDE = (() => {
  const p = process.env.LATTICE_PRISMA_SCHEMA;
  if (!p || !p.trim()) return null;
  return parseSchemaFiles(schemaPathFiles(path.resolve(p.trim())));
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
    if (found.length) { result = parseSchemaFiles(found); break; }
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
// This rule reasons about SPANS — a transaction's argument list, a call's
// arguments, an object literal — so every brace/paren it counts has to be
// real code. Comment bodies, string literals and regex literals are blanked
// (length and newlines preserved, so an offset in the masked text indexes the
// original exactly). A `//` inside a URL or a `{` inside a message string can
// then never unbalance a span.
//
// Known limit: a template literal is blanked WHOLE, interpolations included, so
// a query written inside `${…}` is invisible to this rule. That is the safe
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

// The argument text of the call whose `(` sits at `open`, plus the offset just
// past its closing `)`. `complete:false` means the call never closes — the
// caller then has no span to reason about and skips.
function callArgs(masked, open) {
  let depth = 0;
  for (let j = open; j < masked.length; j++) {
    const c = masked[j];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return { complete: true, start: open + 1, end: j, text: masked.slice(open + 1, j) };
    }
  }
  return { complete: false, start: open + 1, end: masked.length, text: masked.slice(open + 1) };
}

// The full value text of `key:` inside an argument list — an object literal, an
// array, or an expression — balanced across {} [] () and stopped at the value's
// own top-level terminator. Returns null when the key isn't there.
function optionValue(args, key) {
  const km = args.match(new RegExp("(^|[^\\w$.])" + key + "\\s*:"));
  if (!km) return null;
  let start = km.index + km[0].length;
  while (start < args.length && /\s/.test(args[start])) start++;
  if (start >= args.length) return null;
  let curly = 0, square = 0, round = 0;
  for (let j = start; j < args.length; j++) {
    const c = args[j];
    if (c === "{") curly++;
    else if (c === "}") { if (curly === 0) return args.slice(start, j); curly--; }
    else if (c === "[") square++;
    else if (c === "]") { if (square === 0) return args.slice(start, j); square--; }
    else if (c === "(") round++;
    else if (c === ")") { if (round === 0) return args.slice(start, j); round--; }
    else if (c === "," && curly === 0 && square === 0 && round === 0) return args.slice(start, j);
  }
  return args.slice(start);
}

// Split an object/array body on its TOP-LEVEL commas (nested spans are opaque).
function splitTopLevel(inner) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === "," && depth === 0) { parts.push(inner.slice(start, i)); start = i + 1; }
  }
  parts.push(inner.slice(start));
  return parts.map((s) => s.trim()).filter(Boolean);
}

// The leading balanced `{ … }` / `[ … ]` of `t`, without its delimiters.
function innerOf(t) {
  const openCh = t[0];
  const closeCh = openCh === "{" ? "}" : "]";
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") {
      depth--;
      if (depth === 0) return c === closeCh ? t.slice(1, i) : null;
    }
  }
  return t.slice(1);
}

// Top-level keys of an object literal, or null when the shape is not decidable
// (a spread, a computed key, a variable). null means "unknown", never "empty" —
// the difference decides whether the reset-column list is certain.
function objectKeys(text) {
  const t = (text || "").trim();
  if (!t.startsWith("{")) return null;
  const inner = innerOf(t);
  if (inner === null) return null;
  const keys = new Set();
  for (const seg of splitTopLevel(inner)) {
    if (seg.startsWith("...")) return null;
    const km = seg.match(/^(?:["'`]([^"'`]*)["'`]|([A-Za-z_$][\w$]*))\s*(?::|$)/);
    if (!km) return null;
    keys.add(km[1] || km[2]);
  }
  return keys;
}

// The keys a `data:` value sets. An array (`createMany`) contributes the UNION
// of its rows' keys — a column absent from one row still resets on that row, so
// the union is the conservative (fewest findings) reading.
function dataKeys(dataText) {
  const t = (dataText || "").trim();
  if (t.startsWith("{")) return objectKeys(t);
  if (t.startsWith("[")) {
    const inner = innerOf(t);
    if (inner === null) return null;
    const keys = new Set();
    for (const row of splitTopLevel(inner)) {
      const k = objectKeys(row);
      if (!k) return null;
      for (const one of k) keys.add(one);
    }
    return keys;
  }
  return null;   // a variable / spread / helper call — not statically readable
}

// ---- Transaction blocks ----------------------------------------------------
//
// A "block" is a region of source that executes atomically, in two forms:
//
//  1. `prisma.$transaction( … )` — the whole argument list, which covers BOTH
//     the interactive callback (`async (tx) => { … }`) and the sequential array
//     (`[ prisma.a.deleteMany(…), prisma.a.create(…) ]`). Taking the argument
//     list rather than the callback body is what makes one span serve both.
//     When the callback's client parameter is visible, only calls made THROUGH
//     it count: a `prisma.…` call inside the callback is not in the
//     transaction, and pairing it with one that is would be a different bug.
//
//  2. a function whose parameter is typed `Prisma.TransactionClient` (or
//     `TransactionClient`) — the extracted-helper form of the same thing, and
//     the shape the incident's pipeline actually used. The parameter name is
//     the client binding; the function body is the span.

const TX_CALL_RE = /\$transaction\s*\(/g;
const TX_PARAM_RE = /([A-Za-z_$][\w$]*)\s*:\s*(?:Prisma\s*\.\s*)?TransactionClient\b/g;

// The client binding of a `$transaction` callback: `async (tx) =>`, `(tx) =>`,
// `async tx =>`, `async function (tx)`. null when the argument is an array (all
// of whose statements are in the transaction) or a shape we can't read.
function txBinding(argsText) {
  const t = argsText.replace(/^\s+/, "");
  if (t.startsWith("[")) return null;
  const m = t.match(/^(?:async\s*)?(?:function\s*\*?\s*[A-Za-z_$][\w$]*\s*)?\(\s*([A-Za-z_$][\w$]*)/)
    || t.match(/^(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=>/);
  return m ? m[1] : null;
}

// The body span of the function whose parameter list contains `at`. Skips the
// parameter list, then any return-type annotation (whose generics may contain
// their own braces: `: Promise<{ ok: boolean }>`), and balances the body.
function functionBodyAfterParam(masked, at) {
  let depth = 0, j = at;
  for (; j < masked.length; j++) {
    const c = masked[j];
    if (c === "(") depth++;
    else if (c === ")") { if (depth === 0) break; depth--; }
  }
  if (j >= masked.length) return null;
  let angle = 0;
  for (let k = j + 1; k < masked.length; k++) {
    const c = masked[k];
    if (c === "<") angle++;
    else if (c === ">") { if (angle > 0) angle--; }
    else if (c === ";") return null;              // an overload/declaration — no body
    else if (c === "{") {
      if (angle > 0) { k += Math.max(0, braceSpan(masked, k)); continue; }
      const end = braceSpan(masked, k);
      if (end < 0) return null;
      return { start: k + 1, end: k + end };
    }
  }
  return null;
}

// Length from `open` to its matching `}` inclusive, or -1 when unbalanced.
function braceSpan(masked, open) {
  let depth = 0;
  for (let j = open; j < masked.length; j++) {
    if (masked[j] === "{") depth++;
    else if (masked[j] === "}") { depth--; if (depth === 0) return j - open; }
  }
  return -1;
}

function transactionBlocks(masked) {
  const blocks = [];
  TX_CALL_RE.lastIndex = 0;
  let m;
  while ((m = TX_CALL_RE.exec(masked))) {
    const open = TX_CALL_RE.lastIndex - 1;
    const { complete, start, end, text } = callArgs(masked, open);
    if (!complete) continue;
    blocks.push({ start, end, binding: txBinding(text) });
    TX_CALL_RE.lastIndex = end;
  }
  TX_PARAM_RE.lastIndex = 0;
  while ((m = TX_PARAM_RE.exec(masked))) {
    const body = functionBodyAfterParam(masked, TX_PARAM_RE.lastIndex);
    if (body) blocks.push({ start: body.start, end: body.end, binding: m[1] });
  }
  return blocks;
}

// ---- Data-access calls -----------------------------------------------------

// `tx.result.deleteMany(` / `ctx.db.resultToken.create(` — the accessor
// immediately left of the model is the client binding we check.
const CALL_RE =
  /\b([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\.\s*(delete|deleteMany|create|createMany|createManyAndReturn|update|upsert)\s*\(/g;
const DELETE_OPS = new Set(["delete", "deleteMany"]);
const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn"]);
// A nested write (`data: { token: { create: … } }`) creates the CHILD without a
// call of its own, so a parent create/update/upsert has to be looked inside.
const NESTED_HOSTS = new Set(["create", "createMany", "createManyAndReturn", "update", "upsert"]);
const NESTED_RE = /([A-Za-z_$][\w$]*)\s*:\s*\{\s*(create|createMany)\s*:/g;

// ---- Reset columns ---------------------------------------------------------

// The columns a create leaves unset, restricted to the ones that reset
// SILENTLY: a column with a `@default(…)` reverts to it (including a freshly
// generated uuid/cuid/now — the identity churn that broke the customer's link),
// and a nullable column reverts to NULL. A required column with no default is
// excluded: omitting it fails loudly, which is a different rule's business.
// `@updatedAt` is excluded too — the ORM owns it by design.
//
// A relation key in the create's data also sets the FK columns it owns
// (`booking: { connect: { id } }` sets `bookingId`), which the schema states
// exactly, so a connect never shows up as a "reset" column.
function resetColumns(entry, keys) {
  const setCols = new Set();
  if (keys) {
    for (const k of keys) {
      setCols.add(k);
      for (const r of entry.relations) if (r.field === k) for (const f of r.fkFields) setCols.add(f);
    }
  }
  const out = [];
  for (const f of entry.fields) {
    if (f.updatedAt) continue;
    if (keys && setCols.has(f.name)) continue;
    if (!f.hasDefault && !f.optional) continue;
    out.push(f.name);
  }
  return out;
}

// Is this row declared transient by the schema? A cascading FK means the row is
// owned by its parent and dies with it, so replacing the set wholesale is the
// documented pattern, not a rewrite of durable state.
function isTransient(entry) {
  return entry.relations.some((r) => r.onDelete === "Cascade");
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

let count = 0, undecided = 0;
const { files, explicit } = targets(root);

for (const file of files) {
  const norm = file.replace(/\\/g, "/");
  if (!explicit && SKIP_FILE_RE.test(norm) && !FIXTURE_RE.test(norm)) continue;
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
  if (!/\$transaction|TransactionClient/.test(text)) continue;   // cheap reject

  const masked = maskLiterals(text);
  const blocks = transactionBlocks(masked);
  if (!blocks.length) continue;

  const schema = schemaForFile(file);
  const lines = text.split(/\r?\n/);
  const lineOf = lineTable(text);
  const hits = [];
  const seen = new Set();   // one finding per delete site, however many blocks contain it

  for (const block of blocks) {
    const deletes = new Map();   // model -> { offset, op }
    const creates = new Map();   // model -> [{ offset, op, keys }]
    const addCreate = (model, offset, op, keys) => {
      if (!creates.has(model)) creates.set(model, []);
      creates.get(model).push({ offset, op, keys });
    };

    CALL_RE.lastIndex = block.start;
    let m;
    while ((m = CALL_RE.exec(masked)) && m.index < block.end) {
      const [, accessor, model, op] = m;
      // Only calls made through the transaction client are IN the transaction.
      if (block.binding && accessor !== block.binding) continue;
      const open = m.index + m[0].length - 1;
      const { complete, text: args } = callArgs(masked, open);

      if (DELETE_OPS.has(op)) {
        if (!deletes.has(model)) deletes.set(model, { offset: m.index, op });
      } else if (CREATE_OPS.has(op)) {
        addCreate(model, m.index, op, complete ? dataKeys(optionValue(args, "data")) : null);
      }

      // Nested writes: `tx.result.create({ data: { token: { create: {…} } } })`
      // creates a ResultToken with no call of its own. The relation field names
      // the child model, and the schema resolves it.
      if (complete && NESTED_HOSTS.has(op) && schema) {
        const host = schema.get(model) || schema.get(model.toLowerCase());
        if (host) {
          NESTED_RE.lastIndex = 0;
          let n;
          while ((n = NESTED_RE.exec(args))) {
            // The relation field names the child MODEL — the schema resolves it
            // to the accessor the rest of the pass keys on.
            const rel = host.relFields.find((r) => r.field === n[1]);
            if (!rel) continue;
            const child = rel.model[0].toLowerCase() + rel.model.slice(1);
            // `create:` is the row itself; `createMany:` wraps it in `data:`.
            const value = optionValue(args.slice(n.index), n[2]);
            const keys = n[2] === "createMany"
              ? dataKeys(optionValue(value || "", "data"))
              : dataKeys(value);
            addCreate(child, m.index, "nested-" + n[2], keys);
          }
        }
      }
    }

    for (const [model, del] of deletes) {
      const after = (creates.get(model) || []).filter((c) => c.offset > del.offset);
      if (!after.length) continue;                       // deleted, not recreated — not this rule
      const key = `${file}:${del.offset}:${model}`;
      if (seen.has(key)) continue;

      // Gate 1 — the schema has to KNOW this model. It cannot say whether an
      // undeclared row is transient, and a guess is exactly what this rule
      // refuses to make.
      const entry = schema ? (schema.get(model) || schema.get(model.toLowerCase())) : null;
      if (!entry) { undecided++; continue; }
      // Gate 2 — a cascading FK means the schema declares the row transient.
      if (isTransient(entry)) continue;
      // Gate 3 — something has to actually be lost. When every column the
      // create omits is required-with-no-default, the create restores the row
      // whole and there is no silent reset to report.
      const first = after[0];
      const cols = resetColumns(entry, first.keys);
      if (!cols.length) continue;

      seen.add(key);
      const line = lineOf(del.offset);
      const shown = cols.slice(0, 6).join(", ") + (cols.length > 6 ? `, +${cols.length - 6} more` : "");
      const label = first.keys ? "resets" : "resets (create data not a literal)";
      const src = (lines[line - 1] || "").trim().slice(0, 100);
      hits.push({
        line,
        key: `${model}.${del.op}+${first.op}`,
        snippet: `${src} [${label}: ${shown}]`.replace(/\|/g, "/"),
      });
    }
  }

  // Emit in ascending line order: `audit-core` derives finding slugs (and their
  // -1/-2 disambiguating suffixes) from emission order, so a stable order keeps
  // slugs stable across runs.
  hits.sort((a, b) => a.line - b.line || a.key.localeCompare(b.key));
  for (const h of hits) {
    console.log([file, h.line, "HIGH", h.key, h.snippet].join("|"));
    count++;
  }
}

console.error(
  `# row-rewrite-in-tx: ${count} hit(s)` +
  (undecided ? ` (${undecided} candidate(s) undecided — no schema entry)` : "")
);
