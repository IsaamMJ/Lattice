---
description: Run audit + scale + security (default) across every module via one dispatch per module (module-scoped agents), aggregate into one master findings file with cross-cutting pattern detection. Optionally include flow / coverage dimensions.
argument-hint: <project-root> [audit|scale|security|flow|coverage] [auto] [<module-paths...>]
---

Sweep arguments: $ARGUMENTS

## Argument parsing (do this FIRST)

Split `$ARGUMENTS` on whitespace. Classify each token:

| Token | Means |
|---|---|
| `audit` | run only the audit dimension |
| `scale` | run only the scale dimension |
| `security` | run only the security dimension |
| `flow` | run only the flow dimension (v0.6.4 — opt-in only, see below) |
| `coverage` | run only the coverage dimension (v0.6.4 — opt-in only) |
| `auto` | auto-apply drafted checklist entries to CLAUDE.md and commit at end |
| Path starting with `src/modules/` or absolute path | explicit module to audit (overrides auto-discovery) |
| `.` or any other path | project root (defaults to `.` if none given) |

**Dimension filtering**:
- If NO dimension token is present, run **audit + scale + security** (default — flow / coverage are opt-in).
- If any of `audit` / `scale` / `security` / `flow` / `coverage` are present, run ONLY those.
- `flow` and `coverage` are v0.6.4 dimensions and are NOT in the default sweep yet — explicitly include them when you want flow / coverage findings mixed into sweep output (`/audit-sweep . flow` or `/audit-sweep . security flow`). They invoke the same methodology as `/flow-audit` (coverage has no separate skill — its patterns run inline), just dispatched per-module.

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

### Step 1 — Enumerate modules + generate sweep_id
1. Glob `<project-root>/src/modules/*/` to enumerate module directories.
2. For each module, locate its TTD doc by matching basename (e.g. `src/modules/lumi/` → `docs/ttd/*lumi*.md`). If no doc exists, note as "no TTD" and audit code-only.
3. **Generate the sweep_id** by running `lattice sweep-id` (Bash). This emits `<YYYYMMDD><6-hex>` — the stable, sortable, collision-resistant ID that ties every per-module dispatch + every emitted YAML + the final manifest together. Capture the value; pass it into every per-module dispatch in Step 2 so all findings share it.
4. Note the **start time** (Bash `date +%s` or equivalent in ms) — used for `duration_ms` in the manifest.
5. Print the planned sweep: `Will audit N modules: [list]. Mode: SEQUENTIAL. sweep_id: <id>`.

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

