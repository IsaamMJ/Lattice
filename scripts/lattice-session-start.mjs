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
 * COUNTING (#181):
 *   Open-finding counts come from scripts/lattice-findings.mjs, the single
 *   module shared with the `lattice project-sync` CLAUDE.md block. This file
 *   owns NO finding-walk or tier-parsing logic of its own — that duplication
 *   is exactly what made the hook say 61 and the block say 51 for one tree.
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

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

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

// ---- Shared finding counter (#181) ----
// The open-findings count MUST come from scripts/lattice-findings.mjs — the
// same module `lattice project-sync` calls to build the CLAUDE.md block.
// Before #181 this file walked findings/open itself with a `/^tier:\s*(\w+)/`
// regex while the bash block globbed two directory levels through yaml_field;
// nested findings showed up only here, quoted tiers and OK markers only there,
// and the two numbers drifted 10 apart on the same tree. One module, one walk,
// one set of tier rules — drift is now structurally impossible, not tuned away.
//
// Loaded dynamically so a partial install (hook updated, module not yet
// copied) degrades to a short notice instead of throwing out of a SessionStart
// hook — the post-v0.9.14 rule is that this file always exits 0.
let lf = null;
try {
  lf = await import('./lattice-findings.mjs');
} catch {
  const msg = '# Lattice session context\n\nThis project has Lattice configured, but scripts/lattice-findings.mjs '
    + 'could not be loaded, so open-finding counts are unavailable. Run `lattice doctor` (or re-run the installer) '
    + 'and use `lattice list` for current state.';
  process.stdout.write(JSON.stringify({
    continue: true,
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: msg },
    additionalContext: msg,
  }));
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

// #181: both of these are now projections over ONE shared walk. `openFindings`
// is collected once per fire and reused — the old code walked findings/open
// twice (once to count, once to rank) with two subtly different parsers.
function collectOpen(root) {
  try {
    return lf.collectOpenFindings(root);
  } catch {
    return [];
  }
}

function countFindings(findings) {
  try {
    return lf.countOpenFindings(findings);
  } catch {
    return { byTier: {}, total: 0, ok: 0, unknown: 0, deferred: 0, highPriority: 0, files: 0, findings: [] };
  }
}

// Top-N by tier rank then oldest sweep_date. OK markers are excluded by the
// shared module: they prove a check ran cleanly, they are not work to address.
// Titles arrive already sanitized (control chars, bidi overrides, quote and
// backtick breakout stripped, 200-char cap) — see sanitizeTitle() there.
// v2.3.1 / #169: that sanitization IS the prompt-injection defense; the old
// TITLE_DATA<<<...>>>END marker wrapper leaked raw into every session context.
function topFindings(findings, n = 3) {
  try {
    return lf.topFindings(findings, n);
  } catch {
    return [];
  }
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

// v2.4.0 (#89): fleet-status — count CRITICAL/HIGH findings across ALL
// registered projects (other than the current one). Lets the SessionStart
// context surface "CRITICAL open elsewhere" without forcing a context switch.
function readFleetStatus(currentRoot) {
  try {
    // Registry location: env > XDG_CONFIG_HOME > ~/.claude/lattice
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const xdg = process.env.XDG_CONFIG_HOME || (home + '/.config');
    const candidates = [
      process.env.LATTICE_PROJECTS_REGISTRY,
      xdg + '/lattice/projects.yml',
      home + '/.claude/lattice/projects.yml',
    ].filter(Boolean);
    let registryPath = null;
    for (const p of candidates) {
      if (existsSync(p)) { registryPath = p; break; }
    }
    if (!registryPath) return null;

    const content = readFileSync(registryPath, 'utf8');
    // v2.4.1 (abuse-audit dual-parser-drift): match the bash _projects_load
    // awk semantics exactly — strip leading/trailing whitespace, strip a
    // matched-pair of quotes, strip commas (bash awk gsub(/[",]/, "")). Same
    // input → same output across both parsers.
    const stripValue = (s) => {
      let v = s.trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      // Strip stray commas to match the bash parser, which gsub's [",] across
      // the whole captured value. (If a real path contains a comma you have
      // bigger problems than this parser.)
      v = v.replace(/,/g, '');
      return v;
    };
    const projects = [];
    let curName = null;
    for (const raw of content.split('\n')) {
      const line = raw.replace(/\r$/, '');
      const m1 = line.match(/^\s*- name:\s*(.+)$/);
      const m2 = line.match(/^\s+name:\s*(.+)$/);
      const mp = line.match(/^\s+path:\s*(.+)$/);
      if (m1) { curName = stripValue(m1[1]); continue; }
      if (m2) { curName = stripValue(m2[1]); continue; }
      if (mp && curName) {
        let p = stripValue(mp[1]);
        if (p.startsWith('~')) p = home + p.slice(1);
        projects.push({ name: curName, path: p });
        curName = null;
      }
    }

    let critElsewhere = 0, highElsewhere = 0;
    const elsewhereProjects = [];
    for (const proj of projects) {
      // Skip the current project — that's already covered above.
      try {
        if (resolve(proj.path) === resolve(currentRoot)) continue;
      } catch {}
      // #181: was a THIRD copy of the findings walk, with its own
      // `/^tier:\s*(\w+)/` regex — so a sibling project's nested or
      // quoted-tier findings were invisible to the fleet warning even when the
      // local count saw them. Same module, same rules, every project.
      const c = countFindings(collectOpen(proj.path));
      const projCrit = (c.byTier.CRITICAL || 0) + (c.byTier.BLOCKER || 0);
      const projHigh = c.byTier.HIGH || 0;
      critElsewhere += projCrit;
      highElsewhere += projHigh;
      if (projCrit > 0 || projHigh > 0) {
        elsewhereProjects.push({ name: proj.name, crit: projCrit, high: projHigh });
      }
    }
    return { critElsewhere, highElsewhere, projects: elsewhereProjects };
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
const openFindings = collectOpen(cwd);
const counts = countFindings(openFindings);
const tiers = counts.byTier;
const top3 = topFindings(openFindings, 3);
const adrs = countActiveADRs(cwd);
const events = countTodaysSessionEvents(cwd);
const deltas = readDeltas(cwd);
const fleet = readFleetStatus(cwd);

// v1.0.2: OK tier counted separately; not part of the "actionable" total.
// #181: these are read off the shared counter rather than re-derived here, so
// the hook and the `lattice project-sync` CLAUDE.md block cannot disagree.
const okCount = counts.ok;
const totalFindings = counts.total;
const highPriority = counts.highPriority;
const unknownTier = counts.unknown;

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
  lines.push(`- Open findings: ${totalFindings} (${lf.tierSummary(tiers)})`);
  if (highPriority > 0) {
    lines.push(`- ⚠️ ${highPriority} need attention soon (CRITICAL/BLOCKER/HIGH/RISK)`);
  }
  // #181: a finding whose tier won't parse used to be dropped here and counted
  // there. It is now counted in the total and named, so the data problem is
  // visible instead of showing up as a mismatched number.
  if (unknownTier > 0) {
    lines.push(`- ${unknownTier} open finding${unknownTier === 1 ? ' has' : 's have'} an unreadable \`tier:\` — run \`lattice validate\``);
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

// v2.4.0 (#89): fleet status — if any OTHER registered project has open
// CRITICAL/HIGH findings, surface that before the user picks up this
// project's work. Stops the "context switch to project A while project B
// has a CRITICAL unattended" scenario.
if (fleet && (fleet.critElsewhere > 0 || fleet.highElsewhere > 0)) {
  const parts = [];
  if (fleet.critElsewhere > 0) parts.push(`${fleet.critElsewhere} CRITICAL`);
  if (fleet.highElsewhere > 0) parts.push(`${fleet.highElsewhere} HIGH`);
  lines.push(`- ⚠️ Fleet: ${parts.join(' + ')} open in ${fleet.projects.length} other project(s) — run \`lattice projects findings --tier CRITICAL\` to see them`);
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
  // v2.3.1 (cross-cutting audit): titles are sanitized at read time (control
  // chars, bidi overrides, quotes/backticks stripped, 200-char cap) — that
  // sanitization is the prompt-injection defense. Issue #169: the former
  // TITLE_DATA<<<…>>>END marker wrapper was dropped because the raw markers
  // leaked into the session context and read as a serialization bug; the
  // title is now rendered as a plain double-quoted string.
  for (const f of top3) {
    lines.push(`- [${f.tier}] ${f.slug} — "${f.title}" (sweep ${f.sweepDate})`);
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
