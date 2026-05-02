# Lattice finding schema (v0.6)

**Breaking change from v0.5:** findings are now one YAML file per finding (not one Markdown file per audit). Status lives in the file path. CLAUDE.md is regenerated from YAML, not authored by hand.

## Why this redesign

v0.5 wrote findings as one Markdown file per audit (e.g. `security-payments-20260502.md` containing 11 findings). That worked but had 5 gaps caught in real use:

1. **Findings disappeared** — files were created locally but easy to lose (not auto-committed; no convention for git tracking)
2. **No status tracking** — "fixed/open/deferred" lived only as `[ ]`/`[x]` checkboxes in CLAUDE.md prose
3. **No diff** — re-running a sweep overwrote the previous report; no way to see "what's new since last sweep"
4. **Cross-dimension dupes** — same defect could surface in security + scale + audit with different wording, no dedupe
5. **No commit linkage** — PRs reference findings ("closes CRITICAL #1") but findings don't track which commit fixed them

v0.6 fixes 1-3 and 5 directly via the schema. v0.7 adds `lattice diff`. v0.8 adds cross-dimension dedupe.

## File layout

```
.lattice/
└── findings/
    ├── open/
    │   └── <sweep-date>/                     # ISO date like 2026-05-02
    │       ├── CRITICAL-payments-webhook-timing-unsafe-eq.yml
    │       ├── HIGH-payments-missing-rate-limit.yml
    │       └── MEDIUM-results-stack-trace-leak.yml
    └── closed/
        └── <commit-sha>/                      # short SHA of the closing commit
            ├── CRITICAL-admin-token-eq.yml
            └── CRITICAL-thyrocare-key-eq.yml
```

**Status lives in the path:**
- `findings/open/<date>/...yml` — open finding from a specific sweep date
- `findings/closed/<commit>/...yml` — closed by that commit

**Closing a finding** = `mv .lattice/findings/open/<date>/<file>.yml .lattice/findings/closed/<commit>/<file>.yml`

The `scripts/lattice-close.sh` helper does this and updates the file's `closed_at` + `closed_by_commit` fields.

## Filename slug format

`<TIER>-<module-slug>-<rule-slug>.yml`

- `<TIER>`: CRITICAL | HIGH | MEDIUM | LOW | BLOCKER | RISK | WATCH | DRIFT | INTENTIONAL | UNVERIFIABLE | OK
- `<module-slug>`: kebab-case module name (`payments`, `lumi-whatsapp`)
- `<rule-slug>`: kebab-case rule identifier (`webhook-timing-unsafe-eq`, `setinterval-cron`, `xss-template-interpolation`)

The slug is the **stable ID** — a finding for the same rule + same module on a different sweep produces the same filename. This makes diffing trivial: `git diff` between sweeps shows resolved (deleted) and new (added) findings.

## YAML schema (one finding)

```yaml
# Identity
id: <stable hash — sha1(rule + module + file + line) truncated 12 chars>
rule: <kebab-case rule slug, matches filename>
dimension: audit | scale | security
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

# Lifecycle (closed findings only — set by scripts/lattice-close.sh)
closed_at: <ISO timestamp>          # only present in findings/closed/
closed_by_commit: <full SHA>         # only present in findings/closed/
closed_by_pr: <PR number or url>     # optional

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

# Required if dimension=audit AND tier=INTENTIONAL:
intentional_citation: <commit-hash or CLAUDE.md:line>

# Optional everywhere
notes: <free text, only if needed>
```

## Verdict tiers per dimension

| Dimension | Tiers (highest → lowest) | Notes |
|---|---|---|
| audit | DRIFT, INTENTIONAL, OK, UNVERIFIABLE | INTENTIONAL requires `intentional_citation` |
| scale | BLOCKER, RISK, WATCH, OK | BLOCKER/RISK require `failure_mode` |
| security | CRITICAL, HIGH, MEDIUM, LOW, OK | CRITICAL/HIGH require OWASP + scenario + secure code |

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

Each sweep also writes one summary file at `.lattice/findings/sweeps/<sweep_id>.yml`:

```yaml
sweep_id: <12-char hex>
sweep_date: <ISO date>
project_root: <path>
modules_audited: [<module>, ...]
dimensions: [audit, scale, security]
duration_ms: <int>
mode: SEQUENTIAL | PARALLEL
totals:
  CRITICAL: <n>
  HIGH: <n>
  ...
opened: [<finding-id>, ...]      # findings new in this sweep
unchanged: [<finding-id>, ...]   # findings present in last sweep, still open
closed_since_last: [<finding-id>, ...]  # findings present in last sweep, gone now
regressed: [<finding-id>, ...]   # findings closed previously, re-opened by this sweep
```

This manifest is what powers v0.7's `lattice diff <since-sweep>`.

## Stability promise

Schema follows SemVer:
- **Patch** (0.6.0 → 0.6.1): adding optional fields is allowed
- **Minor** (0.6 → 0.7): adding required fields requires a migration script + deprecation cycle
- **Major** (0.x → 1.0): tier renames or required-field removal

## Migration from v0.5

v0.5 markdown findings (one file per audit) coexist with v0.6 YAML findings. v0.5 files in `.lattice/findings/*.md` are **not auto-converted** — they remain as historical artifacts. New sweeps emit v0.6 YAML. To start fresh, delete the v0.5 markdown files manually (or move them to `.lattice/archive/v0.5/`).

## Why we still don't adopt SARIF

Same reasoning as v0.5: SARIF is too heavyweight for Lattice's audience. If/when integration with GitHub code scanning is needed, ship a SARIF exporter alongside this native schema — don't replace it.
