# Lattice canonical rule taxonomy (`core/*`)

Status: shipped in v2.5.0 (epic #115)

Lattice audits used to re-derive the same bug classes from scratch every run,
inventing a fresh `rule:` slug each time — so the same defect appeared as
`booking-cancel-no-cas-atomic`, `digest-reset-read-not-atomic`,
`non-atomic-counter-reset`, … with no way to group them across projects. The
canonical taxonomy fixes that: a small library of stable `core/*` rule IDs, each
backed (where the class has a static signature) by a **deterministic scanner**
that runs as a precondition pass — like `audit-env-contract` — so the class
fires every time instead of relying on a model re-noticing it.

This taxonomy was derived from mining 388 findings (open + closed) across 6
unrelated codebases. The recurrence is the mandate: a class Lattice keeps
rediscovering by hand earns a deterministic check.

## How findings reference it

A finding may carry an optional `canonical_rule:` field, e.g.:

```yaml
rule: secret-in-logs
canonical_rule: core/secret-in-logs
dimension: security
```

`rule:` stays project-local/human-friendly; `canonical_rule:` is the stable
cross-project identity that `lattice projects findings` can group on.

## Running the deterministic pack

```
lattice audit-core [--path P] [--rule NAME] [--write]
```

Dry-run prints a `TIER RULE KEY LOCATION` table. `--write` emits one finding
YAML per hit. Start with dry-run (`--rule X` to focus) before `--write` — some
classes (e.g. unbounded-external-call) are pervasive and you'll want to triage
the table first. Each rule is a Node scanner at `scripts/lattice-<x>-scan.mjs`
with a uniform `file|line|tier|key|snippet` stdout contract; adding a rule =
drop a scanner + one row in the `CORE_RULES` table in `scripts/lattice`.

## Implemented rules (v2.5.0)

| `core/*` id | dim | default tier | what fires | scanner |
|---|---|---|---|---|
| `secret-in-logs` | security | HIGH (MEDIUM for bearer/jwt/otp) | a sensitive **value** reaching a log sink — interpolation, bare-arg, concat, or object-shorthand. NOT a sensitive *word* in a message string. | `lattice-secret-scan.mjs` |
| `unbounded-external-call` | scale | RISK | `fetch`/`axios`/`openai`/`requests`/`httpx`/`http`/`dio` with no `timeout`/`signal`/`AbortSignal`/deadline on the call | `lattice-timeout-scan.mjs` |
| `missing-rate-limit` | scale | HIGH/MEDIUM/RISK | public NestJS/Next/Express handlers on `webhook|auth|payment` paths with no throttle; LLM call-paths with no per-user budget; in-memory limiters (cluster-unsafe) | `lattice-ratelimit-scan.mjs` |
| `in-mem-state-no-cluster` | scale | RISK | module-level mutable Map/Set/counter that is mutated; in-process LRU/NodeCache; module-scope `setInterval` cron | `lattice-inmem-scan.mjs` |
| `missing-tenant-filter` | security | HIGH (writes) / MEDIUM (reads) | Prisma/ORM `update`/`delete`/`find*` whose `where` omits the tenant key (`tenantId`/`orgId`/… — configurable via `LATTICE_TENANT_KEYS` or `.lattice/config.yml: tenant_keys:`) | `lattice-tenant-scan.mjs` |

All scanners: precision over recall (a noisy detector is worse than none),
skip comments + test files, suppress dev-guarded lines (`kDebugMode`,
`__DEV__`, `NODE_ENV` checks), and never report `test/`/`fixtures/` code.

## Planned (not yet deterministic)

| `core/*` id | dim | status |
|---|---|---|
| `silent-fallback` | resilience | #123 — new dimension: empty catches, degradation-hiding `\|\|` fallbacks, fire-and-forget, fail-open |
| `no-atomic-state-mutation` | scale | LLM-assisted (read-then-write across `await` without a lock is hard to ground statically); greppable candidate-flagging proxies planned |
| `missing-audit-log` | security | heuristic, not yet built |

## Promotion loop (#124, planned)

The 280 closed findings across the fleet are labelled positives. A future
`lattice rules promote` will rank each canonical rule by occurrence ×
distinct-repos × fixed-rate and recommend which heuristic rules graduate to
deterministic precondition checks — closing the loop so Lattice tunes its own
rule pack from its fix history rather than a one-time analysis.
