---
description: Run audit + scale + security across every module via one dispatch per module (module-scoped agents), aggregate into one master findings file with cross-cutting pattern detection.
argument-hint: <project-root> [audit|scale|security] [auto] [<module-paths...>]
---

Sweep arguments: $ARGUMENTS

## Argument parsing (do this FIRST)

Split `$ARGUMENTS` on whitespace. Classify each token:

| Token | Means |
|---|---|
| `audit` | run only the audit dimension |
| `scale` | run only the scale dimension |
| `security` | run only the security dimension |
| `auto` | auto-apply drafted checklist entries to CLAUDE.md and commit at end |
| Path starting with `src/modules/` or absolute path | explicit module to audit (overrides auto-discovery) |
| `.` or any other path | project root (defaults to `.` if none given) |

**Dimension filtering**: If ANY of `audit` / `scale` / `security` are present, run ONLY those. If NONE are present, run all three.

**Module filtering**: If one or more `src/modules/X` paths are given, audit ONLY those modules. If none given, auto-discover via `Glob src/modules/*/`.

Print the resolved plan upfront: `Sweep plan: dimensions=[...], modules=[...], auto=true|false`.

**Auto-mode caveat**: CRITICAL/BLOCKER fixes are NEVER auto-applied — those always require human approval.

# audit-sweep

You are running a full Lattice audit pass across every module in the project. You produce one aggregated findings file and a single triage prompt at the end.

## Why this exists

A 9-module project = 27 skill invocations under the old per-skill model. v0.5 collapses this to **one dispatch per module** — each module gets a single Sonnet sub-agent that runs all in-scope dimensions inline, then returns combined findings. Cuts cold-start tax 3×, preserves cross-cutting analysis within a module, lets Anthropic prompt caching reuse the methodology library across all module dispatches.

## Trigger

User invokes: `/audit-sweep <project-root>` (e.g. `/audit-sweep .` or `/audit-sweep . security`)

## Methodology

### Step 1 — Enumerate modules
1. Glob `<project-root>/src/modules/*/` to enumerate module directories.
2. For each module, locate its TTD doc by matching basename (e.g. `src/modules/lumi/` → `docs/ttd/*lumi*.md`). If no doc exists, note as "no TTD" and audit code-only.
3. Print the planned sweep: `Will audit N modules: [list]. Mode: SEQUENTIAL (one module at a time).`

### Step 2 — Per-module sequential dispatch (NEVER parallel by default)

**Execution discipline (REQUIRED, not optional):**

You MUST follow this echo-back protocol for every module — these echoes are the audit trail that prevents the v0.4 parallel-drift bug from recurring:

1. **Before dispatching** module K of N, output exactly this line:
   ```
   [SWEEP] Module K/N starting: <module-path> (dimensions: <list>)
   ```
2. **Dispatch one Sonnet sub-agent** for that module (see prompt template below). Wait for it to return.
3. **After it returns**, output exactly this line:
   ```
   [SWEEP] Module K/N complete: <module-path> — audit=<n>OK/<n>DRIFT scale=<n>B/<n>R security=<n>C/<n>H
   ```
4. **Only then** may you proceed to module K+1.

If any of these echo lines is missing or out of order, you have drifted. Stop, report the drift, and ask the user how to recover.

**No parallel batches** unless the user explicitly typed `parallel` as a token in $ARGUMENTS. Reason: parallel breaks the stop-condition gate, corrupts cross-cutting detection, and makes token usage unpredictable.

**Module-scoped dispatch prompt template** (use this for each module — keep the methodology block IDENTICAL across all dispatches so Anthropic prompt caching hits the cache after the first module):

```
[METHODOLOGY LIBRARY — keep this block byte-identical across every module dispatch in this sweep so the prompt cache hits]

You are a Lattice module-scoped auditor. You run up to three audit dimensions on a single module and return combined findings. You never spawn further sub-agents.

Read these living-truth sources first (in order):
1. CLAUDE.md (project root)
2. AGENTS.md (if present)
3. Any drift log or ADR directory referenced by CLAUDE.md
4. The module's TTD doc (if one exists)

For each dimension in scope, follow the methodology referenced in:
- Audit dimension: see commands/audit.md Steps 1-7 (skip Step 4 dispatch — execute the verification inline; skip Steps 9-10 contract rewrite — only the orchestrator does that on demand)
- Scale dimension: see commands/scale-audit.md Steps 1-5 (skip Step 3 executor dispatch — execute the pattern hunt inline)
- Security dimension: see commands/security-audit.md Steps 1-5 (skip Step 3 executor dispatch — execute the pattern hunt inline)

Verdict tiers:
- Audit: OK | DRIFT | INTENTIONAL | UNVERIFIABLE (every INTENTIONAL needs commit hash or CLAUDE.md citation)
- Scale: BLOCKER | RISK | WATCH | OK
- Security: CRITICAL | HIGH | MEDIUM | LOW | OK

Hard rules across all dimensions:
- No verdict without file:line evidence
- No CRITICAL/BLOCKER without an attack scenario or failure mode
- Mark false_positive=true for test files (*.spec.ts, *.test.ts), CLI scripts, files inside guards/ directory
- Never auto-apply fixes
- Use Grep, Read, Glob — never Bash grep (Windows path issues)

Write findings to .lattice/findings/ using the schema in docs/finding-schema.md:
- audit-<module>-<ts>.md
- scale-<module>-<ts>.md
- security-<module>-<ts>.md

Return a JSON summary to the orchestrator:
{
  "module": "<path>",
  "audit": { "OK": n, "DRIFT": n, "INTENTIONAL": n, "UNVERIFIABLE": n, "files": ["..."] },
  "scale": { "BLOCKER": n, "RISK": n, "WATCH": n, "OK": n, "files": ["..."] },
  "security": { "CRITICAL": n, "HIGH": n, "MEDIUM": n, "LOW": n, "OK": n, "files": ["..."] },
  "cross_cutting_candidates": ["<one-line pattern>", ...]
}

[END METHODOLOGY LIBRARY]

[MODULE-SPECIFIC ARGS — these vary per dispatch and come AFTER the cached methodology block]

Module to audit: <module-path>
TTD doc (if any): <doc-path or "none">
Dimensions in scope: <comma-separated subset of audit,scale,security>
Project root: <root>
```

