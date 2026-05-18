---
description: Audit a project doc against the actual codebase with file:line evidence, distinguishing drift from deliberate removal. Use when the user wants to verify documentation matches code, runs `/audit <doc>`, asks "is this doc accurate?", or mentions doc-vs-code drift.
argument-hint: <doc-path>
allowed-tools: Read Grep Glob Bash
---

Target doc to audit: $ARGUMENTS

## Live Lattice state (auto-injected at invocation)

!`lattice context 2>/dev/null || echo "(lattice context unavailable — not in a Lattice-enabled repo or lattice not on PATH)"`

# audit-doc

You are auditing a single documentation file against the actual code. You produce evidence-backed findings and a proposed contract-format rewrite. You do NOT auto-apply changes.

## Why this skill exists

Doc audits fail two opposite ways:

| Failure mode | What it looks like | Fix |
|---|---|---|
| **False DRIFT** | Flagging "X is missing" when X was deliberately removed | Read CLAUDE.md / git log BEFORE judging |
| **False OK** | Rubber-stamping claims because the prose sounds plausible | Require `file:line` evidence for every verdict |

**Universal rule: no verdict without an artifact** (file:line, commit hash, or CLAUDE.md line).

## Methodology

### Step 1 — Load living truth first

| Source | Why |
|---|---|
| `CLAUDE.md` (project root) | Notes on deliberate removals, NEVER rules, revision history |
| `AGENTS.md` (if exists) | Cross-tool agent context |
| Drift logs / ADR directory referenced by CLAUDE.md | Architectural decisions with citations |

Every later judgement depends on knowing what was intentional.

### Step 2 — Read the target doc

1. Read the full doc passed as argument (`$ARGUMENTS`).
2. Scan for a `Revision History` section — note dates + reasons.
3. `git log --oneline -- <doc-path>` to see when the doc itself last changed.

### Step 3 — Extract verifiable claims

Walk top-to-bottom. Extract every claim checkable against code:

| Claim type | Examples |
|---|---|
| File paths | "see `src/foo.ts`" |
| Symbols | function/class/export names |
| API surface | endpoints, routes, env vars |
| Behaviours | "X triggers Y" |
| Dependencies | "uses library Z" |
| Architecture | "module A talks to module B via C" |

**Skip pure prose/rationale** — those are opinions, not claims.

### Step 4 — Verify each claim

For each claim, use Read/Grep/Glob — **never Bash grep** (Windows path issues).

| Claim type | Verification method |
|---|---|
| file path | Glob for the path |
| function/export | Grep for the symbol definition |
| behaviour | Read the cited code and confirm |
| env var | Grep for the var name |
| dependency | Read package.json / equivalent |

**When N>=5 claims**: load [references/audit-verify-subagent-prompt.md](references/audit-verify-subagent-prompt.md) for the Sonnet subagent dispatch pattern. Saves ~60% of audit tokens.

Return UNCLEAR (not DRIFT) when evidence is genuinely ambiguous — Step 6 tracer will resolve those.

### Step 4b — Orphan/dead-code sweep

Before moving on:

1. List every `.ts`/`.js`/`.py` (whatever language) in the module directory.
2. For each file NOT mentioned in the doc:
   - Grep for any importer (`from.*<file-path>` or language equivalent)
   - Zero importers → `ORPHAN` finding, `action: NEEDS_HUMAN`, note "appears to be dead code — verify and delete or document"
   - Imported but not in doc → `MISSING_FROM_DOC` finding, `action: PATCH_DOC`

**Why:** catches the failure mode where the audit verifies cited claims but misses files that exist in the module yet aren't in the contract. (Real example: Lumi audit 2026-05-01 missed a duplicate `lumi-agent.service.ts` — 173 lines of dead code.)

### Step 5 — Git history check before flagging missing

If a claim looks broken (file/symbol not found):

