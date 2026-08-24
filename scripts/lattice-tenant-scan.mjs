#!/usr/bin/env node
// Deterministic missing-tenant-filter scanner — core/missing-tenant-filter (#122).
//
// Flags a multi-tenant data access (Prisma/ORM) whose `where: { ... }` block
// omits the configured tenant/owner scope — the shape that leaks rows across
// tenants or enables IDOR. This is the most FP-prone rule in the set, so the
// bar is deliberately high: a call is only a hit when we can SEE its `where`
// object (same line or a short lookahead window) AND no tenant key appears in it.
// When unsure, we DON'T flag. A noisy detector here is worse than none.
//
// Tier: HIGH for update/delete (mutation IDOR), MEDIUM for find/read.
//
// v2.7.2 (#195): a `where` keyed on a PRIMARY/UNIQUE key is never a finding —
// `where: { id }` on a `@id @default(uuid())` column cannot cross a tenant
// boundary, so there is no tenant filter to add. We decide that from the
// project's own `prisma/schema.prisma` (see "Prisma schema awareness" below)
// rather than from identifier spelling, so the suppression is derived from the
// schema, not guessed. The real bug class survives: updateMany/deleteMany/
// findMany whose `where` pins no key at all.
//
// Tenant keys are CONFIGURABLE (this is what makes precision portable):
//   1. env LATTICE_TENANT_KEYS="tenantId,orgId"   (comma-separated), OR
//   2. .lattice/config.yml line `tenant_keys: tenantId, orgId`, OR
//   3. the default set below.
//
// Output: one `file|line|tier|key|snippet` per hit on stdout; a count on stderr.
// One pass over the tree — no per-line fork (cf. the yaml-field-fork WATCH).

import fs from "fs";
import path from "path";

const root = process.argv[2] || ".";

// ---- Tenant-key configuration (env > config.yml > default) ----------------

const DEFAULT_TENANT_KEYS = [
  "tenantId", "orgId", "organizationId", "workspaceId", "accountId", "companyId",
];

function loadTenantKeys() {
  // 1. env override
  const env = process.env.LATTICE_TENANT_KEYS;
  if (env && env.trim()) {
    const keys = env.split(",").map((s) => s.trim()).filter(Boolean);
    if (keys.length) return keys;
  }
  // 2. .lattice/config.yml  ->  `tenant_keys: a, b, c`  (flat, single line)
  try {
    const cfg = fs.readFileSync(path.join(root, ".lattice", "config.yml"), "utf8");
    const m = cfg.match(/^\s*tenant_keys:\s*(.+)$/m);
    if (m) {
      const keys = m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      if (keys.length) return keys;
    }
  } catch { /* no config — fall through */ }
  // 3. default
  return DEFAULT_TENANT_KEYS;
}

const TENANT_KEYS = loadTenantKeys();
// Match a tenant key as a whole word (handles `tenantId`, `tenantId:`, `{ tenantId }`).
const TENANT_RE = new RegExp("\\b(" + TENANT_KEYS.join("|") + ")\\b", "i");

// ---- Prisma schema awareness (#195) ---------------------------------------
//
// The rule's worst false-positive class was a write scoped by PRIMARY KEY. The
// schema that decides it is sitting in the repo, so we read it instead of
// pattern-matching identifier names: per model we learn which fields carry
// `@id` / `@unique`, plus every `@@id([...])` / `@@unique([...])` composite.
// A `where` that pins any of those addresses at most one row and is therefore
// already scoped — no tenant key can widen or narrow it.
//
// Discovery is per-FILE and memoized per directory: we walk up from the file's
// own directory so a monorepo resolves each service against its own schema,
// and we stop at a `.git` boundary so a scan never reaches out of the project.
// Locations honored, in order:
//   env LATTICE_PRISMA_SCHEMA          (a .prisma file OR a folder of them)
//   <dir>/prisma/schema.prisma
//   <dir>/prisma/schema/**.prisma      (Prisma 6+ multi-file schema folder)
//   <dir>/schema.prisma
//   package.json `"prisma": { "schema": … }`  /  prisma.config.* `schema: "…"`

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

