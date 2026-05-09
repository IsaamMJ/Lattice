---
description: Audit a module for customer flow completeness — happy path, error handling, edge cases, state transitions, abandonment, notifications. Targets conversational AI and request-response flows.
argument-hint: <module-path> | --scope <path1>,<path2>,...
---

Target module(s) to audit: $ARGUMENTS

## Argument parsing (do this FIRST)

Split `$ARGUMENTS` on whitespace. Two supported forms:

| Form | Means |
|---|---|
| `/flow-audit <module-path>` | Single-module mode — audit one module end-to-end. |
| `/flow-audit --scope <path1>,<path2>,...` | Multi-module flow mode (v0.6.7+) — audit a flow that spans multiple modules (e.g. `thyrocare,booking,payments,lumi`). All paths share one sweep_id; findings reference each module by its actual `module:` path. |

If `--scope` is given, treat the comma-separated paths as the audit scope and skip per-module dispatch (the flow IS the unit; it crosses module boundaries by design).

# flow-audit

You are auditing one module for **customer flow completeness** — patterns that cause customers to get stuck, lose context, or abandon the interaction when they encounter errors, unexpected inputs, or state transitions.

## Why this skill exists

Code that "works in happy path" often has hidden gaps: no exit on "no", no handling for image-when-text-only, abandoned conversations never cleaned up, state changes silent to the user. These don't surface in unit tests. They surface when a real user says "I changed my mind" mid-flow and hits a dead end, or a bot doesn't respond for 5 minutes because the state got corrupted.

For conversational AI and multi-step request flows, this skill finds those gaps *before* they cause user drop-off, with file:line evidence per finding.

## Trigger

User invokes: `/flow-audit <module-path>` (e.g. `/flow-audit src/modules/lumi`)

## OMC fallback (works without oh-my-claudecode installed)

Lattice prefers to dispatch its heaviest step (pattern hunting + context reads) to a Sonnet sub-agent for cost. If `oh-my-claudecode:executor` is installed, it's used. If not, the same step runs inline in the main session — **same methodology, same verdict quality, just slightly more tokens**. No degraded mode, no missing features.

Detection: at Step 3, attempt the dispatch. On dispatch failure, continue inline with the same prompt body.

## Risk patterns to hunt

For each, evidence is concrete: a `file:line` showing the gap.

### CRITICAL — fix today (breaks core flow)

| Pattern | Why it breaks |
|---|---|
| Happy path (main request → response) missing, incomplete, or untested | Customer initiates; nothing happens or hangs |
| No error handling on external call (API, LLM, DB query) | One API timeout crashes the entire flow |
| State transition unvalidated (e.g., can skip from step 1 to step 3) | Customer gets into invalid state; flow corrupts |
| User input type not checked (e.g., accepts image when expecting text) | LLM receives wrong type; response is garbage or crashes |
| No exit path / cancel button / "change my mind" option at critical steps | Customer gets trapped; force-abandon |

### HIGH — fix this week (causes drop-off)

