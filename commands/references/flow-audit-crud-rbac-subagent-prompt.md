# flow-audit: Step 3 — pattern-hunt subagent prompt (crud-rbac pack)

Load instead of `flow-audit-subagent-prompt.md` when the resolved stack profile
is `crud-rbac` (see [stack-profiles.md](stack-profiles.md)). Same ~60% token
saving; different grid — the conversational one does not apply (#129).

The derived sets go INTO the prompt. The sub-agent must not re-derive `ROLES`,
the scope lattice, the action set or the state graph — a sub-agent that
re-derives them drifts from the parent's profile and the findings contradict.

## Subagent dispatch

If `oh-my-claudecode:executor` is installed, dispatch with this body. Else run
inline — same quality.

```
Audit CRUD/RBAC flow completeness in module <module-path>. For each pattern
below, run targeted Grep or Read, then check context to filter false positives.

Resolved stack profile (do NOT re-derive — use these sets as given):
  app_type:      crud-rbac
  render_model:  <server-components+actions | ssr-pages | ...>
  auth_model:    <clerk-org-roles | nextauth-session | ...>
  ROLES:         [<role>, ...]           # + scope depth per role
  scope lattice: <org > department > user>
  SCOPE(model):  <model> -> <fk chain>, ...
  action set:    <file:line exported server action>, ...
  STATES(model): [<state>, ...] with edges <from -> to @ file:line>
  terminals:     [<state>, ...]

Return JSON array per hit:
  { pattern: "<slug>", tier: "CRITICAL"|"HIGH"|"MEDIUM"|"LOW",
    dimension: "flow"|"security",
    file: "<path>", line: <n>,
    context: "<surrounding 5 lines>",
    gap_description: "<what's missing>",
    affected_roles: ["<role>", ...],     # groups A and B
    false_positive: true|false }

Patterns to hunt (with method):

| # | Pattern | Method |
|---|---|---|
| 1 | scope-filter-missing | for each query on a model with non-empty SCOPE: does the `where` pin the chain or a schema-declared @id/@unique? Trace `where` objects built in variables/helpers. SKIP hits already reported by `lattice audit-core --rule missing-tenant-filter` |
| 2 | scope-filter-shallower-than-role | deepest scope node the query pins vs the scope depth of every role that reaches the call site; role deeper than query = hit |
| 3 | scope-value-from-client-input | trace each scope-key value back to its source; formData/searchParams/params/body/client prop = hit unless re-derived from session and compared |
| 4 | scope-lost-across-relation-hop | for each `include`/`select` of a relation and each child query by parentId: does the child's scope chain pass through the scoped parent? |
| 5 | aggregate-ignores-scope | pair count/aggregate/groupBy/raw SQL with the list query on the same route; scope chains must match |
| 6 | mutation-guard-ui-only | for each action in the action set: gate in body? gate in export wrapper? middleware matcher provably covering its route (READ middleware.ts config)? none = hit |
| 7 | control-rendered-but-action-rejects | build (ui_predicate, server_predicate) per action, evaluate over ROLES; ui=true & server=false = hit |
| 8 | gate-predicate-drift | normalize both predicates to role SETS and compare; different expressions with equal sets today still = hit |
| 9 | action-reachable-from-no-route | actions in the set with zero importers in the route tree |
| 10 | transition-missing-from-state-guard | edges whose from-guard is empty (no status predicate in `where`, no early-return check, no switch arm). UI-only ordering does not count |
| 11 | transition-guard-not-atomic | guarded edges where the checked state is not re-asserted in the write (`updateMany` where-clause / transaction / version column) |
| 12 | transition-role-matrix-incomplete | per non-terminal state, union roles that can fire any outgoing edge; empty (or platform-only) union = hit |
| 13 | state-unreachable-or-absorbing | states with no incoming edge; states with no outgoing edge not in `terminals` |
| 14 | derived-state-no-manual-override | for each derived status: can any action write its inputs back? derived terminal with no path back = hit |
| 15 | derived-state-diverges-from-stored | status both computed at render and persisted as a column |
| 16 | route-missing-error-boundary | per page.tsx that awaits: nearest error.tsx below root, or a try/catch with a rendered fallback |
| 17 | route-missing-loading-state | page.tsx containing `await` with no sibling loading.tsx and no enclosing <Suspense fallback> |
| 18 | list-render-no-empty-state | `.map(` renders with no length===0 / ternary / early-return branch; filtered views need their own |
| 19 | scoped-record-not-found-renders-shell | detail routes whose scoped findFirst/findUnique null branch is missing (no notFound()) |

Mark false_positive=true for:
- Test files (*.spec.ts, *.test.ts), fixtures, seed scripts
- Storybook / mock data modules
- Admin-only tooling explicitly documented as platform-scope (cite the doc line)
- Single-tenant models (SCOPE empty) for patterns 1-5
- Route-state patterns (16-19) in api-only modules

Every CRITICAL/HIGH needs: impact (how the operator/user experiences it) and
example_failure (concrete: which role, which route, what they see).
```

## Why this dispatch exists

Groups A-C are set comparisons — role sets, scope chains, transition graphs —
not greps. Handing the sub-agent the derived sets turns each rule into a
mechanical check it can complete without re-reading the schema, which is both
cheaper and the reason two dispatches agree with each other.
