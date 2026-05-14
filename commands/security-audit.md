---
description: Audit a module for security exposures — auth gaps, signature-verification bypasses, secret leaks, IDOR, injection vectors, OWASP basics.
argument-hint: <module-path>
---

Target module to audit: $ARGUMENTS

# security-audit

You are auditing one module for **security exposures** — patterns that allow unauthorized access, data leaks, financial abuse, or signature bypass. Findings get severity tiers and remediation guidance with `file:line` evidence.

## Why this skill exists

Scale audits catch what breaks under load. Security audits catch what an attacker (or a misconfigured caller) exploits. For a backend handling Razorpay + Meta Cloud API + healthcare data, a single auth gap or signature bypass = financial loss + compliance breach + CEO incident.

This skill finds those patterns *before* they get exploited, with `file:line` evidence per finding and a 4-tier severity model.

## Trigger

User invokes: `/security-audit <module-path>` (e.g. `/security-audit src/modules/payments`)

## OMC fallback (works without oh-my-claudecode installed)

Lattice prefers to dispatch its heaviest step (pattern hunting + context reads) to a Sonnet sub-agent for cost. If `oh-my-claudecode:executor` is installed, it's used. If not, the same step runs inline in the main session — **same methodology, same verdict quality, just slightly more tokens**. No degraded mode, no missing features.

Detection: at Step 3, attempt the dispatch. On dispatch failure, continue inline with the same prompt body.

## Risk patterns to hunt

For each pattern, evidence is concrete: a `file:line` showing the gap.

### CRITICAL — fix today, not "before scale"

| Pattern | OWASP | Why it's critical |
|---|---|---|
| Controller route with no `@UseGuards`, no signature verification, and no `NODE_ENV !== 'production'` gate | A01 | Anyone on the internet can hit it |
| Hardcoded secrets (API keys, JWT secrets, passwords) in source | A02 | Leaks via git, logs, CI artifacts |
| Webhook handler missing signature verification, or verifying after side effects | A08 | Forged webhooks = forged payments / events |
| Raw SQL via `$queryRaw\`...${userInput}...\`` (template-string interpolation) | A03 | SQL injection |
| `eval`, `new Function`, `vm.runInNewContext` on user input | A03 | Arbitrary code execution |
| File upload with no size limit, no MIME check, no extension allowlist | A04 | DoS + malware vector |
| Auth gated by `NODE_ENV` only (no auth in dev, assumes prod env always set) | A05 | Misconfigured prod = open admin |
| Webhook signature comparison with `===` instead of `crypto.timingSafeEqual` | A02 | Timing attack on signature |
| Path traversal: `fs.readFile`/`fs.createReadStream` on user-supplied path with no allowlist | A01 | Read arbitrary server files |
| `yaml.load`/`unsafe deserialize` on user input | A08 | Code execution via deserialization |

### HIGH — fix this week

| Pattern | OWASP | Why it matters |
|---|---|---|
| Public endpoint with no rate limiter (`@Throttle` / `@nestjs/throttler` missing) | A04 | Brute-force, scraping, cost abuse |
| Sensitive data in logs (tokens, payment IDs, full PII, request bodies) | A09 | Log aggregator becomes the breach |
| CORS allowing `*` origin in production | A05 | CSRF vector |
| Endpoint reads/writes resource by ID without checking caller owns it (IDOR) | A01 | One user reads another user's data |
| User input concatenated into LLM system prompts (prompt injection) | A03 | Hijacked agent behavior |
| Bearer tokens / session IDs in URL query params (instead of headers) | A02 | Leaks via referer + logs |
| `Math.random()` or `Date.now()` for tokens, IDs, password resets | A02 | Predictable; use `crypto.randomBytes` / `crypto.randomUUID` |
| Outbound HTTP to user-supplied URL with no allowlist (SSRF) | A10 | Internal-network probing, metadata-service exfil |

### MEDIUM — fix when convenient

| Pattern | Why it matters |
|---|---|
| `helmet` missing or default-only (no CSP, HSTS) | Browser-side hardening gap |
| Error responses returning stack traces or DB error details | Information disclosure |
| Long-lived JWT/session tokens with no rotation | Stolen token = long-term access |
| Sensitive operations (refund, role change, delete) without audit log | No forensics post-incident |
| Open redirect: `res.redirect(req.query.next)` without allowlist | Phishing assist |

### LOW — note in checklist

| Pattern | Why it matters |
|---|---|
| Verbose error messages on auth failure (`user not found` vs `wrong email`) | Account enumeration |
| Missing security headers beyond helmet basics | Hardening only |

## Methodology

### Step 1 — Load living truth
1. Read `CLAUDE.md` — note documented auth patterns, signature-verification rules, "intentional public endpoint" notes.
2. Read the module's TTD doc — note any Constraints already capturing security rules (e.g. "NEVER call X outside Y").

### Step 2 — Map the module
List every controller, service, guard, and middleware in `<module-path>`. Identify:
- All HTTP routes (controllers + decorators)
- All webhook handlers
- All admin/test endpoints
- Any guard / signature-verification middleware

