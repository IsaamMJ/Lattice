---
description: Stress-test Lattice's host project by fanning out N parallel hardening sub-agents (one per attack surface). Each agent does static + dynamic analysis of one surface and emits findings as multi-doc YAML. Findings auto-import via `lattice file --from`. Cheap, parallel, runs in minutes — designed to catch the bugs ordinary audits miss.
allowed-tools: Agent Bash Read Write
---

# stress-audit

A second hardening pass over the codebase, complementary to `/audit-sweep`. Where audit-sweep walks modules + dimensions sequentially, **stress-audit fans out parallel sub-agents — one per ATTACK SURFACE.** Surfaces are project-wide, not module-scoped.

This skill was extracted from the 2026-05-21 Lattice session where 5 parallel sub-agents found 5 HIGH bugs in v2.2.0 code in under 5 minutes of wall-clock time. The pattern works whether the agents have bash access or not — static-only sub-agents still produce high-signal findings.

## When to invoke

- **Before a release tag.** Lattice itself: run `/stress-audit .` between feature ships and tag.
- **After a large refactor** that touched parsers / YAML emission / shell-out paths.
- **On a schedule** (weekly cron, opt-in) — the v2.3 self-hardening loop.
- **When the operator says "harden",** "stress test", "find edge cases" etc.

## Argument parsing

Split user input on whitespace. Tokens:

| Token | Meaning |
|---|---|
| `.` or any absolute path | Project root (default `.`) |
| `--surfaces=<csv>` | Comma-separated subset of: `yaml-fuzz,shell-inject,concurrency,windows-edge,artifact-validity` (default = all 5) |
| `--auto-import` | Pipe each sub-agent's findings file through `lattice file --from --no-confirm-dup` at the end |
| `--max-parallel=N` | Cap concurrent agent count (default 5; lower if rate-limited) |

Print resolved plan upfront:
`stress-audit plan: surfaces=[...], project=<path>, auto-import=true/false, parallel=N`

## The 5 surfaces

Each surface gets its own sub-agent dispatched in a single message (parallel). Each agent must produce `/tmp/stress-<surface>.findings.yml` as multi-doc YAML matching this schema:

```yaml
tier: <CRITICAL|HIGH|MEDIUM|LOW>
dimension: <security|concurrency|quality>
module: <component-name>
rule: <stable-slug>
file: <path>
line: <number>
title: "<one-line failure>"
fix: "<concrete fix>"
evidence: |
  <command run>
  <observed output>
status: open
---
```

### Surface 1 — yaml-fuzz

**Goal:** find parser-poisoning inputs that break CLI behavior or escape charclass validation.

**Brief template (paste verbatim into Agent prompt):**
```
You have Bash, Read, Write permissions — use them. Do not ask.

Find edge cases where Lattice's YAML parsing breaks. Lattice at <PROJECT_ROOT>.

Construct ≥10 adversarial fixtures (literal `"` in strings, embedded `:`, shell
metachars in title, CRLF line endings, tab indentation, comments after values,
multi-line `|` block scalars, unicode/RTL, `---` mid-content, deeply-nested
relates_to, duplicate keys, tier value not in canonical set).

For each: drop under .lattice/findings/open/, run `lattice list/show/validate`,
record actual vs expected. Real bug = unexpected exit, garbled output, parse
error blaming wrong field, OR silent acceptance of malformed input.

Emit /tmp/stress-yaml-fuzz.findings.yml (multi-doc, schema in stress-audit.md).
Report ≤150 words after writing the file.
```

### Surface 2 — shell-inject

**Goal:** find shell injection / command-injection in any path that interpolates a string into bash, exec, or generated workflow YAML.

**Brief template:**
```
You may not have Bash — static analysis only is FINE for this surface and
produces high-signal findings.

Read scripts/lattice in chunks. Find:
1. Unquoted ${var} expansions where the value comes from YAML / CLI arg / env
2. eval / bash -c paths
3. Heredoc bodies that interpolate ${vars} into a body later evaluated
4. Generated workflow YAML: any execSync / template-literal interpolation of
   YAML-derived values (slug, observed_value, REPO env)
5. `gh issue create -t "${title}"` style calls where title is YAML-controlled

For each suspicious site, classify origin (YAML → HIGH; CLI arg → MEDIUM;
internal → LOW). Where possible, sketch a concrete PoC.

