# audit: Step 4 — subagent verification prompt

Used by `/audit` to dispatch the claim-verification step to a Sonnet subagent (cost optimization). Loaded only when the audit reaches Step 4 with N>=5 claims.

## When to load

- Loading this file is justified when claim count is high enough that running verification inline would dominate token usage.
- For audits with <5 claims, run verification inline and skip this file.

## Subagent dispatch prompt template

If `oh-my-claudecode:executor` is installed:

```
Verify these <N> doc claims against the codebase. For each claim, use
Read/Grep/Glob (never Bash grep — Windows path issues). Return a JSON
array, one entry per claim, schema:

  { claim: "<text>", verdict: "OK" | "DRIFT" | "UNCLEAR",
    evidence: "file:line or 'not found'" }

Claims:
1. <claim text> — type: file-path | symbol | behaviour | env-var | dependency
2. ...

Verification methods (per claim type):

| Claim type | Method |
|---|---|
| file path | Glob for the path |
| function/export | Grep for the symbol definition |
| behaviour | Read the cited code and confirm |
| env var | Grep for the var name |
| dependency | Read package.json / equivalent |

Return UNCLEAR (not DRIFT) when evidence is genuinely ambiguous — main
session will run tracer on those.
```

Wait for the subagent's JSON response. Use it as Step 5+ input.

## Fallback (OMC not installed)

Run the same prompt inline in the main session. Same methodology, ~60% more tokens. No quality difference.

## Why this dispatch exists

Step 4 (claim verification) is ~60-70% of total audit tokens. Sonnet handles it as well as Opus for this specific workload. OMC's executor was the dispatch mechanism, but the prompt body is what matters — that's reproduced above so the audit works standalone.
