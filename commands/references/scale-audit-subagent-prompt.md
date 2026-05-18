# scale-audit: Step 3 — pattern-hunt subagent prompt

Used when grepping for scale risks across a module. Load when N>=5 patterns to hunt (which is always for scale-audit's 7-pattern grid).

## Subagent dispatch prompt

If `oh-my-claudecode:executor` is installed, dispatch with this body. If not, run inline in the main session — same quality, ~60% more tokens.

```
Hunt scale-killer patterns in module <module-path>. For each pattern below,
run targeted Grep, then Read 20 lines of surrounding context for every hit
(filter false positives like test files, one-shot inits, CLI scripts).

Return JSON array per hit:
  { pattern: "<name>", file: "<path>", line: <n>,
    context: "<surrounding 5 lines>",
    false_positive: true|false }

Patterns (regex per row):
| Pattern | Regex |
|---|---|
| Periodic work | setInterval\|setTimeout |
| In-memory state | new Map\(\|new Set\(\|new WeakMap\( |
| Local file writes | fs\.\|writeFile\|appendFile\|createWriteStream |
| Sticky-session needs | WebSocket\|EventSource\|SSE |
| Boot-time background | OnModuleInit\|onApplicationBootstrap |
| Unbounded fan-out | Promise\.all\(.*map\( |
| Host assumptions | localhost\|127\.0\.0\.1 |

Mark false_positive=true for:
- Test files (*.spec.ts, *.test.ts)
- CLI scripts
- One-shot inits
- Anything inside try/catch where gracefully degraded
- Anything explicitly gated by leader-election or distributed lock
```

Use the JSON response as Step 4+ input.

## Why this dispatch exists

Pattern hunting + context reads = ~60% of total scale-audit tokens. Sonnet handles it as well as Opus. The fallback path runs the same prompt inline if OMC isn't installed.
