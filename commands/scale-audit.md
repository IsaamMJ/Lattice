---
description: Audit a module for horizontal-scaling killers — in-memory state, setInterval crons, in-process rate limiters, singleton assumptions.
argument-hint: <module-path>
---

Target module to audit: $ARGUMENTS

# scale-audit

You are auditing one module for **horizontal-scaling risks** — patterns that work fine on one instance but break, degrade, or duplicate work when run on 2+ instances behind a load balancer.

## Why this skill exists

Code that "works in dev" often has hidden single-instance assumptions: in-memory rate limiters, `setInterval` jobs, singleton caches, file-system writes. These don't surface as bugs on one box. They surface as duplicate WhatsApp messages, double-charged users, and lost state the moment ops scales to 2 instances.

This skill finds those patterns *before* the scale-up, with file:line evidence per finding.

## Trigger

User invokes: `/scale-audit <module-path>` (e.g. `/scale-audit src/modules/lumi`)

## OMC fallback (works without oh-my-claudecode installed)

Lattice prefers to dispatch its heaviest step (pattern hunting + context reads) to a Sonnet sub-agent for cost. If `oh-my-claudecode:executor` is installed, it's used. If not, the same step runs inline in the main session — **same methodology, same verdict quality, just slightly more tokens**. No degraded mode, no missing features.

Detection: at Step 3, attempt the dispatch. On dispatch failure, continue inline with the same prompt body.

## Risk patterns to hunt

For each, the evidence is concrete: a `file:line` showing the pattern.

| Pattern | Why it breaks at scale |
|---|---|
| `setInterval` / `setTimeout` for periodic work | Every instance fires the job → duplicate sends, double-charge, race conditions |
| In-process `Map` / `Set` / `WeakMap` holding user/session/rate state | State diverges per instance; rate limits become per-instance not per-user |
| Local file writes (logs, cache, uploads) | Lost on instance death; not visible to other instances |
| `process.env`-keyed singletons holding mutable state | Same as above; survives only one process |
| WebSocket / SSE without sticky-session config | Reconnects land on wrong instance; subscriptions lost |
| In-memory cache without Redis/Valkey fallback | Cold-start on every new instance; cache stampede risk |
| Cron jobs not gated by leader-election or distributed lock | Same as `setInterval` |
| `setImmediate` / unbounded `Promise.all` over user data | Memory growth proportional to load, not bounded |
| Synchronous file or CPU work in request path | Blocks event loop; one instance falls over before LB notices |
| Race-prone read-modify-write on shared DB rows without `SELECT … FOR UPDATE` or optimistic lock | Concurrent instances corrupt state |
| Hardcoded `localhost` / single-host assumptions in service-to-service calls | Breaks on first deploy across hosts |
| Dedup keyed by in-memory set instead of DB unique constraint or Redis SET NX | Duplicates leak through on second instance |
| Background work started in module constructor / `OnModuleInit` without leader gating | Every instance runs the same background loop |

## Methodology

### Step 1 — Read living truth
1. Read `CLAUDE.md` — note any explicit "Already Built" or "do NOT migrate to BullMQ" type entries. Some single-instance choices are intentional and documented.
2. Read the module's TTD doc (if one exists) — note any Decisions citing scale tradeoffs.

### Step 2 — Map the module
List every `.ts` / `.js` file in `<module-path>`. For each, note its role (controller / service / job / guard / repository / etc.).

### Step 3 — Hunt each pattern (dispatched to subagent for cost)
This is the heaviest step (many greps + context reads). Dispatch to Sonnet subagent.

Dispatch `oh-my-claudecode:executor` (sonnet) with:
```
Hunt scale-killer patterns in module <module-path>. For each pattern below, run targeted Grep, then Read 20 lines of surrounding context for every hit (to filter false positives like test files, one-shot inits, CLI scripts).

Return a JSON array per hit:
  { pattern: "<name>", file: "<path>", line: <n>, context: "<surrounding 5 lines>", false_positive: true|false }

Patterns:
- setInterval|setTimeout (periodic work)
- new Map\(|new Set\(|new WeakMap\( (in-memory state)
- fs\.|writeFile|appendFile|createWriteStream (local file writes)
- WebSocket|EventSource|SSE (sticky-session needs)
- OnModuleInit|onApplicationBootstrap (boot-time background work)
- Promise\.all\(.*map\( (potential unbounded fan-out)
- localhost|127\.0\.0\.1 (host assumptions)

Mark false_positive=true for: test files (*.spec.ts, *.test.ts), CLI scripts, one-shot inits, anything inside try/catch where it's gracefully degraded.
```

Wait for the JSON response. Use it as input to Step 4+. Saves ~60% of scale-audit tokens.

Fallback: if executor unavailable, run the greps in the main session with the same methodology.

For each pattern in the table above, run a targeted `Grep` across the module:
- `setInterval|setTimeout` (periodic work)
- `new Map\(|new Set\(|new WeakMap\(` (in-memory state)
- `fs\.|writeFile|appendFile|createWriteStream` (local file writes)
- `WebSocket|EventSource|SSE` (sticky-session needs)
- `OnModuleInit|onApplicationBootstrap` (boot-time background work)
- `Promise\.all\(.*map\(` (potential unbounded fan-out)
- `localhost|127\.0\.0\.1` (host assumptions)