// Composite keys of one model body: `@@id([a, b])`, `@@unique([a, b])`,
// `@@unique(fields: [a, b], name: "ab")`. Paren-balanced, so a multi-line
// attribute parses too. The client-facing compound name is the declared
// `name:` when present, else the members joined with `_` (Prisma's default).
function blockKeys(body) {
  const composites = [];
  const re = /@@(id|unique)\s*\(/g;
  let m;
  while ((m = re.exec(body))) {
    let depth = 1, j = re.lastIndex;
    for (; j < body.length && depth > 0; j++) {
      if (body[j] === "(") depth++;
      else if (body[j] === ")") depth--;
    }
    const inner = body.slice(re.lastIndex, j - 1);
    re.lastIndex = j;
    const fm = inner.match(/\[([^\]]*)\]/);
    if (!fm) continue;
    // Members may carry a sort modifier: `slug(sort: Desc)` -> `slug`.
    const fields = fm[1].split(",").map((s) => s.trim().replace(/\(.*$/, "").trim()).filter(Boolean);
    if (!fields.length) continue;
    const nm = inner.match(/\bname\s*:\s*["']([^"']+)["']/);
    composites.push({ fields, name: nm ? nm[1] : fields.join("_") });
  }
  return composites;
}

// One `model`/`view` body -> the fields carrying `@id`/`@unique` (Prisma
// fields are line-oriented) plus the block-level composites.
function parseModelBody(body) {
  const singles = new Set();
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("@@")) continue;   // block attrs: see blockKeys()
    const fm = line.match(/^([A-Za-z_][\w]*)\s+([A-Za-z_][\w]*(?:\[\])?\??)/);
    if (!fm) continue;
    const attrs = line.slice(fm[0].length);
    // `@id`/`@unique` only — the `[^@]` guard keeps `@@id` out of the match.
    if (/(^|[^@])@id\b/.test(attrs) || /(^|[^@])@unique\b/.test(attrs)) singles.add(fm[1]);
  }
  return { singles, composites: blockKeys(body) };
}

