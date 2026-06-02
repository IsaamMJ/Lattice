#!/usr/bin/env node
// Deterministic unbounded-external-call scanner — core/unbounded-external-call (#119).
//
// Flags an external/network call made with NO timeout, deadline, or abort
// signal. Precision over recall by design: only calls that plausibly hit the
// network count, and a call is spared the moment a timeout/signal/abort token
// appears on the same logical line. The day-1 lesson holds — a noisy detector
// is worse than none, so when unsure we DON'T flag.
//
// Output: one `file|line|tier|key|snippet` per hit on stdout; a count on stderr.
// One pass over the tree — no per-line fork (cf. the yaml-field-fork WATCH).

import fs from "fs";
import path from "path";

const root = process.argv[2] || ".";

const COMMENT = /^\s*(\/\/|#|\*|\/\*)/;

// A timeout/deadline/abort token anywhere on the (joined) logical line spares
// the call. Broad on purpose: better to miss a hit than to fire a false one.
const HAS_BOUND =
  /\b(signal|timeout|AbortSignal|AbortController|deadline|connectTimeout|receiveTimeout|sendTimeout|max_time|read_timeout|connect_timeout)\b/i;

// ---- Detectors. Each yields {key, tier} when its trigger matches and no bound. ----

// JS/TS: fetch( ... )   — relies on no-default-timeout in node/browser fetch.
const RE_FETCH = /(^|[^.\w])fetch\s*\(/;

// JS/TS: axios(...) | axios.get/post/put/delete/patch/head/request(...)
const RE_AXIOS = /\baxios(\.(get|post|put|delete|patch|head|options|request))?\s*\(/;

// JS/TS: new OpenAI( ... ) — SDK client construction relying on default timeout.
const RE_OPENAI = /\bnew\s+OpenAI\s*\(/;

// Python: requests.get/post/... ( ... )
const RE_REQUESTS = /\brequests\.(get|post|put|delete|patch|head|options|request)\s*\(/;

// Python: httpx.get/post/... ( ... )  and  httpx.Client/AsyncClient( ... )
const RE_HTTPX = /\bhttpx\.(get|post|put|delete|patch|head|options|request|Client|AsyncClient|stream)\s*\(/;

// Dart: http.get/post/... ( ... )
const RE_DART_HTTP = /\bhttp\.(get|post|put|delete|patch|head|read)\s*\(/;

// Dart: dio.get/post/... ( ... )  (Dio instance conventionally named dio)
const RE_DART_DIO = /\bdio\.(get|post|put|delete|patch|head|request|fetch)\s*\(/;

const DETECTORS = [
  { re: RE_FETCH, key: "fetch" },
  { re: RE_AXIOS, key: "axios" },
  { re: RE_OPENAI, key: "openai" },
  { re: RE_REQUESTS, key: "requests" },
  { re: RE_HTTPX, key: "httpx" },
  { re: RE_DART_HTTP, key: "http" },
  { re: RE_DART_DIO, key: "dio" },
];

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

let count = 0;
for (const file of walk(root)) {
  const norm = file.replace(/\\/g, "/");
  if (TEST_RE.test(norm) && !FIXTURE_RE.test(norm)) continue;
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (COMMENT.test(line)) continue;

    // Join with the next two lines so a multi-line call argument list (where the
    // timeout/signal option sits on a following line) is treated as one logical
    // line. This is the precision guard: it lets bound options on a later line
    // spare the call.
    const logical = line + "\n" + (lines[i + 1] || "") + "\n" + (lines[i + 2] || "");

    for (const d of DETECTORS) {
      if (!d.re.test(line)) continue;
      if (HAS_BOUND.test(logical)) continue;
      const snippet = line.trim().slice(0, 120).replace(/\|/g, "/");
      console.log([file, i + 1, "RISK", d.key, snippet].join("|"));
      count++;
      break; // one hit per line is enough
    }
  }
}
console.error(`# unbounded-external-call: ${count} hit(s)`);
