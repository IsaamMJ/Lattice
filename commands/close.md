---
description: Close a Lattice finding — wraps `lattice close` with explicit-invocation gate. Use when the user says "close this finding", "mark as fixed", "this is done", or invokes `/close <finding-id>`.
argument-hint: <finding-id> [--reason <fixed|false-positive|wont-fix|out-of-scope|duplicate>] [--commit <sha>] [--rationale "..."]
disable-model-invocation: true
allowed-tools: Bash
---

# close — lifecycle finding closure (user-only)

## Current state

!`lattice list --tier CRITICAL,HIGH 2>/dev/null | head -20 || echo "(no findings in cwd or lattice not on PATH)"`

## Why this is user-only

`disable-model-invocation: true` blocks Claude from auto-invoking this skill. Finding closure is a deliberate lifecycle action — like commit, deploy, send-message. Claude can RECOMMEND closing a finding ("this is now fixed, you can close with `/close X`"), but should never auto-close.

The bash CLI (`lattice close <id> ...`) remains fully Claude-invokable for scripted flows. This skill wraps it with an explicit user gate.

**Effect on `.lattice/findings/` paths:** closure moves the YAML from `.lattice/findings/open/<slug>.yml` to `.lattice/findings/closed/<slug>.yml` and stamps `closed_at`, `closed_by_commit`, `close_reason`, `closure_rationale` per the schema. Re-open with `lattice reopen <id> --reason "..."` if you change your mind.

## Usage

```
/close <finding-id> --reason fixed --commit HEAD --rationale "what was actually changed"
```

Common variants:

| Intent | Command |
|---|---|
| Mark a finding as genuinely fixed | `/close $ARGUMENTS --reason fixed --commit HEAD --rationale "..."` |
| False positive — code is fine | `/close $ARGUMENTS --reason false-positive --rationale "why the audit got it wrong"` |
| Acknowledged but accepting the risk | `/close $ARGUMENTS --reason wont-fix --rationale "tradeoff: ..."` |
| Out of scope for this project | `/close $ARGUMENTS --reason out-of-scope` |
| Duplicate of another finding | `/close $ARGUMENTS --reason duplicate --rationale "duplicate of <other-slug>"` |

## What to do

Run:

```bash
lattice close "$ARGUMENTS"
```

If `$ARGUMENTS` doesn't include `--reason`, prompt the user for the reason BEFORE invoking. Do not guess the reason — the rationale matters for future audit traceability.

If the close fails (exit non-zero), show the error and suggest:
- `lattice show <id>` to verify the finding exists
- `lattice list --status open` to find the right id
- `lattice reopen <id>` if closing the wrong one

## Tool usage

| Tool | Used for |
|---|---|
| Bash | Only `lattice close <id> ...` — no other commands |

Frontmatter `allowed-tools: Bash` pre-approves the lattice CLI invocation so the user doesn't see a permission prompt each time.

## Output discipline

- No preamble. Echo the resolved command before running so the user sees what's about to happen.
- One line on success ("closed: <slug>") or the bash error on failure.
- Suggest the next step only if relevant (e.g. recently closed finding might want a commit).
