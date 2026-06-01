# Changelog

All notable changes to Lattice are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [2.4.2] — 2026-06-01

**Dogfood-backlog clearance.** Triage-verified all 12 open manual-report bugs (#100–114) against HEAD, then fixed the ones still real across PRs #125–128. All correctness/removal — no new env vars, stores, or surface area.

### Fixed
- **`lattice context` count diverged from `lattice list` (#109).** Context counted `tier:OK` in its headline; list hides acknowledged OK by default. Context now reports `N actionable (+M acknowledged)`.
- **Sync validator rejected `abuse`/`cli-tool`/`observability` dimensions (#102).** Shipped in the audit skills (v2.3.0) but missing from `VALID_DIMENSIONS`, so real abuse/observability findings were silently dropped during CLAUDE.md regen.
- **Self-update could truncate the live script (#114).** `update.sh fetch()` wrote downloads directly to the destination; an interrupted fetch left a half-written `lattice` (`syntax error near ';;'`). Now downloads to `.part`, `bash -n`-verifies the main script, then atomic `mv`.
- **env-contract scanned top-level `.netlify/` (#107).** Added `--exclude-dir=.netlify` to all env-var grep passes.
- **Telemetry showed OFF after a global enable (#112).** Project-level `telemetry: off` vetoes global on; the OFF message now names that gotcha and flags this repo's config when set.
- **`normalize` left semantic duplicates on disk silently (#103).** Two findings differing only in `module:`/`tier:` derive the same canonical id (sha1 excludes both) but renamed to different stems, so neither tripped the path-collision guard. New pre-pass groups by canonical id, surfaces the group, skips normalizing the extras, exits 3 on `--apply`. Never auto-deletes.
- **security-audit missed server actions without try/catch (#111).** Added a detector row — an unhandled throw in a Next.js Server Action serializes internals to the client or 500s with no graceful path.
- **Installer never vendored `commands/references/` (#100, #101).** Skills reference `references/<file>.md`, but install.sh/update.sh only copied top-level command files. Added a `REFERENCES` array (13/13 verified) + fetch loop into `~/.claude/commands/references/` in both installers.

### Added
- **env-contract NEXT_PUBLIC manifest cross-check (#113, #108).** Reads declared `NEXT_PUBLIC_` keys from `.env.example`/`.env.local`/`.env`/`.env.production*`/`netlify.toml` and flags any `NEXT_PUBLIC_` var read in code but declared nowhere — the exact `PUBLISHABLE_KEY`-vs-`ANON_KEY` footgun (#108). Build-time client vars only, to stay high-signal. Verified zero false positives on real Next.js repos.

## [2.4.1] — 2026-05-21

**Second self-audit lap closes 3 MEDs in v2.4.0.** Same loop as v2.3.1 → ran the dimension audit against the v2.4.0 aggregator, fixed what came back. No HIGH this round — proving the v2.3.1 fixes held.

### Fixed (MEDIUM)
- **`projects add` no path canonicalization (abuse-audit).** v2.4.0 accepted any directory path that existed. Now: refuses `..` segments, refuses `/dev/*` / `/proc/*` / `/sys/*`, calls `realpath -e` when available, refuses symlinks. Registered paths are replayed on every SessionStart fire — they need to be vetted at add-time.
- **`projects patterns` dropped tier (abuse-audit).** Clustering keyed on `(dim, rule)` only — `MEDIUM-x` and `HIGH-x` (same rule slug, different tier) silently merged. Enabled tier-laundering. Now clusters on `(tier, dim, rule)`. Output format gains a `[TIER]` prefix.
- **Dual-parser drift between bash + Node (cross-cutting).** The registry file was parsed by `_projects_load` (bash awk) and `readFleetStatus` (Node) independently. Bash stripped commas from paths via `gsub(/[",]/, "")`, Node didn't. SessionStart could silently disagree with `lattice projects list`. Node parser now matches bash semantics exactly (trim + strip matched-pair quotes + strip commas + tilde-expand).

### Deferred (WATCH)
- `_projects_findings` forks N node helpers per finding × N projects → ~150s on Windows for a 5-project × 100-finding fleet. Same fork-tax pattern that motivated `lattice-yaml.mjs` in v2.2.5. Fix: implement the `--bulk` mode that lattice-yaml.mjs's docstring already plans. Separate ship.

### Today's process loop, demonstrated
1. v2.3.0 shipped the `abuse` + `cli-tool` + `cross-cutting` dimensions (designed to catch dev-tool bugs)
2. v2.3.1 ran the dimensions on Lattice itself → 7 fixes (4 HIGH, 3 MED)
3. v2.4.0 shipped the `lattice projects` aggregator
4. v2.4.1 ran the dimensions AGAIN on v2.4.0 → 3 MED, 0 HIGH

**Pattern:** every new surface gets audited by the same primitives that defined it. The loop is real and the trend (4 HIGH → 0 HIGH between laps) is what self-improvement looks like in practice.

## [2.4.0] — 2026-05-21

**Closes #89 — `lattice projects` cross-project aggregator.** Lattice was per-project. v2.4 makes it fleet-aware. The keystone feature for the stated goal "Lattice must support all my projects."

### Added
- **Registry at `~/.config/lattice/projects.yml`** (or `~/.claude/lattice/projects.yml` fallback; `LATTICE_PROJECTS_REGISTRY` env override for tests).
- **`lattice projects add <name> --path <path>`** — register a project. Idempotent (refuses to re-add by same name).
- **`lattice projects rm <name>`** — deregister.
- **`lattice projects list`** — table of all registered projects + open / HIGH counts.
- **`lattice projects findings [--tier T --dimension D]`** — aggregated findings across the fleet, one row per finding, with project/tier/dimension/module-rule/age columns.
- **`lattice projects next`** — single highest-priority finding across the fleet. Maps cleanly onto `lattice next` semantics but cross-project.
- **`lattice projects stats`** — heatmap of CRITICAL/HIGH/MEDIUM/LOW/DRIFT/WATCH counts per project. Single screen, all projects.
- **`lattice projects patterns`** — emits `(dimension, rule)` tuples appearing in 2+ projects. THIS is the highest-leverage view: same env-contract mistake across 4 projects = one architectural fix, not 4 tactical ones.

### Hook integration
- **SessionStart fleet status line.** When SessionStart fires inside ANY registered project, the injected context block now ends with `- ⚠️ Fleet: N CRITICAL + M HIGH open in K other project(s)`. Stops the "context switch to project A while CRITICAL unattended in project B" pattern.

### Design discipline
- **No daemon. No cloud. No auth. No dashboard.** Read-only aggregator over local `.lattice/` trees.
- **No new YAML schema.** Reads existing finding YAMLs as-is.
- Uses the v2.2.5 `lattice-yaml.mjs` Node helper for per-field reads — keeps aggregation fast on Windows (otherwise the fork tax × N projects would be brutal).
- Falls back gracefully when projects don't have `.lattice/` set up yet.

### Multi-project workflow now possible
```
lattice projects add lattice       --path ~/code/Lattice
lattice projects add jiive-backend --path ~/code/jiive-backend
lattice projects add rise-craft    --path ~/code/rise-craft

lattice projects stats             # see the heatmap
lattice projects next              # work the highest priority across fleet
lattice projects patterns          # find the architectural fixes
```

## [2.3.1] — 2026-05-21

**v2.3.0's new dimensions eat their own dogfood.** Ran `/audit-sweep . abuse cli-tool cross-cutting` against Lattice itself — 3 parallel sub-agents returned **13 findings (4 HIGH, 5 MED, 4 WATCH/LOW)** in under 5 minutes. Most were bypasses to fixes shipped earlier today. The rule libraries earned their place.

### Fixed (HIGH — most are bypasses to v2.2.5 / v2.2.4 fixes)
- **Worker rate limiter bypass (abuse-audit).** v2.2.5 #90 added the limiter but: (a) `X-Real-IP` header was attacker-spoofable (Cloudflare authoritatively sets only `CF-Connecting-IP`); (b) empty IP returned `allowed=true`. Now: `CF-Connecting-IP` only, fail-CLOSED on empty IP or missing KV.
- **SHA256SUMS verifier soft-failed (abuse-audit + cross-cutting).** v2.2.5 #91 added the manifest but warned-and-continued when manifest 404'd OR sha256sum was absent — defeating the point (an attacker who can poison scripts can equally serve a 404 on `/SHA256SUMS`). Now: fail-CLOSED, refuse install, exit 4. Override only via explicit `LATTICE_SKIP_INTEGRITY=1` env.
- **`observed_value` second-order injection (abuse-audit).** v2.2.2 fixed argv/`shell:false` for the @claude dispatch slug, but `observed_value` (YAML-derived) was still interpolated into a markdown code fence that @claude is INSTRUCTED to execute. `combined_value: "1; lattice grow close other-slug --result won"` would have run the second command. Now: coerce to `Number`, refuse non-finite, splice the coerced string.
- **`lattice-yaml.mjs` ignores block scalars (cli-tool-audit).** v2.2.5 #98's Node helper returned `|` literally instead of the multi-line value — same bug class as #88 (close.sh strip), reintroduced on the read side. Now: handles `|`, `|-`, `|+`, `>`, `>-`, `>+` block scalars with proper indent-strip + chomp.

### Fixed (MED)
- **Worker `/health` skipped rate limit (cross-cutting).** Asymmetric-cost DoS + victim-quota burning. Now: `/health` runs through the same limiter when an IP is present.
- **Lock-file accumulation (cli-tool-audit).** `_append_relates_to` left `.lattice/.locks/*.lock` files behind, not gitignored. Now: moved to `.lattice/cache/locks/`. `lattice setup` emits a `.lattice/.gitignore` that excludes `cache/`, `.locks/`, `sessions/`, `usage/`.
- **SessionStart title prompt-injection (cross-cutting).** Finding titles were injected verbatim into Claude Code's `additionalContext`. A malicious title could instruct the LLM to invoke `close_finding({confirm: true})` — bypassing the v2.2.5 #96 destructiveHint gate, since the LLM itself was being deceived. Now: control-char strip + bidi-override strip + 200-char cap + `TITLE_DATA<<<…>>>END` data brackets.

### Fixed (LOW polish)
- **#81: age column + `--sort=age` in `lattice list`.** `Age` column shows `Nd` / `Nw` / `Nm` with `⚠` for >30 days. Defaults to `--sort=tier`; `--sort=age` oldest-first. Header row added so the columns are labeled.

### Deferred (filed but not fixed in v2.3.1)
- WATCH `_close_print_unblocked` fork-per-finding (cli-tool, would benefit from the lattice-yaml.mjs bulk mode — separate ship)
- WATCH `_validate_relates_chains` bash recursion depth bound (cli-tool, edge case)
- MED `_grow_fetch_metric` header allow-list still YAML-controlled URL (abuse, hard-deny would over-restrict legitimate use)

### Process learnings
- **Sub-agents work for self-audit even when bash-sandboxed.** 3 agents, all static analysis, 13 real findings in 5 minutes.
- **The new dimensions actually catch the right bugs.** 7 of 13 findings were bypasses to fixes shipped earlier the same day — the kind a re-run of the OLD per-module per-dimension sweep would have missed.
- **The self-improvement loop now demonstrably works:** dispatch → find → fix → re-dispatch. We just did one full lap.

## [2.3.0] — 2026-05-21

**Closes #99 — `abuse` + `cli-tool` audit dimensions + `cross-cutting` dispatch mode.** The self-audit gap formalized: prior `/audit-sweep` runs on Lattice itself missed the 10 bugs an external reviewer found in 30 minutes, because the rule libraries were calibrated for web apps. v2.3 ships the rule libraries that match Lattice's actual shape.

### Added
- **`abuse` dimension** — rule library at `commands/references/audit-abuse-rules.md`. Hostile-input thinking for tools with public endpoints, fetch-and-exec install paths, or shell out to operator-supplied strings. 6 rule slugs: `unauthenticated-public-endpoint`, `unverified-fetch-and-exec`, `eval-of-untrusted-string`, `indirect-env-expansion`, `command-substitution-of-user-input`, `unescaped-shell-interpolation`. Each with code-shape detector + repro shape + tier defaults.
- **`cli-tool` dimension** — rule library at `commands/references/audit-cli-tool-rules.md`. Tool-shaped correctness — atomicity, signal handling, fork tax, MCP gates, regex-vs-string-compare. 8 rule slugs: `non-atomic-write-no-signal-handler`, `symlink-write-through`, `unescaped-regex-interpolation`, `silent-collision-skip`, `mcp-destructive-no-confirm`, `block-scalar-strip-without-state-machine`, `fork-per-field-in-loop`, `unbounded-jsonl-read`.
- **`cross-cutting` dispatch mode** — `/audit-sweep . cross-cutting` skips per-module enumeration, dispatches ONE whole-repo sub-agent that reasons about trust boundaries spanning modules. Higher token cost; catches the seam-bugs per-module sweeps miss. Pair with `abuse cli-tool` for self-audits.

### Recommended usage
- **Self-audit of dev tools / CLIs / Workers:** `/audit-sweep . abuse cli-tool cross-cutting`
- **Standard module sweep on a web app:** unchanged — `/audit-sweep .` still runs audit + scale + security + env-contract per module
- **Quick fork-tax check on a perf-sensitive script:** `/audit-sweep . cli-tool` (just the cli-tool dimension)

### Why this matters
Lattice's stated long-term goal is self-improvement. That requires audit-sweep to find Lattice's own bugs before they ship. Empirically: 10 bugs fixed in v2.2.5 came from external review, not self-sweep. v2.3 closes the rule-library gap so future self-sweeps catch the same classes.

## [2.2.5] — 2026-05-21

**Closes 10 bugs from external review pass. 4 HIGH (incl. 2 security + 1 corruption + 1 perf), 5 MED, 1 LOW.**

### Fixed (HIGH)
- **#88 — `close.sh --partial` orphaned block-scalar lines, corrupting YAML.** Strip pass now uses the same awk state-machine the full-close path uses (handles `remaining: |` continuation lines).
- **#90 — Worker has no rate limiting → DoS spam 100k GH issues.** IP-based KV-backed limiter: 30 req/hour/IP global, 5 manual_report/day/IP. Hits 429 with `Retry-After`. No new infra.
- **#91 — `curl | bash` install has no integrity verification → supply-chain RCE.** New `SHA256SUMS` manifest at repo root; install.sh fetches + verifies every installed file. Mismatch wipes the install and exits 2. Backwards-compatible: missing manifest = warning, not block (v2.3 will make it a hard block).
- **#98 — `yaml_field` fork tax (supersedes #87).** New `scripts/lattice-yaml.mjs` Node helper: single fork/exec per call instead of `grep | sed`. Backward-compatible bash fallback via `LATTICE_YAML_FORCE_LEGACY=1`. On Windows + Git Bash this should drop `lattice list` from ~50s to ~5s on 100-finding projects.

### Fixed (MED)
- **#92 — `prepare-commit-msg-lattice.sh` regex injection.** Staged paths went straight into `grep -E` — Next.js `[id]/page.tsx` files silently skipped (regex treats `[id]` as charclass), files with `(...)` exited grep with parser error. Now: string-compare normalized `file:` values, no regex.
- **#93 — `lattice-regenerate.sh` non-atomic write.** Ctrl-C during regen left CLAUDE.md truncated. Now: write to `.tmp.$$`, rename. SIGINT/SIGTERM/SIGHUP handlers clean up the tmp.
- **#94 — `normalize --apply` silent collision skip.** Used to rewrite ids of orphaned files. Now: refuse the rewrite when destination exists, log clearly, exit 3 if any unresolved collision.
- **#95 — `verify --run` `eval ${step}` in parent shell.** Steps could mutate verify session state. Now: `bash -c "${step}"` in subshell, contained blast radius.
- **#96 — MCP `close_finding` no programmatic confirm gate.** Added required `confirm: z.literal(true)` field. Hosts that auto-run destructive tools bypassing `destructiveHint` annotation now get refused at the schema layer.

### Fixed (LOW)
- **#97 — `_lattice_md_apply` follows symlinks.** Dangling `~/.claude/CLAUDE.md` → arbitrary file could be overwritten on `claude-md-tune --apply`. Now: `[ -L target ]` check refuses with a clear "resolve manually" message.

### Process notes
- All 10 fixes shipped in one release, no partial-ship — each is independently testable.
- v2.2 cumulative count: 2 days, 8 releases, 22 issues closed (5 HIGH security/corruption fixed since v2.2.0 ship). The stress-audit + auto-action loop is paying for itself.

## [2.2.4] — 2026-05-21

**Closes HIGH #86 — header `${VAR}` env-var exfiltration.** Same shape as the v2.2 cmd: RCE: a hypothesis YAML in any PR could include `Authorization: "Bearer ${ANTHROPIC_API_KEY}"` and the next `lattice grow measure` run would exfiltrate the token to whatever URL the YAML chose. Default-deny now.

### Fixed (HIGH)
- `_grow_fetch_metric` header interpolation is **default-deny**. Only env vars matching `LATTICE_HEADER_*` interpolate. Opt-out: `LATTICE_ALLOW_HEADER_INTERPOLATION=1` OR `security.allow_header_interpolation: true` in `.lattice/config.yml` (parity with `allow_cmd_sources`).
- Refused interpolations print a clear `[fetch] refusing header interpolation of ${X}` notice on stderr — loud failure, not silent leak.

Closes #86. Reported by external review against v2.2.1; verified in `/tmp/h86` with `SUPER_SECRET_TOKEN` blocked + `LATTICE_HEADER_FOO` allowed.

## [2.2.3] — 2026-05-21

**Stress dimension formalized — parallel hardening as a Lattice primitive.**

Today the v2.2.0 hardening pass surfaced 5 HIGH bugs via 5 sub-agents in <5 min wall clock. This release encodes that pattern as a first-class skill so every future release can self-stress.

### Added
- **`/stress-audit`** — new skill at `commands/stress-audit.md`. Fans out N parallel sub-agents (one per ATTACK SURFACE, not per module). Default surfaces: `yaml-fuzz`, `shell-inject`, `concurrency`, `windows-edge`, `artifact-validity`. Each surface ships a complete brief template the parent skill pastes verbatim into Agent tool calls. Each agent emits multi-doc YAML at `/tmp/stress-<surface>.findings.yml`.
- **`--auto-import` flag** auto-pipes the aggregated findings through `lattice file --from --no-confirm-dup` after all agents return.
- **Sandbox-tolerant.** Three of five surfaces (`shell-inject`, `concurrency`, `windows-edge`) work even when sub-agents are denied Bash — static read produces 80% of the signal. The skill explicitly tells each agent which modes are acceptable.

### Composition with v2.2 pieces
- Findings flow: parallel sub-agents → `/tmp/stress-*.findings.yml` → `lattice file --from` (slice 6) → `.lattice/findings/open/`
- Lifecycle: open findings ranked by `lattice next --unblocked-only` (slice 3 + #85)
- Action: `@claude` issues for HIGH findings via the slice 4 auto-action path (manual today; cron-driven in v2.3)

### Workflow for v2.3+
The complete self-hardening loop now has all primitives:

```
weekly cron → /stress-audit . --auto-import → findings filed →
   @claude auto-action (issue per HIGH) → @claude opens PR with fix →
   verify-on-commit hook flags affected findings → lattice close → repeat
```

Only piece not yet wired: the weekly cron (small GH Actions YAML; deferred).

## [2.2.2] — 2026-05-21

**Closes issue #85 + fixes 5 HIGH bugs surfaced by parallel hardening subagents.** Sub-agent audit ran 5 attack surfaces in parallel (yaml-fuzz, shell-injection, race, windows, artifact-validity); 3 returned real findings via static analysis. The 2 HIGH bugs they found in v2.2.0 code are fixed in this version.

### Added (#85 — auto-surface unblocked work)
- **Inverse-kind back-link.** `lattice link A B --kind blocks` now writes `kind: blocks` on A and `kind: blocked-by` on B (asymmetric, semantically correct). `duplicate-of` stays symmetric. `blocked-by` is accepted as input kind too. Old v2.2.0 links (symmetric `blocks` on both sides) still parse but don't auto-surface — re-link if you want the auto-guide.
- **Close auto-surface.** `lattice close X` scans every open finding for `relates_to[kind:blocked-by, id:X]` and prints `✅ Now unblocked — pick next: ...` ranked by tier. The exact Jiive WABA scenario from issue #85 now flows: close blocker → guidance for what's actionable next.
- **`lattice next --unblocked-only`** filters out findings still blocked by an open one. The flag the issue asked for.
- **`lattice show <id>`** renders a "Cross-references (live state)" section after the YAML — shows tier + open/closed state of every linked finding. Stale links surface as `(NOT FOUND — stale link)`.
- **`lattice validate`** extended with chain checks: stale link IDs (error), circular `blocked-by` cycles (error), closed-references-open (warning).

### Fixed (HIGH)
- **`scripts/lattice` workflow RCE (shell-inject audit).** Slice 4's auto-action workflow used `execSync` with template-literal interpolation of YAML-derived `slug` — `slug: foo$(id>/tmp/pwned)` ran arbitrary shell on the GH Actions runner with `GH_TOKEN` + `TELEGRAM_BOT_TOKEN` in scope. Rewrote with `spawnSync(["gh","issue","create",...], {shell:false})` — argv array, no shell evaluation. Plus regex validators on `slug` and `REPO` env.
- **`_append_relates_to` race (concurrency audit).** Two parallel `lattice link` calls shared `${file}.tmp` and had no lock — second writer clobbered first's tmp, link silently lost on one side, asymmetric graph. Now uses per-PID `${file}.tmp.$$` + `flock` on `.lattice/.locks/<basename>.lock`.
- **`yaml_field` CRLF leak + key injection (windows + shell-inject audit).** `yaml_field` previously left `\r` in returned values (poisoning every string compare on CRLF YAML) AND spliced the `key` argument into both a `grep -E` pattern and a `sed` expression. Now: charclass-validate the key (refuse non-identifier chars), strip `\r` from the value.
- **`cmd_file` path-traversal + CRLF (shell-inject + windows audit).** Slice 6's batch import built destination paths from YAML `module`/`rule` fields with only `tr -d '"'`. `module: ../../../../tmp/pwned` wrote outside the findings tree. Now: charclass-validate tier/module/rule against `^[A-Za-z0-9_-]+$`, explicit `..` rejection, `\r` stripping on all extracted fields.

### Deferred (filed for v2.3)
Findings still open after this release (subagents wrote multi-doc YAML; will import via `lattice file --from` once v2.2.2 is verified):
- MEDIUM `yaml-field-key-regex-injection` — latent today (all callers internal), risky for future `lattice get <slug> <key>` callers
- HIGH `project-sync-auto-claude-md-race` — CLAUDE.md regenerator races with itself on parallel closes. Needs flock + per-PID tmp.
- MEDIUM `cmd-defer-strip-then-append-race` — two-step write in cmd_defer
- MEDIUM `lattice-close-helper-window-between-mv-and-lifecycle-append`
- LOW `events-jsonl-append-not-atomic-on-windows`
- MEDIUM `w1n-mktemp-no-fallback`, `w1n-stop-hook-bash-spawn-no-shim`
- LOW `w1n-install-cmd-wrapper-space-in-userprofile`, `w1n-shim-version-bash-spawn-windows-path`

### Process learnings
- **Subagents can audit even when sandboxed from bash.** 3 of 5 dispatched agents had bash denied; they still returned high-quality findings via static read of the code. The lesson: hardening audits don't require execution; code-shape patterns are 80% of the signal.
- **Parallel sub-agent hardening is now a Lattice primitive.** Will formalize as `/audit-sweep . stress` dimension in v2.3.

## [2.2.1] — 2026-05-20

**Slice F shipped — agent platform (minimal).** Closes the v2.2 design doc's last open slice in the same session as v2.2.0.

### Added
- **`lattice agent`** subsystem — registry + per-agent feedback log + iteration dispatch:
  - `lattice agent new <slug> --kind <kind> --description "..."` — register an agent spec at `.lattice/agents/<slug>.yml`.
  - `lattice agent list` — table of slug / kind / version / feedback count.
  - `lattice agent show <slug>` — print agent yaml + tail of feedback log.
  - `lattice agent feedback <slug> --type <bug|enhancement|win|miss> --body "..."` — append observation to `.lattice/agents/<slug>.feedback.jsonl`.
  - `lattice agent iterate <slug> [--apply]` — emit a `@claude` prompt summarizing accumulated feedback. `--apply` opens a GH issue (label: `lattice-agent-iterate`) so the @claude GitHub App reads the feedback and opens an iteration PR.

### Scope (deliberately narrow)
- Out of scope for v2.2.1 (defer to v2.3+): cross-project telemetry pipeline, automatic friction clustering across agents, A/B harness. v2.2.1 ships the registry + manual-feedback loop only — the mechanism that turns Claude Code subagents from static-config-forever into something that iterates against real friction.

## [2.2.0] — 2026-05-20

**Autonomous loop closure + multi-project setup collapse.** v2.1 made measurement autonomous (cron → Telegram digest). v2.2 closes the loop on action (close / rollback) and collapses per-project setup from ~3h to ~30s.

7 of 8 design-doc slices shipped. Slice 8 (agent platform F) deferred to v2.3 — multi-hour subsystem that deserves a dedicated session.

### Security (HIGH, ships first)
- **HIGH-scripts-cmd-source-arbitrary-exec: `cmd:` source scheme now default-deny.** Any hypothesis YAML containing `measurement.source: cmd:...` previously ran arbitrary shell on `lattice grow measure` / cron — RCE surface with repo secrets. Opt-in via `.lattice/config.yml` `security.allow_cmd_sources: true` OR `LATTICE_ALLOW_CMD_SOURCES=1`. `lattice grow propose` warns loudly when `--measurement-source` starts with `cmd:`. New `security:` block in default `lattice config init` template documents the gate.

### Added
- **#77: `lattice onboard`** — one command runs the full per-project sequence: `setup` → `wire-hooks --apply --yes` → `mcp setup --apply --yes` → `grow init` → `grow schedule install`. Prints the GH secret `set` commands and the next-step `/audit-sweep .` prompt. Flags: `--time HH:MM`, `--day mon..sun`, `--transport github-actions|local-cron`, `--utc`, `--auto-action`, `--skip-mcp`, `--skip-schedule`.
- **#80 #83: `lattice link <id-a> <id-b> --kind <blocks|duplicate-of> [--reason "..."]`** — bidirectional cross-ref primitive. Writes structured flow-style entries to both YAMLs' `relates_to:` blocks. Idempotent. v2.2 starts narrow with `blocks` + `duplicate-of` per design doc.
- **Close-time cross-ref nudge.** `lattice close` scans the target's `relates_to` and prints each related finding's tier + state. Stale links surface as `(NOT FOUND — stale link)`.
- **#66: `lattice grow schedule install --auto-action`** — generated workflow gains a "Dispatch @claude autonomous action" step that opens a `@claude`-mentioning GH issue for every succeeded/failed verdict. `succeeded` → close direct (low risk YAML rename); `failed` → @claude opens a PR (NOT direct push) for `auto-rollback --execute`. Requires `permissions: issues: write` — only enabled with `--auto-action`.
- **#82: SessionStart deltas-since-last-fire.** Hook persists last-fire ISO in `.lattice/.session-start-last` and emits `- Since last session (YYYY-MM-DD): 2 closed, 1 reported`. First fire writes marker silently. Pure-Node + 1.5s hard timeout preserved.
- **#78 #79: `lattice file --from <multidoc.yml> [--no-confirm-dup]`** — batch finding creation from `---`-separated YAML. Dupe-detect normalizes title (lowercase + alphanumeric + first 40 chars) and warns / skips matching existing finding. Interactive prompt unless `--no-confirm-dup`.
- **#84: prepare-commit-msg verify hint.** New `prepare-commit-msg-lattice.sh` hook scans staged files vs `.lattice/findings/open/*.yml` and appends `Lattice: touches files referenced by HIGH-foo, ... Run \`lattice verify\` after commit.` Wire via `lattice install-hooks`. Opt-out: `LATTICE_PREPARE_COMMIT_MSG_DISABLE=1`. Skips amend/merge/squash sources.

### Changed
- `cmd_install_hooks` refactored to install both `post-commit` and `prepare-commit-msg` via shared `_install_one_hook` helper.
- `_KNOWN_SUBS` extended: `link`, `onboard`, `file`.
- `usage()` mentions `onboard` explicitly.
- Default `.lattice/config.yml` template includes the `security:` block.
- `install.sh` + `update.sh` SCRIPTS arrays include `prepare-commit-msg-lattice.sh`.

### Deferred to v2.3
- **Slice F — agent platform:** `lattice agent new|list|suggest|review` + telemetry-driven iteration loop mirroring grow architecture (propose → run → measure → close-or-rollback). Needs a fresh session to ship cleanly.

## [2.1.4] — 2026-05-20

**Hot-fix for #76: `lattice grow check --json` emitted invalid JSON.** The bug silently broke the Telegram digest on the first real cron fire (no message reached the channel despite secrets being set correctly).

### Fixed (#76, HIGH)
- `_grow_check`'s json branch used `|| echo "{}"` as a fallback on per-hypothesis measure failures. `_grow_measure --json` correctly emits a valid JSON object even when it returns 1 (fetch-failed case) — the OR-echo then appended a stray `{}` AFTER the real object, breaking the envelope's `hypotheses` array.
- Replaced with `|| true` so `set -e` doesn't kill the loop without adding garbage to stdout.
- Also strip trailing newlines from per-hypothesis rows before joining with commas (printf added a `\n` that was leaking into the array).

### Verified
- Synthetic test on `/tmp/grow-v2-test` with 2 hypotheses both fetch-failed:
  - Pre-fix: `{...hyp1...}\n{},{...hyp2...}\n{}]}` — fails `JSON.parse` at position 169
  - Post-fix: `{"summary":{...,"failed_fetch":2},"hypotheses":[{"slug":"t1",...},{"slug":"t2",...}]}` — parses cleanly via node
- Validated round-trip via `node -e 'JSON.parse(...)'`

### Why this matters
Without this fix, the autonomous loop shipped in v2.1.0/v2.1.2 silently failed on its first real cron fire: GitHub Actions ran cleanly, `lattice grow check --json` "succeeded" (exit 0), but `lattice-grow-telegram.mjs` crashed parsing the malformed JSON. No Telegram message reached the channel. User finds out by *not* getting their Monday morning verdicts.

## [2.1.3] — 2026-05-20

**Three real-use bugs from overnight + Part A origin tracking** (per design conversation about cross-project bug aggregation).

### Fixed
- **#75 (HIGH): generated workflow YAML invalid** — `if: secrets.X` was rejected by GitHub Actions with `'Unrecognized named-value: secrets'`. Workflow now always runs the Post-to-Telegram step and short-circuits internally when tokens are absent (the formatter already exits cleanly without them per v2.1.0). The generated `.github/workflows/lattice-grow-check.yml` now parses cleanly on push.
- **#67 (MED): audit-env-contract walks `node_modules` and vendored deps.** Added `--exclude-dir` to every env-contract grep call: `node_modules`, `.git`, `dist`, `build`, `.next`, `coverage`, `vendor`, `.lattice`, plus Python (`__pycache__`, `.venv`, `venv`) and Dart (`.dart_tool`) equivalents. Pearl_Website_NextJS audit went from 48 noisy findings (Next.js internals + ora spinner garbage) to ~25 real ones.
- **#71 (HIGH): literal-copy shim drift detection rewrite.** Previous (v1.4.1) detection only recognized symlinks + bash `exec` wrappers; missed literal copies entirely. New approach: `lattice doctor` and `update.sh` both invoke `lattice version` through the shim and compare against the canonical install's reported version. Catches ALL shim forms (symlink, wrapper, literal copy, alias) because we compare *output*, not file shape. The audit-sweep this morning hit this exact bug on a literal-copy at `~/bin/lattice`.

### Added — Part A: origin tracking on `lattice report`
- **`lattice report` now sends `project: <basename of cwd>`** in the manual-report payload. Worker validates + sanitizes to a label-safe form.
- **Worker tags each manual-report GitHub Issue with `project:<basename>` label.** `gh issue list --label project:IsaamNextJs` now surfaces per-project bug pressure across all your projects.
- **Project name also appears in the issue body** (`**Project:** \`<basename>\``) so the source is visible at-a-glance, not just in label state.
- Sanitization: lowercase, `[a-z0-9._-]` only, capped 40 chars (GitHub label rules).

### Why Part A (not Part B)
You asked: should reporters submit architecture suggestions too, with tier-weighted diff selection? My honest read: yes to origin tracking (cheap, immediate signal value), no to architecture-by-vote (premature for current scale, architecture decisions don't aggregate well by majority). When v2.2 surfaces real cross-project convergence (multiple projects independently filing the same shape of friction), then the data justifies a richer aggregator. Today: just the labels.

### Held for v2.2
- **HIGH cmd: scheme RCE** — allow-list design
- **#66** — @claude GitHub App
- **3 MEDIUM security** (env-var leak via headers, eval in verify, MCP close gate)
- **3 WATCH scale** (yaml_field fork tax, MCP subprocess caching, audit-sweep cap)

### Verified
- Synthetic test: env-contract on `/tmp/v213-test` with both `node_modules/fake/index.js` (fallback `'pwned'`) and `app.js` (fallback `'dev-default'`) — output contains only `REAL_KEY`, not `FAKE_KEY`.
- Manual test: `lattice report bug --severity MED ...` from `/e/Lattice` cwd → GH issue gets `project:lattice` label and `**Project:** \`lattice\`` body line.
- `bash -n scripts/lattice`, `bash -n scripts/update.sh`, `node --check worker/lattice-telemetry.js` all clean.

## [2.1.2] — 2026-05-20

**TIER-1 fixes from this morning's audit-sweep on Lattice itself + dogfood reports.** Eight bugs from issues #68–#73 and 14 cross-module DRIFT findings, all addressed. Architectural work (cmd: RCE, drift-detection rewrite, scale-fork-tax) deferred to v2.2.

### Fixed
- **#70 (HIGH): `lattice close` fails on subsequent calls — helper-path resolution.** Dispatcher resolved `HELPER_CLOSE` / `HELPER_REOPEN` / `HELPER_REGEN` at script-load time relative to `SELF_DIR`. When the shim resolved to a directory without those helpers (the literal-copy-shim drift case), every helper invocation failed. New `_resolve_helper(name)` tries `SELF_DIR` first, falls back to `~/.claude/lattice/scripts/` (canonical install), then `/usr/local/lattice/scripts/`. Same HELPER_* constants resolve through this on script load.
- **#68 (MED): audit-env-contract YAML filename-too-long from regex-capture pollution.** Defensive sanitization in `_env_emit_finding` + the contract-drift path: `key=$(printf '%s' "${key}" | tr -cd 'A-Z0-9_' | head -c 60)` before composing the slug. Refuses to emit when sanitization leaves an empty key (regex matched something that wasn't an env var).
- **#69 (MED): `lattice triage` advertised but unimplemented.** Removed `triage` from `cmd_usage`'s hardcoded known-subcommand list (line 1650) — it was already gone from `_KNOWN_SUBS` and from the dispatcher in v0.9.18, but this fourth source of truth still advertised it. Also stripped `lattice triage` references from `commands/audit.md`, `audit-sweep.md`, `flow-audit.md`, `scale-audit.md`, `security-audit.md`, and `README.md` — replaced with `lattice next` (the actual highest-priority-finding command).
- **#73 (LOW): `lattice report --severity MEDIUM` rejected.** Accepted vocabulary was `LOW | MED | HIGH`; finding-schema uses `MEDIUM`. Now `MEDIUM` is silently aliased to `MED` before validation. Error message also mentions the alias.

### Changed (DRIFT cleanup from this morning's sweep)
- **Per-tier required-fields cheatsheet** appended to `commands/references/audit-sweep-module-dispatch.md` so subagents emit fully-schema-compliant YAML on first pass (#72): security CRITICAL/HIGH need owasp+exploitability+blast_radius+attack_scenario+secure_code_example; flow CRITICAL/HIGH need impact; scale BLOCKER needs failure_mode. Without this, `lattice sync` blocks mid-aggregation on any HIGH/CRITICAL security finding.
- **MCP zod schemas synced to bash CLI tier vocab.** Added `RISK`, `WATCH`, `INTENTIONAL`, `UNVERIFIABLE` to tier enum (was missing 4 of 11 tiers). Added `coverage`, `configuration`, `quality`, `product`, `infra` to dimension enum (was missing 5). Added `in_progress` to status enum (the canonical name `partial` aliases to internally). Closes the 4 DRIFT findings on mcp/src/index.ts.
- **`scripts/lattice` usage() now lists the full grow + profile + normalize + diff + audit-infra + release-notes + setup + uninstall + ci-check-dead surface** (v2.0+). Previously these were dispatcher-only with no help-text mention — users couldn't discover them.
- **README.md** now lists `lattice grow` alongside the lifecycle CLI verbs, and drops `lattice triage` from the example list.
- **`$ARGUMENTS` now quoted** in `commands/lattice-fix.md` (3 sites). Prevents shell-metachar interpretation when a user passes a slug with spaces or special characters.

### Verified
- `bash -n scripts/lattice` clean
- `lattice triage` now correctly errors as "unknown subcommand" instead of being advertised+broken
- `lattice report bug --severity MEDIUM ...` files cleanly (alias converts to MED)
- `npx tsc` clean in `mcp/` after enum updates

### Held for v2.2.0
- **#HIGH cmd: scheme RCE** — needs allow-list design (default deny? per-project config? PR-merge-time check?)
- **#71 literal-copy shim drift** — drift detection should compare `lattice version` output, not file-shape heuristic
- **3 MEDIUM security** — env-var-leak via `${VAR}` in headers, eval in `lattice verify`, MCP close-finding no programmatic gate
- **3 WATCH scale** — yaml_field fork tax, MCP subprocess caching, audit-sweep module cap

## [2.1.1] — 2026-05-20

**Trial-1 v2.1 dogfood patch.** Four real-use frictions filed overnight, all fixed.

### Fixed
- **#62 (UX): `grow schedule install --time` now interprets HH:MM as user-local time.** Detects local TZ offset via `date +%z`, converts to UTC for the GitHub Actions cron expression (which has no choice but UTC). Handles day-rollover when the conversion crosses midnight. Prints both interpretations:
  - `cron expression: 30 3 * * 1 (UTC) — fires MON at 03:30 UTC`
  - `             = MON 09:00 IST (local). Override with --utc to treat --time as UTC.`
  - `--utc` flag opts out (HH:MM treated as already-UTC).
- **#63 (BUG): `lattice update --self` now detects shim drift explicitly.** `update.sh` resolves the user's shim, compares the shim-target's plugin.json version against the canonical install's new VERSION, and emits a `!!! SHIM DRIFT` warning with the exact `ln -sfn` fix when they disagree. Previous behavior: `update.sh` printed "0.9.16 -> 1.4.0" and exited 0 even when `lattice --version` would still report the old number because the shim pointed at a non-canonical install. v1.4.1 added this check inside the `lattice` script itself, but standalone `bash scripts/update.sh` runs (and curl-pipe installs) skipped it; v2.1.1 puts the same check in update.sh.
- **#64 (BUG): generated workflow uses `actions/setup-node@v4` with Node 22.** Pre-fix: workflow only used `actions/checkout@v4` and relied on the runner's default Node, which GitHub flagged as deprecated (Node 20 → forced Node 24 on 2026-06-02). Explicit Node 22 pin keeps the workflow stable through the runner migration.
- **#65 (UX): `grow schedule status` renders last-run as human-readable.** Pre-fix: `last run: []` (bash array literal). Post-fix: `last run: 2026-05-19T16:56:30Z  success  (id 12345)`. Falls back to `never` when no runs exist. `grow schedule trigger` now polls for the new run ID (up to 6s) and prints concrete `gh run watch <id>` + `gh run view <id>` commands instead of the generic `gh run watch` that prompts.

### Verified
- Live: `grow schedule install --time 09:00 --day mon` on Asia/Kolkata (UTC+5:30) → cron `30 3 * * 1` (correct: 09:00 IST = 03:30 UTC)
- Live: `grow schedule install --time 14:30 --day mon --utc` → cron `30 14 * * 1` (UTC preserved)
- Generated workflow contains `actions/setup-node@v4` + `node-version: '22'`
- `bash -n scripts/lattice` + `bash -n scripts/update.sh` clean

### Held for later
- **#66** (HIGH enh, v2.2): `@claude` GitHub App integration — autonomous *action* after autonomous measurement. Big scope; held for design discussion after the v2.1 loop has fired at least once in real life (first cron: Mon 2026-05-25 09:00 local).

## [2.1.0] — 2026-05-19

**Closes #60 + #61 from the first real v2.0 dogfood.** Auth headers, schema migration, multi-source combine, autonomous schedule, Telegram updates — all the v2.1+ deferrals from v2.0 that the trial-1 report turned from "future" into "needed now."

### Added — auth + multi-source (#60)
- **`measurement.headers` YAML block** with `${ENV_VAR}` interpolation at fetch time. HTTP sources can now hit auth-gated metric endpoints:
  ```yaml
  measurement:
    source: "https://api.example.com/metrics/x"
    headers:
      Authorization: "Bearer ${LATTICE_METRIC_TOKEN}"
      X-Api-Version: "2"
  ```
- **`measurement.sources` list** + `measurement.combine` (`sum` / `max` / `min` / `weighted-avg`). Bundled-change hypotheses (one PR touching multiple things) can declare multiple metrics:
  ```yaml
  measurement:
    combine: sum
    sources:
      - name: "papercraft_clicks"
        source: "https://example.com/api/m?key=papercraft"
        baseline_value: 0
        weight: 1
      - name: "risecraft_clicks"
        source: "https://example.com/api/m?key=risecraft"
        baseline_value: 0
    success_threshold: 1
    window_days: 7
  ```
  Each source fetched independently; combined per `combine:` semantics; single verdict against `success_threshold`.
- **`lattice grow attach-measurement <slug>`** — adds a `measurement:` block to an existing hypothesis YAML (any state). Closes the v1.4.0 → v2.0 migration gap where pre-v1.4.2 hypotheses had no way to gain a measurement block except hand-editing.

### Added — autonomous schedule (#61)
- **`lattice grow check --json`** — single-line JSON envelope `{summary, hypotheses[]}` per hypothesis. Designed for piping into the Telegram formatter.
- **`lattice grow schedule install [--transport github-actions|local-cron] [--time HH:MM] [--day mon|...]`** — wires the autonomous check loop:
  - `github-actions` (default): writes `.github/workflows/lattice-grow-check.yml` with a weekly cron that installs Lattice, runs `lattice grow check --json`, pipes the result through `lattice-grow-telegram.mjs`, POSTs the formatted message to Telegram (if `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` repo secrets are set; silently skips if not).
  - `local-cron`: emits the crontab line for the user to paste — no auto-write.
- **`lattice grow schedule status / uninstall / trigger`** — inspect/remove/manually-fire the workflow. `trigger` requires `gh` CLI.
- **`scripts/lattice-grow-telegram.mjs`** — formatter that reads a `grow check --json` envelope from stdin, renders an HTML message with verdict icons (🟢 won, 🔴 lost, 🟡 still-running, ⚠️ fetch-failed, ⚪ skipped/inconclusive), and POSTs to the Telegram bot API. Includes copy-pasteable close/auto-rollback commands per hypothesis.

### How the closed autonomous loop works now
```bash
# In each project (one time):
lattice grow schedule install                # writes .github/workflows/lattice-grow-check.yml
git add .github/workflows && git commit -m "chore: lattice grow weekly check"
git push
# Set repo secrets TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in GitHub settings

# Then for each hypothesis:
lattice grow propose <slug> --measurement-source 'https://...' --success-threshold N --window-days 7
lattice grow run <slug> --commit $(git rev-parse HEAD)
# Walk away. Each Monday 09:00 UTC, you get a Telegram message:
#   🟢 my-hyp (Day 7/7) → verdict: succeeded
#         current 0.025 vs threshold 0.02
#         `lattice grow close my-hyp --result won --observed-value 0.025`
```

### Verified
- Live `/tmp/v21-test` end-to-end:
  - `propose` (no measurement) → `attach-measurement --metric-name ctr --measurement-source file:/tmp/m.txt --baseline-value 0.01 --success-threshold 0.02 --window-days 7` correctly inserts the `measurement:` block after the `metric:` line
  - `grow run` + `grow check --json` returns: `{"summary":{"measured":1,"won":1,...},"hypotheses":[{...verdict:"succeeded"...}]}`
  - `grow schedule install` writes a valid GitHub Actions workflow with cron `0 9 * * 1` (Mon 09:00 UTC) and the install/check/post pipeline
  - `lattice-grow-telegram.mjs` correctly refuses to post without `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (exit 1 with clear error)
- `bash -n scripts/lattice` and `node --check scripts/lattice-grow-telegram.mjs` clean.

### v2.2+ deferrals (still)
- **Multi-project digest** — one Telegram message summarizing N projects' hypotheses. Needs cross-project state aggregation.
- **Confidence-interval / MDE stats** — verdict is still a hard threshold compare.
- **Auto-merge of close commands from Telegram tap** — too risky for v2.1; user copies command, runs locally.
- **Hypothesis auto-generation from product data** — v3.0+, needs LLM integration.

## [2.0.0] — 2026-05-19

**Closed-loop hypothesis execution.** Foundation shipped in v1.4.0; structured measurement schema in v1.4.2; v2.0 wires them to real runtime behavior. A hypothesis can now be measured against its source, evaluated against its threshold, and rolled back via real `git revert` — without human intervention except for an `--execute` confirmation gate.

### Added — measurement pipeline
- **`lattice grow measure <slug>`** — fetches the live metric value from a hypothesis's `measurement.source` and renders a verdict against `baseline_value` + `success_threshold` + `window_days`. Verdicts: `still-running` / `succeeded` / `failed` / `inconclusive` / `insufficient-data`. Emits a suggested next action (`close --result won`, `auto-rollback`, or `wait`).
- **`lattice grow check [--state running]`** — measures every running hypothesis, summarizes verdicts in one pass. Designed for cron/manual periodic invocation.
- **Pluggable measurement-source schemes** (set via `--measurement-source` on `propose`):
  - `http://...` / `https://...` — GET expecting JSON; reads `.value` → `.data.value` → `.metric` → `.data.metric`. Curl + node required.
  - `file:/path` — read a single number from the file (whitespace-stripped).
  - `cmd:<script>` — exec the script, parse last numeric stdout line.

### Added — auto-rollback
- **`lattice grow auto-rollback <slug> [--execute] [--yes]`** — when measure verdict is `failed`, performs:
  1. Backs up current branch tip to `refs/lattice/pre-rollback/<slug>` (recoverable ref, never expires)
  2. Runs `git revert --no-edit <run_commit>` (NEW commit on top; non-destructive)
  3. Transitions YAML from `running/` → `rolled-back/` with `rolled_back_at`, `rollback_reason`, `revert_commit`, `observed_value` stamps
  4. Prints the exact undo command (`git reset --hard refs/lattice/pre-rollback/<slug> && mv ...`)
  - **Default DRY-RUN.** `--execute` required to mutate. `--yes` skips interactive confirm.
  - **Refuses** when verdict isn't `failed` (use manual `lattice grow rollback` to override).
  - **Refuses** when `run_commit` isn't an ancestor of HEAD (cannot revert).
  - **On revert conflict:** runs `git revert --abort`, leaves state unchanged, prints the manual command.

### Why this completes the loop
v1.4.0 was a structured journal. v2.0 makes it autonomous:
- Schedule `lattice grow check` periodically (manual cron, or future cadence layer)
- On `failed` verdicts, run `lattice grow auto-rollback <slug> --execute --yes` from the same scheduler
- The maintainer gets emails / Telegram pings (from their own infra) showing what happened
- Every action is reversible via the backup ref

### Verified
- Live end-to-end test in `/tmp/grow-v2-test` with `file:/tmp/metric.txt` source, `window_days=0`, threshold above current:
  - `measure` correctly verdicts `failed` with the suggested `auto-rollback` action
  - `auto-rollback` DRY RUN shows backup ref, git revert sha, and YAML transition plan
  - `auto-rollback --execute --yes` creates real revert commit on master, backs up old HEAD as `refs/lattice/pre-rollback/cta-test`, moves YAML to `rolled-back/`, stamps `revert_commit` + `observed_value: 0.005`
- `bash -n scripts/lattice` clean

### Explicit NON-goals in v2.0 (deferred to v2.1+)
- **Cadence scheduling** — no built-in cron/queue. Users wire `lattice grow check` into their own cron, GitHub Actions schedule, or systemd timer. This is a packaging concern, not core logic.
- **Low-traffic confidence intervals** — `succeeded` / `failed` is a hard threshold compare. Statistical sophistication (p-values, MDE, sample-size calc) is v2.1.
- **Hypothesis auto-generation** — requires LLM integration + product-data analysis. v3.0+ scope.
- **PR-based execution** — `grow run` still expects a manual `--commit <sha>`. Auto-PR-from-hypothesis is v2.1.

## [1.4.2] — 2026-05-19

**Hot fix from v1.4.0 dogfood**: #58 `body: unbound variable` crash + #59 structured measurement fields.

### Fixed (#58)
- `_mcp_setup` and `_wire_hooks` now defensively initialize `local status="" body=""` and use `${out:-}` + `|| true` on the substitution pipelines. Under `set -euo pipefail`, an empty `${out}` or pipefail in the substitution previously left `body` unset; the next `echo "${body}"` then tripped "unbound variable" and aborted the command. Defensive init removes the failure mode regardless of node helper edge cases.

### Added (#59)
- **Structured measurement block** in `lattice grow propose`:
  - `--metric-name <name>` — the metric being measured (e.g., `ctr`, `signups_per_day`)
  - `--measurement-source <path>` — where it's measured (e.g., `/api/track`, `posthog:event=signup`)
  - `--baseline-value <number>` — snapshot of metric pre-change
  - `--baseline-source "..."` — how the baseline was sampled
  - `--expected-delta <number>` — predicted change (e.g., `+0.005`)
  - `--success-threshold <number>` — the cutoff for `won`
  - `--window-days <N>` — measurement window
  - All fields land under a `measurement:` block in the YAML — v2.0 auto-rollback reads these directly without re-parsing the `metric:` free-text.
- **`--observed-value <number>` on `lattice grow close`** — captures the actual outcome at close time. Pairs with `baseline_value` + `success_threshold` to enable v2.0's auto-rollback signal.
- `grow propose` emits a stderr note when structured fields are omitted, pointing at #59 so users know v2.0 will need them.

### Verified
- Live test: `grow propose cta-test ... --metric-name ctr --baseline-value 0.012 --success-threshold 0.015` emits structured `measurement:` block; `grow close --observed-value 0.018` stamps it under `observed_value: 0.018`.
- `bash -n scripts/lattice` clean.

## [1.4.1] — 2026-05-19

**Shim-drift detection + update self-verification.** Closes the silent-failure mode that bit us during the v1.4.0 dogfood: a session reports "you have v0.9.16, no `lattice grow`" while a parallel session insists "v1.4.0 is shipped." Both true — the GitHub release is live AND the user's `lattice` shim resolves to a different on-disk script that update.sh never touched.

### Added
- **`lattice doctor` shim drift detection.** Resolves where `lattice` actually executes from (follows symlinks + bash exec wrappers), then compares:
  - shim target vs canonical install at `~/.claude/lattice/scripts/lattice`
  - shim version vs canonical install version
  - shim target vs the doctor script's own resolved path
  Emits one of three signals:
  - `[PASS] shim resolves to <path>` — shim path resolved cleanly
  - `[WARN] shim non-canonical but version matches` — different file, same version (works for now; will drift after next `update --self`)
  - `[FAIL] shim drift: running=<X> but canonical=<Y>` — different file, different version; user invokes one, update.sh wrote to the other
- **`lattice update --self` self-verification.** Captures running version pre-update, runs the updater, then re-reads `lattice version` post-update. If the running version didn't move AND the canonical version did, exits 2 with explicit "your shim points elsewhere" message + the exact `ln -sfn` command to fix it. Replaces the previous silent "0.9.16 → 1.4.0" success message that was lying about user-visible reality.

### Why this matters
Lattice has been silently shipping fake updates whenever a user's shim points at a non-canonical install location. The v1.4.0 dogfood surfaced it: I edited `/e/Lattice/scripts/lattice` (dev checkout) and pushed v1.4.0 to GitHub, but the user's shim pointed at `/e/DXB_Superpowers/Lattice/scripts/lattice` (a separate older install). `lattice update --self` updated `~/.claude/lattice/scripts/lattice` (canonical) — yet `lattice version` kept returning 0.9.16 because that's not what the shim invoked. v1.4.1 makes this loud instead of silent.

### Verified
- Live `lattice doctor` on this machine flags the shim-non-canonical state with the exact remediation hint
- `bash -n scripts/lattice` clean

## [1.4.0] — 2026-05-19

**Operator profile + hypothesis lifecycle.** Closes the next 3 RFCs in one ship — #55 (workflow-context tier reweighting), #56 (per-user operator profile), and #57 (`lattice grow` as second dimension, reversing v1.3.1's #45 deferral).

### Added — operator profile (#55 #56)
- **`lattice profile init | show | set`** — global per-user profile at `~/.lattice/profile.yml`, project-level override at `.lattice/profile.yml`. Declares `operator.scale` (solo/small-team/org/enterprise), `workflow_constraints` (will_check_dashboards, will_query_databases, will_read_log_files, push_channels_only), `preferences` (prefer_delete_over_wire, confirm_before_large_changes).
- **Tier reweighting under `--effective-tier`** applies profile rules in addition to existing exposure-based demotion:
  - `scale=solo` + dead-code/unused rules → demote 1 step
  - `will_check_dashboards=false` + fix mentions "dashboard" → demote 2 steps
  - `will_query_databases=false` + fix mentions "query the database" → demote 1 step
  - `push_channels_only=true` + fix mentions "open the admin" → demote 1 step
- Render-time only — the raw `tier:` field in YAML stays unchanged. Reweighting shows as `[profile: HIGH->MEDIUM]` in the `extra` column so the original signal is auditable.

### Added — `lattice grow` hypothesis lifecycle (#57 foundation)
- **`lattice grow`** subcommand tree mirroring the findings lifecycle but for forward-looking changes (growth experiments, refactor proposals, product hypotheses):
  - `grow init` — creates `.lattice/hypotheses/{open,running,closed,rolled-back}/`
  - `grow propose <slug> --title --change --metric [--cadence --effort --risk]` — files a new hypothesis YAML
  - `grow list [--state ...]` — table of hypotheses by state
  - `grow show <slug>` — full YAML
  - `grow run <slug> --commit <sha>` — `open` → `running`, stamps run_at + run_commit
  - `grow status <slug>` — current state + lifecycle stamps
  - `grow rollback <slug> --reason "..."` — `running` → `rolled-back`, stamps rolled_back_at + rollback_reason
  - `grow close <slug> --result won|lost|inconclusive [--rationale "..."]` — `running|open` → `closed`, stamps closed_at + result
- Hypothesis YAML schema parallels finding schema: `id`, `slug`, `state`, `title`, `change`, `metric`, `cadence`, `effort`, `risk`, lifecycle stamps. `id` is sha1-derived (12-char prefix) of `growth:slug:change:metric` — stable across line shifts, same algorithm as `lattice id-gen` for findings.

### Scope honesty — what's NOT in v1.4.0
- **Closed-loop execution** (auto PR creation, auto-rollback signal detection, cadence scheduling, low-traffic stats, confounder modeling) is v2.0 scope. v1.4.0 ships the manual lifecycle — you manually `grow propose` → `grow run --commit <sha>` → `grow close --result`. The closed-loop sits behind a future `grow run --auto` flag that's not implemented yet. Foundation first, automation after evidence accumulates that the schema holds up.
- The v1.3.1 closing of #45 ("24/7 always-on Lattice → NOT in Lattice") stands as the boundary for the **auto-loop**; #57 reverses the framing on the foundation only.

### Verified
- `/tmp/grow-test`: full lifecycle works end-to-end. `propose test-hyp` → `run --commit abc1234` → `status` shows running + commit → `close --result won` → `list` shows closed.
- `profile init` creates `~/.lattice/profile.yml`; `profile show` reads global + project override correctly.
- `bash -n scripts/lattice` clean.

## [1.3.1] — 2026-05-19

**`lattice list` hides OK-tier by default (#16).** Closes the last actionable issue in the backlog. The "47-entry list mixing real problems with confirmed-clean OK markers" complaint is fixed at the read layer — much cheaper than moving OK findings to a separate filesystem directory (which would require migration scripts + audit-skill emission changes).

### Changed
- `lattice list` filters out `tier: OK` findings by default
- `--include-ok` (alias `--all`) restores the previous behavior
- `--tier OK` explicit filter overrides the hide (you can still query OK markers when you want them)
- Behavior matches what SessionStart hook + statusline already do for OK suppression

### Closed without code change
- **#16** (OK findings should live in ok/) — addressed by read-layer hide. Filesystem layout unchanged.
- **#17** (RFC: cross-repo finding dependencies) — deferred to v2.x. Cross-repo audit substrate is a separate design.
- **#20** (Enforce operational knowledge at action-time) — addressed structurally by v1.3.0 `audit-infra` PreToolUse-block detection. Specific runbook-as-hook is a per-project pattern, not a Lattice-CLI feature.
- **#28** (Telemetry blind to silent correctness bugs) — separate problem space (output validation). Deferred to v2.x.

## [1.3.0] — 2026-05-19

**New `infra` audit dimension + Stop hook closes the friction-reporting loop.** Closes #36 and #40, plus auto-files-on-session-end for the friction-default-on protocol introduced in v1.2.0.

### Added
- **`lattice audit-infra [--path .] [--write]`** (#36) — new audit dimension. Detects whether the Claude Code infrastructure (`.claude/settings.json` hooks + `~/.claude.json` MCPs) is adequate for the detected stack. Examples it catches:
  - TypeScript project without PostToolUse type-check hook → `infra-missing-typecheck-hook` (MEDIUM)
  - `.env*` files present without PreToolUse env-protection block → `infra-missing-env-protection` (HIGH, security exposure)
  - `package-lock.json` without lockfile-edit-block hook → `infra-missing-lockfile-protection` (LOW)
  - `@supabase/supabase-js` in deps without Supabase MCP → `infra-missing-mcp-supabase` (MEDIUM)
  - Next.js + React without browser-automation MCP → `infra-missing-mcp-playwright` (MEDIUM)
  - Bleeding-edge framework (Next 15+, React 19+) without context7 MCP → `infra-missing-mcp-context7` (MEDIUM)
  - Test runner detected without test-on-edit hook → `infra-missing-test-hook` (LOW)
- **`scripts/lattice-stop.mjs`** + **`lattice wire-hooks --stop`** (#40) — Stop hook that fires `lattice review --file --yes --quiet` at session end. Catches any friction Claude didn't file inline via `lattice report`. Same safety discipline as the SessionStart hook: hard 2s timeout, silent skip when `.lattice/` absent or `lattice` CLI unreachable, `LATTICE_STOP_DISABLE=1` kill switch. `wire-hooks` now wires Stop by default; `--no-stop` opts out.

### Changed
- `wire-hooks` JSON merge now includes the Stop hook entry under `hooks.Stop[]`. Idempotent: re-running detects existing Lattice Stop entries (by basename sentinel `lattice-stop.mjs`) and replaces them cleanly.
- `install.sh` + `update.sh` now ship `lattice-stop.mjs` alongside the other scripts.

### Verified
- `lattice audit-infra` against the real Next.js portfolio (`E:/IsaamNextJs`) emits 5 findings: typecheck hook, env protection, lockfile, playwright MCP, context7 MCP — all real gaps on that project.
- `lattice wire-hooks` dry-run now shows the `Stop` entry alongside `SessionStart` + `statusLine`.
- `bash -n` and `node --check` on all modified files clean.

## [1.2.0] — 2026-05-19

**Friction-reporting becomes default-on + framework-aware audits + `lattice diff` lands.** Closes the next wave of dogfood-surfaced gaps (#42, #43, #48, #51, #54).

### Added
- **`lattice diff <sweep-a> <sweep-b>`** (#43) — compare two sweep manifests by their slug sets. Reports `opened` (in B not A), `closed` (in A not B), `unchanged` (in both). `--latest` auto-selects the two most-recent. Eliminates the doc-vs-code drift where `docs/finding-schema.md` referenced `lattice diff` but the dispatcher rejected it.
- **`lattice write-manifest`** (#48) — wraps `scripts/lattice-write-manifest.sh` so audit-sweep skill can reach the manifest writer whether installed globally or from a dev checkout. Fixes the "bash scripts/lattice-write-manifest.sh ... not found" error in project-installed sessions.
- **Framework-aware module enumeration in audit-sweep skill** (#51). Detects layout BEFORE globbing `src/modules/`. Order: `src/modules/*/` → monorepo (`apps/*/`+`packages/*/`) → Next.js App Router (`src/app/api/`, `src/app/*/page.tsx`, `src/lib/`, etc) → Next.js Pages Router → Go (`lib/`, `internal/`, `cmd/`) → Flutter/Dart (`app/`, `lib/`, `test/`) → flat-repo fallback (top-level dirs, skip `node_modules`/`.git`/`dist`/`build`/`.next`/`coverage`, cap at 12). Hardcoded `src/**` is gone.
- **Friction-reporting default-on protocol in SessionStart hook** (#42 #54). Hook output now carries an explicit "DEFAULT-ON, not optional" directive: when Claude hits ANY of {missing command, workaround beats canonical path, wrong/missing error message, doc-code drift, slow/spammy path}, it MUST `lattice report` immediately — not batch at session end. The workaround IS the evidence. Closes the recurring failure where audit-sweep sessions surface 7 friction points and file zero of them until the user explicitly asks.

### Fixed
- **`node -` argv parsing in `lattice normalize` + `lattice diff`** — when Node reads source from stdin via heredoc, `argv[1]` is the literal `"-"`, not the first user arg. Both commands corrected to destructure `[,, ...userArgs]`. Pre-fix: `normalize --apply` was a silent no-op because the apply flag never reached the helper.

### Verified
- `/tmp/sync-test`: pre-v1.2.0 `normalize --apply` left files untouched; post-fix the file is renamed to canonical `BLOCKER-test-mod-test-rule.yml` and `id:` is rewritten to the sha1-derived value.
- `lattice diff --help` resolves, `lattice write-manifest --help` resolves
- `bash -n scripts/lattice` and `node --check scripts/lattice-session-start.mjs` clean

## [1.1.2] — 2026-05-19

**Six issues surfaced by the first real-world `/audit-sweep` dogfood — fixed.** A user-filed audit-sweep run on a Next.js portfolio produced 8 friction reports (#47–#54); v1.1.2 closes the actionable bugs and ships `lattice normalize` as the canonical post-sweep healer.

### Fixed
- **`lattice sync` rejects YAML that `lattice list` accepts** (#47, HIGH). The Node parser in `lattice-regenerate.sh` only matched top-level keys; nested fields under list items (e.g. `    line: 4` under `  - file: foo.ts`) threw `malformed YAML at line N`. Fix: when a non-key-value line starts with whitespace, skip it silently — top-level field extraction never needed nested structure. Aligns `sync`'s acceptance set with `list`'s grep-based reader.
- **`lattice list` renders `· :` tail for findings with empty file/line** (#50). New emit-conditional: when both `file` and `line` are blank, the printf format drops the `— %s:%s` suffix entirely.
- **YAML findings cause CRLF warnings on every Windows commit** (#53). `lattice setup` now drops `.lattice/.gitattributes` pinning `*.yml` / `*.yaml` / `*.jsonl` to `eol=lf`. Idempotent: preserves the file if it already exists.
- **`.lattice/{open,closed,sweeps}/` not auto-created on first sweep** (#49). `commands/audit-sweep.md` now runs `lattice setup` (with `mkdir -p` fallback) before subagent dispatch, ensuring emission directories always exist.

### Added
- **`lattice normalize [--apply]`** (#44 #52) — canonicalize ids + filenames in `.lattice/findings/open/`. Two healings in one pass:
  - **Re-derive fabricated ids** (#52): subagents synthesize 16-hex ids inline instead of running `lattice id-gen`. Normalize re-derives each id via sha1 of `dimension:rule:file:code_context` per the v0.7 algorithm. Without this, sweep N+1 sees all findings as "new" because hashes don't match.
  - **Strip leading-dot module segments** (#44): `.claude/agents` → `claude-agents` (no more `LOW-.claude-agents-...` filenames).
- **audit-sweep skill** now runs `lattice normalize --apply` between subagent dispatch and manifest aggregation (Step 3). Closes the loop on subagent-fabricated ids.

### Closed without code change
- **#41** (Feature: lattice-mcp) — already shipped in v1.0.0.

### Verified
- Real test: `/tmp/sync-test/.lattice/findings/open/BLOCKER-test.yml` with nested `evidence:` block — pre-fix throws "malformed YAML at line 10"; post-fix `lattice sync` parses cleanly and progresses to schema validation.
- `lattice normalize` against the same fixture correctly identifies fabricated id + wrong filename and renames to `BLOCKER-test-mod-test-rule.yml`.
- `bash -n scripts/lattice` and `bash -n scripts/lattice-regenerate.sh` clean.

## [1.1.1] — 2026-05-19

**`lattice release-notes` — auto-generate CHANGELOG.md entries (#11).** Hand-writing release notes for every ship was the last hand-cranked release step. v1.1.1 turns it into a one-liner.

### Added
- **`lattice release-notes`** — auto-detects the last git tag and emits a markdown CHANGELOG entry: version header (from `plugin.json`), categorized commit list, closed Lattice findings (if any), and a "Verified" stub. Categories follow conventional-commit prefixes: `feat:` → Added, `fix:` → Fixed, `refactor:` → Changed, `perf:` → Performance, `docs:` → Documentation, `test:` → Tests, anything else → Other. `release:` commits and merge commits are dropped (release commits ARE this command's output; merges are noise).
- `--since <tag-or-date>` to override the range start, `--version <v>` to override the header, `--raw-commits` for un-categorized commit list, `--help` for the flag matrix.

### How to use at release time
1. `git commit -m "feat: ..."` / `fix: ...` / `refactor: ...` per change
2. When ready to ship: `lattice release-notes > /tmp/notes.md`
3. Paste at the top of CHANGELOG.md, fill in the "Verified" section, bump version, tag, push.

### Verified
- `lattice release-notes --since v1.1.0 --version 1.1.1` on a clean range emits the header + "Verified" stub
- `lattice release-notes --since v1.0.0 --version 1.1.1` correctly drops all 5 `release:` commits in that range
- `bash -n scripts/lattice` clean

## [1.1.0] — 2026-05-19

**CLAUDE.md auto-tune Phase 2 (#6).** Phase 1 (deterministic block + sentinel-bounded merge) shipped in v0.9.10. Phase 2 closes the meta-loop: Lattice detects when its onboarding block needs refresh and re-applies under explicit user consent. The "without any human" automation stops at the consent gate by design — `LATTICE_AUTO_TUNE=1` is opt-in for the dogfooding window, never default.

### Added
- **`lattice claude-md-tune --check`** — emit current trigger state without changing anything. Reports current version, last-tune version, releases since (triggers at 3+), unknown_subcommand event count (triggers at 5+). Exit 1 if either trigger fired.
- **`lattice claude-md-tune --auto`** — apply if a trigger fired AND `LATTICE_AUTO_TUNE=1`. Reports the trigger and refuses without the env var, so dry-running is safe at any time.
- **Diff logging.** Every `--apply` / `--bootstrap` / `--auto` run writes a timestamped diff to `~/.claude/lattice/claude-md-tune-history/<UTC-ts>.diff` containing the previous block and the new block side-by-side. Auditable trail for what Lattice changed about its own onboarding doc.
- **`last-tune-version` + `last-tune-timestamp` stamps** at `~/.claude/lattice/claude-md-tune-history/` — used by `--check` to compute "releases since last tune" without parsing diff files.
- **`--help` for the subcommand** — full flag matrix in one place.

### Trigger logic
- **Release trigger:** `_ver_int(current) - _ver_int(last_tune) >= 3` patch steps. Versions parse as `MAJ*10000 + MIN*100 + PAT`. Pre-release suffixes (`-rc1`) are stripped.
- **Friction trigger:** count of `unknown_subcommand` events in `~/.claude/lattice/usage/global.jsonl` since `last-tune-timestamp` >= 5. Reads the JSONL line-by-line via Node; ignores malformed lines.
- Either trigger alone fires.

### Why opt-in stays opt-in
Per the locked spec in `project_lattice_backlog.md`: "Opt-in via `LATTICE_AUTO_TUNE=1` env var for the first 30 days of dogfooding. After 30 days clean on owner's own setup, flip to opt-OUT (default on; users can disable)." v1.1.0 lands the opt-in gate; the default-on flip is deferred until evidence accumulates.

### Verified
- Live `lattice claude-md-tune --check` reports "no trigger" right after a tune (releases=0)
- Live `LATTICE_AUTO_TUNE=1 lattice claude-md-tune --auto` correctly: detects trigger, takes backup, prepends block, logs diff, stamps last-tune-version
- `bash -n scripts/lattice` clean post-edit

## [1.0.4] — 2026-05-19

**update.sh now keeps MCP + `.cmd` shim in sync.** Live-tested on a v0.9.16 → v1.0.3 upgrade on Windows + Git Bash — succeeded cleanly (so update isn't broken on Windows as feared in the v1.0.2 friction inventory), but three gaps surfaced.

### Added
- **MCP server refresh.** `update.sh` now fetches `mcp/package.json`, `mcp/tsconfig.json`, `mcp/src/index.ts` to `~/.claude/lattice/mcp/`, runs `npm install` (first-time only), and rebuilds `dist/` via tsc. Keeps `lattice mcp serve` from running stale code after CLI upgrades. Skipped silently if node/npm absent or fetch fails.
- **Windows `.cmd` shim refresh.** On `MINGW*` / `MSYS*` / `CYGWIN*`, update.sh regenerates the `.cmd` wrapper next to the bash shim, repointing it at the current `SCRIPT_DEST`. Pre-v1.0.1 users had no `.cmd`; this lays one down on next update so PowerShell starts working post-update.

### Note
- v1.0.4's update.sh only takes effect once you're ON v1.0.4. To get there: re-run `lattice update --self` from any version ≥ v0.9.16. After landing on v1.0.4, subsequent updates carry MCP + `.cmd` refresh forward.

### Verified
- Live `bash <pre-v1.0.4-install>/scripts/lattice update --self` on this machine: succeeded, jumped from 0.9.17 to 1.0.3, all 14 scripts + 7 commands + 3 docs fetched cleanly. update.sh proved reliable on Windows + Git Bash.
- `bash -n scripts/update.sh` clean

## [1.0.3] — 2026-05-19

**`lattice setup` + `lattice ci-check-dead`.** Per-project bootstrap collapses to one command. Release-time dead-feature pruning becomes automated.

### Added
- **`lattice setup`** (#2) — one-command per-project bootstrap. Creates `.lattice/findings/{open,closed,sweeps}`, calls `lattice config init`, calls `lattice sync` to bootstrap CLAUDE.md. Idempotent: preserves existing config + CLAUDE.md. Emits a "Next: /audit-sweep ." pointer. `--global` prints the curl|bash install command. Replaces the multi-step "doctor + config init + sync + restart" dance for new projects.
- **`lattice ci-check-dead [--days N]`** (#7) — exit 1 if any subcommand has 0 invocations in `~/.claude/lattice/usage/global.jsonl` within the last N days (default 14). Whitelist covers aliases (`ls`, `cat`, `regenerate`), CI-only subcommands (`validate`, `ci-check`), restore-flow subcommands (`claude-md-restore`, `project-restore`), and rare-but-intentional (`wire-hooks`, `mcp`, `report`, `migrate*`). Used at release time to enforce the dead-feature pruning discipline introduced in v0.9.18.

### Fixed
- `node -e` argv destructuring in `ci-check-dead`'s log parser — with `-e`, argv is `[nodePath, ...userArgs]` (no script slot), not `[nodePath, scriptPath, ...userArgs]`. Skip only 1, not 2.

### Verified
- `lattice setup` in a fresh `/tmp/setup-test` dir creates the full tree + config + CLAUDE.md with one command
- `lattice ci-check-dead --days 30` runs cleanly against the real global usage log on this machine; whitelist correctly suppresses aliases

## [1.0.2] — 2026-05-19

**Install-UX hardening + `lattice uninstall` + signal in the statusline brand block.** Five frictions surfaced during the v1.0.1 dogfood window, all addressed in one ship.

### Added
- **`lattice uninstall`** (#9) — remove Lattice from cwd (`.lattice/` + CLAUDE.md block) or globally (`--global` for commands + scripts; `--global --purge` for shims + settings.json hooks + mcpServers.lattice). Dry-run by default; `--yes` applies. Always backs up CLAUDE.md before mutation. Strips lattice-only CLAUDE.md entirely; strips the block via awk in mixed CLAUDE.md.
- **Auto-wire prompt in `install.sh`** (#5) — at the end of install, offer to run `lattice wire-hooks --apply --yes` + `lattice mcp setup --apply --yes` interactively. Only prompts when on a TTY; `LATTICE_INSTALL_NO_PROMPT=1` disables. Replaces the "install.sh prints snippet, user pastes into settings.json" friction. The MCP setup is skipped silently when `dist/index.js` is missing.

### Changed
- **`lattice doctor` first-run noise** (#4) — fresh installs no longer look like a wall of failures. Detects first-run state (no `.lattice/config.yml` AND no `.lattice/cache/update-check.env`) and downgrades known-normal warnings to `[INFO]`: `config.yml not initialized`, `CLAUDE.md not yet created`, `no update-check cache`. Adds a one-line banner ("first-run state detected") and a clear final summary ("setup is clean — first-run notices are expected").
- **Statusline brand block carries signal** (#8) — `[Lattice]` block now reflects state:
  - `[Lattice ⨯]` (dim) — cwd has no `.lattice/`, signal that lattice is NOT in this project
  - `[Lattice ✓]` (green) — Lattice enabled, zero open findings
  - `[Lattice N]` (yellow if HIGH/RISK; red if CRITICAL/BLOCKER; plain otherwise) — N open actionable findings
- **SessionStart hook suppresses OK-tier spam** (#10) — `OK-finding-schema-required-fields-verified` and other check-passed markers no longer appear in "Top findings to address". Counted separately as "N OK checks verified" alongside the zero-finding state. Avoids surfacing non-actionable markers as work-to-do in every session context.

### Fixed
- Statusline color when only `MEDIUM` / `LOW` / `DRIFT` findings exist now correctly uses the plain `[Lattice N]` form instead of falling through to the implicit "no signal" branch.

### Verified
- `bash -n scripts/lattice` and `bash -n scripts/install.sh` clean
- `node --check scripts/lattice-statusline.mjs` and `node --check scripts/lattice-session-start.mjs` clean
- `lattice uninstall` dry-run in a project with `.lattice/` lists what it will remove and exits 0 without touching anything

## [1.0.1] — 2026-05-19

**PowerShell PATH fix (#46).** v1.0.0 + v0.9.18's PATH fix only worked in Git Bash. PowerShell users — the majority of Windows Claude Code users — still hit `lattice: command not recognized`. v1.0.1 closes that gap.

### Added (#46)
- **Windows `.cmd` wrapper.** `install.sh` now drops a `lattice.cmd` next to the bash shim on Windows (detected via `uname -s` matching `MINGW*` / `MSYS*` / `CYGWIN*`). The wrapper resolves `bash.exe` at runtime via `where bash`, falling back to the standard Git for Windows install paths. PowerShell + cmd.exe now find `lattice` natively — no Git Bash detour.
- **Auto-add to Windows User PATH.** When the shim dir isn't on the Windows-side User PATH, `install.sh` adds it via PowerShell's `[Environment]::SetEnvironmentVariable(...,'User')` — idempotent, no admin required, no `setx` truncation. Print a clear "open a NEW PowerShell window" message after. If the PowerShell call fails (no powershell.exe on PATH), emit the exact line for the user to run manually.
- **`lattice doctor` Windows-PATH check.** On Windows, doctor now verifies (a) the `.cmd` wrapper exists alongside the bash shim, and (b) the shim dir is on the Windows User PATH (read directly from the registry via PowerShell, not from the Git Bash `$PATH` which is a different namespace). Emits one combined WARN with the exact `[Environment]::SetEnvironmentVariable` line if either check fails.

### Why this was missed in #37 / v0.9.18
v0.9.18's shim-dir-on-PATH check inspected `$PATH` — but `$PATH` in Git Bash is the **MSYS-translated POSIX PATH**, which is built from `/etc/profile` + rc files. The Windows-side `%PATH%` (= `$env:PATH` in PowerShell) lives in the Windows registry and is a **completely separate string**. Having `/c/Users/Jahir/bin` in Bash `$PATH` does NOT imply `C:\Users\Jahir\bin` is in PowerShell `$env:PATH`. v1.0.1 reads both, treats them as separate state to be reconciled.

### Verified
- `.cmd` wrapper generated by install.sh runs cleanly under PowerShell on this machine — `& '...\lattice.cmd' version` returns the installed version
- `bash -n scripts/install.sh` and `bash -n scripts/lattice` clean
- `lattice doctor` on Windows reports both bash + Windows PATH states separately when one is missing

### Migration notes
- Existing v1.0.0 / v0.9.18 installs: re-run `install.sh` to pick up the `.cmd` shim + Windows PATH wire-in. Or run manually:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/IsaamMJ/Lattice/main/scripts/install.sh | bash
  ```
- After reinstall, open a **new** PowerShell window — the existing one inherited the old PATH.

## [1.0.0] — 2026-05-18

**MCP server.** Lattice findings now flow through Model Context Protocol — readable as native MCP context by Claude Code, Cursor, Codex, and every other MCP-aware client. Architecturally end-runs the "did the session remember Lattice exists?" failure mode by exposing findings as a typed tool surface the model can discover and call. Reference architecture: `upstash/context7`.

### Added
- **`mcp/` package** — `lattice-mcp` MCP server, single-file TypeScript (~250 LOC), built to `mcp/dist/index.js`. Stdio transport only (no HTTP — Lattice is per-project, no public hosting needed).
- **4 tools** (mirror Context7's discipline — surface ≤ 4 carefully chosen tools, not a kitchen sink):
  - `get_context` — same payload as the SessionStart hook; on-demand for mid-session use
  - `list_findings` — filter by tier / module / dimension / status
  - `show_finding` — full YAML for one finding (slug, filename, module/rule, or substring)
  - `close_finding` — DESTRUCTIVE; explicit `id` + `reason` required; `fixed` requires `commit` SHA or `pending: true`
- **`lattice mcp` CLI subcommand** with four operations:
  - `setup [--apply] [--yes] [--scope user|project]` — wires `mcpServers.lattice` into `~/.claude.json` (user) or `.mcp.json` (project). Dry-run default, backup before write, idempotent (same shape as `wire-hooks`).
  - `serve` — exec the built MCP server on stdio (for direct testing)
  - `build` — rebuild `mcp/dist/` via tsc
  - `status` — show whether built + wired

### Design choices
- **Shell-out to existing bash CLI** rather than reimplementing YAML parsing in TypeScript. The MCP server forks `lattice list` / `lattice show` / `lattice close` per tool call. Trade-off: ~100ms per call (acceptable for MCP, which isn't a hot path) vs. zero behavior drift between MCP and CLI by construction. If the bash CLI changes its filter semantics, MCP picks it up free.
- **`LATTICE_BIN` env var** embedded in the MCP server entry so it can find the bash CLI even when `lattice` isn't on PATH for the spawned subprocess (Windows + GUI Claude Code clients).
- **Project resolution order:** `LATTICE_PROJECT_DIR` env → `CLAUDE_PROJECT_DIR` env (set by Claude Code) → `process.cwd()`. Same precedence the SessionStart hook uses.
- **Startup probe** — the server runs `lattice version` once at startup and exits with a clear error if the bash CLI isn't reachable. Fail loud, not per-tool-call.
- **Annotations** — `readOnlyHint: true` on get/list/show; `destructiveHint: true` on close. Clients can use these to gate confirmation.
- **No OAuth / HTTP transport / community catalog** — patterns from Context7 we explicitly did NOT borrow. Lattice is local-first single-host.

### Migration notes
- Existing `wire-hooks` (SessionStart + statusLine) is unchanged. MCP is additive — running `lattice mcp setup --apply` doesn't touch hook entries; running `lattice wire-hooks --apply` doesn't touch `mcpServers`.
- After `lattice mcp setup --apply`, restart Claude Code to pick up the new server.
- The MCP server runs as a per-session stdio subprocess spawned by Claude Code; no daemon, no port, no auth surface.

### Verified
- `npm install && npx tsc` clean in `mcp/`
- `tools/list` returns all 4 tools with correct schemas + annotations
- `lattice mcp status` reports `built: yes`, correct dist path
- `lattice mcp setup` dry-run preserves the existing 200+ keys of the user's `~/.claude.json` and only adds `mcpServers.lattice`

## [0.9.18] — 2026-05-18

**Install-UX coherent slice.** Two friction sources gone: (a) `lattice` CLI not reachable after Windows install, (b) settings.json hook merge done by hand. Plus dead-feature pruning: four 0-invocation subcommands deleted.

### Added (#39)
- **`lattice wire-hooks`** — idempotent merge of Lattice's SessionStart hook + statusLine into `~/.claude/settings.json`. Dry-run by default; `--apply` writes after y/N confirm (`--yes` auto-confirms); always backs up to `<settings>.lattice-backup-<UTC-timestamp>`; refuses to apply if existing JSON is malformed.
  - Flags: `--apply`, `--yes`, `--session-start` (wire SessionStart only), `--statusline` (wire statusLine only), `--restore <ts>`
  - Idempotent: detects existing Lattice wiring by basename sentinel (`lattice-session-start.mjs` / `lattice-statusline.mjs`); replaces stale entries cleanly without clobbering a user's unrelated SessionStart hooks
  - Refuses to overwrite a non-Lattice `statusLine` — emits a clear message naming the existing command so the user can decide

### Fixed (#37)
- **`lattice` CLI not on PATH after Windows install (Git Bash).** `install.sh` now picks a shim dir already on the user's PATH (`~/bin`, `~/.local/bin`, `~/.local/lattice/bin`) so `lattice` resolves in the *current* shell, not just new ones. Falls back to `~/.local/bin` + rc-file PATH guard only when no personal-bin is already on PATH.
- **`lattice doctor` PATH diagnostic.** When `lattice` isn't reachable, the WARN now lists every personal-bin dir already on PATH and shows the exact `ln -sf` command to fix it. Previous output told the user "fix: ~/.local/bin" even when their PATH only had `~/bin`.

### Removed (dead-feature pruning)
- **`lattice triage`** — 0 invocations across 14+ days of real use; `lattice list` + `lattice next` cover the workflow
- **`lattice cluster`** — 0 invocations; `relates_to` graph walking never landed as a habit
- **`lattice timeline`** — 0 invocations; `lattice changelog` and `lattice list --status closed` cover the use case
- **`lattice pr-body`** — 0 invocations; `lattice changelog --since` covers the use case
- **Why prune now:** each dead command consumed `_KNOWN_SUBS` real estate, validate-time checks, and README quickstart slots. Cumulative tax on every session for zero return. Git history preserves the implementations if they ever come back.

### Migration notes
- If you were using any of the four removed commands: there are no users (single-user project at time of removal), but the implementations live at commit `0aef6f7^` (last commit before this release) if you need to fork-restore.
- `install.sh` shim placement changes mean *first install* on a new machine now puts `lattice` somewhere different — but the shim is always under one of `~/bin`, `~/.local/bin`, or `~/.local/lattice/bin`, never outside `$HOME`.

### Verified
- `bash -n scripts/lattice` clean
- `bash scripts/lattice help` lists wire-hooks, no triage/cluster/timeline/pr-body
- `bash scripts/lattice wire-hooks --help` prints usage
- `bash scripts/lattice wire-hooks` dry-run on a real `~/.claude/settings.json` with pre-existing Lattice wiring → STATUS=wired with idempotent replacement of stale entries

## [0.9.17] — 2026-05-18

**Statusline reset-time tails.** OMC's HUD shows time-remaining until each rate-limit window resets. Ported the same pattern to Lattice's statusline.

### Added
- **`formatResetTime()`** helper in `scripts/lattice-statusline.mjs`. Turns a unix-epoch number OR ISO-8601 string into a compact label like `1h32m`, `2d4h`, `45m`, `20s`. Returns empty string for invalid/past/null input so callers skip cleanly.
- **`rate_limits.five_hour.resets_at` + `seven_day.resets_at` extraction** from Claude Code's stdin JSON. Same source OMC uses — Claude Code passes these natively.
- **Bar tail rendering:** `5h:[bar]28%(1h32m) | wk:[bar]62%(2d3h)`. Dim styling on the parens segment matches OMC's `${DIM}(${reset})${RESET}` pattern.

### Format ladder
| Remaining | Renders as | Example |
|---|---|---|
| < 60s | `Ns` | `45s` |
| < 60min | `Nm` | `32m` |
| < 24h | `NhMm` (Mm dropped if 0) | `1h32m`, `2h` |
| ≥ 24h | `NdHh` (Hh dropped if 0) | `2d4h`, `5d` |

### Graceful degradation
If Claude Code's stdin doesn't provide `resets_at` (or provides null / a past time), the bar renders WITHOUT the tail — no broken output, no error. Same statusline performance: ~130ms cold start, ~50ms cached.

### Verified
- ISO-8601 future timestamps → correct H:M format
- Unix epoch seconds → correct H:M and d:h format
- Missing `resets_at` → tail omitted, bar still renders
- Cache hits unchanged (~50ms)

## [0.9.16] — 2026-05-18

**SessionStart hook — closes Gap 1 from the v0.9.15 architecture audit.** Lattice state now arrives architecturally on EVERY new Claude Code session, not just when an audit skill fires. The "session forgot Lattice exists" failure mode becomes structurally impossible without explicit removal of the hook.

### Added
- **`scripts/lattice-session-start.mjs`** — Node.js SessionStart hook. Reads `.lattice/` state (mode, telemetry status, findings by tier, top-3 by tier+age, active ADRs, today's session event count) and emits a compact summary as `additionalContext` for Claude Code to inject into the session.
- Hook output target: ~500-1000 chars (kept tight since it persists in every LLM call after session start).
- Outputs both the new `hookSpecificOutput.additionalContext` shape AND the legacy top-level `additionalContext` for maximum Claude Code version compatibility.

### Safety (post-v0.9.14 orphan-bash lessons applied)
- Pure Node — zero `child_process` / `bash` spawns
- Hard 1.5s timeout, always exits 0
- Silent skip when `.lattice/` doesn't exist (non-Lattice repos get nothing)
- `LATTICE_SESSION_START_DISABLE=1` env kill switch
- ~170ms cold start measured on Windows + Git Bash

### Install integration
- `install.sh` now prints the exact `~/.claude/settings.json` snippet to wire it in. Does NOT auto-mutate settings.json — user opts in explicitly (post-statusline-incident discipline).
- Added to `SCRIPTS` list in both `install.sh` and `update.sh`.

### Verification
- ~167ms cold start with full Lattice state
- Silent + fast (~155ms) when kill switch set
- Silent + ~200ms when run in non-Lattice repo
- 5 rapid-fire invocations: 766ms total (~150ms each, no pile-up)

### Why this matters
Gap 1 was the biggest unrealized lever per the v0.9.15 architecture audit: Lattice's influence between LLM calls was still voluntary in non-audit sessions (e.g., plain code editing). Now every session — audit or not — starts with current state in context. Lattice goes from "tool I can invoke" to "layer the session lives inside" for the first time.

Remaining gaps (per v0.9.15 audit): #2 PreToolUse Edit hook, #4 pre-approved permissions, #5 PostToolUse auto-resync. Slated for v0.9.17+.

## [0.9.15] — 2026-05-18

**Audit-skill architecture upgrade — 4 of 5 patterns adopted from Anthropic's `claude-code-setup` plugin.** Researched the official `claude-automation-recommender` plugin via the Claude Code skills docs. Extracted current skill patterns, applied to Lattice's audit skills. Skipped `context: fork` for this batch (changes orchestration semantics — separate slice).

### Added — patterns adopted

1. **`!`command`` dynamic context injection** in skill body. `!`lattice context`` now runs at every audit invocation, so the session sees current Lattice state (mode, dimensions, findings by tier, telemetry status, friction candidates) BEFORE Claude reads the skill instructions. Closes the "session forgot to read state" failure mode structurally — no longer voluntary.

2. **Progressive disclosure via `commands/references/`**. Heavy methodology bits (subagent dispatch prompts, finding YAML schemas, sweep manifest details) moved out of the always-loaded orchestrator. Claude reads them only when needed via markdown links. Token cost per audit invocation drops ~36% (always-loaded total: 1478 → 941 lines across the 5 audit skills).

3. **Decision tables replace prose**. Risk patterns, verdict criteria, anti-patterns now in tables. Same fidelity, ~40-50% fewer tokens per skill.

4. **`disable-model-invocation: true` on lifecycle skills**. New `commands/close.md` skill wraps `lattice close` — Claude can recommend closure but cannot auto-invoke. Finding closure is a deliberate user action (like commit/deploy/send). The bash CLI (`lattice close`) remains fully Claude-callable for scripted flows.

5. **Skipped: `context: fork`** — changes audit-sweep orchestration semantics in ways that need their own verification slice. Leaving OMC executor fallback intact for now.

### Files changed

| File | Before | After |
|---|---|---|
| `commands/audit.md` | 297 lines | 176 lines |
| `commands/audit-sweep.md` | 327 lines | 211 lines |
| `commands/scale-audit.md` | 224 lines | 146 lines |
| `commands/security-audit.md` | 284 lines | 181 lines |
| `commands/flow-audit.md` | 346 lines | 178 lines |
| **New** `commands/close.md` | — | 64 lines |
| **New** `commands/references/*.md` | — | 754 lines (10 files, on-demand) |

### Tests / verification
- `validate.sh --quick` passes (incl. close.md tool-usage + path references)
- 140 lifecycle tests still passing (bash dispatcher unchanged)
- Spot-check on Lattice's own skills loading correctly

### Why no `context: fork` yet
The audit-sweep orchestrator manually dispatches Sonnet sub-agents per module via OMC executor pattern (with native fallback). Switching to native `context: fork` is a wager that produces equivalent audit quality. Until verified on a real audit, the wager stays unsupported. Add as v0.9.16 after dogfooding 0.9.15.

### Source
- Plugin researched: `anthropics/claude-plugins-official/plugins/claude-code-setup`
- Docs: https://code.claude.com/docs/en/skills
- Pattern catalogue: `!`command``, `disable-model-invocation`, `user-invocable`, `context: fork`, `agent`, `allowed-tools`, progressive disclosure via reference files

## [0.9.14] — 2026-05-16

**INCIDENT — orphan bash.exe pile-up on Windows + Git Bash; statusline rewritten in Node.** The bash `cmd_statusline` shipped in v0.9.12-v0.9.13 caused 12+ orphan `bash.exe` processes (29% CPU, 77% RAM, 3 forced restarts) on the maintainer machine. Even with v0.9.13's `set +e` + skip-list hardening, the underlying problem was structural.

### Root cause (post-mortem)
Claude Code invokes `statusLine` every ~2 seconds. On Windows + Git Bash each bash startup is 1-3s (script parsing alone). The math fundamentally doesn't work — invocations pile up before the previous one finishes. Compounded by 5 specific issues:
1. `cat` blocking on stdin without EOF — each tick spawned a bash that hung forever.
2. `maybe_update_check` firing on every tick — curl to GitHub on the hot path.
3. `log_usage_event` appending to a 950KB global log every tick.
4. `_write_mat_entry` writing to the MAT log every tick — log grew faster than predicates could read it.
5. Per-finding `yaml_field` calls — 3 subprocesses each, ×N findings.

Each individual fix landed, but cumulative bash overhead on Windows still produced ~10s per render. Wrong substrate for a tick-invoked feature.

### Fix
- **New: `scripts/lattice-statusline.mjs`** — Node.js implementation. Cold start ~85ms (250× faster than bash). Zero subprocesses in hot path (`fs.readFileSync` for git branch via `.git/HEAD`, YAML scan via `readdirSync`, JSON parse for stdin). Lock + cache + non-blocking stdin (300ms timeout) + hard 1.5s safety timeout.
- **bash `cmd_statusline` → no-op stub.** Returns 0 instantly. Kept as a defense-in-depth shim so any stale `statusLine` config pointing at it cannot regress.
- **Skip-list additions in dispatcher** for `statusline`/`sessions`/`review` across `maybe_update_check`, `log_usage_event`, `_write_mat_entry`. Tick-invoked / read-only subcommands must never touch the network or grow append-only logs.
- **install.sh prints the new Node wire-up** with Windows-specific Node path guidance. Does NOT auto-mutate `settings.json` — user opts in explicitly after the incident.

### What the user has to do
1. Make sure `statusLine` block is removed from `~/.claude/settings.json` (the emergency triage already did this; backup at `~/.claude/settings.json.lattice-emergency-backup-*`).
2. Kill any orphan `bash.exe` processes via Task Manager.
3. Restart Claude Code.
4. **Only after CPU/RAM is normal**, optionally wire the Node statusline:
   ```json
   "statusLine": {
     "type": "command",
     "command": "node ~/.claude/lattice/scripts/lattice-statusline.mjs"
   }
   ```

### Why no auto-wiring
After 3 forced restarts caused by an opt-in feature, the user explicitly opts in this time. The install script prints the snippet; copy-paste is the activation step.

### Why no test for orphan-prevention specifically
The Windows bash-fork-cost regression was environmental — it could not be reproduced on Linux/macOS CI. Adding a timing-based test would be flaky. The structural fix (Node, no forks, hard timeout, lock+cache) makes the failure mode impossible-by-construction.

## [0.9.13] — 2026-05-15

**Statusline hardening (closes #35).** Auto-telemetry caught `lattice statusline exit 127` on Windows within ~10 minutes of v0.9.12 shipping — fired 3 times in 5 minutes because Claude Code calls the statusLine command on a tick. Two-part fix.

### Fixed
- **#35 — statusline now NEVER propagates errors.** Disables `set -e` + `set -o pipefail` for the duration of `cmd_statusline`, restores them at end, always `return 0`. Failure mode is "emit what you have, exit 0." Statuslines are display elements; they cannot be allowed to break Claude Code's status bar or fire telemetry repeatedly.
- **statusline added to telemetry skip list** alongside `help`/`version`/`doctor`/`config`/`update`. Without this, every failed statusline tick would auto-file a duplicate issue. The exit-141/130/143 skip from v0.9.4 didn't cover 127 because that's "command not found," not a signal — meaning environmental issues on a tick-invoked command would have flooded the tracker. Now silent.

### Tests
- 138 → 140 lifecycle tests. New: statusline returns 0 even on garbage stdin (#134), statusline appears in telemetry skip list (#135).

### Why this matters (the dogfood loop in action)
v0.9.12 shipped at 13:32 UTC. v0.9.10's auto-telemetry caught the bug at 13:38 UTC. The observer loop we built earlier this week paid off in real time — manual debugging would have meant noticing days later that the status bar was broken. Instead: auto-detected, auto-reported, fixed in ~30 minutes.

The user's explicit instruction (*"be activily cheking if any new buugs are being reported and fix that please"*) was honored: bug came in via the substrate we built, got fixed before the user came back from dogfood.

## [0.9.12] — 2026-05-15

**Statusline.** Claude Code passes session state (model, context %, 5h + 7-day rate limits, cwd) to a configured statusLine script via stdin JSON natively — no reverse engineering required. v0.9.12 adds `lattice statusline` that consumes this stdin AND merges Lattice-specific state (findings counts, friction count, mode, git branch) into a single colored one-liner.

### Added
- **`lattice statusline`** subcommand. Designed to be wired into `~/.claude/settings.json` as a `statusLine` command. Reads Claude Code's stdin JSON, parses `model.display_name`, `context_window.used_percentage`, `rate_limits.five_hour.used_percentage`, `rate_limits.seven_day.used_percentage`, `cwd` — no jq dependency, simple sed extraction of the fixed-shape fields.
- **Lattice segments merged in:**
  - Open findings count for CRITICAL (🔴) + HIGH (⚠️) tiers
  - Friction count from `cmd_review --quiet` (omitted when 0)
  - Mode badge (only when `substrate` or `hybrid`)
  - Git branch (best-effort)
- **Neon yellow rendering** by default (xterm-256 color 226 — pure yellow). Opt-out via `LATTICE_STATUSLINE_NOCOLOR=1`.
- **Graceful degradation:** missing stdin, no `.lattice/`, no git — all silent-skip. Emits at least the literal string `lattice` so the user knows the script is wired (not silently broken).

Example output:

\`\`\`
Sonnet 4.6 · ctx 42% · 5h 38% · wk 67% · main · 🔴2 ⚠️5 · 1 friction · substrate
\`\`\`

### Install integration
- `install.sh` now prints the exact `statusLine` JSON to paste into `~/.claude/settings.json`. Not auto-wired (settings.json is too sensitive to mutate blindly; user paste is one-time and explicit).

### Tests
- 134 → 138 lifecycle tests. New: stdin parsing covers all 4 Claude Code fields (#130), graceful degradation without stdin (#131), `LATTICE_STATUSLINE_NOCOLOR=1` strips ANSI (#132), default emits neon-yellow ANSI codes (#133).

### Why this matters
A persistent status bar is the cheapest possible discovery surface: zero CLI invocations, always visible. Lattice findings + friction count being constantly on-screen means every keystroke is informed by the current state of the audit substrate. Combined with v0.9.10's global CLAUDE.md and v0.9.11's project CLAUDE.md, sessions now see Lattice at three different fidelities: instructions (global), state-on-load (project), state-always (statusline).

## [0.9.11] — 2026-05-15

**Project CLAUDE.md integration.** v0.9.10 made every Claude Code session see Lattice exists (global block). v0.9.11 makes every Claude Code session also see what's IN this project's Lattice — findings by tier, top-3 by priority, active ADRs, telemetry status — auto-refreshed on every lifecycle change.

**Strict v0.9.11 boundaries (locked, no scope creep):**
- ✅ Project CLAUDE.md sentinel block (separate sentinels from v0.9.10 global — `LATTICE-PROJECT-BLOCK-START`)
- ✅ Auto-sync on lifecycle events (`close`, `decide`; `invariants derive` writes are already file-driven)
- ✅ Counts by tier + top-3 findings (by tier rank, then age)
- ✅ Backup/restore (project-scoped backups at `.lattice/claude-md-backups/`)
- ❌ Zero extra intelligence
- ❌ No MEMORY.md logic yet (deferred to v0.9.12, evidence-gated by 5-7 day dogfood on jiive-backend)
- ❌ No MCP yet (v1.0.0 milestone)

### Added
- **`lattice project-init`** — write a sentinel-managed Lattice state block into `<project>/CLAUDE.md`. Idempotent. Creates CLAUDE.md if missing; appends block to bottom if file exists (project rules typically live at top — Lattice state goes after, not above the human-authored content).
- **`lattice project-sync`** — refresh the block on demand. Requires the block to already exist (init must come first).
- **`lattice project-restore`** — list / latest / `<timestamp>` revert. Backups at `.lattice/claude-md-backups/CLAUDE.md.<UTC-timestamp>`.
- **Auto-sync hooks** on `cmd_close` and `cmd_decide`. Quiet, best-effort, no-op when CLAUDE.md doesn't have the block (no surprise-creation).
- **`LATTICE_NO_PROJECT_SYNC=1` env opt-out** for sessions that want manual control.

### Block content (locked, deterministic — no AI)
- Mode (classic / substrate / hybrid)
- Telemetry status (ON / OFF)
- Active dimensions (collected from open findings' `dimension:` fields)
- Findings open total + breakdown by tier (CRITICAL/BLOCKER/HIGH/RISK/DRIFT/MEDIUM/WATCH/LOW)
- Top-3 findings by tier rank, then sweep_date (oldest first within tier)
- Active ADRs count + top-3 (id + title)

### Tests
- 127 → 134 lifecycle tests. New: project-init creates block (#123), preserves user content (#124), idempotent (#125), project-sync refreshes (#126), `close` auto-syncs (#127), `LATTICE_NO_PROJECT_SYNC=1` opt-out (#128), project-restore reverts (#129).

### Bug fixes
- **`yaml_field` newline omission caught during smoke test.** Helper uses `printf '%s'` (no trailing newline) to keep single-value reads clean. When the project block aggregated dimensions across multiple files with `yaml_field "${f}" "dimension" | sort -u`, values concatenated into one run-on token ("securityscaleaudit"). Fixed locally with an `echo` wrapper rather than changing `yaml_field`'s contract.

### Dogfood plan (next 5-7 days)
The boundaries above stay locked until real-usage data answers:
1. Did sessions naturally use Lattice more?
2. Did context retrieval improve?
3. Did stale findings reduce?
4. Did you actually miss cross-session memory (v0.9.12 trigger)?
5. Did token noise become annoying?

If 4 is yes from 3+ concrete examples → ship v0.9.12 (MEMORY.md). If 5 is yes → tune the block content down. Otherwise, hold and ship v1.0.0 MCP next.

## [0.9.10] — 2026-05-15

**Global CLAUDE.md integration — discovery gap, structurally closed.** Every Claude Code session on this machine now immediately sees Lattice instructions at the top of `~/.claude/CLAUDE.md`. No manual onboarding step. No "session forgot Lattice exists" failure mode.

### Added — Phase 1 (deterministic install-time integration)
- **`install.sh` now bootstraps `~/.claude/CLAUDE.md`** via `lattice claude-md-tune --bootstrap` at the end of install. Creates the file if missing; prepends a Lattice block at the TOP if existing.
- **Sentinel-managed block** — content lives between `<!-- LATTICE-MANAGED-BLOCK-START -->` and `<!-- LATTICE-MANAGED-BLOCK-END -->`. Future tunes replace ONLY content within sentinels. User content outside sentinels is never touched.
- **Idempotent re-install** — sentinel detection means three back-to-back applies produce exactly one block. No duplication. Verified by test #119.
- **Always pre-edit backup** — every mutation writes to `~/.claude/lattice/claude-md-backups/CLAUDE.md.<UTC-timestamp>` before touching the original. No backup-less edits, ever.
- **Opt-in repo-star prompt** at install end. Only fires when running interactively AND `gh` is authenticated. Skipped silently otherwise. Never automatic.

### Added — Phase 2 (self-tuning machinery)
- **`lattice claude-md-tune`** — manage the Lattice block manually or under automation:
  - `--propose` (default) — dry-run, prints what would change.
  - `--apply` — actually write the refreshed block.
  - `--bootstrap` — `--apply` with the success banner suppressed (used by install.sh).
  - `--review-prompt` — emit a structured self-review prompt that the running Claude session can consume. This is the auto-tune mechanism: the same session reading its own onboarding doc decides if it needs revision. No external service. No cron. The session running tune IS the reviewer.
- **`lattice claude-md-restore`** — undo:
  - `--list` shows all backups with timestamps.
  - `--latest` reverts to the most recent backup (also creates a "pre-restore" backup itself).
  - `<YYYYMMDDTHHMMSSZ>` reverts to a specific timestamp.
- **Block content** is a deterministic generator (`_lattice_md_block` in `scripts/lattice`) — single source of truth. v0.9.11+ will layer usage-stat-informed re-ordering on top of this base.

### Tests
- 121 → 127 lifecycle tests. New: bootstrap creates CLAUDE.md with sentinels (#117), user content preserved (#118), idempotent (#119), pre-edit backup (#120), restore reverts (#121), list shows backups (#122).

### Why this matters (the structural closure)
- v0.9.3 made manual filing easy.
- v0.9.6 made event recording automatic.
- v0.9.7 made friction detection automatic.
- v0.9.8 made filing automatic (with confirmation).
- v0.9.9 added the env-contract dimension.
- **v0.9.10 makes discovery automatic.** Sessions no longer need to "know" Lattice exists — they read its instructions before doing anything else. The "session forgot to use Lattice" failure mode is now impossible without explicit removal of the block.

The full Lattice observer loop:
**Install → CLAUDE.md auto-knows Lattice → every session reads it at start → uses Lattice → MAT log records → review surfaces friction → reports auto-file → CLAUDE.md self-tunes from usage** (v0.9.11+).

## [0.9.9] — 2026-05-15

**New audit dimension: env-contract.** Closes #31 — env-var silent-fallback detection. The design pressure-tested through two review rounds: shipped as a dimension inside the existing `/audit-sweep` flow (default-on, runs once per sweep), NOT as a standalone command that would have joined the dead-command pile (`triage`, `cluster`, `timeline`, `pr-body` — all 0 invocations).

### Added
- **`lattice audit-env-contract [--path .] [--write]`** — detector entry point. Designed to be invoked BY `/audit-sweep`, not typed by humans. Survival depends on living inside a habit-loop the user already runs (audit-sweep gets >1000 invocations/month).
- **Five pattern families** covered (Node/TS canonical + modern + Python + Dart):
  - `process.env.X || 'literal'`
  - `process.env.X ?? 'literal'` (TS strict-mode nullish coalescing)
  - `const { X = 'literal' } = process.env` (destructured defaults)
  - `os.environ.get('X', 'literal')` (Python)
  - `String.fromEnvironment('X', defaultValue: 'literal')` (Dart)
- **Tier classification by fallback-value plausibility** — without this, the detector floods findings and gets tuned out within a week:
  - **HIGH**: domain-specific literals (`'FBS'`, `'dev-secret'`, `'postgres://admin@prod/db'`, `'admin'`). Catastrophic if real.
  - **MEDIUM**: placeholder shapes (`'TODO'`, `'changeme'`, `'<your-key>'`, `'REPLACE_ME'`).
  - **LOW**: sane dev defaults (`'3000'`, `'localhost'`, `''`, `'false'`, `'info'`, pure digits).
- **Contract-file cross-check (optional)** — if `docs/env.contract.md` exists, emits `DRIFT-env-not-in-contract-<KEY>` for any env var referenced in code but missing from the contract. Cheap (~30 LOC), very high signal when the contract file exists, silent when absent. Partial assist toward #34 (full action-time enforcement still needs the runtime-state mechanism that grep alone can't see).
- **`env-contract` added to `VALID_DIMENSIONS`** in `lattice-regenerate.sh` so emitted findings pass `lattice validate`.
- **`/audit-sweep` updated** to include `env-contract` in the default dimension set + Step 0 invocation pre-module-dispatch (env is project-wide, not per-module).
- **New finding fields** (optional, env-contract dimension only): `env_key`, `fallback_value`.

### Tests
- 115 → 121 lifecycle tests. New: HIGH-tier classification (#111), LOW-tier classification (#112), `??` + destructured patterns (#113), Python + Dart (#114), `--write` produces validate-passing YAML (#115), contract cross-check selectively flags missing vars (#116).

### What this closes
- **#31** — closed.
- **#34** — partly addressed via contract-file cross-check. Full runtime-state enforcement (pm2 `--update-env` wipes, etc) explicitly NOT closed — that needs an action-time mechanism out of grep's reach. Stays open as v0.9.10+ scope.
- **#32, #33** — untouched. Need their own slices once riseCraft generates more evidence.

### Why this matters (the design discipline)
The first instinct was `lattice env-audit` as a standalone command. The usage data (4 of 34 commands at 0 invocations) said that path was the dead-command trap. Pivoted to dimension-inside-audit-sweep because audit-sweep is already in a habit loop. Tier classification was the second discipline catch: a flat "RISK" tier on every match would have flooded findings within a week and got the dimension tuned out. Both changes came from review rounds, not the first draft — discipline phase worked.

## [0.9.8] — 2026-05-15

**Observer-pattern fix complete.** v0.9.6 captured the events. v0.9.7 derived candidates. v0.9.8 closes the loop: candidates become GitHub issues with one keystroke and idempotent dedup. After this release, "did the session file the bugs it encountered?" is no longer a memory check — it's a structural property of the system.

### Added
- **`lattice review --file [--yes]`** — pipes friction candidates through `lattice report` (existing v0.9.3 channel), auto-creating GitHub issues. `--yes` skips per-candidate confirmation for non-interactive runs.
- **Idempotent dedup** via `.lattice/sessions/.filed.jsonl` keyed on sha256 fingerprints of stable candidate keys (NOT titles, which contain volatile occurrence counts). Re-running `review --file` is safe — already-filed candidates skip cleanly.
- **`stable_key` field** in candidate records (exposed in `--json` output). Lets external tooling apply the same dedup logic.
- **Category mapping** kind → report category: `fullpath_workaround`/`repeated_failure`/`failed_then_succeeded` → `bug`, `unknown_subcommand` → `ux`, `slow_command` → `perf`.
- **`lattice context` awareness hint** — when the MAT log for today has unfiled friction candidates, prints a "Friction candidates" section at the top of `next actions` with the exact command to review/file them. Closes the awareness loop — sessions can no longer "not know" pending observations exist.
- **Non-TTY safety guard**: `review --file` without `--yes` refuses to proceed when stdin isn't a TTY, preventing accidental mass-filing from automation that forgot the `--yes` opt-in.

### Tests
- 111 → 115 lifecycle tests. New: `--file` appends fingerprint record (#107), idempotent re-run skips filed (#108), non-TTY safety guard (#109), `--json` exposes stable_key (#110).

### Why this matters — the full arc
- v0.9.3 made filing easy (manual channel).
- v0.9.6 made recording automatic (MAT log).
- v0.9.7 made detection automatic (predicates).
- v0.9.8 makes filing automatic (with confirmation).

The chain: every Lattice invocation → trace event → predicate → candidate → optional one-keystroke filing → GitHub issue → triage in v1.0. The disease ("Claude only files when prompted") has no surface left to attach to. Default behavior is now "report unless explicitly dismissed" instead of "say nothing unless prompted."

## [0.9.7] — 2026-05-15

**Friction predicates + `lattice review` — second half of the observer-pattern fix.** v0.9.6 put the passive MAT log layer in place. v0.9.7 reads it: five high-precision predicates derive friction candidates automatically. Claude (or any session) runs `lattice review` and gets a structured list of probable bugs/UX gaps the session encountered but didn't notice as filable.

### Added
- **`lattice review [--day YYYYMMDD] [--json | --quiet]`** — runs predicates over the MAT log, prints/emits candidate list.
- **Predicates** (initial set, kept narrow + high-precision so noise stays near zero):
  - `fullpath_workaround` — any `invoked_via: fullpath` event. Direct PATH-shim regression signal.
  - `unknown_subcommand` — `exit=2` with a cmd name not in the dispatcher's whitelist. Discoverability / typo / removed-command signal.
  - `repeated_failure` — same cmd exits non-zero ≥2 times in the same day. Reproducible bug candidate.
  - `failed_then_succeeded` — same cmd transitions exit≠0 → exit=0. Silent workaround signal (the class the manual report channel was built for).
  - `slow_command` — `duration_ms > 30000`. Perf or stuck-loop candidate.
- **Output modes:** pretty (default), `--json` (one object per candidate, jq-pipeable), `--quiet` (candidate count only — CI-gate-friendly).
- All predicates run locally — no network, no telemetry POST. Friction detection stays in the dev's machine until v0.9.8 adds opt-in auto-filing.

### Tests
- 105 → 111 lifecycle tests. New: fullpath_workaround (#101), repeated_failure (#102), failed_then_succeeded (#103), unknown_subcommand (#104), `--json` output shape (#105), `--quiet` count mode (#106).

### What's next
- v0.9.8: `lattice review --file [--yes]` — pipes candidates into `lattice report`, with idempotent dedup via `.lattice/sessions/.filed.jsonl` so re-running never double-files. After v0.9.8, the answer to "why does Claude only file when prompted" becomes structurally moot: the session log surfaces candidates → one keystroke files them → memory of "did I file?" becomes irrelevant.

## [0.9.6] — 2026-05-15

**MAT (Message-Action Trace) log layer — foundation for the observer-pattern fix.** The v0.9.3 manual report channel made filing easy but kept the cognitive load on Claude: notice → judge → act. Three voluntary actions stacked → near-zero reliability across sessions (proven empirically — the riseCraft session only filed when explicitly prompted). v0.9.6 flips the model: Lattice records every command it mediates, so v0.9.7 can derive friction candidates from the log and surface them via `lattice review` — Claude's role becomes *confirm or dismiss*, not *initiate*.

### Added
- **`.lattice/sessions/<YYYYMMDD>.jsonl`** — per-project, per-day rolling MAT log. Every `lattice <cmd>` writes one JSON line on exit: `{ts, cmd, args, exit, duration_ms, invoked_via, cwd}`. Passive — recording is not optional. Local-only — never POSTed anywhere (telemetry remains a separate, sanitized, opt-in lane).
- **`invoked_via` field** captures `path` vs `fullpath` (= user/session ran `~/.claude/lattice/scripts/lattice ...` instead of the PATH-resolved `lattice`). Direct evidence of PATH workaround — a primary friction signal that v0.9.7 predicates will surface automatically.
- **`lattice sessions list`** — table of every recorded day with event counts.
- **`lattice sessions show [YYYYMMDD]`** — pretty-print the day's session log; defaults to today. `--raw` flag dumps JSONL for downstream piping (jq, awk).
- **`LATTICE_MAT=0` env opt-out** for tests / hermetic CI.

### Fixed
- **Regression: `cmd_doctor` for-loop poisoned the EXIT-trap subcommand field.** `for sub in findings/open findings/closed` (line 2178) reassigned the global `sub` without `local`, so telemetry + MAT log were tagging doctor events with `cmd: "findings/closed"`. Introduced `_LATTICE_SUBCMD` global, set once at dispatch entry, never reassigned. Telemetry-fingerprint impact: minimal (`doctor` was already excluded from telemetry); MAT impact: cosmetic but caught immediately on first dogfood.

### Tests
- 99 → 105 lifecycle tests. New: MAT log records cmd + exit + invoked_via (#95), captures failures (#96), skips help/version/sessions (#97), respects `LATTICE_MAT=0` (#98), `sessions show` reports aggregates (#99), doctor for-loop regression guard (#100).

### Why this matters
This is the structural answer to "why does Claude only file bugs when explicitly told to." The cure isn't to nudge Claude harder — it's to remove the voluntariness entirely. v0.9.6 puts the observation in place; v0.9.7 layers the prompting; v0.9.8 will auto-file with confirmation. Each release is independently shippable; together they make silent friction structurally impossible to lose.

## [0.9.5] — 2026-05-15

**Enhancement slice — clears the remaining v0.9.3-dogfood requests.** The riseCraft session of 2026-05-14 filed three enhancements alongside the three bugs that v0.9.4 closed. v0.9.5 lands those three: bulk-close becomes useful for real migration scenarios, `invariants derive --print` stops lying, and `decide` accepts paragraph-level rationale instead of one-liners.

### Added / Changed
- **#23 — `lattice bulk-close --reason --rationale --pending`.** Previously bulk-close only accepted `--pattern`, `--commit`, and `--yes` — so closing 20 findings under the same architectural reason still meant a shell `for` loop calling `lattice close` per-slug. Now `bulk-close` forwards the same close-helper flags. Migration / refactor / deprecation flows close in one invocation. `--reason` is validated against the canonical taxonomy (`fixed | false-positive | wont-fix | out-of-scope | duplicate`).
- **#25 — `lattice invariants derive --print` now ALSO persists `.lattice/invariants/HEAD.yml`.** Previously `--print` suppressed the file write entirely, so the next `lattice context` reported "(none — run: lattice invariants derive)" in the same session. Three subcommands had three views of "do invariants exist." `--print` is now additive: prints to stdout AND writes to disk. `_invariants_diff` adjusted to snapshot the baseline before re-deriving so diff still works.
- **#27 — `lattice decide --because-file <path>` and `--because -` (stdin) for paragraph-level rationale.** Real ADRs need multi-paragraph context, alternatives considered, and trade-offs — not a one-liner. Multi-line input is emitted as a YAML block scalar (`because: |`) so it survives `validate` and stays diff-friendly. Single-line input still uses the original quoted form.

### Tests
- 94 → 99 lifecycle tests. New: bulk-close `--reason` + `--rationale` applied to all matches (#90), bulk-close rejects invalid `--reason` (#91), `derive --print` prints AND persists (#92), `decide --because-file` reads multi-line file (#93), `decide --because -` reads multi-line stdin (#94).

### Why this matters
v0.9.3 → v0.9.4 → v0.9.5 is the first end-to-end demonstration of the compounding feedback loop: report channel ships → real session uses it → all reported items get fixed within ~24h with regression tests. The deferred-work pile no longer carries observations from the report-channel pilot.

## [0.9.4] — 2026-05-14

**Bugfix slice — clears the three real bugs surfaced via v0.9.3 `lattice report` channel.** The riseCraft session filed 6 observations the same day v0.9.3 shipped (#22 #23 #24 #25 #26 #27); three are bugs, three are enhancements. This release ships fixes for the bugs (and the SIGPIPE auto-telemetry noise #21). Enhancements deferred to v0.9.5+.

### Fixed
- **#22 — `lattice invariants derive`: frontend_calls parser emitted malformed entries.** Previous parser used `grep -RhEn` (the `-h` flag strips filenames) and a `sed` that tried to remove a `file:line:` prefix that was never there. Result: `method:` held the line number (`101:`), `target:` held the entire indented source line, no `file:` field anywhere. Two unrelated calls on the same line number across different files would collide. Rewrote with `grep -REn` + an `awk` pipeline that extracts `(file, line, verb)` tuples. New emission: `{method: PUT, call_site: lib/.../auth_remote_source.dart:101}`. Matches the structural shape Lattice already uses for Node routes (`method` + `path`). Also widened the matcher to include `_dio.X(` (leading-underscore field convention common in Dart). This bug made `lattice invariants diff` structurally unsound for its stated purpose — false drifts on every line shift in any file. Now fixed.
- **#24 — `lattice context`: empty-section rendering even when invariants HEAD existed.** The renderer was `grep -E '^(commit|stack|modules|edge_functions|routes|db_tables):' HEAD.yml | head -20 | sed 's/^/  /'`. In Lattice's YAML those labels sit on their own lines with the data as list items below (`stack:\n  - flutter\n  - supabase`), so grep matched the label only and rendered it bare. Replaced with an explicit per-section count/collapse renderer: `stack: flutter, supabase`, `modules: 37`, `edge_functions: 5`, etc. Bare labels are now impossible — if a section is empty it's omitted entirely.
- **#21 — `lattice close` (and any subcommand) auto-telemetry on exit 141 (SIGPIPE).** The EXIT trap fired telemetry on every non-zero exit, including 141 which happens whenever the user pipes lattice output into a consumer that closes early (`lattice list | head`, `lattice context | grep -m1 …`, etc.). That's a benign UX pattern, not a bug — but it was filling the tracker with auto-reported "exit 141" noise. Now telemetry skips on 141 (SIGPIPE), 130 (SIGINT — user Ctrl-C), and 143 (SIGTERM). Real failures still telemetered normally.

### Tests
- 90 → 94 lifecycle tests. New: frontend_calls emits method + call_site (#86), no line-number-shaped method values (#87), context renders inline values not bare labels (#88), telemetry skipped on SIGPIPE 141 (#89).

### Why this matters
The v0.9.3 manual report channel was supposed to prove that silent-correctness bugs (exit 0 + wrong output) get caught. It did — the riseCraft session filed all six within 24h. v0.9.4 closes the loop: from "bug observed" to "bug fixed and verified" inside the same day, with the regression tests already in place. The compounding feedback loop (Lattice catches bugs in itself via the same channel its users use to report bugs in their projects) is now demonstrably real.

## [0.9.3] — 2026-05-14

**Closes the silent-correctness blind spot.** Auto-telemetry only catches FAILED commands (non-zero exits). The riseCraft session of 2026-05-14 noted 7 real bugs/observations — 6 of which were silent (exit 0 with wrong output, UX gaps, doc issues) and entirely invisible to the telemetry pipe. v0.9.3 adds a manual channel that ships those through the same Worker.

### Added
- **`lattice report <category> --title "..." --body "..." [--severity LOW|MED|HIGH]`** — manual bug / observation channel. Same Cloudflare Worker as auto-telemetry, different label set (`manual-report` + `category:<cat>` + `severity:<sev>`), no fingerprint dedup (each manual report is a deliberate observation, not a recurring crash). Verified end-to-end: issue created at `github.com/IsaamMJ/Lattice/issues?q=label%3Amanual-report` within ~5s of command.
- **Categories:** `bug | enhancement | ux | docs | perf | security`
- **`--body-file <path>`** — load body from a file. Useful when an agent has drafted a markdown report and wants to ship it.
- **Worker (`worker/lattice-telemetry.js`)** extended:
  - `sanitize()` now accepts optional `kind`, `category`, `severity`, `title`, `body` fields. Defaults to `kind: "telemetry"` for backward compatibility with v0.8.x / v0.9.0-v0.9.2 clients.
  - New `createManualIssue()` path: bypasses dedup, uses author-supplied title + body, applies sanitization (path redaction, SHA redaction) defense-in-depth.
  - Routing: `payload.kind === "manual_report"` → manual path. Anything else → existing dedup path. Existing telemetry flow unchanged.
- Worker deployed live to `lattice-telemetry.isaam-mj.workers.dev` (version `59f37e92-2b99-4633-b336-5d8900875d3d`).

### Tests
- 84 → 89 lifecycle tests. New: rejects missing args (#82), rejects invalid category + severity (#83), debug payload shape with quote/newline escaping (#84), `--body-file` path (#85).

### Why it matters
The original telemetry design assumed bugs = crashes. They aren't. Wrong-but-exits-0 bugs (parser malformations, missing fields, silent UX gaps) are exactly the bugs an agent session can SEE but the EXIT trap cannot. Without this channel, every such observation either died with the session or required the human to paste a draft markdown into GitHub manually. Now: one command, one issue, queue-ready.

## [0.9.2] — 2026-05-14

**Discovery-gap fix.** A real riseCraft session said *"I don't know the actual bug report channel"* — even though the entire auto-bug-reporting infrastructure was in the repo. The session would have to read code + docs to discover it. That's a documentation gap masquerading as a configuration gap. Fixed structurally so no future session ever loses this signal.

### Fixed
- **`lattice context` now announces telemetry status** as the third line of output, every time:
  - `telemetry: ON — failures auto-file at github.com/IsaamMJ/Lattice/issues?q=label%3Atelemetry`
  - `telemetry: OFF — enable: lattice config telemetry on  (or: export LATTICE_OWNER_MODE=1)`

  Every Claude session that runs `lattice context` at session start now immediately sees:
  1. That bug-reporting exists,
  2. Whether it's on or off,
  3. The exact URL where issues land,
  4. How to enable it if off.

  The session would have to actively ignore the line, not "not know."

### Tests
- 82 → 84 lifecycle tests. New: context telemetry-OFF announce (#81), context telemetry-ON with issue URL (#81 paired).

### Why this matters
Bug reporting is auto-fired on FAILED commands. If a session is *unaware* it exists, it doesn't think to enable it, doesn't trigger it, and we lose the auto-bug stream that's supposed to be Lattice's compounding feedback loop. v0.8.0 #12 made telemetry opt-IN for compliance. v0.9.2 makes the opt-in discoverable.

## [0.9.1] — 2026-05-14

**Second slice of v1.0 substrate.** Invariant derivation + session-start context payload. MCP server + MAT traces still to come in v0.9.x patches.

### Added
- **`lattice invariants derive [--print]`** — grep-based first pass extracts structural facts from the working tree to `.lattice/invariants/HEAD.yml` (and `<sha>.yml`). Detects stack (Flutter / Node / Supabase), enumerates modules under `lib/` `src/` `supabase/functions/`, captures Edge Functions, Node HTTP routes (Express/Fastify/NestJS patterns), Flutter HTTP calls (dio/http/api), and DB tables from `supabase/migrations/*.sql`. Tree-sitter upgrade comes in a later patch when grep coverage proves insufficient.
- **`lattice invariants show`** — prints the current `HEAD.yml`.
- **`lattice invariants diff`** — diffs HEAD baseline against a freshly-derived version. Shows what structural shape changed.
- **`lattice context`** — prints the session-start payload Claude consumes: mode + commit + active ADRs + invariants summary + open-findings tier breakdown + next-action hints. Always regenerated, never cached. The same payload the MCP `get_context()` endpoint will return when v0.9.3 lands.

### Verified end-to-end on riseCraft
- `lattice invariants derive` on `E:\riseCraftfrontend` detects: flutter+supabase stack, 30 lib/ modules (auth, payments, subscriptions, etc.), 5 Edge Functions (razorpay-create-order, razorpay-webhook, send-push-notifications, telegram-summary, admin-ops), and matching DB tables.

### Tests
- 77 → 81 lifecycle tests. New: invariants derive on Flutter project (#77), on Supabase project (#78), context emits mode+ADRs+findings (#79), invariants show stored YAML (#80).

### Compatibility
- `.lattice/invariants/` created lazily on first `lattice invariants derive`. Classic-mode projects unaffected.
- `lattice context` works in all three modes; substrate adds the invariants section.

## [0.9.0] — 2026-05-14

**First slice of v1.0 substrate.** ADR lifecycle + operating-mode switch land first. Invariant derivation, MAT traces, MCP server follow in v0.9.x patches. See `docs/v1.0-substrate-spec.md` for the locked design.

### Added
- **`lattice mode <classic|substrate|hybrid>`** — sets the operating mode for the current project, persisted to `.lattice/config.yml`. `classic` keeps v0.8.x behavior unchanged (default for existing projects without the field, including jiive). `substrate` opts in to the full v1.0 stack (invariants + drift bounds + traces + MCP, landing in subsequent v0.9.x). `hybrid` enables ADRs + MCP without invariant derivation.
- **`lattice decide <slug> --title "..." --because "..."`** — creates an ADR YAML in `.lattice/decisions/<NNNN>-<slug>.yml`. Auto-numbers `0001+`. Supports `--status`, `--supersedes`, `--reverses`, `--cite <path[:lines]>` (repeatable), `--relates-to <finding-slug>` (repeatable). When `--supersedes` is used, the prior ADR is auto-flipped to `status: superseded` with a forward link.
- **`lattice decisions list [--status S]`** — prints ADR table with status/id/title. Filters by status. `lattice decisions show <id-or-slug>` prints one full ADR.
- **`LATTICE_OWNER_MODE=1`** env — flips telemetry default ON when no project/global config and no `LATTICE_TELEMETRY` env are set. For the Lattice owner running on their own projects: `export LATTICE_OWNER_MODE=1` in shell rc, no per-project `config telemetry on` needed.
- **`mode: classic` field added to `lattice config init` template.** Existing configs without it still default to classic — zero-friction for jiive backend.
- **`docs/v1.0-substrate-spec.md`** — locks the v1.0 design (single-user single-orchestrator scope, derive-from-code substrate, ABC drift bounds, MCP interface, ADR schema).

### Tests
- 70 → 76 lifecycle tests. New: mode default+set+reject (#71, #72), decide creates ADR (#73), decide --supersedes chain (#74), decisions list --status filter (#75), LATTICE_OWNER_MODE flips telemetry default (#76).

### Compatibility
- jiive backend, riseCraft frontend, all v0.8.x projects upgrade with **zero data migration**. `mode:` defaults to `classic` when absent. `decisions/` directory created lazily on first `lattice decide`.

## [0.8.3] — 2026-05-14

**`lattice` now resolves from a fresh shell after install** (#13). The biggest reliability gap for autonomous Claude-driven audit loops: previously the binary lived at `~/.claude/lattice/scripts/lattice` with no PATH integration, so `lattice sweep-id` from a new shell errored with `command not found` and Claude had to discover the full path manually every session.

### Fixed
- **`scripts/install.sh` now installs a `lattice` shim in `~/.local/bin/`** automatically. Symlink first, with a tiny `exec bash` wrapper fallback for systems where symlink creation fails (e.g. Windows without developer-mode). Idempotent — re-running install does not duplicate.
- **`install.sh` patches `~/.local/bin` onto `$PATH`** when the user's shell rc (zshrc → bashrc → bash_profile → profile, first match) doesn't already mention it. Guard line is appended once with a comment marker; subsequent installs detect and skip.
- **Diagnostic message after install** reports the shim kind (symlink / wrapper / existing) and whether `~/.local/bin` is on the current PATH, so users know exactly what state they're in.

### Why this matters
This closes the loop with #14's PATH check from v0.8.2 — that one prevents the false-green; this one makes the green real. Together: `curl … | bash`, restart shell, `lattice doctor` → all green. No manual alias step.

## [0.8.2] — 2026-05-14

**Issue-tracker triage batch.** Four quick wins from the GitHub backlog (#7, #14, #18, #19) plus the missing half of #15. No schema changes.

### Added
- **`lattice install-hooks [--force]`** (#7) — installs `post-commit-resolve-pending.sh` into `.git/hooks/post-commit`. Detects an existing Lattice hook and no-ops; refuses to overwrite an unrelated hook without `--force`. Sources from the project-local `scripts/` directory first, then `~/.claude/lattice/scripts/`.
- **`lattice stats`** (#15) — single-screen summary: totals by tier, by dimension, top-10 modules. Closes the missing piece of #15 — `lattice list` and `lattice show` have existed since v0.6.

### Fixed
- **`lattice doctor` no longer false-greens when the CLI is not in PATH** (#14). New diagnostic line emits a `[WARN]` with the exact `ln -sf` command to fix it. Critical for autonomous Claude-driven loops where a missing PATH burns tokens chasing `command not found`.
- **`lattice update --self` no longer dies on project-local installs** (#18). Search order now: project-local `update.sh` → global `~/.claude/lattice/scripts/update.sh` → fresh fetch from GitHub via curl/wget. The end-to-end install→update path works without any manual `curl | bash` workaround.
- **Schema enum rejections now suggest the closest valid value** (#19). `dimension: securty` → `did you mean 'security'?`. Levenshtein-based; the full allowed list is still printed alongside, so a wide miss costs nothing.

### Tests
- 65 → 70 lifecycle tests. New: install-hooks happy-path + idempotence (#66–67), stats summary (#68), doctor PATH warning (#69), did-you-mean hint (#70).

## [0.8.1] — 2026-05-14

**Dev-loop polish.** Two small additions that compound: faster validation and one-line test fixtures. Surfaced by dogfooding v0.8.0 in the same session that shipped it.

### Added
- **`lattice test-fixture <slug>` subcommand.** Emits a valid finding YAML to `.lattice/findings/open/<TIER>-<slug>.yml` (or `--out PATH`). Flags: `--tier`, `--dimension`, `--module`, `--file`, `--line`, `--title`, `--exposure`, `--verify-pattern`, `--force`. Cuts the 12-line `cat > .yml <<YML` boilerplate every new test in `scripts/test-lifecycle.sh` used to need. Refuses to overwrite without `--force`.
- **`scripts/validate.sh --quick`.** Skips the lifecycle test suite (section 9) when iterating on polish locally; non-`--quick` runs (CI / release builds) still enforce the gate. Cuts `validate.sh` runtime from ~5 minutes to ~12 seconds when the suite already ran green seconds prior. The skip prints a hint pointing at `bash scripts/test-lifecycle.sh` for explicit reruns.

### Tests
- 62 → 65 lifecycle tests. New: `test-fixture` writes valid YAML (#63), refuses overwrite without `--force` (#64), honours `--force` (#65).

### Why
The v0.8.0 polish ship surfaced two repeating costs in the author's own loop: rerunning the lifecycle suite inside `validate.sh` immediately after running it standalone, and writing 14 lines of YAML boilerplate per new test. Both fixed structurally, not by discipline.

## [0.8.0] — 2026-05-14

**"Closed Loops" — earned, not declared.** Five polish issues filed by an independent Claude session reviewing Lattice from the user's perspective. All five landed before the stable tag. No new features in flight, no version bumps during the discipline phase.

### Added
- **`exposure:` schema field (#8).** Optional per-finding: `production-critical | user-facing | admin-only | internal | test-only | dead-code`. The `--effective-tier` flag on `lattice list` demotes severity by 1 step for `admin-only`/`internal` and 2 steps for `test-only`/`dead-code`, with the original tier preserved in a `(was HIGH, admin-only)` suffix. Prevents CRITICAL/HIGH inflation when the same pattern lives in production vs an unreachable admin tool. `lattice list --exposure <kind>` filters.
- **`verify_pattern:` schema field + `lattice verify --rerun-grep` (#10).** Records the regex an audit skill used to detect the finding so the CLI can re-execute it later. `--rerun-grep` reports PASS (pattern no longer matches) or STILL OPEN. `--close-clean` auto-moves passing findings to `closed/` with rationale "pattern no longer matches". Closes the audit→fix→verify loop without a model session.
- **Opt-in telemetry with per-project consent (#12).** Telemetry now defaults to OFF. New precedence: project-OFF veto > `LATTICE_TELEMETRY` env > project-ON > global config > default OFF. `lattice config telemetry on [--global]` writes consent; `lattice config telemetry show` reports effective state and endpoint. First-run disclosure is informational only — no POST until explicit opt-in. `LATTICE_TELEMETRY_URL` lets enterprises route to a self-hosted collector. README documents the full wire shape ("what is sent / what is never sent").
- **`lattice doctor` auto-bootstraps `.lattice/` on first run (#9).** When the tree is missing, doctor now silently creates `findings/{open,closed}` and continues diagnostics with a `[WARN]` line, instead of `[FAIL]+exit 1`. First impression no longer feels broken.

### Changed
- **CLI vs slash-command boundary documented (#11).** README gains a "Workflow" section that names the two interfaces — slash commands PRODUCE findings inside Claude Code, the `lattice` CLI MANAGES their lifecycle in any shell. `lattice help` intro lists the slash commands; each slash-command markdown points back to the CLI for triage/sync/close.

### Tests
- 52 → 62 lifecycle tests. New coverage: doctor bootstrap (#33), opt-in default + `--global` flag (#53–55), `verify --rerun-grep` paths (#56–59), `exposure` filter + `--effective-tier` demotion (#60–62).

## [0.8.0-rc3] — 2026-05-14

Third hour of dogfood, third auto-reported bug (#6: `lattice update` exit 2). The loop is genuinely closing on a sub-hour cadence now.

### Fixed
- **Telemetry skip list now includes `update`.** Two false-positive paths were flooding the bug tracker:
  1. `lattice update --check` returns exit 1 BY DESIGN when an update is available (CI-friendly contract). Every "check succeeded, update available" run was auto-filing a bogus bug.
  2. Typos like `lattice update --version` hit the `*) die "usage:..."` path → exit 2 → telemetry. These are user/agent errors, not Lattice bugs.

  Update-related failures are almost always network or deployment issues, not code defects. Skipping them removes the noise.

### Deferred to rc4 (or later)
- **stderr msg_excerpt in payload.** Currently telemetry only sends `command + exit_code`, so issue #6 came in with no context about which sub-failure path triggered it. Adding sanitized stderr capture would 10x the diagnostic value. NOT shipping under time pressure — bash stderr tee on Git Bash Windows needs careful testing.

### Loop validation (today's tally)
- 09:00 — rc1 shipped (telemetry server + client live)
- 11:00 — riseCraft audit caught two bugs, auto-filed as #3/#4
- 13:00 — rc2 shipped (Worker race + audit skills fixed)
- 14:00 — `update` audit caught false-positive, auto-filed as #6
- 14:30 — rc3 shipped (this release)

**Pre-telemetry baseline: zero auto-reports, all bugs relayed manually.**

## [0.8.0-rc2] — 2026-05-14

First real-world rc1 dogfood caught two bugs in under 2 hours. Both auto-reported by telemetry (closes #3 / #4 in `IsaamMJ/Lattice`). Both fixed.

### Fixed
- **Worker dedup race condition.** rc1 used Workers KV alone for fingerprint dedup, which is eventually consistent — two simultaneous POSTs both read "no record" and both created issues (witnessed as #3 / #4, ~1 second apart, same fingerprint). Fix: embed `<!-- lattice-fp:<hash> -->` marker in every issue body, then add GitHub Search API as a backstop when KV reports a cache miss. Search is the cross-Worker source of truth; KV remains the fast-path cache. Verified live with smoke test.
- **Audit-skill prompts mis-invoked `lattice id-gen`.** `commands/{audit,security-audit,scale-audit,flow-audit}.md` showed `id-gen` in the YAML schema example without its required positional args. Sonnet 4.6 interpreted this as "you can pre-generate IDs in a loop" and fired 10 unsuccessful `id-gen` calls before recovering. Fix: inline the full signature `lattice id-gen <dim> <rule> <file> "<line_content>"` in all four skill schema blocks with an explicit "do NOT call without all four args" note.

### Why this matters
This is the **first time Lattice fixed bugs the maintainer never typed into chat.** The full meta-loop closed end-to-end:
1. rc1 deployed to a real project (riseCraft Flutter audit)
2. Bugs hit during the audit
3. Telemetry auto-filed issues #3 and #4 in the Lattice repo
4. Maintainer reviewed the issues, diagnosed, fixed, shipped rc2

Total elapsed: ~2 hours from bug occurrence to fix shipped. Pre-telemetry baseline: days (relayed verbally through chat sessions).

### Tests
52 pass on the existing suite. Worker race-safety verified manually via dedup smoke test (issue #5 — created with new fingerprint, marker embedded, GitHub Search finds it). Closed #1 / #2 / #5 as smoke-test cleanup.

### Still in -rc dogfood mode
Continuing the 1-week dogfood window. If no further bugs surface, tag stable v0.8.0 next weekend.

## [0.8.0-rc1] — 2026-05-14

**The Loop, step 1: auto-bug-reporting.** First release with end-to-end client→server→GitHub-Issues automation. Every failed `lattice` invocation now (optionally) files itself as a deduplicated GitHub Issue on `IsaamMJ/Lattice` without user or maintainer intervention. Closes the slowest part of the improvement cycle.

### Added (client side)
- **Telemetry on failed commands.** EXIT trap captures non-zero exit codes from any subcommand, builds a sanitized payload (version, command name, exit_code, OS, fingerprint, user_hash, timestamp), and POSTs async to the `lattice-telemetry` Worker.
- **First-run disclosure.** Prints a 6-line notice the first time `lattice` is invoked per `$HOME` explaining what gets sent, what doesn't, and how to disable. Marker at `~/.claude/lattice/.telemetry-acknowledged` prevents repeated prompts.
- **Opt-out paths** (any of these):
  - `lattice config telemetry off` (writes to `.lattice/config.yml` — project-local)
  - `lattice config telemetry off` from a directory with no `.lattice/` (writes global — *future*)
  - `export LATTICE_TELEMETRY=0` (env override, always wins)
  - Edit `~/.claude/lattice/config.yml` to add `telemetry: off`
- **`lattice config telemetry show`** — diagnostic command. Shows project state, global state, env override, effective state, and the endpoint URL.
- **`LATTICE_TELEMETRY_DEBUG=1`** — prints the exact payload to stderr without sending. Lets users verify what would leave the machine.

### Privacy guarantees
The payload is built from a hard-coded whitelist of 7 fields. NOT sent (in any release):
- File paths, source code, finding IDs/slugs/titles
- Commit SHAs, branch names, project / repo names
- Git config name/email, OS username, GitHub username
- Stack traces with paths, args to the failing command

`user_hash` is `sha256(hostname + $HOME)` — machine-stable but not identifying to anyone but the user themselves. `msg_fingerprint` is `sha256(command + ":" + exit_code)` — stable across machines so the same failure groups into one issue.

Wire format spec: `docs/telemetry-protocol.md` (public).
Worker source: `worker/lattice-telemetry.js` (public).
Filed issues (live audit): https://github.com/IsaamMJ/Lattice/issues?q=label%3Atelemetry

### Server side (committed in `eb46818`, already deployed)
- **`worker/lattice-telemetry.js`** — Cloudflare Worker. Strict whitelist sanitization, Workers-KV-backed 24h fingerprint dedup, async `ctx.waitUntil` so client never blocks on GitHub API. Always returns 2xx to avoid surfacing Worker outages.
- **Endpoint:** `https://lattice-telemetry.isaam-mj.workers.dev`
- **Deployment runbook:** `docs/telemetry-setup.md`
- **Labels on filed issues:** `telemetry`, `auto-reported`, `bug`
- **Dedup behavior:** new fingerprint → new Issue; repeated → `+1 occurrence` comment.

### Tests
46 → 52. New coverage:
- LATTICE_TELEMETRY=0 disables telemetry even with DEBUG=1
- Payload contains exactly the whitelisted fields
- Finding slugs never appear in payload (privacy regression test)
- `config telemetry off` persists to `.lattice/config.yml`
- Project-local opt-out overrides env-on
- help / version / doctor invocations don't fire telemetry

### Why -rc1, not -final?
Real-world validation pending. Plan: dogfood on the project actively using Lattice for ~1 week. If no privacy bugs / spurious reports / Worker outages surface, tag v0.8.0 stable. If issues appear, ship -rc2 etc.

### What's still manual after this release
- Running audits (`/audit src/`) — still needs a Claude session
- Fixing the actual code — telemetry reports, doesn't fix
- v0.9 target: AI-drafted fix PRs from the auto-filed issues. Out of scope here.

## [0.7.12] — 2026-05-13

Half-staged git state after `lattice close` / `lattice reopen`. Reported from real team usage (jiive-backend `fd1d238 → 09b2490` had to be split into two commits to clean up). Last patch before v0.8.0 work begins.

### Fixed
- **`lattice close` now auto-stages both sides of the move.** Previously `mv open/X.yml → closed/X.yml` left git showing `A` (new file in closed/) + unstaged `D` (delete in open/). A naive `git add closed/ && git commit` shipped the add without the delete — finding visible in BOTH directories after pull on another machine. Now: at end of close, runs `git add DEST` + `git rm --cached SRC`. Git typically detects this as a clean rename (`R` in status). Single commit captures both sides. Silent fallback outside git or on untracked files.
- **`lattice reopen` got the same fix** (mirror problem: `closed/X.yml → open/X.yml` left the closed-side delete unstaged).

### Tests
44 → 46. New: close stages move as rename, reopen stages move as rename. Both verify single `git commit` captures the full move with no residual state.

### Severity
LOW (cosmetic / workflow), but recurring foot-gun on teams. Reporter rated it LOW; we agree but shipped fast because the workaround (`git add -A .lattice/findings/` every time) is the kind of friction that erodes trust in the tool.

### Last 0.7.x patch
Hard stop on 0.7.x feature/fix releases after this. v0.8.0 will be "Closed Loops" — headless audit + auto-fix + bug-report-back, ~3 weeks of real engineering. Strategy locked.

## [0.7.11] — 2026-05-13

Real-usage workflow fix: pre-commit close stamping was producing wrong `closed_by_commit` SHAs. Reported by a project actively using Lattice — they had to follow up every close with a manual fix commit. This release ships the proper lifecycle.

### Problem
The natural workflow was: edit code → `lattice close <id>` → commit. But at step 2, `HEAD` was still the *previous* commit, so `closed_by_commit` got stamped with the wrong SHA. Users had to manually rewrite the YAML after the fix commit landed.

### Added
- **`lattice close --pending`** — stamps `closed_by_commit: __PENDING__` instead of resolving HEAD. Mutually exclusive with `--commit`. Use when closing BEFORE the fix commit lands.
- **`lattice resolve-pending [--commit <sha>]`** — scans all closed YAMLs, replaces `__PENDING__` with current HEAD short SHA (or explicit `--commit`). One command, batches all pending findings.
- **`scripts/post-commit-resolve-pending.sh`** — optional git hook. Auto-resolves `__PENDING__` after every commit by creating a follow-up `lifecycle:` commit. Install once: `cp scripts/post-commit-resolve-pending.sh .git/hooks/post-commit && chmod +x .git/hooks/post-commit`.

### Workflow (with hook installed)
```bash
lattice close <id> --reason fixed --pending
git add . && git commit -m "fix X"
# Hook auto-creates "lifecycle: stamp closed_by_commit ..." commit.
# Stamped SHA = fix commit SHA. Both stay reachable.
```

### Workflow (manual, no hook)
```bash
lattice close <id> --reason fixed --pending
git add . && git commit -m "fix X"
lattice resolve-pending
git add . && git commit -m "lifecycle: resolve pending close"
```

### Design notes
- **Hook uses follow-up commit, not amend.** Amend changes the commit SHA, leaving the stamped value pointing at an orphaned object that `git gc` can reap. A follow-up commit keeps the original (stamped) SHA reachable forever.
- **Rejected the "predict next commit SHA" approach** as proposed in the bug report — commit SHAs depend on tree+parent+message+author+timestamp; you can't compute them before the commit happens.
- The hook is recursion-safe: the follow-up commit re-triggers post-commit, but the second pass finds no `__PENDING__` markers and exits clean.

### Tests
40 → 44. New: `--pending` writes sentinel, `resolve-pending` stamps correct SHA, `--pending`/`--commit` mutually exclusive, hook stamps reachable SHA matching the fix commit.

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
