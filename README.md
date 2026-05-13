# Lattice

> **Audit framework for keeping docs aligned with code.** Doc-vs-code drift, scale risks, security exposures — every finding grounded in a `file:line` citation.

Lattice ships six slash commands for Claude Code:

| Command | Does |
|---|---|
| `/audit <doc-path>` | Doc-vs-code drift; rewrites docs in contract format |
| `/scale-audit <module-path>` | Horizontal-scaling killers (in-memory state, `setInterval` crons, in-process rate limiters) |
| `/security-audit <module-path>` | Auth gaps, signature bypass, secret leaks, IDOR, OWASP Top 10 |
| `/flow-audit <module-path>` | Customer-flow gaps for conversational AI and multi-step request flows |
| `/audit-sweep <project-root>` | Runs the in-scope dimensions across every module via one dispatch per module; aggregates into one manifest |
| `/lattice-fix <finding-id>` | Auto-fixes one low-risk PATCH_DOC finding by dispatching a Haiku subagent, verifying, closing — gated against CRITICAL/HIGH/BLOCKER, security, and cluster findings |

Every finding cites a file and line. Every verdict requires evidence. Audits stop at human-approval gates — Lattice never auto-applies fixes or auto-commits.

---

## 30-second quickstart

```bash
# 1. Install
curl -fsSL https://raw.githubusercontent.com/IsaamMJ/Lattice/main/scripts/install.sh | bash

# 2. cd into the project you want to audit, then in Claude Code:
/audit-sweep .

# 3. Findings land in .lattice/findings/open/<TIER>-<module>-<rule>.yml

# 4. Triage with the lattice CLI:
~/.claude/lattice/scripts/lattice list                    # see open findings
~/.claude/lattice/scripts/lattice show <id>               # inspect one
~/.claude/lattice/scripts/lattice close <id> --reason fixed --commit HEAD
~/.claude/lattice/scripts/lattice defer <id> --until 2026-07-01 --reason "blocked on backend"
~/.claude/lattice/scripts/lattice sync                    # regenerate CLAUDE.md from YAML
~/.claude/lattice/scripts/lattice usage                   # see local feature usage

# (alias `lattice=~/.claude/lattice/scripts/lattice` in your shell rc to drop the path)
```

