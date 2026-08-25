# CRUD + RBAC flow rule library (v2.8.0, #129 #135)

Patterns the `flow` dimension hunts when the resolved stack profile is
**`crud-rbac`** — a server-rendered CRUD app with role-based access (Next.js
App Router + Server Actions, Clerk / NextAuth roles, multi-tenant Prisma).
This grid **replaces** the conversational grid in `commands/flow-audit.md` for
that profile; it does not supplement it. "Abandonment timeout not set",
"multi-turn context lost" and "accepts image when expecting text" have no
referent in a request/response CRUD app, and hand-translating them into SaaS
patterns is the work the rule library exists to remove (#129).

Calibrated for: role + tenant + department scoping, UI-vs-server permission
parity, server-enforced state-machine ordering, derived state, per-route
loading / empty / error states.

Each rule has slug + pattern + tier + detection + example failure. Same schema
as `audit-cli-tool-rules.md`.

**Prerequisite.** The role universe (`ROLES`), scope lattice (`SCOPE(M)`), the
Server-Action set and the state graph (`STATES(M)`) come from
[stack-profiles.md](stack-profiles.md) Probes 2-5 — parsed from the schema and
the route tree, not from identifier spelling. A rule whose input set is
undeclared is **not fireable**: file `role-universe-undeclared` or
`state-universe-undeclared` (MEDIUM) instead of guessing the set.

## Risk grid

### CRITICAL — data crosses a boundary, or a record cannot move

| Pattern | Why |
|---|---|
| Query on a scoped model returns rows outside the caller's scope depth | A department-scoped role reads company-wide data; silent, no error, looks like a working page |
| Scope value read from client input instead of the session principal | Caller supplies another tenant's id and the query obliges |
| Mutation whose only permission gate is in the UI | Server Actions are public POST endpoints — hiding the button hides nothing |
| State transition applied without asserting the from-state | Out-of-order transitions corrupt the record (approve → submit, refund before charge) |
| Auto-derived state with no manual override path | Record parks in a state nothing can move it out of; support has no lever |

### HIGH — role sees a control it cannot use, or the flow silently dead-ends

| Pattern | Why |
|---|---|
| Control rendered for a role whose server action rejects it | User clicks, gets an error or a no-op; nothing in the UI says why |
| UI gate and server gate use non-equal predicates for the same permission | Two sources of truth drift on the next role added |
| Scope lost across a relation hop (`include` / child query by parent id) | Parent is scoped, child rows are not |
| Aggregate / count / dashboard tile omits the scope filter | Totals leak the shape of other tenants' data even when rows don't render |
| Transition guard is read-then-write across `await` | Two approvals race; last write wins, guard passed for both |
| No role in `ROLES` can move a record out of state `S` | Matrix hole — records accumulate in `S` forever |
| Route segment with no error boundary | One thrown server component takes the whole segment to the framework error screen |

### MEDIUM — fragile, or the flow is confusing rather than broken

| Pattern | Why |
|---|---|
| Exported server action reachable from no route | Undocumented public endpoint; no UI means no review either |
| Derived status computed at render *and* stored in the DB | UI shows one value, the server acts on the other |
| State with no outgoing edge that is not a declared terminal | Absorbing state nobody intended |
| State with no incoming edge | Dead enum member — either unreachable flow or a removed feature |
| Route segment with no loading state | Blank frame on every navigation; reads as broken on slow links |
| List render with no empty branch | New tenant sees a bare page with no explanation of what to do |
| Detail route that renders a shell instead of calling `notFound()` | Missing (or out-of-scope) record looks like an empty record |

### LOW — note in checklist

| Pattern | Why |
|---|---|
| Permission decision not logged on deny | No forensics when a role complains it "can't do X" |
| Role universe declared but a role has zero gate sites | Either dead role or an entirely ungated one — worth one look |

## Rules

### Group A — scoping (role + tenant + department)

#### `scope-filter-missing`

**Pattern:** A read or write on a model whose `SCOPE(M)` is non-empty, with a
`where` that pins neither a scope chain nor a primary/unique key.

**Tier:** CRITICAL (writes) / HIGH (reads) — `dimension: security`

**Detection:** `lattice audit-core --rule missing-tenant-filter` owns the
statically-decidable shape and already suppresses `where` clauses pinned on a
schema-declared `@id`/`@unique` (#195). **Run it first and do not re-file its
hits.** File only what it cannot see: a `where` object built in a variable or
helper, assembled by spread, or passed through a repository function — trace the
call, then file.

**Example failure:** `prisma.invoice.findMany({ where: buildFilters(params) })`
where `buildFilters` never adds a scope key; every tenant's invoices render.

**Fix shape:** Scope at the boundary — a session-derived `where` fragment merged
last, or a Prisma extension / RLS policy that cannot be forgotten per call site.

#### `scope-filter-shallower-than-role`

**Pattern:** Query filters at a *higher* scope node than the caller's role is
bound to. `SCOPE(M)` is `org > department`, the query pins `organizationId`
only, and the role's scope depth (Probe 3) is `department`.

**Tier:** CRITICAL — `dimension: security`

**Detection:** For each scoped query, take the deepest scope node it pins. For
each role in `ROLES` that can reach the call site, take its scope depth. Any
role deeper than the query's deepest pinned node is a hit. This is a comparison
between two derived sets — do not approximate it by looking for the word
`department` in the `where`.

**Example failure:** A department manager opens *Team reports* and sees every
department's rows, because the handler scopes on `organizationId` and the page
never narrows further. No error, no empty state, nothing looks wrong.

**Fix shape:** Derive the `where` from the principal's full scope chain, not
from its top node. One helper per model that returns the chain for the current
session; forbid hand-written scope fragments in call sites.

#### `scope-value-from-client-input`

**Pattern:** A scope key whose value comes from `formData`, `searchParams`, the
request body, a route param, or a client component prop — rather than from the
server-side session/principal.

**Tier:** CRITICAL — `dimension: security`

**Detection:** For every scope key in the lattice, trace the assigned expression
backwards to its source. A route param is only safe when the same handler
re-derives the scope from the session and compares. `params.orgId` matching a
cookie the client also controls is not a comparison.

**Example failure:** `POST` to a Server Action with `orgId` swapped in the form
payload; the action writes into another tenant.

**Fix shape:** Scope keys are server-derived, always. Client-supplied ids are
inputs to a lookup that is *itself* scoped, never to the scope filter.

#### `scope-lost-across-relation-hop`

**Pattern:** A scoped parent query that `include`s or `select`s a child
relation whose own `SCOPE(child)` is not implied by the FK chain from the
parent — or a child query by `parentId` where the caller's ownership of the
parent is never established.

**Tier:** HIGH — `dimension: security`

**Detection:** Walk Probe 4's FK graph. The hop is safe only if the child's
scope chain passes *through* the parent. Otherwise the parent's filter proves
nothing about the child rows.

**Example failure:** `document.findMany({ where: { projectId } })` where the
project belongs to another department; the id came from a URL the user
guessed or kept from a previous role.

**Fix shape:** Scope the child on its own chain, or resolve the parent through
a scoped query first and reuse its verified id.

#### `aggregate-ignores-scope`

**Pattern:** `count` / `aggregate` / `groupBy` / raw dashboard SQL missing the
scope filter that the corresponding list query has.

**Tier:** HIGH — `dimension: security`

**Detection:** Pair every list query with the tiles rendered on the same route.
The scope chains must match. Aggregates are frequently written later, by hand,
against the same model — that is where they diverge.

**Example failure:** "Open tickets: 412" on a department dashboard whose list
shows 6 — the tile counts the whole company.

**Fix shape:** Aggregate through the same scoped query builder as the list.

### Group B — UI ↔ server parity

#### `mutation-guard-ui-only`

**Pattern:** A Server Action (or route handler) in the Probe 2 action set that
performs a mutation with no permission assertion in its own body or in a
wrapper it is provably called through — while the UI that exposes it is gated
by role.

**Tier:** CRITICAL

**Detection:** For each action in the set, look for the gate in this order:
(1) an explicit check in the body, (2) a `withRole(...)` / `authorize(...)`
wrapper at the export, (3) middleware whose `matcher` provably covers the
action's route — read `middleware.ts`'s config, don't assume it covers
everything. None of the three = hit. A gate in the calling component does not
count; the action is reachable without it.

**Example failure:** `deleteProject` is only rendered for `OWNER`, but any
member can POST the action directly with a project id.

**Fix shape:** Authorization belongs in the action, expressed once
(`can(session, 'project:delete', project)`), with the UI reading the *same*
predicate.

#### `control-rendered-but-action-rejects`

**Pattern:** The reverse mismatch — the UI renders a control for a role whose
server action throws / returns forbidden for that role.

**Tier:** HIGH

**Detection:** Build the predicate pair per action: `ui_predicate` (the
condition that renders the control) and `server_predicate` (the condition the
action enforces). Evaluate both over `ROLES`. Any role where
`ui_predicate = true` and `server_predicate = false` is a hit.

**Example failure:** An analyst sees *Approve*, clicks it, gets a red toast
saying "Something went wrong" — the action requires `MANAGER`. Nothing tells
them the button was never theirs.

**Fix shape:** Render from the same predicate the server enforces; when a
control must stay visible, render it disabled with the reason.

#### `gate-predicate-drift`

**Pattern:** The same permission expressed by two non-equal predicates
(`role === 'ADMIN'` in the UI, `role !== 'VIEWER'` in the action).

**Tier:** HIGH

**Detection:** Normalize both predicates over `ROLES` into role sets and
compare. Equal sets today with different expressions is still a hit — the next
role added lands in exactly one of them.

**Example failure:** `AUDITOR` is added to the enum; it inherits every
mutation gated as `!== 'VIEWER'` while every UI gated as `=== 'ADMIN'` stays
hidden. The hole ships silently.

**Fix shape:** One permission map (or policy function) imported by both sides.
The predicate is data, not two copies of an expression.

#### `action-reachable-from-no-route`

**Pattern:** An exported Server Action with no call site in the route tree.

**Tier:** MEDIUM

**Detection:** Cross the Probe 2 action set with importers. Zero importers and
still exported = a public POST endpoint with no UI. Distinguish from dead code:
`'use server'` exports stay reachable over the wire even with no caller.

**Example failure:** A superseded `bulkImport` action from a removed admin page
remains callable, with the old (looser) role check.

**Fix shape:** Delete it, or keep it and gate it like any other entry point.

### Group C — server-enforced state machine

#### `transition-missing-from-state-guard`

**Pattern:** A write that sets the status column with no assertion of the
current state in the same path — no status predicate in the `where`, no
early-return check, no `switch` arm.

**Tier:** CRITICAL

**Detection:** From Probe 5's edge list, every edge whose `from-guard` is empty.
Ordering enforced only in the UI (the button that isn't rendered yet) does not
count — the action is reachable directly.

**Example failure:** `markPaid` succeeds on an invoice still in `DRAFT`; the
record is now paid-but-never-issued, and no later step can repair it.

**Fix shape:** Encode allowed `from → to` pairs in one table, assert against it
in the action, and make the write conditional on the from-state.

#### `transition-guard-not-atomic`

**Pattern:** Guard and write are separated by an `await` — read the record,
check its status, then update by id.

**Tier:** HIGH

**Detection:** For each guarded edge, check whether the checked value is
re-asserted in the write itself (`updateMany({ where: { id, status: FROM } })`,
a transaction, or a version column). If not, the guard is advisory.

**Example failure:** Two managers approve the same request in the same second;
both reads see `PENDING`, both writes land, two approval side effects fire.

**Fix shape:** Make the write conditional (`updateMany` with the from-state in
`where`, then assert `count === 1`), or take the check inside a transaction.

#### `transition-role-matrix-incomplete`

**Pattern:** A non-terminal state `S` for which no role in `ROLES` has a
reachable, permitted transition out.

**Tier:** HIGH

**Detection:** Cross the transition graph with the per-action role predicates.
For each non-terminal state, union the roles that can fire any outgoing edge.
Empty union = hit. Union containing only a role that does not exist in the
tenant's own membership (e.g. a platform-only `SUPERADMIN`) = the same hit in
practice — say so in `impact`.

**Example failure:** Requests in `NEEDS_INFO` can only be advanced by the
requester, but the requester's role loses edit rights once the request leaves
`DRAFT`. Everything entering `NEEDS_INFO` stops there.

**Fix shape:** Complete the matrix, or declare `S` terminal and stop routing
records into it.

#### `state-unreachable-or-absorbing`

**Pattern:** A member of `STATES(M)` with no incoming edge (unreachable), or
with no outgoing edge while not declared terminal (absorbing).

**Tier:** MEDIUM

**Detection:** Graph properties of Probe 5's edge list. Declared terminals come
from the schema comment, the TTD, or an explicit terminal set in code — an
undeclared sink is the finding.

**Example failure:** `ARCHIVED` was added to the enum for a feature that
shipped without its un-archive path; archived records cannot return.

**Fix shape:** Add the missing edge, or remove the enum member and migrate.

### Group D — derived state

#### `derived-state-no-manual-override`

**Pattern:** A status derived from data (dates, counts, a computed column) with
no action in the set able to set it directly, where at least one derived value
is a dead-end for the flow.

**Tier:** CRITICAL

**Detection:** Probe 5 marks derived statuses. For each, ask whether any action
can write the underlying inputs *back* — an `expiresAt` in the past with no
extend action, a `completedCount >= total` with no reopen. No path back = hit.

**Example failure:** A submission auto-flips to `EXPIRED` at the deadline. There
is no extend, no reopen, and no admin override — the only remedy is a manual
DB edit, and support finds that out from the customer.

**Fix shape:** Every derived terminal gets an explicit, role-gated override
action, and the override is part of the state graph — not a script.

#### `derived-state-diverges-from-stored`

**Pattern:** The same status both computed at render time and persisted in a
column, with no single source of truth.

**Tier:** MEDIUM

**Detection:** Find render-time derivations of a status that also exists as a
column. The two disagree the moment a write updates one and not the other.

**Example failure:** The list badge computes `OVERDUE` from `dueDate`; the
action's guard reads `status = 'ACTIVE'` and permits an edit the UI presents as
locked.

**Fix shape:** Pick one — derive everywhere (and guard on the derivation), or
persist everywhere (and recompute on write).

### Group E — per-route loading / empty / error states

#### `route-missing-error-boundary`

**Pattern:** A route segment whose page or layout awaits data with no
`error.tsx` in the segment or any ancestor below the root, and no try/catch
producing a rendered fallback.

**Tier:** HIGH

**Detection:** Walk the segment tree from each `page.tsx` upward. Record the
nearest boundary. Root-only coverage means one failed query blanks the whole
app shell.

**Example failure:** A scoped query throws for a role with no rows and no
permission; the user gets the framework error page with a digest hash and no
way back.

**Fix shape:** `error.tsx` per feature segment with a retry, and a distinct
`forbidden` path for permission errors.

#### `route-missing-loading-state`

**Pattern:** A segment with an async server component and neither `loading.tsx`
nor a `<Suspense fallback>` around the awaited subtree.

**Tier:** MEDIUM

**Detection:** Pair each `page.tsx` containing `await` with the presence of a
sibling `loading.tsx` or an enclosing `Suspense`.

**Example failure:** Navigation appears to do nothing for two seconds on a
slow connection; users click again and double-submit downstream.

**Fix shape:** `loading.tsx` per data-fetching segment, skeleton matching the
loaded layout.

#### `list-render-no-empty-state`

**Pattern:** A list render (`.map(...)`) with no zero-length branch.

**Tier:** MEDIUM

**Detection:** For each list render, look for a `length === 0` / ternary /
early-return branch in the same component. Filtered views need their own —
"no results for this filter" is not "nothing here yet".

**Example failure:** A newly-invited department opens the workspace to a page
with a header and nothing else; nothing says what to create first.

**Fix shape:** Explicit empty state per list, distinguishing never-had-any from
filtered-to-zero.

#### `scoped-record-not-found-renders-shell`

**Pattern:** A detail route whose scoped lookup can return `null` and which
renders a shell (or crashes on a property access) instead of calling
`notFound()`.

**Tier:** MEDIUM

**Detection:** Every detail page with a scoped `findFirst`/`findUnique`. The
null branch must be explicit. Note that with scoping applied, "not found" and
"not yours" are the same branch — that is correct and intentional; say so in
the finding rather than recommending a distinct 403.

**Example failure:** A user who lost department access opens a bookmarked
record and sees an empty form that saves into nothing.

**Fix shape:** `if (!record) notFound()` immediately after the scoped lookup.

## Anti-patterns (do not file)

- Re-filing what `lattice audit-core --rule missing-tenant-filter` already
  reported. Run the deterministic pass first; this pack covers what it cannot
  statically see.
- Filing scoping rules against a `single-tenant` profile (Probe 4 found no scope
  root). There is no boundary to cross.
- Filing `mutation-guard-ui-only` without reading `middleware.ts`'s `matcher`.
  Middleware coverage is a real gate — check it before claiming there is none.
- Filing UI-parity rules from one side only. Both predicates, evaluated over
  `ROLES`, or it is a guess.
- Any conversational-pack row ("abandonment timeout", "multi-turn context")
  retargeted at a CRUD app by analogy. If it needs translating, it is the wrong
  pack — re-resolve the profile.
- Route-state rules against `api-only` / `worker-api` modules. No route tree, no
  loading state.

## Output

```yaml
dimension: flow          # security for Group A — see each rule's Tier line
rule: <slug-from-this-doc>
rule_pack: crud-rbac     # optional (v2.8.0) — groups findings by the pack that produced them
```

**Required extras by tier** (regen rejects the YAML otherwise):

| Rule group | Dimension | CRITICAL / HIGH need |
|---|---|---|
| B, C, D, E | `flow` | `impact` + `example_failure` |
| A | `security` | `owasp` (A01 for scoping/IDOR, A04 for the derived-state dead-end when filed as security), `exploitability`, `blast_radius`, `attack_scenario`, `secure_code_example` |

Optional evidence fields this pack adds — free-form, tolerated by the parser,
useful when triaging by role rather than by file:

```yaml
affected_roles: [MEMBER, VIEWER]      # roles the gap is reachable for
scope_path: org > department          # the chain the query should have pinned
transition: SUBMITTED -> APPROVED     # for Group C
```
