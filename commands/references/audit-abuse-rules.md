# Abuse audit rule library (v2.3.0, #99)

Patterns the `abuse` dimension hunts. **Hostile-input thinking** for tools that have public endpoints, fetch-and-exec install paths, or shell out to operator-supplied strings. Calibrated for CLI tools + worker code + install scripts — NOT for typical web-app auth flows (those are covered by `security`).

Each rule below has:
- **Slug** — stable identifier used in finding YAMLs
- **Pattern** — code shape the auditor greps for
- **Tier** — default severity when matched
- **Repro shape** — the concrete attack chain that makes the finding non-theoretical

## Rules

### `unauthenticated-public-endpoint`

**Pattern:** HTTP handler accessible from the public internet (Cloudflare Worker, exposed listener, deployed Function) with neither auth nor rate limiting nor IP allow-list.

**Tier:** HIGH

**Detection:**
- Worker `fetch` handler in `worker/*.js` or `functions/*.ts` with no token verification, no `CF-Connecting-IP` rate-limit check, no `Authorization` header check
- `app.post('/x', ...)` Express/Hono/itty-router handlers exposed on a deployed host with same gaps
- Webhook receivers with `webhook_secret` env not validated against the request signature

**Repro shape:** `for i in {1..N}; do curl -X POST <url> -d '<min-valid-body>'; done` — what does the operator see at N=10000?

Reference: #90 (Lattice Worker had zero rate limiting until v2.2.5).

### `unverified-fetch-and-exec`

**Pattern:** Code that fetches a remote artifact AND executes it, with no checksum / signature / pin to immutable commit-SHA verification between fetch and exec.

**Tier:** HIGH

**Detection:**
- `curl … | bash`, `wget … | sh`, `eval "$(curl …)"` patterns in install/update scripts
- `fetch(url).then(text => new Function(text)())` or `require(url)` patterns
- Docker `RUN curl … | bash` (heavily-cached but still a vector)
- GitHub Actions step `run: curl … | bash`
- `npm install` with no `package-lock.json` / no `--ignore-scripts`

**Repro shape:** GitHub account takeover → push malicious `install.sh` → all `curl|bash` invocations within minutes are RCE'd.

Reference: #91 (Lattice install/update.sh had no checksum verification until v2.2.5).

### `eval-of-untrusted-string`

**Pattern:** `eval` / `Function()` / `bash -c`/`sh -c` / `os.system` / `exec` on strings that came from YAML, JSON, HTTP request body, or any other parsed input — not from the tool's own source code.

**Tier:** HIGH (if input is committable to a repo the tool reads) / MEDIUM (if input source requires existing operator access)

**Detection:**
- Search for `eval "${...}"` where `${...}` traces back to a YAML field
- `new Function(yamlField)`
- Python `exec(yaml_data['code'])`
- Anywhere `eval` runs in the parent shell instead of a subshell — that's strictly worse (mutates environment)

**Repro shape:** Author a YAML with `step: "$(id > /tmp/pwned)"`, get it merged or reviewed, watch for the artifact.

Reference: #95 (Lattice verify --run used `eval ${step}` until v2.2.5).

### `indirect-env-expansion`

**Pattern:** Bash indirect expansion `${!var_name}` or runtime env-lookup `process.env[user_string]` where `var_name` / `user_string` is operator/YAML-controlled.

**Tier:** HIGH (env contains secrets — usually does)

**Detection:**
- Grep for `\$\{![A-Za-z_]+\}` in bash files
- `process.env[someVar]` where `someVar` is not a string literal
- `os.environ.get(dynamic_key)` in Python

**Repro shape:** YAML field `Authorization: "Bearer ${ANTHROPIC_API_KEY}"` → next fetch exfiltrates the key.

Reference: #86 (Lattice `_grow_fetch_metric` header interpolation, fixed in v2.2.4).

### `command-substitution-of-user-input`

**Pattern:** `bash -c "${user_supplied}"`, `sh -c "${...}"`, `cmd /c "${...}"` with no allow-list, no charclass validation, no quoting.

**Tier:** HIGH

**Detection:**
- `bash -c "${X}"` where `${X}` is not a verified-internal command
- Same shape as `eval-of-untrusted-string` but via `-c` flag — surprisingly common in CI scripts
- `child_process.execSync(template + ${var})` in Node where var is YAML-derived

**Repro shape:** Same as eval — embed `$(...)`, watch for execution.

Reference: closed in v2.2.0 (`cmd:` source scheme had this — now default-deny).

### `unescaped-shell-interpolation`

**Pattern:** User-controlled string spliced into a shell command without quoting OR `printf '%q'` escape.

**Tier:** MEDIUM (HIGH if reachable from YAML)

**Detection:**
- `${VAR}` inside double-quoted shell strings where VAR could contain `$(...)`, backticks, `;`
- `execSync(`gh issue create -t "${title}"`)` template literals (JSON.stringify is NOT shell-safe)
- `awk -v key="${VAR}"` where VAR contains awk metachars

**Repro shape:** Workflow YAML interpolates a YAML slug into `execSync` template → slug `$(id>/tmp/pwned)` runs.

Reference: v2.2.2 workflow RCE fix (slice 4's @claude dispatch used template-literal execSync).

## Anti-patterns (do not file)

- "Could be exploited if the operator goes out of their way to..." — not a finding. Trust boundary inside the tool's own machine is not the threat model.
- "Theoretically a malicious npm dep could..." — supply chain risk is already covered by `unverified-fetch-and-exec`. Don't double-file.
- Locally-scoped `eval` of internal-only strings — Lattice's own bash uses `eval` for some safe paths. Trace the input source before filing.

## Output

When the `abuse` dimension is in scope, each finding emitted follows the canonical schema with:

```yaml
dimension: abuse
rule: <slug-from-this-doc>
```

Required-fields cheatsheet for HIGH-tier abuse findings: `attack_scenario:`, `blast_radius:`, `exploitability:`, plus the always-required `fix:`. Subagents must populate these or the finding is rejected by the manifest aggregator.
