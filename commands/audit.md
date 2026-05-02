---
description: Audit a project doc against the actual codebase with file:line evidence, distinguishing drift from deliberate removal.
argument-hint: <doc-path>
---

Target doc to audit: $ARGUMENTS

# audit-doc

You are auditing a single documentation file against the actual code in this repository. You produce evidence-backed findings and a proposed contract-format rewrite. You do NOT auto-apply changes.

## Why this skill exists

Doc audits fail in two opposite directions:
- **False DRIFT**: flagging "X is missing" when X was deliberately removed (this is what broke cc-reef)
- **False OK**: rubber-stamping claims because the prose sounds plausible

The fix is the same in both cases: **no verdict without an artifact** (file:line, commit hash, or CLAUDE.md line).

## Trigger

User invokes: `/audit <doc-path>` (e.g. `/audit docs/ttd/08-module-lumi.md`)

## OMC fallback (works without oh-my-claudecode installed)

Lattice prefers to dispatch its heaviest step (claim verification) to a Sonnet sub-agent for cost. If `oh-my-claudecode:executor` is installed, it's used. If not, the same step runs inline in the main session — **same methodology, same verdict quality, just slightly more tokens**. No degraded mode, no missing features. Lattice works standalone.

Detection: at Step 4, attempt the dispatch. On dispatch failure (OMC not present), continue inline with the same prompt body.

## Methodology (execute in this exact order)

### Step 1 — Load living truth FIRST
1. Read `CLAUDE.md` (project root). Note any "NEVER", "deliberately removed", or revision-history entries.
2. Read `AGENTS.md` if it exists.
3. Read any drift log or ADR directory referenced by CLAUDE.md.

**Why first**: every later judgement depends on knowing what was intentional.

### Step 2 — Read the target doc
1. Read the full doc passed as argument.
2. Specifically scan for a `Revision History` section — note dates and reasons for prior changes.
3. Run `git log --oneline -- <doc-path>` to see when the doc itself last changed.

### Step 3 — Extract verifiable claims
Walk the doc top-to-bottom. Extract every claim that can be checked against code:
- File paths ("see `src/foo.ts`")
- Function/class/export names
- API endpoints, routes, env vars
- Behaviours ("X triggers Y")
- Dependencies ("uses library Z")
- Architectural assertions ("module A talks to module B via C")

Skip pure prose/rationale (those are opinions, not claims).

### Step 4 — Verify each claim (dispatched to subagent for cost)
This is the heaviest step (most code reads). Dispatch it to a Sonnet subagent instead of running in the main session.

Dispatch `oh-my-claudecode:executor` (sonnet) with:
```
Verify these <N> doc claims against the codebase. For each claim, use Read/Grep/Glob (never Bash grep — Windows path issues). Return a JSON array, one entry per claim, schema:
  { claim: "<text>", verdict: "OK" | "DRIFT" | "UNCLEAR", evidence: "file:line or 'not found'" }

Claims:
1. <claim text> — type: file-path | symbol | behaviour | env-var | dependency
2. ...

Verification methods:
- file path → Glob for the path
- function/export → Grep for the symbol definition
- behaviour → Read the cited code and confirm
- env var → Grep for the var name
- dependency → Read package.json / equivalent

Return UNCLEAR (not DRIFT) when evidence is genuinely ambiguous — main session will run tracer on those.
```

Wait for the subagent's JSON response. Use it as input to Step 5+. This dispatch saves ~60% of audit tokens because the verification step is 60-70% of the total work and Sonnet handles it as well as Opus.

If `oh-my-claudecode:executor` is not available (OMC not installed), fall back to running Step 4 in the main session with the same methodology.

### Step 4b — Orphan/dead-code sweep
Before moving on, list every `.ts` / `.js` / `.py` (whatever language the module uses) file in the module directory. For each file **not** mentioned in the doc:
- `Grep` the codebase for any importer (`from.*<file-path>` or equivalent for the language)
- If zero importers: flag as `ORPHAN` finding with `action: NEEDS_HUMAN` and note "appears to be dead code — verify and delete or document"
- If imported but not in doc: flag as `MISSING_FROM_DOC` finding with `action: PATCH_DOC`

This catches the failure mode where the audit verifies cited claims but misses files that exist in the module yet aren't in the contract. (Real example: Lumi audit 2026-05-01 missed a duplicate `lumi-agent.service.ts` at the module root — 173 lines of dead code.)

### Step 5 — Check git history before flagging anything missing
If a claim looks broken (file/symbol not found):
1. Run `git log --all --oneline -- <claimed-path>` — was it deleted?
2. Run `git log --all -S"<symbol>" --oneline` — was the symbol removed in a known commit?
3. Cross-reference against CLAUDE.md notes from Step 1.

