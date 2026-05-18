# flow-audit: Step 3 — pattern-hunt subagent prompt

Load when running the full 10-pattern customer-flow audit. Saves ~60% of audit tokens.

## Subagent dispatch

If `oh-my-claudecode:executor` is installed, dispatch with this body. Else run inline — same quality.

```
Audit customer flow completeness in module <module-path>. For each pattern
below, run targeted Grep or Read, then check context to filter false positives.

Return JSON array per hit:
  { pattern: "<name>", tier: "CRITICAL"|"HIGH"|"MEDIUM"|"LOW",
    file: "<path>", line: <n>,
    context: "<surrounding 5 lines>",
    gap_description: "<what's missing>",
    false_positive: true|false }

Patterns to hunt (with method):

| # | Pattern | Method |
|---|---|---|
| 1 | Happy path | grep main request handler + response; complete path entry→processing→response? all steps tested? |
| 2 | Error handling | grep try/catch, .catch, error middleware; for each external call (API/LLM/DB), error caught + handled? |
| 3 | State validation | grep state transitions, status changes, step progression; transitions validated? can skip steps? |
| 4 | Type checking | grep typeof, instanceof, schema validation; does input type match expectations (text vs image)? |
| 5 | Exit paths | grep cancel, abort, exit, close; can user exit at each step, or some trapped? |
| 6 | Abandonment timeout | grep setTimeout, TTL, timeout, expiry; timeout on idle conversations? |
| 7 | Cleanup | grep delete, cleanup, expire, prune; abandoned/stale sessions cleaned up? |
| 8 | State notifications | grep emit, publish, broadcast, notify; state changes → customer/system notified? |
| 9 | Multi-turn context | grep context, history, memory, previous; customer's context preserved across turns? |
| 10 | Concurrency | grep race, concurrent, parallel, atomic; state writes protected against concurrent requests? |

Mark false_positive=true for:
- Test files (*.spec.ts, *.test.ts)
- Mocks
- Intentional one-shot operations
```
