---
description: Run audit + scale + security + env-contract (default) across every module via one dispatch per module, aggregate into a master findings manifest with cross-cutting pattern detection. Use when the user wants a full project audit, asks "audit this codebase", invokes `/audit-sweep`, or mentions multi-module sweep / cross-cutting review.
argument-hint: <project-root> [audit|scale|security|env-contract|flow|coverage] [auto] [<module-paths...>]
allowed-tools: Read Grep Glob Bash Task
---

Sweep arguments: $ARGUMENTS

## Live Lattice state (auto-injected at invocation)

!`lattice context 2>/dev/null || echo "(lattice context unavailable)"`

## Bootstrap (auto-injected — ensures .lattice/ tree exists for emissions)

!`lattice setup 2>/dev/null | grep -E "ok|warn" || mkdir -p .lattice/findings/open .lattice/findings/closed .lattice/findings/sweeps 2>/dev/null`

## Argument parsing (do this FIRST)

Split `$ARGUMENTS` on whitespace. Classify each token:

| Token | Means |
|---|---|
| `audit` | run only the audit dimension |
| `scale` | run only the scale dimension |
| `security` | run only the security dimension |
| `env-contract` | run only the env-contract dimension (default-on; see Step 0) |
| `flow` | run only the flow dimension (opt-in only) |
| `coverage` | run only the coverage dimension (opt-in only) |
| `auto` | auto-apply drafted checklist entries to CLAUDE.md and commit at end |
| Path starting with `src/modules/` or absolute path | explicit module to audit (overrides auto-discovery) |
| `.` or any other path | project root (defaults to `.` if none given) |
| `parallel` | enable parallel module dispatch (DEFAULT IS SEQUENTIAL — only use when explicit) |

**Dimension filtering:**

| Token state | Run |
|---|---|
| No dimension token | audit + scale + security + env-contract (default) |
| Any of audit/scale/security/env-contract/flow/coverage present | ONLY those |

`flow` and `coverage` are opt-in — explicitly include when wanted (`/audit-sweep . flow` or `/audit-sweep . security flow`).

**Module filtering**: If one or more `src/modules/X` paths given, audit ONLY those. Else auto-discover via `Glob src/modules/*/`.

Print the resolved plan upfront: `Sweep plan: dimensions=[...], modules=[...], auto=true|false, mode=SEQUENTIAL|PARALLEL`.

**Auto-mode caveat:** CRITICAL/BLOCKER fixes are NEVER auto-applied — always require human approval.

# audit-sweep

Full Lattice audit pass across every module in the project. Produces one aggregated findings manifest and a single triage prompt at the end.

## Why this exists

A 9-module project = 27 skill invocations under the per-skill model. audit-sweep collapses this to **one dispatch per module** — each module gets a single Sonnet sub-agent that runs all in-scope dimensions inline, then returns combined findings. Cuts cold-start tax 3×, preserves cross-cutting analysis within a module, lets Anthropic prompt caching reuse the methodology library across all module dispatches.

## Methodology

### Step 0 — Project-wide env-contract pass

If `env-contract` is in the active dimension set (default-on unless filtered out), run ONCE at sweep start, BEFORE per-module dispatch:

```bash
bash scripts/lattice audit-env-contract --write --path <project-root>
# OR if installed globally:
~/.claude/lattice/scripts/lattice audit-env-contract --write --path <project-root>
```

Detects env-var silent-fallback patterns (`process.env.X || 'literal'`, `??`, destructured defaults, `os.environ.get`, `String.fromEnvironment`) across Node/TS/Python/Dart. Classifies by fallback-value plausibility (HIGH/MEDIUM/LOW). Emits findings directly into `.lattice/findings/open/`. If `docs/env.contract.md` exists, also emits `DRIFT-env-not-in-contract-<KEY>` for env vars referenced in code but missing from the contract.

**Why project-wide, not per-module:** env vars are global. Run once at top, not duplicated in every module dispatch.

### Step 1 — Enumerate modules + generate sweep_id

