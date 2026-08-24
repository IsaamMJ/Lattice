#!/usr/bin/env node
// test/selectdrift-scan.test.mjs — detector test for core/select-shape-drift (#196).
//
// Background: three endpoints built the same response object from hand-copied
// `prisma.result` selects. A field was added to exactly one of them. The
// consuming UI guarded on it, so the missing field did not throw, did not log
// and did not fail a test — a button shipped to production invisible and an
// endpoint shipped with no working caller. Found by a screenshot.
//
// The rule is pure structure: the key set of every select block, grouped by
// model, compared by Jaccard overlap. Equal sets are duplication and say
// nothing; near-equal sets are drift, and the finding IS the symmetric
// difference. What is tested:
//
//   1. bad/    — the three drifting endpoint copies, a drifting pair of
//                generated-type select constants, and a nested relation select
//                that drifts across files all flag LOW.
//   2. the snippet names the symmetric difference in both directions — the
//                point of the rule is WHICH key drifted, not that one did.
//   3. good/   — two byte-identical selects, an unrelated projection of the
//                same model, an extracted shared constant and its reference, a
//                spread, a conditional value and a non-Prisma `.select` are all
//                silent.
//   4. the threshold governs the verdict and is configurable.
//   5. nested attribution follows the schema: re-running the same source
//      against a schema where the relation does not exist drops that finding,
//      proving the model is READ, not guessed from the key's spelling.
//   6. a project with NO schema still reports top-level drift (the verdict
//      needs no schema facts), while the schema-only capabilities drop out.
//   7. directory-walk, single-file and LATTICE_SCAN_FILES modes agree.
//
// Run directly:  node test/selectdrift-scan.test.mjs
// CI runs it:    via scripts/validate.sh

import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SCANNER = path.join(ROOT, "scripts", "lattice-selectdrift-scan.mjs");
const FIX = path.join(HERE, "fixtures", "select-shape-drift");
const BAD = path.join(FIX, "bad");
const GOOD = path.join(FIX, "good");
const ENDPOINTS = path.join(BAD, "endpoints.ts");
const SHARE = path.join(BAD, "share-route.ts");
const ALT_SCHEMA = path.join(FIX, "alt", "no-relation.prisma");

let failed = 0;
const ok = (m) => console.log(`  ok: ${m}`);
const bad = (m) => { console.error(`  FAIL: ${m}`); failed = 1; };

