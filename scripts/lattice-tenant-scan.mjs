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
const LOOKAHEAD = 8;
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

// Within a call's argument text, find the `where: { ... }` object and return it.
// Searches only the supplied (already call-scoped) text.
function extractWhere(args) {
  const wIdx = args.search(/\bwhere\s*:/);
  if (wIdx === -1) return { found: false, whereText: "" };
  const braceStart = args.indexOf("{", wIdx);
  if (braceStart === -1) return { found: false, whereText: "" };
  let depth = 0;
  for (let j = braceStart; j < args.length; j++) {
    const c = args[j];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { found: true, whereText: args.slice(braceStart, j + 1) };
    }
  }
  return { found: false, whereText: "" };
}

let count = 0;
const { files, explicitFile } = scanTargets(root);
for (const file of files) {
  if (!explicitFile && SKIP_FILE_RE.test(file.replace(/\\/g, "/"))) continue;
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
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

    const tier = WRITE_OPS.has(op) ? "HIGH" : "MEDIUM";
    const snippet = line.trim().slice(0, 120).replace(/\|/g, "/");
    console.log([file, i + 1, tier, model + "." + op, snippet].join("|"));
    count++;
  }
}
console.error(`# missing-tenant-filter: ${count} hit(s)`);
