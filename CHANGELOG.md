# Changelog

All notable changes to Lattice are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

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