Write findings to .lattice/findings/open/ using the v0.7 YAML schema (docs/finding-schema.md).
One YAML file per finding — never write monolithic markdown audit reports.
Filename pattern: <TIER>-<module-slug>-<rule-slug>.yml
Example: HIGH-payments-missing-rate-limit.yml

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
sweep_id: <id from Step 1>           # MUST embed this in every YAML you write
sweep_date: <YYYY-MM-DD>             # MUST embed this in every YAML you write
```

**module_owner + related_files (v0.7):** Set `module_owner:` when the fix design belongs to a different module than where the bug manifests. Set `related_files:` for any files the fixer must also read (design constraints, shared maps). Both are optional — omit when `module:` is the right fix location.

**Finding id (v0.7):** Generate the `id:` field via `lattice id-gen <dimension> <rule> <file> "<line_content>"` where `<line_content>` is the exact source text of the flagged line, whitespace-collapsed. Do NOT include the line number in the hash — the id must survive line shifts.

**OK-finding discipline (v0.6.7+):** Each per-module dispatch MUST explicitly enumerate the patterns it checked-and-found-clean as `OK` findings — these are first-class output, not a side-effect. Two of the most useful 2026-05-09 findings on jiive Lumi were `OK-payments-credit-pack-branch-clean` and `OK-payments-dedup-key-stable`; knowing what was verified clean changed how the rest were triaged. Subagent prompts must list "what was checked but is fine" with the same `file:line` discipline as DRIFT/CRITICAL findings.

**DRIFT threshold (audit dimension only, v0.6.7+):** DRIFT is reserved for **explicit contradictions** between TTD and code that grep can verify both sides of. Specifically:
- DO flag DRIFT when the TTD makes a factual claim about *current* code that the code falsifies (e.g. "uses fast-xml-parser with ignoreAttributes:false" when the code is a hand-rolled regex with no such option).
- DO NOT flag DRIFT for grep-misses on TTD claims phrased as `will`, `Phase N`, `future`, `deferred`, `roadmap` — those are aspirational.
- DO NOT flag DRIFT for "TTD is silent on Z" — that's a coverage gap, not drift. If non-obvious, use `audit/UNVERIFIABLE` with a one-sentence "what would resolve this."

False positives erode trust faster than missed drift catches. When in doubt: UNVERIFIABLE, not DRIFT.

**Stop-condition gate**: if any single module returns > 5 CRITICAL or > 2 BLOCKER findings, **pause the sweep**, print the partial summary, and ask the user whether to continue, fix, or abort.

**OMC fallback**: dispatch via `oh-my-claudecode:executor` (sonnet) if available. If OMC is not installed, run the module-scoped audit directly in the main session using the same methodology block above.

### Step 3 — Aggregate into the sweep manifest

**v0.6.7 change:** The legacy `.lattice/findings/sweep-<YYYYMMDD-HHMMSS>.md` markdown summary is **gone**. The YAML findings on disk are the source of truth; the CLAUDE.md checklist (regenerated in Step 5) is the human-readable view. Two formats for the same data drift apart immediately and erode trust — kill the dual.

After all module dispatches complete, write the sweep manifest by calling the dedicated script — do NOT skip this step or merely describe the file contents:

```bash
bash scripts/lattice-write-manifest.sh \
  --sweep-id "<sweep_id from Step 1>" \
  --sweep-date "<YYYY-MM-DD>" \
  --project-root "<root>" \
  --modules "<comma-separated module paths>" \
  --dimensions "<comma-separated dimensions>" \
  --mode SEQUENTIAL \
  --auditor "claude-code/audit-sweep" \
  --auditor-model "<opus|sonnet|haiku>" \
  --duration-ms <milliseconds> \
  --totals "CRITICAL=<n>,HIGH=<n>,MEDIUM=<n>,LOW=<n>,BLOCKER=<n>,RISK=<n>,WATCH=<n>,DRIFT=<n>,INTENTIONAL=<n>,UNVERIFIABLE=<n>,OK=<n>" \
  --opened "<comma-separated new slugs>" \
  --unchanged "<comma-separated unchanged slugs>" \
  --closed-since-last "<comma-separated closed slugs>" \
  --regressed "<comma-separated regressed slugs>" \
  --skipped <n> \
  --warnings "<warning1>|<warning2>"
```

This writes `.lattice/findings/sweeps/<sweep_id>.yml` (per `docs/finding-schema.md` "Sweep manifest" section). Compute the values from the JSON summaries returned by each per-module dispatch + a quick scan of the open/ + closed/ directories.

```yaml
sweep_id: <sweep_id from Step 1>
sweep_date: <YYYY-MM-DD>
project_root: <project root>
modules_audited: [<module>, ...]
dimensions: [<dimensions in scope>]
mode: SEQUENTIAL                          # PARALLEL only if user typed it
auditor: claude-code/audit-sweep
auditor_model: opus | sonnet | haiku      # which model the orchestrator ran on
duration_ms: <int>                         # now - Step 1 start time

totals:
  CRITICAL: <n>
  HIGH: <n>
  MEDIUM: <n>
  LOW: <n>
  BLOCKER: <n>
  RISK: <n>
  WATCH: <n>
  DRIFT: <n>
  INTENTIONAL: <n>
  UNVERIFIABLE: <n>
  OK: <n>

# Slugs (basenames without .yml) of findings:
opened: [<slug>, ...]              # new in this sweep (not present in any prior open/)
unchanged: [<slug>, ...]           # already in open/, no fields changed
closed_since_last: [<slug>, ...]   # were in open/ at sweep start, now in closed/
regressed: [<slug>, ...]           # were in closed/ at sweep start, this sweep created same slug in open/

# Trust signals (v0.6.7+) — without these, "the sweep looks clean" is unprovable
skipped: <int>                      # YAMLs that failed to parse and were excluded from open/unchanged/closed
runtime_warnings:
  - "<auditor-emitted note that didn't qualify as a finding but should be queryable>"
  # examples:
  # "module thyrocare: TTD silent on REPORT_FULL semantics; treated code as ground truth"
  # "module payments: 2 setInterval hits inside try/catch — graceful-degrade, not flagged"
