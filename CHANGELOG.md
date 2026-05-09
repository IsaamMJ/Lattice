# Changelog

All notable changes to Lattice are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [0.6.6] — 2026-05-09

Bug-fix + feature patch from the first day of jiive Lumi real-use feedback. Four bugs from the audit-team session, two new subcommands they asked for, one schema expansion to unstick stuck findings.

### Fixed (CLI dispatcher bugs in v0.6.5)
- **`lattice show <id>` now resolves three input forms.** Was: only filename slug worked, and a non-existent literal path was silently passed through to `cat`. Now: (1) exact filename slug, (2) `<module>/<rule>` display format from `lattice list`, (3) substring of basename. Filename existence is checked before being added to the match set, so `nullglob`'s literal-path leak is closed.
- **`lattice list --module <X>` now substring-matches case-insensitively against the `module:` field.** Was: exact-match only, so `--module booking` returned 0 results when findings had `module: src/modules/booking`. Now: `--module booking` matches that substring.
- **`lattice list --due-for-review` shows a friendlier empty-state message** ("0 finding(s) past their defer_until date") instead of the generic count.
- **Help text now defines what `<id>` accepts** — slug, `<module>/<rule>`, or basename substring.

### Fixed (regenerate.sh exit-code semantics)
- **`lattice sync` and `lattice sync --check` now use distinct exit codes.** Was: any failure returned 1, indistinguishable from drift. Now:
  - `0` — clean, no drift, no errors
  - `1` — drift detected (`--check` only): regen would change the markered block
  - `2` — fatal: parse error, schema violation, malformed CLAUDE.md markers, or unwritable output
- This lets CI distinguish "needs `lattice sync` to fix CLAUDE.md" (1) from "broken finding YAML, human attention required" (2). Pre-commit hooks running `lattice sync --check && deploy` will no longer silently green-light a deploy with malformed finding state.
- Affected exit paths: `loadAll` parse errors, invalid `status:` field, malformed checklist markers, marker order inversion, write errors (EACCES/EPERM/other).

### Added — schema expansion
- **Dimension allowlist now accepts `configuration`, `quality`, `product`** alongside the original `audit | scale | security | flow | coverage`. Real auditor sessions surfaced legitimate findings that didn't fit the original five dimensions; the regen used to reject them with `invalid 'dimension'`, blocking sync. The three new dimensions behave like `audit` and `coverage` — no per-tier required fields. `docs/finding-schema.md` updated with their meanings.

### Added — new CLI subcommands
- **`lattice triage [--module M] [--tier T] [--status S] [--dimension D]`** — interactive walk through filtered open findings. Per-finding actions: `[c]lose` / `[d]efer` / `[s]kip` / `[e]dit` (in `$EDITOR`) / `[v]iew` / `[q]uit`. Replaces the manual editor-per-YAML workflow when a sweep produces 50+ findings. Requires a TTY; refuses to run in non-interactive shells.
- **`lattice bulk-close --pattern <glob> [--commit <sha>] [--yes]`** — closes every open finding whose slug matches the glob in one shot. Closes the "one PR fixed 5 LOW findings, now I run 5 close commands" friction. Confirms by default; `--yes` skips confirmation; refuses without `--yes` when stdin is not a TTY.

### Not in this release (deferred to v0.6.7+)
- **Audit-skill → YAML directly.** The team flagged that `/audit-sweep` still writes a markdown summary that has to be hand-converted to YAML findings under `.lattice/findings/open/<sweep_date>/`. The skill should write YAML directly + register a sweep manifest. This is a `commands/audit-sweep.md` rewrite, larger than a CLI patch — going next.
- v0.7 fingerprint + flatten + close-reason still drafted at `docs/v0.7-fingerprint-spec.md`, not yet implemented.

## [0.6.5] — 2026-05-09

