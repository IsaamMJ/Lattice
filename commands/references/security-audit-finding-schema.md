# security-audit: finding YAML schema + sweep manifest

Load when writing findings. Skip when just reading existing findings.

## Finding YAML

Path: `.lattice/findings/open/<TIER>-<module-slug>-<rule-slug>.yml`

Rule slug examples: `webhook-timing-unsafe-eq`, `unguarded-route`, `xss-template-interpolation`, `missing-rate-limit`, `idor-userid-not-checked`.

```yaml
id: <12-char hex>   # Generate via:
                    #   lattice id-gen security <rule> <file> "<exact source line, whitespace-collapsed>"
                    # All four positional args required.
rule: <kebab-case pattern slug>
dimension: security
tier: CRITICAL | HIGH | MEDIUM | LOW | OK
module: <module path>
file: <path>
line: <integer>
title: <one-line risk summary>
fix: <one-sentence recommended remediation>
sweep_date: <YYYY-MM-DD>
sweep_id: <14-char: YYYYMMDD + 6-hex, generate via `lattice sweep-id`>
auditor: claude-code/security-audit
exposure: production-critical | user-facing | admin-only | internal | test-only | dead-code
# Required if tier in [CRITICAL, HIGH]:
owasp: A01..A10
exploitability: Remote-unauth | Remote-auth | Local-only
blast_radius: <one sentence — what an attacker gains>
attack_scenario: <one sentence — what an attacker does>
secure_code_example: |
  // BAD
  ...
  // GOOD
  ...
notes: <only if needed>
```

**Required by tier:**

| Tier | Extra required fields |
|---|---|
| CRITICAL | owasp + exploitability + blast_radius + attack_scenario + secure_code_example |
| HIGH | owasp + exploitability + blast_radius + attack_scenario + secure_code_example |
| MEDIUM | (none beyond base) |
| LOW | (none beyond base) |
| OK | intentional_citation (CLAUDE.md/TTD line that justifies the safe pattern) |

**Remediation timelines** (set as the implicit deadline; the user does the work):

| Tier | Deadline |
|---|---|
| CRITICAL | 24 hours; rotate any exposed secret within 1 hour |
| HIGH | 1 week |
| MEDIUM | 1 month |
| LOW | backlog |

## Sweep manifest (standalone runs only)

Path: `.lattice/findings/sweeps/<sweep_id>.yml`

```yaml
sweep_id: <id>
sweep_date: <YYYY-MM-DD>
project_root: <root>
modules_audited: [<module-path>]
dimensions: [security]
mode: SEQUENTIAL
auditor: claude-code/security-audit
auditor_model: <opus|sonnet|haiku>
duration_ms: <int>
totals: { CRITICAL: n, HIGH: n, MEDIUM: n, LOW: n, OK: n }
opened: [<slug>, ...]
unchanged: [<slug>, ...]
closed_since_last: [<slug>, ...]
regressed: [<slug>, ...]
skipped: <int>
runtime_warnings:
  - "<npm audit timeouts, ambiguous false-positive calls, etc.>"
```

**Skip when invoked from `/audit-sweep`** — orchestrator writes the unified manifest.
