#!/usr/bin/env node
// test/findings-count-parity.test.mjs — regression test for #181.
//
// Background: the SessionStart hook reported 61 open findings while the
// `lattice project-sync` CLAUDE.md block reported 51 for the same tree. Two
// independent counters had drifted:
//
//   lattice-session-start.mjs        scripts/lattice (_lattice_project_md_block)
//   -------------------------        ---------------------------------------
//   recursive walk, any depth        globbed two directory levels only
//   /^tier:\s*(\w+)/ regex           yaml_field (quote-aware, block scalars)
//   unknown/absent tier dropped      unknown/absent tier counted in total
//   OK excluded from the total       OK included in the total
//
// The fix is scripts/lattice-findings.mjs: ONE walk, ONE parser, ONE set of
// tier rules, consumed by both surfaces. This test pins the counting rules and
// the parser's YAML behaviour so a future edit cannot quietly reintroduce a
// second implementation.
//
// What is tested:
//   1. STATIC: lattice-session-start.mjs owns no finding-walk of its own —
//      no readdir over findings/open, no `^tier:` regex.
//   2. UNIT: the shared counter's rules on a fixture that made the old pair
//      disagree (depth-3 nesting, quoted tiers, OK markers, tierless YAML,
//      inline comments, CRLF).
//   3. BEHAVIORAL: the hook's rendered "Open findings: N (…)" line matches the
//      shared counter exactly.
//
// Run directly:  node test/findings-count-parity.test.mjs

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(ROOT, 'scripts', 'lattice-session-start.mjs');
const MODULE = join(ROOT, 'scripts', 'lattice-findings.mjs');

let pass = 0;
let fail = 0;
const ok = (msg) => { console.log(`[findings-count-test]   PASS: ${msg}`); pass++; };
const bad = (msg) => { console.error(`[findings-count-test]   FAIL: ${msg}`); fail++; };

const lf = await import(MODULE);