Discoverability release. Real-usage feedback from a jiive Lumi audit session revealed that operators were doing file moves and CLAUDE.md edits by hand because the lifecycle scripts were on disk but invisible — `install.sh` deploys them to `~/.claude/lattice/scripts/` with no `lattice` binary on `PATH` and no `--help`. v0.6.5 fixes the discoverability layer without changing the schema.

### Added
- **`scripts/lattice` — unified CLI dispatcher.** One command, eight subcommands: `lattice close|reopen|sync|defer|list|show|sweeps|version|help`. Wraps the existing `lattice-close.sh` / `lattice-reopen.sh` / `lattice-regenerate.sh` so users learn one verb instead of three script paths. `lattice help` documents every flag.
- **`lattice defer` + `defer_until` / `deferred_at` / `defer_reason` fields.** v0.6.3 added `status: deferred` but no expiry. The audit feedback hand-rolled these fields under a "Until 2026-07-08" CLAUDE.md subsection — formalizing them now. Optional, additive, non-breaking.
- **`lattice list --due-for-review`.** Surfaces deferred findings whose `defer_until` date has passed. Closes the "stale findings rot silently" gap.
- **`lattice list` filters.** `--module`, `--tier`, `--status`, `--dimension`. Read-only view over `.lattice/findings/open/`.
- **`lattice show <id>`.** Pretty-print one YAML with header.
- **`lattice sweeps`.** Lists `.lattice/findings/sweeps/*.yml` if present. Manifest writer planned for v0.7; stub message until then.

### Distribution
- `scripts/install.sh` and `scripts/update.sh` ship the `lattice` dispatcher alongside the `.sh` helpers (SCRIPTS array grows from 5 to 6 entries).
- `scripts/validate.sh` distribution-coverage check now expects the dispatcher in installer arrays. Adds `bash -n` syntax check on `lattice` and `lattice-reopen.sh`.

### Schema docs
- `docs/finding-schema.md` documents the v0.6.5 defer fields under the existing v0.6.3 status section. Same shape (optional, default-absent), same regen behavior.

### Not in this release (still on the v0.7 docket)
- Fingerprint algorithm change (drop `line` from `id:`) — drafted in `docs/v0.7-fingerprint-spec.md`, not implemented.
- Flatten `open/<date>/` and `closed/<sha>/` directories — drafted, not implemented.
- Close-reason taxonomy on `lattice-close.sh` — drafted, not implemented.
- Sweep manifest writer (`.lattice/findings/sweeps/<id>.yml`) — `lattice sweeps` reads them, nothing writes them yet.
- JSON Schema for finding YAML.
- `Closes-Lattice: <id>` commit-message hook.

These need v0.7 because they're either schema-breaking (fingerprint, flatten) or larger than a discoverability patch.

## [0.6.4.1] — 2026-05-04

Five bugs from a second hostile-fixture stress pass against v0.6.4. Same class of distribution-list drift the v0.6.3.1 patch fixed for lifecycle helpers — this time for the new `/flow-audit` command. Plus three real schema-enforcement gaps.

### Fixed (distribution)
- **`scripts/install.sh` did not ship `/flow-audit`** — fresh installs from main exposed only the original four commands, even though README claimed v0.6.4 had five.
- **`scripts/update.sh` had the same gap** — existing installs would never receive `/flow-audit` through the documented update path.

### Fixed (schema enforcement — `lattice-regenerate.sh`)
- **Unknown dimensions passed validation.** `dimension: bananas` rendered into CLAUDE.md without complaint. Now enforces the enum: `audit | scale | security | flow | coverage`.
- **Dimension+tier required fields not enforced.** Schema says security HIGH/CRITICAL require `owasp`/`exploitability`/`blast_radius`/`attack_scenario`/`secure_code_example`; scale BLOCKER/RISK require `failure_mode`; audit INTENTIONAL requires `intentional_citation`; flow HIGH/CRITICAL require `impact`. Regen now enforces all of these per `docs/finding-schema.md`.

