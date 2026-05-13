# Changelog

All notable changes to Lattice are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [0.7.10] — 2026-05-13

Milestone axis. Final Tier-2 feature for the day. v0.8.0 reserved for the planned bigger scope (cross-dimension dedupe + Closes-Lattice commit convention + JSON Schema validation).

### Added
- **`milestone:` optional finding field** — free-form string (`milestone: "p0-launch"`, `milestone: "v1.0"`, `milestone: "post-launch"`). Separate axis from `tier:` — a LOW finding can still be P0 for launch, a HIGH finding can be post-launch. No enum, no required-format.
- **`lattice list --milestone <name>`** — filters open findings by exact milestone match. Excludes findings without the field. Lets you ask "what's left for the p0 launch?" without conflating launch priority with severity.

### Tests
39 → 40. New: list `--milestone` partitions correctly and excludes findings without the field.

### Boundary check
Same shape as `blocked_by` — annotation field on existing findings, not a new finding type. `milestone:` doesn't create a new tracking concept; it lets you tag findings that already exist for sequencing. Findings still require `file:line`.

### What's NOT in this release (saving v0.8.0 for it)
- Cross-dimension dedupe by fingerprint + rule (one finding, one report across audit/security/scale)
- `Closes-Lattice: <id>` commit-message convention + auto-close on merge
- Bundle/related-finding linking with cascade semantics
- JSON Schema for finding YAML validation (replaces the ad-hoc `validateFinding`)

That's the v0.8.0 scope. This release stays a patch bump.

## [0.7.9] — 2026-05-13

Cross-finding state — release-note generation + external-blocker tracking. Second Tier-2 batch. Still narrow on code-anchored findings; `blocked_by` is an optional annotation, not a new finding type.