### Step 3 — Hunt patterns (dispatched to subagent for cost)
Heaviest step. Dispatch to Sonnet subagent.

Dispatch `oh-my-claudecode:executor` (sonnet) with:
```
Hunt security risk patterns in module <module-path>. For each pattern below, run targeted Grep, then Read 30 lines of surrounding context for every hit.

Return a JSON array per hit:
  { pattern: "<name>", tier: "CRITICAL"|"HIGH"|"MEDIUM"|"LOW", file: "<path>", line: <n>, context: "<surrounding 5 lines>", false_positive: true|false, fix: "<one-sentence remediation>" }

Patterns to hunt (with the regex/keyword to grep):
- Unguarded routes: @Controller followed by @Get|@Post|@Put|@Patch|@Delete with no @UseGuards in same class — inspect each controller
- Hardcoded secrets: api[_-]?key|secret|password|token equals quoted string literal (not from env)
- Missing signature verification: webhook controllers grep for x-hub-signature|x-razorpay-signature|hmac and verify usage matches
- SQL injection: \$queryRaw|\$executeRaw with template literal containing ${
- Eval / dynamic code: \beval\(|new Function\(|vm\.runInNewContext
- Unbounded uploads: @UploadedFile|multer without size/mime restriction
- NODE_ENV-only auth: if.*NODE_ENV.*production with no other auth check around it
- Timing-unsafe compare: signature.*===|hmac.*===
- Missing rate limit: public controllers without @Throttle or ThrottlerGuard
- Sensitive logging: this.logger.*(token|secret|key|password|fullName|email|phone) — check if the value is logged raw
- Permissive CORS: cors.*origin.*\*|enableCors\(\) without explicit origin allowlist
- IDOR: findUnique|findFirst|update|delete by id with no userId match in the where clause
- Prompt injection: user input concatenated into systemPrompt|messages without escaping
- Tokens in URL: req\.query\.(token|key|jwt|session)
- Stack traces in errors: throw err|res.status.*err\.stack|exception.*message exposed in response

Mark false_positive=true for: test files (*.spec.ts, *.test.ts), scripts/ files, files inside guards/ directory (which IS the auth layer), TODO comments. Provide a one-sentence fix recommendation per real hit.
```

Wait for the subagent's JSON response. Use it as input to Step 4+.

Fallback: if executor unavailable, run the greps in the main session with the same methodology.

