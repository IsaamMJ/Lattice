#!/usr/bin/env node
// test/stop-hook-detach.test.mjs — regression test for #176.
//
// Background: lattice-stop.mjs (Claude Code Stop hook) spawns
// `lattice review --file --yes --quiet` at session end. It originally used
// detached:false, so on Windows the harness killed the child with the
// parent's process tree at the hook's 2s exit — the review NEVER completed
// and friction candidates silently accumulated unfiled for weeks
// (observed 2026-06-10). The fix is detached:true + child.unref() + an
// immediate parent exit. This test pins that down so detached:false can
// never silently come back.
//
// What is tested:
//   1. STATIC: scripts/lattice-stop.mjs contains `detached: true` and
//      `.unref()`, and does NOT contain `detached: false`.
//   2. BEHAVIORAL: running the hook in a non-Lattice temp dir exits 0 in
//      well under its 2s hard-timeout budget.
//   3. BEHAVIORAL: running the hook in a Lattice-shaped temp dir with
//      LATTICE_BIN pointing at a deliberately slow dummy CLI still exits 0
//      almost immediately — the parent must never wait on the review child.
//
// LIMITATION: a full "child survives parent exit" integration test is not
// done here. On Linux an orphaned child is re-parented to init whether or
// not it was detached, so survival would pass even with detached:false —
// the regression only manifests under the Windows Claude Code harness's
// process-tree kill. The static assertion in check 1 is the real guard.
//
// Run directly:  node test/stop-hook-detach.test.mjs
// CI runs it:    via scripts/validate.sh

import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(ROOT, 'scripts', 'lattice-stop.mjs');

let pass = 0;
let fail = 0;
const ok = (msg) => { console.log(`[stop-hook-test]   PASS: ${msg}`); pass++; };
const bad = (msg) => { console.error(`[stop-hook-test]   FAIL: ${msg}`); fail++; };

// --- 1. Static assertions on the hook source ---------------------------
// Strip /* */ and // comments first: the hook's own comments narrate the
// old detached:false bug, and prose must not satisfy (or trip) the checks.
const raw = readFileSync(HOOK, 'utf8');
const src = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s\/\/[^\n]*$/gm, '');
if (/detached:\s*true/.test(src)) ok('lattice-stop.mjs spawns with detached: true');
else bad('lattice-stop.mjs missing `detached: true` in spawn options (#176 regression)');

if (/\.unref\(\)/.test(src)) ok('lattice-stop.mjs unref()s the review child');
else bad('lattice-stop.mjs missing `.unref()` on the review child (#176 regression)');

if (/detached:\s*false/.test(src)) bad('lattice-stop.mjs contains `detached: false` (#176 regression)');
else ok('no `detached: false` present');

// --- 2. Hook exits 0 fast in a non-Lattice dir --------------------------
const scratch = mkdtempSync(join(tmpdir(), 'lattice-stop-test-'));
try {
  let t0 = Date.now();
  let r = spawnSync(process.execPath, [HOOK], {
    cwd: scratch,
    env: { ...process.env, CLAUDE_PROJECT_DIR: scratch },
    timeout: 10000,
  });
  let elapsed = Date.now() - t0;
  if (r.status === 0 && elapsed < 2000) ok(`non-Lattice dir: exit 0 in ${elapsed}ms (< 2000ms budget)`);
  else bad(`non-Lattice dir: exit ${r.status} in ${elapsed}ms (want exit 0, < 2000ms)`);

  // --- 3. Parent never waits on a slow review child ----------------------
  // Lattice-shaped dir + LATTICE_BIN = dummy CLI that sleeps 3s. With the
  // detach+unref fix the parent exits immediately; a parent that waits on
  // the child would blow well past the assertion (and its 2s hard timeout).
  mkdirSync(join(scratch, '.lattice'), { recursive: true });
  const dummyBin = join(scratch, 'slow-lattice');
  writeFileSync(dummyBin, '#!/usr/bin/env bash\nsleep 3\nexit 0\n', { mode: 0o755 });
  t0 = Date.now();
  r = spawnSync(process.execPath, [HOOK], {
    cwd: scratch,
    env: { ...process.env, CLAUDE_PROJECT_DIR: scratch, LATTICE_BIN: dummyBin },
    timeout: 10000,
  });
  elapsed = Date.now() - t0;
  if (r.status === 0 && elapsed < 2000) ok(`slow-child case: parent exit 0 in ${elapsed}ms without waiting on 3s child`);
  else bad(`slow-child case: exit ${r.status} in ${elapsed}ms (parent must not wait on review child)`);
} finally {
  // The 3s dummy child may still hold the dir briefly on Windows; tolerate.
  try { rmSync(scratch, { recursive: true, force: true }); } catch { /* ignore */ }
}

// --- Result -------------------------------------------------------------
console.log(`[stop-hook-test] ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
