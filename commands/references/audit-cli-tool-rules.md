# cli-tool audit rule library (v2.3.0, #99)

Patterns the `cli-tool` dimension hunts. **Tool-shaped correctness** — atomicity, signal handling, fork tax, MCP gates, regex-vs-string-compare. Calibrated for CLI tools + git hooks + MCP servers + shell scripts that operate on local files in user repos.

Each rule below has slug + pattern + tier + repro shape. Same schema as `audit-abuse-rules.md`.

## Rules

### `non-atomic-write-no-signal-handler`

**Pattern:** Code writes to a file the user depends on (`CLAUDE.md`, dotfiles, config) via `fs.writeFileSync` or shell `>` redirect, with no `.tmp` + rename atomicity AND no SIGINT/SIGTERM handler to clean up partial writes.

**Tier:** MEDIUM (data loss on Ctrl-C; HIGH if the file is something a user can't easily regenerate)

**Detection:**
- `fs.writeFileSync(realPath, ...)` — no `realPath.tmp` first → flag
- Shell `> "${file}"` redirect — no `mv "${file}.tmp" "${file}"` → flag
- No `process.on('SIGINT'|'SIGTERM', ...)` in the same Node file → flag

**Repro shape:** Long-running write + `pkill -TERM` mid-flight → check if target is 0 bytes or truncated.

Reference: #93 (Lattice lattice-regenerate.sh wrote CLAUDE.md non-atomically until v2.2.5).

### `symlink-write-through`

**Pattern:** Code writes to a path that's user-configurable (dotfile, ~/.claude/X, /etc/X), AND the path could be a symlink, AND the write path uses shell `>` / `fs.writeFileSync` (both follow symlinks).

**Tier:** LOW (single-user tools) / MEDIUM (multi-tenant or root-owned tools)

**Detection:**
- Grep for shell `> "${target}"` where `${target}` traces to a user-passed arg or `${HOME}/...` location
- No `[ -L "${target}" ]` check earlier in the function
- `fs.writeFileSync(target)` with no `fs.lstatSync(target).isSymbolicLink()` check

**Repro shape:** Plant `~/.claude/CLAUDE.md → ~/.ssh/authorized_keys` symlink → run the tool → authorized_keys overwritten.

Reference: #97 (Lattice _lattice_md_apply followed symlinks until v2.2.5).

### `unescaped-regex-interpolation`

**Pattern:** User-supplied string interpolated into `grep -E` / `awk` / `sed` / `RegExp(...)` / language-native regex without literal-escape.

**Tier:** MEDIUM

**Detection:**
- `grep -E "...${var}..."` where var comes from git output, YAML, file listing, etc.
- `new RegExp(userString)` in JS — same shape
- `re.compile(user_input)` in Python

**Repro shape:** Path containing `[id]` (Next.js dynamic route) silently mis-matches. Path with `(...)` causes `grep -E` exit 2, `2>/dev/null` swallows it, hook silently misses the match.

Reference: #92 (Lattice prepare-commit-msg-lattice.sh did this until v2.2.5).

### `silent-collision-skip`

**Pattern:** "Skip and continue" branch on a canonical operation (rename, merge, write) when the destination exists, that exits 0 with no stderr warning.

**Tier:** MEDIUM (state drift), HIGH if it leaves the file in a partially-updated state

**Detection:**
- `if (fs.existsSync(dest)) { console.log('skipped'); continue; }` in apply paths
- Bash `mv x y || true` when y already exists
- `git checkout -b branch || true` when branch exists
- Anywhere "skip" leaves the source half-modified

**Repro shape:** Create the collision condition (file at expected destination), run the canonical op → check if source got partially mutated AND check exit code.

Reference: #94 (Lattice normalize --apply silently skipped renames while rewriting ids, until v2.2.5).

### `mcp-destructive-no-confirm`

**Pattern:** MCP tool with `destructiveHint: true` annotation but no required `confirm` field in the input schema. The annotation is advisory — hosts may not surface it.

**Tier:** MEDIUM

**Detection:**
- Search `destructiveHint: true` in MCP server code
- For each match, check inputSchema for a `confirm: z.literal(true)` or equivalent required-true field
- Missing → flag

**Repro shape:** Build a minimal MCP host that ignores destructiveHint, invoke the tool with just required args, confirm it executes.

Reference: #96 (Lattice MCP close_finding lacked this gate until v2.2.5).

### `block-scalar-strip-without-state-machine`

**Pattern:** Code strips a YAML field via `grep -v key:` or single-line regex, when the field can hold a `|` or `>` block scalar with indented continuation lines.

**Tier:** HIGH (silent YAML corruption)

**Detection:**
- Grep for `grep -v -E '^(...)[[:space:]]*:'` patterns
- For each, check the field list — if ANY of those fields are emitted elsewhere with `|` block scalar (`field: |\n  multi\n  line\n`), the strip is incomplete
- Compare against awk-state-machine patterns in the same script — inconsistency is the bug

**Repro shape:** Run two partial-closes with multi-line `--partial` text, observe corrupted YAML.

Reference: #88 (Lattice lattice-close.sh partial path until v2.2.5).

### `fork-per-field-in-loop`

**Pattern:** `for file in files; do helper $file field1; helper $file field2; ...; done` where `helper` is a shell pipeline (grep|sed) that forks per call.

**Tier:** WATCH (LOW on Linux, MEDIUM on Windows where fork ≈ 50ms)

**Detection:**
- Find shell helpers that fork at least 2 processes per call (`grep | sed`, `awk | head`, `cat | tr`, etc.)
- For each, count call sites inside `for/while` loops over file lists
- Multiply: forks ≈ files × calls × procs-per-call

**Repro shape:** Run on a 100-file fixture, time it. >5s = MEDIUM, >30s = HIGH.

Reference: #87 #98 (Lattice yaml_field, fixed via Node helper in v2.2.5).

### `unbounded-jsonl-read`

**Pattern:** `readFileSync` / equivalent on an append-only log file (events.jsonl, audit.log) with no size cap, no streaming read, no rotation.

**Tier:** LOW (hits performance) / MEDIUM (can OOM small machines)

**Detection:**
- Find `readFileSync(*.jsonl)` patterns
- Check if the file is append-only (look for `>>` redirects or `appendFileSync` writes elsewhere)
- If yes, check for size cap / rotation — usually absent

**Repro shape:** Append 100MB of synthetic events, run the consumer, watch memory.

## Anti-patterns (do not file)

- Re-flagging code that ALREADY has the relevant guard (`[ -L target ]`, `.tmp + mv`, `confirm: z.literal(true)`) — read the surrounding code before filing.
- "Could be slow if N is huge" without a measured number — file as WATCH only with evidence.
- Style-level regex-vs-string preference — only file when there's a CONCRETE failure case (a real path that breaks).

## Output

```yaml
dimension: cli-tool
rule: <slug-from-this-doc>
```

Required-fields for HIGH-tier cli-tool findings: `repro_steps:` (the exact command sequence to demonstrate), `fix:`, `affected_paths:` (which install targets / which OSes are vulnerable).
