# Lattice finding schema (v0.6 / v0.6.3 / v0.6.4)

**Breaking change from v0.5:** findings are now one YAML file per finding (not one Markdown file per audit). Status lives in the file path AND in a `status:` field (added v0.6.3). CLAUDE.md is regenerated from YAML, not authored by hand — and v0.6.3 adds a CI check that enforces this.

## v0.6.4 changes (additive, non-breaking)

- New `tests:` field — list of acceptance criteria that verify the fix. Closes the "tested or eyeballed?" gap. Each entry is one line describing a scenario + expected outcome.
- New `simulate:` field — list of reproducer commands (curl, admin endpoint call, simulated input). Lets verification be mechanical rather than from memory.
- Two new dimensions: `flow` and `coverage`.
  - `flow` — customer-journey gaps (happy path, error handling, abandonment, state transitions, exits). Targets conversational AI and request-response flows. See `commands/flow-audit.md`.
  - `coverage` — module-surface audit (what does this module do? is it all tested/documented/used?).
- `intentional_citation:` is now valid for any dimension's "this is OK because..." case (previously documented as audit-INTENTIONAL only). Same field, broader applicability.

## v0.6.3 changes (additive, non-breaking)

- New `status:` field on open YAMLs: `open | in_progress | deferred | wont_fix` (default: `open`)
- Partial fixes stay in `open/` with `status: in_progress` + `partial_commits: [<sha>]` + `remaining:` text — they are NOT moved to `closed/` until fully fixed
- New `previously_closed_in: <sha>` field on reopened findings
- **Short-SHA convention:** all SHA references — `closed/<sha>/` directory names, `closed_by_commit:`, `partial_commits:`, `previously_closed_in:` — use **7-char short SHA**. The closer truncates to 7 automatically; existing full-SHA dirs are tolerated for backward compat but new closes always emit 7-char.
- CLAUDE.md regen is now CI-enforced: `scripts/validate.sh` runs `lattice-regenerate.sh --check` and fails the build if the markered block in CLAUDE.md differs from what regen would produce. **Manual edits to the markered section will not land.**

## Why this redesign

v0.5 wrote findings as one Markdown file per audit (e.g. `security-payments-20260502.md` containing 11 findings). That worked but had 5 gaps caught in real use:

1. **Findings disappeared** — files were created locally but easy to lose (not auto-committed; no convention for git tracking)
2. **No status tracking** — "fixed/open/deferred" lived only as `[ ]`/`[x]` checkboxes in CLAUDE.md prose
3. **No diff** — re-running a sweep overwrote the previous report; no way to see "what's new since last sweep"
4. **Cross-dimension dupes** — same defect could surface in security + scale + audit with different wording, no dedupe
5. **No commit linkage** — PRs reference findings ("closes CRITICAL #1") but findings don't track which commit fixed them

v0.6 fixes 1-3 and 5 directly via the schema. v0.7 adds `lattice diff`. v0.8 adds cross-dimension dedupe.

## File layout (v0.7 — flat)

```
.lattice/
└── findings/
    ├── open/
    │   ├── CRITICAL-payments-webhook-timing-unsafe-eq.yml
    │   ├── HIGH-payments-missing-rate-limit.yml
    │   └── MEDIUM-results-stack-trace-leak.yml
    ├── closed/
    │   ├── CRITICAL-admin-token-eq.yml      # closed_by_commit: field carries the SHA
    │   └── CRITICAL-thyrocare-key-eq.yml
    └── sweeps/
        └── 20260511abcdef.yml               # sweep manifests
```

**v0.7 change:** No more `open/<date>/` or `closed/<sha>/` subdirectories. Date info moves
into `first_seen_sweep:` YAML field. SHA stays in `closed_by_commit:` YAML field.
Legacy nested layout is still read by all scripts for backward compat; new writes use flat.
Run `scripts/migrate-v0.7.sh` to migrate existing findings.