// Run the scanner over one target; return the raw `file|line|tier|key|snippet`
// rows.
function run(target, env = {}) {
  const res = execFileSync(process.execPath, [SCANNER, target], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return res.split("\n").filter(Boolean);
}
// `basename:line|tier|key` for every hit — the identity of a finding, snippet
// aside. The basename keeps the expectations readable and path-separator safe.
const shape = (rows) => rows.map((l) => {
  const [file, line, tier, key] = l.split("|");
  return `${path.basename(file)}:${line}|${tier}|${key}`;
});

function expectHits(target, expected, label, env) {
  let got;
  try { got = shape(run(target, env)); } catch (e) { return bad(`${label}: scanner failed: ${e.message}`); }
  const g = got.join("\n"), e = expected.join("\n");
  if (g === e) ok(`${label} (${got.length} hit(s))`);
  else bad(`${label}\n    expected:\n      ${expected.join("\n      ") || "(none)"}\n    got:\n      ${got.join("\n      ") || "(none)"}`);
}

// --- 1. The incident, in each of the shapes it is written in ---------------
console.log("[test] #196 near-identical selects drifting");
const BAD_HITS = [
  "endpoints.ts:18|LOW|Result.select",       // the copy that grew `bookingId`
  "endpoints.ts:34|LOW|Result.select",       // the copy that lost `createdAt`
  "selects.ts:13|LOW|ResultToken.select",    // two generated-type constants
  "share-route.ts:12|LOW|Result.select",     // nested relation select, other file
];
expectHits(BAD, BAD_HITS, "drifting selects on one model flag LOW");

// --- 2. The symmetric difference IS the finding ----------------------------
// A note that says "these two differ" is worthless; the field that drifted is
// the whole product of the rule.
try {
  const rows = run(BAD);
  const grew = rows[0].split("|")[4];
  if (/here only: bookingId/.test(grew) && /there only: \(none\)/.test(grew)) {
    ok("snippet names the key one copy grew (bookingId)");
  } else {
    bad(`snippet does not name the added key\n    got: ${grew}`);
  }
  const lost = rows[1].split("|")[4];
  if (/here only: \(none\)/.test(lost) && /there only: createdAt/.test(lost)) {
    ok("snippet names the key one copy lost (createdAt)");
  } else {
    bad(`snippet does not name the dropped key\n    got: ${lost}`);
  }
  // The peer has to be identified by file:line — the drift is between two
  // sites, and a note naming only one of them cannot be acted on.
  const nested = rows[3].split("|")[4];
  if (/drifts from .*endpoints\.ts:18/.test(nested)) {
    ok("snippet names the block it drifts from, across files");
  } else {
    bad(`snippet does not locate the peer block\n    got: ${nested}`);
  }
  if (/\d+\/\d+ keys shared/.test(grew)) ok("snippet reports the overlap it decided on");
  else bad(`snippet omits the overlap\n    got: ${grew}`);
} catch (e) {
  bad(`snippet checks: scanner failed: ${e.message}`);
}

// --- 3. What must stay silent ----------------------------------------------
// Two byte-identical selects are duplication, not drift; an unrelated
// projection is below the threshold; a shared constant is the FIX and must
// never be reported as drifting from itself; a spread, a conditional value and
// a non-Prisma `.select` are not statically decidable at all.
expectHits(GOOD, [], "identical, unrelated and undecidable selects stay silent");

// --- 4. The threshold governs the verdict, and is configurable -------------
// Every pair in bad/ overlaps below 0.9, so raising the bar must silence the
// rule entirely — proof the verdict is the set arithmetic and nothing else.
expectHits(BAD, [], "threshold 0.9 silences every pair", {
  LATTICE_SELECT_DRIFT_THRESHOLD: "0.9",
});
// A malformed threshold falls back to the default rather than disabling the rule.
expectHits(BAD, BAD_HITS, "malformed threshold falls back to the default", {
  LATTICE_SELECT_DRIFT_THRESHOLD: "not-a-number",
});

// --- 5. Nested attribution is READ from the schema -------------------------
// Same source, a schema where ResultToken declares no `result` relation: the
// nested select can no longer be attributed to Result, so it drops out. If the
// model were guessed from the key's spelling this hit would survive.
expectHits(BAD, BAD_HITS.filter((h) => !h.startsWith("share-route")),
  "nested select attribution follows the schema", { LATTICE_PRISMA_SCHEMA: ALT_SCHEMA });

// --- 6. No schema at all ---------------------------------------------------
// The verdict needs no schema facts, so top-level drift is still reported from
// the accessor alone. Only the schema-dependent capabilities — nested
// attribution and key validation — go away.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-selectdrift-"));
  try {
    for (const f of ["endpoints.ts", "selects.ts", "share-route.ts"]) {
      fs.copyFileSync(path.join(BAD, f), path.join(tmp, f));
    }
    expectHits(tmp, [
      "endpoints.ts:18|LOW|result.select",
      "endpoints.ts:34|LOW|result.select",
      "selects.ts:13|LOW|resultToken.select",
    ], "no schema: top-level drift still reported, nesting not followed");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// --- 7. Scan modes agree ---------------------------------------------------
// A single FILE is its own corpus (the self-test affordance), so only the
// same-file pairs are visible.
expectHits(ENDPOINTS, [
  "endpoints.ts:18|LOW|Result.select",
  "endpoints.ts:34|LOW|Result.select",
], "single-file mode compares within that file");

// LATTICE_SCAN_FILES is the diff-scoped corpus the pre-commit hook supplies:
// the listed files are compared against each other, walk or no walk.
expectHits(FIX, [
  "endpoints.ts:18|LOW|Result.select",
  "endpoints.ts:34|LOW|Result.select",
  "share-route.ts:12|LOW|Result.select",
], "LATTICE_SCAN_FILES scopes the corpus to the listed files", {
  LATTICE_SCAN_FILES: `${ENDPOINTS}\n${SHARE}\n`,
});

// The whole fixture tree walks bad/ and good/ together and still reports
// exactly bad/'s hits — good/'s selects do not become drift by being scanned
// alongside them.
expectHits(FIX, BAD_HITS, "directory walk over both trees agrees with bad/ alone");

process.exit(failed);