### Fixed (drift)
- **`commands/audit-sweep.md` ignored flow + coverage.** Argument parser only recognized `audit | scale | security`. Now accepts `flow` and `coverage` as opt-in dimension tokens, with explicit documentation that they are NOT auto-included in the default sweep until `/flow-audit` proves itself in real use.

### Added (validate.sh — structural drift gates)
- **Installer/updater coverage check.** Greps `commands/*.md` against `COMMANDS=(...)` arrays in install.sh / update.sh; greps `scripts/lattice-*.sh` and `migrate*.sh` against `SCRIPTS=(...)`. Fails CI if any file in the repo is missing from a distribution list. Catches the drift class permanently — same kind of bug shipped in v0.6.3 (lattice-reopen.sh) and v0.6.4 (flow-audit) can no longer slip past.

### Tests
- 3 new lifecycle cases: regen rejects unknown dimension; security HIGH without OWASP fails (and passes once OWASP fields added); flow HIGH without `impact:` fails. Existing fixtures retuned to MEDIUM/WATCH where they previously used HIGH/CRITICAL/RISK without the now-required dimension-specific fields. Suite at 31/31 passing.

## [0.6.4] — 2026-05-04

Schema additions for verifiable findings + new dimensions for customer-flow audits. Driven by jiive Lumi pilot feedback: "findings say what's wrong but not how to repro or how to verify the fix."

### Added (schema, all optional + forward-compatible)
- **`tests:` field** — list of acceptance criteria. Each entry is one line: scenario + expected outcome. When the finding is closed, these become the verification spec. Closes the "tested or eyeballed?" gap.
- **`simulate:` field** — list of mechanical reproducers (curl commands, admin-tool invocations, simulated inputs). Lets verification be repeatable without manual memory of how to trigger the bug.
- **`flow` dimension** — customer-journey gaps: happy path completeness, error handling on external calls, state-transition validation, type checks on user input, exit paths, abandonment timeouts, cleanup of stale state, multi-turn context preservation. Tiers: CRITICAL / HIGH / MEDIUM / LOW / OK. CRITICAL/HIGH require `impact:`.
- **`coverage` dimension** — module-surface audit (what does this module do? is it all tested/documented/used?). Tiers: HIGH / MEDIUM / LOW / OK.
- **`/flow-audit <module>` command** — 18 patterns across 4 tiers; same skeleton as `/security-audit` and `/scale-audit`; OMC fallback; subagent dispatch with structured JSON return.
- **`intentional_citation:` is now valid for any dimension** (previously documented as audit-INTENTIONAL only). Same field, broader applicability — `flow` OK findings now cite TTD/CLAUDE.md the same way audit OK findings do.

### Changed
- `lattice-regenerate.sh` YAML parser supports block-list form (`tests:\n  - "a"\n  - "b"`) in addition to inline lists. Required for findings to use the new fields without breaking regen.

### Tests
- New lifecycle test verifies `tests:` and `simulate:` block-lists parse cleanly through regen + render in CLAUDE.md without escape damage.

## [0.6.3.1] — 2026-05-04

Hardening patch from a hostile-fixture stress pass. Eight real bugs found, all P1 or P2.

### Fixed (lattice-close.sh)
- **Closed findings could be silently overwritten.** `mv` would replace an existing `closed/<sha>/<slug>.yml` without warning, destroying the earlier closed finding. Now refuses to overwrite, suggests `lattice-reopen.sh` or a different commit.
- **Multiline `--partial` text corrupted YAML.** Double-quoted scalars can't contain literal newlines; if `remaining` text had `\n`, `lattice-regenerate.sh` failed to parse. Now switches to YAML block scalar (`|`) form when input contains newlines.

### Fixed (installer / updater)
- **`scripts/install.sh` shipped 3 of 5 lifecycle helpers.** Fresh installs were missing `lattice-reopen.sh` and `migrate-status.sh` despite docs referencing them. Now ships all five.
- **`scripts/update.sh` had the same gap.** Existing installs would never receive the v0.6.3 helpers. Now mirrors install.sh.

