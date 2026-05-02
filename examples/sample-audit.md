# Audit: docs/ttd/08-module-lumi.md
date: 2026-05-01T01:59:13Z
auditor: claude-code/audit-doc
living-truth-sources:
  - CLAUDE.md (Drift Audit Log row 2026-04-29 — Lumi rewrite; commits f23e3d9, 359045b, f7801ee)
  - CLAUDE.md (Module Rules — rule 4: only whatsapp/ calls graph.facebook.com)
  - prisma/schema.prisma (lumi_memory, lumi_conversations models)

## Summary
- OK: 7
- DRIFT: 13
- INTENTIONAL: 6
- UNVERIFIABLE: 4

## Findings

### [INTENTIONAL] flows/ subtree absent
- **claim**: doc §3 lists `flows/booking.flow.ts`, `flows/cancellation.flow.ts`, `flows/payment.flow.ts`
- **evidence**: `Glob src/modules/lumi/flows/**` returns no matches; CLAUDE.md drift log row 2026-04-29 cites commits `f23e3d9`, `359045b`, `f7801ee` deleting these files; reason: "architecture pivoted from explicit per-flow state machines to LLM tool-calling"
- **action**: NO_ACTION (downstream: doc rewrite will drop §3 references and add NEVER constraint)
- **notes**: This is the canonical case the methodology exists to catch. Without git log + CLAUDE.md cross-reference, this would have been flagged DRIFT and a rebuild proposed.

### [DRIFT] Tool count claim is stale
- **claim**: doc §6 lists 12 LLM tools in `agent/tools.ts`
- **evidence**: `agent/tools.ts:3` defines `LUMI_TOOLS` with 16 entries; `Grep "name: '" agent/tools.ts` returns 16 matches
- **action**: PATCH_DOC — update §6 to "16 tools" with the full list

### [OK] MAX_HISTORY constant matches doc claim
- **claim**: doc §4 states "MAX_HISTORY = 20 messages"
- **evidence**: `agent/lumi-agent.service.ts:15` — `const MAX_HISTORY = 20;`
- **action**: NO_ACTION

### [UNVERIFIABLE] Pre-send safety guardrail existence
- **claim**: doc §15 promises "blacklist regex / dosage pattern replacement before WhatsApp send"
- **evidence**: `Grep "blacklist|dosage" src/modules/lumi/` returns matches only inside the system-prompt string; no pre-send filter wraps `WhatsAppService.sendText`. `LlmJudgeService` is async post-hoc, not pre-send.
- **action**: NEEDS_HUMAN
- **notes**: Either (a) the filter was deferred and the doc claim is aspirational, or (b) it was deprioritized and should be removed from the doc. Neither commit history nor CLAUDE.md mentions the decision.

---

## Telemetry

### Model used for this run
- Session model: opus-4.7

### Step-level fit
| Step | Felt | Why |
|---|---|---|
| 1 read CLAUDE.md | overkill | small read, haiku would suffice |
| 2 read doc + revision history | right | needs comprehension |
| 3 extract claims | right | judgment-light parsing |
| 4 verify claims | right (after dispatch) | dispatched to executor — the right call |
| 5 git log check | overkill | small bash output |
| 6 tracer dispatch | not used | no ambiguous calls this run |
| 7 assign verdicts | right | needs cross-source synthesis |
| 9 contract rewrite | right | benefits from opus reasoning |

### Token-heavy steps
- Step 4 (verify claims): ~54k tokens — correctly dispatched to Sonnet executor
- Step 9 (rewrite): ~20k tokens — kept in main session

### Recommended routing for next doc
- Steps 1, 2, 5: run from any model (small reads)
- Step 4: dispatch to executor (Sonnet) — confirmed correct
- Steps 7, 9: main session (Opus or Sonnet acceptable)
