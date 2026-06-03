# Lattice finding schema (v0.7+)

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
- **Short-SHA convention:** all SHA references — `closed/` directory names, `closed_by_commit:`, `partial_commits:`, `previously_closed_in:` — use **7-char short SHA**. The closer truncates to 7 automatically; existing full-SHA dirs are tolerated for backward compat but new closes always emit 7-char.
- CLAUDE.md regen is now CI-enforced: `scripts/validate.sh` runs `lattice-regenerate.sh --check` and fails the build if the markered block in CLAUDE.md differs from what regen would produce. **Manual edits to the markered section will not land.**

## Why this redesign

v0.5 wrote findings as one Markdown file per audit (e.g. `security-payments-20260502.md` containing 11 findings). That worked but had 5 gaps caught in real use:

1. **Findings disappeared** — files were created locally but easy to lose (not auto-committed; no convention for git tracking)
2. **No status tracking** — "fixed/open/deferred" lived only as `[ ]`/`[x]` checkboxes in CLAUDE.md prose
3. **No diff** — re-running a sweep overwrote the previous report; no way to see "what's new since last sweep"
4. **Cross-dimension dupes** — same defect could surface in security + scale + audit with different wording, no dedupe
5. **No commit linkage** — PRs reference findings ("closes CRITICAL #1") but findings don't track which commit fixed them

v0.6 fixed 1-3 and 5 directly via the schema. v0.7 flattened finding paths, stabilized IDs, and added closure taxonomy plus workflow commands.

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
Legacy nested layout is migration input only. Run `scripts/migrate-v0.7.sh` to flatten existing findings; `lattice validate` fails while nested finding YAMLs remain.

**Status lives in the `status:` field:**
- `findings/open/...yml` with `status: open` — actively being worked / unaddressed
- `findings/open/...yml` with `status: in_progress` — partial fix landed; `partial_commits:` tracks what's done
- `findings/open/...yml` with `status: deferred` — acknowledged risk, deliberately not fixing now
- `findings/open/...yml` with `status: wont_fix` — intentionally not fixing (rationale in `notes:`)
- `findings/closed/...yml` — fully fixed; `closed_by_commit:` carries the closing SHA

**Why both path AND field?** The path is the coarse filter (open vs closed). The `status` field is the triage filter (which open findings are actually actionable). Without it, deferred and in_progress findings hide among actionable ones.

**Closing a finding** = `lattice close <slug> --reason fixed` → moves to `closed/<slug>.yml`, sets `closed_at`, `closed_by_commit`, and `close_reason`.

**Partially closing a finding (v0.6.3)** = `bash scripts/lattice-close.sh <slug> --partial "what's still left"` → keeps the file in `open/`, sets `status: in_progress`, appends to `partial_commits:`, sets `remaining:`. The finding does NOT move to `closed/` until fully fixed.

**Reopening a closed finding (v0.7)** = `lattice reopen <slug> --reason "<why this regressed>"` → moves from `closed/<slug>.yml` back to `open/<slug>.yml`, sets `status: open`, adds `previously_closed_in: <original-sha>`. Used when a regression reintroduces a previously-fixed defect.

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

# Module-exposure multiplier (v0.8.0, optional everywhere).
# Tells the CLI / consumers how reachable this code is by real users so the
# base tier can be demoted for low-exposure code paths. Prevents CRITICAL/HIGH
# inflation when the same pattern lives in production vs admin-only / dead code.
#
# Values:
#   production-critical  — main user flow; tier stands
#   user-facing          — reachable by typical users; tier stands
#   admin-only           — admin/internal-tool only; demote 1 step
#   internal             — internal API / background job; demote 1 step
#   test-only            — *_test.* / fixtures; demote 2 steps (often suppress)
#   dead-code            — no reachable route / behind disabled flag; demote 2
#
# Demotion ladder: CRITICAL → HIGH → MEDIUM → LOW → OK.
# `lattice list --exposure <kind>` filters; `--effective-tier` shows demoted tier.
exposure: production-critical
# exposure: admin-only
# exposure: dead-code

# Machine-readable verification pattern (v0.8.0, optional everywhere).
# Lets `lattice verify <id> --rerun-grep` re-execute the original pattern
# hunt that produced this finding. When the pattern stops matching, the
# finding is effectively resolved and can be auto-closed with --close-clean.
#
#   verify_pattern: <regex used by the audit skill>
#   verify_file:    <path>   # optional, defaults to file: above
#   verify_negate:  true     # optional — finding is clean when pattern MATCHES
#                            #   (use for "must contain rate-limiter" checks)
verify_pattern: 'console\.log\(.*token'
verify_file: src/auth/session.ts
# verify_negate: true

