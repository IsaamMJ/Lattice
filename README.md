# Lattice

> **Audit framework for keeping docs aligned with code.** Doc-vs-code drift, scale risks, security exposures — every finding grounded in a `file:line` citation.

Lattice ships four slash commands for Claude Code:

| Command | Catches |
|---|---|
| `/audit <doc-path>` | Doc-vs-code drift; rewrites docs in contract format |
| `/scale-audit <module-path>` | Horizontal-scaling killers (in-memory state, `setInterval` crons, in-process rate limiters) |
| `/security-audit <module-path>` | Auth gaps, signature bypass, secret leaks, IDOR, OWASP Top 10 |
| `/audit-sweep <project-root>` | Runs all three across every module via one dispatch per module; aggregates into one report |

Every finding cites a file and line. Every verdict requires evidence. Audits stop at human-approval gates — Lattice never auto-applies fixes or auto-commits.

---

## 30-second quickstart

```bash
# 1. Install
curl -fsSL https://raw.githubusercontent.com/IsaamMJ/Lattice/main/scripts/install.sh | bash

# 2. cd into the project you want to audit, then in Claude Code:
/audit-sweep .

# 3. Findings land in .lattice/findings/open/<sweep-date>/<TIER>-<module>-<rule>.yml

# 4. Triage with the lattice CLI (v0.6.5+):
~/.claude/lattice/scripts/lattice list                    # see open findings
~/.claude/lattice/scripts/lattice show <id>               # inspect one
~/.claude/lattice/scripts/lattice close <id> --commit HEAD
~/.claude/lattice/scripts/lattice defer <id> --until 2026-07-01 --reason "blocked on backend"
~/.claude/lattice/scripts/lattice sync                    # regenerate CLAUDE.md from YAML

# (alias `lattice=~/.claude/lattice/scripts/lattice` in your shell rc to drop the path)
```

Expected output:
```
[SWEEP] Module 1/5 starting: src/modules/payments (dimensions: audit, scale, security)
[SWEEP] Module 1/5 complete: src/modules/payments — audit=12OK/3DRIFT scale=0B/2R security=1C/4H
[SWEEP] Module 2/5 starting: src/modules/admin ...
...
Lattice sweep complete. Findings: .lattice/findings/sweep-20260502-060500.md
```

---

## Why this exists

Built after the cc-reef postmortem (see `docs/postmortem-reef.md`). The short version: AI-driven doc reviews that don't read living-truth files first produce confidently-wrong critique. Lattice encodes the methodology that prevents that:

1. **Read CLAUDE.md / AGENTS.md / drift logs first** — before judging any claim
2. **Check Revision History on the doc** — what was already updated?
3. **Verify every claim against actual code** with `Grep`/`Glob`/`Read`
4. **Check git log for intentional deletions** before flagging "missing"
5. **Default-assume "deliberately removed"** until evidence proves otherwise

If your doc says module X exports function Y, Lattice greps for Y. If Y doesn't exist, Lattice doesn't say "DRIFT" — it checks `git log` for a deletion commit, then CLAUDE.md for an intentional-removal note, and only then assigns a verdict (`DRIFT`, `INTENTIONAL`, or `UNVERIFIABLE`).

---

## Install

### Option 1 — direct (one command)

```bash
curl -fsSL https://raw.githubusercontent.com/IsaamMJ/Lattice/main/scripts/install.sh | bash
```

This copies `commands/*.md` to `~/.claude/commands/`. Commands appear bare: `/audit`, `/scale-audit`, `/security-audit`, `/audit-sweep`.

### Option 2 — Claude Code plugin marketplace

```bash
# In Claude Code:
/plugin marketplace add IsaamMJ/Lattice
/plugin install lattice@lattice-marketplace
```

Commands appear namespaced: `/lattice:audit`, `/lattice:scale-audit`, etc.

### Update

```bash
curl -fsSL https://raw.githubusercontent.com/IsaamMJ/Lattice/main/scripts/update.sh | bash
```

