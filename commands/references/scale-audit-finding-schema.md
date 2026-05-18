# scale-audit: finding YAML schema + sweep manifest

Load when writing findings or sweep manifest. Skip when just reading existing findings.

## Finding YAML — one file per finding

Path: `.lattice/findings/open/<TIER>-<module-slug>-<rule-slug>.yml`

For scale dimension, `<rule-slug>` is a kebab-case pattern name:
- `setinterval-cron`
- `in-memory-rate-limiter`
- `local-file-write`
- `unbounded-promise-all`
- `local-host-assumption`

```yaml
id: <12-char hex>   # Generate via:
                    #   lattice id-gen scale <rule> <file> "<exact source line, whitespace-collapsed>"
                    # All four positional args are required.
rule: <kebab-case pattern slug>
dimension: scale
tier: BLOCKER | RISK | WATCH | OK
module: <module path>
file: <path>
line: <integer>
title: <one-line risk summary>
fix: <one-sentence recommended migration>
sweep_date: <YYYY-MM-DD>
sweep_id: <14-char: YYYYMMDD + 6-hex, generate via `lattice sweep-id`>
auditor: claude-code/scale-audit
exposure: production-critical | user-facing | admin-only | internal | test-only | dead-code
# Required if tier in [BLOCKER, RISK]:
failure_mode: <one sentence — what breaks at instance #2>
# Required if tier=WATCH:
intentional_citation: <CLAUDE.md:line or TTD:line that justifies the single-instance choice>
notes: <only if needed>
```

**Required fields by tier:**

| Tier | Extra required fields |
|---|---|
| BLOCKER | `failure_mode` (one sentence — what breaks at instance #2) |
| RISK | `failure_mode` (one sentence — load condition that exposes it) |
| WATCH | `intentional_citation` (CLAUDE.md:line or TTD:line justifying single-instance) |
| OK | `intentional_citation` (file:line showing the scale-safe implementation) |

**Common fix recommendations:**

| Pattern | Recommended fix |
|---|---|
| In-process rate limiter | "back rate limiter with Valkey using `INCR` + `EXPIRE`" |
| `setInterval` cron | "move to BullMQ with `@nestjs/bull`" |
| Local file writes | "move to S3/R2 or DB-backed blob storage" |
| In-memory dedup | "use DB unique constraint or Redis SET NX" |
| Race-prone read-modify-write | "wrap with `redlock` for distributed lock, or `SELECT ... FOR UPDATE`" |
| Module-constructor background work | "gate with leader election or move to scheduled job" |

## Sweep manifest (standalone runs only)

Path: `.lattice/findings/sweeps/<sweep_id>.yml`

```yaml
sweep_id: <id>
sweep_date: <YYYY-MM-DD>
project_root: <root>
modules_audited: [<module-path>]
dimensions: [scale]
mode: SEQUENTIAL
auditor: claude-code/scale-audit
auditor_model: <opus|sonnet|haiku>
duration_ms: <int>
totals: { BLOCKER: n, RISK: n, WATCH: n, OK: n }
opened: [<slug>, ...]
unchanged: [<slug>, ...]
closed_since_last: [<slug>, ...]
regressed: [<slug>, ...]
skipped: <int>
runtime_warnings:
  - "<patterns inside try/catch with graceful-degrade, etc.>"
```

**Skip when invoked from `/audit-sweep`** — orchestrator writes the unified manifest.
