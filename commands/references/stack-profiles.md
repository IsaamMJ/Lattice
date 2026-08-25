# Stack profile detection + rule-pack selection (v2.8.0, #129 #135)

Every audit skill hunts a fixed rule grid. That was fine while the grids were
generic — until the `flow` grid, which was written against a conversational
WhatsApp/LLM bot ("abandonment timeout", "multi-turn context lost", "accepts
image when expecting text"). Pointed at a server-rendered CRUD app with
role-based access, none of those rows have a referent, and the operator ends up
translating chatbot patterns into SaaS patterns by hand — which is the work the
rule library was supposed to do (#129).

The fix is not a second grid bolted onto flow-audit. It is a **resolution step
that runs before any hunt, in every skill**: detect what kind of application
this is, from artifacts on disk, then load the rule packs calibrated for it
(#135).

Load this file at Step 0 of `/flow-audit`, `/security-audit`, `/scale-audit`,
and at Step 1 of `/audit-sweep`. Resolve the profile ONCE per invocation and
pass it into every sub-agent dispatch.

## What a profile is

A profile is seven fields, each carrying its own `file:line` evidence. Same
discipline as a finding: **no field without an artifact**.

| Field | Values (open set) | Evidence must be |
|---|---|---|
| `app_type` | `crud-rbac` \| `conversational` \| `cli-tool` \| `worker-api` \| `mobile-client` | a manifest entry + a route/handler shape |
| `render_model` | `server-components+actions` \| `spa-client-fetch` \| `ssr-pages` \| `api-only` \| `message-handler` | the route tree on disk |
| `auth_model` | `clerk-org-roles` \| `nextauth-session` \| `custom-jwt` \| `supabase-rls` \| `none` | the middleware / session call site |
| `role_source` | `prisma-enum` \| `ts-union` \| `zod-enum` \| `provider-metadata` \| `undeclared` | the declaration, parsed (never a grep for `"admin"`) |
| `tenancy` | a scope lattice, e.g. `org > department > user` \| `single-tenant` | the FK graph of the data schema |
| `data_layer` | `prisma` \| `drizzle` \| `supabase` \| `raw-sql` \| `none` | the schema file + client import |
| `state_source` | `prisma-enum` \| `ts-union` \| `string-literals` \| `none` | the status enum declaration |

Plus `confidence: high | medium | low` — `high` only when every field that the
selected pack depends on resolved from evidence.

## Resolution order

First hit wins, per field — not per profile.

| Rank | Source | Notes |
|---|---|---|
| 1 | `.lattice/config.yml` → `app_profile:` block | Operator override. Always wins; never re-derive a field the operator pinned |
| 2 | `lattice context` / `.lattice/invariants/HEAD.yml` → `stack:` | Coarse (`flutter`, `node`, `supabase`). Narrows the probe set; **never decides `app_type` alone** |
| 3 | Probes 1-5 below | Artifact evidence |
| 4 | nothing resolved | **Ask the user once.** Do not guess, and do not fall back to the conversational pack because it used to be the default |

Operator override shape:

```yaml
# .lattice/config.yml
app_profile:
  app_type: crud-rbac
  render_model: server-components+actions
  auth_model: clerk-org-roles
  role_source: prisma-enum
  tenancy: org > department > user
  data_layer: prisma
  state_source: prisma-enum
```

`tenant_keys:` stays a separate flat line — `scripts/lattice-tenant-scan.mjs`
reads it with a single-line regex, so it must not move inside this block.

## Probes

Each probe reads an artifact. None of them match on identifier spelling: a
model called `Organization` and one called `Workspace` are found the same way,
by their position in the schema graph.

### Probe 1 — dependency manifest → framework set

Read the manifest as data (`package.json` `dependencies` + `devDependencies`,
`pubspec.yaml`, `go.mod`, `pyproject.toml`). Do not grep the lockfile — a
transitive copy of `next` is not a Next.js app.

| Manifest entry | Contributes |
|---|---|
| `next` | `render_model` candidate (Probe 2 decides which) |
| `@clerk/nextjs` \| `@clerk/clerk-sdk-node` | `auth_model: clerk-org-roles` candidate |
| `next-auth` \| `@auth/*` | `auth_model: nextauth-session` candidate |
| `@prisma/client` + `prisma/schema.prisma` | `data_layer: prisma` |
| `drizzle-orm` \| `@supabase/supabase-js` | `data_layer` accordingly |
| `express` \| `@nestjs/core` \| `hono` \| `itty-router` with no route tree | `app_type: worker-api` candidate |
| `telegraf` \| `whatsapp-web.js` \| `@slack/bolt` \| `openai` + a message handler | `app_type: conversational` candidate |
| `commander` \| `yargs` \| a `bin` field | `app_type: cli-tool` candidate |

A framework is a *candidate* until a shape probe confirms it. `next` +
`openai` + a single `app/api/chat/route.ts` is a conversational app that
happens to be built on Next.js — Probe 2 and Probe 3 are what separate it from
a CRUD SaaS.

### Probe 2 — route tree → render model + mutation surface

Glob, don't guess:

| Shape on disk | Concludes |
|---|---|
| `app/**/page.tsx` + `app/**/layout.tsx`, ≥3 segments | `render_model: server-components+actions`; `app_type: crud-rbac` candidate |
| Files containing a top-of-file `'use server'`, or `app/**/actions/*.ts` | Mutation surface = Server Actions. Enumerate every exported `async function` — **this list is the audited action set** |
| `app/**/route.ts` \| `pages/api/**` | Mutation surface = route handlers; add them to the action set |
| `pages/**/*.tsx` + no `app/` | `render_model: ssr-pages` |
| A single message/webhook entry point and no route tree | `render_model: message-handler`; `app_type: conversational` |
| `bin/` entry + no HTTP surface | `app_type: cli-tool` |

Record the action set with `file:line` per action. Group B rules in the
crud-rbac pack are defined over it.

### Probe 3 — role universe (parse the declaration)

The role universe is a **declared set**. Find the declaration and parse it, in
this order — stop at the first that exists:

1. `prisma/schema.prisma` (or `prisma/schema/*.prisma`, or `$LATTICE_PRISMA_SCHEMA` —
   same resolution `scripts/lattice-tenant-scan.mjs` uses): `enum Role { ... }`,
   `enum UserRole { ... }` — any enum whose values are referenced by a field on
   the principal model. Members are the role universe.
2. TypeScript: `export const ROLES = [...] as const`, `type Role = 'A' | 'B'`,
   `z.enum([...])`.
3. Auth-provider metadata: Clerk `orgRole` / `publicMetadata.role` write sites,
   NextAuth `session` callback assignments, Supabase custom claims.

If none exists, set `role_source: undeclared` and **file it** —
`role-universe-undeclared` (MEDIUM, flow) — then hunt Group B with the roles
observed at gate sites, marked `confidence: low`. Never assemble a role
universe by grepping for the string `admin`: a role that only ever appears in
one forgotten branch is exactly the one whose permission holes matter.

Also record, per role, its **scope depth** — the narrowest scope node the role
is bound to (Probe 4's lattice). Sources: the field the session carries
(`user.departmentId`), the Clerk org/membership shape, or the permission map if
one exists. Roles whose scope depth cannot be resolved are `confidence: low`
input to `scope-filter-shallower-than-role`.

### Probe 4 — tenancy: build the scope lattice from the schema graph

The reporter's headline bug class is "company-wide data reaching a
department-scoped role". Deciding that needs the containment order of the
scope models, and that order is *in the schema* — so derive it, don't assume
`orgId` is the only scope key.

From `prisma/schema.prisma` (same file resolution as Probe 3):

1. Parse every `model`: scalar fields, `@relation` fields with their FK
   scalars, `@id` / `@unique` fields, and whole `@@id([...])` / `@@unique([...])`
   composites. (This is the same schema read `lattice-tenant-scan.mjs` does for
   #195 — reuse its conclusions rather than re-deriving where they overlap.)
2. Build the directed FK graph: `M --requiredFk--> N`.
3. **Scope roots** = models with high in-degree of *required* relations that
   themselves depend on no other scope root (a container nothing contains).
   Typically one; more than one means parallel tenancy — record all.
4. **Scope lattice** = the chain of required FKs among the scope models
   themselves (`Department.organizationId -> Organization` gives
   `org > department`). Append `user` if the principal model carries a required
   FK into the lattice's deepest node.
5. **`SCOPE(M)`** for any model `M` = the shortest chain of required FK hops
   from `M` to each scope node. That chain — not a name list — is what a query
   on `M` must pin, directly or through a join, to be scoped.
6. Emit the flat scope-key set as `tenant_keys:` input so the deterministic
   `lattice audit-core --rule missing-tenant-filter` pass and the LLM pass agree
   on the same keys.

Single scope root with no second level → `tenancy: org`. No scope root at all →
`tenancy: single-tenant`, and Group A rules do not fire (do not file
"missing tenant filter" against a single-tenant app).

### Probe 5 — state universe + transition graph

1. **States**: `enum Status { ... }` / `enum <Model>State { ... }` in the schema,
   or the TS union / `z.enum` backing a status column. `STATES(M)` = its members.
2. **Edges**: every write that sets that column — `status: X` inside
   `update`/`updateMany`/`create` in the action set from Probe 2. Each write is
   an edge `(from-guard, to-state, action, file:line)`, where `from-guard` is
   the state asserted in the same code path before the write (a `where` clause
   on the status column, an early `if (record.status !== ...) throw`, or a
   `switch` arm). **No guard = no from-state**, which is rule
   `transition-missing-from-state-guard`, not a missing edge.
3. **Derived state**: a status that is *computed* at read time (from dates,
   counts, or another column) rather than stored. Record the deriving expression
   and whether any action in the set can write the column directly — that
   override, or its absence, is Group D.

The graph feeds Group C: sinks, unreachable states, and per-role reachability
are graph properties, not greps.

## Profile → rule packs

| `app_type` | flow pack | Also load | Skip |
|---|---|---|---|
| `crud-rbac` | [flow-audit-crud-rbac-rules.md](flow-audit-crud-rbac-rules.md) | `security` grid + `core/missing-tenant-filter` pass | the conversational grid in `commands/flow-audit.md` |
| `conversational` | the grid in `commands/flow-audit.md` (Pack A) | `security` grid (prompt-injection rows) | Group A/B/E of the crud-rbac pack |
| `worker-api` | Pack A error/state rows only | [audit-abuse-rules.md](audit-abuse-rules.md) | UI-parity rules (no UI) |
| `cli-tool` | Pack A error/state rows only | [audit-cli-tool-rules.md](audit-cli-tool-rules.md) + abuse | scoping + route-state rules |
| `mobile-client` | Pack A | `security` grid | Server-Action rules |
| `unknown` | — | — | ask the user once, then re-resolve |

An app can be two things (a CRUD SaaS with a support chatbot). Resolve
`app_type` **per module**, not per repo, when module boundaries disagree —
`/audit-sweep` already enumerates modules before dispatch, so the per-module
profile rides in the dispatch brief.

## Emitting the profile

1. **Banner** — before the first hunt, one line, no preamble:
   `Profile: crud-rbac / server-components+actions / clerk-org-roles / org > department > user (confidence: high) — pack: crud-rbac`
2. **Dispatch** — include the resolved profile *and* the derived sets
   (`ROLES`, scope lattice, `STATES`) in every sub-agent brief. A sub-agent that
   re-derives them will drift from the parent.
3. **Manifest** — pass through `lattice write-manifest --warnings` as
   `"stack-profile: <app_type>/<auth_model>/<tenancy> (confidence: <c>)"`, so a
   later sweep can see which pack produced the findings.
4. **Findings** — optional `rule_pack: crud-rbac` field (see
   [flow-audit-finding-schema.md](flow-audit-finding-schema.md)).
5. **Low confidence** — say so in the banner and recommend the operator pin
   `app_profile:` in `.lattice/config.yml`. Do not silently proceed at `low`.

## Anti-patterns (refuse)

| ❌ | Why |
|---|---|
| Deciding `app_type` from the repo name, README prose, or a directory called `chat/` | Prose is not an artifact |
| Treating `next` in `package.json` as `crud-rbac` | Probe 2 + 3 decide; a Next.js chat app is `conversational` |
| Assembling the role universe by grepping for `admin` / `owner` / `member` | The forgotten role is the one with the hole — parse the declaration (Probe 3) |
| Assuming `orgId` is the scope key because the default `tenant_keys` list says so | Probe 4 derives `SCOPE(M)` from the FK graph; the default list is a fallback for schema-less repos |
| Running the conversational grid on a `crud-rbac` profile "to be safe" | That is exactly #129 — the operator pays in translation |
| Re-deriving the profile inside each sub-agent | Resolve once, pass down; divergent profiles produce contradictory findings |
