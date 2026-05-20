---
description: Audit a module for security exposures — auth gaps, signature bypass, secret leaks, IDOR, injection vectors, OWASP basics. Use when the user asks "is this secure?", wants a security review, invokes `/security-audit <module>`, or mentions auth/secrets/CORS/CSRF/IDOR/injection concerns.
argument-hint: <module-path>
allowed-tools: Read Grep Glob Bash
---

Target module to audit: $ARGUMENTS

## Live Lattice state (auto-injected at invocation)

!`lattice context 2>/dev/null || echo "(lattice context unavailable)"`

# security-audit

Auditing for **security exposures** — patterns that allow unauthorized access, data leaks, financial abuse, or signature bypass. Findings get severity tiers + remediation guidance with `file:line` evidence.

## Why this skill exists

Scale audits catch what breaks under load. Security audits catch what an attacker (or misconfigured caller) exploits. For a backend handling payments + messaging + healthcare data, a single auth gap or signature bypass = financial loss + compliance breach + CEO incident.

## Risk patterns

### CRITICAL — fix today

| Pattern | OWASP | Why critical |
|---|---|---|
| Controller route with no `@UseGuards`, no signature verification, no `NODE_ENV !== 'production'` gate | A01 | Anyone on the internet can hit it |
| Hardcoded secrets (API keys, JWT secrets, passwords) in source | A02 | Leaks via git, logs, CI artifacts |
| Webhook handler missing signature verification, or verifying after side effects | A08 | Forged webhooks = forged payments/events |
| Raw SQL via `$queryRaw\`...${userInput}...\`` (template-string interpolation) | A03 | SQL injection |
| `eval`, `new Function`, `vm.runInNewContext` on user input | A03 | Arbitrary code execution |
| File upload with no size limit, MIME check, or extension allowlist | A04 | DoS + malware vector |
| Auth gated by `NODE_ENV` only (no auth in dev, assumes prod env always set) | A05 | Misconfigured prod = open admin |
| Webhook signature comparison with `===` instead of `crypto.timingSafeEqual` | A02 | Timing attack on signature |
| Path traversal: `fs.readFile`/`fs.createReadStream` on user-supplied path with no allowlist | A01 | Read arbitrary server files |
| `yaml.load` / unsafe deserialize on user input | A08 | Code execution via deserialization |

### HIGH — fix this week

| Pattern | OWASP | Why |
|---|---|---|
| Public endpoint with no rate limiter (`@Throttle` / `@nestjs/throttler` missing) | A04 | Brute-force, scraping, cost abuse |
| Sensitive data in logs (tokens, payment IDs, full PII, request bodies) | A09 | Log aggregator becomes the breach |
| CORS allowing `*` origin in production | A05 | CSRF vector |
| Endpoint reads/writes resource by ID without checking caller owns it (IDOR) | A01 | One user reads another user's data |
| User input concatenated into LLM system prompts (prompt injection) | A03 | Hijacked agent behavior |
| Bearer tokens / session IDs in URL query params instead of headers | A02 | Leaks via referer + logs |
| `Math.random()` or `Date.now()` for tokens, IDs, password resets | A02 | Predictable — use `crypto.randomBytes` / `crypto.randomUUID` |
| Outbound HTTP to user-supplied URL with no allowlist (SSRF) | A10 | Internal-network probing, metadata-service exfil |

### MEDIUM — fix when convenient

| Pattern | Why |
|---|---|
| `helmet` missing or default-only (no CSP, HSTS) | Browser-side hardening gap |
| Error responses returning stack traces or DB error details | Information disclosure |
| Long-lived JWT/session tokens with no rotation | Stolen token = long-term access |
| Sensitive operations (refund, role change, delete) without audit log | No forensics post-incident |
| Open redirect: `res.redirect(req.query.next)` without allowlist | Phishing assist |

### LOW — note in checklist

| Pattern | Why |
|---|---|
| Verbose error messages on auth failure (`user not found` vs `wrong email`) | Account enumeration |
| Missing security headers beyond helmet basics | Hardening only |

## Methodology

### Step 1 — Load living truth

| Source | Why |
|---|---|
| `CLAUDE.md` | Documented auth patterns, signature rules, "intentional public endpoint" notes |
| Module's TTD doc | Constraints capturing security rules ("NEVER call X outside Y") |

### Step 2 — Map the module

List every controller, service, guard, and middleware. Identify:
- All HTTP routes (controllers + decorators)
- All webhook handlers
- All admin/test endpoints
- Any guard / signature-verification middleware

### Step 3 — Hunt patterns

