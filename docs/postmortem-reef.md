# Postmortem: cc-reef → Lattice

The project that motivated Lattice's existence. Short version: an AI-driven doc reviewer that confidently flagged deliberately-deleted code as "missing" and proposed rebuilding it.

## What cc-reef was

A Node.js web app that wrapped Grok (xAI) as a per-project doc reviewer. Architecture:
- Server-side tool execution loop (read_doc, list_files, grep_code, propose_task, update_doc, etc.)
- SSE-streamed chat UI
- JSONL append-only storage for tasks/decisions/sessions
- Sandboxed file/code access with allowlist of project paths
- Two LLMs: Grok proposed reviews, Claude Code (Max plan) verified them

The pitch: "per-project senior architect reviewer that catches doc drift."

## The canonical incident

Auditing `08-module-lumi.md` for the jiive-backend project. Grok read the doc, saw it described `flows/`, `classifier/`, `handlers/`, and `router/` subdirectories. None of them existed in code anymore. Grok flagged this as a high-priority gap and proposed an action: "Implement Structured Flows."

What Grok missed:
- Those subdirectories were **deliberately deleted** on 2026-04-29
- The deletion was documented in `CLAUDE.md`'s drift log with three commit hashes (`f23e3d9`, `359045b`, `f7801ee`)
- The architecture had pivoted from explicit per-flow state machines to LLM tool-calling
- The doc was stale, not the code

The user's other Claude Code session caught the error. The "fix" was to add `read_living_truth` and `git_log` tools and force a living-truth-first methodology in the audit prompt. That worked — but by then the bigger problem was visible.

## Why cc-reef failed (what the postmortem said)

1. **Wrong delivery vehicle.** A separate web app with a second LLM duplicated work the user's existing Claude Code (Max plan) could do natively, more reliably, for free.

2. **Fragile tool plumbing.** Tool calls were parsed from text (`<tool>NAME</tool>{json}`), which broke when Grok used loose formats. Each fix added more parser leniency, accreting complexity.

3. **Prompt drift across sessions.** Per-chat system prompt overrides got pinned at create time; users edited the project default and chats with cached overrides ignored the update. Required a "refresh preset" banner to recover.

4. **The "rebuild deleted flows" incident.** The audit lacked a forcing function to read CLAUDE.md before judging. The fix was prompt engineering — but on Grok, which had no built-in concept of "living truth" priority.

5. **Feature stacking.** Each new failure mode added a new feature (audit tab, action plan tab, alignment scan, doc patch modal). The UI grew; the core trust problem (hallucinated reviews) didn't get smaller.

6. **Patching symptoms, not causes.** Sandbox path resolution silently failed on `E--DXB-Superpowers` → `E:\DXB-Superpowers` (dash) when the real folder was `E:\DXB_Superpowers` (underscore). Fix: add dash/underscore/concatenated joiner tolerance. Real fix would have been to surface the error loudly. We chose tolerance.

7. **Doc body truncation.** A 24K-char doc inlined as a tool argument hit Grok's 4K output cap, truncated mid-stream → tool call never executed. The fix was a server-side orchestrated rewrite tool. Grok kept reaching for the old tool anyway.

## The five lessons (what Lattice encodes)

| Lesson | Lattice rule |
|---|---|
| Read living truth before judging | Step 1 of every audit reads CLAUDE.md, AGENTS.md, drift logs |
| Check the doc's own Revision History | Step 2 of `/audit` scans for it |
| Verify with code, never prose | Every claim requires `file:line` evidence |
| Check git log before flagging missing | Step 5 of `/audit` runs `git log --oneline -- <path>` |
| Default-assume "deliberately removed" | INTENTIONAL requires commit hash or CLAUDE.md citation; otherwise UNVERIFIABLE |

## What Lattice deliberately is NOT (vs cc-reef)

| cc-reef did | Lattice doesn't |
|---|---|
| Run as a separate web app | Native Claude Code commands; no server, no MCP, no separate runtime |
| Use a second LLM (Grok) | Uses Claude Code natively + dispatches Sonnet for heavy verification |
| Auto-apply doc rewrites | Stops at the diff-review gate; user replies `apply` |
| Auto-propose code fixes | Recommends fixes; user runs them in their session |
| Maintain its own UI | Slash commands + markdown findings files |
| Persist conversation state | No state; each audit is a fresh, traceable run |

## What survived from cc-reef

- The four-verdict model (DRIFT / OK / INTENTIONAL / UNVERIFIABLE)
- The truth hierarchy (code+git → CLAUDE.md → docs)
- The sandbox-by-allowlist concept (now: stay within the project root)
- The dual-LLM verification idea (now: main session + Sonnet subagent for verification)

## The one-line summary

> cc-reef built a separate web app with a second LLM to do work the user's existing IDE assistant could do natively, more reliably, for free.

Lattice is what cc-reef should have been from day one: four markdown files, installed as a Claude Code plugin, no separate runtime, every finding grounded in evidence.
