# audit: Step 9 — contract-format rewrite template

Load only when reaching Step 9 (proposing the doc rewrite). The audit can complete without this file if the user only wants findings, not a rewrite.

## Target structure

Generate a proposed new version of the doc in this exact structure (do NOT write the file yet — show the diff in Step 10):

```markdown
## Module: <name>
file: <path>
entry: <entry file>
status: ACTIVE | DEPRECATED | IN_PROGRESS

## Context
<2-4 sentences for human readers: what this module does and why it exists>

## Contracts
- <verified behaviour/endpoint/export> — `file:line`

## Decisions
- [<YYYY-MM-DD>] <what was decided and why> — source: <commit hash or CLAUDE.md line>

## Constraints
- NEVER <thing future Claude Code must not do, derived from INTENTIONAL findings>

## Unresolved
- <each UNVERIFIABLE finding, phrased as a question for the human>

## Roadmap
- <aspirational claims from the original doc — `will`, `Phase N`, `future` items>
```

## Derivation rules

| Original doc section | Maps to |
|---|---|
| Present-tense factual claim, verified OK | `## Contracts` with `file:line` evidence |
| Present-tense claim, verified DRIFT | Excluded — the rewrite reflects code reality, not stale claim |
| INTENTIONAL finding (deliberately removed) | `## Constraints` as a `NEVER` rule with citation |
| Aspirational claim (`will`, `Phase N`, `future`) | `## Roadmap` |
| UNVERIFIABLE finding | `## Unresolved` as a question |
| Module name, status | `## Module:` header |
| Architectural rationale | `## Context` (2-4 sentences max) |
| Architecture decisions with dates | `## Decisions` with source citation |

## Step 10 — show diff and stop

Output the unified diff between original doc and proposed rewrite. **Do not write the file.** Tell the user:

```
Audit complete.
Findings:  .lattice/findings/open/
Manifest:  .lattice/findings/sweeps/<sweep_id>.yml
Verdicts:  <n> OK, <n> DRIFT, <n> INTENTIONAL, <n> UNVERIFIABLE

Proposed rewrite diff above.

Inspect: lattice show <id> | lattice list --dimension audit
Sync the CLAUDE.md checklist: lattice sync

Reply 'apply' to overwrite <doc-path>, or 'edit' to discuss changes first.
```

Wait for explicit approval before any `Write` against the doc.