**Status lives in the `status:` field:**
- `findings/open/...yml` with `status: open` — actively being worked / unaddressed
- `findings/open/...yml` with `status: in_progress` — partial fix landed; `partial_commits:` tracks what's done
- `findings/open/...yml` with `status: deferred` — acknowledged risk, deliberately not fixing now
- `findings/open/...yml` with `status: wont_fix` — intentionally not fixing (rationale in `notes:`)
- `findings/closed/...yml` — fully fixed; `closed_by_commit:` carries the closing SHA

**Why both path AND field?** The path is the coarse filter (open vs closed). The `status` field is the triage filter (which open findings are actually actionable). Without it, deferred and in_progress findings hide among actionable ones.

**Closing a finding** = `bash scripts/lattice-close.sh <slug>` → moves to `closed/<7-char-sha>/`, sets `closed_at` + `closed_by_commit`.

**Partially closing a finding (v0.6.3)** = `bash scripts/lattice-close.sh <slug> --partial "what's still left"` → keeps the file in `open/`, sets `status: in_progress`, appends to `partial_commits:`, sets `remaining:`. The finding does NOT move to `closed/` until fully fixed.

**Reopening a closed finding (v0.6.3)** = `bash scripts/lattice-reopen.sh <slug>` → moves from `closed/<sha>/` back to `open/<today>/`, sets `status: open`, adds `previously_closed_in: <original-sha>`. Used when a regression reintroduces a previously-fixed defect.

## Filename slug format

`<TIER>-<module-slug>-<rule-slug>.yml`

- `<TIER>`: CRITICAL | HIGH | MEDIUM | LOW | BLOCKER | RISK | WATCH | DRIFT | INTENTIONAL | UNVERIFIABLE | OK
- `<module-slug>`: kebab-case module name (`payments`, `lumi-whatsapp`)
- `<rule-slug>`: kebab-case rule identifier (`webhook-timing-unsafe-eq`, `setinterval-cron`, `xss-template-interpolation`)

The slug is the **stable ID** — a finding for the same rule + same module on a different sweep produces the same filename. This makes diffing trivial: `git diff` between sweeps shows resolved (deleted) and new (added) findings.

## YAML schema (one finding)