# Optional everywhere — relates other findings (v0.6.7+)
# Pure advisory hint surfacing sub-symptom / shared-root-cause relationships
# during triage. Each entry is the slug of another finding (basename minus .yml).
# Bidirectional linking is the writer's responsibility — A->B doesn't auto-create B->A.
relates_to:
  - "MEDIUM-booking-rescheduled-rank-blocks-forward-transitions"

# Ownership (v0.7 — optional)
# module_owner: the module where the fix design belongs. Defaults to `module:` if absent.
# Used by `lattice sync` to group findings by owner, and by `lattice handoff` for context injection.
module_owner: src/modules/thyrocare

# related_files: additional files the fixer must read (design constraints, shared maps, config).
# Not where the bug manifests (that's `file:`), but files the fix design depends on.
related_files:
  - src/modules/booking/booking-status.map.ts
  - src/config/thyrocare.config.ts

# cluster_root: true marks this as the root cause of a relates_to cluster (v0.7).
# Walk the full cluster via `lattice cluster <slug>`.
cluster_root: true   # optional; omit for leaf/symptom findings

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
<!-- Source of truth: .lattice/findings/open/ — to triage, run `lattice help` (CLI installed via Lattice's install.sh) -->

## Open findings (<count> actionable)

### CRITICAL (<n>)
- [ ] `<module>` / `<rule>` — `<file>:<line>` — fix: `<fix>` — `.lattice/findings/open/CRITICAL-<module>-<rule>.yml`

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

## Hypothesis schema (v1.4.0+ — the `grow` subsystem)

The `grow` subsystem is the forward-looking mirror of findings. Where findings track *defects to fix*, hypotheses track *changes to validate* — growth experiments, refactor proposals, product bets. Same YAML-per-file pattern, separate directory tree (`scripts/lattice` `cmd_grow`, line ~6879). The closed-loop measurement layer (`measure`/`check`/`auto-rollback`) was added in v2.0–v2.2.

### Lifecycle directories

Hypotheses live as one YAML per file under `.lattice/hypotheses/`. State lives **in the directory** (not a path-vs-field split like findings) AND is mirrored in a `state:` field that each transition rewrites:

```
.lattice/hypotheses/
├── open/          # proposed, not yet executing
├── running/       # in-flight — the change has shipped (run_commit linked); metrics are being measured
├── closed/        # resolved — result is won | lost | inconclusive
└── rolled-back/   # was running, then reverted due to negative signal (manual or auto)
```

Create the tree with `lattice grow init`. Transitions move the file between dirs and stamp timestamps + reasons:

- `open → running` — `lattice grow run <slug> --commit <sha>` (stamps `run_at`, `run_commit`)
- `running → closed` — `lattice grow close <slug> --result won|lost|inconclusive` (stamps `closed_at`, `result`, optional `observed_value`, `rationale`)
- `running → rolled-back` — `lattice grow rollback <slug> --reason "..."` (manual; stamps `rolled_back_at`, `rollback_reason`) or `lattice grow auto-rollback <slug> --execute` (git-reverts `run_commit`; additionally stamps `revert_commit` + `observed_value`)
- `open → closed` is also allowed by `grow close` (a hypothesis abandoned before it ever ran).

### Hypothesis YAML fields

```yaml
# Identity — set at propose time (scripts/lattice _grow_propose)
# id = sha1("growth:" + slug + ":" + change + ":" + metric)[:12]
id: <12-char hex>
slug: <kebab-case, matches filename>
state: open | running | closed | rolled-back     # rewritten on each transition
title: "<one-line human summary>"
change: "<one-line description of the change being made>"
metric: "<free-text description of what success looks like>"

# Triage metadata (defaults shown)
cadence: weekly                                   # free-text review cadence; not yet enforced by a scheduler
effort: MEDIUM
risk: LOW
proposed_at: <ISO timestamp>
proposed_by: lattice-cli

# Structured measurement block (v1.4.2, #59) — drives v2.0 closed-loop measure / auto-rollback.
# Omitted entirely unless at least one measurement field is supplied at propose time
# (or retrofitted later via `lattice grow attach-measurement`).
measurement:
  name: "<metric display name>"                   # optional
  source: "<scheme URI>"                           # single-source form (see schemes below)
  baseline_value: <number>                         # value before the change
  baseline_source: "<where the baseline came from>"   # optional, free-text
  expected_delta: <number>                         # documented intent only — NOT read by the verdict engine
  success_threshold: <number>                      # verdict = succeeded when combined value >= this
  window_days: <integer>                           # after this many days past run_at, a sub-threshold value -> failed
  combine: sum | weighted-avg | max | min          # how to fold multi-source values (default: sum)
  headers:                                          # optional HTTP headers for http(s) sources
    Accept: "application/json"
    Authorization: "Bearer ${LATTICE_HEADER_TOKEN}"
  sources:                                          # multi-source form — replaces single `source:`
    - name: api-a
      source: "https://a.example/metric"
      baseline_value: 100
      weight: 1                                     # weight applies to weighted-avg combine (default: 1)
    - name: api-b
      source: "https://b.example/metric"
      weight: 2

# Lifecycle stamps (written by run / close / rollback / auto-rollback — not authored by hand)
run_at: <ISO timestamp>            # set on `grow run`
run_commit: <sha>                  # set on `grow run`; the commit auto-rollback reverts
closed_at: <ISO timestamp>         # set on `grow close`
result: won | lost | inconclusive  # set on `grow close`
observed_value: <number>           # actual measured outcome at close / auto-rollback time
rationale: "<one-line close rationale>"   # optional, set on `grow close --rationale`
rolled_back_at: <ISO timestamp>    # set on rollback / auto-rollback
rollback_reason: "<why it was reverted>"  # set on rollback / auto-rollback
revert_commit: <sha>               # auto-rollback only — the `git revert` commit it created
```

**Field notes (grounded in `scripts/lattice`):**

- `expected_delta` is **written** by `propose`/`attach-measurement` but is **never read** by the verdict engine — `measure`/`auto-rollback` decide `succeeded`/`failed` purely from `success_threshold` + `window_days`. Treat it as documentation of intent, not a behavioral input.
- `measurement.source` (single) and `measurement.sources` (list) are mutually exclusive in practice: the reader (`_grow_measurement_sources`) prefers the `sources:` list and falls back to the single `source:` only when no list is present.
- `measurement.name`, `baseline_source`, and per-source `weight` are real parsed fields not called out in the original finding, included here for completeness.

### Measurement source schemes

`measurement.source` (and each `sources[].source`) is a scheme URI fetched by `_grow_fetch_metric`. Three schemes:

- `http://…` / `https://…` — GET via `curl`, expecting JSON; the numeric metric is read from `.value`, `.data.value`, or `.metric`. `measurement.headers` are sent as request headers. **Header `${VAR}` interpolation is default-deny (v2.2.4, #86):** only variable names prefixed `LATTICE_HEADER_` interpolate. Any other name (e.g. `${ANTHROPIC_API_KEY}`) is refused and the literal placeholder is sent — a loud remote failure instead of a silent secret leak. Opt out per-project with `security.allow_header_interpolation: true` in `.lattice/config.yml`, or per-shell with `LATTICE_ALLOW_HEADER_INTERPOLATION=1`.
- `file:/path` / `file:///path` — read a single number from a local file.
- `cmd:<shell>` — execute a shell command, parse the last numeric stdout line. **Default-deny / security-gated (v2.2):** refuses to run unless `security.allow_cmd_sources: true` is set in `.lattice/config.yml`, or `LATTICE_ALLOW_CMD_SOURCES=1` is exported. `grow propose` also prints a loud warning when a proposed source starts with `cmd:`.

### Minimal example

```yaml
id: a1b2c3d4e5f6
slug: cache-warm-homepage
state: running
title: "Pre-warm homepage cache on deploy"
change: "Add a post-deploy hook that hits / 3x to warm the CDN edge cache"
metric: "p95 homepage TTFB drops below 200ms"
cadence: weekly
effort: LOW
risk: LOW
proposed_at: 2026-06-01T09:00:00Z
proposed_by: lattice-cli
measurement:
  name: p95-ttfb-ms
  source: "https://metrics.example/p95?route=home"
  baseline_value: 340
  success_threshold: 200
  window_days: 7
  combine: min
run_at: 2026-06-02T12:00:00Z
run_commit: 9f3a1c0
```

### Lifecycle commands

`lattice grow propose | run | measure | check | rollback | close` (plus `init`, `list`, `show`, `status`, `auto-rollback`, `attach-measurement`, `schedule`). Run `lattice grow help` for the full surface.
