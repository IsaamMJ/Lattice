#!/usr/bin/env node
// Deterministic missing-rate-limit scanner — core/missing-rate-limit (#120).
//
// Flags public entrypoints with no rate-limit guard, plus cluster-unsafe
// in-memory limiters. This rule is FP-prone, so precision wins over recall:
// only HIGH-CONFIDENCE shapes are matched, and a single rate-limit token
// ANYWHERE in a file suppresses every handler hit in that file (assume covered).
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
const TEST_RE = /(\.spec\.|\.test\.|_test\.|\/tests?\/|\/__tests__\/)/;
const COMMENT = /^\s*(\/\/|\*|\/\*)/;

// Any rate-limit token in the file => assume the surface is covered.
// Broad on purpose: false-negative (skip a covered file) is the safe direction.
const RATE_LIMIT_TOKEN =
  /(rateLimit|ratelimit|Ratelimit|rate_limit|@upstash\/ratelimit|@Throttle\b|Throttle\b|ThrottlerGuard|ThrottlerModule|express-rate-limit|rate-limiter-flexible|bottleneck|p-limit|leaky.?bucket|token.?bucket|\bquota\b|\bbudget\b|\bINCR\b|requestsPerMinute|maxRequests)/i;

// Public-surface signal from file name/path.
const PUBLIC_PATH = /(webhook|public|payment|billing|checkout)/i;
const AUTH_PATH = /(auth|login|signin|signup|register|oauth|otp|reset.?password)/i;

// NestJS shapes.
const NEST_CONTROLLER = /@Controller\s*\(/;
const NEST_HANDLER = /@(Post|Get|Put|Patch|Delete|All)\s*\(/;
const NEST_GUARD = /@UseGuards\s*\([^)]*ThrottlerGuard/;

// Next.js API route handler exports.
const NEXT_EXPORT =
  /export\s+(async\s+)?function\s+(POST|GET|PUT|PATCH|DELETE)\b|export\s+const\s+(POST|GET|PUT|PATCH|DELETE)\s*=/;

// Express route registration.
const EXPRESS_ROUTE = /\b(app|router)\.(post|get|put|patch|delete|all)\s*\(/;

// LLM cost path.
const LLM_CALL =
  /(\.chat\.completions\.create|\.messages\.create|generateContent|\.completions\.create)\b/;
const LLM_IMPORT =
  /(from\s+['"](openai|@anthropic-ai\/sdk|@google\/generative-ai)['"]|require\(\s*['"](openai|@anthropic-ai\/sdk|@google\/generative-ai)['"])/;
const LLM_BUDGET = /(rateLimit|ratelimit|\bbudget\b|\bINCR\b|\bquota\b|tokensUsed|usageLimit|spendLimit|costGuard)/i;

// In-memory limiter shapes (cluster-unsafe).
const NEW_RATELIMITER = /new\s+(RateLimiter|RateLimit|TokenBucket|LeakyBucket)\s*\(/;
const EXPRESS_RL_DEFAULT = /\b(rateLimit|expressRateLimit)\s*\(\s*\{/; // express-rate-limit({...})
const EXPRESS_RL_STORE = /\bstore\s*:/; // a custom store => not in-memory default

function isNextRoute(p) {
  const u = p.replace(/\\/g, "/");
  return /\/app\/.*\/route\.(t|j)sx?$/.test(u) || /\/pages\/api\//.test(u);
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
function hit(file, lineNo, tier, key, line) {
  const snippet = line.trim().slice(0, 120).replace(/\|/g, "/");
  console.log([file, lineNo, tier, key, snippet].join("|"));
  count++;
}

function* targets(r) {
  const env = process.env.LATTICE_SCAN_FILES;
  if (env && env.trim()) {
    for (const raw of env.split(/\r?\n/)) {
      const t = raw.trim();
      if (t && EXTS.has(path.extname(t))) { try { if (fs.statSync(t).isFile()) yield t; } catch {} }
    }
    return;
  }
  yield* walk(r);
}

for (const file of targets(root)) {
  const norm = file.replace(/\\/g, "/");
  if (TEST_RE.test(norm)) continue;
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
  const lines = text.split(/\r?\n/);

  // File-level signals are computed over CODE only. A descriptive comment
  // ("No @Throttle here", "TODO: add a budget") must not suppress a real hit,
  // and a comment must not by itself make a file look like an LLM caller.
  const code = lines.filter((l) => !COMMENT.test(l)).join("\n");

  const fileHasRateLimit = RATE_LIMIT_TOKEN.test(code);
  const isPublic = PUBLIC_PATH.test(norm);
  const isAuth = AUTH_PATH.test(norm);
  const nextRoute = isNextRoute(file);
  const llmFile = LLM_IMPORT.test(code) || LLM_CALL.test(code);

  // ---- In-memory limiter detection (RISK) — runs even if file has RL token,
  //      because the point is that the limiter IS the (unsafe) implementation.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (COMMENT.test(line)) continue;
    if (NEW_RATELIMITER.test(line)) {
      hit(file, i + 1, "RISK", "in-memory-rate-limit", line);
      continue;
    }
    // express-rate-limit() with no custom `store:` on the same line and no
    // store configured anywhere in the file => default in-memory store.
    if (EXPRESS_RL_DEFAULT.test(line) && !EXPRESS_RL_STORE.test(code)) {
      hit(file, i + 1, "RISK", "in-memory-rate-limit", line);
    }
  }

  // ---- LLM cost path (HIGH): no per-user budget/counter token anywhere.
  if (llmFile && !LLM_BUDGET.test(code)) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (COMMENT.test(line)) continue;
      if (LLM_CALL.test(line)) {
        hit(file, i + 1, "HIGH", "llm-no-budget", line);
      }
    }
  }

  // ---- Public-entrypoint detection. A rate-limit token anywhere => covered.
  if (fileHasRateLimit) continue;

  // NestJS: only flag when the file path suggests a public surface (precision).
  // We only enter these branches when isPublic || isAuth, so the tier is HIGH:
  // webhook/payment files and auth files are the high-confidence public shapes.
  const nestController = lines.findIndex((l) => NEST_CONTROLLER.test(l) && !COMMENT.test(l));
  if (nestController !== -1 && (isPublic || isAuth) && !NEST_GUARD.test(code)) {
    hit(file, nestController + 1, "HIGH", "nest-no-throttle", lines[nestController]);
  } else {
    // No controller-level hit; check decorated handlers on a public-surface file.
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (COMMENT.test(line)) continue;
      if (NEST_HANDLER.test(line) && (isPublic || isAuth)) {
        const tier = (PUBLIC_PATH.test(norm) || isAuth) ? "HIGH" : "MEDIUM";
        hit(file, i + 1, tier, "nest-no-throttle", line);
      }
    }
  }

  // Next.js API routes: flag the exported handler line.
  if (nextRoute) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (COMMENT.test(line)) continue;
      if (NEXT_EXPORT.test(line)) {
        const tier = (isPublic || isAuth) ? "HIGH" : "MEDIUM";
        hit(file, i + 1, tier, "next-route-no-ratelimit", line);
      }
    }
  }

  // Express routes: flag registration line (file has no RL middleware token).
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (COMMENT.test(line)) continue;
    if (EXPRESS_ROUTE.test(line)) {
      const tier = (isPublic || isAuth) ? "HIGH" : "MEDIUM";
      hit(file, i + 1, tier, "express-no-ratelimit", line);
    }
  }
}

console.error(`# missing-rate-limit: ${count} hit(s)`);
