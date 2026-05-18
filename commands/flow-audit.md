---
description: Audit a module for customer flow completeness — happy path, error handling, edge cases, state transitions, abandonment, notifications. Use when the user asks "where does this flow break?", wants to find dead-ends or drop-off causes, invokes `/flow-audit <module>`, or mentions customer journey / state machine / conversation flow concerns.
argument-hint: <module-path> | --scope <path1>,<path2>,...
allowed-tools: Read Grep Glob Bash
---

Target module(s) to audit: $ARGUMENTS

## Live Lattice state (auto-injected at invocation)

!`lattice context 2>/dev/null || echo "(lattice context unavailable)"`

## Argument parsing (do this FIRST)

| Form | Meaning |
|---|---|
| `/flow-audit <module-path>` | Single-module mode — audit one module end-to-end |
| `/flow-audit --scope <path1>,<path2>,...` | Multi-module flow mode — audit a flow that spans modules (e.g. `thyrocare,booking,payments,lumi`). All paths share one sweep_id; findings reference each module by its actual `module:` path |

If `--scope` is given, treat the comma-separated paths as audit scope; skip per-module dispatch (the flow IS the unit; crosses module boundaries by design).

# flow-audit

Auditing for **customer flow completeness** — patterns that cause customers to get stuck, lose context, or abandon when they hit errors, unexpected inputs, or state transitions.

## Why this skill exists

Code that "works in happy path" often has hidden gaps: no exit on "no", no handling for image-when-text-only, abandoned conversations never cleaned up, state changes silent to user. They don't surface in unit tests — they surface when a real user says "I changed my mind" mid-flow and hits a dead end.

## Risk patterns

### CRITICAL — breaks core flow

| Pattern | Why |
|---|---|
| Happy path (main request → response) missing/incomplete/untested | Customer initiates; nothing happens or hangs |
| No error handling on external call (API, LLM, DB query) | One timeout crashes entire flow |
| State transition unvalidated (can skip step 1 → step 3) | Customer gets into invalid state; flow corrupts |
| User input type not checked (accepts image when expecting text) | LLM receives wrong type; garbage response or crash |
| No exit / cancel / "change my mind" at critical steps | Customer trapped; force-abandon |

### HIGH — causes drop-off

