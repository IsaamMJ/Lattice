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
| `missing-tenant-filter` | security | HIGH (writes) / MEDIUM (reads) | Prisma/ORM `update`/`delete`/`find*` whose `where` omits the tenant key (`tenantId`/`orgId`/… — configurable via `LATTICE_TENANT_KEYS` or `.lattice/config.yml: tenant_keys:`) **and** pins no primary/unique key. Keys are read from the project's own `prisma/schema.prisma` (or a `prisma/schema/` folder; override with `LATTICE_PRISMA_SCHEMA`): `@id`/`@unique` fields and whole `@@id`/`@@unique` composites scope a statement by themselves, so `where: { id }` is never a finding (#195). With no schema present, only `id`/`<model>Id` count as keys. | `lattice-tenant-scan.mjs` |
| `select-shape-drift` | quality | LOW | two or more `select: { … }` projections of the **same** Prisma model whose key sets overlap at or above a threshold (default 0.70, override with `LATTICE_SELECT_DRIFT_THRESHOLD` or `.lattice/config.yml: select_drift_threshold:`) but are **not equal** — a hand-copied query that drifted. The finding is the symmetric difference. Equal sets (duplication) and undecidable shapes (spread, computed key, `select: SHARED_CONST`, conditional value) are silent. Model identity, nested relation selects and key validity come from the project's own `prisma/schema.prisma`; with no schema the accessor still names the model, so top-level drift is still reported (#196). | `lattice-selectdrift-scan.mjs` |
| `control-char-in-output` | quality | HIGH (render path) / MEDIUM / LOW (comment) | a literal C0/C1 control byte (anything but tab/newline/CR) in the source, and — inside a **template literal** — a backslash followed by a digit: `\2013`/`\0a0` are a CSS or unicode escape whose backslash needed doubling, and JS decodes them first (#196; Lattice's own worker shipped the same class as a regex whose range bounds were literal `0x00`/`0x1F` bytes, #199). Bonus sub-rule: a stray backtick that ends a template early, reported at the **backtick** rather than where `tsc` blames. "Inside a template literal" is lexical, so the file is LEXED — strings, templates with `${}` nesting, regex literals and both comment forms — never line-matched. A lone `\0` (the `-z` separator idiom) and `String.raw` tags are spared by construction. Tier follows a bounded intra-file taint pass to a response sink, not the filename. | `lattice-ctrlchar-scan.mjs` |

All scanners: precision over recall (a noisy detector is worse than none),
skip comments + test files, suppress dev-guarded lines (`kDebugMode`,
`__DEV__`, `NODE_ENV` checks), and never report `test/`/`fixtures/` code.

**What gets scanned is one shared decision, not a per-rule one** (#132).
Every scanner imports `scripts/lattice-scan-ignore.mjs`, which drops a path
when either: (a) it sits under `node_modules`/`.git` or a build-output
directory (`dist`, `build`, `.next`, `coverage`, `vendor`, `.lattice`,
`__pycache__`, `.venv`, `venv`, `.dart_tool`, `.netlify`) — true in any
project, git or not; or (b) git considers it ignored. Case (b) asks git
itself via one batched `git check-ignore -z --stdin` per scan (never one call
per file), so nested `.gitignore` files, negations, `**`, `.git/info/exclude`
and the global excludesFile all apply — and a file that is *tracked* despite
matching an ignore pattern is still scanned. Outside a git work tree, or with
no `git` binary, (a) stands alone. The same filter applies to the diff-scoped
`LATTICE_SCAN_FILES` list: an explicit file list is still a list of
candidates, so a gitignored or vendored path in it produces no findings.

## Planned (not yet deterministic)

| `core/*` id | dim | status |
|---|---|---|
| `silent-fallback` | resilience | #123 — new dimension: empty catches, degradation-hiding `\|\|` fallbacks, fire-and-forget, fail-open |
| `no-atomic-state-mutation` | scale | LLM-assisted (read-then-write across `await` without a lock is hard to ground statically); greppable candidate-flagging proxies planned |
| `missing-audit-log` | security | heuristic, not yet built |

## Promotion loop — `lattice rules promote` (#124, shipped v2.7.0)

The closed findings across the fleet are labelled positives. `lattice rules
promote` reads every registered project's findings (open + closed), clusters
them into rule families, and scores each by **distinct repos × occurrence ×
fixed-rate**. A family that recurs in ≥3 repos, is mostly *fixed* (≥60% of its
closes), and has no scanner yet is recommended for **promotion** to a
deterministic `core/*` check — so Lattice tunes its own rule pack from its fix
history instead of a one-time analysis. Run it after audits accumulate; if it
says "no new families have earned promotion," the implemented set already covers
the recurring, high-fix-rate classes. (As of v2.7.0 on the 6-repo dev fleet it
reports exactly that — the remaining big family, `no-atomic-state-mutation`,
stays a *watch* because its ~50% fixed-rate reflects how often it's deferred,
and it's the class least amenable to static detection.)