### Fixed (lattice-regenerate.sh)
- **`line` field accepted non-integer values.** A finding with `line: not-a-number` rendered as `src/mod.ts:not-a-number`, weakening file:line evidence. Now validates integer-only.
- **Closed findings bypassed required-field validation.** A corrupted closed YAML rendered with `?` placeholders in "Recently closed" instead of failing fast. Now applies the same required-field check to closed findings.

### Fixed (drift)
- **README.md and CHANGELOG.md still claimed v0.6.2 was current** while manifests and schema were 0.6.3. Updated to v0.6.3.1.
- **`commands/audit-sweep.md` had internal drift** — methodology library told module agents to write legacy `audit-<module>-<ts>.md` files before later mandating YAML truth. Now consistent: YAML-per-finding only.

### Added (validate.sh)
- **Stale version reference check.** Greps README.md and CHANGELOG.md for outdated version strings; fails CI if any disagree with `plugin.json`.
- **Legacy path pattern check.** Greps `commands/*.md` for legacy `.cc-reef/` or `audit-<module>-<ts>.md` patterns; fails CI if any command has internal drift.

### Tests
- 4 new lifecycle test cases (overwrite-guard, multiline `--partial`, integer-`line` validation, closed-finding required fields). Suite now 25/25 passing.

## [0.6.3] — 2026-05-03

Triage clarity + drift gate. Driven by jiive dogfood feedback after closing 28 findings using v0.6.

### Added
- **`status:` field on open findings** — `open` | `in_progress` | `deferred` | `wont_fix`. No more conflating deferred or in-progress findings with actionable ones in the directory listing.
- **`--partial` flag on `lattice-close.sh`** — keeps the finding in `open/`, sets `status: in_progress`, appends to `partial_commits: [...]`, sets `remaining:`. Partial fixes stay first-class instead of hiding inside closed YAMLs as prose notes.
- **`scripts/lattice-reopen.sh`** — moves `closed/<sha>/<slug>.yml` back to `open/<today>/<slug>.yml`, sets `previously_closed_in: <sha>`, optional `--reason "<text>"`. Regression handling becomes a first-class workflow.
- **`scripts/migrate-status.sh`** — one-shot, idempotent migrator that adds `status: open` to existing pre-v0.6.3 findings.
- **`lattice-regenerate.sh --check`** — dry-run mode that diffs the markered block in CLAUDE.md against what regen would produce; non-zero exit on drift.
- **CLAUDE.md drift gate in `validate.sh`** — runs `--check` automatically; manual edits to the markered section now fail CI.

### Changed
- **CLAUDE.md output groups by status:** Open (by tier) → In progress → Deferred → Won't fix → Recently closed. In-progress entries show `partial_commits:` and `remaining:` text inline, so partial concerns can't hide.
- **SHA convention standardized to 7-char short SHA** across `closed/<sha>/`, `closed_by_commit:`, `partial_commits:`, `previously_closed_in:`. `lattice-close.sh` truncates automatically.

### Fixed
- **Regen accumulated trailing newlines.** `body` ended with `\n` and the slice after the close marker also started with `\n`, so each invocation grew CLAUDE.md by one byte. Fixed by dropping body's trailing newline; first-install branch adds it explicitly.

### Tests
- 7 new lifecycle test cases covering SHA truncation, `--partial` round-trip + append, full close after partial, reopen + idempotency, `--check` drift detection, status grouping, invalid status rejection, migrator idempotency. Suite at 21/21 passing.

## [0.6.2] — 2026-05-02

Correctness patch. Seven real bugs in v0.6 lifecycle scripts caught by external review (Codex / Cursor / Antigravity sessions, fixes triaged here). Adds the protection layer that should have caught these in the first place.

