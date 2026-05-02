# Sample contract — Module TTD

This is what `/audit` rewrites a stale long-prose doc into. Redacted from a real Lumi audit run on 2026-05-01.

---

# Project — Module TTD: Lumi (WhatsApp AI Agent)

**Document:** 08-module-lumi.md
**Version:** 2.0
**Date:** 2026-05-01
**Status:** ACTIVE
**Audited:** 2026-05-01 against `src/modules/lumi/` (findings: `.lattice/findings/audit-08-module-lumi-20260501-015913.md`)
**Depends on:** 00-master-architecture-v2.md, 03-module-booking.md, 04-module-whatsapp.md, 05-module-payments.md, 12-rag-pipeline.md
**PRD Sections:** 11 (Phase 1), 8 (AI Suggestion Engine)

---

## Module: Lumi (WhatsApp AI Agent)
file: `src/modules/lumi/`
entry: `lumi.module.ts`
status: ACTIVE

## Context

Lumi is the only user-facing surface — WhatsApp is the entire product UX (no mobile app). This module receives Meta Cloud API webhooks, runs an OpenAI tool-calling loop with persistent memory + Langfuse tracing, dispatches to other modules (booking, payments, credits, results, rag), and sends replies back via the WhatsApp module.

Architecture pivoted on 2026-04-29 from explicit per-flow state machines to LLM tool-calling; the legacy `flows/`, `classifier/`, `handlers/`, `router/` subtrees were deleted (CLAUDE.md drift log; commits f23e3d9, 359045b, f7801ee).

## Sub-modules
- `lumi.module.ts` — Nest wiring — `lumi.module.ts:1`
- `lumi-webhook.controller.ts` — webhook + upload handlers + per-phone rate limiter — `lumi-webhook.controller.ts:56`
- `whatsapp-signature.guard.ts` — `x-hub-signature-256` HMAC verification — `whatsapp-signature.guard.ts:37`
- `agent/lumi-agent.service.ts` — `runAgentLoop` (MAX_TOOL_ROUNDS=5, MAX_HISTORY=20) — `agent/lumi-agent.service.ts:104`
- `agent/tools.ts` — 16 LLM tool schemas (`LUMI_TOOLS`) — `agent/tools.ts:3`
- `agent/tool-executor.service.ts` — tool dispatcher
- `agent/llm-judge.service.ts` — async LLM-as-judge quality scoring (post-hoc, non-blocking)
- `memory/lumi-memory.service.ts` — top-N memory retrieval — `memory/lumi-memory.service.ts:27-28,135`
- `whatsapp/` — sole Meta Cloud API client (rule 4)
- `reminders/fasting-reminder.service.ts` — `setInterval` poll, idempotent via DB flag (do NOT migrate to BullMQ — CLAUDE.md "Already Built")

## Tables Owned

| Table | Status | Purpose |
|---|---|---|
| `lumi_memory` | active | Persistent user facts — `prisma/schema.prisma:353` |
| `lumi_conversations` | active | Inbound + outbound message log — `prisma/schema.prisma:369` |
| `lumi_flow_state` | dormant | Declared in schema, only purged by admin — see Unresolved |

## Contracts

- Webhook: `GET/POST /api/v1/webhooks/whatsapp` — `lumi-webhook.controller.ts:56`
- Signature: `x-hub-signature-256` HMAC-SHA256 of raw body, key = `WHATSAPP_APP_SECRET` — `whatsapp-signature.guard.ts:37`
- Agent entry: `LumiAgentService.handle(text, phone, wamid?, quotedMessage?) → AgentResult` — `agent/lumi-agent.service.ts:41`
- LLM provider: OpenAI SDK direct; model selected by `LUMI_MODEL` (default `gpt-4o`) — `agent/lumi-agent.service.ts:37-38`
- Tool catalog (16): `update_user_profile`, `check_pincode`, `get_available_slots`, `create_booking`, `get_user_bookings`, `cancel_booking`, `reschedule_booking`, `regenerate_payment_link`, `check_credit_balance`, `get_credit_packs`, `purchase_credits`, `search_health_knowledge`, `get_test_results`, `get_result_suggestions`, `regenerate_suggestions`, `escalate_to_human` — `agent/tools.ts`
- WhatsApp API: Meta Cloud API version: **v21.0** — `whatsapp/whatsapp.service.ts:15`

## Decisions

- **[2026-04-29] LLM tool-calling replaces explicit 7-step pipeline + flows/ state machines.** Source: CLAUDE.md drift log; commits `f23e3d9`, `359045b`, `f7801ee`.
- **[2026-04-29] `regenerate_payment_link` tool added** to fix the "stale URL" CEO incident. System-prompt rule forbids URL re-quoting from chat history. Source: CLAUDE.md drift log row 2026-04-29.
- **[2026-04-30] Credit-pack pre-credit drift fixed** — purchase only credits the user via Razorpay webhook, not at link creation. Source: CLAUDE.md drift log row 2026-04-30.
- **[active] No LLM-adapter abstraction.** Provider is OpenAI directly; the v1.0 Qwen/Claude/Alibaba adapters were never built. Source: `agent/lumi-agent.service.ts:37`.
- **[active] Fasting reminder uses `setInterval`, not `@nestjs/schedule` or BullMQ.** Source: CLAUDE.md "Already Built — fasting reminder job".

## Constraints

- NEVER reintroduce `flows/`, `classifier/`, `handlers/`, or `router/` subdirectories — they were deliberately deleted.
- NEVER call `graph.facebook.com` outside `src/modules/lumi/whatsapp/` (rule 4 — drift-grep enforced).
- NEVER pre-credit a user — credits are only added by the Razorpay webhook after `payment_link.paid`.
- NEVER quote a Razorpay URL from chat history — always call `regenerate_payment_link`.
- NEVER write `lumi_conversations` outside `LumiAgentService` / `LumiWebhookController`.
- NEVER call the LLM directly for health suggestions — always go through `RagService`.
- NEVER add a JSON-envelope response contract — the contract is OpenAI tool-calling.

## Unresolved

- Should `lumi_flow_state` be dropped from `prisma/schema.prisma`? Confirmed dormant. Removing is a one-migration cleanup but breaks admin purge calls until updated.
- Pre-send safety guardrail (blacklist regex / dosage pattern, doc §15): does not exist. Decide whether to (a) drop the v1.0 promise or (b) build it.
- Memory `expiresAt` lifespans: `MemoryExtractorService` does not populate them; every memory is permanent. Product decision needed.

---

*— End of Lumi AI Agent TTD —*
