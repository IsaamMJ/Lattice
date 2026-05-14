---
description: Auto-fix one low-risk Lattice finding by dispatching a Haiku subagent with the lattice handoff brief, verifying, and closing — or logging the failure for brief refinement.
argument-hint: <finding-id>
---

# lattice-fix

You are auto-fixing exactly one Lattice finding by dispatching a Haiku subagent. This is the cost-optimized, low-risk lane — never for CRITICAL/BLOCKER/HIGH work.

## Step 1 — Load the finding

Findings live as one YAML per finding under `.lattice/findings/open/<slug>.yml` (and `.lattice/findings/closed/<slug>.yml` after close). Load this one:

Run: `bash scripts/lattice show $ARGUMENTS` (or `bash ~/.claude/lattice/scripts/lattice show $ARGUMENTS` if installed globally and not in the source repo).

Read the YAML output. Extract: `tier`, `dimension`, `fix`, `file`, `line`, `title`, `relates_to`, `cluster_root`.

## Step 2 — Eligibility gate (ABORT IF NOT CLEAN)

Refuse to proceed and exit with a clear message if ANY of these are true:

| Gate | Reason |
|---|---|
| `tier ∈ {CRITICAL, BLOCKER, HIGH}` | High-blast-radius work needs human review |
| `fix` does NOT contain `PATCH_DOC` | v1 of /lattice-fix only handles doc edits |
| `relates_to:` has any entry | Cluster cascade risk — fix the root manually |
| `cluster_root: true` | Same — clusters need humans |
| `dimension ∈ {security}` | Security findings are never auto-fixed regardless of tier |

If any gate trips, print:
```
[lattice-fix] REFUSED <slug>: <which gate tripped>
[lattice-fix] this lane is for low-risk PATCH_DOC fixes only — handle manually
```
and stop. Do not dispatch.

## Step 3 — Generate the Haiku brief

Run: `bash scripts/lattice handoff $ARGUMENTS`

Capture the output. This is your prompt foundation.

## Step 4 — Dispatch Haiku

Use the Agent tool:
- `subagent_type`: `general-purpose`
- `model`: `haiku`
- `description`: `Haiku auto-fix <slug>`
- `prompt`: The handoff brief, wrapped with these HARD CONSTRAINTS:

```
[HARD CONSTRAINTS — do not violate]
1. Edit ONLY the file and line cited in the brief. No other file.
2. Use the Edit tool with an exact old_string match. Do not Write.
3. Do not run git, do not commit, do not stage anything.
4. Do not modify any other line in the file (preserve all surrounding content byte-for-byte).
5. After the edit, report in 3 lines max: (a) old → new, (b) Edit tool result, (c) any concerns.
6. Stop after the single edit.
```

## Step 5 — Verify independently

After the agent returns, you (the orchestrator) re-read the changed line yourself using Read or Bash `sed -n '<line>p' <file>`. Do not trust the agent's report alone.

Compare against the finding's `fix:` instruction. If the new content matches what the finding asked for: VERIFIED. Otherwise: FAILED.

## Step 6a — On success: close the finding

Run:
```bash
SHA=$(git rev-parse --short HEAD)
bash scripts/lattice close <slug> --reason fixed --commit "$SHA" --rationale "auto-fixed by Haiku via /lattice-fix; <token_count> tokens / <duration>s / <tool_uses> tool uses; verified <ISO timestamp>"
```

Print: `[lattice-fix] DONE <slug> in <duration>s (<tokens> tokens, <tool_uses> tool uses)`

## Step 6b — On failure: log feedback, do NOT close

Append to `.lattice/handoff-feedback/<rule>.md` (mkdir -p first):

```markdown
## <ISO timestamp> — failure on <slug>

**Brief used:** (link or paste handoff output)

**What Haiku did:** <agent's reported old → new>

**Why verification failed:** <specific mismatch — e.g. "expected line to start with `# Lattice` but got `## Lattice`">

**Hypothesis for brief refinement:** <one-line guess at what the brief was missing>
```

Then print:
```
[lattice-fix] FAILED <slug>: <one-line reason>
[lattice-fix] feedback logged to .lattice/handoff-feedback/<rule>.md
[lattice-fix] finding remains open — human review needed
```

Do not close the finding. Do not commit.

## Step 7 — Final output

One line, no preamble:
```
[lattice-fix] <DONE|FAILED|REFUSED> <slug> — <details>
```

## Tool usage

- **Bash**: `bash scripts/lattice show|handoff|close` (or the installed `~/.claude/lattice/scripts/lattice` path), `sed -n '<line>p' <file>` for verification reads, `mkdir -p` + append for the failure-feedback log, `git rev-parse --short HEAD` for the close commit ref.
- **Read**: re-read the changed line independently before closing.
- **Agent**: ONE dispatch per invocation — `subagent_type: general-purpose`, `model: haiku`, the handoff brief plus hard-constraints block as prompt.
- **Edit / Write**: the orchestrator (this skill) never edits the target file directly — that's the Haiku subagent's job. The skill only writes to `.lattice/handoff-feedback/<rule>.md` on failure.
- **Never used**: Glob, Grep (the finding YAML already pins file:line), git commit / push (no auto-commit), Task with non-haiku models (cost discipline).

## Anti-patterns (refuse to do these)

- ❌ Dispatching on CRITICAL/HIGH/BLOCKER tiers
- ❌ Trusting the agent's success report without independent re-read
- ❌ Closing the finding when verification fails
- ❌ Auto-committing or auto-pushing the change
- ❌ Modifying any file outside the finding's `file:` field
- ❌ Running multiple agents in parallel for the same finding (race condition)

## Telemetry

The `bash scripts/lattice handoff` and `bash scripts/lattice close` calls both auto-log to `.lattice/usage/events.jsonl` and `~/.claude/lattice/usage/global.jsonl` via the dispatcher. No extra telemetry is needed in this skill.

## Why this skill exists

Lattice tracks bugs; v0.7.3 proved Haiku can fix easy ones reliably (3-for-3 on PATCH_DOC, ~9s and ~35K tokens each). This skill makes that loop a single command instead of manual orchestration. The eligibility gate keeps the lane safe; the verify-before-close step prevents bad fixes from looking clean.

When Haiku fails, the failure-feedback log accumulates evidence for refining the handoff brief template over time. That feedback is the input to the self-improving handoff loop described in `MEMORY.md`.


---

## CLI vs slash command

`/lattice-fix` (this slash command) is the **canonical fix entry point**. There is no `lattice fix` CLI subcommand — the auto-fix path requires a model session to drive Haiku, so it lives in slash form only. The `lattice` CLI handles non-model lifecycle: `lattice list`, `lattice show`, `lattice close`, `lattice verify`. See README "Workflow" section.