### Windows note (PowerShell users)

When writing finding YAMLs from PowerShell 5.1, `Set-Content -Encoding UTF8` prepends a UTF-8 BOM that older Lattice parsers (pre-v0.6.6.3) rejected. v0.6.6.3+ strips the BOM automatically, so this is no longer an issue. If you're on an older Lattice and seeing `malformed YAML at line 1`, either update or write files BOM-less:

```powershell
[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))
```

### Migrate from pre-v0.5 (legacy `.cc-reef/audits/`)

```bash
bash scripts/migrate.sh   # moves legacy findings to .lattice/findings/
```

---

## Architecture (v0.6)

**Findings as a structured YAML database.** Each finding is one file:
- Open: `.lattice/findings/open/<sweep-date>/<TIER>-<module>-<rule>.yml`
- Closed: `.lattice/findings/closed/<commit-sha>/<TIER>-<module>-<rule>.yml`

Status lives in the path. Operate via the `lattice` CLI: `lattice close <id> --commit <sha>`, `lattice reopen <id>`, `lattice defer <id> --until <date>`, `lattice list`, `lattice show <id>`, `lattice sync`. Run `lattice help` for the full surface. The CLAUDE.md checklist is regenerated from YAML truth between `<!-- lattice:checklist:start -->` markers — never edited by hand inside the markers.

**Module-scoped dispatch (from v0.5).** `/audit-sweep` sends one Sonnet sub-agent per module that runs all in-scope dimensions inline. A 5-module sweep = 5 dispatches (not 15). Anthropic prompt caching reuses the methodology library across module dispatches at ~90% discount.

**Standalone.** Works without `oh-my-claudecode` — same methodology, same verdict quality, slightly more tokens.

See `docs/finding-schema.md` for the YAML schema every skill conforms to.

---

## Methodology

- `docs/methodology.md` — full living-truth-first methodology and the four-verdict model
- `docs/contract-format.md` — doc rewrite spec (Module / Context / Contracts / Decisions / Constraints / Unresolved)
- `docs/finding-schema.md` — output schema all skills conform to
- `docs/postmortem-reef.md` — the failure that motivated this

---

## What Lattice deliberately is NOT

- Not a CI gate (you can wire it into one, but Lattice itself is interactive)
- Not an auto-fixer (every change is human-approved)
- Not a code reviewer (use `oh-my-claudecode:code-reviewer` or your team for that)
- Not a multi-language linter (NestJS/TypeScript-tuned out of the box; patterns generalize)
- Not yet recommended for public adoption — currently being hardened on real projects

---

## Roadmap

