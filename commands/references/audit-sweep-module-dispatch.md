# audit-sweep: Step 2 — per-module dispatch prompt template

The byte-identical methodology block to send to each module's Sonnet sub-agent. Keep it identical across all module dispatches in a sweep so Anthropic prompt caching hits the cache after the first module.

## Module-scoped dispatch prompt

```
[METHODOLOGY LIBRARY — keep this block byte-identical across every module
 dispatch in this sweep so the prompt cache hits]

You are a Lattice module-scoped auditor. You run up to three audit dimensions
on a single module and return combined findings. You never spawn further
sub-agents.

Read these living-truth sources first (in order):
1. CLAUDE.md (project root)
2. AGENTS.md (if present)
3. Any drift log or ADR directory referenced by CLAUDE.md
4. The module's TTD doc (if one exists)

For each dimension in scope, follow the methodology referenced in:

| Dimension | Methodology | Skips for sweep mode |
|---|---|---|
| audit | commands/audit.md Steps 1-7 | Skip Step 4 executor dispatch (run inline); skip Steps 9-10 contract rewrite (orchestrator only on demand) |
| scale | commands/scale-audit.md Steps 1-5 | Skip Step 3 executor dispatch (run inline) |
| security | commands/security-audit.md Steps 1-5 | Skip Step 3 executor dispatch (run inline) |
| flow | commands/flow-audit.md Steps 1-5 | Skip Step 3 executor dispatch (run inline) |

Verdict tiers:
- Audit: OK | DRIFT | INTENTIONAL | UNVERIFIABLE (every INTENTIONAL needs commit hash or CLAUDE.md citation)
- Scale: BLOCKER | RISK | WATCH | OK
- Security: CRITICAL | HIGH | MEDIUM | LOW | OK
- Flow: CRITICAL | HIGH | MEDIUM | LOW | OK

Hard rules across all dimensions:
- No verdict without file:line evidence
- No CRITICAL/BLOCKER without an attack scenario or failure mode
- Mark false_positive=true for test files (*.spec.ts, *.test.ts), CLI scripts,
  files inside guards/ directory
- Never auto-apply fixes
- Use Grep, Read, Glob — never Bash grep (Windows path issues)

Write findings to .lattice/findings/open/ using the v0.7 YAML schema
(docs/finding-schema.md). One YAML file per finding — never write monolithic
markdown audit reports. Filename pattern: <TIER>-<module-slug>-<rule-slug>.yml
Example: HIGH-payments-missing-rate-limit.yml

Return a JSON summary to the orchestrator:
{
  "module": "<path>",
  "audit": { "OK": n, "DRIFT": n, "INTENTIONAL": n, "UNVERIFIABLE": n, "files": ["..."] },
  "scale": { "BLOCKER": n, "RISK": n, "WATCH": n, "OK": n, "files": ["..."] },
  "security": { "CRITICAL": n, "HIGH": n, "MEDIUM": n, "LOW": n, "OK": n, "files": ["..."] },
  "flow": { "CRITICAL": n, "HIGH": n, "MEDIUM": n, "LOW": n, "OK": n, "files": ["..."] },
  "cross_cutting_candidates": ["<one-line pattern>", ...]
}

[END METHODOLOGY LIBRARY]

[MODULE-SPECIFIC ARGS — these vary per dispatch and come AFTER the cached methodology block]

Module to audit: <module-path>
TTD doc (if any): <doc-path or "none">
Dimensions in scope: <comma-separated subset of audit,scale,security,flow>
Project root: <root>
sweep_id: <id from Step 1>           # MUST embed this in every YAML you write
sweep_date: <YYYY-MM-DD>             # MUST embed this in every YAML you write
```

## Discipline notes for orchestrator

**module_owner + related_files:** Set `module_owner:` when the fix design belongs to a different module than where the bug manifests. Set `related_files:` for files the fixer must also read (design constraints, shared maps). Both optional.

**Finding id:** Generate via `lattice id-gen <dimension> <rule> <file> "<line_content>"` where `<line_content>` is the exact source text of the flagged line, whitespace-collapsed. Do NOT include the line number — id must survive line shifts.

**OK-finding discipline:** Each per-module dispatch MUST explicitly enumerate the patterns it checked-and-found-clean as `OK` findings. First-class output, not a side-effect. Subagent prompts must list "what was checked but is fine" with the same `file:line` discipline as DRIFT/CRITICAL findings.

**DRIFT threshold (audit dimension only):** DRIFT is reserved for explicit contradictions between TTD and code that grep can verify both sides of.
- DO flag DRIFT for present-tense factual claims that code falsifies
- DO NOT flag DRIFT for `will`/`Phase N`/`future`/`deferred`/`roadmap` (aspirational)
- DO NOT flag DRIFT for "TTD is silent on Z" (coverage gap → UNVERIFIABLE)

**Stop-condition gate:** If any single module returns > 5 CRITICAL or > 2 BLOCKER findings, **pause the sweep**, print partial summary, ask user whether to continue/fix/abort.

**OMC fallback:** Dispatch via `oh-my-claudecode:executor` (sonnet) if available. If OMC is not installed, run the module-scoped audit directly in the main session using the same methodology block above.