| Pattern | Why it matters |
|---|---|
| Abandonment timeout not set (conversation waits forever if customer pauses) | Silent drop-off; customer thinks bot is broken |
| Abandoned conversation state never cleaned up | Database bloat; stale rows leak memory or lock resources |
| Error message not shown to customer (error logged but customer sees nothing) | Customer doesn't know what went wrong; assumes it's broken |
| State change not acknowledged to customer (status updates silent) | Customer doesn't know if action took effect |
| Multi-turn context lost mid-flow (previous message not in scope for next step) | Bot forgets what customer asked; asks same thing again |
| No validation on state preconditions (e.g., can't proceed without field X) | Flow advances with missing data; downstream fails |

### MEDIUM — fix when convenient (fragile edge cases)

| Pattern | Why it matters |
|---|---|
| Boundary condition unchecked (empty list, max size, timeout value) | Works until someone hits the edge |
| Race condition on state writes (concurrent requests corrupt state) | Rare in dev, common at scale |
| Notification system not integrated (state changes not broadcast to external systems) | Internal inconsistency; systems diverge |
| No dedup on idempotent operations (customer retries, action duplicates) | Double-charge, double-message, inconsistent state |
| Hardcoded flow paths (cannot handle variation in customer input) | Flow breaks on unexpected but valid input |

### LOW — note in checklist

| Pattern | Why it matters |
|---|---|
| Flow logs missing or insufficient (cannot reconstruct customer journey on error) | Debugging gaps |
| No test coverage for error paths | Coverage looks good, reality is fragile |

## Tool usage

- **Grep**: pattern hunting for handler paths, error catches, state transitions, exits, timeouts, cleanup, notifications, context usage, concurrency primitives (never Bash grep — Windows path issues)
- **Read**: context for every hit before assigning a verdict; load CLAUDE.md / TTD / flow diagram first
- **Glob**: enumerate handlers, services, state stores in the module
- **Bash**: only for `git log` if checking when a flow gap was introduced
- **Write**: only for the findings file in `.lattice/findings/open/<sweep-date>/`

## Methodology

### Step 1 — Load living truth

1. Read `CLAUDE.md` — note the flow stage (alpha/beta/live), known limitations, intentional design constraints.
2. Read the module's TTD doc (if one exists) — note the flow diagram, state machine, intended happy path.
3. Look for `examples/` flows or README describing the customer journey.

### Step 2 — Map the flow

Identify the flow structure:
- What's the entry point? (API endpoint, message handler, etc.)
- What are the happy-path steps? (Step 1 → Step 2 → Step 3 → complete)
- What are the exit points? (success, cancel, error, timeout)
- What state does the flow maintain? (conversation, session, request, etc.)
- Who/what gets notified when state changes? (user, internal systems, etc.)

### Step 3 — Hunt patterns (dispatched to subagent for cost)

This is the heaviest step. Dispatch to Sonnet subagent.

Dispatch `oh-my-claudecode:executor` (sonnet) with:
```
Audit customer flow completeness in module <module-path>. For each pattern below, run targeted Grep or Read, then check context to filter false positives.

Return a JSON array per hit:
  { pattern: "<name>", tier: "CRITICAL"|"HIGH"|"MEDIUM"|"LOW", file: "<path>", line: <n>, context: "<surrounding 5 lines>", gap_description: "<what's missing>", false_positive: true|false }

Patterns to hunt:
1. Happy path: grep for the main request handler + response. Does it have a complete path (entry → processing → response)? Check if all steps are tested.
2. Error handling: grep for try/catch, .catch, error middleware. For each external call (API, LLM, DB), is the error caught and handled?
3. State validation: grep for state transitions, status changes, step progression. Are transitions validated? Can you skip steps?
4. Type checking: grep for typeof, instanceof, schema validation. Does input type match expectations (text vs image, etc.)?
5. Exit paths: grep for cancel, abort, exit, close operations. Is there a way to exit at each step, or are some steps trapped?
6. Abandonment timeout: grep for setTimeout, TTL, timeout, expiry. Is there a timeout on idle conversations?
7. Cleanup: grep for delete, cleanup, expire, prune. Are abandoned/stale sessions cleaned up?
8. State notifications: grep for emit, publish, broadcast, notify. When state changes, is the customer/system notified?
9. Multi-turn context: grep for context, history, memory, previous. Is the customer's context preserved across turns?
10. Concurrency: grep for race, concurrent, parallel, atomic. Are state writes protected against concurrent requests?

Mark false_positive=true for: test files (*.spec.ts, *.test.ts), mocks, intentional one-shot operations.
```

Wait for the JSON response. Use it as input to Step 4+.

Fallback: if executor unavailable, run the greps in the main session with the same methodology.

### Step 4 — Cross-check against TTD / design docs

For each hit, check whether the TTD or CLAUDE.md already documents it as intentional or deferred. Examples:
- "Lumi onboarding doesn't support image input yet" (documented as alpha feature) → HIGH "type checking not implemented", but NOT CRITICAL
- "We accept double-messages at scale; dedup via Valkey when we add it" (documented as known limitation) → MEDIUM "no dedup", with citation
- "Abandonment timeout will be added in v0.2" (documented in roadmap) → HIGH "not yet implemented", but timeline known

If documented intentional/deferred, note the citation and adjust tier accordingly.

**TTD-silent rule (v0.6.7+):** If the TTD is silent on an implementation detail (e.g. "what should `ACTIVE_STATUSES` contain" is not documented), **treat the code as ground truth.** Do NOT flag this as a flow finding. If the gap is non-obvious (a reader of the TTD would assume different behavior), emit a separate `dimension: audit, tier: UNVERIFIABLE` finding noting "TTD does not specify X; code does Y" — that's a coverage gap, not a flow defect.

**DRIFT auto-emit (v0.6.7+):** If during cross-check you find an **explicit contradiction** between the TTD and code that grep can verify both sides of (e.g. TTD says "uses fast-xml-parser with ignoreAttributes:false" but `xml-parser.service.ts` is hand-rolled regex), emit an additional `dimension: audit, tier: DRIFT` finding alongside any flow finding. **Conservative threshold:**
- DO emit DRIFT for present-tense factual claims that the code falsifies.
- DO NOT emit DRIFT for grep-misses on TTD claims phrased as `will`, `Phase N`, `future`, `deferred`, `roadmap` — those are aspirational, not drift.
- DO NOT emit DRIFT for "TTD silent on Z" — that's UNVERIFIABLE per the rule above, not DRIFT.

False positives erode trust faster than missed drift catches. When in doubt: UNVERIFIABLE, not DRIFT.

### Step 5 — Assign verdicts

| Verdict | Means | Required evidence |
|---|---|---|
| **CRITICAL** | Breaks the happy path or traps the customer, fix immediately | `file:line` showing the gap + how it breaks + fix |
| **HIGH** | Causes customer drop-off or silent failures, fix this week | `file:line` + the problem scenario + fix |
| **MEDIUM** | Edge case fragility or operational gap, fix when convenient | `file:line` + the boundary condition or race scenario |
| **LOW** | Observability or test coverage gap, note in checklist | `file:line` |
| **OK** | Pattern checked, intentional/documented (with citation) | `file:line` + the TTD/CLAUDE.md line that justifies it |

**Hard rule**: every CRITICAL and HIGH gets a one-sentence **fix recommendation** (e.g. "add timeout handler with 5-minute idle timeout", "validate state transitions in middleware before processing request", "broadcast state changes via WebSocket/event bus").

**OK-finding discipline (v0.6.7+):** Every flow audit MUST emit at least one `tier: OK` finding per major flow stage that was checked-and-found-clean. These are first-class output: knowing what was verified-clean changes how readers triage the rest. Examples: `OK-payments-credit-pack-branch-clean`, `OK-payments-dedup-key-stable`, `OK-lumi-consent-step-complete`. Each requires `intentional_citation` per the schema.

### Step 6 — Write findings (v0.6 YAML schema)

Emit **one YAML file per finding** to `.lattice/findings/open/<sweep-date>/<TIER>-<module-slug>-<rule-slug>.yml` per `docs/finding-schema.md`.

For flow dimension, `<rule-slug>` is a kebab-case pattern name: `happy-path-incomplete`, `error-handling-missing`, `state-validation-gap`, `type-checking-missing`, `no-exit-path`, `no-abandonment-timeout`, `no-cleanup`, `state-change-silent`, `context-loss`, `race-condition-on-state`, etc.

YAML body per finding (flow dimension):

```yaml
id: <12-char hash of rule + module + file + line>
rule: <kebab-case pattern slug>
dimension: flow
tier: CRITICAL | HIGH | MEDIUM | LOW | OK
module: <module path>
file: <path>
line: <integer>
title: <one-line gap summary>
fix: <one-sentence recommended fix>
sweep_date: <YYYY-MM-DD>
sweep_id: <12-char hex>
auditor: claude-code/flow-audit
status: open
# Required if tier in [CRITICAL, HIGH]:
impact: <one sentence — how this breaks the customer experience>
# Required if tier=OK:
intentional_citation: <TTD:line or CLAUDE.md:line that documents it as intentional/deferred>
# v0.6.4 — acceptance criteria. Highest leverage on flow dimension.
tests:
  - "<scenario> → <expected outcome>"
  - "<edge case> → <expected outcome>"
# v0.6.4 — mechanical reproducers (when applicable; admin tools, curl, simulated input).
simulate:
  - "<command or simulated input that triggers the gap>"
notes: <only if needed>
```

Skip the legacy multi-finding markdown file. The CLAUDE.md pre-launch checklist is regenerated from these YAML files by `lattice sync` at end of sweep.

**sweep_id sourcing:** if invoked from `/audit-sweep` with `flow` in scope, use the sweep_id passed through from the orchestrator. Standalone (`/flow-audit src/modules/lumi`) generates its own via `lattice sweep-id` and writes a manifest in Step 6b.

### Step 6b — Write sweep manifest (v0.6.7+)

After all findings are written, emit the sweep manifest to `.lattice/findings/sweeps/<sweep_id>.yml` per the schema in `docs/finding-schema.md`. Required fields:

```yaml
sweep_id: <id>
sweep_date: <YYYY-MM-DD>
project_root: <root>
modules_audited: [<module>, ...]      # for --scope mode, all paths from the scope arg
dimensions: [flow]                      # plus [audit] if any DRIFT/UNVERIFIABLE were emitted
mode: SEQUENTIAL
auditor: claude-code/flow-audit
auditor_model: <opus|sonnet|haiku>
duration_ms: <int>
totals: { CRITICAL: n, HIGH: n, MEDIUM: n, LOW: n, OK: n, DRIFT: n, UNVERIFIABLE: n }
opened: [<slug>, ...]
unchanged: [<slug>, ...]
closed_since_last: [<slug>, ...]
regressed: [<slug>, ...]
skipped: <int>                          # files in open/ that failed to parse during this run
runtime_warnings:
  - "<TTD-silent notes from Step 4, threshold-edge calls, etc.>"
```

If invoked from `/audit-sweep`, **do not** write a separate manifest — the orchestrator writes the unified one.

### Step 7 — Draft checklist entries for deferred items

For every **OK** (documented as intentional/deferred) and every **HIGH/MEDIUM that won't be fixed today**, draft a checklist line ready to paste into `CLAUDE.md` "Flow completeness" section. Format:

```
- [ ] <verdict> (<module>): <one-line gap summary>. Fix: <recommended fix>. <Reason or "Deferred to v0.2">. Source: flow-audit <date>.
```

Output these **as a fenced block** the user can copy. Do NOT write to CLAUDE.md or commit anything yourself — the user reviews the wording first, then pastes into their session to apply.

### Step 8 — Stop and wait

Output the YAML directory path + the manifest path + the verdict counts + the drafted checklist block. Tell the user:

```
✅ Flow audit complete: <module-path or scope>

Findings:  .lattice/findings/open/<sweep_date>/
Manifest:  .lattice/findings/sweeps/<sweep_id>.yml
Verdicts:  <N> CRITICAL, <N> HIGH, <N> MEDIUM, <N> LOW, <N> OK
Cross-cut: <N> dimension: audit findings (DRIFT/UNVERIFIABLE) emitted from Step 4
Skipped:   <N> (files that failed to parse — see manifest)

Inspect: lattice list --module <module> | lattice show <id> | lattice triage
Sync the CLAUDE.md checklist: lattice sync

Deferred/Documented items (paste into CLAUDE.md if you agree):
<checklist block>
```

---

## What Good Findings Look Like (Examples)

### CRITICAL: Happy path untested
```yaml
rule: happy-path-incomplete
tier: CRITICAL
file: src/modules/lumi/handlers/onboarding.ts
line: 42
title: "Onboarding happy path missing consent step; test coverage incomplete"
fix: "Add handler for consent response; implement test case: user accepts → flow continues"
impact: "Customer reaches 'continue' button, nothing happens; forced to abandon"
tests:
  - "First-time user sends 'hi' → consent message appears before any profile question"
  - "User sends 'yes' to consent → flow advances to profile setup"
  - "User who already consented → consent step skipped on return message"
simulate:
  - "Send WhatsApp message 'hi' from a fresh test number"
  - "Admin tool: reset_user --phone +91XXX && send 'hi'"
```

### HIGH: No error handling
```yaml
rule: error-handling-missing
tier: HIGH
file: src/modules/lumi/services/llm-client.ts
line: 156
title: "LLM API call has no timeout or error handler; hangs on network failure"
fix: "Wrap LLM call in timeout (30s) + catch + fallback message: 'Still thinking...' then retry or offer exit"
impact: "Customer message sent, bot doesn't respond for 5 minutes; customer abandons"
```

### HIGH: No abandonment timeout
```yaml
rule: no-abandonment-timeout
tier: HIGH
file: src/modules/lumi/session/conversation.ts
line: 78
title: "Conversation waits indefinitely for customer response; no idle timeout"
fix: "Add 5-minute idle timeout; emit 'abandoned' event and clean up session on timeout"
impact: "Customer walks away mid-flow; conversation hangs forever; database fills with stale rows"
```

### MEDIUM: Race condition on state writes
```yaml
rule: race-condition-on-state
tier: MEDIUM
file: src/modules/lumi/state/session-store.ts
line: 203
title: "Concurrent requests can update session state without locking; state corruption on retries"
fix: "Use optimistic lock (version field) or DB transaction to ensure atomic state updates"
impact: "Rare in dev, but at scale: 2 requests update session simultaneously; final state is corrupt"
```

---

## Integration with Lattice

Flow audit is a **new dimension** (flow) complementing existing audit (docs), scale (horizontal scaling), and security (auth/injection).

- `/flow-audit` is a standalone command, like `/security-audit` and `/scale-audit`
- Findings use `dimension: flow` and can be mixed into `/audit-sweep` output
- Flow dimension covers: happy path, error handling, state transitions, edge cases, abandonment, notifications
- Does NOT cover: performance (use `/perf-audit`), observability (use `/ops-audit`), code-doc drift (use `/audit`)

---

## Sources & Best Practices

- [Happy Path Testing Best Practices](https://aqua-cloud.io/happy-path-testing/) — Testing order (happy path first)
- [Real-World Happy Path and Sad Path Testing Guide](https://qajourney.net/real-world-happy-sad-path-testing-guide/) — Distinction between paths
- [What Is Edge Case Testing and Why AI Call Centers Fail Without It](https://www.bland.ai/blogs/edge-case-testing) — Importance of edge cases in conversational AI
- [Enhancing Multi-Turn Conversations: Ensuring AI Agents Provide Accurate Responses](https://www.getmaxim.ai/articles/enhancing-multi-turn-conversations-ensuring-ai-agents-provide-accurate-responses/) — Context consistency
- [What Causes Chatbot Drop-Off and How to Fix It](https://velaro.com/blog/chatbot-abandonment-reasons-and-solutions) — Timeout handling and abandonment signals
- [State Management for Conversational AI: Fixing Context Loss](https://www.linkedin.com/posts/aditya-santhanam_conversational-ai-forgets-users-expect-activity-7433473499358380032-eTul) — State preservation across turns