function parseSchemaFiles(files) {
  const index = new Map();   // client accessor -> { singles, composites }
  for (const f of files) {
    let text;
    try { text = stripPrismaComments(fs.readFileSync(f, "utf8")); } catch { continue; }
    const re = /(?:^|\n)\s*(?:model|view)\s+([A-Za-z_][\w]*)\s*\{/g;
    let m;
    while ((m = re.exec(text))) {
      let depth = 1, j = re.lastIndex;
      for (; j < text.length && depth > 0; j++) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
      }
      const parsed = parseModelBody(text.slice(re.lastIndex, j - 1));
      re.lastIndex = j;
      // Prisma Client exposes `model Booking` as `prisma.booking` — the model
      // name with a lower-cased first letter. An all-lowercase alias is added
      // too so an oddly-cased accessor still resolves.
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

// ---- where-clause keys (#195) ---------------------------------------------

// Split an object body on its TOP-LEVEL commas (strings and nested
// {}/[]/() spans are opaque).
function splitTopLevel(inner) {
  const parts = [];
  let depth = 0, quote = null, start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    else if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === "," && depth === 0) { parts.push(inner.slice(start, i)); start = i + 1; }
  }
  parts.push(inner.slice(start));
  return parts.map((s) => s.trim()).filter(Boolean);
}

// Prisma filter operators. A key still pins its row(s) under `equals` / `in`
// (both name the rows explicitly); every other operator selects a RANGE —
// `where: { id: { not: x } }` matches every OTHER row — so the key stops
// scoping the statement and the call must go back through the tenant check.
const FILTER_OPS = new Set([
  "equals", "in", "not", "notIn", "lt", "lte", "gt", "gte",
  "contains", "startsWith", "endsWith", "search", "mode",
]);
const PINNING_OPS = new Set(["equals", "in"]);

// Top-level keys of an object-literal `where`: `{ id, status: "open" }` ->
// {id, status}. `AND` is a conjunction, so its members constrain the SAME row
// and their keys merge in; `OR`/`NOT` contribute nothing (a keyed OR branch
// does not scope the other branch). Returns null when the shape isn't an
// object literal or isn't decidable (a spread, a computed key), which leaves
// the call to the pre-#195 tenant-key check.
function objectKeys(text, depth = 0) {
  const t = text.trim();
  if (!t.startsWith("{") || depth > 4) return null;
  // Take only the LEADING balanced `{ … }`: when `where` is the last option,
  // extractWhere() hands back a trailing `}` from the enclosing options object.
  let d = 0, quote = null, end = -1;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    else if (c === "{" || c === "[" || c === "(") d++;
    else if (c === "}" || c === "]" || c === ")") { d--; if (d === 0) { end = i; break; } }
  }
  const inner = end >= 0 ? t.slice(1, end) : t.slice(1);
  const keys = new Set();
  for (const seg of splitTopLevel(inner)) {
    if (seg.startsWith("...")) return null;               // spread — keys unknowable
    const km = seg.match(/^(?:["'`]([^"'`]+)["'`]|([A-Za-z_$][\w$]*))\s*(?::|$)/);
    if (!km) return null;                                  // computed key / shape we don't model
    const key = km[1] || km[2];
    if (key === "AND") {
      const val = seg.slice(seg.indexOf(":") + 1).trim();
      const members = val.startsWith("[") ? splitTopLevel(val.slice(1, val.endsWith("]") ? -1 : undefined)) : [val];
      for (const sub of members) {
        const subKeys = objectKeys(sub, depth + 1);
        if (subKeys) for (const k of subKeys) keys.add(k);
      }
      continue;
    }
    if (key === "OR" || key === "NOT") continue;
    // A range filter on the key (`{ id: { gt: 0 } }`) doesn't pin a row.
    const val = seg.slice(seg.indexOf(":") + 1).trim();
    if (val.startsWith("{")) {
      const ops = objectKeys(val, depth + 1);
      if (ops && ops.size && [...ops].every((o) => FILTER_OPS.has(o))
          && ![...ops].every((o) => PINNING_OPS.has(o))) continue;
    }
    keys.add(key);
  }
  return keys;
}

// A non-object `where` (drizzle's `and(eq(t.id, x), …)`, a hoisted variable)
// can't be key-enumerated, but the column names it mentions are readable.
// Used for SUPPRESSION only — never to manufacture a finding.
function referencedFields(text) {
  const keys = new Set();
  const re = /\.\s*([A-Za-z_$][\w$]*)\b/g;
  let m;
  while ((m = re.exec(text))) keys.add(m[1]);
  return keys;
}

// Is this `where` keyed — does it pin the row(s) by a declared key?
// A NARROWER where (a key PLUS extra conditions, e.g. the exactly-once CAS
// claim `where: { id, resultDeliveredAt: null }`) is still keyed: extra
// conditions can only shrink the row set, never widen it past the key.
function whereIsKeyed(schema, model, whereText) {
  const parsed = objectKeys(whereText);
  // An object literal we could NOT fully parse (a spread, a computed key) keeps
  // the pre-#195 behaviour — we don't go fishing for identifiers inside it.
  const keys = parsed || (whereText.trim().startsWith("{") ? null : referencedFields(whereText));
  if (!keys || !keys.size) return false;
  const declared = schema ? (schema.get(model) || schema.get(model.toLowerCase())) : null;
  if (declared) {
    for (const k of keys) if (declared.singles.has(k)) return true;       // @id / @unique
    for (const c of declared.composites) {
      if (keys.has(c.name)) return true;                                  // `where: { a_b: { … } }`
      if (c.fields.every((f) => keys.has(f))) return true;                // every member present
    }
    return false;
  }
  // ---- FALLBACK — no schema on disk (or a model the schema doesn't declare).
  // This is the ONLY name-shaped guess left in the rule, and it is deliberately
  // narrow: without a schema we cannot know the keys, so we accept just the two
  // spellings that are the primary key in practice — `id`, and `<model>Id`
  // (`prisma.booking` -> `bookingId`). Everything else is treated as unkeyed.
  const idish = new Set(["id", model.toLowerCase() + "id"]);
  for (const k of keys) if (idish.has(k.toLowerCase())) return true;
  return false;
}

// ---- Patterns -------------------------------------------------------------

const COMMENT = /^\s*(\/\/|#|\*|\/\*)/;

// A Prisma-style accessor: prisma.<model>.<op>(  or  ctx.db.<model>.<op>(  etc.
// We capture the model and the op. `\w+\.` allows `prisma.` / `db.` / `tx.` etc.
// The op set is exactly the data-access methods we care about.
const CALL_RE =
  /\b\w+\.(\w+)\.(update|delete|findMany|findFirst|findUnique|updateMany|deleteMany)\s*\(/;

// Ops that are mutations (IDOR on write) → HIGH. Reads → MEDIUM.
const WRITE_OPS = new Set(["update", "delete", "updateMany", "deleteMany"]);

// Models that hold global/system data, not tenant-scoped rows. Skip them — a
// missing tenant key there is expected, not a leak.
const GLOBAL_MODEL_RE = /^(migration|auditLog|systemConfig|migrations|auditLogs)$/i;

const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage", "vendor",
  ".lattice", "__pycache__", ".venv", "venv", ".dart_tool", ".netlify",
]);
const EXTS = new Set([".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs"]);
// Skip tests AND migration files (prisma migrations, *.migration.ts, /migrations/).
const SKIP_FILE_RE =
  /(\.spec\.|\.test\.|_test\.|\/tests?\/|\/__tests__\/|\/migrations?\/|\.migration\.|\bmigrate\b)/;

function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!EXCLUDE_DIRS.has(e.name)) yield* walk(p); }
    else if (EXTS.has(path.extname(e.name))) yield p;
  }
}

// Resolve the scan set. A directory walks the tree with the dir/test skips
// applied (the normal project-root mode used by `lattice audit-core`). An
// explicit single file is scanned as-is — this is the self-test affordance and
// bypasses the path-based skip so a fixture under test/fixtures/ can be checked
// directly without weakening directory-scan precision.
function scanTargets(target) {
  // Diff-scoped mode: LATTICE_SCAN_FILES (newline-separated) overrides the walk
  // so the pre-commit hook / session-start can scan only changed files. These
  // go through the normal per-file SKIP_FILE_RE (explicitFile=false).
  const env = process.env.LATTICE_SCAN_FILES;
  if (env && env.trim()) {
    const files = env.split(/\r?\n/).map((s) => s.trim()).filter((t) => {
      if (!t || !EXTS.has(path.extname(t))) return false;
      try { return fs.statSync(t).isFile(); } catch { return false; }
    });
    return { files, explicitFile: false };
  }
  let isFile = false;
  try { isFile = fs.statSync(target).isFile(); } catch { /* missing path */ }
  return { files: isFile ? [target] : [...walk(target)], explicitFile: isFile };
}

// Extract the argument text of the call whose `(` is at `parenAbs` in a window
// joined from line i, balancing parens so we stop at the call's OWN closing `)`.
// Bounded to LOOKAHEAD lines. This scoping is the key precision guard: it stops
// the `where:` search from leaking into a following statement or a trailing
// comment line (both caused false positives in early self-tests).
// Wide enough that a realistically long multi-line `where` (nested AND/OR
// arrays, drizzle `and(...)` spanning many `eq()` lines) closes inside the
// window. If it doesn't close we report `complete:false` and fail SAFE (skip),
// so erring large only costs a little scan text, never precision.
const LOOKAHEAD = 24;
function extractCallArgs(lines, i, parenAbs) {
  const window = lines.slice(i, i + 1 + LOOKAHEAD).join("\n");
  let depth = 0;
  for (let j = parenAbs; j < window.length; j++) {
    const c = window[j];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return { complete: true, args: window.slice(parenAbs + 1, j) };
    }
  }
  // Call args don't close within the window — can't reason confidently.
  return { complete: false, args: window.slice(parenAbs + 1) };
}

// Within a call's argument text, find the `where:` clause and return its FULL
// value text. The value may be an object literal (`{ ... }`), an array, or a
// function-call expression such as drizzle's `and(eq(t.tenantId, x), ...)` /
// `or(...)`. We balance `{}`, `[]` AND `()` together so the span covers nested
// AND/OR arrays and `and(...)`/`eq(...)` calls at any depth, and stop at the
// value's top-level terminator (a sibling-option `,`, or the end of args).
// Balancing `()` here is what fixes #141: an `and(...)` where whose tenant key
// lived inside the parens was previously skipped over by an object-only scan,
// which then latched onto an unrelated later `{ ... }` option (e.g. `with:`)
// and reported a false "missing tenant filter".
function extractWhere(args) {
  const wm = args.match(/\bwhere\s*:/);
  if (!wm) return { found: false, whereText: "" };
  // Start at the first non-whitespace char of the value.
  let start = wm.index + wm[0].length;
  while (start < args.length && /\s/.test(args[start])) start++;
  if (start >= args.length) return { found: false, whereText: "" };
  let curly = 0, square = 0, round = 0;
  for (let j = start; j < args.length; j++) {
    const c = args[j];
    if (c === "{") curly++;
    else if (c === "}") { if (curly === 0) break; curly--; }
    else if (c === "[") square++;
    else if (c === "]") { if (square === 0) break; square--; }
    else if (c === "(") round++;
    else if (c === ")") { if (round === 0) break; round--; }
    else if (c === "," && curly === 0 && square === 0 && round === 0) {
      // Top-level comma → end of the `where` value (next sibling option).
      return { found: true, whereText: args.slice(start, j) };
    }
  }
  // Hit a closing bracket that belongs to the enclosing args, or ran out of
  // text — the value runs to here. Return whatever we balanced.
  return { found: true, whereText: args.slice(start) };
}

let count = 0;
const { files, explicitFile } = scanTargets(root);
for (const file of files) {
  if (!explicitFile && SKIP_FILE_RE.test(file.replace(/\\/g, "/"))) continue;
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
  // Resolve the Prisma schema governing THIS file once (memoized per dir).
  const schema = schemaForFile(file);
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (COMMENT.test(line)) continue;

    const m = line.match(CALL_RE);
    if (!m) continue;
    const model = m[1];
    const op = m[2];

    // Skip global/system models — a missing tenant key there is expected.
    if (GLOBAL_MODEL_RE.test(model)) continue;

    // Scope to THIS call's own argument list (the matched `(`), so the `where:`
    // search can't bleed into a later statement or a trailing comment line.
    const parenAbs = m.index + m[0].length - 1;
    const { complete, args } = extractCallArgs(lines, i, parenAbs);
    // `args` is paren-scoped from this call's own `(`, so a balanced `where:{...}`
    // inside it provably belongs to this call even if the call's `)` is beyond
    // the window (a long multi-line where). We can evaluate the where in both
    // cases; we only need `complete` to safely assert "this call has NO where".
    const { found, whereText } = extractWhere(args);

    if (!found) {
      // Can't see a `where` for this call. If the call didn't even close within
      // the window we can't assert it lacks a where — don't guess.
      if (!complete) continue;
      // Visible, complete call with NO `where`. Precision rule: only flag a WRITE
      // with no where (delete-all / update-all is a real IDOR shape). A read with
      // no where (findMany list-all) is too noisy — skip it.
      if (op === "delete" || op === "update") {
        const snippet = line.trim().slice(0, 120).replace(/\|/g, "/");
        console.log([file, i + 1, "HIGH", "no-where-" + op, snippet].join("|"));
        count++;
      }
      continue;
    }

    // We can see the where block. Flag only if NO tenant key is inside it.
    if (TENANT_RE.test(whereText)) continue;

    // v2.7.2 (#195): …and only if the where pins no KEY either. A write scoped
    // by primary key cannot cross a tenant boundary — the key IS the scope, so
    // there is no tenant filter to add and `where: { id, tenantId }` would be
    // strictly redundant. Decided from the model's own schema where one exists.
    if (whereIsKeyed(schema, model, whereText)) continue;

    const tier = WRITE_OPS.has(op) ? "HIGH" : "MEDIUM";
    const snippet = line.trim().slice(0, 120).replace(/\|/g, "/");
    console.log([file, i + 1, tier, model + "." + op, snippet].join("|"));
    count++;
  }
}
console.error(`# missing-tenant-filter: ${count} hit(s)`);