| Command | Question it answers |
|---|---|
| `git log --all --oneline -- <claimed-path>` | Was it deleted? |
| `git log --all -S"<symbol>" --oneline` | Was the symbol removed in a known commit? |
| Cross-reference Step 1 CLAUDE.md notes | Was the removal documented as intentional? |

### Step 6 — Hard calls: missing vs deliberate

When evidence is ambiguous (claim doesn't match code, no clear deletion commit, no CLAUDE.md note):

**Evidence hierarchy** (strongest → weakest):

1. Git commit hash
2. CLAUDE.md line citing the removal
3. Code-path inference (e.g. dependency removed in package.json)
4. Naming similarity (weakest — never enough on its own)

If `oh-my-claudecode:tracer` is installed, dispatch it with the evidence + ranked-hypothesis prompt. If not, apply the hierarchy in the main session yourself. Same result.

### Step 7 — Assign verdicts

| Verdict | Means | Required evidence |
|---|---|---|
| **OK** | Doc matches code | `file:line` showing the match |
| **DRIFT** | Code differs from doc, no evidence of intent | git log shows code changed without doc update |
| **INTENTIONAL** | Doc is stale because removal was deliberate | **commit hash OR CLAUDE.md line — no exceptions** |
| **UNVERIFIABLE** | Cannot determine from available evidence | Document what was searched and what wasn't found |

**Hard rules:**
- INTENTIONAL without citation → downgrade to UNVERIFIABLE (prevents lazy "probably intentional")
- DRIFT only for explicit contradictions (present-tense factual claims that the code falsifies)
- DO NOT flag DRIFT for `will`, `Phase N`, `future`, `deferred`, `roadmap` — aspirational
- DO NOT flag DRIFT for "doc is silent on Z" — coverage gap, use UNVERIFIABLE
- For every OK claim, emit a `tier: OK` finding with `intentional_citation: <file:line>` — prevents future re-raising of false positives

**When in doubt: UNVERIFIABLE, not DRIFT.** False positives erode trust.

### Step 8 — Write findings + manifest

Load [references/audit-finding-schema.md](references/audit-finding-schema.md) for the exact YAML schema. Emit one file per finding into `.lattice/findings/open/`.

**sweep_id sourcing:**
- Invoked from `/audit-sweep` → use the sweep_id passed through
- Standalone → generate via `lattice sweep-id` and write a manifest

### Step 9 — Propose contract-format rewrite

Load [references/audit-contract-format.md](references/audit-contract-format.md) for the rewrite template + derivation rules.

### Step 10 — Show diff, stop, await approval

Output the unified diff. **Do not write the doc.** Tell the user findings path + verdict counts + diff. Wait for explicit `apply`.

## Anti-patterns (refuse)

| ❌ | Why |
|---|---|
| Verdict without `file:line` or commit hash | Erodes trust; that's the whole point of this skill |
| INTENTIONAL without citation | Lazy verdict — must be UNVERIFIABLE instead |
| Bash grep | Windows shell tokenization issues — use Grep tool |
| Auto-apply doc rewrites | User approval gate is mandatory |
| Flagging deleted files as missing without git log | Skipping Step 5 produces false DRIFT |
| Skipping CLAUDE.md read because "I remember" | Step 1 is non-negotiable |
| Inventing claims not in the doc, then auditing them | Hallucinated audit — only audit what the doc says |

## Tool usage

| Tool | Used for |
|---|---|
| Read / Grep / Glob | Claim verification (never Bash for search) |
| Bash | Only `git log` / `git show` / `git diff` |
| Write | Only findings YAML in `.lattice/findings/` — never the target doc until approved |
| Task (subagent) | Only when evidence is genuinely ambiguous (Step 6 tracer) |

## Output discipline

- No preamble. Start with "Auditing <doc-path>..."
- One short status line per major step ("Step 4: 12 claims extracted, verifying...")
- Final output = findings path + diff + approval prompt
- Do not summarize what you did — the findings file IS the summary

---

After running: `lattice list` / `lattice triage` / `lattice sync` to triage findings. Slash commands produce findings; the `lattice` CLI manages lifecycle.
