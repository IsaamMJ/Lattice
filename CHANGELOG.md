# Changelog

All notable changes to Lattice are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

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