| Pattern | Why |
|---|---|
| Abandonment timeout not set (conversation waits forever if customer pauses) | Silent drop-off; customer thinks bot is broken |
| Abandoned conversation state never cleaned up | DB bloat; stale rows leak memory or lock resources |
| Error message not shown to customer (error logged, customer sees nothing) | Customer doesn't know what went wrong; assumes broken |
| State change not acknowledged to customer | Customer doesn't know if action took effect |
| Multi-turn context lost mid-flow (previous message not in scope for next step) | Bot forgets what customer asked; asks same thing again |
| No validation on state preconditions (e.g. can't proceed without field X) | Flow advances with missing data; downstream fails |

### MEDIUM — fragile edge cases

| Pattern | Why |
|---|---|
| Boundary condition unchecked (empty list, max size, timeout value) | Works until someone hits the edge |
| Race condition on state writes (concurrent requests corrupt state) | Rare in dev, common at scale |
| Notification system not integrated (state changes not broadcast externally) | Internal inconsistency; systems diverge |
| No dedup on idempotent operations (customer retries → action duplicates) | Double-charge, double-message, inconsistent state |
| Hardcoded flow paths (cannot handle variation in customer input) | Flow breaks on unexpected but valid input |

### LOW — note in checklist

| Pattern | Why |
|---|---|
| Flow logs missing or insufficient (cannot reconstruct customer journey on error) | Debugging gaps |
| No test coverage for error paths | Coverage looks good, reality is fragile |

## Methodology

### Step 1 — Load living truth

| Source | Why |
|---|---|
| `CLAUDE.md` | Flow stage (alpha/beta/live), known limitations, intentional design constraints |
| Module's TTD doc | Flow diagram, state machine, intended happy path |
| `examples/` flows or README describing customer journey | Concrete reference points |

### Step 2 — Map the flow

Identify:
- Entry point (API endpoint, message handler, etc.)
- State machine / status fields
- External calls (LLM, DB, API)
- Handler files + service files
- Cleanup / timeout logic location

### Step 3 — Hunt patterns

Run targeted Grep for each pattern category. For each hit, **Read 20 lines of surrounding context** to filter false positives (test files, mocks, intentional one-shot operations).

**For the full 10-pattern grid**: load [references/flow-audit-subagent-prompt.md](references/flow-audit-subagent-prompt.md) — Sonnet subagent dispatch saves ~60% of tokens.

### Step 4 — Cross-check against TTD / design docs

If TTD/design doc says "intentional behavior" (e.g. "no exit path during payment confirmation — required by Razorpay"), downgrade tier or mark `OK` with citation.

### Step 5 — Assign verdicts

| Verdict | Means | Required evidence |
|---|---|---|
| **CRITICAL** | Breaks core flow; customer cannot complete the journey | `file:line` + how customer experiences it + 1-sentence fix |
| **HIGH** | Causes drop-off or silent failure; customer abandons | `file:line` + impact + fix |
| **MEDIUM** | Fragile edge case; works most of the time | `file:line` + fix |
| **LOW** | Note in checklist | `file:line` |
| **OK** | Pattern checked, intentional/safe with citation | `file:line` + TTD/CLAUDE.md citation |

**Hard rule — every CRITICAL/HIGH gets:**

1. **Flow impact**: 1 sentence on how customer experiences the gap
2. **Example failure**: 1 sentence concrete scenario ("user clicks 'No' at slot-selection step → bot says 'I don't understand' and loops")
3. **Recommended fix**: 1 sentence

**OK-finding discipline:** Emit `tier: OK` for patterns checked-and-found-safe (`OK-lumi-error-message-shown-to-user`, `OK-payments-abandonment-cleanup-cron`). First-class output — prevents re-flagging. Each OK requires `intentional_citation`.

### Step 6 — Write findings + manifest

Load [references/flow-audit-finding-schema.md](references/flow-audit-finding-schema.md) for exact YAML schema + required fields by tier.

**sweep_id sourcing:**
- Invoked from `/audit-sweep` → use the sweep_id passed through
- Standalone → generate via `lattice sweep-id` and write a manifest

### Step 7 — Draft checklist for deferred items

For every HIGH and every MEDIUM not fixed today, draft a checklist line:

```
- [ ] <tier> (<module>): <one-line flow gap>. Fix: <recommendation>. Source: flow-audit <date>.
```

Output as a fenced block. **Do NOT write to CLAUDE.md.**

### Step 8 — Stop, await direction

```
Flow audit complete.
Findings:  .lattice/findings/open/
Verdicts:  <n> CRITICAL, <n> HIGH, <n> MEDIUM, <n> LOW, <n> OK

Inspect: lattice list --module <module> --dimension flow | lattice show <id>
Sync CLAUDE.md checklist: lattice sync

[drafted checklist block]

Reply 'fix <id>' / 'fix all critical' / 'apply checklist' / 'discuss'.
```

## Anti-patterns (refuse)

| ❌ | Why |
|---|---|
| Verdict without `file:line` | Mandatory evidence |
| Flagging without surrounding context | False positives in tests/, mocks, one-shot ops |
| CRITICAL without flow impact + example failure | Required fields |
| Auto-applying flow fixes | Need design discussion — wrong fix changes UX |
| Treating documented intentional gaps as CRITICAL | TTD/CLAUDE.md citation wins over default |

## Tool usage

| Tool | Used for |
|---|---|
| Grep | Pattern hunting (never Bash grep) |
| Read | Context for every hit + CLAUDE.md/TTD/flow diagram first |
| Glob | Enumerate handlers, services, state stores |
| Bash | Only `git log` when checking when a flow gap was introduced |
| Write | Only findings YAML in `.lattice/findings/` |

## Output discipline

- No preamble. Start with "Flow-auditing <module-path>..." or "Flow-auditing scope: <paths>..."
- One status line per pattern hunt
- Final output = findings path + verdict counts + drafted checklist + next-action prompt

---

After running: `lattice list` / `lattice triage` / `lattice sync` to manage findings.