### Added
- **`lattice changelog --since <YYYY-MM-DD> [--until <YYYY-MM-DD>] [--tier T] [--module M]`** — renders closed findings as release-note markdown. Groups by `close_reason` (Fixed → False positives → Won't fix → Out of scope → Duplicates), then by tier within each group. Emits `closed_by_commit` as a code-spanned ref. Filters compose. Solves "what shipped in May?" without manual stitching.
- **`blocked_by:` optional finding field** — free-form string (`blocked_by: "vendor X"` or `blocked_by: "legal review"`). No schema enforcement, no enum, no required-format. Just a flag.
- **`lattice list --unblocked` / `--blocked`** — partition findings by presence of `blocked_by`. `--unblocked` shows only findings ready to work on; `--blocked` shows only those waiting on external dependencies. Removes person-blocker noise from daily `lattice next` flow.

### Tests
35 → 39. New cases: list `--unblocked`/`--blocked` partition correctly, changelog renders closed findings grouped by reason, changelog requires `--since`, changelog rejects non-ISO date.

### Boundary check
- `changelog` is a read-only render of existing closed YAMLs. No schema change.
- `blocked_by` is an annotation field. Findings still need `file:line`. Cannot be used to file "build a landing page" findings — the boundary holds. The field is for "this code finding can't be closed until vendor X responds," not for tracking the vendor itself.

## [0.7.8] — 2026-05-13

Discoverability + stakeholder export. First Tier-2 features — both small, both immediately useful, neither blurs the Lattice/strategy boundary.

### Added
- **`lattice doctor`** — first-run UX. Diagnoses repo setup with PASS/WARN/FAIL per check across Environment (git, node, repo), `.lattice/` tree, CLAUDE.md integration, open-finding YAML health, and version/update-check freshness. Each failure ships with a one-line fix hint ("run `lattice config init`"). Exits non-zero if any FAIL, zero otherwise. Solves the "I don't know if this repo is set up correctly" first-run problem.
- **`lattice export --format markdown [--tier T] [--dimension D] [--module M] [--closed]`** — stakeholder-readable markdown render. Outputs a tier-grouped table (`| State | Module | Rule | Where | Title |`) suitable for sharing with non-CLI humans (CEO, designers, legal). Pipe-in-field escape so titles with `|` don't break tables. Filters compose. `--closed` includes closed findings for "what shipped" exports.

### Fixed
- `log_usage_event` no longer fires for `doctor` invocations. It was auto-creating `.lattice/usage/` and `.lattice/cache/` directories before `cmd_doctor` ran, making the "is `.lattice/` initialized?" check always pass. Doctor now sees the true initial state.

### Tests
31 → 35. New cases: doctor reports on clean setup, doctor fails when `.lattice/` missing (with helpful message), export renders tiered tables, export `--tier` filter excludes non-matching tiers.

### Boundary check
Both features are read-only renders over existing data. No schema changes. No new finding types. Still narrow on code-anchored findings with commit-SHA lifecycle.

## [0.7.7] — 2026-05-13

Real-usage bug-fix release. Issues surfaced by a second project actively using Lattice for a week. Features-as-requested-by-that-session **rejected** as scope creep (turning Lattice into Linear). Bugs-as-flagged **accepted** and fixed in batch.

### Fixed
- **`lattice show <hex-id>` now works.** Previously `show` only accepted slug forms; the `id:` field (first line of every YAML, natural to copy) wasn't a lookup key. New strategy: when the input looks like 8-40 hex chars, scan every YAML's `id:` field. Falls through to substring match if no hex match found.
- **OK findings no longer counted as "actionable".** `lattice sync` rendered `## Open findings (N actionable)` where N included OK-tier findings (audited and confirmed safe). They now render under a separate `## Acknowledged (N)` section. The `actionable` count is the real work-to-do count.
- **Script header version banner.** `scripts/lattice` line 2 said "v0.7.1" inside a v0.7.6 file — embarrassing on inspection. Now reads "v0.7.7" with a note that runtime version comes from plugin.json/VERSION sentinel.
- **`update.sh` detects project-local script copies.** Some projects pin a copy of `scripts/lattice*` next to their source. `update.sh` previously only refreshed `~/.claude/lattice/scripts/`, leaving project-local copies stale. Now detects `./scripts/lattice` and prints a sync hint; opt-in via `LATTICE_SYNC_PROJECT_LOCAL=1 bash scripts/update.sh` to actually overwrite them.
- **Regen-marker warning strengthened.** Added an explicit `<!-- WARNING: anything inside these markers is regenerated... -->` comment so hand-edits inside the `lattice:checklist:start/end` block are visibly transient. The fix is "edit YAML, not CLAUDE.md."

### Known limitations (documented, not bugs)
- **Auto-update only triggers on CLI invocation.** If no one runs `lattice ...` for a week, the version-check loop sleeps with it. Mitigation: enable `lattice update --enable-auto` for silent auto-pulls when checks do fire. Daemon-mode is not planned — adds OS-specific complexity for a problem solved by occasional invocation.
- **Hand-edits inside regen markers are not merged.** Regen overwrites by design — markers are a generated-only zone. To add notes to a finding, edit the YAML under `.lattice/findings/open/<slug>.yml` (the `notes:` field) — that survives regen and shows up in `lattice show`.

### Feature requests considered and rejected
The same session asked for: finding categories (`feature`/`dependency`/`decision`), `epic_id`/`milestone`/`blocked_by` fields, markdown export, sequencing/work-order, decision records. **Rejected as scope creep.** Lattice's value is narrow focus on code-anchored findings with commit-SHA lifecycle. Absorbing product-strategy work turns Lattice into a mediocre Linear/Jira clone. Boundary rule retained: *"If it has `file:line`, it goes in Lattice. Otherwise it stays in your product/strategy doc."*

### Tests
30 → 31 regression tests. New: OK-findings-not-actionable, hex-id lookup. All 31 pass.

## [0.7.6] — 2026-05-13

Stress-hardened release. Pre-deployment gauntlet across CLI dispatcher, YAML parser, lifecycle helpers, and regen pipeline. Expanded `scripts/test-lifecycle.sh` from 15 → 29 regression tests (+93% coverage). All 29 pass.

### Hardened (now regression-locked in CI)
- **Input safety:** empty / whitespace / shell-metachar finding ids rejected — no data loss, no command injection.
- **Commit ref handling:** `--commit HEAD`, branch names, tags, short SHAs all resolve uniformly. Bad refs rejected with clear error.
- **`--reason` validation:** missing reason → fail; invalid enum → fail; missing value for `--reason`/`--commit`/`--pr` flags → fail.
- **YAML lifecycle integrity:** 5x close→reopen→close cycle preserves YAML parseability; block-scalar continuation lines (`closure_rationale: |`) correctly stripped on every reopen.
- **YAML parser fuzz:** BOM-prefixed YAML parsed (BOM auto-stripped); invalid dimension / non-integer line / negative line / empty file all rejected with messages.
- **Markdown escape:** `[`, `]`, `` ` ``, `|` in `file`/`fix`/`module` fields escaped in CLAUDE.md output — no rendering breakage.
- **Marker integrity:** duplicate `lattice:checklist:start` markers in CLAUDE.md → fatal exit, no destructive overwrite.
- **`reopen` safety:** `--reason` required; already-open and nonexistent slugs handled cleanly.
- **`handoff` brief shape:** verified to include `file:line` reference.
- **`id-gen` determinism:** same inputs → same id, always (sha1-based).
- **Perf:** 100-finding sync completes in ~2s — fine for realistic project sizes.

### Confidence
**8.5 / 10** for the surfaces tested. Safe to deploy on second project. Remaining gaps are operational, not correctness: concurrent-write isolation, exotic-filesystem (OneDrive sync / case-insensitive mounts) behavior, mid-write kill recovery. Mitigation: don't run lattice commands in parallel against the same `.lattice/` tree.

## [0.7.5] — 2026-05-12

Parallel `/lattice-fix` scale test + cross-file drift sweep across all 4 audit skills.

### Fixed (all auto-applied by Haiku via parallel `/lattice-fix` dispatch)
Identical drift in YAML examples of all four audit skills — pre-v0.7 `id:` algorithm and stale `sweep_id` length annotation:

- `commands/audit.md` L143, L153 (v0.7.4 dogfood)
- `commands/scale-audit.md` L119, L129
- `commands/security-audit.md` L175, L185
- `commands/flow-audit.md` L177, L187

Old: `id: <12-char hash of rule + module + file + line>` (pre-v0.7; included line)
New: `id: <12-char hex — sha1(dimension:rule:file:code_context_normalized)[:12], generate via \`lattice id-gen\`>` (v0.7 — excludes line so id survives line shifts)

Old: `sweep_id: <12-char hex>`
New: `sweep_id: <14-char: YYYYMMDD + 6-hex, generate via \`lattice sweep-id\`>` (matches actual `lattice sweep-id` output)

### Scale-tested
- 6 Haiku subagents dispatched in parallel across 3 files / 6 lines simultaneously. All 6 produced correct edits, all 6 verified independently, all 6 closed.
- Tokens per agent: 35-42K. Time per agent: 9-22s. Higher tool-use counts (3-5 vs 2) when the agent had to search for content — `old_string` content-match recovered even when auditor line numbers were off by ±5.

### Brief-template learning captured (`.lattice/handoff-feedback/_brief-template-notes.md`)
- Line numbers in finding YAML are hints, not truth — Haiku should match on `old_string` content and abort if non-unique.
- No `simulate:` steps means Haiku can't self-verify — orchestrator independence is mandatory.

### Cumulative Haiku dogfood (v0.7.3 → v0.7.5)
12-for-12 clean on single-line PATCH_DOC fixes across `docs/finding-schema.md`, `commands/audit-sweep.md`, `commands/audit.md`, `commands/scale-audit.md`, `commands/security-audit.md`, `commands/flow-audit.md`. ~$0.05 total Haiku cost.

## [0.7.4] — 2026-05-12

First auto-fix lane shipped.

### Added
- **`/lattice-fix <finding-id>` slash command.** Auto-fixes one low-risk Lattice finding by dispatching a Haiku subagent with the `lattice handoff` brief, verifying the change independently, and closing the finding — or logging the failure for brief refinement under `.lattice/handoff-feedback/<rule>.md`.
- **Eligibility gate.** Refuses to dispatch when tier ∈ {CRITICAL, BLOCKER, HIGH}, when `fix:` is not PATCH_DOC, when `relates_to:` has any entry, when `cluster_root: true`, or when `dimension: security`. The gate keeps the lane safe; humans handle anything outside it.
- **Verify-before-close discipline.** The orchestrator re-reads the changed line independently of the agent's success report. No close happens on Haiku's word alone.
- **Failure-feedback log.** On verification failure, the brief + Haiku's diff + the verification mismatch is appended to `.lattice/handoff-feedback/<rule>.md` — accumulated input for refining the handoff brief template over time.

### Dogfooded
- Ran `/audit commands/audit-sweep.md`, surfaced 1 DRIFT (`stale-coverage-audit-skill-ref` — `/coverage-audit` is not a real slash command, only a dimension). Auto-fixed via `/lattice-fix` slash invocation: 8s, 35K tokens, 2 tool uses, line-26 change verified clean.

### Cumulative Haiku auto-fix tally (v0.7.3 + v0.7.4)
- 4-for-4 clean on single-line PATCH_DOC fixes across `docs/finding-schema.md` and `commands/audit-sweep.md`.
- Average: ~9s wall, ~35K tokens, 2 tool uses per fix. Roughly 6× cheaper than equivalent main-session Opus work.

## [0.7.3] — 2026-05-12

Schema-doc self-audit + handoff bug found via Haiku dogfood loop.

### Dogfooded
- Ran `/audit docs/finding-schema.md` on Lattice itself.
- 3 DRIFTs surfaced + 1 OK; all 3 DRIFTs auto-fixed by Haiku subagent via `lattice handoff <id>` brief → Agent dispatch → independent verify → close cycle. Each fix: ~9s, ~35K tokens, 2 tool uses (Read + Edit). 3-for-3 clean on single-line PATCH_DOC fixes.

### Fixed — docs/finding-schema.md
- Title updated from "(v0.6 / v0.6.3 / v0.6.4)" → "(v0.7+)" (doc body already covered v0.7 fields)
- Regenerated CLAUDE.md preamble marker reference: `scripts/lattice-close.sh` → `\`lattice help\`` (the actual emitted text since v0.6.6.2)
- "Open findings (<count> total)" → "Open findings (<count> actionable)" (code has emitted "actionable" for several minor versions)

### Fixed — `lattice handoff` truncation
- `yaml_field` was stripping a trailing `"` independently of a leading `"`, truncating any field value that ended in a double-quoted phrase. A title like `code points at "lattice help"` became `code points at "lattice help`. Now strips only matched-pair quotes via `s/^"(.*)"$/\1/`.

## [0.7.2] — 2026-05-11

Self-audit pass. `/audit` was run against Lattice's own README + scripts. Two P0 bugs and two HIGH bugs surfaced; all four fixed before tag.

### Fixed — P0 / data integrity
- **`lattice close ""` no longer silently destroys data.** The empty-string substring matcher was closing the first-sorting open finding without prompt or error. A scripted invocation with an unset `$ID` would quietly destroy work. `lattice-close.sh` now rejects empty / whitespace-only `<id>` at top of validation.
- **`close → reopen → close` cycle no longer corrupts YAML.** `lattice-reopen.sh` was only stripping a subset of close lifecycle fields and never handled `closure_rationale: |` block-scalar continuation, orphaning indented lines into the open YAML. A subsequent close then appended a second lifecycle block. After one cycle, every `lattice sync` failed with "malformed YAML at line N". The strip logic in both `lattice-reopen.sh` and `lattice-close.sh` is now an awk state machine that handles block-scalar continuations correctly.

### Fixed — HIGH
- **`lattice close --commit HEAD` now works** (README quickstart promise). The hex-SHA regex was rejecting all git ref forms; `--commit` is now resolved through `git rev-parse --short` first, so `HEAD`, branch names, tags, and short SHAs all work uniformly.
- **`lattice-reopen.sh` strips `close_reason` and `closure_rationale`** when moving a finding back to open/. Previously the open YAML stayed internally inconsistent (directory says open, body says `closed_at: ...`).

### Added — global usage aggregate
- Every `lattice` invocation now also appends to `~/.claude/lattice/usage/global.jsonl` (in addition to the per-project `.lattice/usage/events.jsonl`). This is the maintainer dashboard data — **deliberately not surfaced into client Claude sessions**.
- `lattice usage --global` reads the global aggregate. Use it to decide what to deprecate across all projects you've used Lattice in.
- Opt out of global logging with `usage.global: false` in `.lattice/config.yml` (the local log respects the existing `usage.enabled` toggle).

### Hardened — regression tests
- `test-lifecycle.sh` grows from 11 → 15 tests covering: close empty id, `--commit HEAD` resolution, full close→reopen→close cycle stays sync-clean, global usage aggregation.

## [0.7.1] - 2026-05-11

Usage telemetry + project-aware update checks.

### Added
- **Repo-local usage analytics.** Every Lattice command appends a private event to `.lattice/usage/events.jsonl` unless disabled by `.lattice/config.yml`. Events record command name, flag shape, version, timestamp, and project basename; they do not record finding slugs or file paths.
- **`lattice usage [--since <days>] [--unused <days>] [--json]`.** Reports most-used commands and candidates unused for a threshold window.
- **Project config.** `lattice config init|show` manages `.lattice/config.yml` with `usage.enabled` and `updates.mode`.
- **Update checks.** `lattice update --check|--self|--enable-auto|--disable-auto` checks the latest GitHub version, runs the installed updater on request, and can opt a project into automatic updates.
- **Automatic update notices.** Projects with `.lattice/config.yml` and `updates.mode: notify` check at the configured interval and print a drift warning. `updates.mode: auto` runs `lattice update --self` when a newer stable version is available.

### Hardened
- v0.7 regression tests now cover usage logging, config creation, and update drift checks without requiring network access.

## [0.7.0] — 2026-05-11

Major release. Flat finding layout, stable id algorithm, close-reason taxonomy, and six new CLI commands. Driven by real-use feedback from 36 findings / 29 closed / 8 commits on jiive Lumi.

### Breaking changes
- **Flat finding layout.** `open/<date>/<slug>.yml` → `open/<slug>.yml` and `closed/<sha>/<slug>.yml` → `closed/<slug>.yml`. Run `bash scripts/migrate-v0.7.sh --dry-run` then `bash scripts/migrate-v0.7.sh` to upgrade existing repos.
- **`close` requires `--reason`** (one of `fixed|false-positive|wont-fix|out-of-scope|duplicate`).
- **`reopen` requires `--reason`** (free text, mandatory).

### Added — CLI commands
- **`lattice handoff <id>`** — emit a Markdown executor brief (tier, module, fix, simulate steps) to stdout. Pipe to a file or paste into a task.
- **`lattice next [--module M]`** — print the single highest-priority actionable open finding (CRITICAL → BLOCKER → HIGH → … order).
- **`lattice timeline [--since <date>]`** — list closed findings grouped by date, newest first.
- **`lattice verify <id> [--run]`** — print the `simulate:` steps; `--run` executes them and reports pass/fail.
- **`lattice ci-check [--tier <T>]`** — exit 1 if any non-deferred CRITICAL or BLOCKER finding is open. Designed for CI gates.
- **`lattice pr-body [--since <date>]`** — emit a Markdown PR section of findings closed since a date, grouped by close reason.
- **`lattice triage --cluster`** — sort cluster-root findings to the top of the triage queue.

### Added — stable id algorithm (V1)
- **`lattice id-gen <dimension> <rule> <file> <code_context>`** — SHA1(`dimension:rule:file:code_context_normalized`)[:12]. Survives line shifts because no line number is included in the hash. Documented in `docs/finding-schema.md`.

### Added — close-reason taxonomy (V3)
- New required field `close_reason: fixed|false-positive|wont-fix|out-of-scope|duplicate` on every closed finding.
- New optional field `closure_rationale:` for free-text explanation.
- `lattice close` validates the enum; `lattice pr-body` groups by reason.

### Added — schema fields (F1, F2)
- **`cluster_root: true`** — marks a finding as the entry point for a relates_to cluster. `lattice cluster <id>` does BFS walk.
- **`module_owner:`** — the team/person responsible for the fix (may differ from the module where the bug manifests).
- **`related_files:`** — extra files the fixer must read (design constraints, shared maps).

### Added — sync groups by module_owner (F7/U3)
- `lattice sync` (`lattice-regenerate.sh`) now groups open findings by `module_owner` in CLAUDE.md when any finding has the field set; falls back to tier grouping when none do.

### Added — shell tab completion (U1)
- `scripts/lattice-completion.bash` — bash completion (subcommands + flags + slug completion from local `.lattice/`).
- `scripts/lattice-completion.zsh` — zsh completion with descriptions.

### Added — git hook (W1)
- `scripts/prepare-commit-msg.sh` — prepend a comment warning when CRITICAL/BLOCKER findings are open. Non-blocking (informational); use `lattice ci-check` in CI to gate merges.

### Added — migration script (V2)
- **`scripts/migrate-v0.7.sh`** — idempotent, dry-run-safe migration from nested to flat layout. Adds `first_seen_sweep:`, `legacy_id:`, and `closed_by_commit:` fields automatically.

### Added — fuzzy match + disambiguation (B4/U2/U4)
- All commands now accept full YAML paths, slugs, `module/rule` form, or substrings as `<id>`.
- When multiple findings match, interactive TTY prompt lists choices; non-TTY prints the list and exits non-zero.
- `lattice show` prints all matches with `--- [N/total] ---` separators.

### Changed
- `status: partial` is now an alias for `status: in_progress` (B2) — `lattice list --status partial` works.
- `lattice sweeps` no longer shows a "planned for v0.7" note — the manifest writer ships in this release.
- `install.sh` installs completion scripts and `prepare-commit-msg.sh`.
- Usage string updated to list all v0.7 subcommands.

## [0.6.7] — 2026-05-09

Audit-skill rewrite. Biggest single change since v0.6 itself — touches all 5 skill commands and the schema doc. Driven by 2 days of jiive Lumi heavy-use feedback synthesized across two independent Claude sessions; both signed off on the final scope before shipping.

### Killed
- **`.lattice/findings/sweep-<YYYYMMDD-HHMMSS>.md` master markdown summary.** This was a second rendering of the same data the YAMLs already capture, written by `audit-sweep` Step 3. It went stale immediately and undermined "YAMLs are the source of truth." The CLAUDE.md checklist (regenerated via `lattice sync`) is the single human-readable view. Two formats for the same data was the bug.

### Added — sweep manifest writer
- **`.lattice/findings/sweeps/<sweep_id>.yml`** is now emitted at the end of every sweep (per `docs/finding-schema.md` "Sweep manifest" section). `lattice sweeps` finally has data to list. Contains: `sweep_id`, `sweep_date`, `dimensions`, `mode`, `auditor`, **`auditor_model`** (opus/sonnet/haiku — depth varies materially), **`duration_ms`**, `totals`, `opened` / `unchanged` / `closed_since_last` / `regressed`, **`skipped`** (parse-failure count — without this, "the sweep looks clean" is unprovable), and **`runtime_warnings[]`** (TTD-silent notes, threshold-edge calls, cross-cutting bundles).

### Added — `lattice sweep-id`
- New subcommand emits `<YYYYMMDD><6-hex>` deterministically. 24 bits of entropy from doubled `$RANDOM` — enough to avoid collision among same-day sweeps without `/dev/urandom` SIGPIPE issues on Git Bash. Skills now generate sweep_id once at start and propagate to every per-module dispatch + every emitted YAML so all findings share it.

### Added — `/flow-audit --scope <path1>,<path2>,...`
- Multi-module flow auditing for flows that span modules (the `thyrocare → booking → payments → lumi` case). Comma-separated paths share one sweep_id; findings reference each module by its actual `module:` path. Designed so a future `flow-map.yml` can declare named flows once and re-use them — natural v0.7+ addition without breaking the comma-separated form.

### Added — finding-YAML field
- **`relates_to: [<slug>, ...]`** (optional, all dimensions) — purely advisory hint surfacing sub-symptom / shared-root-cause relationships during triage. Cheap to add, addresses real triage waste from the 2026-05-09 sweep where two findings shared a root cause but had no link. Bidirectional linking is the writer's responsibility — A→B doesn't auto-create B→A.

### Changed — methodology hardening
- **TTD-silent rule (all skills):** if the TTD is silent on an implementation detail, treat the code as ground truth. Do NOT flag this as a finding. If the gap is non-obvious, emit `dimension: audit, tier: UNVERIFIABLE` noting "doc does not specify X; code does Y" — coverage gap, not drift.
- **DRIFT threshold (audit + flow cross-check):** explicit contradictions only. Skip claims phrased as `will`, `Phase N`, `future`, `deferred`, `roadmap` — those are aspirational. Skip "doc silent on Z" — that's UNVERIFIABLE, not DRIFT. Conservative; false positives erode trust faster than missed catches.
- **OK-finding discipline (all skills):** every audit MUST emit `tier: OK` findings for patterns checked-and-found-clean. First-class output, not a side-effect. Two of the most useful 2026-05-09 jiive Lumi findings were OK findings; knowing what was verified-clean changed how the rest were triaged. Each requires `intentional_citation`.
- **`lattice sync` replaces `bash scripts/lattice-regenerate.sh`** in every skill's regen step. Aligns with the v0.6.5 dispatcher reality (the bash form still works for backward compat).
- **`lattice close <id>` replaces `bash scripts/lattice-close.sh <id>`** in audit-sweep's close-instructions.

### Changed — skill final-output format
- All 5 skills now print `Findings:` (YAML directory) + `Manifest:` (manifest path) + `Verdicts:` (counts) + `Skipped:` (parse failures) + `Inspect: lattice list / show / triage` hints. No reference to the killed markdown summary path. No second written artifact — chat output mirrors the manifest.

### Schema doc additions (`docs/finding-schema.md`)
- New optional `relates_to:` field documented under "Optional everywhere"
- Sweep manifest section rewritten with the v0.6.7 fields (`auditor_model`, `duration_ms`, `skipped`, `runtime_warnings`) + the sweep_id format spec.

### Out of scope (still on docket)
- **Fingerprint-based dedup before write** — waiting for v0.7's `id:` algorithm change (drafted at `4ba9ff5`). Until then, audit skills use heuristic `(module + rule + file + line)` exact match for opened/unchanged/closed-since-last — catches obvious dups, misses line-shift cases. Documented limitation.
- **`flow-map.yml` named flows** — v0.7+. The `--scope` shape is forward-compatible.
- **`module_owner:` distinct from `file:`** — better solved as part of v0.7's "multi-file evidence" (`evidence_files: [...]`); deferred so it doesn't become vestigial.
- **`simulate:` sub-typing** (`type: curl|db|admin`) — premature schema lock-in until a `lattice verify` consumer exists.

## [0.6.6.3] — 2026-05-09

Parser robustness patch from a heavy-use review (2 audit sessions, 23 flow-audit findings written by hand from PowerShell). Triaged: 2 of 6 reported "bugs" are real, 4 are downstream symptoms of one of the real ones. Empirically verified each before patching.

### Fixed (parser)
- **UTF-8 BOM at start of file no longer breaks parsing.** PowerShell 5.1's `Set-Content -Encoding UTF8` prepends `\xEF\xBB\xBF`; the regex `/^([a-zA-Z_]...)/` failed to match line 1, throwing "malformed YAML at line 1." `parseYaml` now strips a leading `﻿` before tokenizing.
- **Leading `---` document separator (and trailing `...`) accepted.** Standard YAML headers — agent-generated files often include them. The parser now skips lines whose `.trim()` equals `---` or `...`.

### Improved
- **Line-1 parse errors now include a hint.** When the regex fails on the first line, the error message appends a hint: BOM detection note (with the PowerShell `WriteAllText` workaround) if the line still contains a BOM byte after stripping, or a generic "BOM / unescaped tab / non-key-value content" hint otherwise. Replaces the unactionable `"malformed YAML at line 1"` with something a user can fix in seconds.

### Added
- **`lattice validate`** — diagnostic scan over every YAML in `.lattice/findings/{open,closed}/`. Reports per-file pass/fail, collects ALL errors instead of fail-fast, exits 2 if any error found. Does not touch CLAUDE.md. Uses the same parse + validate logic as `sync` (single source of truth). Underlying flag: `lattice-regenerate.sh --validate-only`.

### Triage notes (false alarms from the review)
- **"YAML list syntax broken"** — false. Block lists (`tests:`/`simulate:` with `  - "item"`) parse correctly. The reporting session's lists almost certainly failed because of the BOM bug cascading: when line 1 fails, the entire file is rejected, including its list fields. One root-cause fix (BOM strip) resolves this.
- **"Colon-space in unquoted value breaks"** — false. The regex `(.*)$ ` captures everything after the first `: `, so `impact: actual: No active booking found` parses correctly with the inner colon as part of the value. Reporter likely had a different actual error masked by BOM.
- **"Unicode arrows (`→`) rejected"** — false. The regex accepts any character; arrows work in plain values, quoted strings, and block-list items.
- **"Silent parse failures"** — false on v0.6.6.1+. Regen exits 2 loudly with the file path and reason. Reporter was on a stale install.

### Schema/template
- No changes. Block lists work. Skill templates do not need to retreat to inline lists.

## [0.6.6.2] — 2026-05-09

One-line distribution-bug patch from a flow-audit debrief.

### Fixed
- **Regenerated CLAUDE.md hint pointed at a path that doesn't exist in user repos.** The `<!-- Source of truth: ... -->` comment said `to close, run scripts/lattice-close.sh` — but Lattice's helpers are installed at `~/.claude/lattice/scripts/`, not committed to the user's project. New hint: `to triage, run \`lattice help\` (CLI installed via Lattice's install.sh)`. Aligned with the v0.6.5 dispatcher reality.

## [0.6.6.1] — 2026-05-09

Two same-day fixes from the v0.6.6 retest. Both real, both small.

### Fixed
- **`lattice sync` (no `--check`) now exits 2 on parse error.** v0.6.6 fixed `--check` but the dispatcher's `cmd_sync` wrapper was relying on `set -e` to propagate the helper's exit code through the function boundary. `set -e` propagation through functions is unreliable on Git Bash for Windows (and arguably on any bash where the function-call site doesn't trigger errexit). Replaced with explicit `bash ... || rc=$?; return $rc` capture. Same fix applied to `cmd_close` and `cmd_reopen` for consistency. Now `lattice sync` and `lattice sync --check` both exit 2 on parse/schema errors as documented.
- **Legacy closed YAMLs without `closed_by_commit` no longer block sync.** v0.6.6's stricter validation requires `closed_by_commit` on closed findings; manually-closed YAMLs from before the helper-based lifecycle (e.g., user-edited closes from earlier sessions) lack the field and got rejected. Now: if a closed YAML is missing `closed_by_commit`, regen reads the parent directory name (which is the closing SHA per the path convention `closed/<sha>/<slug>.yml`) and uses that. Lenient, no migration script required. Only triggers when the parent dir name matches `[0-9a-f]{7,40}`.

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
