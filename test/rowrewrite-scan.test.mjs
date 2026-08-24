#!/usr/bin/env node
// test/rowrewrite-scan.test.mjs — detector test for core/row-rewrite-in-tx (#196).
//
// Background: a results pipeline deleted and recreated a Result and its
// ResultToken on every run, inside one transaction. Five callers could trigger
// a re-run; each minted a NEW /r/:token while the URL already sent to the
// customer pointed at the deleted row, and the same delete silently discarded
// retestReminderOptIn, retestReminderSentAt, suggestionsDeliveryStatus and the
// token's viewCount. No exception, no log, green CI.
//
// The rule is schema-decided, not name-matched: a child whose foreign key
// declares `onDelete: Cascade` is transient by design (replacing the set
// wholesale is the documented pattern), while one being hand-deleted to get
// past its own foreign key is the signature. What is tested:
//
//   1. bad.ts   — the incident, the extracted-helper form with a nested create,
//                 and the sequential-array form all flag HIGH, and the snippet
//                 names the columns that will silently reset.
//   2. good.ts  — cascade replace-all, upsert, delete-without-create,
//                 create-then-delete, a model with nothing to lose, a model the
//                 schema does not declare, and a non-transactional pair are all
//                 silent.
//   3. the cascade verdict follows LATTICE_PRISMA_SCHEMA, proving it is read
//      from the schema and not guessed from the model name.
//   4. directory-walk and LATTICE_SCAN_FILES modes agree with file mode.
//
// Run directly:  node test/rowrewrite-scan.test.mjs
// CI runs it:    via scripts/validate.sh

import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SCANNER = path.join(ROOT, "scripts", "lattice-rowrewrite-scan.mjs");
const FIX = path.join(HERE, "fixtures", "row-rewrite-in-tx");
const BAD = path.join(FIX, "src", "bad.ts");
const GOOD = path.join(FIX, "src", "good.ts");

let failed = 0;
const ok = (m) => console.log(`  ok: ${m}`);
const bad = (m) => { console.error(`  FAIL: ${m}`); failed = 1; };

// Run the scanner over one target; return the raw `file|line|tier|key|snippet`
// rows plus the stderr summary line.
function run(target, env = {}) {
  const res = execFileSync(process.execPath, [SCANNER, target], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return res.split("\n").filter(Boolean);
}
// `line|tier|key` for every hit — the identity of a finding, snippet aside.
const shape = (rows) => rows.map((l) => { const [, line, tier, key] = l.split("|"); return `${line}|${tier}|${key}`; });

function expectHits(target, expected, label, env) {
  let got;
  try { got = shape(run(target, env)); } catch (e) { return bad(`${label}: scanner failed: ${e.message}`); }
  const g = got.join("\n"), e = expected.join("\n");
  if (g === e) ok(`${label} (${got.length} hit(s))`);
  else bad(`${label}\n    expected:\n      ${expected.join("\n      ") || "(none)"}\n    got:\n      ${got.join("\n      ") || "(none)"}`);
}

// --- 1. The incident and its two other spellings ---------------------------
console.log("[test] #196 row rewrite inside a transaction");
const BAD_HITS = [
  "17|HIGH|resultToken.deleteMany+create",         // the incident: dead /r/:token
  "18|HIGH|result.deleteMany+create",              // opt-in flags, reminder stamp
  "29|HIGH|resultToken.deleteMany+nested-create",  // helper form, nested write
  "40|HIGH|resultToken.deleteMany+create",         // $transaction([ … ]) array form
];
expectHits(BAD, BAD_HITS, "delete-then-create on a durable row flags HIGH");

// --- 2. The columns that silently reset must be named ----------------------
// Naming them is the point: the dead link was the small half of the incident.
try {
  const rows = run(BAD);
  const tokenSnippet = rows[0].split("|")[4];
  const resultSnippet = rows[1].split("|")[4];
  const wantToken = ["token", "viewCount"];
  const wantResult = ["retestReminderOptIn", "retestReminderSentAt", "suggestionsDeliveryStatus"];
  if (wantToken.every((c) => tokenSnippet.includes(c)) && wantResult.every((c) => resultSnippet.includes(c))) {
    ok("snippet names the columns that reset to their defaults");
  } else {
    bad(`reset columns not reported\n    token:  ${tokenSnippet}\n    result: ${resultSnippet}`);
  }
  // A column the create DOES set is not a reset, and @updatedAt is the ORM's.
  if (!resultSnippet.includes("narrative") && !resultSnippet.includes("updatedAt")) {
    ok("columns the create sets (and @updatedAt) are not reported as resets");
  } else {
    bad(`over-reported columns: ${resultSnippet}`);
  }
} catch (e) { bad(`reset-column check failed: ${e.message}`); }

// --- 3. Legitimate shapes stay silent --------------------------------------
expectHits(GOOD, [], "cascade replace-all, upsert and non-rewrites produce no findings");

// --- 4. The cascade verdict comes from the schema --------------------------
// Same bad.ts, a schema where ResultToken cascades: the two ResultToken
// rewrites must disappear and the Result one must survive. Nothing about the
// source changed, so only the schema can be deciding.
console.log("[test] #196 LATTICE_PRISMA_SCHEMA decides the cascade verdict");
expectHits(BAD, ["18|HIGH|result.deleteMany+create"],
  "a cascading ResultToken is transient and no longer reported",
  { LATTICE_PRISMA_SCHEMA: path.join(FIX, "alt", "cascade.prisma") });

// --- 5. Walk mode and diff-scoped mode agree with file mode ----------------
console.log("[test] #196 scan-set modes");
try {
  const walked = shape(run(FIX));
  if (walked.join("\n") === BAD_HITS.join("\n")) ok("directory walk finds exactly the bad.ts hits");
  else bad(`directory walk\n    expected:\n      ${BAD_HITS.join("\n      ")}\n    got:\n      ${walked.join("\n      ") || "(none)"}`);
} catch (e) { bad(`directory walk failed: ${e.message}`); }
try {
  const scoped = shape(run(ROOT, { LATTICE_SCAN_FILES: `${BAD}\n${GOOD}\n` }));
  if (scoped.join("\n") === BAD_HITS.join("\n")) ok("LATTICE_SCAN_FILES scans exactly the listed files");
  else bad(`LATTICE_SCAN_FILES\n    expected:\n      ${BAD_HITS.join("\n      ")}\n    got:\n      ${scoped.join("\n      ") || "(none)"}`);
} catch (e) { bad(`LATTICE_SCAN_FILES run failed: ${e.message}`); }

console.log(failed ? "[test] FAILED" : "[test] all checks passed");
process.exit(failed);
