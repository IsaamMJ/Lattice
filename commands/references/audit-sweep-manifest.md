# audit-sweep: Step 3 — sweep manifest write

Load when ready to write the aggregated sweep manifest. Skip if partial-sweep without completion.

## Write via the dedicated script

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

This writes `.lattice/findings/sweeps/<sweep_id>.yml`.

## Computed inputs

| Input | Source |
|---|---|
| `totals` | Sum of per-dimension verdict counts from each per-module JSON summary |
| `opened` | Findings whose slug is NOT in any prior open/ or closed/ directory |
| `unchanged` | Findings already in open/ with no field changes |
| `closed_since_last` | Slugs present in open/ at sweep start, now in closed/ |
| `regressed` | Slugs present in closed/ at sweep start, this sweep created same slug in open/ |
| `skipped` | YAMLs that failed to parse and were excluded from open/unchanged/closed |
| `runtime_warnings` | Per-module dispatch warnings + cross-cutting bundle detections |
| `duration_ms` | `now_ms - step1_start_ms` |

## Manifest YAML shape (for reference)

The script writes this format — Claude does NOT write this by hand:

```yaml
sweep_id: <sweep_id from Step 1>
sweep_date: <YYYY-MM-DD>
project_root: <project root>
modules_audited: [<module>, ...]
dimensions: [<dimensions in scope>]
mode: SEQUENTIAL                          # PARALLEL only if user typed it
auditor: claude-code/audit-sweep
auditor_model: opus | sonnet | haiku
duration_ms: <int>

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

opened: [<slug>, ...]
unchanged: [<slug>, ...]
closed_since_last: [<slug>, ...]
regressed: [<slug>, ...]

skipped: <int>
runtime_warnings:
  - "<auditor-emitted note that didn't qualify as a finding but should be queryable>"
  # examples:
  # "module thyrocare: TTD silent on REPORT_FULL semantics; treated code as ground truth"
  # "module payments: 2 setInterval hits inside try/catch — graceful-degrade, not flagged"
  # "cross-cutting: missing-rate-limit in modules [payments, auth, webhooks]"
```

## Cross-cutting bundle detection

Scan all opened findings for repeated `(rule, dimension)` pairs across 2+ modules. For each match, emit a `runtime_warnings` entry: `"cross-cutting: <rule> in modules [<list>]"`. User surfaces these via `lattice list --rule <slug>`.

## Findings commit (always)

After manifest write, **always** commit findings (both standard and auto modes):

```bash
git add .lattice/findings/
git commit -m "chore(lattice): sweep <sweep-date> — persist YAML findings"
```

This commit captures the YAML truth on disk so findings cannot disappear.

**Additional commit only if `$ARGUMENTS` contains `auto`:**

```bash
git add CLAUDE.md
git commit -m "docs(lattice): regenerate checklist for sweep <sweep-date>"
```

This captures the regenerated CLAUDE.md checklist. In standard mode the regenerator runs and writes CLAUDE.md, but committing is left to the user (so they can review the diff first).

**Never auto-commit fixes for CRITICAL/BLOCKER findings** — they need explicit closure via `lattice close <id> --commit <sha> --pr <num>` after the user reviews.