Run targeted Grep for each pattern in the risk tables above. For each hit, **Read 30 lines of surrounding context** to filter false positives (test files, scripts/, guards/ which IS the auth layer, TODO comments).

**For the full ~14-pattern grid**: load [references/security-audit-subagent-prompt.md](references/security-audit-subagent-prompt.md) — Sonnet subagent dispatch saves ~60% of tokens. Also covers Step 3b (npm audit for CVEs).

### Step 4 — Cross-check against TTD/CLAUDE.md

For each hit, check if TTD/CLAUDE.md documents it as intentional. Examples:
- `/r/:token` is intentionally public (share-link) → not CRITICAL "unguarded route", but flag HIGH "missing rate limit + cache" if those gaps exist
- Test endpoint already gated behind `NODE_ENV !== 'production'` → OK, not CRITICAL

If documented intentional, downgrade tier or mark `OK` with citation.

### Step 5 — Assign verdicts

| Verdict | Means | Required evidence |
|---|---|---|
| **CRITICAL** | Exploitable today by external caller, fix immediately | `file:line` + attack scenario + fix |
| **HIGH** | Real risk under realistic misuse / compromise, fix this week | `file:line` + scenario + fix |
| **MEDIUM** | Hardening gap, fix when convenient | `file:line` + fix |
| **LOW** | Note in checklist, no urgency | `file:line` |
| **OK** | Pattern checked, intentional/safe with citation | `file:line` + CLAUDE.md/TTD line justifying it |

**Hard rule — every CRITICAL/HIGH gets:**

1. **OWASP category** (A01-A10) tagged on the finding
2. **Exploitability** label: Remote-unauth / Remote-auth / Local-only
3. **Blast radius**: 1 sentence on what an attacker gains
4. **Attack scenario**: 1 sentence (e.g. "attacker POSTs forged Razorpay webhook → credits added without payment")
5. **Remediation timeline** (CRITICAL=24h, HIGH=1wk, MEDIUM=1mo, LOW=backlog)
6. **Secure code example** as BAD/GOOD blocks in the file's language

**OK-finding discipline:** Emit `tier: OK` findings for security patterns checked-and-found-safe (`OK-payments-webhook-uses-timingsafeequal`, `OK-admin-routes-guarded`). First-class output — prevents re-flagging the same patterns. Each OK requires `intentional_citation`.

### Step 6 — Write findings + manifest

Load [references/security-audit-finding-schema.md](references/security-audit-finding-schema.md) for the exact YAML schema + required fields by tier.

**sweep_id sourcing:**
- Invoked from `/audit-sweep` → use the sweep_id passed through
- Standalone → generate via `lattice sweep-id` and write a manifest

### Step 7 — Draft checklist for deferred items

For every HIGH and every MEDIUM not fixed today, draft a checklist line ready to paste into `CLAUDE.md` "Pre-deploy security checklist":

```
- [ ] <tier> (<module>): <one-line risk>. Fix: <recommendation>. Source: security-audit <date>.
```

Output as a fenced block. **Do NOT write to CLAUDE.md or commit yourself.**

### Step 8 — Stop, await direction

```
Security audit complete.
Findings:  .lattice/findings/open/
Verdicts:  <n> CRITICAL, <n> HIGH, <n> MEDIUM, <n> LOW, <n> OK

Inspect: lattice list --module <module> --dimension security | lattice show <id>
Sync CLAUDE.md checklist: lattice sync

[drafted checklist block]

Reply 'fix <id>' / 'fix all critical' / 'apply checklist' / 'discuss'.
```

## Anti-patterns (refuse)

| ❌ | Why |
|---|---|
| Verdict without `file:line` | Mandatory evidence |
| Flagging without reading surrounding context | False positives in tests/, guards/, scripts/ |
| CRITICAL without attack scenario | Required field |
| Auto-applying security fixes | Need human review — wrong fix = worse hole |
| Treating documented intentional public endpoints as CRITICAL "unguarded route" | CLAUDE.md/TTD intentional-citation wins |

## Tool usage

| Tool | Used for |
|---|---|
| Grep | Pattern hunting (never Bash grep) |
| Read | Context for every hit before verdict |
| Glob | Enumerate controllers/services |
| Bash | Only `git log` / `npm audit --json` |
| Write | Only findings YAML in `.lattice/findings/` |

## Output discipline

- No preamble. Start with "Security-auditing <module-path>..."
- One status line per pattern hunt batch
- Final output = findings path + verdict counts + drafted checklist + next-action prompt

---

After running: `lattice list` / `lattice next` / `lattice sync` to manage findings.
