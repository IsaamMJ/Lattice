#!/usr/bin/env node
/**
 * lattice-session-start.mjs — Claude Code SessionStart hook (v0.9.16)
 *
 * Fires ONCE when a new Claude Code session begins. Reads .lattice/ state
 * and emits a compact summary that Claude Code injects into the session
 * context. This is what closes Gap 1 from the v0.9.15 audit: Lattice state
 * arrives architecturally on every session, not just when an audit fires.
 *
 * SAFETY (post-v0.9.14 orphan-bash incident):
 *   - Pure Node, no child_process / no bash spawn
 *   - Hard 1.5s timeout, always exits 0
 *   - Silent skip when .lattice/ doesn't exist (non-Lattice repos get nothing)
 *   - Pure fs reads, no subprocesses in the hot path
 *
 * Wire into ~/.claude/settings.json:
 *   "hooks": {
 *     "SessionStart": [
 *       { "hooks": [
 *           { "type": "command",
 *             "command": "node ~/.claude/lattice/scripts/lattice-session-start.mjs"
 *           }
 *         ]
 *       }
 *     ]
 *   }
 *
 * Env opt-outs:
 *   LATTICE_SESSION_START_DISABLE=1   instant no-op
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

// ---- Emergency kill switch ----
if (process.env.LATTICE_SESSION_START_DISABLE === '1') process.exit(0);

// ---- Hard timeout (never hang Claude Code session start) ----
const HARD_TIMEOUT = setTimeout(() => process.exit(0), 1500);
HARD_TIMEOUT.unref();

// ---- Determine working directory ----
// Claude Code passes CLAUDE_PROJECT_DIR; fall back to cwd.
const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// ---- Skip silently if not a Lattice repo ----
if (!existsSync(join(cwd, '.lattice'))) {
  clearTimeout(HARD_TIMEOUT);
  process.exit(0);
}

// ---- Helpers (pure Node, mirror lattice-statusline.mjs patterns) ----

function readMode(root) {
  try {
    const p = join(root, '.lattice', 'config.yml');
    if (!existsSync(p)) return 'classic';
    const c = readFileSync(p, 'utf8');
    const m = c.match(/^mode:\s*(\w+)/m);
    return m ? m[1] : 'classic';
  } catch {
    return 'classic';
  }
}

function readTelemetry(root) {
  // Project-level OFF wins; global config; LATTICE_TELEMETRY env; default OFF
  try {
    const proj = join(root, '.lattice', 'config.yml');
    if (existsSync(proj)) {
      const c = readFileSync(proj, 'utf8');
      if (/^telemetry:\s*off/m.test(c)) return 'OFF';
      if (/^telemetry:\s*on/m.test(c)) return 'ON';
    }
    if (process.env.LATTICE_TELEMETRY === '0') return 'OFF';
    if (process.env.LATTICE_TELEMETRY === '1') return 'ON';
    if (process.env.LATTICE_OWNER_MODE === '1') return 'ON';
    return 'OFF';
  } catch {
    return 'OFF';
  }
}

function countFindingsByTier(root) {
  // v1.0.2: OK tier tracked separately. OK findings prove a check ran cleanly;
  // they are NOT actionable and must not surface as "findings to address".
  const tiers = { CRITICAL: 0, BLOCKER: 0, HIGH: 0, RISK: 0, DRIFT: 0, MEDIUM: 0, WATCH: 0, LOW: 0, OK: 0 };
  const openDir = join(root, '.lattice', 'findings', 'open');
  if (!existsSync(openDir)) return tiers;
  try {
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile() && e.name.endsWith('.yml')) {
          try {
            const content = readFileSync(p, 'utf8');
            const m = content.match(/^tier:\s*(\w+)/m);
            if (m && tiers[m[1]] !== undefined) tiers[m[1]]++;
          } catch {}
        }
      }
    };
    walk(openDir);
  } catch {}
  return tiers;
}

function topFindings(root, n = 3) {
  // Read .lattice/findings/open/*.yml, sort by tier rank + sweep_date (oldest first).
  const openDir = join(root, '.lattice', 'findings', 'open');
  if (!existsSync(openDir)) return [];
  const rank = { CRITICAL: 1, BLOCKER: 2, HIGH: 3, RISK: 4, DRIFT: 5, MEDIUM: 6, WATCH: 7, LOW: 8 };
  const items = [];
  try {
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile() && e.name.endsWith('.yml')) {
          try {
            const content = readFileSync(p, 'utf8');
            const tierM = content.match(/^tier:\s*(\w+)/m);
            const titleM = content.match(/^title:\s*["']?(.+?)["']?$/m);
            const dateM = content.match(/^sweep_date:\s*(\S+)/m);
            const tier = tierM ? tierM[1] : 'UNKNOWN';
            // v1.0.2: skip OK tier — they prove checks ran, they aren't "to address"
            if (tier === 'OK') continue;
            const slug = e.name.replace(/\.yml$/, '');
            items.push({
              tier,
              title: titleM ? titleM[1] : slug,
              date: dateM ? dateM[1] : '0000-00-00',
              slug,
              r: rank[tier] || 99,
            });
          } catch {}
        }
      }
    };
    walk(openDir);
  } catch {}
  items.sort((a, b) => a.r - b.r || a.date.localeCompare(b.date));
  return items.slice(0, n);
}

function countActiveADRs(root) {
  const dir = join(root, '.lattice', 'decisions');
  if (!existsSync(dir)) return { count: 0, top: [] };
  let count = 0;
  const top = [];
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || !e.name.endsWith('.yml')) continue;
      try {
        const content = readFileSync(join(dir, e.name), 'utf8');
        const status = content.match(/^status:\s*(\w+)/m);
        if (!status || !['active', 'in_progress'].includes(status[1])) continue;
        count++;
        if (top.length < 2) {
          const idM = content.match(/^id:\s*(.+)$/m);
          const titleM = content.match(/^title:\s*["']?(.+?)["']?$/m);
          top.push({
            id: idM ? idM[1] : e.name,
            title: titleM ? titleM[1] : '',
          });
        }
      } catch {}
    }
  } catch {}
  return { count, top };
}

// v2.2 (#82): compute deltas since the previous SessionStart fire by reading
// .lattice/.session-start-last (a single ISO timestamp). Scans recent session
// jsonl files for close / reopen / report events newer than that timestamp.
// Returns { since: ISO, opened: N, closed: N, reopened: N, reported: N } or
// null on first fire (no last marker).
function readDeltas(root) {
  try {
    const markerPath = join(root, '.lattice', '.session-start-last');
    let since = null;
    if (existsSync(markerPath)) {
      since = readFileSync(markerPath, 'utf8').trim();
    }
    // Always update marker for next fire — even on first call.
    const now = new Date().toISOString();
    try { writeFileSync(markerPath, now); } catch {}
    if (!since) return null;
    const sinceMs = Date.parse(since);
    if (!Number.isFinite(sinceMs)) return null;

    const dir = join(root, '.lattice', 'sessions');
    if (!existsSync(dir)) return null;
    let opened = 0, closed = 0, reopened = 0, reported = 0;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      let content;
      try { content = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
      for (const line of content.split('\n')) {
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        const ts = ev.ts ? Date.parse(ev.ts) : NaN;
        if (!Number.isFinite(ts) || ts <= sinceMs) continue;
        switch (ev.cmd) {
          case 'close':   closed++;   break;
          case 'reopen':  reopened++; break;
          case 'report':  reported++; break;
          // No direct "open" event — findings appear via audit-sweep, which
          // logs as `audit-sweep` or `write-manifest`. Skip for now.
        }
      }
    }
    return { since, opened, closed, reopened, reported };
  } catch {
    return null;
  }
}

function countTodaysSessionEvents(root) {
  try {
    const d = new Date();
    const day = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    const p = join(root, '.lattice', 'sessions', `${day}.jsonl`);
    if (!existsSync(p)) return 0;
    return readFileSync(p, 'utf8').split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

// ---- Gather state ----
const mode = readMode(cwd);
const telemetry = readTelemetry(cwd);
const tiers = countFindingsByTier(cwd);
const top3 = topFindings(cwd, 3);
const adrs = countActiveADRs(cwd);
const events = countTodaysSessionEvents(cwd);
const deltas = readDeltas(cwd);

// v1.0.2: OK tier counted separately; not part of "actionable" total
const okCount = tiers.OK || 0;
const totalFindings = Object.values(tiers).reduce((a, b) => a + b, 0) - okCount;
const highPriority = (tiers.CRITICAL || 0) + (tiers.BLOCKER || 0) + (tiers.HIGH || 0) + (tiers.RISK || 0);

// ---- Build compact summary ----
// Keep tight — this gets injected into EVERY LLM call after session start.
// Target: <1000 chars. Skip empty sections.

const lines = [
  `# Lattice session context (auto-injected at session start, ${new Date().toISOString()})`,
  ``,
  'This project has Lattice configured. Use `lattice context` for full detail.',
  ``,
  `- Mode: ${mode}`,
  `- Telemetry: ${telemetry}`,
];

// Findings summary line — OK markers shown as "X checks verified" not findings
if (totalFindings > 0) {
  const parts = [];
  for (const t of ['CRITICAL', 'BLOCKER', 'HIGH', 'RISK', 'DRIFT', 'MEDIUM', 'WATCH', 'LOW']) {
    if (tiers[t] > 0) parts.push(`${t}: ${tiers[t]}`);
  }
  lines.push(`- Open findings: ${totalFindings} (${parts.join(', ')})`);
  if (highPriority > 0) {
    lines.push(`- ⚠️ ${highPriority} need attention soon (CRITICAL/BLOCKER/HIGH/RISK)`);
  }
} else {
  lines.push(`- Open findings: 0 (clean${okCount > 0 ? `; ${okCount} OK check${okCount === 1 ? '' : 's'} verified` : ''})`);
}

// ADRs summary
if (adrs.count > 0) {
  lines.push(`- Active ADRs: ${adrs.count}`);
  for (const a of adrs.top) {
    lines.push(`  - ${a.id} — ${a.title}`);
  }
}

// Friction (heuristic — event count above threshold)
if (events > 10) {
  lines.push('- Session log: ' + events + ' events today (run `lattice review` for friction candidates)');
}

// v2.2 (#82): deltas since last SessionStart fire — surfaces "what changed
// while I was away" without forcing the user to run `lattice list` first.
if (deltas) {
  const parts = [];
  if (deltas.closed)   parts.push(`${deltas.closed} closed`);
  if (deltas.reopened) parts.push(`${deltas.reopened} reopened`);
  if (deltas.reported) parts.push(`${deltas.reported} reported`);
  if (parts.length > 0) {
    const sinceDate = deltas.since.replace(/T.*$/, '');
    lines.push(`- Since last session (${sinceDate}): ${parts.join(', ')}`);
  }
}

// Top 3 findings to surface explicitly
if (top3.length > 0) {
  lines.push(``);
  lines.push(`Top findings to address (by tier + age):`);
  for (const f of top3) {
    lines.push(`- [${f.tier}] ${f.slug} — ${f.title} (sweep ${f.date})`);
  }
}

lines.push(``);
lines.push('Workflow: `lattice list` to triage, `lattice show <id>` for detail, `lattice next` for the single highest-priority finding, `lattice close <id> --reason fixed` to close. Lifecycle actions need explicit user invocation — Claude can recommend but should not auto-close.');

// v1.2.0 (#42 #54): friction-reporting default-on protocol. Without this
// directive, sessions encounter Lattice friction (missing commands, parser
// gaps, doc drift) and silently work around it instead of filing — leaving
// the maintainer blind to real-world failure modes.
lines.push(``);
lines.push('## Friction reporting (DEFAULT-ON, not optional)');
lines.push('');
lines.push('When you hit ANY of these during this session, file IMMEDIATELY via `lattice report` — do not wait for the user to ask at session end:');
lines.push('- A documented command/flag does not exist or fails unexpectedly');
lines.push('- A workaround beats the canonical path (manual `mkdir`/`mv`/inline node script instead of a Lattice subcommand)');
lines.push('- An error message is wrong, missing, or unhelpful');
lines.push('- A docs/code drift (skill references X, X does not exist)');
lines.push('- A skill / hook output spam, slow path, or ambiguous instruction');
lines.push('');
lines.push('Filing template: `lattice report <bug|ux|enhancement|docs|perf|security> --title "..." --body "..."`. Default severity LOW unless blocking. The workaround you just used IS the evidence — paste it into the body.');
lines.push('');
lines.push('**Do not batch at session end.** File as friction occurs — that\'s the data the maintainer needs to fix the gap before the next session. Silence == accepting that future sessions hit the same wall.');

const out = lines.join('\n');

// ---- Emit ----
// Claude Code SessionStart hooks accept a JSON response with hookSpecificOutput:
//   { "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "..." } }
// Older Claude Code versions also accept additionalContext at the top level.
// Output both shapes for maximum compatibility.
const response = {
  continue: true,
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: out,
  },
  additionalContext: out,
};

process.stdout.write(JSON.stringify(response));
clearTimeout(HARD_TIMEOUT);
process.exit(0);