```

After writing the manifest, output a brief in-chat status line (NOT a markdown file). Reference the manifest path + the verdict totals so the user sees the headline numbers without a second written artifact.

**Cross-cutting bundle detection** (formerly part of the killed markdown summary): scan all opened findings for repeated `(rule, dimension)` pairs across 2+ modules. If found, emit them to `runtime_warnings` with the format `"cross-cutting: <rule> in modules [<list>]"`. The user surfaces these via `lattice list --rule <slug>` (post-v0.6.7 list filter — until then, grep `.lattice/findings/open/`).

### Step 4 — Cross-cutting pattern detection
Scan all findings across all modules for repeated defect classes. Any pattern appearing in 2+ modules = bundle-PR candidate. For each, suggest single PR title + files to modify + estimated effort.

### Step 5 — Regenerate CLAUDE.md checklist from YAML truth (v0.6)

After all module dispatches complete, the `.lattice/findings/open/` directory contains one YAML file per finding (per the v0.7 schema in `docs/finding-schema.md`). The CLAUDE.md checklist is now a **read-only view** of this YAML truth.

Run the regenerator via the dispatcher:
```
lattice sync
```

Equivalent for users who haven't aliased `lattice` yet: `bash ~/.claude/lattice/scripts/lattice sync` or, if working from a Lattice checkout, `bash scripts/lattice-regenerate.sh`.

This rewrites the block between `<!-- lattice:checklist:start -->` and `<!-- lattice:checklist:end -->` in CLAUDE.md. Anything outside the markers is preserved (manual triage notes go in a sibling `## Triage notes` section).

**Always commit findings (v0.6.1, both standard and auto modes):**
```
git add .lattice/findings/
git commit -m "chore(lattice): sweep <sweep-date> — persist YAML findings"
```

This commit captures the YAML truth on disk so findings cannot disappear (the v0.5 friction point that motivated v0.6). It runs in **both standard and auto modes**.

**Additional commit only if `$ARGUMENTS` contains `auto`:**
```
git add CLAUDE.md
git commit -m "docs(lattice): regenerate checklist for sweep <sweep-date>"
```

This second commit captures the regenerated CLAUDE.md checklist. In standard mode, the regenerator still runs and writes CLAUDE.md, but committing it is left to the user (so they can review the diff before staging).

CRITICAL/BLOCKER findings are still NEVER auto-resolved — the checklist marks them open and the user must explicitly close them via `lattice close <finding-id> --commit <sha> --pr <num>` after fixing.

### Step 6 — Stop with one prompt

If `auto` mode applied checklist:
```
Lattice sweep complete. Manifest: .lattice/findings/sweeps/<sweep_id>.yml
- Modules: <n>
- CRITICAL/BLOCKER: <n> (need attention today — NOT auto-applied)
- HIGH/RISK: <n> (auto-applied to CLAUDE.md, commit <hash>)
- MEDIUM/WATCH: <n> (auto-applied)
- LOW: <n> (auto-applied)
- Cross-cutting bundles flagged: <n> (see runtime_warnings in manifest)
- Skipped (parse errors): <n>

Reply 'fix all critical' to triage, 'show bundles' to drill into PR candidates, or 'discuss'.
```

Otherwise:
```
Lattice sweep complete. Manifest: .lattice/findings/sweeps/<sweep_id>.yml
- Modules: <n>
- CRITICAL/BLOCKER: <n> (need attention today)
- HIGH/RISK: <n> (need triage this week)
- Cross-cutting bundles flagged: <n>
- Skipped (parse errors): <n>

Use `lattice list` to triage, `lattice triage` for interactive walk, `lattice show <id>` for one finding.
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


---

After running: use `lattice list` / `lattice triage` / `lattice sync` (the CLI, runs in any shell) to triage findings emitted into `.lattice/findings/open/`. Slash commands produce findings; the `lattice` CLI manages their lifecycle. See `lattice help` and the README "Workflow" section.

When emitting findings, also set `exposure:` (one of `production-critical | user-facing | admin-only | internal | test-only | dead-code`) so `lattice list --effective-tier` can demote severity for low-blast-radius code paths. Default to `production-critical` only when you have evidence the code is on the live user flow; reach for `admin-only` / `internal` / `test-only` / `dead-code` aggressively to prevent CRITICAL/HIGH inflation.