Emit /tmp/stress-shell-inject.findings.yml (multi-doc, see schema).
Report ≤200 words.
```

### Surface 3 — concurrency

**Goal:** find races, lost-write bugs, broken file locks.

**Brief template:**
```
Static read of scripts/lattice and scripts/lattice-close.sh. Find:
- Read-modify-write paths with no flock
- Shared `${file}.tmp` paths (not per-PID)
- CLAUDE.md regenerator (`_lattice_project_sync_auto`) — racy?
- events.jsonl `>>` append on Windows (O_APPEND non-atomic in MSYS)
- Multi-step writes that could leave half-written state visible

Sketch the corruption mode (lost write, dup key, half-written file) per
finding. Locked code (look for `flock`, `mktemp`, atomic mv) = safe.

Emit /tmp/stress-concurrency.findings.yml (multi-doc).
Report ≤200 words.
```

### Surface 4 — windows-edge

**Goal:** Git Bash + Windows-specific bugs that don't show on Linux CI.

**Brief template:**
```
Static read of scripts/lattice + lattice-stop.mjs + lattice-session-start.mjs +
install.sh + update.sh. Find:
- Paths with spaces (`C:\Program Files\...`) breaking unquoted args
- CRLF leaks: yaml_field, cmd_file, any sed/grep that doesn't strip \r
- bare `mktemp` calls without `|| echo /tmp/...` fallback (inconsistent)
- bash -c spawns from .mjs hook scripts (PATH context lost on Windows)
- `git diff --cached --name-only` slash-direction assumptions
- Drive-letter normalization (/c/Users vs C:\Users vs C:/Users)
- `bash -c ${found_path}` where found_path may be a .cmd or .bat shim

Emit /tmp/stress-windows-edge.findings.yml (multi-doc).
Report ≤200 words.
```

### Surface 5 — artifact-validity

**Goal:** verify every artifact Lattice generates parses in its target system.

**Brief template:**
```
Read the heredoc generators in scripts/lattice that emit:
1. `.github/workflows/lattice-grow-check.yml` (slice 4 workflow)
2. `.lattice/config.yml` (config init)
3. CLAUDE.md block between `<!-- lattice:checklist:start -->` markers (sync)
4. The agent registry YAML in .lattice/agents/<slug>.yml (slice F)
5. Multi-doc YAML round-trip via lattice file --from

If Bash is available: bootstrap a test project, generate each artifact, run
js-yaml / python -c 'yaml.safe_load(...)' / node --check on extracted node
heredocs. If Bash is denied: do static review of generator code paths —
look for unescaped `${var}` interpolation in YAML output, missing newlines,
heredoc indentation that breaks YAML block scalars.

Emit /tmp/stress-artifact-validity.findings.yml (multi-doc).
Report ≤200 words.
```

## Dispatch protocol

Send all N Agent tool calls **in a single message** so they run concurrently. Use `subagent_type: general-purpose`, `run_in_background: true`. After each completes, the parent (this skill) collects the findings files.

After all return:

1. Concatenate all findings files into `/tmp/stress-all.findings.yml`.
2. If `--auto-import` was set: `lattice file --from /tmp/stress-all.findings.yml --no-confirm-dup`.
3. Otherwise: print the path and instruct the user to review + `lattice file --from` manually.
4. Print a tier-grouped summary: `Stress sweep complete: 3 HIGH, 5 MED, 7 LOW. Top 3 to fix today: ...`.

## Anti-patterns (refuse)

| ❌ | Why |
|---|---|
| Dispatching surfaces sequentially | The whole point is parallel; serial is 5× slower |
| Asking the user permission per agent | Dispatch them all upfront, then check in once at the end |
| Re-reporting findings already in `.lattice/findings/closed/` | Stale; check before filing |
| Synthesizing findings without evidence | If sub-agent says "could be vulnerable", refuse to file. Need a concrete code line + failure mode |
| Running on a non-Lattice repo without warning | Stress dimension is calibrated for the Lattice codebase shape; on other repos warn and continue |

## Output discipline

- Print the resolved plan upfront
- Don't narrate per-agent work — they report when done
- Final output = aggregated findings file path + tier-grouped count + top-3 todo
- Manifest is the summary

## Tool usage

- **Agent** — one dispatch per attack surface (the core of the skill); sub-agents get Bash + Read + Write per their surface brief
- **Bash** — `lattice context` / `lattice file --from` for import, scratch-project bootstrap for dynamic surfaces
- **Read** — aggregating sub-agent YAML output before import
- **Write** — the multi-doc findings file handed to `lattice file --from`
- Never used: Edit (this skill files findings; it does not modify the host project)

---

After running: `lattice list --tier CRITICAL,HIGH` to triage. `/lattice-fix <id>` for one-shot PATCH_DOC fixes. `lattice next --unblocked-only` for the highest-leverage actionable finding.
