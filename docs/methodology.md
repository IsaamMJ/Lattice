# Lattice Methodology

The five rules every Lattice audit follows, derived from the cc-reef postmortem.

## The five rules

### 1. Read living truth before judging anything

Every audit's Step 1: read `CLAUDE.md`, `AGENTS.md`, and any drift logs. These files carry intentional decisions that grep-against-code can't recover (e.g. "we deliberately deleted `flows/` on 2026-04-29").

Without this step, audits flag intentional removals as "missing X" — confidently wrong.

### 2. Check the doc's own Revision History

Before extracting claims from a doc, scan for a `Revision History` section. Note dates and reasons for prior changes. Run `git log --oneline -- <doc-path>` to see when the doc itself last changed. A claim made in a 2024-vintage section of a 2026-revised doc is more suspect than a fresh one.

### 3. Verify with `Read` / `Grep` / `Glob` — never `Bash grep`

`Bash grep` on Windows hits path tokenization issues that silently return zero matches. Use Claude Code's native search tools. Every claim that can be checked must produce a `file:line` citation.

### 4. Check git log before flagging "missing"

If a claim looks broken (file/symbol not found):
1. `git log --all --oneline -- <claimed-path>` — was it deleted?
2. `git log --all -S"<symbol>" --oneline` — was the symbol removed in a known commit?
3. Cross-reference against CLAUDE.md notes from Rule 1.

If git shows a deletion + CLAUDE.md cites the reason → the claim is **INTENTIONAL** (doc is stale), not **DRIFT**.

### 5. Default-assume "deliberately removed" until evidence proves otherwise

When a claim doesn't match code AND there's no clear deletion commit AND CLAUDE.md is silent — the verdict is **UNVERIFIABLE**, not **DRIFT**. UNVERIFIABLE means "I don't have enough evidence to call this a regression; ask a human."

This rule prevents the cc-reef failure mode: confidently flagging deliberate architectural decisions as bugs.

## The four-verdict model (for `/audit`)

| Verdict | Means | Required evidence |
|---|---|---|
| **OK** | Doc matches code | `file:line` showing the match |
| **DRIFT** | Code differs from doc, no evidence of intent | git log shows code changed without doc update |
| **INTENTIONAL** | Doc is stale because removal was deliberate | **commit hash OR CLAUDE.md line** — no exceptions |
| **UNVERIFIABLE** | Cannot determine from available evidence | what was searched and what wasn't found |

**Hard rule**: `INTENTIONAL` without a commit hash or CLAUDE.md citation is downgraded to `UNVERIFIABLE`. This prevents lazy "probably intentional" verdicts.

## The four-tier severity model (for `/scale-audit` and `/security-audit`)

| `/scale-audit` | `/security-audit` | Means |
|---|---|---|
| BLOCKER | CRITICAL | Breaks today; fix immediately |
| RISK | HIGH | Real risk under realistic conditions; fix this week |
| WATCH | MEDIUM | Hardening gap; fix when convenient |
| OK | LOW / OK | Verified safe (with citation) |

Every BLOCKER/CRITICAL gets:
- A 1-sentence **failure mode** (scale) or **attack scenario** (security)
- A 1-sentence **fix recommendation**
- For security CRITICAL/HIGH: a BAD/GOOD code block in the file's language

## No verdict without artifact

Lattice's core discipline: every finding cites `file:line`, a commit hash, or a CLAUDE.md line. Freeform prose verdicts are rejected.

This rule makes audits cheap to verify (a human or another AI can check the citation in seconds) and makes false positives obvious (no citation = no claim).

## No auto-apply, no auto-commit

Lattice audits stop at the diff-review gate. Doc rewrites are proposed; the user replies `apply` to overwrite. Code fixes are recommended; the user runs them in their session. Lattice never edits source code or commits anything itself.

This is deliberate — security and scale fixes are architectural and require human judgment. Auto-applied fixes can create worse holes than the ones they close.

## Pilot before sweep

The recommended workflow when adopting Lattice on a new project:

1. **Pilot one module** — pick the module you understand best, run all three audits, validate the findings.
2. **Tune if needed** — if the skill misclassifies (false positives or missed real issues), edit the command file and re-pilot.
3. **Sweep the rest** — once confident, use `/audit-sweep .` or batch the remaining modules in 3+3 sets.
4. **Triage in batch** — fix CRITICALs/BLOCKERs immediately, defer the rest into a `Pre-deploy checklist` section in CLAUDE.md.

## See also

- `contract-format.md` — the doc rewrite spec
- `postmortem-reef.md` — why this methodology exists