### Fixed (lattice-close.sh)
- **Re-closing a finding duplicated lifecycle fields.** Closing a finding that was already closed (or had stale lifecycle metadata) appended a second `closed_at` / `closed_by_commit` / `closed_by_pr` block instead of replacing. Now strips any prior lifecycle block before writing canonical fields.
- **Silent "unknown" commit fallback outside git repos.** Previously `git rev-parse --short HEAD || echo "unknown"` filed findings under `closed/unknown/`. Now hard-fails with a clear error message; require `--commit <full-sha>` to proceed outside git.
- **Schema contract violation (short SHA vs full SHA).** Schema declared full SHA; code defaulted to `--short`. Now defaults to full SHA per schema.
- **Missing arity validation on `--commit` / `--pr`.** Calling with a flag but no value produced confusing shell errors. Now fails with a clean usage message.
- **Nondeterministic close on duplicate filenames across sweep dirs.** Filesystem traversal order decided which finding got closed. Now sorts matches lexicographically; warns if multiple match.

### Fixed (lattice-regenerate.sh)
- **Malformed YAML rendered as garbage (`?` placeholders) instead of failing.** Now validates required fields (`rule`, `file`, `line`) per finding; throws and exits 1 on parse failure or missing fields.
- **Unescaped Markdown injection in CLAUDE.md.** Finding fields containing backticks, pipes, brackets, or newlines could corrupt the regenerated checklist. Now escapes all field values before injection.
- **Substring marker replacement was destructive on duplicate markers.** Two `<!-- lattice:checklist:start -->` markers + one end marker would silently delete content between them. Now requires exactly one start + one end marker; refuses to write otherwise.
- **No try-catch around `fs.writeFileSync`.** EACCES / EPERM (read-only CLAUDE.md) threw raw Node stack trace. Now produces a friendly error with the file path.
- **Future timestamps treated as recently-closed.** A bad clock could surface nonexistent closures. Now requires `closed_at <= now`.
- **Non-numeric `--days-closed` silently produced empty output.** Now validates non-negative integer; rejects with clear error.

### Added (the protection layer)
- **`scripts/test-lifecycle.sh`** — 8 functional fixture tests covering each of the bugs above. Each test creates a disposable git repo, exercises the real script end-to-end, and asserts on the actual outcome (not just exit code). This is the layer v0.5/v0.6/v0.6.1 lacked: `validate.sh` only ran syntax checks, so silent-output bugs slipped through. Now those tests run on every push.
- **`scripts/validate.sh` step 9** — runs `test-lifecycle.sh` automatically. CI workflow already invokes `validate.sh`, so test failures now block push to GitHub Actions just like manifest errors do.

### Why this happened, and why this fix prevents recurrence

v0.6.0 + v0.6.1 shipped because the only automated check was `validate.sh`, which verified file *existence* and *syntax*, not *behavior*. The bugs only surface at runtime: re-closing a finding, processing malformed YAML, encountering exotic field values, dealing with duplicate markers. None of those scenarios were exercised in CI.

The 8-test fixture suite added here exercises each of those scenarios. Going forward, regressions to lifecycle behavior fail `validate.sh` locally and in CI before any push lands.

### Discarded from the external review

- Race-condition locking — premature for single-user CLI use; reconsider when multi-user becomes a real scenario.
- js-yaml dependency — would silently accept nested YAML the schema doesn't permit; the strict hand-rolled parser fails fast on schema drift, which is the right behavior for a contract-first tool.
- Checksum / integrity verification on install/update — defer to v0.7 (transaction pattern + checksums together).
- Cross-platform shell test matrix — defer; current Bash-on-Windows works via Git Bash, which is the documented path.

## [0.6.1] — 2026-05-02

Patch release. Three real bugs in v0.6 caught within minutes of public push.

