#!/usr/bin/env node
// Deterministic in-memory-state scanner — core/in-mem-state-no-cluster (#121).
//
// Flags module-level mutable state that won't survive horizontal scaling: it
// lives in ONE process's heap, so a second instance behind a load balancer
// sees a different value. Precision over recall by design — a module-level
// collection only counts when it is BOTH declared at top level AND mutated in
// the same file; read-only config maps never flag. In-process cache/rate-limit
// libs and module-scope cron timers flag on sight.
//
// Output: one `file|line|tier|key|snippet` per hit on stdout; a count on stderr.
// One pass over the tree — no per-line fork (cf. the yaml-field-fork WATCH).

import fs from "fs";
import path from "path";

const root = process.argv[2] || ".";

const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage", "vendor",
  ".lattice", "__pycache__", ".venv", "venv", ".dart_tool", ".netlify",
]);
const EXTS = new Set([".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs"]);
const TEST_RE = /(\.spec\.|\.test\.|_test\.|\/tests?\/|\/__tests__\/|\/fixtures?\/)/;
const COMMENT = /^\s*(\/\/|\*|\/\*)/;

// A line is "top level" when the declaration starts at column 0, optionally
// after `export ` / `export default `. Indented declarations are inside a
// function/class/block and are NOT module state.
const TOP_DECL = /^(export\s+(default\s+)?)?(const|let|var)\s+/;

// Module-level mutable collection declarations. Capture the binding name so we
// can prove it is later mutated.
const MAP_SET = new RegExp(
  TOP_DECL.source + "([A-Za-z_$][\\w$]*)\\s*(?::[^=]+)?=\\s*new\\s+(Map|Set|WeakMap|WeakSet)\\b"
);
const OBJ_LIT = new RegExp(
  TOP_DECL.source + "([A-Za-z_$][\\w$]*)\\s*(?::[^=]+)?=\\s*\\{\\s*\\}\\s*;?\\s*$"
);
const ARR_LIT = new RegExp(
  TOP_DECL.source + "([A-Za-z_$][\\w$]*)\\s*(?::[^=]+)?=\\s*\\[\\s*\\]\\s*;?\\s*$"
);
// `let count = 0` style numeric counters (let/var only — const can't be ++'d).
const NUM_COUNTER = new RegExp(
  "^(export\\s+)?(let|var)\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=]+)?=\\s*-?\\d+\\s*;?\\s*$"
);

// In-process cache / rate-limit libraries — a shared store is needed for these
// to be correct across instances.
const CACHE_LIB =
  /(new\s+LRUCache\s*\(|require\(\s*['"]lru-cache['"]|from\s+['"]lru-cache['"]|new\s+NodeCache\s*\(|require\(\s*['"]node-cache['"]|from\s+['"]node-cache['"])/;
const RATE_LIMIT = /\b(rateLimit|expressRateLimit|RateLimit)\s*\(/;
const HAS_STORE = /\bstore\s*:/;

// Module-scope timer-based cron — double-fires on N instances.
const TIMER = /\b(setInterval|setTimeout)\s*\(/;

function mutatedIn(text, name) {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // .set( / .add( / .push( / .pop / .shift / .unshift / .delete( / .clear(
  if (new RegExp("\\b" + n + "\\.(set|add|push|pop|shift|unshift|splice|delete|clear)\\s*\\(").test(text)) return true;
  // index / property assignment: x[...] = ... or x.foo = ...
  if (new RegExp("\\b" + n + "(\\[[^\\]]*\\]|\\.[A-Za-z_$][\\w$]*)\\s*[-+*/]?=(?!=)").test(text)) return true;
  // Object.assign(x, ...)
  if (new RegExp("Object\\.assign\\s*\\(\\s*" + n + "\\b").test(text)) return true;
  return false;
}

function counterMutatedIn(text, name) {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // count++ / count-- / ++count / --count / count += / count = count + ...
  if (new RegExp("\\b" + n + "\\s*(\\+\\+|--)").test(text)) return true;
  if (new RegExp("(\\+\\+|--)\\s*" + n + "\\b").test(text)) return true;
  if (new RegExp("\\b" + n + "\\s*[-+*/]=(?!=)").test(text)) return true;
  if (new RegExp("\\b" + n + "\\s*=\\s*" + n + "\\b").test(text)) return true;
  return false;
}

function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!EXCLUDE_DIRS.has(e.name)) yield* walk(p); }
    else if (EXTS.has(path.extname(e.name))) yield p;
  }
}

let count = 0;
const emit = (file, i, tier, key, line) => {
  const snippet = line.trim().slice(0, 120).replace(/\|/g, "/");
  console.log([file, i + 1, tier, key, snippet].join("|"));
  count++;
};

for (const file of walk(root)) {
  const norm = file.replace(/\\/g, "/");
  if (TEST_RE.test(norm) && !/\/fixtures?\/.*\/(bad|good)\./.test(norm)) continue;
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (COMMENT.test(line)) continue;

    // 1. Module-level mutable collections (declared top-level AND mutated).
    let m;
    if ((m = line.match(MAP_SET))) {
      const name = m[4];
      if (mutatedIn(text, name)) { emit(file, i, "RISK", "module-mutable-state", line); continue; }
    } else if ((m = line.match(OBJ_LIT)) || (m = line.match(ARR_LIT))) {
      const name = m[4];
      if (mutatedIn(text, name)) { emit(file, i, "RISK", "module-mutable-state", line); continue; }
    } else if ((m = line.match(NUM_COUNTER))) {
      const name = m[3];
      if (counterMutatedIn(text, name)) { emit(file, i, "RISK", "module-mutable-state", line); continue; }
    }

    // 2. In-process cache / rate-limit libs.
    if (CACHE_LIB.test(line)) { emit(file, i, "RISK", "in-process-cache", line); continue; }
    if (RATE_LIMIT.test(line) && !HAS_STORE.test(line)) {
      emit(file, i, "RISK", "in-process-cache", line); continue;
    }

    // 3. Module-scope cron timers — only when NOT indented (top-level scope).
    if (TIMER.test(line) && /^(setInterval|setTimeout)\b/.test(line.trimStart()) && line.search(/\S/) === 0) {
      emit(file, i, "RISK", "in-process-cron", line); continue;
    }
  }
}
console.error(`# in-mem-state-no-cluster: ${count} hit(s)`);
