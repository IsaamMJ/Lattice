# Lattice finding schema

Every finding produced by every Lattice skill MUST conform to this schema. validate.sh checks for skill conformance; CI fails on schema drift.

## Why one schema across all skills

Three audit dimensions today (audit, scale, security), more to come (mock, reliability, perf). Without one schema:
- The aggregator (`/audit-sweep`) has to translate per-skill formats
- Cross-cutting detection breaks (can't dedupe findings if shapes differ)
- Future tooling (CI integration, IDE extensions, F2 `/audit-diff`) needs a stable contract

One schema now = downstream features stay cheap to build.

## Per-finding schema (all skills, all dimensions)

```yaml
# Required fields
dimension: audit | scale | security        # which Lattice skill produced it
tier: <verdict>                            # see verdict tiers below
file: <path-relative-to-project-root>      # MUST be a real file
line: <integer>                            # 1-indexed
fix: <one-sentence remediation>            # MUST be present unless tier=OK

# Conditional fields
attack_scenario: <one sentence>            # REQUIRED if dimension=security AND tier in [CRITICAL, HIGH]
failure_mode: <one sentence>               # REQUIRED if dimension=scale AND tier in [BLOCKER, RISK]
owasp: <A01..A10>                          # REQUIRED if dimension=security AND tier in [CRITICAL, HIGH]
exploitability: Remote-unauth | Remote-auth | Local-only   # REQUIRED if dimension=security AND tier in [CRITICAL, HIGH]
blast_radius: <one sentence>               # REQUIRED if dimension=security AND tier in [CRITICAL, HIGH]
secure_code_example: <BAD/GOOD code block> # REQUIRED if dimension=security AND tier in [CRITICAL, HIGH]
intentional_citation: <commit-hash | CLAUDE.md:line>   # REQUIRED if tier=INTENTIONAL
```

## Verdict tiers (per dimension)

| Dimension | Tiers (highest → lowest) | Notes |
|---|---|---|
| audit | DRIFT, INTENTIONAL, OK, UNVERIFIABLE | INTENTIONAL requires `intentional_citation` |
| scale | BLOCKER, RISK, WATCH, OK | BLOCKER/RISK require `failure_mode` |
| security | CRITICAL, HIGH, MEDIUM, LOW, OK | CRITICAL/HIGH require OWASP + scenario + secure code |

## Findings file format

Each skill writes a markdown file at `.lattice/findings/<dim>-<module>-<YYYYMMDD-HHMMSS>.md` with:

1. A YAML frontmatter block listing the file-level metadata (dimension, module, date, auditor, summary counts)
2. A markdown body where each finding is a `### [<TIER>] <one-line summary>` heading followed by a list of the schema fields above

Example skeleton:

```markdown
---
dimension: security
module: src/modules/payments
date: 2026-05-02T06:00:00Z
auditor: claude-code/security-audit
summary:
  CRITICAL: 1
  HIGH: 2
  MEDIUM: 0
  LOW: 1
  OK: 4
---

# Security Audit: src/modules/payments

## Findings

### [CRITICAL] Webhook signature compared with === (timing-unsafe)
- **dimension**: security
- **tier**: CRITICAL
- **file**: src/modules/payments/payments.controller.ts
- **line**: 47
- **owasp**: A02
- **exploitability**: Remote-unauth
- **blast_radius**: Attacker can forge Razorpay webhooks → arbitrary credit grants
- **attack_scenario**: Adversary times response to learn signature byte-by-byte, then forges payment-success webhook
- **fix**: Replace `===` with `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))`
- **secure_code_example**:
  ```ts
  // BAD
  if (sig === expected) { /* ... */ }
  // GOOD
  if (crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) { /* ... */ }
  ```

### [HIGH] Missing rate limiter on public webhook
- ...
```

## Master sweep file

`/audit-sweep` writes one master file at `.lattice/findings/sweep-<YYYYMMDD-HHMMSS>.md` aggregating all per-module files. Schema for the master file:

```yaml
---
sweep_version: 0.5
date: <ISO timestamp>
project_root: <path>
modules_audited: <count>
duration_ms: <int>
mode: SEQUENTIAL | PARALLEL
dimensions: [audit, scale, security]
total_findings:
  CRITICAL: <n>
  BLOCKER: <n>
  HIGH: <n>
  RISK: <n>
  MEDIUM: <n>
  LOW: <n>
  WATCH: <n>
  DRIFT: <n>
  INTENTIONAL: <n>
  UNVERIFIABLE: <n>
  OK: <n>
per_module_files:
  - <path>
  - <path>
cross_cutting_bundles:
  - title: <PR title>
    affected_modules: [...]
    estimated_effort: S | M | L
---
```

## Stability promise

This schema follows SemVer:
- **Patch** (0.5.0 → 0.5.1): adding optional fields is allowed
- **Minor** (0.5 → 0.6): adding required fields requires a deprecation cycle
- **Major** (0.x → 1.0): tier renames or required-field removal

## Why we didn't adopt SARIF

SARIF is the industry-standard static-analysis report format. We considered it for v0.5 and rejected it: 50+ required fields, deeply nested, designed for tools that produce thousands of findings per scan. Lattice produces dozens per sweep with rich human-readable context. Forcing SARIF would bloat findings 5-10× without value.

If/when Lattice integrates with SARIF-consuming tools (GitHub code scanning, Azure DevOps), we'll ship a SARIF exporter alongside this native schema — not replace it.
