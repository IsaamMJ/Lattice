# Lattice decision schema (v0.7)

Decisions capture the **why** behind code: architectural choices, tradeoffs, hidden constraints. They live next to code in `decisions/`, are version-controlled, and surface as a pre-push warning when files in `affects:` change.

This document is the schema contract. The validator at `scripts/validate-decisions.sh` enforces it.

## File layout

```
decisions/
├── async-webhooks.md
├── rate-limiting.md
└── auth-flow.md
```

- One file per decision
- Filename = decision id + `.md` (kebab-case, e.g. `async-webhooks.md` → id `async-webhooks`)
- Filename slug is the **stable id** referenced by `lattice decision show <id>`, `lattice decision ack <id>`, and ack files at `.lattice/acks/{email}/{id}`
- Allowed slug characters: `[a-z0-9-]+` (kebab-case, no underscores, no uppercase)

## File format

YAML frontmatter (between two `---` lines) followed by free-form markdown body.

```markdown
---
title: "Async Webhooks"
why: "Sync model hits 500ms timeout at 10k/day. Async buys headroom to 100k/day."
status: active
created: 2026-01-15
updated: 2026-05-03
affects:
  - src/webhooks/
  - src/queue/
  - tests/webhooks.test.ts
alternatives: |
  Considered: Redis streams (new dependency, operational overhead)
  Considered: Database queue (slower, no ordering guarantees)
  Chose: Async/await + in-memory queue because simplicity wins for current scale
---

## Why

(Free-form markdown body — the rationale, implementation notes, constraints.)
```

## Frontmatter schema

### Required fields

| Field | Type | Constraint |
|---|---|---|
| `title` | string | Non-empty. One-line human label. |
| `why` | string | Non-empty. One- or two-sentence rationale. |
| `status` | enum | One of: `active`, `superseded`, `proposed`, `deleted` |
| `created` | date | ISO date `YYYY-MM-DD` |
| `affects` | list of strings | Non-empty list. Each item is a path relative to repo root (file or folder). |

### Optional fields

| Field | Type | Notes |
|---|---|---|
| `updated` | date | ISO date `YYYY-MM-DD`. If absent, treated as equal to `created`. |
| `alternatives` | string | Free text. Multi-line block scalar (`|`) recommended. |
| `supersedes` | string | id of the decision this one replaces (used when `status: active` replaces a `superseded` predecessor). |
| `superseded_by` | string | id of the decision that replaced this one. Set on the old decision when its replacement is created. |

Unknown fields are allowed (forward-compatibility) but are ignored by the validator and the pre-push hook.

## Status semantics

| Status | Pre-push hook | Meaning |
|---|---|---|
| `active` | Warns | Decision is in force. Changes to `affects:` files trigger warnings. |
| `superseded` | Skips | Replaced by a newer decision. Kept for history; does not warn. |
| `proposed` | Skips | Draft / under discussion. Does not warn until promoted to `active`. |
| `deleted` | Skips | Retired. Kept in git history; does not warn. Prefer over `git rm` so the rationale is preserved. |

Only `status: active` decisions produce pre-push warnings (per spec §3, §"Suppressing Warnings", FAQ).

## `affects:` path rules

- Paths are relative to the repo root (no leading `/`, no `./`)
- Trailing `/` indicates a folder (matches all files under it, recursively)
- No trailing `/` indicates a single file
- Paths must use forward slashes on all platforms (the hook normalizes git output)
- Empty list is invalid — every decision must affect at least one path

Examples:

```yaml
affects:
  - src/webhooks/              # all files under src/webhooks/
  - src/queue/worker.ts        # one specific file
  - tests/webhooks.test.ts
```

The validator does **not** require the paths to exist. A decision can be written before the code (proposed) or kept after the code is removed (superseded). The v0.8 decision audit will report on `affects:` paths that no longer exist.

## Validator behavior

`scripts/validate-decisions.sh` runs as part of `scripts/validate.sh` and on CI. For each `decisions/*.md`:

1. First non-empty line is `---` (frontmatter present)
2. Closing `---` exists on its own line
3. Frontmatter parses as valid YAML
4. All required fields are present and non-empty
5. `status` is one of the four allowed values
6. `created` (and `updated` if present) match `YYYY-MM-DD`
7. `affects` is a non-empty list of strings, each a non-empty path
8. Filename slug matches `[a-z0-9-]+`

Failures are reported with file path and reason. Exit non-zero if any decision is invalid.

## Stability promise

Schema follows SemVer:
- **Patch** (0.7.0 → 0.7.1): adding optional fields is allowed
- **Minor** (0.7 → 0.8): adding required fields requires a migration script + deprecation cycle
- **Major** (0.x → 1.0): removing required fields, renaming statuses, or changing `affects:` semantics

## Why this schema

- **Simple:** five required fields, no nested objects
- **Readable in git:** plain markdown, frontmatter renders on GitHub
- **Greppable:** id = filename, no separate registry needed
- **Stable id:** slug-as-filename means the ack file path is derivable without parsing
- **Forward-compatible:** unknown fields ignored, room for v0.8 audit metadata