// --- 1. Static: the hook must not carry its own walk/parser ---------------
// Strip comments first — the hook's own comments narrate the old regex.
const hookSrc = readFileSync(HOOK, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

if (!/\^tier:/.test(hookSrc)) ok('hook contains no `^tier:` regex of its own');
else bad('hook still parses tiers itself — counting must come from lattice-findings.mjs');

if (!/findings['"\s,)]*,\s*['"]open['"]/.test(hookSrc) && !/'findings'/.test(hookSrc)) {
  ok('hook never opens .lattice/findings/open directly');
} else {
  bad('hook still walks .lattice/findings/open — that duplication is #181');
}

if (/lattice-findings\.mjs/.test(hookSrc)) ok('hook imports the shared counter');
else bad('hook does not import scripts/lattice-findings.mjs');

// --- 2. Unit: counting rules on the drift fixture -------------------------
const scratch = mkdtempSync(join(tmpdir(), 'lattice-count-'));
try {
  const open = join(scratch, '.lattice', 'findings', 'open');
  const write = (rel, body) => {
    const p = join(open, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };
  const fin = (id, tier, date, dim) =>
    `id: ${id}\ntitle: sample\n${tier === null ? '' : `tier: ${tier}\n`}dimension: ${dim || 'security'}\nsweep_date: ${date}\n`;

  write('flat.yml', fin('flat', 'CRITICAL', '2025-01-01'));
  // depth 3 — invisible to the old two-level bash globs
  write('security/subsystem/deep.yml', fin('deep', 'HIGH', '2025-01-02'));
  // quoted tier — invisible to the old /^tier:\s*(\w+)/ hook regex
  write('quoted.yml', fin('quoted', '"RISK"', '2025-01-03'));
  // OK marker — counted in the old bash total, excluded by the old hook total
  write('okmark.yml', fin('okmark', 'OK', '2025-01-04'));
  // no tier at all — crashed the bash associative array ("bad array subscript")
  write('tierless.yml', fin('tierless', null, '2025-01-05'));
  // inline comment — bash read the tier as "LOW  # flaky", the hook as "LOW"
  write('commented.yml', fin('commented', 'LOW  # flaky detector', '2025-01-06', 'flow'));
  // CRLF — must not leak \r into the tier
  write('crlf.yml', 'id: crlf\r\ntitle: crlf\r\ntier: MEDIUM\r\ndimension: audit\r\nsweep_date: 2025-01-07\r\n');
  // deferred still counts as open, but is reported separately
  write('deferred.yml', fin('deferred', 'WATCH', '2025-01-08') + 'status: deferred\ndefer_until: 2030-01-01\n');

  const c = lf.countOpenFindings(scratch);

  const expect = (label, got, want) => {
    if (got === want) ok(`${label} = ${want}`);
    else bad(`${label} = ${got}, expected ${want}`);
  };
  expect('files seen', c.files, 8);
  expect('actionable total (all but OK)', c.total, 7);
  expect('OK markers', c.ok, 1);
  expect('unreadable tier', c.unknown, 1);
  expect('deferred', c.deferred, 1);
  expect('high priority (CRITICAL+BLOCKER+HIGH+RISK)', c.highPriority, 3);
  expect('nested depth-3 finding counted as HIGH', c.byTier.HIGH, 1);
  expect('quoted tier normalised to RISK', c.byTier.RISK, 1);
  expect('inline comment stripped from tier', c.byTier.LOW, 1);
  expect('CRLF tier read as MEDIUM', c.byTier.MEDIUM, 1);

  const summary = lf.tierSummary(c.byTier);
  if (summary === 'CRITICAL: 1, HIGH: 1, RISK: 1, MEDIUM: 1, WATCH: 1, LOW: 1, UNKNOWN: 1') {
    ok(`tier summary is severity-ordered: ${summary}`);
  } else {
    bad(`tier summary drifted: ${summary}`);
  }

  const top = lf.topFindings(c.findings, 3);
  if (top.length === 3 && top[0].slug === 'flat' && top[1].slug === 'deep' && top[2].slug === 'quoted') {
    ok('top findings ranked by tier then age, OK markers excluded');
  } else {
    bad(`top findings drifted: ${top.map((f) => f.slug).join(', ')}`);
  }

  if (lf.activeDimensions(c.findings) === 'audit, flow, security') ok('dimensions deduped and sorted');
  else bad(`dimensions drifted: ${lf.activeDimensions(c.findings)}`);

  // --- 3. Behavioural: the hook renders exactly the shared number ---------
  const r = spawnSync(process.execPath, [HOOK], {
    cwd: scratch,
    env: { ...process.env, CLAUDE_PROJECT_DIR: scratch, LATTICE_SESSION_START_DISABLE: '' },
    timeout: 10000,
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    bad(`hook exited ${r.status} (SessionStart hooks must always exit 0)`);
  } else {
    let ctx = '';
    try { ctx = JSON.parse(r.stdout).additionalContext || ''; } catch {}
    const line = ctx.split('\n').find((l) => l.startsWith('- Open findings:')) || '';
    const want = `- Open findings: ${c.total} (${summary})`;
    if (line === want) ok(`hook line matches the shared counter: ${line}`);
    else bad(`hook rendered "${line}", shared counter says "${want}"`);

    // The CLI surface the bash block consumes must agree with the API too.
    const cli = spawnSync(process.execPath, [MODULE, '--root', scratch, '--format', 'kv'], { encoding: 'utf8' });
    const kv = Object.fromEntries(cli.stdout.trim().split('\n').map((l) => l.split('\t')));
    if (Number(kv.total) === c.total && kv.tier_summary === summary) {
      ok(`--format kv agrees with the module API (total ${kv.total})`);
    } else {
      bad(`--format kv drifted: total=${kv.total} summary=${kv.tier_summary}`);
    }
  }
} finally {
  try { rmSync(scratch, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log(`[findings-count-test] ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