### Step 3b — Dependency CVE audit
Run `npm audit --json` (or equivalent for the project's package manager) at the project root. Parse the output for any CRITICAL or HIGH severity advisories that affect packages used by this module. Add each as a finding with:
- pattern: "vulnerable dependency: <package>@<version>"
- tier: CRITICAL if CVE severity ≥ 9.0, otherwise HIGH
- evidence: `package-lock.json` + the `npm audit` advisory URL
- fix: "upgrade to <fixed version>" or "no fix available — assess exposure"

If `npm audit` returns errors (registry timeout, etc.), note it and continue without blocking the audit.

### Step 4 — Cross-check against TTD/CLAUDE.md
For each hit, check whether the TTD or CLAUDE.md already documents it as intentional. Examples:
- `/r/:token` is intentionally public (it's a share-link) → not a CRITICAL "unguarded route", but flag as HIGH "missing rate limit + cache" if those gaps exist
- A test endpoint already gated behind `NODE_ENV !== 'production'` → OK, not CRITICAL

If documented intentional, downgrade tier or mark `OK` with the citation.

### Step 5 — Assign verdicts

| Verdict | Means | Required evidence |
|---|---|---|
| **CRITICAL** | Exploitable today by an external caller, fix immediately | `file:line` + 1-sentence attack scenario + 1-sentence fix |
| **HIGH** | Real risk under realistic misuse / compromise scenarios, fix this week | `file:line` + scenario + fix |
| **MEDIUM** | Hardening gap, fix when convenient | `file:line` + fix |
| **LOW** | Note in checklist, no urgency | `file:line` |
| **OK** | Pattern checked, intentional/safe (with citation) | `file:line` + the CLAUDE.md/TTD line that justifies it |

**Hard rule**: every CRITICAL and HIGH gets:
1. **OWASP category** (A01-A10) tagged on the finding
2. **Exploitability** label: Remote-unauth / Remote-auth / Local-only
3. **Blast radius**: 1 sentence on what an attacker gains
4. **Attack scenario**: 1 sentence (e.g. "attacker POSTs forged Razorpay webhook → credits added without payment")
5. **Remediation timeline** per the table below
6. **Secure code example** as a BAD/GOOD code block in TypeScript matching the file's language

**Remediation timelines** (mirror OMC security-reviewer convention):
- CRITICAL → fix within 24 hours; rotate any exposed secret within 1 hour
- HIGH → fix within 1 week
- MEDIUM → fix within 1 month
- LOW → backlog

**OK-finding discipline (v0.6.7+):** Emit `tier: OK` findings for security patterns checked-and-found-safe (e.g. `OK-payments-webhook-uses-timingsafeequal`, `OK-payments-rate-limiter-applied`, `OK-admin-routes-guarded`). These are first-class output — they prevent re-flagging the same patterns and signal which controls have been deliberately implemented. Each OK requires `intentional_citation` per the schema.

### Step 6 — Write findings (v0.7 YAML schema)

Emit **one YAML file per finding** to `.lattice/findings/open/<TIER>-<module-slug>-<rule-slug>.yml` per `docs/finding-schema.md`.

For security dimension, `<rule-slug>` is a kebab-case pattern name: `webhook-timing-unsafe-eq`, `unguarded-route`, `xss-template-interpolation`, `missing-rate-limit`, `idor-userid-not-checked`, etc.

YAML body per finding (security dimension):

```yaml
id: <12-char hex>   # Generate per-finding via: lattice id-gen security <rule> <file> "<exact source line, whitespace-collapsed>". Do NOT call id-gen without all four positional args — it will fail with exit 2 and auto-report a telemetry bug.
rule: <kebab-case pattern slug>
dimension: security
tier: CRITICAL | HIGH | MEDIUM | LOW | OK
module: <module path>
file: <path>
line: <integer>
title: <one-line risk summary>
fix: <one-sentence recommended remediation>
sweep_date: <YYYY-MM-DD>
sweep_id: <14-char: YYYYMMDD + 6-hex, generate via `lattice sweep-id`>
auditor: claude-code/security-audit
# Required if tier in [CRITICAL, HIGH]:
owasp: A01..A10
exploitability: Remote-unauth | Remote-auth | Local-only
blast_radius: <one sentence>
attack_scenario: <one sentence — what an attacker does>
secure_code_example: |
  // BAD
  ...
  // GOOD
  ...
notes: <only if needed>
```

Skip the legacy multi-finding markdown file. The CLAUDE.md pre-deploy checklist is regenerated from these YAML files by `lattice sync` at end of sweep.

**sweep_id sourcing:** if invoked from `/audit-sweep`, use the sweep_id passed through. Standalone (`/security-audit src/modules/payments`) generates its own via `lattice sweep-id` and writes a manifest in Step 6b.

### Step 6b — Write sweep manifest (v0.6.7+, standalone runs only)

If standalone, emit `.lattice/findings/sweeps/<sweep_id>.yml` per `docs/finding-schema.md`:

```yaml
sweep_id: <id>
sweep_date: <YYYY-MM-DD>
project_root: <root>
modules_audited: [<module-path>]
dimensions: [security]
mode: SEQUENTIAL
auditor: claude-code/security-audit
auditor_model: <opus|sonnet|haiku>
duration_ms: <int>
totals: { CRITICAL: n, HIGH: n, MEDIUM: n, LOW: n, OK: n }
opened: [<slug>, ...]
unchanged: [<slug>, ...]
closed_since_last: [<slug>, ...]
regressed: [<slug>, ...]
skipped: <int>
runtime_warnings:
  - "<npm audit timeouts, ambiguous false-positive calls, etc.>"
```

If invoked from `/audit-sweep`, do NOT write a separate manifest.

### Step 7 — Draft checklist entries for deferred items
For every HIGH and every MEDIUM not fixed today, draft a checklist line ready to paste into `CLAUDE.md` "Pre-deploy security checklist" section. Format:

```
- [ ] <tier> (<module>): <one-line risk>. Fix: <recommendation>. Source: security-audit <date>.
```

Output as a fenced block. Do NOT write to CLAUDE.md or commit anything yourself.

### Step 8 — Stop and wait
Output the findings file path + verdict counts + drafted checklist block. Tell the user:

```
Security audit complete.
Findings:  .lattice/findings/open/
Manifest:  .lattice/findings/sweeps/<sweep_id>.yml
Verdicts:  <n> CRITICAL, <n> HIGH, <n> MEDIUM, <n> LOW, <n> OK
Skipped:   <n>

Inspect: lattice list --module <module> --dimension security | lattice show <id>
Sync the CLAUDE.md checklist: lattice sync

[fenced block of checklist lines]

Reply 'fix <id>' to address one finding, 'fix all critical' to triage CRITICALs in order, 'apply checklist' to add the drafted lines to CLAUDE.md and commit, or 'discuss' to review tradeoffs first.
```

## Anti-patterns (refuse to do these)

- ❌ Verdict without `file:line`
- ❌ Flagging a pattern without reading surrounding context (false positives in tests, guards/, scripts/)
- ❌ CRITICAL without an attack scenario
- ❌ Auto-applying security fixes — they need human review (a wrong fix can create a worse hole)
- ❌ Treating documented intentional public endpoints (`/r/:token`, webhook receivers) as CRITICAL "unguarded route"

## Tool usage

- **Grep**: pattern hunting (never Bash grep — Windows path issues)
- **Read**: context for every hit before assigning a verdict
- **Glob**: enumerate controllers/services in the module
- **Bash**: only for `git log` if checking when a risky pattern was introduced
- **Write**: only for the findings file in `.lattice/findings/`

## Output discipline

- No preamble. Start with "Security-auditing <module-path>..."
- One status line per pattern hunt batch
- Final output = findings file path + verdict counts + drafted checklist + next-action prompt
