# audit: finding YAML schema + sweep manifest

Load when writing findings or sweep manifests. Skip if just reading existing findings.

## Finding YAML — one file per finding

Path: `.lattice/findings/open/<TIER>-<module-slug>-<rule-slug>.yml`

For audit dimension, `<rule-slug>` should be a kebab-case description of the claim type:
- `missing-export-userservice`
- `stale-route-spec`
- `orphan-file-lumi-agent-service`

```yaml
id: <12-char hex>   # Generate per-finding via:
                    #   lattice id-gen audit <rule> <file> "<exact source line, whitespace-collapsed>"
                    # All four positional args are required — calling without them
                    # fails exit 2 and auto-reports a telemetry bug.
rule: <kebab-case rule slug>
dimension: audit
tier: DRIFT | INTENTIONAL | OK | UNVERIFIABLE
module: <module path or doc path>
file: <file:line being audited, or 'doc' for doc-only claims>
line: <integer>
title: <one-line summary>
fix: PATCH_DOC | NO_ACTION | NEEDS_HUMAN <details>
sweep_date: <YYYY-MM-DD>
sweep_id: <14-char: YYYYMMDD + 6-hex, generate via `lattice sweep-id`>
auditor: claude-code/audit
exposure: production-critical | user-facing | admin-only | internal | test-only | dead-code
# Required if tier=INTENTIONAL:
intentional_citation: <commit-hash or CLAUDE.md:line>
notes: <only if needed>
```

**Hard rules:**
- INTENTIONAL without a commit hash or CLAUDE.md citation → downgrade to UNVERIFIABLE
- DRIFT only for explicit contradictions (present-tense factual claims falsified by code)
- DO NOT flag DRIFT for `will`, `Phase N`, `future`, `deferred`, `roadmap` — aspirational, belongs in rewrite under `## Roadmap`
- DO NOT flag DRIFT for "doc is silent on Z" — that's a coverage gap, use UNVERIFIABLE
- For every claim that verified cleanly, emit `tier: OK` with `intentional_citation: <file:line>` — first-class output, prevents future re-raising of false positives

**Exposure field** (`production-critical | user-facing | admin-only | internal | test-only | dead-code`):
- Default to `production-critical` only with evidence the code is on the live user flow
- Reach for `admin-only` / `internal` / `test-only` / `dead-code` aggressively to prevent CRITICAL/HIGH tier inflation
- Used by `lattice list --effective-tier` to demote severity for low-blast-radius code paths

## Sweep manifest (standalone runs only)

Path: `.lattice/findings/sweeps/<sweep_id>.yml`

```yaml
sweep_id: <id>
sweep_date: <YYYY-MM-DD>
project_root: <root>
modules_audited: [<doc-path-as-module>]
dimensions: [audit]
mode: SEQUENTIAL
auditor: claude-code/audit
auditor_model: <opus|sonnet|haiku>
duration_ms: <int>
totals: { OK: n, DRIFT: n, INTENTIONAL: n, UNVERIFIABLE: n }
opened: [<slug>, ...]
unchanged: [<slug>, ...]
closed_since_last: [<slug>, ...]
regressed: [<slug>, ...]
skipped: <int>
runtime_warnings:
  - "<doc-silent notes, ambiguous evidence calls, etc.>"
```

**Skip when invoked from `/audit-sweep`** — the orchestrator writes the unified manifest.
