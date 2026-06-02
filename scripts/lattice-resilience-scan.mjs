#!/usr/bin/env node
// Deterministic silent-failure scanner — core/silent-fallback (#123, dimension: resilience).
//
// Flags swallowed errors and silently-discarded async work — the biggest fleet
// family. Precision over recall by design: only high-confidence shapes count,
// and an intentional empty catch (with an explanatory `intentional`/`ignore`/
// `noop`/`expected` comment) is spared. A noisy detector is worse than none, so
// when unsure we DON'T flag.
//
// Output: one `file|line|tier|key|snippet` per hit on stdout; a count on stderr.
// One pass over the tree — no per-line fork (cf. the yaml-field-fork WATCH).

import fs from "fs";
import path from "path";

const root = process.argv[2] || ".";

const COMMENT = /^\s*(\/\/|#|\*|\/\*)/;
const DEV_GUARD =
  /(kDebugMode|__DEV__|process\.env\.NODE_ENV\s*[!=]==?\s*['"](production|development)|if\s*\(\s*debug)/;

// An explanatory marker on the same line or the line above spares an empty
// catch — it's a deliberate, documented swallow, not an accident.
const INTENTIONAL = /\b(intentional|ignore|ignored|noop|no-op|expected|deliberate|on purpose)\b/i;

// --- Sub-rule 1: empty catch -------------------------------------------------
// `catch {}` / `catch (e) {}` / `catch (err) {}` with empty-or-whitespace body
// on the SAME line. Also `.catch(() => {})` / `.catch(()=>{})` /
// `.catch(function(){})` with an empty handler body.
const RE_EMPTY_CATCH =
  /\bcatch\b\s*(\([^)]*\)\s*)?\{\s*\}/;
const RE_EMPTY_CATCH_HANDLER =
  /\.catch\s*\(\s*(\([^)]*\)|function\s*\([^)]*\))\s*=?>?\s*\{\s*\}\s*\)/;

// --- Sub-rule 2: catch that swallows + returns a benign value ----------------
// Opening of a catch block whose body (next <=3 lines) only returns a benign
// value with no log/throw/rethrow.
const RE_CATCH_OPEN = /\bcatch\b\s*(\([^)]*\))?\s*\{\s*$/;
const RE_BENIGN_RETURN =
  /^\s*return\s*(null|false|\[\]|\{\}|undefined)?\s*;?\s*$/;
const HAS_LOG_OR_THROW = /\b(throw|console|log|logger|logging|report|capture|sentry|track|notify)\b/i;

// --- Sub-rule 3: fail-open in an auth/guard/permission file ------------------
// A catch block (next <=3 lines) that returns a permissive value. Only active
// when the path looks like an auth surface.
const FAILOPEN_PATH = /(guard|auth|permission|middleware)/i;
const RE_FAILOPEN =
  /^\s*return\s+(true|next\s*\(\s*\))\s*;?\s*$|^\s*allow\b/;

// --- Sub-rules deliberately DROPPED for precision ----------------------------
// "fire-and-forget" (bare unawaited async call) and "degradation-fallback"
// (`await x() || fallback`) were specified as FP-prone with explicit
// permission to drop if noisy. On real code the fire-and-forget heuristic
// can't tell a sync `writeFileSync(...)` / `process.stdout.write(...)` /
// local helper from genuine unawaited async work without type info, and it
// fired on those. Per "precision over recall", both are omitted rather than
// shipped as noise.

const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage", "vendor",
  ".lattice", "__pycache__", ".venv", "venv", ".dart_tool", ".netlify",
]);
const EXTS = new Set([".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs", ".dart", ".py"]);
const TEST_RE = /(\.spec\.|\.test\.|_test\.|\/tests?\/|\/__tests__\/)/;
// Scanner fixtures (intentional sample files) live under a `fixtures/` dir that
// may itself sit beneath `test/`. Those must be scanned, so a `fixtures/`
// segment overrides the test-skip above.
const FIXTURE_RE = /\/fixtures\//;

function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!EXCLUDE_DIRS.has(e.name)) yield* walk(p); }
    else if (EXTS.has(path.extname(e.name))) yield p;
  }
}

// Diff-scoped mode: when LATTICE_SCAN_FILES is set, scan only those files
// (one per line) instead of walking the tree. Keeps the detector cheap on a
// changed-files-only CI run. This helper is identical across the scanners.
function* targets(root) {
  const env = process.env.LATTICE_SCAN_FILES;
  if (env && env.trim()) {
    for (const raw of env.split(/\r?\n/)) {
      const t = raw.trim();
      if (!t) continue;
      if (!EXTS.has(path.extname(t))) continue;
      try { if (fs.statSync(t).isFile()) yield t; } catch {}
    }
    return;
  }
  yield* walk(root);
}

let count = 0;
for (const file of targets(root)) {
  const norm = file.replace(/\\/g, "/");
  if (TEST_RE.test(norm) && !FIXTURE_RE.test(norm)) continue;
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
  const lines = text.split(/\r?\n/);
  const isAuthFile = FAILOPEN_PATH.test(norm);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (COMMENT.test(line)) continue;
    if (DEV_GUARD.test(line)) continue;

    let key = null;
    let tier = "MEDIUM";

    // 1. Empty catch (statement or .catch handler).
    if (RE_EMPTY_CATCH.test(line) || RE_EMPTY_CATCH_HANDLER.test(line)) {
      // Spare if an explanatory marker sits on this line or the line above.
      const above = lines[i - 1] || "";
      if (INTENTIONAL.test(line) || INTENTIONAL.test(above)) continue;
      key = "empty-catch";
      tier = "MEDIUM";
    }

    // 2/3. catch-open → inspect the block body (next <=3 lines).
    if (!key && RE_CATCH_OPEN.test(line)) {
      const above = lines[i - 1] || "";
      if (INTENTIONAL.test(line) || INTENTIONAL.test(above)) continue;
      // Gather body lines up to the next `}` or 3 lines, whichever first.
      // Strip trailing `// ...` comments so an explanatory inline comment
      // doesn't defeat the end-of-line-anchored return matchers.
      const body = [];
      for (let j = i + 1; j < lines.length && body.length < 3; j++) {
        const b = lines[j];
        if (/^\s*\}/.test(b)) break;
        body.push(b.replace(/\/\/.*$/, ""));
      }
      const bodyText = body.join("\n");
      const hasGuard = HAS_LOG_OR_THROW.test(bodyText);

      // Fail-open takes priority in auth files.
      if (isAuthFile && !hasGuard && body.some((b) => RE_FAILOPEN.test(b))) {
        key = "fail-open";
        tier = "HIGH";
      } else if (
        !hasGuard &&
        body.length >= 1 &&
        body.every((b) => b.trim() === "" || RE_BENIGN_RETURN.test(b)) &&
        body.some((b) => RE_BENIGN_RETURN.test(b))
      ) {
        key = "catch-returns-benign";
        tier = "MEDIUM";
      }
    }

    if (!key) continue;
    const snippet = line.trim().slice(0, 120).replace(/\|/g, "/");
    console.log([file, i + 1, tier, key, snippet].join("|"));
    count++;
  }
}
console.error(`# silent-fallback: ${count} hit(s)`);