Expected output:
```
[SWEEP] Module 1/5 starting: src/modules/payments (dimensions: audit, scale, security)
[SWEEP] Module 1/5 complete: src/modules/payments — audit=12OK/3DRIFT scale=0B/2R security=1C/4H
[SWEEP] Module 2/5 starting: src/modules/admin ...
...
Lattice sweep complete. Manifest: .lattice/findings/sweeps/<sweep_id>.yml
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

This copies `commands/*.md` to `~/.claude/commands/`. Commands appear bare: `/audit`, `/scale-audit`, `/security-audit`, `/flow-audit`, `/audit-sweep`.

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

## Architecture (v0.7)

**Findings as a structured YAML database.** Each finding is one file:
- Open: `.lattice/findings/open/<TIER>-<module>-<rule>.yml`
- Closed: `.lattice/findings/closed/<TIER>-<module>-<rule>.yml`

Open/closed lives in the path; triage status and lifecycle details live in YAML fields. Operate via the `lattice` CLI: `lattice close <id> --reason fixed --commit <sha>`, `lattice reopen <id> --reason <text>`, `lattice defer <id> --until <date>`, `lattice list`, `lattice show <id>`, `lattice sync`. Run `lattice help` for the full surface. The CLAUDE.md checklist is regenerated from YAML truth between `<!-- lattice:checklist:start -->` markers — never edited by hand inside the markers.

**Module-scoped dispatch (from v0.5).** `/audit-sweep` sends one Sonnet sub-agent per module that runs all in-scope dimensions inline. A 5-module sweep = 5 dispatches (not 15). Anthropic prompt caching reuses the methodology library across module dispatches at ~90% discount.

**Standalone.** Works without `oh-my-claudecode` — same methodology, same verdict quality, slightly more tokens.

See `docs/finding-schema.md` for the YAML schema every skill conforms to.

---

## Usage tracking and updates

Lattice keeps usage analytics local to each audited project. Command events are appended to `.lattice/usage/events.jsonl` and record command name, flag shape, timestamp, Lattice version, and project basename. They do not record finding slugs or file paths.

```bash
lattice usage
lattice usage --since 30 --unused 90
lattice usage --json
```

Project behavior is controlled by `.lattice/config.yml`:

```bash
lattice config init
lattice config show
lattice update --check
lattice update --enable-auto   # opt this project into automatic updates
```

Default update mode is `notify` after config is initialized. Use `updates.mode: auto` for your own active projects, and `notify`, `pinned`, or `off` for client or production-sensitive repos.

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
- **v0.6.6.1** — same-day patch from v0.6.6 retest. `lattice sync` (no `--check`) now exits 2 on parse error (was relying on `set -e` propagation through the dispatcher function, unreliable on Git Bash). Legacy closed YAMLs without `closed_by_commit` no longer block sync — regen auto-derived the SHA from the legacy `closed/<sha>/` parent dir when the field was missing
- **v0.6.6.2** — regenerated CLAUDE.md hint comment now points at the `lattice` CLI (`lattice help`) instead of the non-existent `scripts/lattice-close.sh` path. Distribution-bug fix from a flow-audit debrief.
- **v0.6.6.3** — parser robustness from a heavy-use review. Strips leading UTF-8 BOM (PowerShell 5.1 cause), tolerates `---` document separator, line-1 errors include a fix hint. New `lattice validate` subcommand collects all per-file parse/schema errors instead of fail-fast.
- **v0.6.7** — audit-skill rewrite. Killed the `.lattice/findings/sweep-<ts>.md` markdown summary (dual source of truth was the bug). New sweep manifest at `.lattice/findings/sweeps/<sweep_id>.yml` with `auditor_model` / `duration_ms` / `skipped` / `runtime_warnings[]`. New `lattice sweep-id` generates deterministic `<YYYYMMDD><6-hex>` IDs. `/flow-audit --scope a,b,c` for multi-module flows. New optional `relates_to: [slug, ...]` finding field. TTD-silent → code is ground truth; DRIFT only on explicit contradictions; OK-finding emission required.
- **v0.7.12** (current) — half-staged git state fix. `lattice close` / `lattice reopen` now auto-stage both sides of the open/⇄closed/ move so a single `git commit` captures the full lifecycle (git detects it as a rename). Reported from real team usage; eliminates the recurring "naive `git add closed/` ships the add but not the delete" foot-gun. Tests: 44 → 46. **Last 0.7.x patch — v0.8.0 next ("Closed Loops": headless audit + auto-fix + bug-report-back).**
- **v0.7.11** — pre-commit close workflow fix. Reported by a project actively using Lattice: the natural `edit → close → commit` flow stamped `closed_by_commit` with the previous SHA, requiring a manual rewrite. New: `lattice close --pending` (writes `__PENDING__` sentinel), `lattice resolve-pending` (batch-replaces with HEAD short SHA), and optional `scripts/post-commit-resolve-pending.sh` git hook (auto-creates a follow-up `lifecycle:` commit so stamped SHA matches and stays reachable — no amend-orphan problem). Tests: 40 → 44.
- **v0.7.10** — milestone axis. New: optional `milestone:` field on findings (free-form: `p0-launch`, `v1.0`, `post-launch`) and `lattice list --milestone <name>` filter. Separates launch priority from severity tier — a LOW finding can be P0 for launch. Tests: 39 → 40. **v0.8.0 reserved** for cross-dimension dedupe, `Closes-Lattice:` commit convention, and JSON Schema validation.
- **v0.7.9** — cross-finding state. New: `lattice changelog --since <date>` (renders closed findings as release-note markdown, grouped by close_reason then tier); optional `blocked_by:` field on findings; `lattice list --unblocked`/`--blocked` partition. Solves "what shipped in May?" and "what's actually ready to work on vs. waiting on a vendor?" without blurring the file:line boundary. Tests: 35 → 39.
- **v0.7.8** — discoverability + stakeholder export. New: `lattice doctor` (first-run setup diagnosis, PASS/WARN/FAIL with fix hints) and `lattice export --format markdown` (tier-grouped table for sharing with non-CLI humans, with `--tier`/`--dimension`/`--module`/`--closed` filters). First Tier-2 features — read-only renders over existing data, no schema changes. Tests: 31 → 35.
- **v0.7.7** — real-usage bug-fix release from a second project's week of dogfooding. Fixed: `lattice show <hex-id>` lookup (id field is now a search key, not just slug); OK findings no longer counted as "actionable" in `lattice sync` output (rendered under separate `## Acknowledged` section); script header version drift (was "v0.7.1" inside v0.7.6 file); `update.sh` project-local script detection (opt-in sync via `LATTICE_SYNC_PROJECT_LOCAL=1`); regen-marker warning strengthened. Feature requests (epic/milestone/blocked_by fields, markdown export, decision records) explicitly **rejected** as scope creep — Lattice stays narrow on code-anchored findings with commit-SHA lifecycle. Tests: 30 → 31.
- **v0.7.6** — stress-hardened release. Pre-deployment gauntlet expanded `scripts/test-lifecycle.sh` from 15 → 29 regression tests (+93% coverage). Locked in: input safety (empty/whitespace/shell-metachar ids), `--commit HEAD` resolution, multi-line rationale block scalars, 5x close→reopen YAML integrity, BOM-prefixed YAML, invalid dimension / non-integer / negative line rejection, markdown escape, duplicate CLAUDE.md marker safety, `reopen --reason` enforcement, `id-gen` determinism, 100-finding sync perf (~2s). Confidence 8.5/10 — green-lit for multi-project deployment.
- **v0.7.5** — parallel `/lattice-fix` scale test + cross-file drift sweep. Dispatched 6 Haiku subagents in parallel across `commands/{audit,scale-audit,security-audit,flow-audit}.md` to fix identical YAML-example drift (pre-v0.7 `id:` algorithm including line number; `sweep_id` annotated as 12-char hex when actual is 14-char). All 6 verified independently and closed. Cumulative: 12-for-12 Haiku auto-fix tally across v0.7.3 → v0.7.5, ~$0.05 total Haiku cost.
- **v0.7.4** — first auto-fix lane shipped. `/lattice-fix <finding-id>` slash command auto-fixes one low-risk Lattice finding via Haiku subagent dispatch with eligibility gate (refuses CRITICAL/HIGH/BLOCKER, security, cluster findings, non-PATCH_DOC), independent verify-before-close, and failure-feedback log under `.lattice/handoff-feedback/<rule>.md` for refining the handoff brief template over time. Dogfooded on first real run: 1 DRIFT auto-fixed in 8s / 35K tokens / 2 tool uses (cumulative 4-for-4 clean on single-line PATCH_DOC across the v0.7.3/v0.7.4 dogfood).
- **v0.7.3** — schema-doc self-audit + first Haiku auto-fix dogfood. Ran `/audit docs/finding-schema.md` on Lattice itself, surfaced 3 DRIFTs + 1 OK, auto-fixed all 3 DRIFTs by dispatching a Haiku subagent per finding via `lattice handoff <id>` brief → Agent dispatch → independent verify → close cycle (3-for-3 clean, ~9s and ~35K tokens each on single-line PATCH_DOC). Also fixed a `lattice handoff` bug where `yaml_field` stripped trailing `"` independently of a leading one (truncated titles ending in quoted phrases like `code points at "lattice help"`).
- **v0.7.2** — self-audit pass. `/audit` run against Lattice's own README + scripts surfaced 2 P0 and 2 HIGH bugs; all fixed before tag. P0: `lattice close ""` no longer silently destroys data; `close → reopen → close` cycle no longer corrupts YAML (awk-based block-scalar continuation strip in both close.sh and reopen.sh). HIGH: `--commit HEAD` now resolves through `git rev-parse`; reopen strips `close_reason`/`closure_rationale` too. New: `lattice usage --global` reads `~/.claude/lattice/usage/global.jsonl` aggregated across every project — maintainer dashboard, never surfaced into client Claude sessions. Test suite 11 → 15.
- **v0.7.1** — repo-local usage analytics (`lattice usage`), project config (`lattice config init|show`), and update checks/auto-update controls (`lattice update --check|--self|--enable-auto|--disable-auto`). Usage events stay local in `.lattice/usage/events.jsonl` and record command/flag shape, not finding slugs or file paths.
- **v0.7.0** — major release from real-use feedback (36 findings / 29 closed / 8 commits on jiive Lumi). Flat layout (`open/<slug>.yml`, `closed/<slug>.yml`); stable `id:` algorithm SHA1(dim:rule:file:ctx)[:12] surviving line shifts; `close_reason:` enum + `closure_rationale:`; `cluster_root:` + `lattice cluster` BFS walk; `module_owner:` + `related_files:` fields; `lattice sync` groups CLAUDE.md by owner when set. Six new CLI commands: `handoff`, `next`, `timeline`, `verify`, `ci-check`, `pr-body`. Fuzzy match with interactive disambiguation; `show` prints all matches. Bash + zsh tab completion. `prepare-commit-msg` hook warns on open blockers. One-shot `migrate-v0.7.sh` migration script.
- **v0.8** — cross-dimension dedupe by fingerprint + rule (one finding, one report); `Closes-Lattice: <id>` commit-message convention; bundle/related-finding linking; JSON Schema for finding YAML validation
- **v1.0** — pre-push hook blocking on open CRITICAL, spec written after v0.8 real usage

See `CHANGELOG.md` for full version history.

---

## License

MIT — see `LICENSE`.

---

*Built because docs that drift from code become lies, and lies become incidents.*
