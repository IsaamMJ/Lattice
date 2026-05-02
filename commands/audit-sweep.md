---
description: Run /audit + /scale-audit + /security-audit on every module under src/modules/, aggregate into one master findings file with cross-cutting pattern detection.
argument-hint: <project-root> [auto]
---

Project root to sweep: $ARGUMENTS (defaults to `.` if empty)

**Auto-mode**: if `$ARGUMENTS` contains the literal token `auto` (e.g. `/audit-sweep . auto`), the skill will automatically apply drafted checklist entries to `CLAUDE.md` and commit them at the end of the sweep. Without `auto`, the skill stops with the drafted block and waits for `apply checklist` from the user. CRITICAL/BLOCKER fixes are NEVER auto-applied — those always require human approval, regardless of mode.

# audit-sweep

You are running a full Lattice audit pass: doc-vs-code drift, scale risks, and security exposures across every module in the project. You produce one aggregated findings file and a single triage prompt at the end.

## Why this exists

Per-module per-skill invocation is 27 commands for a 9-module project. This skill is the orchestrator: one invocation, full coverage, one master report. Keeps cross-cutting patterns (same defect class across modules) visible — those are bundle-PR candidates.

## Trigger

User invokes: `/audit-sweep <project-root>` (e.g. `/audit-sweep .` or `/audit-sweep jiive-backend`)

## Methodology

### Step 1 — Enumerate modules
1. Glob `<project-root>/src/modules/*/` to enumerate module directories.
2. For each module, locate its TTD doc by matching basename (e.g. `src/modules/lumi/` → `docs/ttd/*lumi*.md`). If no doc exists, note as "no TTD" and audit code-only.
3. Print the planned sweep: "Will audit N modules: [list]. Estimated time: ~Nx10 min."

### Step 2 — Per-module sequential sweep
For each module, in this order:

**a) `/audit`** on the matching TTD doc (skip if no doc exists; flag in report).
**b) `/scale-audit`** on the module path.
**c) `/security-audit`** on the module path.

After each module's three audits complete, append a one-line status to the running summary: `<module>: audit=N OK/N DRIFT, scale=N BLOCKER/N RISK, security=N CRIT/N HIGH`.

**Stop-condition gate**: if any single module produces > 5 CRITICAL or > 2 BLOCKER findings, **pause the sweep**, print the partial summary, and ask the user whether to continue, fix, or abort. This prevents blindly burning tokens on a module that's genuinely broken.

### Step 3 — Aggregate
Write ONE master findings file at `.lattice/findings/sweep-<YYYYMMDD-HHMMSS>.md` containing:

```markdown
# Lattice Sweep: <project-root>
date: <ISO timestamp>
modules audited: <count>
duration: <Nm>

## Per-module summary table
| Module | Doc audit (OK/DRIFT/INT/UNV) | Scale (B/R/W/OK) | Security (C/H/M/L/OK) |
|---|---|---|---|
| lumi | 14/5/0/0 | 0/3/2/5 | ... |

## Critical / Blocker findings (need attention now)
[every CRITICAL from /security-audit + every BLOCKER from /scale-audit, inline with file:line + fix]

## High / Risk findings (need triage)
[every HIGH from /security-audit + every RISK from /scale-audit, inline]

## Drift findings (doc rewrites needed)
[every DRIFT from /audit, summarized — full details in per-doc findings files]

## Cross-cutting patterns (bundle-PR candidates)
[auto-detected: same defect class appearing in 2+ modules]
- e.g. "No env-guard at boot — found in 3 modules (rag, results, payments). Bundle as single PR."
- e.g. "OpenAI default 10-min timeout — found in 3 files across 2 modules. Bundle."

## Deferred (in CLAUDE.md "Pre-deploy checklist" candidates)
- MEDIUM/LOW security findings: <count>
- WATCH scale findings: <count>

## Per-module findings files
- .lattice/findings/audit-08-module-lumi-<ts>.md
- .lattice/findings/scale-lumi-<ts>.md
- .lattice/findings/security-lumi-<ts>.md
- ... (one block per module)
```

### Step 4 — Cross-cutting pattern detection
Scan all findings across all modules for repeated defect classes. Heuristic: any pattern (e.g. "missing env-guard at boot", "OpenAI default timeout", "race-prone read-then-update") appearing in 2+ modules gets flagged as a bundle-PR candidate.

For each cross-cutting pattern, suggest:
- Single PR title (e.g. "Env-guard sweep — fail-fast on missing prod credentials")
- List of files to modify
- Estimated effort

### Step 5 — Auto-apply checklist (only if `auto` flag present)
If `$ARGUMENTS` contains `auto`:
1. Append all drafted HIGH/MEDIUM/RISK/WATCH checklist entries to `CLAUDE.md` under a new dated sub-heading: `## Pre-deploy checklist — sweep <YYYY-MM-DD>`.
2. Commit the change with: `docs: append sweep <YYYY-MM-DD> findings to pre-deploy checklist`.
3. Report what was applied.

If `auto` is NOT present, skip this step and proceed to Step 6.

CRITICAL/BLOCKER findings are NEVER auto-applied. They always wait for explicit `fix <id>` or `fix all critical` from the user.

### Step 6 — Stop with one prompt
Output the master findings file path + headline counts + one prompt.

If `auto` mode applied checklist:
```
Lattice sweep complete. Findings: .lattice/findings/sweep-<ts>.md
- Modules: <n>
- CRITICAL/BLOCKER: <n> (need attention today — NOT auto-applied)
- HIGH/RISK: <n> (auto-applied to CLAUDE.md pre-deploy checklist, commit <hash>)
- MEDIUM/WATCH: <n> (auto-applied)
- LOW: <n> (auto-applied)
- Cross-cutting bundles suggested: <n>

Reply 'fix all critical' to triage CRITICAL/BLOCKERs in order, 'show bundles' to drill into cross-cutting PR candidates, or 'discuss' to review tradeoffs first.
```

If NOT in auto mode (default):
```
Lattice sweep complete. Findings: .lattice/findings/sweep-<ts>.md
- Modules: <n>
- CRITICAL/BLOCKER: <n> (need attention today)
- HIGH/RISK: <n> (need triage this week)
- Cross-cutting bundles suggested: <n>

Reply 'fix all critical' to triage CRITICAL/BLOCKERs in order, 'apply checklist' to add HIGH/MEDIUM/RISK/WATCH items to CLAUDE.md, 'show bundles' to drill into the cross-cutting PR candidates, or 'discuss' to review tradeoffs first.
```

## Anti-patterns (refuse)

- ❌ Auto-applying any rewrite or fix during the sweep
- ❌ Auto-committing anything
- ❌ Skipping the stop-condition gate even if the sweep is "almost done"
- ❌ Aggregating without preserving the per-module findings files (need them for drill-down)
- ❌ Inventing modules that don't exist on disk

## Tool usage

- **Glob**: enumerate modules + match TTDs
- Per audit: this skill invokes `/audit`, `/scale-audit`, `/security-audit` in sequence — they handle their own tool usage
- **Write**: only the master findings file in `.lattice/findings/sweep-*.md`

## Output discipline

- Print "Sweep starting: N modules planned" upfront
- One status line per module after its triple completes
- Final output = master findings file path + counts + one prompt
- Do not summarize — the file is the summary