### Fixed
- **`update.sh` and `install.sh` only pulled commands** — leaving `scripts/lattice-*.sh` and `docs/finding-schema.md` missing. Anyone upgrading to v0.6 ended up with v0.6 commands referencing files that didn't exist on their system. Both scripts now mirror the full surface: commands → `~/.claude/commands/`, helper scripts → `~/.claude/lattice/scripts/`, schema docs → `~/.claude/lattice/docs/`.
- **Standard-mode `/audit-sweep` never committed findings** — only auto-mode committed. With per-finding YAML this matters more than v0.5 markdown ever did: a sweep writes 50 dangling YAML files and exits, easy to lose. Standard mode now always commits `.lattice/findings/` (separate from the auto-apply behavior, which still controls whether CLAUDE.md is auto-committed).
- **No v0.5 → v0.6 migration path** — `migrate.sh` now accepts `--from-v0.5` to archive existing v0.5 markdown findings to `.lattice/archive/v0.5/` so they don't pollute the new YAML layout.

### Added
- **Version sentinel** — `install.sh` and `update.sh` write the installed version to `~/.claude/lattice/VERSION`. `update.sh` reports the previous-to-new version delta.

### Why a patch on the same day

v0.6.0 went public, the user immediately tested the upgrade path, and three correctness gaps surfaced. Shipping the fix as v0.6.1 (not as v0.7) preserves the "one feature per minor version" discipline — v0.7 stays scoped to `lattice diff` for incremental sweeps.

## [0.6.0] — 2026-05-02

Foundation release. Reframes findings from "prose-with-checkboxes-in-CLAUDE.md" to "structured YAML database with lifecycle on disk." Single biggest design change since v0.1. Closes 5 real gaps caught in v0.5 production use on jiive-backend.

### Added
- **`docs/finding-schema.md` rewritten** — defines one YAML file per finding (not one Markdown per audit). Status lives in the file path (`open/<date>/...yml` vs `closed/<commit-sha>/...yml`). Stable filename slug = `<TIER>-<module>-<rule>.yml` enables trivial git diff between sweeps.
- **`scripts/lattice-close.sh`** — moves a finding from `open/` to `closed/<commit-sha>/`, appends `closed_at`/`closed_by_commit`/`closed_by_pr` fields. Idempotent.
- **`scripts/lattice-regenerate.sh`** — node-based generator that reads YAML truth and rewrites the CLAUDE.md checklist between `<!-- lattice:checklist:start -->` / `<!-- lattice:checklist:end -->` markers. Anything outside the markers is preserved (manual triage notes go in a sibling section). Emits both open findings (grouped by tier) and recently-closed findings (last 7 days, configurable).
- **Sweep manifest** — each sweep writes `.lattice/findings/sweeps/<sweep_id>.yml` with totals + opened/unchanged/closed-since-last/regressed finding IDs. Powers v0.7's `lattice diff`.

### Changed
- **All four commands emit YAML now** — `/audit`, `/scale-audit`, `/security-audit` write one YAML file per finding instead of one combined Markdown file per audit. `/audit-sweep` runs `lattice-regenerate.sh` after dispatches complete to refresh the CLAUDE.md checklist from YAML truth.
- **CLAUDE.md becomes a generated view** — the Open/Closed checklist sections are owned by Lattice and rewritten on every sweep. Manual edits inside the markers are clobbered. Manual edits outside the markers are preserved.
- **`scripts/validate.sh` extended** — checks v0.6 helpers exist + parse cleanly, schema doc declares "one YAML file per finding" contract.

### Why this redesign

