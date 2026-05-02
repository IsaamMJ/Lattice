# Changelog

All notable changes to Lattice are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

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