### Step 6 — Hard calls: dispatch tracer for "missing vs deliberate"
When evidence is ambiguous (claim doesn't match code, but no clear deletion commit either), dispatch the `oh-my-claudecode:tracer` agent with this prompt template:

```
Observation: doc <doc-path> at <line> claims "<claim>". Code search for "<symbol>" returns no matches. Git log shows: <git output>. CLAUDE.md says: <relevant excerpt or "nothing">.

Hypotheses to rank:
- DRIFT (code regressed, doc was right)
- INTENTIONAL (deliberate removal, doc is stale)
- UNVERIFIABLE (insufficient evidence)

Evidence strength hierarchy: git commit hash > CLAUDE.md line > code-path inference > naming similarity.
```

Use tracer's ranked verdict as the verdict for that claim.

If OMC is not installed, fall back to native judgement using the same hierarchy.

### Step 7 — Assign verdicts
Per claim:

| Verdict | Means | Required evidence |
|---|---|---|
| **OK** | Doc matches code | `file:line` showing the match |
| **DRIFT** | Code differs from doc, no evidence of intent | git log shows code changed without doc update |
| **INTENTIONAL** | Doc is stale because removal was deliberate | **commit hash OR CLAUDE.md line** — no exceptions |
| **UNVERIFIABLE** | Cannot determine from available evidence | what was searched and what wasn't found |

**Hard rule**: `INTENTIONAL` without a commit hash or CLAUDE.md citation is downgraded to `UNVERIFIABLE`. This prevents lazy "probably intentional" verdicts.

### Step 8 — Write findings file
Write to `.lattice/findings/<doc-basename>-<YYYYMMDD-HHMMSS>.md` using exactly this schema:

```markdown
# Audit: <doc-path>
date: <ISO timestamp>
auditor: claude-code/audit-doc
living-truth-sources: [CLAUDE.md, ...]

## Summary
- OK: <n>
- DRIFT: <n>
- INTENTIONAL: <n>
- UNVERIFIABLE: <n>

## Findings

### [<verdict>] <one-line claim summary>
- **claim**: <what the doc says, with doc:line>
- **evidence**: <file:line or commit hash>
- **action**: PATCH_DOC | NO_ACTION | NEEDS_HUMAN
- **notes**: <only if NEEDS_HUMAN — what question the human must answer>

(repeat per claim)
```

### Step 9 — Propose contract-format rewrite
Generate a proposed new version of the doc in this structure (do NOT write it yet):

```markdown
## Module: <name>
file: <path>
entry: <entry file>
status: ACTIVE | DEPRECATED | IN_PROGRESS

## Context
<2-4 sentences for human readers: what this module does and why it exists>

## Contracts
- <verified behaviour/endpoint/export> — `file:line`

## Decisions
- [<YYYY-MM-DD>] <what was decided and why> — source: <commit hash or CLAUDE.md line>

## Constraints
- NEVER <thing future Claude Code must not do, derived from INTENTIONAL findings>

## Unresolved
- <each UNVERIFIABLE finding, phrased as a question for the human>
```

### Step 10 — Show diff and stop
Output the unified diff between the original doc and the proposed rewrite. **Do not write the file.** Tell the user:

```
Audit complete. Findings: .lattice/findings/<file>
Proposed rewrite diff above.

Review and reply 'apply' to overwrite <doc-path>, or 'edit' to discuss changes first.
```

Wait for explicit approval before any `Write` call against the doc.

## Anti-patterns (refuse to do these)

- ❌ Verdict without `file:line` or commit hash
- ❌ "INTENTIONAL" without citation → must be UNVERIFIABLE instead
- ❌ Bash grep (use Grep tool — Windows shell tokenization issues)
- ❌ Auto-apply doc rewrites
- ❌ Flagging deleted files as missing without checking git log first
- ❌ Skipping CLAUDE.md read because "I remember the project"
- ❌ Inventing claims not in the doc, then auditing them ("hallucinated audit")

## Tool usage

- **Read / Grep / Glob**: claim verification (never Bash for search)
- **Bash**: only for `git log` / `git show` / `git diff`
- **Write**: only for the findings file in `.lattice/findings/` — never for the target doc until approved
- **Task (subagent dispatch)**: only for `oh-my-claudecode:tracer` in Step 6, only when evidence is genuinely ambiguous

## Output discipline

- No preamble. Start with "Auditing <doc-path>..."
- One short status line per major step ("Step 4: 12 claims extracted, verifying...")
- Final output = findings file path + diff + approval prompt
- Do not summarize what you did — the findings file is the summary

## Telemetry (pilot mode — first 3 docs only)

While the skill is being piloted, append a `## Telemetry` block to the findings file. Goal: collect data so we can route the right model per step on later docs.

```markdown
## Telemetry

### Model used for this run
- Session model: <opus-4.7 | sonnet-4.6 | haiku-4.5>

### Step-level fit
| Step | Felt | Why |
|---|---|---|
| 1 read CLAUDE.md | overkill / right / under-powered | |
| 2 read doc + revision history | overkill / right / under-powered | |
| 3 extract claims | overkill / right / under-powered | |
| 4 verify claims | overkill / right / under-powered | |
| 5 git log check | overkill / right / under-powered | |
| 6 tracer dispatch (if used) | helpful / unnecessary / wrong-tool | |
| 7 assign verdicts | overkill / right / under-powered | |
| 9 contract rewrite | overkill / right / under-powered | |

### Token-heavy steps
- <step name>: ~<rough estimate> — could this be a cheaper model?

### Where the auditor stumbled
- <any step where reasoning felt thin, evidence was missed, or output needed retry>

### Recommended routing for next doc
- <e.g. "extract claims → haiku; verify → sonnet; rewrite → opus">
```

After 3 audits, review the telemetry and decide whether to hard-code subagent dispatches per step. Until then, keep the skill model-agnostic.
