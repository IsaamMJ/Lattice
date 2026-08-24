#!/usr/bin/env node
// test/tenant-scan-schema.test.mjs — regression test for #195.
//
// Background: core/missing-tenant-filter fired HIGH on writes scoped by
// PRIMARY KEY. `where: { id }` on a `@id @default(uuid())` column cannot
// cross a tenant boundary — the id IS the scope — so every HIGH the rule
// produced on the reporting repo was a false positive, including a textbook
// exactly-once CAS claim (`where: { id, resultDeliveredAt: null }`). A HIGH
// that is always wrong trains developers to dismiss HIGHs.
//
// The fix reads the project's own Prisma schema instead of guessing from
// identifier names: per model, which fields carry `@id`/`@unique`, plus the
// `@@id([...])`/`@@unique([...])` composites. A `where` pinning any of those
// is scoped and is NOT a finding; a `where` pinning none still is.
//
// What is tested (fixture trees under test/fixtures/):
//   1. missing-tenant-filter-prisma/            single-file schema, one dir up
//   2. missing-tenant-filter-prisma-multifile/  prisma/schema/*.prisma folder
//   3. missing-tenant-filter/                   no schema -> id/<model>Id fallback
// Each tree has a good.ts that MUST produce 0 hits and a bad.ts whose every
// call MUST produce exactly one hit (the surviving true-positive class).
//
// Fixtures are scanned as explicit single files: a directory walk skips
// anything under test/, which is exactly what we want in real scans.
//
// Run directly:  node test/tenant-scan-schema.test.mjs
// CI runs it:    via scripts/validate.sh

import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SCANNER = path.join(ROOT, "scripts", "lattice-tenant-scan.mjs");
const FIX = path.join(HERE, "fixtures");

let failed = 0;
const ok = (m) => console.log(`  ok: ${m}`);
const bad = (m) => { console.error(`  FAIL: ${m}`); failed = 1; };

// Run the scanner over one file; return `line|tier|key` for every hit.
function scan(file, env = {}) {
  const out = execFileSync(process.execPath, [SCANNER, file], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "ignore"],
  });
  return out.split("\n").filter(Boolean).map((l) => {
    const [, line, tier, key] = l.split("|");
    return `${line}|${tier}|${key}`;
  });
}

function expectHits(file, expected, label) {
  let got;
  try { got = scan(file); } catch (e) { return bad(`${label}: scanner failed: ${e.message}`); }
  const g = got.join("\n"), e = expected.join("\n");
  if (g === e) ok(`${label} (${got.length} hit(s))`);
  else bad(`${label}\n    expected:\n      ${expected.join("\n      ") || "(none)"}\n    got:\n      ${got.join("\n      ") || "(none)"}`);
}

// --- 1. Single-file schema: prisma/schema.prisma one directory up ----------
const P = path.join(FIX, "missing-tenant-filter-prisma", "src");
console.log("[test] #195 schema-aware suppression (prisma/schema.prisma)");
// The three real false positives from the report + @unique, composite and
// AND-conjunction keying must all be silent.
expectHits(path.join(P, "good.ts"), [], "key-scoped access produces no findings");
expectHits(path.join(P, "bad.ts"), [
  "12|HIGH|booking.updateMany",       // non-key column only
  "18|HIGH|enrollment.updateMany",    // one member of @@id([userId, courseId])
  "24|HIGH|booking.updateMany",       // OR: keyed branch does not scope the other
  "32|HIGH|session.deleteMany",       // non-key column only
  "37|MEDIUM|result.findMany",        // read, non-key column
  "43|HIGH|legacyRecord.updateMany",  // model absent from the schema -> fallback
], "unkeyed access still flags");

// --- 2. Multi-file schema folder: prisma/schema/*.prisma -------------------
const M = path.join(FIX, "missing-tenant-filter-prisma-multifile", "src");
console.log("[test] #195 multi-file schema folder (prisma/schema/*.prisma)");
expectHits(path.join(M, "good.ts"), [], "keys unioned across schema files");
expectHits(path.join(M, "bad.ts"), [
  "7|HIGH|invoice.updateMany",
  "12|HIGH|apiToken.deleteMany",
], "unkeyed access still flags");

// --- 3. No schema anywhere: the id/<model>Id fallback ----------------------
const F = path.join(FIX, "missing-tenant-filter");
console.log("[test] #195 no-schema fallback (id / <model>Id only)");
expectHits(path.join(F, "good.ts"), [], "tenant- or id-scoped access produces no findings");
expectHits(path.join(F, "bad.ts"), [
  "17|HIGH|post.updateMany",
  "22|HIGH|post.updateMany",
  "27|HIGH|session.deleteMany",
  "32|MEDIUM|project.findMany",
  "37|HIGH|billing.updateMany",
  "48|HIGH|ticket.updateMany",
  "56|HIGH|no-where-delete",
], "unkeyed access still flags");

// --- 4. LATTICE_PRISMA_SCHEMA override -------------------------------------
// Point the env var (folder form) at the OTHER fixture's schema while scanning
// the schema-aware tree. That schema declares neither Session nor Enrollment,
// so the `@unique token` and `@@id([userId, courseId])` suppressions must
// disappear — proof the override really replaced discovery instead of the
// scanner quietly finding ../prisma/schema.prisma next door.
console.log("[test] #195 LATTICE_PRISMA_SCHEMA override");
try {
  const hits = scan(path.join(P, "good.ts"), {
    LATTICE_PRISMA_SCHEMA: path.join(FIX, "missing-tenant-filter-prisma-multifile", "prisma", "schema"),
  });
  const wanted = ["40|HIGH|session.updateMany", "50|HIGH|enrollment.updateMany"];
  if (wanted.every((w) => hits.includes(w))) ok("override schema replaces discovery");
  else bad(`override not applied — expected ${wanted.join(", ")}, got ${hits.join(", ") || "(none)"}`);
} catch (e) { bad(`override run failed: ${e.message}`); }

console.log(failed ? "[test] FAILED" : "[test] all checks passed");
process.exit(failed);