**Stop-condition gate**: if any single module returns > 5 CRITICAL or > 2 BLOCKER findings, **pause the sweep**, print the partial summary, and ask the user whether to continue, fix, or abort.

**OMC fallback**: dispatch via `oh-my-claudecode:executor` (sonnet) if available. If OMC is not installed, run the module-scoped audit directly in the main session using the same methodology block above.

### Step 3 — Aggregate
After all module dispatches complete, write ONE master findings file at `.lattice/findings/sweep-<YYYYMMDD-HHMMSS>.md`:

```markdown
# Lattice Sweep: <project-root>
date: <ISO timestamp>
modules audited: <count>
duration: <Nm>
mode: SEQUENTIAL (module-scoped dispatch, v0.5)

## Per-module summary table
| Module | Doc audit (OK/DRIFT/INT/UNV) | Scale (B/R/W/OK) | Security (C/H/M/L/OK) |
|---|---|---|---|
| lumi | 14/5/0/0 | 0/3/2/5 | ... |

## Critical / Blocker findings (need attention now)
[every CRITICAL from security + every BLOCKER from scale, inline with file:line + fix]

## High / Risk findings (need triage)
[every HIGH from security + every RISK from scale, inline]

## Drift findings (doc rewrites needed)
[every DRIFT from audit, summarized — full details in per-doc findings files]

## Cross-cutting patterns (bundle-PR candidates)
[auto-detected: same defect class appearing in 2+ modules]

## Deferred (CLAUDE.md "Pre-deploy checklist" candidates)
- MEDIUM/LOW security findings: <count>
- WATCH scale findings: <count>

## Per-module findings files
[one block per module with all 3 dimension files]
```

### Step 4 — Cross-cutting pattern detection
Scan all findings across all modules for repeated defect classes. Any pattern appearing in 2+ modules = bundle-PR candidate. For each, suggest single PR title + files to modify + estimated effort.

### Step 5 — Regenerate CLAUDE.md checklist from YAML truth (v0.6)

After all module dispatches complete, the `.lattice/findings/open/<sweep-date>/` directory contains one YAML file per finding (per the v0.6 schema in `docs/finding-schema.md`). The CLAUDE.md checklist is now a **read-only view** of this YAML truth.

Run the regenerator:
```
bash scripts/lattice-regenerate.sh --claude-md ./CLAUDE.md
```

This rewrites the block between `<!-- lattice:checklist:start -->` and `<!-- lattice:checklist:end -->` in CLAUDE.md. Anything outside the markers is preserved (manual triage notes go in a sibling `## Triage notes` section).

If `$ARGUMENTS` contains `auto`, also commit:
```
git add .lattice/findings/ CLAUDE.md
git commit -m "chore(lattice): sweep <sweep-date> — <n> findings opened, <n> closed"
```

CRITICAL/BLOCKER findings are still NEVER auto-resolved — the checklist marks them open and the user must explicitly close them via `bash scripts/lattice-close.sh <finding-id> --commit <sha> --pr <num>` after fixing.

### Step 6 — Stop with one prompt

If `auto` mode applied checklist:
```
Lattice sweep complete. Findings: .lattice/findings/sweep-<ts>.md
- Modules: <n>
- CRITICAL/BLOCKER: <n> (need attention today — NOT auto-applied)
- HIGH/RISK: <n> (auto-applied to CLAUDE.md, commit <hash>)
- MEDIUM/WATCH: <n> (auto-applied)
- LOW: <n> (auto-applied)
- Cross-cutting bundles suggested: <n>

Reply 'fix all critical' to triage, 'show bundles' to drill into PR candidates, or 'discuss'.
```

Otherwise:
```
Lattice sweep complete. Findings: .lattice/findings/sweep-<ts>.md
- Modules: <n>
- CRITICAL/BLOCKER: <n> (need attention today)
- HIGH/RISK: <n> (need triage this week)
- Cross-cutting bundles suggested: <n>

Reply 'fix all critical', 'apply checklist', 'show bundles', or 'discuss'.
```

## Anti-patterns (refuse)

- ❌ Skipping the [SWEEP] echo lines — they ARE the parallel-drift guard
- ❌ Dispatching module K+1 before module K's complete-echo
- ❌ Dispatching the 3 dimensions as 3 separate sub-agents per module (v0.4 behavior — wasteful spin-up)
- ❌ Auto-applying fixes during the sweep
- ❌ Skipping the stop-condition gate
- ❌ Inventing modules that don't exist on disk

## Tool usage

- **Glob**: enumerate modules + match TTDs
- **Task / Agent dispatch**: ONE per module (Sonnet, module-scoped)
- **Write**: master findings file in `.lattice/findings/sweep-*.md`
- **Bash**: only for git operations and the auto-mode commit

## Output discipline

- Print resolved sweep plan upfront
- One `[SWEEP] Module K/N starting` line per module before dispatch
- One `[SWEEP] Module K/N complete` line per module after return
- Final output = master findings file path + counts + one prompt
- The findings file IS the summary — do not re-summarize in chat
