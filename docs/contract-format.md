# Contract-format spec

The structure `/audit` rewrites docs into. Optimized for Claude Code grounding (every claim has a `file:line` citation) without losing rationale for human readers.

## Why this format

Long-prose docs go stale and become unauditable — readers can't tell which claims are load-bearing. Pure code-derived contracts strip away rationale. The contract format compresses the load-bearing claims into structured sections while preserving "why" in `Context` and `Decisions`.

## The seven sections

### `## Module: <name>`
Header line. Includes:
- `file: <module-path>`
- `entry: <entry file>`
- `status: ACTIVE | DEPRECATED | IN_PROGRESS`

### `## Context`
2-4 sentences. What this module does and why it exists. For human onboarding. Not load-bearing on Claude Code; humans read this first.

### `## Sub-modules`
Bulleted list of files in the module. Each bullet:
- `<filename>` — one-line role description — `file:line`

The `file:line` proves the file exists at the time of writing.

### `## Tables Owned`
Markdown table: `| Table | Status | Purpose |`. Status is `active | dormant | deprecated`. Purpose is one phrase.

### `## Contracts`
The load-bearing claims. Bulleted list. Each bullet cites `file:line`. Examples:
- Public methods + signatures (`MyService.handle(args) → Promise<Result>` — `service.ts:41`)
- HTTP routes (`POST /api/v1/webhooks/foo` — `controller.ts:56`)
- Env vars consumed (`FOO_API_KEY` — `service.ts:15`)
- External API versions (`Meta Cloud API v21.0` — `service.ts:15`)

### `## Decisions`
Architectural decisions with sources. Each entry:
- `[YYYY-MM-DD] <what was decided>` — source: <commit hash or CLAUDE.md line>

A decision is anything that constrains future code: "we chose X over Y because Z". Captures the rationale that would otherwise be lost in scattered Slack threads.

### `## Constraints`
`NEVER` rules — things future code (and future Claude) must not do. Each constraint should be one line. Examples:
- `NEVER add a new fetch('https://api.foo.com/...') outside src/modules/foo/` (rule X)
- `NEVER pre-credit a user — credits added only by webhook after payment_link.paid`
- `NEVER reintroduce flows/, classifier/, handlers/ subdirectories — they were deliberately deleted`

Constraints are how the doc protects the codebase from future drift.

### `## Unresolved`
Open questions the auditor couldn't answer. Each item phrased as a question for a human:
- "Should table X be dropped, or is it reserved for a near-term feature?"
- "Is feature Y still product intent, or has policy changed?"

UNVERIFIABLE findings from the audit land here.

## Sample skeleton

```markdown
# <Project> — Module TTD: <Name>

**Document:** XX-module-<name>.md
**Version:** 2.0
**Date:** YYYY-MM-DD
**Status:** ACTIVE
**Audited:** YYYY-MM-DD against `path/to/module/`
**Depends on:** other-module-A.md, other-module-B.md

---

## Module: <Name>
file: `path/to/module/`
entry: `module.ts`
status: ACTIVE

## Context
<2-4 sentences for humans>

## Sub-modules
- `module.ts` — Nest wiring — `module.ts:1`
- `service.ts` — main service — `service.ts:13`

## Tables Owned
| Table | Status | Purpose |
|---|---|---|
| `foo_things` | active | Stores user things |

## Contracts
- Public method: `FooService.handle(args) → Result` — `service.ts:41`
- Env var: `FOO_API_KEY` — `service.ts:15`

## Decisions
- [YYYY-MM-DD] <decision> — source: <commit-hash or CLAUDE.md line>

## Constraints
- NEVER <thing future Claude Code must not do>

## Unresolved
- <open question for human>
```

## When to use this format

- **Per-module TTDs** — yes, this is what it's designed for
- **Master architecture docs** — no, those are cross-cutting; use a different format
- **PRDs** — no, those are product requirements; most claims aren't grep-able
- **Runbooks** — no, those are procedural; use ordered steps

## Lock the format in CLAUDE.md

After adopting this format, add a section to `CLAUDE.md`:

```
## Doc format (docs/ttd/*.md)
All TTD module docs follow the contract structure: Module / Context / Sub-modules / Tables Owned / Contracts / Decisions / Constraints / Unresolved. Every claim cites file:line. Every Decision cites a commit hash or CLAUDE.md drift-log line.
```

This makes the format load-bearing across future Claude Code sessions and prevents drift back to long-prose.
