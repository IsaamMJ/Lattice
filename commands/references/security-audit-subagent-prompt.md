# security-audit: Step 3 — pattern-hunt subagent prompt

Load when running the full ~14-pattern security pattern hunt. Saves ~60% of audit tokens.

## Subagent dispatch

If `oh-my-claudecode:executor` is installed, dispatch with this body. Else run inline.

```
Hunt security risk patterns in module <module-path>. For each pattern, run
targeted Grep, then Read 30 lines of surrounding context for every hit.

Return JSON array per hit:
  { pattern: "<name>", tier: "CRITICAL"|"HIGH"|"MEDIUM"|"LOW",
    file: "<path>", line: <n>,
    context: "<surrounding 5 lines>",
    false_positive: true|false,
    fix: "<one-sentence remediation>" }

Patterns (with grep regex):

| Pattern | Grep |
|---|---|
| Unguarded routes | @Controller followed by @Get/@Post/@Put/@Patch/@Delete with no @UseGuards in same class — inspect each controller |
| Hardcoded secrets | api[_-]?key\|secret\|password\|token equals quoted string literal (not from env) |
| Missing signature verification | webhook controllers grep for x-hub-signature\|x-razorpay-signature\|hmac — verify usage matches |
| SQL injection | \$queryRaw\|\$executeRaw with template literal containing ${ |
| Eval / dynamic code | \beval\(\|new Function\(\|vm\.runInNewContext |
| Unbounded uploads | @UploadedFile\|multer without size/mime restriction |
| NODE_ENV-only auth | if.*NODE_ENV.*production with no other auth check around it |
| Timing-unsafe compare | signature.*===\|hmac.*=== |
| Missing rate limit | public controllers without @Throttle or ThrottlerGuard |
| Sensitive logging | this.logger.*(token\|secret\|key\|password\|fullName\|email\|phone) — check if raw |
| Permissive CORS | cors.*origin.*\*\|enableCors\(\) without explicit origin allowlist |
| IDOR | findUnique\|findFirst\|update\|delete by id with no userId match in where clause |
| Prompt injection | user input concatenated into systemPrompt\|messages without escaping |
| Tokens in URL | req\.query\.(token\|key\|jwt\|session) |
| Stack traces in errors | throw err\|res.status.*err\.stack\|exception.*message exposed in response |
| Server action no try/catch | files with `'use server'` (or under `app/**/actions/`) — exported `async function`/`export async` whose body `await`s without a top-level `try {`. An unhandled throw in a Server Action serializes to the client (leaking internals) or 500s the request with no graceful path. Flag each exported action lacking try/catch around its awaits. |

Mark false_positive=true for:
- Test files (*.spec.ts, *.test.ts)
- scripts/ files
- Files inside guards/ directory (which IS the auth layer)
- TODO comments

Provide a one-sentence fix recommendation per real hit.
```

## Step 3b — dependency CVE audit

After pattern hunt, run `npm audit --json` (or equivalent for the project's package manager) at project root. Parse for CRITICAL/HIGH advisories affecting this module's packages:

```yaml
pattern: vulnerable dependency: <package>@<version>
tier: CRITICAL  # if CVE severity ≥ 9.0
      HIGH      # otherwise
evidence: package-lock.json + npm audit advisory URL
fix: "upgrade to <fixed version>" or "no fix available — assess exposure"
```

If `npm audit` errors (registry timeout, etc.), note in `runtime_warnings` and continue.
