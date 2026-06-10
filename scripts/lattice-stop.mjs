#!/usr/bin/env node
/**
 * lattice-stop.mjs — Claude Code Stop hook (v1.3.0, #40).
 *
 * Fires when a Claude Code session ends. Runs `lattice review --file --yes`
 * against today's session log so any friction Claude didn't file inline (via
 * `lattice report`) gets caught before context evaporates.
 *
 * SAFETY (same discipline as SessionStart hook):
 *   - Hard 2s timeout, always exits 0
 *   - Silent skip when .lattice/ doesn't exist (non-Lattice repos)
 *   - Silent skip when `lattice` CLI isn't reachable (avoid orphan-bash)
 *
 * Wire via `lattice wire-hooks --stop --apply`:
 *   "hooks": {
 *     "Stop": [
 *       { "hooks": [
 *           { "type": "command",
 *             "command": "node ~/.claude/lattice/scripts/lattice-stop.mjs"
 *           }
 *         ]
 *       }
 *     ]
 *   }
 *
 * Env opt-outs:
 *   LATTICE_STOP_DISABLE=1   instant no-op
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';

// ---- Emergency kill switch ----
if (process.env.LATTICE_STOP_DISABLE === '1') process.exit(0);

// ---- Hard timeout (Stop hooks block session close — never hang) ----
const HARD_TIMEOUT = setTimeout(() => process.exit(0), 2000);
HARD_TIMEOUT.unref();

// ---- Determine working directory ----
const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// ---- Skip silently if not a Lattice repo ----
if (!existsSync(join(cwd, '.lattice'))) {
  clearTimeout(HARD_TIMEOUT);
  process.exit(0);
}

// ---- Resolve lattice CLI ----
// Prefer LATTICE_BIN env (set by mcp/wire-hooks installer); fall back to
// the global install path. Skip silently if neither resolves.
const latticeBin = process.env.LATTICE_BIN
  || (process.platform === 'win32'
      ? join(process.env.USERPROFILE || '', '.claude', 'lattice', 'scripts', 'lattice')
      : join(process.env.HOME || '', '.claude', 'lattice', 'scripts', 'lattice'));

if (!existsSync(latticeBin)) {
  clearTimeout(HARD_TIMEOUT);
  process.exit(0);
}

// ---- Fire review --file --yes against today's log ----
// Run via bash with explicit cwd; capture nothing (hook output goes nowhere).
//
// MUST be detached + unref'd: the CLI takes 20s+ to start while this hook's
// budget is 2s. The old detached:false version meant the harness killed the
// child with the parent's process tree at the 2s exit — review NEVER
// completed, so candidates silently accumulated unfiled (observed on
// Windows, 2026-06-10: 4 candidates from 35 events survived multiple
// session ends). detached:true + unref lets the parent exit instantly while
// the review finishes on its own; the run is idempotent so a killed attempt
// is retried harmlessly at the next session end.
const child = spawn('bash', [latticeBin, 'review', '--file', '--yes', '--quiet'], {
  cwd,
  stdio: ['ignore', 'ignore', 'ignore'],
  detached: true,
  windowsHide: true,
});

child.on('error', () => {});
child.unref();

clearTimeout(HARD_TIMEOUT);
process.exit(0);
