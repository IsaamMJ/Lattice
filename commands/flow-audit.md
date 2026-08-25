---
description: Audit a module for flow completeness against the rule pack its stack actually needs — CRUD/RBAC scoping, UI-vs-server permission parity, state-machine ordering and route states for server-rendered SaaS; happy path, error handling, abandonment and multi-turn context for conversational apps. Use when the user asks "where does this flow break?", wants to find dead-ends or drop-off causes, invokes `/flow-audit <module>`, or mentions customer journey / state machine / role-based access / conversation flow concerns.
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

Auditing for **flow completeness** — patterns that leave a user stuck, seeing data that isn't theirs, holding a control that doesn't work, or holding a record that cannot move.

## Why this skill exists

Code that "works in happy path" often has hidden gaps. They don't surface in unit tests — they surface when a real user says "I changed my mind" mid-flow, or when a department-scoped manager opens a report and sees the whole company.

## Rule packs (v2.8.0, #129 #135)

The gaps that matter depend on what kind of application this is. A conversational bot loses multi-turn context; a server-rendered CRUD app leaks scope across a relation hop. One fixed grid means the operator translates chatbot patterns into SaaS patterns by hand — which is the work this skill is supposed to do (#129).

So **Step 0 resolves the stack profile and selects the pack**:

| Pack | Fires when | Grid lives in |
|---|---|---|
| **A — conversational / multi-turn** | `app_type: conversational` (message handler, LLM turn loop, no route tree) | this file, "Risk patterns — Pack A" below |
| **B — CRUD + RBAC** | `app_type: crud-rbac` (server-rendered routes + role gates + scoped data layer) | [references/flow-audit-crud-rbac-rules.md](references/flow-audit-crud-rbac-rules.md) |

Packs **replace** each other; they do not stack. Running Pack A on a `crud-rbac` module is the #129 bug, not thoroughness. Detection procedure, precedence and the operator override live in [references/stack-profiles.md](references/stack-profiles.md) — the same resolution `/security-audit`, `/scale-audit` and `/audit-sweep` use (#135).

## Risk patterns — Pack A (conversational / multi-turn flows)

Loaded when the resolved profile is `conversational`. For `crud-rbac`, skip this whole section and use the Pack B grid instead.

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

### Step 0 — Resolve the stack profile, select the pack

Load [references/stack-profiles.md](references/stack-profiles.md) and run it before any hunt. It resolves seven fields from artifacts on disk — manifest, route tree, role declaration, schema FK graph, status enum — each with `file:line` evidence, and yields the derived sets the packs are defined over (`ROLES`, `SCOPE(M)`, the Server-Action set, `STATES(M)`).

| Outcome | Do |
|---|---|
| `app_type: crud-rbac` | Load Pack B ([references/flow-audit-crud-rbac-rules.md](references/flow-audit-crud-rbac-rules.md)). Run `lattice audit-core --rule missing-tenant-filter` first so Group A only files what the deterministic pass cannot see |
| `app_type: conversational` | Use the Pack A grid above |
| `worker-api` / `cli-tool` / `mobile-client` | Pack A's error-handling + state rows only; see the pack table in stack-profiles.md for the companion libraries |
| Nothing resolved, or `confidence: low` | **Ask once.** Do not default to Pack A because it used to be the only grid |

Print the profile banner before Step 1 — one line, no preamble:

```
Profile: crud-rbac / server-components+actions / clerk-org-roles / org > department > user (confidence: high) — pack: crud-rbac
```

Under `--scope`, resolve the profile **per path** — a SaaS with a support bot has both, and the pack follows the module, not the repo.

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

Pack B adds no separate mapping step — Step 0's probes already produced the route tree, action set, scope lattice and transition graph. Carry them forward; do not re-derive.

### Step 3 — Hunt patterns

Run targeted Grep for each pattern category. For each hit, **Read 20 lines of surrounding context** to filter false positives (test files, mocks, intentional one-shot operations).

**Dispatch prompt follows the pack** — Sonnet subagent dispatch saves ~60% of tokens either way:

| Pack | Prompt |
|---|---|
| A — conversational | [references/flow-audit-subagent-prompt.md](references/flow-audit-subagent-prompt.md) (10-pattern grid) |
| B — crud-rbac | [references/flow-audit-crud-rbac-subagent-prompt.md](references/flow-audit-crud-rbac-subagent-prompt.md) (19-pattern grid; embed the Step 0 derived sets in the brief) |

### Step 4 — Cross-check against TTD / design docs

If TTD/design doc says "intentional behavior" (e.g. "no exit path during payment confirmation — required by Razorpay"), downgrade tier or mark `OK` with citation.

### Step 5 — Assign verdicts

| Verdict | Means | Required evidence |
|---|---|---|
| **CRITICAL** | Breaks core flow — the journey cannot complete, or (Pack B) data crosses a scope boundary and a record cannot move | `file:line` + how the user experiences it + 1-sentence fix |
| **HIGH** | Causes drop-off or silent failure — the user abandons, or (Pack B) a role holds a control that doesn't work | `file:line` + impact + fix |
| **MEDIUM** | Fragile edge case; works most of the time | `file:line` + fix |
| **LOW** | Note in checklist | `file:line` |
| **OK** | Pattern checked, intentional/safe with citation | `file:line` + TTD/CLAUDE.md citation |

**Hard rule — every CRITICAL/HIGH gets:**

1. **Flow impact**: 1 sentence on how the user experiences the gap
2. **Example failure**: 1 sentence concrete scenario — Pack A: "user clicks 'No' at slot-selection step → bot says 'I don't understand' and loops". Pack B: name the role, the route and what they see ("department manager opens /reports → sees every department's rows")
3. **Recommended fix**: 1 sentence

**OK-finding discipline:** Emit `tier: OK` for patterns checked-and-found-safe (`OK-lumi-error-message-shown-to-user`, `OK-payments-abandonment-cleanup-cron`). First-class output — prevents re-flagging. Each OK requires `intentional_citation`.

### Step 6 — Write findings + manifest

Load [references/flow-audit-finding-schema.md](references/flow-audit-finding-schema.md) for exact YAML schema + required fields by tier. Pack B findings carry `rule_pack: crud-rbac`, and its Group A rules are filed as `dimension: security` — which brings the security required-field set with them.

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
Profile:   <app_type>/<auth_model>/<tenancy> (confidence: <c>) — pack: <A|B>
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
| Hunting a pack the profile didn't select | Pack A on a CRUD app is #129 — the operator pays in translation |
| Translating a pattern by analogy ("abandonment ≈ stale draft") | If it needs translating, it's the wrong pack. Re-resolve the profile |
| Skipping Step 0 because the repo "looks like" a SaaS | `app_type` comes from artifacts, never from the repo name or a directory called `chat/` |

## Tool usage

| Tool | Used for |
|---|---|
| Grep | Pattern hunting (never Bash grep) |
| Read | Context for every hit + CLAUDE.md/TTD/flow diagram first; Step 0 reads the manifest, schema and role declaration |
| Glob | Enumerate handlers, services, state stores; Step 0 route-tree probe |
| Bash | `git log` when checking when a flow gap was introduced; `lattice audit-core --rule missing-tenant-filter` as the Pack B precondition pass |
| Write | Only findings YAML in `.lattice/findings/` |

## Output discipline

- No preamble. Start with "Flow-auditing <module-path>..." or "Flow-auditing scope: <paths>..."
- One status line per pattern hunt
- Final output = findings path + verdict counts + drafted checklist + next-action prompt

---

After running: `lattice list` / `lattice next` / `lattice sync` to manage findings.