- **v0.5** — module-scoped dispatch, prompt-cache-aware, output schema contract, sequential echo-back guard, validate.sh cross-skill checks
- **v0.6** — YAML-per-finding lifecycle (open/closed in path), CLAUDE.md regenerated from YAML truth via markers, `lattice-close.sh` + `lattice-regenerate.sh` helpers
- **v0.6.3** — `status:` field on open findings (`open` / `in_progress` / `deferred` / `wont_fix`), `--partial` close, `lattice-reopen.sh` for regressions, `migrate-status.sh`, CI-enforced CLAUDE.md drift gate (`lattice-regenerate.sh --check`)
- **v0.6.3.1** — hardening patch: 8 bugs from a hostile-fixture stress pass. close.sh refuses to overwrite existing closed findings; multiline `--partial` text uses YAML block scalars; installer/updater ship all 5 lifecycle helpers; regen validates `line` as integer and applies required-field checks to closed findings; validate.sh now greps for stale version refs and legacy path patterns
- **v0.6.4** — `flow` and `coverage` dimensions formalized; `/flow-audit` command shipped (customer-flow gaps for conversational AI / multi-step request flows); new optional `tests:` field (acceptance criteria) and `simulate:` field (mechanical reproducers) on findings; regen YAML parser supports block-list form
- **v0.6.4.1** — installer/updater now ship `/flow-audit`; structural drift gate (validate.sh greps installer COMMANDS+SCRIPTS arrays against actual repo files); regen enforces dimension enum and dimension+tier required fields (security HIGH/CRITICAL needs OWASP, scale BLOCKER/RISK needs failure_mode, flow HIGH/CRITICAL needs impact); audit-sweep documents flow + coverage as opt-in dimensions
- **v0.6.5** — `scripts/lattice` unified CLI dispatcher (`close`/`reopen`/`sync`/`defer`/`list`/`show`/`sweeps`/`version`/`help`); `defer_until` + `defer_reason` + `deferred_at` fields formalize v0.6.3's `status: deferred`; `lattice list --due-for-review` surfaces past-due deferred findings; installer/updater + validate.sh track the dispatcher
- **v0.6.6** — bug fixes from first day of real use + two requested subcommands. `lattice show` resolves slug / `<module>/<rule>` / substring forms. `lattice list --module` does substring match. `lattice sync` / `--check` now use distinct exit codes (0=clean, 1=drift, 2=fatal). Dimension allowlist expanded to accept `configuration | quality | product`. New: `lattice triage` (interactive [c/d/s/e/v/q] walk) and `lattice bulk-close --pattern <glob>`
- **v0.6.6.1** — same-day patch from v0.6.6 retest. `lattice sync` (no `--check`) now exits 2 on parse error (was relying on `set -e` propagation through the dispatcher function, unreliable on Git Bash). Legacy closed YAMLs without `closed_by_commit` no longer block sync — regen auto-derives the SHA from the `closed/<sha>/` parent dir when the field is missing
- **v0.6.6.2** — regenerated CLAUDE.md hint comment now points at the `lattice` CLI (`lattice help`) instead of the non-existent `scripts/lattice-close.sh` path. Distribution-bug fix from a flow-audit debrief.
- **v0.6.6.3** — parser robustness from a heavy-use review. Strips leading UTF-8 BOM (PowerShell 5.1 cause), tolerates `---` document separator, line-1 errors include a fix hint. New `lattice validate` subcommand collects all per-file parse/schema errors instead of fail-fast.
- **v0.6.7** — audit-skill rewrite. Killed the `.lattice/findings/sweep-<ts>.md` markdown summary (dual source of truth was the bug). New sweep manifest at `.lattice/findings/sweeps/<sweep_id>.yml` with `auditor_model` / `duration_ms` / `skipped` / `runtime_warnings[]`. New `lattice sweep-id` generates deterministic `<YYYYMMDD><6-hex>` IDs. `/flow-audit --scope a,b,c` for multi-module flows. New optional `relates_to: [slug, ...]` finding field. TTD-silent → code is ground truth; DRIFT only on explicit contradictions; OK-finding emission required.
- **v0.7.0** (current) — major release from real-use feedback (36 findings / 29 closed / 8 commits on jiive Lumi). Flat layout (`open/<slug>.yml`, `closed/<slug>.yml`); stable `id:` algorithm SHA1(dim:rule:file:ctx)[:12] surviving line shifts; `close_reason:` enum + `closure_rationale:`; `cluster_root:` + `lattice cluster` BFS walk; `module_owner:` + `related_files:` fields; `lattice sync` groups CLAUDE.md by owner when set. Six new CLI commands: `handoff`, `next`, `timeline`, `verify`, `ci-check`, `pr-body`. Fuzzy match with interactive disambiguation; `show` prints all matches. Bash + zsh tab completion. `prepare-commit-msg` hook warns on open blockers. One-shot `migrate-v0.7.sh` migration script.
- **v0.8** — cross-dimension dedupe by fingerprint + rule (one finding, one report); `Closes-Lattice: <id>` commit-message convention; bundle/related-finding linking; JSON Schema for finding YAML validation
- **v1.0** — pre-push hook blocking on open CRITICAL, spec written after v0.8 real usage

See `CHANGELOG.md` for full version history.

---

## License

MIT — see `LICENSE`.

---

*Built because docs that drift from code become lies, and lies become incidents.*
