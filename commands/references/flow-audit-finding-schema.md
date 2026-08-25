# flow-audit: finding YAML schema + sweep manifest

Load when writing findings. Skip when just reading.

## Finding YAML

Path: `.lattice/findings/open/<TIER>-<module-slug>-<rule-slug>.yml`

Rule slug examples — Pack A (conversational): `missing-error-handling`, `state-transition-unvalidated`, `no-exit-path`, `abandonment-timeout-not-set`, `multi-turn-context-lost`. Pack B (crud-rbac, #129 #135): `scope-filter-shallower-than-role`, `scope-value-from-client-input`, `mutation-guard-ui-only`, `control-rendered-but-action-rejects`, `transition-missing-from-state-guard`, `derived-state-no-manual-override`, `route-missing-error-boundary`.

```yaml
id: <12-char hex>   # lattice id-gen flow <rule> <file> "<source line>"
rule: <kebab-case pattern slug>
dimension: flow     # security for Pack B Group A (scoping) — see below
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
# Optional (v2.8.0, #135) — which rule pack produced this finding:
rule_pack: conversational | crud-rbac
```

**Required fields by tier:**

| Tier | Extra required |
|---|---|
| CRITICAL | impact + example_failure |
| HIGH | impact + example_failure |
| MEDIUM | (none beyond base) |
| LOW | (none beyond base) |
| OK | intentional_citation |

## Pack B additions (v2.8.0, #129 #135)

Findings from the crud-rbac pack ([flow-audit-crud-rbac-rules.md](flow-audit-crud-rbac-rules.md)) use the same schema, plus:

| Field | When | Value |
|---|---|---|
| `rule_pack:` | always | `crud-rbac` — lets `lattice list --dimension flow` output be split by pack, and `lattice projects findings` group across repos |
| `affected_roles:` | Groups A + B | block list of the roles the gap is reachable for, from the Probe 3 role universe |
| `scope_path:` | Group A | the scope chain the query should have pinned (`org > department`) |
| `transition:` | Group C | `FROM -> TO`, matching the Probe 5 edge |

**Group A files as `dimension: security`**, not `flow` — a scoping leak is an access-control defect and belongs where `lattice list --dimension security` will surface it. That brings the security required-field set with it: CRITICAL/HIGH need `owasp`, `exploitability`, `blast_radius`, `attack_scenario`, `secure_code_example`. Regen rejects the YAML without them (`scripts/lattice-regenerate.sh` DIMENSION_TIER_REQUIRED). Groups B-E stay `dimension: flow` and need only `impact` + `example_failure`.

Do not re-file what `lattice audit-core --rule missing-tenant-filter` already emitted — it writes its own findings with `canonical_rule: core/missing-tenant-filter`, and a duplicate under a Pack B slug is a second finding for one bug.

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