For each hit, **Read** the surrounding 20 lines to understand context — is it actually a scale risk, or is it test code / one-shot init / explicitly gated?

### Step 4 — Cross-check claims against TTD
If the module's TTD has a Decision saying "uses setInterval — do NOT migrate" (like Lumi), that's INTENTIONAL_SINGLE_INSTANCE. Don't flag it as a BLOCKER. Flag it as `WATCH` with a note: "intentional single-instance design — will need leader election or BullMQ migration before horizontal scaling."

### Step 5 — Assign verdicts

| Verdict | Means | Required evidence |
|---|---|---|
| **BLOCKER** | Definitely breaks or duplicates work on instance #2 | `file:line` showing the pattern + 1-sentence failure mode |
| **RISK** | Works now but degrades under load or grows unboundedly | `file:line` + load condition that would expose it |
| **WATCH** | Intentional single-instance choice, but documented somewhere | `file:line` + the CLAUDE.md / TTD line that justifies it |
| **OK** | Pattern checked, verified scale-safe (e.g. uses Redis, has DB unique constraint, gated by leader election) | `file:line` showing the safe implementation |

**Hard rule**: every BLOCKER and RISK gets a one-sentence **fix recommendation** (e.g. "move to BullMQ with `@nestjs/bull`", "back rate limiter with Valkey using `INCR` + `EXPIRE`", "wrap with `redlock` for distributed lock").

### Step 6 — Write findings (v0.6 YAML schema)

Emit **one YAML file per finding** to `.lattice/findings/open/<sweep-date>/<TIER>-<module-slug>-<rule-slug>.yml` per `docs/finding-schema.md`.

For scale dimension, `<rule-slug>` is a kebab-case pattern name: `setinterval-cron`, `in-memory-rate-limiter`, `local-file-write`, `unbounded-promise-all`, etc.

YAML body per finding (scale dimension):

```yaml
id: <12-char hash of rule + module + file + line>
rule: <kebab-case pattern slug>
dimension: scale
tier: BLOCKER | RISK | WATCH | OK
module: <module path>
file: <path>
line: <integer>
title: <one-line risk summary>
fix: <one-sentence recommended migration>
sweep_date: <YYYY-MM-DD>
sweep_id: <12-char hex>
auditor: claude-code/scale-audit
# Required if tier in [BLOCKER, RISK]:
failure_mode: <one sentence — what breaks at instance #2>
# Required if tier=WATCH:
intentional_citation: <CLAUDE.md:line or TTD:line that justifies the single-instance choice>
notes: <only if needed>
```

Skip the legacy multi-finding markdown file. The CLAUDE.md pre-scale checklist is regenerated from these YAML files by `scripts/lattice-regenerate.sh` at end of sweep.

### Step 7 — Draft checklist entries for deferred items
For every **WATCH** and every **RISK that won't be fixed today**, draft a checklist line ready to paste into `CLAUDE.md` "Pre-scale checklist" section. Format:

```
- [ ] <verdict> (<module>): <one-line risk summary>. Fix: <recommended fix>. <Trigger condition or "Only actionable once …">. Source: scale-audit <date>.
```

Output these **as a fenced block** the user can copy. Do NOT write to CLAUDE.md or commit anything yourself — the user reviews the wording first, then pastes into their session to apply.

### Step 8 — Stop and wait
Output the findings file path + the verdict counts + the drafted checklist block. Tell the user:

```
Scale audit complete. Findings: .lattice/findings/scale-<module>-<timestamp>.md
BLOCKERs: <n>. RISKs: <n>. WATCHes: <n>.

Drafted checklist entries (review wording, then paste into your session to apply):

[fenced block of checklist lines]

Reply 'fix <id>' to address one finding, 'fix all blockers' to triage them in order, 'apply checklist' to add the drafted lines to CLAUDE.md and commit, or 'discuss' to review tradeoffs first.
```

## Anti-patterns (refuse to do these)

- ❌ Verdict without `file:line`
- ❌ Flagging a pattern without reading surrounding context (test files, one-shot inits, CLI scripts get false-positive otherwise)
- ❌ Calling something a BLOCKER without a 1-sentence failure mode
- ❌ Auto-applying fixes — scale fixes are architectural, must be discussed
- ❌ Treating intentional single-instance designs (CLAUDE.md "do NOT migrate") as BLOCKERs

## Tool usage

- **Grep**: pattern hunting across the module (never Bash grep — Windows path issues)
- **Read**: context for every grep hit before assigning a verdict
- **Glob**: enumerate files in the module
- **Bash**: only for `git log` if checking when a risky pattern was introduced
- **Write**: only for the findings file in `.lattice/findings/`

## Output discipline

- No preamble. Start with "Scale-auditing <module-path>..."
- One status line per pattern hunt ("setInterval: 1 hit, reading context...")
- Final output = findings file path + verdict counts + next-action prompt
