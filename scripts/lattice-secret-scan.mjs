#!/usr/bin/env node
// Deterministic secret-in-logs scanner — core/secret-in-logs (#118).
//
// Flags a sensitive VALUE reaching a log sink, NOT a sensitive word inside a
// message string. Precision over recall by design: only interpolation,
// bare-argument, concatenation, and object-shorthand positions count. The loose
// words that caused the day-1 false-positive wave (authorizationStatus,
// "token refresh failed: $e") are deliberately unmatched.
//
// Output: one `file|line|tier|key|snippet` per hit on stdout; a count on stderr.
// One pass over the tree — no per-line fork (cf. the yaml-field-fork WATCH).

import fs from "fs";
import path from "path";

const root = process.argv[2] || ".";

// Log sinks across JS/TS, Dart, Python, Java.
const SINK =
  /(console\.(log|info|warn|error|debug|trace)|\b(log|logger|logging)\.(log|debug|info|warn|warning|error|trace)|\bprint\s*\(|\bdebugPrint\s*\(|System\.out\.print)/;

// Tight secret identifiers. NO standalone "token" (matches "reset token",
// "token expired", …) and NO "authorization"/"email"/"phone" (FP-prone).
const S =
  "(accessToken|access_token|refreshToken|refresh_token|idToken|id_token|apiKey|api_key|apikey|clientSecret|client_secret|privateKey|private_key|sessionToken|session_token|authToken|auth_token|bearerToken|secret|password|passwd|bearer|jwt|otp|cvv)";

// The secret must appear in a VALUE position (used), not a description.
const VALUE_PATTERNS = [
  new RegExp("\\$\\{[^}]*" + S + "[^}]*\\}", "i"), // `${accessToken}`
  new RegExp("\\$" + S + "\\b", "i"),               // `$bearerToken` (dart/shell)
  new RegExp("[(,+]\\s*" + S + "\\b", "i"),         // bare arg / concat: (apiKey, + clientSecret
  new RegExp("\\{[^}]*\\b" + S + "\\b[^}]*\\}", "i"), // { password }
];

const DEV_GUARD =
  /(kDebugMode|__DEV__|process\.env\.NODE_ENV\s*[!=]==?\s*['"](production|development)|if\s*\(\s*debug)/;
const COMMENT = /^\s*(\/\/|#|\*|\/\*)/;

const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage", "vendor",
  ".lattice", "__pycache__", ".venv", "venv", ".dart_tool", ".netlify",
]);
const EXTS = new Set([".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs", ".dart", ".py"]);
const TEST_RE = /(\.spec\.|\.test\.|_test\.|\/tests?\/|\/__tests__\/)/;
// Self-test carve-out: real test files are skipped, but our own fixtures live
// under test/fixtures/ and must stay scannable (matters when invoked with an
// absolute path, where "/test/" would otherwise match TEST_RE).
const FIXTURE_RE = /\/fixtures\//;

// Tier by sensitivity: hard secrets HIGH, the softer "bearer/jwt/otp" MEDIUM.
const SECRET_RE = new RegExp(S, "i");
function tierFor(key) {
  return /^(otp|cvv|bearer|jwt)$/i.test(key) ? "MEDIUM" : "HIGH";
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
for (const file of walk(root)) {
  const rel = file.replace(/\\/g, "/");
  if (TEST_RE.test(rel) && !FIXTURE_RE.test(rel)) continue;
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (COMMENT.test(line)) continue;
    if (!SINK.test(line)) continue;
    if (DEV_GUARD.test(line)) continue;
    if (!VALUE_PATTERNS.some((re) => re.test(line))) continue;
    const m = line.match(SECRET_RE);
    const key = m ? m[0] : "secret";
    const snippet = line.trim().slice(0, 120).replace(/\|/g, "/");
    console.log([file, i + 1, tierFor(key), key, snippet].join("|"));
    count++;
  }
}
console.error(`# secret-in-logs: ${count} hit(s)`);
