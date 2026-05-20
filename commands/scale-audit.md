---
description: Audit a module for horizontal-scaling killers — in-memory state, setInterval crons, in-process rate limiters, singleton assumptions. Use when the user wants to check scale safety, asks "will this scale?", invokes `/scale-audit <module>`, or mentions horizontal-scaling risks.
argument-hint: <module-path>
allowed-tools: Read Grep Glob Bash
---

Target module to audit: $ARGUMENTS

## Live Lattice state (auto-injected at invocation)

!`lattice context 2>/dev/null || echo "(lattice context unavailable)"`

# scale-audit

Auditing for **horizontal-scaling risks** — patterns that work on one instance but break/degrade/duplicate work when run on 2+ instances behind a load balancer.

## Why this skill exists

Code that "works in dev" often has hidden single-instance assumptions: in-memory rate limiters, `setInterval` jobs, singleton caches, file-system writes. They surface as duplicate WhatsApp messages, double-charged users, lost state — the moment ops scales to 2 instances. This skill finds those patterns *before* the scale-up, with `file:line` evidence.

## Risk patterns

| Pattern | Why it breaks at scale |
|---|---|
| `setInterval` / `setTimeout` for periodic work | Every instance fires the job → duplicate sends, double-charge, race conditions |
| In-process `Map` / `Set` / `WeakMap` for user/session/rate state | State diverges per instance; rate limits become per-instance not per-user |
| Local file writes (logs, cache, uploads) | Lost on instance death; not visible to other instances |
| `process.env`-keyed singletons holding mutable state | Survives only one process |
| WebSocket / SSE without sticky-session config | Reconnects land on wrong instance; subscriptions lost |
| In-memory cache without Redis/Valkey fallback | Cold-start on every new instance; cache stampede risk |
| Cron jobs not gated by leader-election or distributed lock | Same as `setInterval` |
| `setImmediate` / unbounded `Promise.all` over user data | Memory growth proportional to load |
| Synchronous file or CPU work in request path | Blocks event loop; one instance falls over before LB notices |
| Race-prone read-modify-write without `SELECT … FOR UPDATE` / optimistic lock | Concurrent instances corrupt state |
| Hardcoded `localhost` in service-to-service calls | Breaks on first deploy across hosts |
| Dedup keyed by in-memory set instead of DB unique constraint or Redis SET NX | Duplicates leak through on second instance |
| Background work started in `OnModuleInit` without leader gating | Every instance runs the same background loop |

## Methodology

### Step 1 — Read living truth

| Source | Why |
|---|---|
| `CLAUDE.md` | Note "Already Built" or "do NOT migrate to BullMQ" entries — some single-instance choices are intentional and documented |
| Module's TTD doc (if exists) | Decisions citing scale tradeoffs |

### Step 2 — Map the module

List every `.ts`/`.js`/`.py` (whatever language) in `$ARGUMENTS`. For each, note its role (controller / service / job / guard / repository / etc.).

### Step 3 — Hunt patterns

Run targeted Grep for each pattern in the table above. For each hit, **Read 20 lines of surrounding context** to filter false positives:
- Test files (`*.spec.ts`, `*.test.ts`)
- CLI scripts
- One-shot inits
- Anything inside try/catch that gracefully degrades
- Anything gated by leader election or distributed lock

**When N>=5 patterns to hunt** (the standard scale-audit grid): load [references/scale-audit-subagent-prompt.md](references/scale-audit-subagent-prompt.md) for the Sonnet subagent dispatch. ~60% token savings on this step.

### Step 4 — Cross-check claims against TTD

If TTD has a Decision saying "uses setInterval — do NOT migrate" (like Lumi), that's INTENTIONAL_SINGLE_INSTANCE. Don't flag as BLOCKER. Flag as `WATCH` with note: "intentional single-instance design — will need leader election or BullMQ migration before horizontal scaling."

### Step 5 — Assign verdicts

| Verdict | Means | Required evidence |
|---|---|---|
| **BLOCKER** | Definitely breaks or duplicates work on instance #2 | `file:line` + 1-sentence failure mode |
| **RISK** | Works now but degrades under load or grows unboundedly | `file:line` + load condition that exposes it |
| **WATCH** | Intentional single-instance choice, documented somewhere | `file:line` + CLAUDE.md/TTD line that justifies it |
| **OK** | Pattern checked, verified scale-safe (uses Redis, DB unique constraint, leader-gated) | `file:line` showing the safe implementation |

**Hard rules:**
- Every BLOCKER and RISK gets a one-sentence fix recommendation
- Every WATCH cites the CLAUDE.md/TTD line that justifies the single-instance choice
- Every OK is first-class output (`tier: OK` with `intentional_citation: <file:line>`) — prevents future audits from re-raising the same patterns

### Step 6 — Write findings + manifest

Load [references/scale-audit-finding-schema.md](references/scale-audit-finding-schema.md) for the exact YAML schema + common fix recommendations.

**sweep_id sourcing:**
- Invoked from `/audit-sweep` → use the sweep_id passed through
- Standalone → generate via `lattice sweep-id` and write a manifest

### Step 7 — Draft checklist for deferred items

For every **WATCH** and every **RISK that won't be fixed today**, draft a checklist line ready to paste into `CLAUDE.md`:

```
- [ ] <verdict> (<module>): <one-line risk summary>. Fix: <recommended fix>. <Trigger condition or "Only actionable once …">. Source: scale-audit <date>.
```

Output as a fenced block the user can copy. **Do NOT write to CLAUDE.md or commit yourself** — user reviews wording first.

### Step 8 — Stop, await direction

Output findings path + verdict counts + drafted checklist. Tell the user:

```
Scale audit complete.
Findings:  .lattice/findings/open/
Verdicts:  <n> BLOCKER, <n> RISK, <n> WATCH, <n> OK

Inspect: lattice list --module <module> --dimension scale | lattice show <id>
Sync CLAUDE.md checklist: lattice sync

Drafted checklist entries (review wording, then paste to apply):

[fenced block]

Reply 'fix <id>' / 'fix all blockers' / 'apply checklist' / 'discuss'.
```

## Anti-patterns (refuse)

| ❌ | Why |
|---|---|
| Verdict without `file:line` | Mandatory evidence |
| Flagging a pattern without reading surrounding context | False positives (test files, one-shot inits, CLI scripts) erode trust |
| BLOCKER without a 1-sentence failure mode | Required field per schema |
| Auto-applying fixes | Scale fixes are architectural — must be discussed |
| Treating intentional single-instance designs as BLOCKERs | CLAUDE.md "do NOT migrate" wins over default-BLOCKER |

## Tool usage

| Tool | Used for |
|---|---|
| Grep | Pattern hunting (never Bash grep — Windows path issues) |
| Read | Surrounding context for every hit before verdict |
| Glob | Enumerate files in the module |
| Bash | Only `git log` when checking when a risky pattern was introduced |
| Write | Only findings YAML in `.lattice/findings/` |

## Output discipline

- No preamble. Start with "Scale-auditing <module-path>..."
- One status line per pattern hunt ("setInterval: 1 hit, reading context...")
- Final output = findings path + verdict counts + next-action prompt

---

After running: `lattice list` / `lattice next` / `lattice sync` to manage findings.