**Framework-aware module discovery (v1.2.0, #51).** Detect the project layout BEFORE globbing `src/modules/`. Try in order:

| Layout signal | Module enumeration |
|---|---|
| `src/modules/*/` non-empty | Use `src/modules/*/` (legacy / explicit-module projects) |
| `apps/*/` + `packages/*/` (monorepo: nx, turbo, pnpm) | Each `apps/X/` and `packages/X/` is a module |
| `next.config.{js,ts,mjs}` or `app/` directory present | Next.js App Router: enumerate `src/app/api/*/`, `src/app/*/page.tsx`, `src/lib/`, `src/components/`, `src/hooks/`, plus `prisma/` if present, as separate modules |
| `pages/` + `package.json` mentions Next | Next.js Pages Router: enumerate `pages/api/*/`, top-level `pages/*.tsx`, `src/lib/`, etc. |
| `lib/`, `internal/`, `cmd/` at root (Go) | Each top-level dir as a module |
| `app/`, `lib/`, `test/` (Flutter, Dart) | Each as a module |
| None of the above | **Flat-repo fallback:** treat top-level directories under the project root as modules; cap at 12, prefer non-trivial ones (skip `node_modules`, `.git`, `dist`, `build`, `.next`, `coverage`) |

**Never invent paths.** Every module enumerated MUST exist on disk. If detection lands on zero modules, ask the user once for a hint instead of fabricating.

| # | Action |
|---|---|
| 1 | Run the framework-aware enumeration above. Record which layout signal fired (used as `runtime_warnings` if unusual). |
| 2 | For each module, locate its TTD doc by matching basename (`src/modules/lumi/` → `docs/ttd/*lumi*.md`). If no doc exists, note "no TTD" and audit code-only |
| 3 | Generate `sweep_id` via Bash: `lattice sweep-id`. This emits `<YYYYMMDD><6-hex>` — stable, sortable, collision-resistant. Capture it; pass into every per-module dispatch in Step 2 |
| 4 | Note **start time** (Bash `date +%s` or ms equivalent) — used for `duration_ms` in the manifest |
| 5 | Print planned sweep: `Will audit N modules from <layout> layout: [list]. Mode: SEQUENTIAL. sweep_id: <id>` |

### Step 2 — Per-module sequential dispatch

**Execution discipline (REQUIRED, not optional):**

Echo-back protocol for every module — these echoes are the audit trail that prevents parallel-drift recurrence:

1. **Before dispatching** module K of N, output exactly:
   ```
   [SWEEP] Module K/N starting: <module-path> (dimensions: <list>)
   ```
2. **Dispatch one Sonnet sub-agent** for that module (template below). Wait for return.
3. **After return**, output exactly:
   ```
   [SWEEP] Module K/N complete: <module-path> — audit=<n>OK/<n>DRIFT scale=<n>B/<n>R security=<n>C/<n>H
   ```
4. **Only then** may you proceed to module K+1.

If any echo line is missing or out of order → drift. Stop, report, ask user how to recover.

**No parallel batches** unless user explicitly typed `parallel` as a token. Reason: parallel breaks the stop-condition gate, corrupts cross-cutting detection, and makes token usage unpredictable.

**Dispatch prompt template + per-module methodology:** load [references/audit-sweep-module-dispatch.md](references/audit-sweep-module-dispatch.md). Keep the methodology block byte-identical across all dispatches so Anthropic prompt caching hits the cache after the first module.

### Step 3 — Aggregate into the sweep manifest

The YAML findings on disk are the source of truth; the CLAUDE.md checklist (regenerated in Step 5) is the human-readable view.

**v1.1.2: Normalize ids + filenames first.** Run `lattice normalize --apply` before manifest aggregation. This re-derives `id:` from each YAML's `(dimension, rule, file, code_context)` tuple (per the v0.7 sha1 algorithm) and renames files to canonical `TIER-MODULE-RULE.yml` form with leading-dot module segments stripped. Without this, subagents that fabricate 16-hex ids (#52) cause every subsequent sweep to report all findings as "new" because hashes won't match.

After all module dispatches complete, write the sweep manifest via `lattice write-manifest` (v1.2.0, #48 — wraps `scripts/lattice-write-manifest.sh` so the path resolves whether installed globally or from a dev checkout). Load [references/audit-sweep-manifest.md](references/audit-sweep-manifest.md) for the exact command + input computation + manifest YAML shape + commit instructions.

### Step 4 — Cross-cutting pattern detection

Scan all findings across all modules for repeated defect classes. Any pattern appearing in 2+ modules = bundle-PR candidate.

For each cross-cutting pattern:
- Suggest single PR title
- List files to modify
- Estimate effort (low/med/high)
- Add as `runtime_warnings` entry in the manifest: `"cross-cutting: <rule> in modules [<list>]"`

User surfaces these via `lattice list --rule <slug>`.

### Step 5 — Regenerate CLAUDE.md checklist from YAML truth

`.lattice/findings/open/` now contains one YAML file per finding. The CLAUDE.md checklist is a **read-only view** of this truth.

Run the regenerator:

```bash
lattice sync
```

This rewrites the block between `<!-- lattice:checklist:start -->` and `<!-- lattice:checklist:end -->` in CLAUDE.md. Anything outside the markers is preserved (manual triage notes go in a sibling `## Triage notes` section).

**Always commit findings (both standard and auto modes):**

```bash
git add .lattice/findings/
git commit -m "chore(lattice): sweep <sweep-date> — persist YAML findings"
```

**Additional commit only if `$ARGUMENTS` contains `auto`:**

```bash
git add CLAUDE.md
git commit -m "docs(lattice): regenerate checklist for sweep <sweep-date>"
```

In standard mode, the regenerator runs and writes CLAUDE.md, but committing is left to the user (so they review the diff first).

**CRITICAL/BLOCKER findings are NEVER auto-resolved.** They stay open until explicitly closed via `lattice close <finding-id> --commit <sha> --pr <num>`.

### Step 6 — Stop with one prompt

If `auto` mode applied checklist:

```
Lattice sweep complete. Manifest: .lattice/findings/sweeps/<sweep_id>.yml
- Modules: <n>
- CRITICAL/BLOCKER: <n> (need attention today — NOT auto-applied)
- HIGH/RISK: <n> (auto-applied to CLAUDE.md, commit <hash>)
- MEDIUM/WATCH: <n> (auto-applied)
- LOW: <n> (auto-applied)
- Cross-cutting bundles flagged: <n> (see runtime_warnings in manifest)
- Skipped (parse errors): <n>

Reply 'fix all critical' to triage, 'show bundles' to drill into PR candidates, or 'discuss'.
```

Otherwise:

```
Lattice sweep complete. Manifest: .lattice/findings/sweeps/<sweep_id>.yml
- Modules: <n>
- CRITICAL/BLOCKER: <n> (need attention today)
- HIGH/RISK: <n> (need triage this week)
- Cross-cutting bundles flagged: <n>
- Skipped (parse errors): <n>

Use `lattice list` to triage, `lattice triage` for interactive walk, `lattice show <id>` for one finding.
Reply 'fix all critical', 'apply checklist', 'show bundles', or 'discuss'.
```

## Anti-patterns (refuse)

| ❌ | Why |
|---|---|
| Skipping `[SWEEP]` echo lines | They ARE the parallel-drift guard — non-optional |
| Dispatching module K+1 before module K's complete-echo | Breaks the audit trail |
| Dispatching the 3 dimensions as 3 separate sub-agents per module | Wasteful spin-up; one dispatch handles all dimensions |
| Auto-applying fixes during the sweep | Findings only — fixes need user direction |
| Skipping the stop-condition gate | If a module returns >5 CRITICAL or >2 BLOCKER, pause |
| Inventing modules that don't exist on disk | Use Glob output, not memory |

## Tool usage

| Tool | Used for |
|---|---|
| Glob | Enumerate modules + match TTDs |
| Task / Agent dispatch | ONE per module (Sonnet, module-scoped) |
| Bash | git operations, `lattice sweep-id`, `lattice-write-manifest.sh`, `lattice sync` |
| Write | Never — all findings YAML written by the per-module dispatched agents |

## Output discipline

- Print resolved sweep plan upfront
- One `[SWEEP] Module K/N starting` line per module before dispatch
- One `[SWEEP] Module K/N complete` line per module after return
- Final output = manifest path + verdict totals + one prompt
- The manifest IS the summary — do NOT re-summarize in chat

---

After running: `lattice list` / `lattice triage` / `lattice sync` to manage findings.