v0.5 production use on jiive-backend surfaced 5 design gaps:
1. Findings disappeared (per-module .md files easy to lose, not committed by convention)
2. No status tracking (open/fixed/deferred lived only as `[ ]`/`[x]` in CLAUDE.md prose)
3. Single-pass overwrites — no way to see "what's new since last sweep"
4. Cross-dimension dupes (same defect in security + scale with different wording)
5. One-way linkage (PRs reference findings, but findings don't track which commit fixed them)

v0.6 fixes 1, 2, 3, and 5 directly via the schema. v0.7 adds `lattice diff` for incremental sweeps. v0.8 adds cross-dimension dedupe.

### Migration from v0.5

Existing v0.5 markdown findings (`.lattice/findings/*.md`) are not auto-converted. They remain as historical artifacts and coexist with v0.6 YAML findings. To start fresh, archive them:
```bash
mkdir -p .lattice/archive/v0.5
mv .lattice/findings/*.md .lattice/archive/v0.5/
```

### Recommended `.gitignore` policy

Commit `.lattice/findings/` to git (auditability + diff). Consider gitignoring `.lattice/cache/` and `.lattice/tmp/` if those directories appear.

### Not yet (deferred to later versions)

- `lattice diff <since-sweep>` — v0.7
- Cross-dimension dedupe by `file:line` — v0.8
- Pre-push hook blocking on open CRITICAL — v1.0

## [0.5.0] — 2026-05-02

Hardening release. No new commands. Seven upgrades to existing surface — focused on correctness, efficiency, and standalone usability before adding more features.

### Added
- **`docs/finding-schema.md`** (U5) — output schema contract every skill conforms to. Required fields, conditional fields per dimension, verdict tiers, master-sweep file format. Stability promise follows SemVer. Why we didn't adopt SARIF documented inline.
- **`scripts/migrate.sh`** (U6) — moves legacy `.cc-reef/audits/` findings to `.lattice/findings/`. Idempotent, collision-safe, removes empty parent dirs.
- **OMC fallback section in every skill** (U4) — `/audit`, `/scale-audit`, `/security-audit` each declare standalone-mode behavior up front. Same methodology, same verdict quality without oh-my-claudecode installed; slightly more tokens. No degraded mode.

### Changed
- **`/audit-sweep` refactored to module-scoped dispatch** (U3) — instead of invoking three separate skills per module (15 sub-agent dispatches for a 5-module sweep), the sweep now dispatches **one Sonnet sub-agent per module** that runs all in-scope dimensions inline. 5 cold starts instead of 15. Anthropic prompt caching reuses the methodology library across all module dispatches at ~90% discount. Cross-cutting analysis preserved within each module.
- **Sequential echo-back guard in `/audit-sweep`** (U1) — every module dispatch now requires `[SWEEP] Module K/N starting: <path>` before, and `[SWEEP] Module K/N complete: <path> — <counts>` after. Skill MUST stop and report drift if either echo is missing or out of order. Hardens the v0.4 "NEVER parallel by default" rule from text-only guidance into an audit trail.
- **`scripts/validate.sh` extended with cross-skill consistency checks** (U2) — now also validates: plugin/marketplace version match, output-path consistency (`.lattice/findings/` everywhere, no `.cc-reef/` regression), every command has a Tool-usage section, README quickstart commands all exist as files, `docs/finding-schema.md` exists.
- **`README.md` polish** (U7) — 30-second quickstart with expected output up top, architecture section explaining v0.5 dispatch model, migration note for pre-v0.5 users, roadmap rewritten to reflect actual planned versions (v0.6 `/checklist-sweep`, v0.7 `/audit-diff`, v0.8 `/mock-sweep`).

### Why no new features
v0.4 shipped four commands. We haven't validated each one solo on enough real projects to know what's truly missing. v0.5 hardens the existing surface so v0.6+ features land on solid foundations. Disciplined-ambition principle: best-in-class per feature, not feature-pile.

### Not yet recommended for public adoption
Lattice is being hardened on real projects (jiive-backend, Lumi). Public marketplace push deferred until v1.0 spec is written based on real usage data.

## [0.4.0] — 2026-05-02

### Fixed
- **Output path drift**: all three skills (`/audit`, `/scale-audit`, `/security-audit`) wrote findings to `.cc-reef/audits/` (legacy reef path) while the README + docs said `.lattice/findings/`. All three now write to `.lattice/findings/` consistently. Existing files in `.cc-reef/audits/` are not migrated — they stay where they are; new audits go to the new path.
- **Sequential discipline made explicit in `/audit-sweep`**: the skill previously implied sequential execution but didn't enforce it. Real-world failure: a DXB session interpreted "for each module" as "in parallel" because hook reminders suggested parallel execution for independent tasks. The skill now states **"NEVER parallel by default"** with explicit reasoning (stop-condition gate, cross-cutting detection, token predictability). Opt-in `parallel` token allowed in $ARGUMENTS for future when needed.

### Why this matters
Both fixes are correctness, not features. The path drift would have confused every new Lattice user (docs say one path, files appear in another). The parallel drift would have broken the stop-condition gate that protects against runaway sweeps.

This is exactly the kind of drift Lattice itself catches — meta-validation that the methodology works.

## [0.3.0] — 2026-05-02

### Added
- **Selective sweep flags** — `/audit-sweep . [audit|scale|security]` now runs only the named dimensions. Multiple dimensions allowed: `security scale` runs both, skips doc audit. Without any flag, all three dimensions run as before.
- **Per-module filtering** — pass explicit module paths to audit only those modules: `/audit-sweep . security src/modules/payments src/modules/admin`. Without explicit paths, auto-discovers via `Glob src/modules/*/`.
- **Resolved plan printed upfront** — before running anything, the skill prints `Sweep plan: dimensions=[...], modules=[...], auto=true|false` so you can confirm what's about to run.

### Why this exists
Real friction point: after running full /audit-sweep once, you only need to re-run one dimension on one module after a code change. v0.2 forced a full re-sweep. v0.3 lets you say "only security on payments and admin" — saves ~70% of tokens for incremental audits.

### Backward compatible
- `/audit-sweep .` still runs everything (no breaking change)
- `/audit-sweep . auto` still works exactly as v0.2
- Old invocations with no flags behave identically

## [0.2.0] — 2026-05-02

### Added
- `/audit-sweep <root> auto` — opt-in auto-mode. When the `auto` token is present in the invocation, the skill automatically appends drafted HIGH/MEDIUM/RISK/WATCH checklist entries to `CLAUDE.md` and commits them at the end of the sweep. Saves one paste per sweep.

### Unchanged (deliberate)
- CRITICAL/BLOCKER findings are still NEVER auto-applied — they require explicit `fix <id>` or `fix all critical` from the user, regardless of mode. Methodology rule: "no auto-apply on architectural fixes."
- Default invocation (`/audit-sweep .` without `auto`) behaves exactly as v0.1: drafts the checklist block, waits for user `apply checklist` reply.

## [0.1.0] — 2026-05-02

Initial release.

### Added
- `/audit <doc-path>` — verifies every claim in a project doc against actual code with file:line evidence; distinguishes drift from deliberate removal; proposes contract-format rewrite.
- `/scale-audit <module-path>` — hunts horizontal-scaling killers (in-memory state, setInterval crons, in-process rate limiters, singleton assumptions); 4-tier verdict (BLOCKER / RISK / WATCH / OK).
- `/security-audit <module-path>` — hunts security exposures (auth gaps, signature bypass, secret leaks, IDOR, injection vectors); OWASP-tagged with attack scenarios + secure code examples; runs `npm audit` for dependency CVEs.
- `/audit-sweep <project-root>` — orchestrates all three audits across every module under `src/modules/`; aggregates into one master findings file with cross-cutting pattern detection.
- Methodology, contract-format spec, and reef postmortem in `docs/`.
- Sample audit findings + sample contract doc in `examples/`.
- `install.sh`, `update.sh`, `validate.sh` in `scripts/`.
- GitHub Actions workflow that validates plugin manifest + command frontmatter on every push.

### Notes
- Skills dispatch their heaviest step (claim verification, pattern hunting) to `oh-my-claudecode:executor` (Sonnet) when available; fall back to running in the main session if OMC is not installed.
- All audits stop at human-approval gates — no auto-applied fixes, no auto-commits.
