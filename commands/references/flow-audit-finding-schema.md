# flow-audit: finding YAML schema + sweep manifest

Load when writing findings. Skip when just reading.

## Finding YAML

Path: `.lattice/findings/open/<TIER>-<module-slug>-<rule-slug>.yml`

Rule slug examples: `missing-error-handling`, `state-transition-unvalidated`, `no-exit-path`, `abandonment-timeout-not-set`, `multi-turn-context-lost`.

```yaml
id: <12-char hex>   # lattice id-gen flow <rule> <file> "<source line>"
rule: <kebab-case pattern slug>
dimension: flow
tier: CRITICAL | HIGH | MEDIUM | LOW | OK
module: <module path>
file: <path>
line: <integer>
title: <one-line gap summary>
fix: <one-sentence recommended fix>
sweep_date: <YYYY-MM-DD>
sweep_id: <14-char: YYYYMMDD + 6-hex>
auditor: claude-code/flow-audit
exposure: production-critical | user-facing | admin-only | internal | test-only | dead-code
# Required if tier in [CRITICAL, HIGH]:
impact: <one sentence — how customer experiences the gap>
example_failure: <one sentence — concrete user scenario that triggers it>
# Required if tier=OK:
intentional_citation: <CLAUDE.md/TTD line that documents the design choice>
notes: <only if needed>
```

**Required fields by tier:**

| Tier | Extra required |
|---|---|
| CRITICAL | impact + example_failure |
| HIGH | impact + example_failure |
| MEDIUM | (none beyond base) |
| LOW | (none beyond base) |
| OK | intentional_citation |

## Sweep manifest (standalone runs only)

Path: `.lattice/findings/sweeps/<sweep_id>.yml`

```yaml
sweep_id: <id>
sweep_date: <YYYY-MM-DD>
project_root: <root>
modules_audited: [<module-path or scope paths>]
dimensions: [flow]
mode: SEQUENTIAL | FLOW_SCOPE   # FLOW_SCOPE for multi-module --scope runs
auditor: claude-code/flow-audit
auditor_model: <opus|sonnet|haiku>
duration_ms: <int>
totals: { CRITICAL: n, HIGH: n, MEDIUM: n, LOW: n, OK: n }
opened: [<slug>, ...]
unchanged: [<slug>, ...]
closed_since_last: [<slug>, ...]
regressed: [<slug>, ...]
skipped: <int>
runtime_warnings:
  - "<flow-diagram missing, ambiguous-intent calls, etc.>"
```

**Skip when invoked from `/audit-sweep`** — orchestrator writes the unified manifest.
