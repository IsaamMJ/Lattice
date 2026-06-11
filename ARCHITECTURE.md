# Lattice — Architecture (v2.2.1)

> Snapshot of the **current, shipped** architecture. Not a roadmap; not historical
> design intent. Generated 2026-05-21 from the live tree at `E:/Lattice`.

---

## 0. One-line definition

Lattice is a **finding-lifecycle substrate** layered on top of Claude Code. Slash
commands (running inside Claude Code) **produce** audit findings; a bash CLI
(`lattice`) **manages their lifecycle**; an MCP server, SessionStart hook, and
statusline keep that state visible to every future agent that opens the project.

Storage is plain YAML files on disk under `.lattice/`. There is no database, no
server-side state. A Cloudflare Worker is used **only** for outbound telemetry
(deduped GitHub issues for crashes / manual `lattice report` filings) and is
fully optional.

---

## 1. System diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Claude Code (host)                                                          │
│                                                                              │
│  ┌─────────────────────────┐    ┌───────────────────────────────────────┐   │
│  │ Slash commands          │    │ Hooks                                 │   │
│  │ (commands/*.md)         │    │  • SessionStart  → lattice-session-…  │   │
│  │  /audit                 │    │  • statusLine    → lattice-statusline │   │
│  │  /audit-sweep           │    │  • Stop          → lattice-stop       │   │
│  │  /security-audit        │    │  • prepare-commit-msg                 │   │
│  │  /scale-audit           │    └──────────────┬────────────────────────┘   │
│  │  /flow-audit            │                   │                            │
│  │  /lattice-fix           │                   │                            │
│  │  /close                 │                   │                            │
│  └────────────┬────────────┘                   │                            │
│               │ emit YAML                      │ inject context             │
│               ▼                                ▼                            │
│  ┌──────────────────────────────────────────────────────────┐               │
│  │ .lattice/  (per-project, checked into git)               │               │
│  │   findings/open/*.yml      ← canonical backlog           │               │
│  │   findings/closed/*.yml    ← audit trail                 │               │
│  │   findings/sweeps/*.json   ← sweep manifests             │               │
│  │   hypotheses/{open,running,closed,rolled-back}/*.yml     │               │
│  │   sessions/YYYYMMDD.jsonl  ← MAT (Message-Action Trace)  │               │
│  │   decisions/*.md           ← ADRs (substrate mode)       │               │
│  │   invariants.yml           ← derived invariants          │               │
│  │   handoff-feedback/*.json  ← Haiku auto-fix outcomes     │               │
│  │   cache/                   ← yaml-field cache, etc.      │               │
│  │   usage/                   ← per-subcommand usage stats  │               │
│  │   claude-md-backups/       ← rollback safety             │               │
│  │   config.yml               ← mode, telemetry, updates    │               │
│  └──────────────────────────────────────────────────────────┘               │
│               ▲                                ▲                            │
│               │ shell out                      │ stdio MCP                  │
│  ┌────────────┴───────────┐         ┌──────────┴────────────┐               │
│  │ scripts/lattice        │◄────────│ mcp/dist/index.js     │               │
│  │ (bash CLI, ~8.6k LOC)  │  spawn  │ (Node MCP server)     │               │
│  │ 60+ subcommands        │         │ 4 tools, thin wrapper │               │
│  └────────────┬───────────┘         └───────────────────────┘               │
│               │                                                             │
└───────────────┼─────────────────────────────────────────────────────────────┘
                │ HTTPS POST (only on failure or `lattice report`)
                ▼
   ┌────────────────────────────────────┐
   │ Cloudflare Worker                  │
   │  worker/lattice-telemetry.js       │
   │   • Sanitize whitelisted fields    │
   │   • Dedup via Workers KV (24h)     │
   │   • File / +1 GitHub Issue         │
   └────────────────┬───────────────────┘
                    ▼
           IsaamMJ/Lattice issues
           (label: telemetry / manual-report)
```

---

## 2. Repository layout

```
E:/Lattice
├── .claude-plugin/         Plugin manifest for Claude Code marketplace
│   ├── plugin.json         name=lattice, version=2.2.1, commands=./commands/
│   └── marketplace.json
├── .lattice/               This project's own findings (Lattice dogfoods itself)
├── commands/               Slash-command markdown (the "produce findings" half)
│   ├── audit.md            /audit (doc-vs-code drift, single doc)
│   ├── audit-sweep.md      /audit-sweep (multi-module, all dimensions)
│   ├── security-audit.md   /security-audit
│   ├── scale-audit.md      /scale-audit
│   ├── flow-audit.md       /flow-audit
│   ├── lattice-fix.md      /lattice-fix (Haiku auto-fix one finding)
│   ├── close.md            /close
│   └── references/         Schema/instruction snippets the skills cite
├── scripts/
│   ├── lattice             ~8,645 lines bash — the entire lifecycle CLI
│   ├── lattice-session-start.mjs   Pure-Node SessionStart hook (≤1.5s)
│   ├── lattice-statusline.mjs      Pure-Node statusline (~50-150 ms tick)
│   ├── lattice-stop.mjs            Stop hook (friction candidate harvesting)
│   ├── lattice-grow-telegram.mjs   Telegram notification for grow hypotheses
│   ├── prepare-commit-msg*.sh      Commit hooks (resolve --pending, hints)
│   ├── post-commit-resolve-pending.sh
│   ├── install.sh / update.sh / validate.sh / migrate*.sh
│   ├── lattice-close.sh, lattice-reopen.sh, lattice-regenerate.sh,
│   │   lattice-write-manifest.sh   (legacy helpers, still callable)
│   └── lattice-completion.{bash,zsh}
├── mcp/
│   ├── src/index.ts        312 lines — MCP server (4 tools, thin shell wrap)
│   ├── dist/               Compiled JS
│   └── package.json        @modelcontextprotocol/sdk + zod
├── worker/
│   ├── lattice-telemetry.js  421 lines — Cloudflare Worker (telemetry sink)
│   └── wrangler.toml
├── docs/                   Specs (finding-schema, telemetry-protocol, etc.)
├── examples/               Sample audit / contract / scale / security outputs
├── CHANGELOG.md            188 KB; release history back to v0.1
├── CLAUDE.md               Project rules + auto-synced finding checklist
└── README.md               43 KB user-facing guide
```

---

## 3. Core data model — the finding YAML

Every finding is one YAML file. The id is a 12-char sha1 fingerprint
(spec: `docs/v0.7-fingerprint-spec.md`). Filename pattern:
`<TIER>-<module>-<rule>.yml`.

### Required fields

| Field        | Type   | Notes                                                              |
| ------------ | ------ | ------------------------------------------------------------------ |
| `id`         | string | 12-char hex sha1 of `(dimension, rule, file, code_context)`        |
| `rule`       | string | Kebab-case slug (e.g. `drift-cli-flag-referenced-not-implemented`) |
| `dimension`  | enum   | `audit`, `scale`, `security`, `flow`, `env-contract`, `coverage`, `configuration`, `quality`, `product`, `infra` |
| `tier`       | enum   | `CRITICAL`, `BLOCKER`, `HIGH`, `RISK`, `MEDIUM`, `WATCH`, `LOW`, `DRIFT`, `INTENTIONAL`, `UNVERIFIABLE`, `OK` |
| `module`     | string | Logical module name (matches sweep enumeration)                    |
| `file`       | string | Repo-relative path                                                 |
| `line`       | int    | 1-indexed                                                          |
| `title`      | string | One-line headline                                                  |
| `summary`    | text   | Multi-line, evidence-grounded                                      |
| `evidence`   | list   | `file:line — quoted snippet` strings                               |
| `fix`        | text   | Concrete remediation, optionally with multiple options             |
| `sweep_date` | date   | `YYYY-MM-DD`                                                       |
| `sweep_id`   | string | Stamped by `lattice write-manifest` / sweep                        |
| `auditor`    | string | e.g. `lattice/audit-sweep@2.1.1`                                   |
| `status`     | enum   | `open`, `closed`, `deferred`, `in_progress` (`partial` normalized) |

### Lifecycle fields (added on transition)

`closed_at`, `closed_by`, `close_reason`, `close_commit`, `close_pr`,
`close_rationale`, `deferred_until`, `defer_reason`, `reopened_at`,
`reopen_reason`, `partial_progress` (list), `cluster_root`, `relates_to`.

### Status states

```
open ──┬─► closed (terminal, in findings/closed/, audit trail kept)
       ├─► deferred (with --until date, returns to open after that)
       └─► in_progress (partial close, --partial "what was done")
```

`open → closed` requires `--reason {fixed|false-positive|wont-fix|out-of-scope|duplicate}`.
`fixed` additionally requires `--commit <sha>` OR `--pending` (resolved on next
post-commit hook run via `resolve-pending`).

### Tier semantics

- **CRITICAL / BLOCKER** — must fix before next release (gated by `lattice ci-check`).
- **HIGH / RISK** — fix or formally defer.
- **MEDIUM / WATCH** — fix when convenient.
- **LOW** — cosmetic / nice-to-have.
- **DRIFT** — doc-vs-code disagreement; fix one side or the other.
- **INTENTIONAL** — audited and accepted (with rationale).
- **UNVERIFIABLE** — flagged but can't be proved.
- **OK** — acknowledgement that something was audited and is fine
  (filed under `findings/open/OK-*.yml` so the audit history is visible).

---

## 4. The `lattice` bash CLI

Single file: `scripts/lattice`, ~8,645 lines, ~70 subcommands. Strict mode
(`set -euo pipefail`). All state is files under `.lattice/` in the project's
cwd. No global mutable state; no daemon.

### Subcommand families

| Family            | Subcommands                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| Lifecycle         | `close`, `reopen`, `defer`, `sync`/`regenerate`, `validate`, `resolve-pending`, `bulk-close`, `handoff`      |
| Triage            | `list`, `show`, `next`, `verify`, `ci-check`, `ci-check-dead`                                                |
| Aggregation       | `sweeps`, `sweep-id`, `write-manifest`, `diff`, `normalize`, `export`, `changelog`, `stats`                  |
| Configuration     | `config` (telemetry on/off), `profile`, `mode` (classic/substrate/hybrid), `setup`, `doctor`, `uninstall`    |
| Substrate (v1.x+) | `decide`, `decisions`, `invariants`, `context`, `sessions`, `review`                                         |
| Grow (v2.x+)      | `grow {init,propose,list,show,run,measure,check,rollback,auto-rollback,close,attach-measurement,schedule}`   |
| Integration       | `mcp {setup,serve,build,status}`, `wire-hooks`, `install-hooks`, `statusline`, `report`, `update`            |
| Self-tuning       | `claude-md-tune`, `claude-md-restore`, `project-init`, `project-sync`, `project-restore`, `audit-env-contract`, `audit-infra`, `release-notes`, `usage`, `test-fixture`, `id-gen`, `file`, `agent` |

Authoritative list lives in `_KNOWN_SUBS` at `scripts/lattice:4169` (kept in
sync with the case dispatcher around line 7612).

### Resolution model

- Findings: every command operates on the cwd's `.lattice/findings/`.
- Helpers: looked up next to the script (`SELF_DIR`), then canonical install
  (`~/.claude/lattice/scripts/`), then fail loud. v2.1.2 (#70) hardened this.
- Version: read at runtime from `.claude-plugin/plugin.json` or
  `~/.claude/lattice/VERSION` for global installs. The script-banner version
  is informational only.

---

## 5. The slash-command layer (produce findings)

Slash commands are markdown files in `commands/` with frontmatter:

```yaml
---
description: …
argument-hint: …
allowed-tools: Read Grep Glob Bash Task
---
```

Claude Code loads them as skills. They are **prose instructions to Claude**,
not executable code. Each skill:

1. Auto-injects live state via Bash blocks at the top:
   - `!\`lattice context …\`` — current mode, ADRs, invariants, open findings
   - `!\`lattice setup …\`` — bootstraps `.lattice/` if missing
2. Tells the agent how to enumerate modules, what evidence to require, what
   YAML schema to emit, and where to write it.
3. For multi-module sweeps (`/audit-sweep`), instructs the agent to dispatch
   one subagent (`Task` tool) per module so dimensions run in parallel.

Skills do not run as a subagent themselves — they run in the main session, and
the main session orchestrates subagents.

### Skill ↔ CLI split (the canonical loop)

```
slash command (Claude)  ──►  .lattice/findings/open/*.yml
                                       │
                                       ▼
                          lattice {list,next,show,close,...}
```

The CLI never writes new findings (with the narrow exception of `test-fixture`
and `file` helpers used during development). All finding generation goes
through agent reasoning.

---

## 6. The MCP server

`mcp/src/index.ts` — 312 lines, version 1.0.0. Built on
`@modelcontextprotocol/sdk` + `zod`. Stdio transport.

**Design: thin wrapper around the bash CLI.** Every tool call shells out to
`lattice …` via `spawnSync` (no caching at the time of writing). Behavior is
guaranteed-in-sync with the CLI by construction; no YAML parsing duplicated in
the TS layer.

### Tools exposed

| Tool            | Calls                | Annotations                | Notes                                     |
| --------------- | -------------------- | -------------------------- | ----------------------------------------- |
| `get_context`   | `lattice context`    | readOnly, idempotent       | SessionStart-style summary on demand      |
| `list_findings` | `lattice list ...`   | readOnly, idempotent       | Filters: tier, module, dimension, status  |
| `show_finding`  | `lattice show <id>`  | readOnly, idempotent       | Accepts slug / path / module/rule / substring |
| `close_finding` | `lattice close ...`  | **destructive**, NOT idempotent | Requires explicit `reason`. `fixed` needs `commit` or `pending`. |

### Project resolution (in order)

1. `LATTICE_PROJECT_DIR` (explicit override)
2. `CLAUDE_PROJECT_DIR` (Claude Code injects this)
3. `process.cwd()`

### Startup probe

`runLattice(["version"])` at boot; refuses to serve if the bash CLI isn't on
PATH — fails loud once, never per-call.

### Setup

`lattice mcp setup [--apply] [--scope user|project]` merges an `mcpServers.lattice`
block into `~/.claude.json`. Dry-run by default. `lattice mcp build` recompiles
the TS. `lattice mcp serve` is the stdio entry point.

---

## 7. The hooks layer

Three Node scripts. **Pure Node, zero child processes in the hot path** — a
direct response to the v0.9.14 "orphan-bash incident" where bash-based hooks
spawned 12+ orphan processes on Windows + Git Bash.

### SessionStart (`scripts/lattice-session-start.mjs`)

- Fires once per Claude Code session.
- Hard 1.5s timeout; always exits 0.
- Silent skip when `.lattice/` is absent.
- Reads mode, telemetry status, open findings counts, top-N urgent findings,
  active ADRs, and emits the compact block Claude Code injects into context.
- Wires in via `~/.claude/settings.json` → `hooks.SessionStart`.

### statusLine (`scripts/lattice-statusline.mjs`)

- 50-150 ms per tick (vs 1-3s for the legacy bash version).
- Lock + cache prevent concurrent renders piling up (`tmpdir/lattice-statusline.<user>.{lock,cache}`).
- Reads stdin with 300ms timeout, never hangs.
- Env opt-outs: `LATTICE_STATUSLINE_DISABLE=1`, `LATTICE_STATUSLINE_NOCOLOR=1`.

### Stop / commit hooks

- `scripts/lattice-stop.mjs` — Stop hook; harvests friction candidates from
  the session's MAT log.
- `scripts/prepare-commit-msg-lattice.sh` — appends a verify-after-commit hint.
- `scripts/post-commit-resolve-pending.sh` — resolves `--pending` closes once
  the commit SHA is known.

### Wiring

`lattice wire-hooks [--apply]` merges all hooks + statusLine into
`~/.claude/settings.json`. Dry-run default, automatic backup, idempotent.
`lattice install-hooks` installs the git-level commit hooks.

---

## 8. The MAT log (passive observer)

Every `lattice <cmd>` invocation appends one JSON line to
`.lattice/sessions/<YYYYMMDD>.jsonl` in the project cwd. Per-day, per-project
rolling file. Each line captures: timestamp, subcommand, raw args, exit code,
duration.

This is the substrate for:

- `lattice usage [--since N] [--unused N]` — which subcommands are used / dead.
- `lattice review` — surfaces friction candidates from a session (workarounds,
  CLI errors, repeated retries).
- `lattice sessions` — session-level rollups.

Friction candidates can be auto-filed as GitHub issues via the Worker:
`lattice review --file --yes` (idempotent — dedups by fingerprint).

---

## 9. The substrate layer (v1.x+, optional)

Enabled by `lattice mode substrate`. Adds:

- **Decisions (ADRs).** `lattice decide <slug> --title "..." --because "..."`.
  Lives in `.lattice/decisions/*.md`. Statuses: proposed / accepted /
  superseded / rejected. `--cite path:lines` and `--relates-to` and
  `--supersedes` build a DAG. Listed via `lattice decisions list`.
- **Invariants.** `lattice invariants derive` mines accepted ADRs + closed
  findings for project-level invariants and writes
  `.lattice/invariants.yml`. `lattice invariants diff` flags drift.
- **`lattice context`** is enriched in substrate mode: includes the ADR list
  and invariants summary alongside the standard finding counts.

`classic` mode keeps the v0.x finding-only behavior. `hybrid` is the
intermediate state where ADRs exist but invariants haven't been derived yet.

---

## 10. The grow layer (v2.x+, optional, hypothesis lifecycle)

Forward-looking experiments — parallel to findings. Lives in
`.lattice/hypotheses/{open,running,closed,rolled-back}/`. Lifecycle:

```
propose ──► run ──► measure ──► check ──┬─► close (won|lost|inconclusive)
                                        └─► rollback / auto-rollback
```

### Measurement model

A hypothesis YAML has a `measurement:` block with:

| Field             | Meaning                                                                       |
| ----------------- | ----------------------------------------------------------------------------- |
| `source` / `sources` | Where to read the metric. Schemes: `http:`, `file:`, `cmd:` (allowlisted).  |
| `headers`         | Optional HTTP headers; supports `${VAR}` interpolation (currently broad — see HIGH-finding around env-var leak). |
| `combine`         | `sum` / `avg` / `max` / `min` when there are multiple sources                 |
| `baseline_value`  | Stamped at `lattice grow run`                                                 |
| `expected_delta`  | Direction + magnitude                                                         |
| `success_threshold` | Pass/fail criterion                                                         |
| `window_days`     | How long to observe                                                           |

### Subcommands

`init`, `propose`, `list`, `show`, `run --commit <sha>`, `measure`, `check`,
`rollback`, `auto-rollback`, `close`, `attach-measurement`, `schedule
{install,status,uninstall,trigger}`.

`schedule install` lays down a cron (Telegram notification on auto-rollback
via `scripts/lattice-grow-telegram.mjs`).

Note: the grow subsystem currently has open DRIFT findings — schema is not
yet documented in `docs/`, and usage is missing from the top-level
`usage()` heredoc.

---

## 11. The telemetry path

Direction: Lattice client → Cloudflare Worker → GitHub Issues. **Outbound
only.** Default-on but trivially disabled (`lattice config telemetry off` or
`LATTICE_TELEMETRY=0`). Telemetry is OFF in the current `.lattice/config.yml`
of this repo.

### Client side (`scripts/lattice`, lines 374–525)

Sends only on **failed** lattice invocations. Whitelisted fields are computed
in-script and POSTed to the Worker URL. Manual `lattice report <category>` uses
the same wire format with `kind: "manual_report"`.

### Worker side (`worker/lattice-telemetry.js`)

- Strict whitelist sanitizer (`sanitize()`). Anything not in the schema is
  dropped silently.
- Required fields: `version` (semver), `command` (a-z + `_-`), `exit_code`
  (0-255), `os` (linux|darwin|windows), `msg_fingerprint` (hex 32-64).
- Dedup: 24h sliding window keyed by fingerprint in Workers KV. Within
  window → comment "+1 occurrence" on the existing issue. Outside window →
  open a new issue.
- Labels: `telemetry,auto-reported,bug` (configurable).
- No PII; no message bodies; no file paths beyond what the client computed
  before hashing.

Privacy guarantee: every issue filed by the Worker is **public** and tagged
`telemetry`, so the channel is self-auditing.

---

## 12. Self-tuning and self-installation

- `lattice setup [--global]` bootstraps `.lattice/` (and installs binaries
  globally when `--global`).
- `lattice doctor` repairs missing scaffolding and reports drift.
- `lattice project-init` / `project-sync` / `project-restore` manage the
  per-project CLAUDE.md auto-synced block (with backups under
  `.lattice/claude-md-backups/`).
- `lattice claude-md-tune --apply` rewrites the global
  `~/.claude/CLAUDE.md` Lattice block from current state + observed usage
  (also backup-protected). `claude-md-restore --list` to revert.
- `lattice normalize` re-derives finding ids/filenames after schema changes
  (default dry-run).
- `lattice update --check | --self` — self-updater. Channels: stable / beta /
  pinned. Configured in `.lattice/config.yml` → `updates`.

---

## 13. CI integration

- `lattice ci-check [--tier CRITICAL,BLOCKER]` — exit 1 if any non-deferred
  finding at the given tier(s) is open. Drop-in for any pipeline.
- `lattice ci-check-dead [--days N]` — exit 1 if findings have been open
  longer than N days without a deferral.
- `lattice sync --check` — exit 1 if CLAUDE.md drifted from
  `findings/open/`.

These are intended to run from any CI; there is no Lattice-specific runner.

---

## 14. Plugin / distribution surface

- **Claude Code plugin** — `.claude-plugin/plugin.json` declares `name: lattice`,
  `commands: ./commands/`. `marketplace.json` carries marketplace metadata.
  This is how Lattice ships into a user's Claude Code as a discoverable plugin.
- **Source install** — `bash scripts/install.sh` (linux/mac/WSL) lays the
  script + helpers + commands + completion under `~/.claude/lattice/`,
  optionally wires hooks.
- **Update path** — `bash scripts/update.sh` or `lattice update --self`.
- **Uninstall** — `lattice uninstall [--global] [--purge]`.

---

## 15. Module / dimension matrix (what audits look for)

| Dimension       | Default-on | Slash command       | Looks for                                                                |
| --------------- | :--------: | ------------------- | ------------------------------------------------------------------------ |
| `audit`         |     ✓      | `/audit`            | Doc-vs-code drift (a stated behavior that the code no longer implements) |
| `scale`         |     ✓      | `/scale-audit`      | In-memory state, setInterval crons, in-process rate limiters, singletons |
| `security`      |     ✓      | `/security-audit`   | Auth gaps, signature bypass, secret leaks, IDOR, injection, OWASP basics |
| `env-contract`  |     ✓      | (audit-sweep)       | `process.env.X \|\| 'literal'` silent fallbacks; missing required vars   |
| `flow`          |   opt-in   | `/flow-audit`       | Customer-flow gaps (steps drawn in docs that aren't wired up)            |
| `coverage`      |   opt-in   | (audit-sweep)       | Test coverage gaps for non-trivial branches                              |
| `configuration` |     —      | (manual)            | Config-file drift, hardcoded values that should be env-driven            |
| `quality`       |     —      | (manual)            | Code-quality smells worth tracking                                       |
| `product`       |     —      | (manual)            | Product-level invariants (substrate mode)                                |
| `infra`         |     —      | `audit-infra`       | Infrastructure-as-code drift                                             |

`/audit-sweep` runs audit + scale + security + env-contract by default; flow
and coverage are opt-in via positional args.

---

## 16. State diagram — a finding's life

```
              ┌──────────────────────────────────────────────────────┐
              │ slash command (Claude reasoning + Bash/Grep/Read)    │
              └──────────────────────┬───────────────────────────────┘
                                     │ writes
                                     ▼
                       .lattice/findings/open/<slug>.yml ── status: open
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
        ▼                            ▼                            ▼
   lattice defer              lattice close              lattice close
   --until DATE               --partial "..."            --reason {fixed,fp,
   --reason "..."             [--commit SHA]              wont-fix,oos,dup}
        │                            │                   [--commit SHA |
        ▼                            ▼                    --pending]
   status: deferred           status: in_progress         [--pr N]
        │                            │                            │
        │  (date passes;             │  (further partials         │
        │   returns to open)         │   or full close)           │
        └────────────────────────────┴─────────────┬──────────────┘
                                                    ▼
                              .lattice/findings/closed/<slug>.yml
                                  closed_at, close_reason, close_commit
                                                    │
                                                    ▼
                                              lattice reopen
                                                    │
                                                    ▼
                                  back to findings/open/ + reopened_at
```

The `--pending` shortcut writes `status: open` + `close_pending: true`. The
post-commit hook (`scripts/post-commit-resolve-pending.sh`) sees the new SHA
and runs `lattice resolve-pending --commit HEAD` to finalize.

---

## 17. Trust boundaries and current known sharp edges

These are the live entries in this repo's own `.lattice/findings/open/` —
useful context when pitching the architecture, because they show what the
substrate is and isn't.

- **`cmd:` source scheme in grow hypotheses runs `bash -c "${script}"`**
  unsandboxed (HIGH). YAML in a PR can introduce arbitrary command execution
  unless the maintainer reads it. Mitigation backlog: allowlist + warn on
  propose.
- **`${VAR}` interpolation in `headers:`** uses indirect expansion against
  the full shell env — any var (`GITHUB_TOKEN`, `ANTHROPIC_API_KEY`) can be
  exfiltrated to an attacker-controlled `source:` URL (MEDIUM). Fix: header
  var allowlist.
- **`eval "${step}"` of simulate steps** (`lattice verify --run`) inherits
  the parent shell (MEDIUM). Fix: subshell + preview or allowlisted prefix.
- **MCP `close_finding` has no programmatic confirm gate.** Destructive
  annotation alone doesn't stop a misbehaving host (MEDIUM). Fix: require
  `confirm: true` in inputSchema.
- **Fork-per-yaml-field on Windows.** `cmd_list` does ~10 forks per finding
  via the `yaml_field` helper; ~1000 forks per `lattice list` for a
  100-finding project. Painful on Windows where fork ≈ 50 ms (WATCH).
- **Subprocess-per-MCP-tool-call.** No cache; every list/show pays a CLI
  exec (WATCH). Mitigation backlog: 5s TTL cache.

Full live list: `lattice list`. Closed history: `.lattice/findings/closed/`.

---

## 18. What is intentionally NOT in the architecture

These are deliberate omissions, not gaps:

- **No DB, no daemon.** YAML files + git are the persistence layer.
- **No admin dashboard.** Friction surfaces as GitHub issues (Worker)
  or the statusline.
- **No agent runtime of its own.** Lattice runs inside Claude Code; the
  bash CLI is the only thing it ships, and it has no LLM dependency.
- **No mandatory telemetry.** Default-on but one-flag-off, public issues
  for everything filed, strict sanitizer at the receiver.
- **No silent auto-close.** Every transition requires an explicit user
  command (the MCP server enforces this for hosts too).
- **No multi-tenant model.** State is per-project, in the project's tree;
  no cross-project coupling.

---

## 19. Versions and surface area

- Plugin / CLI: **2.2.1** (`.claude-plugin/plugin.json`)
- MCP server: **1.0.0** (`mcp/src/index.ts`)
- Telemetry worker: deployed at `worker/wrangler.toml`'s target
- Bash CLI: **8,645 LOC**, ~70 subcommands, strict-mode bash
- MCP server: **312 LOC** TypeScript, 4 tools
- SessionStart hook: **348 LOC** Node, hard-bounded at 1.5s
- statusLine: **362 LOC** Node, ~50-150 ms / tick
- Cloudflare Worker: **421 LOC** JS, KV-backed dedup

---

## 20. How to verify any of this

- `lattice context` — current runtime snapshot.
- `lattice list` — open findings.
- `lattice --help` and `lattice <cmd> --help` — authoritative usage.
- `grep -nE "^cmd_" scripts/lattice` — every subcommand handler.
- `mcp/src/index.ts` — every MCP tool, top-to-bottom in one file.
- `docs/finding-schema.md` — canonical YAML schema reference.
- `docs/telemetry-protocol.md` — Worker wire format.
- `.lattice/findings/open/` — this repo's live backlog (Lattice on Lattice).