```yaml
# Identity (v0.7: survives line shifts — line number excluded from hash)
# Algorithm: sha1(dimension + ":" + rule + ":" + file + ":" + code_context_normalized)[:12]
# code_context_normalized = the finding's flagged source line, whitespace-collapsed.
# Generate via: lattice id-gen <dimension> <rule> <file> "<code_context>"
id: <12-char hex>
rule: <kebab-case rule slug, matches filename>
dimension: audit | scale | security | flow | coverage | configuration | quality | product
# flow + coverage added v0.6.4; configuration + quality + product added v0.6.5.1
tier: <see verdict tiers per dimension>
module: <module path, e.g. src/modules/payments>

# Evidence (required)
file: <path relative to project root>
line: <integer, 1-indexed>
title: <one-line human summary>
fix: <one-sentence remediation>

# Sweep metadata
sweep_date: <ISO date, YYYY-MM-DD>
sweep_id: <12-char hex, generated per sweep run>
auditor: claude-code/<skill-name>

# Triage status (open findings only; v0.6.3+)
status: open | in_progress | deferred | wont_fix   # default: open

# Partial-fix tracking (only when status: in_progress; v0.6.3+)
partial_commits: [<7-char-sha>, <7-char-sha>]      # commits that fixed part of this finding
remaining: <one-line summary of what is still unfixed>

# Defer tracking (only when status: deferred; v0.6.5+)
defer_until: <ISO date, YYYY-MM-DD>                # when to revisit; surfaced by `lattice list --due-for-review`
deferred_at: <ISO timestamp>                        # when defer was set
defer_reason: <one-line reason>                     # why this is deferred

# Reopen tracking (only on findings reopened from closed/; v0.6.3+)
previously_closed_in: <7-char-sha>                  # the commit that originally claimed to close this

# Lifecycle (closed findings only — set by scripts/lattice-close.sh)
closed_at: <ISO timestamp>          # only present in findings/closed/
closed_by_commit: <7-char-sha>      # only present in findings/closed/ (v0.6.3: 7-char short)
closed_by_pr: <PR number or url>    # optional
close_reason: fixed | false-positive | wont-fix | out-of-scope | duplicate   # v0.7; default: fixed
closure_rationale: "<one-line rationale>"   # v0.7; required for non-fixed reasons; optional for fixed

# Conditional fields (required per dimension + tier)

# Required if dimension=security AND tier in [CRITICAL, HIGH]:
owasp: A01..A10
exploitability: Remote-unauth | Remote-auth | Local-only
blast_radius: <one sentence>
attack_scenario: <one sentence>
secure_code_example: |
  // BAD
  if (sig === expected) { ... }
  // GOOD
  if (crypto.timingSafeEqual(...)) { ... }

# Required if dimension=scale AND tier in [BLOCKER, RISK]:
failure_mode: <one sentence — what breaks at instance #2>

# Required if dimension=flow AND tier in [CRITICAL, HIGH]:
impact: <one sentence — how this breaks the customer experience>

# Required when tier=INTENTIONAL (audit) OR tier=OK with documented-as-intentional rationale:
intentional_citation: <commit-hash or CLAUDE.md:line or TTD:line>   # v0.6.4: now valid for any dimension

# Acceptance criteria (v0.6.4, optional everywhere)
# Each entry is one line: scenario + expected outcome.
# When the finding is closed, these become the verification spec.
tests:
  - "First-time user sends 'hi' → consent message appears before any profile question"
  - "User sends 'no' to consent → bot stops and explains why it can't proceed"

# Mechanical reproducers (v0.6.4, optional everywhere)
# curl commands, admin endpoint calls, simulated inputs — anything that lets
# the fix be verified without manual memory of how to trigger the bug.
simulate:
  - "curl -X POST http://localhost:3000/api/webhook -H 'X-Sig: bad' -d '{}'"
  - "Run admin tool: simulate REPORT_FULL with gender=F"

# Optional everywhere — relates other findings (v0.6.7+)
# Pure advisory hint surfacing sub-symptom / shared-root-cause relationships
# during triage. Each entry is the slug of another finding (basename minus .yml).
# Bidirectional linking is the writer's responsibility — A->B doesn't auto-create B->A.
relates_to:
  - "MEDIUM-booking-rescheduled-rank-blocks-forward-transitions"

# Optional everywhere
notes: <free text, only if needed>
```

## Verdict tiers per dimension

| Dimension | Tiers (highest → lowest) | Notes |
|---|---|---|
| audit | DRIFT, INTENTIONAL, OK, UNVERIFIABLE | INTENTIONAL requires `intentional_citation` |
| scale | BLOCKER, RISK, WATCH, OK | BLOCKER/RISK require `failure_mode` |
| security | CRITICAL, HIGH, MEDIUM, LOW, OK | CRITICAL/HIGH require OWASP + scenario + secure code |
| flow | CRITICAL, HIGH, MEDIUM, LOW, OK | CRITICAL/HIGH require `impact` (v0.6.4) |
| coverage | HIGH, MEDIUM, LOW, OK | Module-surface gaps; no extra required fields (v0.6.4) |
| configuration | HIGH, MEDIUM, LOW, OK | Env vars, secrets, deploy config gaps. No extra required fields (v0.6.5.1) |
| quality | HIGH, MEDIUM, LOW, OK | Code-quality concerns not captured by `coverage`. No extra required fields (v0.6.5.1) |
| product | HIGH, MEDIUM, LOW, OK | Missing/incorrect product behavior, distinct from `flow`. No extra required fields (v0.6.5.1) |

## CLAUDE.md generator contract

CLAUDE.md is a **read-only view** of the YAML truth. Authored by `scripts/lattice-regenerate.sh` between two HTML markers:

```markdown
<!-- lattice:checklist:start -->
<!-- Generated <ISO timestamp> from sweep <sweep_id> — DO NOT EDIT BY HAND -->
<!-- Source of truth: .lattice/findings/open/ — to triage, run scripts/lattice-close.sh -->

## Open findings (<count> total)

### CRITICAL (<n>)
- [ ] `<module>` / `<rule>` — `<file>:<line>` — fix: `<fix>` — `.lattice/findings/open/<date>/CRITICAL-<module>-<rule>.yml`

### HIGH (<n>)
- [ ] ...

### MEDIUM (<n>)
- [ ] ...

### LOW (<n>)
- [ ] ...

## Recently closed (last 7 days, <count>)

- [x] `<module>` / `<rule>` — closed in <commit-sha> on <date>

<!-- lattice:checklist:end -->
```

**Rules:**
- Anything **inside** the markers is overwritten on every regenerate
- Anything **outside** the markers is preserved (manual triage notes go in a sibling `## Triage notes` section)
- The generator never modifies CLAUDE.md outside the markers
- If markers don't exist, the generator inserts them at the end of CLAUDE.md (not the top)

## Sweep manifest

Each sweep writes one summary file at `.lattice/findings/sweeps/<sweep_id>.yml` (v0.6.7+).

```yaml
sweep_id: <14-char: YYYYMMDD + 6-hex>      # generate via `lattice sweep-id`
sweep_date: <ISO date>
project_root: <path>
modules_audited: [<module>, ...]
dimensions: [audit, scale, security]        # which dimensions this sweep covered
mode: SEQUENTIAL | PARALLEL                  # dispatch mode

# Auditor metadata (v0.6.7+)
auditor: claude-code/<skill-name>            # which skill emitted this sweep
auditor_model: opus | sonnet | haiku         # the model that ran the patterns; depth varies materially
duration_ms: <int>                            # wall-clock duration of the sweep

# Verdict totals (per-tier, summed across dimensions)
totals:
  CRITICAL: <n>
  HIGH: <n>
  ...

# Finding lifecycle deltas vs the previous sweep
opened: [<slug>, ...]            # findings new in this sweep
unchanged: [<slug>, ...]         # findings present in last sweep, still open
closed_since_last: [<slug>, ...] # findings present in last sweep, gone now
regressed: [<slug>, ...]         # findings closed previously, re-opened by this sweep

# Trust signals (v0.6.7+) — without these, "the sweep looks clean" is unprovable
skipped: <int>                   # YAMLs that failed to parse and were excluded
runtime_warnings:                # threshold-edge calls, UNVERIFIABLE flags, etc.
  - "TTD silent on REPORT_FULL semantics; treated code as ground truth (booking-status.map.ts:54)"
  - "<other auditor-emitted note>"
```

This manifest is what powers v0.7's `lattice diff <since-sweep>`. Until then, `lattice sweeps` lists the manifests and `lattice validate` will (in a future patch) check their shape.

### Sweep ID convention

Generate via `lattice sweep-id` — emits `<YYYYMMDD><6-hex-rand>`. Stable enough to sort lexicographically by sweep date, random enough to avoid collisions when multiple sweeps run on the same day.

## Stability promise

Schema follows SemVer:
- **Patch** (0.6.0 → 0.6.1): adding optional fields is allowed
- **Minor** (0.6 → 0.7): adding required fields requires a migration script + deprecation cycle
- **Major** (0.x → 1.0): tier renames or required-field removal

## Migration from v0.5

v0.5 markdown findings (one file per audit) coexist with v0.6 YAML findings. v0.5 files in `.lattice/findings/*.md` are **not auto-converted** — they remain as historical artifacts. New sweeps emit v0.6 YAML. To start fresh, delete the v0.5 markdown files manually (or move them to `.lattice/archive/v0.5/`).

## Why we still don't adopt SARIF

Same reasoning as v0.5: SARIF is too heavyweight for Lattice's audience. If/when integration with GitHub code scanning is needed, ship a SARIF exporter alongside this native schema — don't replace it.
