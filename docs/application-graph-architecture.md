# OXE graph-first application architecture

Status: implemented architectural direction for the graph, inspection, mutation,
lowering, in-memory execution, and first PostgreSQL persistence slices. Later
sections still identify work beyond the current Todo milestone.

## Product thesis

OXE is an application representation that AI can manipulate safely, not primarily
a programming language that humans or AI edit as source text.

The normalized application graph is the sole source of semantic truth. It spans
data, relationships, authorization, queries, operations, routes, UI, reactive
dependencies, standard UI modes, and executable verification. AI agents interact
with it through compact semantic inspection and mutation functions.

```text
human intent
  -> compact semantic inspection
  -> atomic typed graph mutation
  -> graph validation and impact analysis
  -> target-specific lowering
  -> JavaScript, PostgreSQL SQL, CSS, tests, and deployment artifacts
```

Generated artifacts are disposable. A textual OXE projection may remain useful
for debugging, export, and advanced inspection, but it must not contain semantics
that are absent from the canonical graph.

## First supported application class

The first vertical slice is deliberately closed:

- browser UI with direct DOM output and fine-grained updates;
- JavaScript server operations;
- OXE-generated PostgreSQL persistence on the Node runtime;
- Better Auth identity with request-scoped application context;
- a built-in authenticated `User` actor;
- entities, fields, relationships, constraints, and migrations;
- typed queries and mutations;
- owner- and role-based authorization;
- routes, layouts, forms, lists, and detail views;
- an OXE-owned accessible UI component registry;
- generated loading, empty, unauthorized, forbidden, not-found, and unexpected
  error modes; and
- database, API, authorization, and browser verification.

Multiple databases, native clients, arbitrary JavaScript, general plugins,
background jobs, and user-defined compiler targets are deferred until the Todo
slice proves the graph and mutation model.

## Canonical graph model

A concept receives a stable node identity when it is independently referenceable,
reusable, inspectable, or mutable. The initial stable node kinds are:

```text
app       feature   entity    field      relation
policy    query     operation route      view
element   service   invariant verification-flow
```

Small expressions, predicates, validation constraints, component properties, and
operation steps remain inline typed trees. Making every expression or UI leaf a
top-level node would increase inspection cost without improving semantic editing.

References resolve to stable semantic IDs rather than names or source locations.
A rename changes display metadata while preserving identity and all incoming
references. A relationship is one semantic object with two typed endpoints, not
two fields that can drift independently.

Built-ins such as `User`, generated IDs, timestamps, and standard UI primitives
exist as virtual semantic objects so agents can inspect and reference them without
depending on hidden compiler behavior.

## Initial type system

The Todo slice starts with a closed type vocabulary:

```text
String      Boolean     Integer      Decimal
Date        DateTime    Bytes        Url
Email       Id<Entity>  Enum         Record
Entity      List<T>     Optional<T>  Result<T, Outcomes>
```

There is no untyped `any` boundary. Entity IDs preserve their entity identity,
money is not represented as an unconstrained number, and browser/server
serialization is compiler-controlled.

The compiler validates graph-internal connections statically. URL parameters,
forms, HTTP requests, environment values, database JSON, webhooks, files, and
third-party responses receive generated runtime validation before their values
enter the typed graph.

Expected platform outcomes such as not-found and unauthorized become transparent
standard modes. Domain outcomes that require a product decision remain explicit.

The executable type boundary covers strings, booleans, finite numbers, bounded
integers, exact decimal strings, dates, date-times, base64 bytes, URLs, email
addresses, enums, entity IDs, entities, exact records, lists, optional values,
and typed result outcomes. One recursive validator is used at semantic runtime
boundaries; generated RPC contracts preserve null and union shapes without
coercion. PostgreSQL lowering maps integers to `BIGINT`, decimals to constrained
`NUMERIC`, dates to `DATE`, and collection/record/result values to `JSONB` while
retaining semantic types for post-read validation. Optional storage unwraps its
inner type and makes the column nullable. The lowered UI graph remains a distinct
projection: it does not acquire application-level types merely because the
semantic graph can express them.

## AI interaction protocol

The model-facing surface begins with two functions.

### `inspect`

`inspect` returns compact semantic projections rather than serialized graph
documents. It supports an application map, search, a node neighborhood, incoming
references, impact analysis, and UI-mode inspection.

An ordinary Todo projection may look like:

```text
TinyTodo r12
auth BetterAuth emailPassword signIn=/sign-in signUp=/sign-up

E1 Task
  F1 title: str required len 1..120
  F2 done: bool = false
  R1 owner -> User required default actor
  access owner: read update delete

Q1 myTasks: Task[] where owner=actor
O1 createTask(title) -> Task writes E1
O2 deleteTask(task) -> Task writes E1
O3 renameTask(task,title) -> Task writes F1
O4 toggleTask(task) -> Task writes F2

V1 /tasks TasksPage auth
  Form1 create E1 [F1]
  List1 Q1
    Form
      submit -> O3
      CheckboxRow label=F1 checked=F2
        change -> O4
      TextField label=Task title value=F1
      Button text=Save type=submit
      Button text=Delete type=button
        click -> O2
```

Short handles are revision-scoped aliases, not persistent graph identities. The
agent requests deeper context only when the current projection is insufficient.

### `mutate`

`mutate` accepts a base revision and one atomic batch of semantic operations. It
validates the complete proposed revision before committing it. Results created by
an earlier operation may be referenced later in the same batch.

```json
{
  "base": 12,
  "ops": [
    {
      "op": "field.add",
      "entity": "E1",
      "name": "priority",
      "type": { "enum": ["low", "normal", "high"] },
      "default": "normal",
      "as": "priority"
    },
    {
      "op": "form.field.add",
      "form": "Form1",
      "field": "$priority"
    },
    {
      "op": "list.display.add",
      "list": "List1",
      "field": "$priority"
    }
  ]
}
```

The response is a semantic diff and verification summary, not generated source:

```text
r13 committed

+ Task.priority: enum(low,normal,high)=normal
~ TasksPage.Form1 added priority
~ TasksPage.List1 displays priority

generated migration M13
checked graph types access migration
compiled affected subgraph
```

Mutation may precede inspection when a request is unambiguous. The engine asks for
disambiguation rather than guessing when names resolve to multiple objects.

The initial semantic operation vocabulary should remain small and domain-aware:

```text
entity.add       field.add/change/remove      symbol.rename
relation.add     policy.set/change             query.add/change
operation.add    route.add/change              ui.insert/remove/move
ui.bind          ui.action.set                 view.mode.override
verification.add
```

Primitive node, edge, and property mutation remains internal. Semantic operations
may lower to several primitive changes while preserving graph invariants.

The implemented expansion also accepts typed `semantic.add` and
`semantic.replace` operations for complete application semantic nodes plus
`app.replace` for the singleton application definition. These are still atomic:
the engine writes only to a private draft, validates the complete proposed graph,
and returns the original graph object when any node in the batch is invalid.
Specialized operations such as `field.add` remain preferable when their stronger
intent and multi-node lowering match the requested change.

## Persistence and revisioning

The first implementation uses embedded SQLite in WAL mode. SQLite is a local
transaction and indexing engine, not the semantic graph API.

The store needs:

- immutable graph revisions with parent IDs and content hashes;
- stable semantic node identities;
- compact node bodies;
- indexed incoming and outgoing edges;
- an ordered semantic mutation log;
- atomic compare-and-commit against a base revision;
- deterministic export; and
- undo by selecting or reverting revisions.

The compiler maps stable identities to dense integer handles and uses in-memory
adjacency indexes. A dedicated graph database is deferred unless measured
cross-application or distributed traversal requirements justify it.

Deterministic JSON is an export, debugging, fixture, and backup format. YAML may
be generated for explanation but is not canonical because it permits multiple
ambiguous textual representations.

The first store slice is exposed through the Node-only `@oxe/graph/store`
subpath. It persists canonical graph snapshots, dense semantic nodes, reference
edges, and ordered semantic operations in one SQLite transaction. Revisions and
their derived rows are database-enforced immutable; the mutable head is advanced
with a base-revision comparison, and undo restores prior semantic content as a
new revision without deleting history.

## Validation and compilation

Every mutation runs the minimum safe pipeline:

```text
resolve references
  -> validate operation arguments
  -> apply transaction in memory
  -> validate graph invariants
  -> infer and check types
  -> infer effects and capabilities
  -> validate expected outcomes and UI modes
  -> calculate incoming impact
  -> lower affected target graphs
  -> commit revision and generated artifacts
```

The application graph lowers into separate browser, server, database, style, and
verification graphs before artifacts are emitted. The lowered graphs are compiler
IRs, not additional user-facing languages.

### Opaque code and style extensions

The semantic model does not attempt to encode every JavaScript or npm API. It
models the boundary instead. `extensionModule` nodes identify revisioned opaque
assets by stable ID, normalized project-relative source path, exact source-byte
SHA-256, target (`browser`, `server`, or `universal`), format, and explicitly used
package specifiers. The digest makes the graph revision a complete declaration of
which opaque bytes it trusts without inflating compact inspection with source
text. A changed source cannot be built until a semantic mutation updates the
digest.

The CLI bundles browser and server targets independently and audits direct package
imports against both the module declaration and project `package.json`. Missing,
undeclared, version-mismatched, and declared-but-unused dependencies are errors.
Every project-local file reached by the bundle must also be a uniquely declared,
integrity-verified extension module with a compatible target; an entry cannot hide
an unpinned helper behind a relative import.
The browser target uses browser resolution, so Node built-ins and server-only
packages fail at build time. This is target isolation, not a security sandbox:
accepted extension code receives the authority of its generated browser or server
process and must be reviewed like ordinary application code.

`componentExtension` nodes describe the public prop schemas, emitted event names,
children policy, implementation export, and stable SSR custom-element tag. View
validation checks every binding against that contract. Browser lowering emits the
custom element without adding application concepts to `UiGraphV1`; a generated
registry loads each bundled implementation and calls `define(contract)` before the
generic view host renders or adopts it.

Capability adapters use the same module/export binding but remain server-only.
The provider-neutral capability contract stays semantic; SDK code and credentials
stay in the extension and host environment. Generated registries require
`invoke()`, and durable jobs additionally require graph and implementation
agreement on `jobId` idempotency.

`style` nodes own semantic custom-property tokens and named theme overrides.
They may reference browser CSS modules for selectors or third-party styles that
cannot be expressed as tokens. Token names, theme names, values, stylesheet
targets, and references are validated deterministically. The resulting CSS and
bundled source files are disposable projections.

The first browser lowering slice projects one application route's successful view
into the existing `UiGraphV1`. It emits revision-scoped dense semantic handles,
exact lowered-node provenance, async query resources, keyed rows, field-derived
form constraints, and deterministic direct-DOM input. Reachable queries and
operations lower to existing versioned server-function definitions and universal
async capabilities. Form submissions and keyed-row changes lower to typed async
procedures that preserve the authored positional contract, await the mutation,
and refresh route query resources only after success. The lowered UI graph's
optional event arguments capture values from a rendered collection scope without
embedding application entities or operations in UI-graph types. Generated,
empty, authorization, not-found, and error modes, server operation
implementations, and database access remain subsequent projection work.

The first executable host remains storage-independent and in memory. Records use
semantic field and relation ids internally; public query and operation results use
declared field names. Entity arguments are resolved by their semantic entity-id
field and reloaded before operation expressions run, so a browser cannot forge
ownership, current field values, or update targets. Query filters and policy rules
receive server-only user and active-context identity, relation ownership is
enforced before writes,
required relation invariants are checked at the state boundary, and failed
operations leave the host revision unchanged. `@oxe/server-functions` adapts the
compiler-emitted definitions into the ordinary registry and in-process transport
through its server-only `/application` subpath, keeping the semantic executor out
of browser RPC bundles. This proves the semantic execution and authorization
contract without coupling it to SQLite application data or a generated ORM client.

Operations may also declare a `workflow` body containing ordered, named
create/update/delete steps. Each step publishes one typed local that is available
only to later steps and the declared result expression. Validation rejects forward
or duplicate locals, entity/field mismatches, incompatible values, and result/output
mismatches. The memory host snapshots records, ID sequences, and revision before
execution; PostgreSQL uses one database transaction. Both therefore expose one
semantic revision on success and restore all database state on failure.

External services enter the graph as provider-neutral, versioned `capability`
contracts with exact method input records and typed outputs. An `invokeCapability` operation
must type-check every argument and declare a matching `externalCall` effect.
Runtime adapters receive only the contract ID/version, method, validated input,
and server execution context; SDKs and credentials never enter semantic state or
browser projections. A workflow may combine database steps with an explicit
`enqueueCapability` step and matching `jobEnqueue` effect. The memory host
snapshots the queue with record state; PostgreSQL inserts into its graph-owned
outbox table in the same transaction as the database writes. Workers claim jobs
with `FOR UPDATE SKIP LOCKED`, recover expired leases, and invoke adapters only
after commit. Delivery is intentionally at-least-once: every invocation carries
the stable job ID as an idempotency key plus the current attempt, and adapters
must declare and implement `jobId` idempotency. Runtime readiness validation
separately checks that queued capability bindings make that declaration, and a
conformance probe repeats the same job against a test provider while observing
its committed side-effect count. Graph retry policy supplies bounded exponential
backoff, symmetric jitter, and maximum attempts. Exhausted jobs enter an explicit
dead-letter state; server-only controls can inspect metadata and replay a job
without exposing its input or execution context. Provider error bodies are never
persisted.

OXE also exports optional provider-neutral recipes for email, object storage,
payments, realtime publishing, search, and webhook delivery. These are ordinary,
immutable capability nodes—not framework services or privileged types. A project
may instantiate a recipe, replace it with a custom contract, and bind any
conforming server adapter without putting an SDK, provider name, or credential
in semantic state.

`createPostgresApplicationJobWorker` is the first production polling boundary. It
runs one leased claim batch at a time, waits between polls, aggregates delivery
counts, isolates error observers, and uses a stable worker ID. Shutdown first
stops new polling and drains the active batch. If the configured timeout expires,
the worker aborts the active signal and leaves any unacknowledged row protected by
its lease so another worker can recover it later.
`createPostgresApplicationServerRuntime` composes that worker with generated RPC
contracts and bounded telemetry. Runnable application servers construct it only
after authentication and graph migrations succeed, then await its idempotent
close before either PostgreSQL pool closes. Signal handling first stops HTTP
acceptance and uses the same application close path.

The compiler makes worker ownership an explicit deployment projection. An
`embedded` application build emits `server/application.js`, whose runtime factory
owns the scheduled outbox worker. A `separate` build emits the same server factory
without polling plus an independently executable `server/worker.js`. The worker
entry starts only after `DATABASE_URL` is available and drains its active claim
batch on `SIGINT` or `SIGTERM` before closing the pool. Both entries load the
canonical generated `application/graph.json`; neither creates a second semantic
model. The artifact and CLI manifests record the selected topology and stable
entry paths so deployment tooling does not infer process ownership from source.

The generated server module is deliberately a backend runtime factory rather
than a universal HTTP listener. A deployment host still owns the HTTP adapter,
Better Auth integration, secrets, concrete capability adapters, migrations, and
request-to-`userId`/active-context resolution. Those concerns are runtime
bindings projected by the graph, not graph semantics.

Hosts can emit `oxe.application-trace-span.v1` records for semantic queries,
operations, and job runs. Spans contain only application/revision identity,
semantic IDs, duration, outcome, and a sanitized failure category; operation
inputs, outputs, user/session IDs, record IDs, and capability payloads are
excluded. The in-process collector derives deterministic aggregate counters and
timings from a bounded recent-span window. The development control plane exposes
only this sanitized telemetry, worker counters, and dead-letter metadata through a
server-to-server bearer-token boundary. The workspace revalidates and reconstructs
that response before returning it through its same-origin, Cloudflare
Access-compatible authorization boundary; tokens, job payloads, and execution
context never enter browser configuration. Replay is an explicit protected action.
Semantic mutation impact also has a stable compact text
explanation that lists exact changes followed by their transitive dependents for
AI review and revision interfaces.

The database lowering boundary starts storage-neutral. `@oxe/compiler`
projects validated application entities and fields into a distinct relational
schema IR while preserving semantic entity, field, and relation ids as durable
identity. Built-in actors remain explicit external entities instead of receiving
invented application fields. Generated ids and timestamps, defaults, nullability,
enum values, string constraints, primary keys, and both relation endpoints survive
the projection with canonical source provenance. A revision-to-revision planner
currently emits deterministic additive table, column, and relation operations.
It rejects destructive removal, stored-contract alteration, missing backfill
defaults for new required columns, unrelated applications, and non-forward
revisions. The Todo priority batch therefore lowers to one safe `column.add`
operation. The first target-specific emitter deterministically maps semantic IDs
to stable PostgreSQL schema, table, column, check, and foreign-key names. It emits
initial DDL and additive forward migrations without a Prisma schema or generated
Prisma client. `@oxe/postgres` applies checksummed migrations under a
per-application transaction advisory lock and records immutable history in
`_oxe_migrations`. Its Node `pg` host compiles exact parameterized queries and
create/update operations, fetches only declared fields, reloads entity inputs
authoritatively, and enforces graph policies at the storage boundary.

## Authentication and multi-tenant context

Better Auth owns login methods, sessions, accounts, and credentials. Application
membership remains ordinary graph-owned data unless an application deliberately
adapts an external membership provider. OXE does not mint sessions or accept a `userId`
from operation input. The server converts Better Auth's verified session to an
`ApplicationExecutionContextV1` containing `userId`, optional `sessionId`, and an
ordered `activeContexts` role chain. Each resolved entry contains a stable context
role ID, the role's entity ID, and the selected record ID.

Active context is request-scoped rather than process-global or necessarily
session-global. A browser selects `{ contextId, recordId }`; it never asserts the
entity type or authorization result. Stable context-role nodes declare their
target entity plus one or more authorization methods. `anyOf` composes direct
actor ownership with membership entities whose member/resource relations and
typed field conditions are validated structurally and semantically. Optional
parent-role edges describe arbitrary DAGs
such as Organization → Team → Project. The server reloads direct ownership or
membership and every parent-child relation before returning resolved context.
This permits two browser tabs to work in different projects safely.

A context may also declare a string `labelField`. The PostgreSQL runtime uses the
same authorization methods to list deterministic context options without a
domain-specific `myTeams` or `myOrganizations` query. Selection discovery and
selection verification therefore share one graph contract.

Applications list available roles in `app.contexts`. Multiple roles may target
the same entity type because authorization meaning belongs to the role, not the
entity. Parent roles must precede children in this canonical list.
`relationEqualsContext` policies and `activeContext` create defaults bind records
to a declared role. Missing, duplicate, undeclared, cyclic, incorrectly ordered,
and relation-incompatible contexts fail validation or authorization.
Organization, team, project, membership, and any application-specific hierarchy
remain ordinary semantic entities and relations rather than framework columns.
Every personalized cache key includes `userId` and the complete resolved role
chain, and mutations invalidate dependencies inside the same scope.

Cross-record uniqueness is an application-graph concern, not a handwritten SQL
escape hatch. A `unique` semantic node names one stored entity and an ordered set
of stored field or relation keys. Validation rejects unresolved, repeated,
external, or wrong-entity keys. Database lowering preserves its stable semantic
ID, PostgreSQL emits a deterministic named constraint, and the additive migration
planner can add—but not silently remove or rewrite—the constraint. The compact
inspection projection exposes the constraint through the same short field and
relation handles used for the entity body.

References to built-in or provider-owned entities remain external to OXE's
application schema. The PostgreSQL host accepts a server-only existence resolver
and checks graph-declared external references before a create transaction. The
Todo host resolves `builtin.user` against Better Auth's `auth.user` table, so an
invitation cannot create an orphaned membership while auth storage stays owned by
Better Auth.

The first browser projection implements that contract as generated, strictly
typed clients. Query dependencies and mutation invalidation sets are derived from
semantic query selections, scalar predicates, filters, ordering, and operation
effects. Each query declares `memory(maxAgeMs)` or `no-store`; absent policy keeps
the 30-second compatibility default. Equal in-flight reads deduplicate; writes
advance per-query invalidation generations so an older
in-flight read cannot repopulate the cache. The generated async factory first
loads `/api/context`, whose server resolves the Better Auth cookie and any
untrusted `x-oxe-active-contexts` selection through the application's membership
resolver. Only the verified `userId` and ordered context chain return to the
browser; server-only `sessionId` does not. The client derives its immutable cache
scope internally and propagates the verified chain on every RPC. Switching scope
creates a separately bootstrapped client and therefore cannot reuse another
user's or project's cache entries. This is intentionally private browser memory,
not a shared HTTP or server cache for personalized records.

Only execution metadata is embedded in the generated module. Compiler-facing
method metadata, read sets, parameter schemas, and provenance paths stay in the
manifest projection instead of being duplicated in browser JavaScript. Runtime
record validation uses exact own-key membership checks without sorting response
keys.

Generated loading projections resolve the view's loading mode through explicit
view-to-view or application-default inheritance. A direct generated mode wins.
Its optional `skeleton.rows` hint (bounded to 1–8) controls representative rows,
and `skeleton.elements` may override a same-view semantic element with a
`block`, `control`, or `text` shape and `short`, `medium`, or `full` width.
References, ownership, and inheritance cycles are validated before projection.
Without hints, each query-bound collection contributes one inert row described
by its actual component tree. Hosts still own visual tokens and responsive
layout; mutation refreshes retain already-visible data rather than replacing it
with a skeleton.

The browser host now consumes a compact generated view projection rather than a
Todo-specific DOM implementation. It interprets the declared component tree,
forms, repeat bindings, operation arguments, authentication routes, context roles,
and standard empty/loading/unauthorized/forbidden/not-found/error modes. Function
metadata assigns each reachable query or mutation to an account- or context-role
client module. The loader statically exposes those modules through dynamic imports,
so the initial account surface does not eagerly load Team and owner-only contracts.
Response schemas are interned within each generated client artifact.

Better Auth may share the PostgreSQL server through its documented `pg` adapter,
but its auth tables and migrations remain provider-owned. OXE's compiler and
migration ledger own only application-graph tables, keeping auth upgrades out of
semantic application migrations.

TinyTodo exercises the complete membership lifecycle without making Team a
framework primitive. An owner creates one pending membership per `(member,
team)`, the invited user alone may accept it, only accepted memberships authorize
the generic Team context, and the owner may revoke either pending or active
membership. Generated clients derive invitation-query invalidation from the same
operation effects and query dependencies.

The Node-only `@oxe/auth` package now instantiates this boundary with Better Auth
email/password accounts, explicit programmatic provider migrations, cookie-session
resolution, and optional validated active-context resolution. Its PostgreSQL
integration test exercises sign-up, sign-out, sign-in, generated Todo Fetch RPC,
per-user reads/creates, and cross-user update denial with separate `auth` and
`oxe_todo` schemas.

Each semantic node has a fingerprint derived from its content and referenced
public contracts. A mutation invalidates only the changed nodes and their incoming
impact closure. Full validation remains a release gate and periodic consistency
check.

## Agent protocol and disposable artifacts

`oxe.application-agent-request.v1` is the first strict agent-facing transport
contract. Every request carries an application ID, caller request ID, and exactly
one discriminated operation. Inspection can return the compact map, revision
history, one indexed semantic node with incoming/outgoing edges, all incoming
references, or bounded semantic search results. Preview runs a typed mutation
batch against the current immutable head and returns diagnostics, impact closure,
the derived artifact plan, and a deterministic preview fingerprint without
publishing a revision. Commit may require that fingerprint, then uses the SQLite
store's compare-and-swap head update so a concurrent edit cannot commit a stale
review.

Successful commits publish only disposable compiler projections. The first real
artifact cache emits a shared executable browser host, transport/cache runtime,
lazy account/context client facets, client manifest, browser views, routes,
PostgreSQL schema and migration descriptor, server-function contract, verification
contract, and one fingerprinted artifact manifest. Application builds additionally
emit the canonical graph projection and executable PostgreSQL/HTTP server entries;
separate worker deployments emit a standalone worker entry. At the CLI production
boundary, logical browser modules are bundled, minified, split, and named by
content hash. A deterministic asset manifest records each deployed path, byte
count, and SHA-256 integrity; the Node host serves only those enumerated assets
with immutable caching while keeping HTML uncached. The logical modules remain
available for inspection and debugging, but are not public URLs. The artifact
cache reuses unchanged content across revisions and removes artifacts that no
longer have a semantic source. The normalized graph and immutable revision history
remain authoritative if cache publication fails; artifacts can be regenerated
from the committed revision.

Development publication now separates three states that previously moved
together: the committed graph head, a staged artifact/runtime candidate, and the
active last-good revision. `ApplicationPublicationManager` serializes candidates,
builds their projections, and passes them through an isolated adapter boundary
for migration rehearsal and runtime startup. Only a successful `activate()` swaps
the active snapshot; build, migration, runtime-start, or activation failures keep
all workspace artifact routes pinned to the previous revision. Failed candidates
are disposed, successful candidates dispose the superseded runtime after the
swap, and a versioned publication-state projection reports the active/candidate
revisions and precise failure stage. The graph commit intentionally remains in
history when publication fails so it can be inspected, corrected, or superseded.

The adapter contract is the portability boundary, not a second source of truth.
The Node workspace implementation builds every candidate through the production
CLI, creates a disposable PostgreSQL database, applies the generated migration,
copies bounded development data by foreign-key order, boots and health-checks a
generated Node runtime, and only then atomically switches the application target.
Its last-good pointer is written atomically and recovered on workspace restart.
Failed builds, migrations, and startups remove their candidate directory and
database; superseded runtimes are stopped only after activation succeeds.

The artifact manifest also embeds an
`oxe.application-runtime-requirements.v1` projection. It deterministically lists
the PostgreSQL, Better Auth, context-role, route, and capability-adapter bindings
required by the revision. Hosts can validate concrete bindings before startup and
receive stable `OXE3501` diagnostics instead of discovering missing production
adapters on the first user request.

`ApplicationDevelopmentSession` is the local Node composition boundary. It owns
the revision store, protocol adapter, artifact cache, and publication coordinator
while keeping the browser-safe compiler entry free of SQLite. The development
workspace exposes this contract over its authenticated same-origin transport and
does not gain a second mutation path.

## Reactive browser output

The compiler owns Solid-like fine-grained semantics without depending on Solid.
It should specialize statically known dependencies into direct JavaScript and DOM
updates. The internal runtime handles only irreducibly dynamic behavior such as:

- batching;
- dynamic dependency changes;
- keyed collection reconciliation;
- asynchronous resources and cancellation;
- ownership and disposal;
- dynamic context lookup;
- navigation, hydration, and error propagation.

The existing `@oxe/runtime` and `@oxe/runtime-dom` packages provide a starting
point. Their APIs are compiler targets, not the application authoring model.
Runtime helpers must be independently importable and tree-shakable. The compiler
may inline a helper when measurement shows that doing so reduces total output.

## UI registry and transparent modes

The initial OXE-owned component registry includes only what the Todo slice needs:

```text
Page Stack Heading Text Button TextField CheckboxRow
Form List Skeleton EmptyState ErrorState
```

Every primitive defines typed properties, event contracts, accessibility
behavior, theme tokens, loading projection, server-rendering rules, and direct-DOM
lowering.

Views have semantic modes:

```text
loading       empty          unauthorized
forbidden     notFound       error
```

The compiler generates standard modes from the successful UI and operation
contracts. Overrides are semantic graph mutations. Override precedence is:

```text
call site -> component/view -> nearest layout -> application -> platform default
```

Transparent standard outcomes must not hide domain decisions such as card
declines or out-of-stock conflicts. Those remain explicit typed outcomes.

## Performance objective

Optimize successful semantic changes per model token and second, not the visual
compactness of one serialization format.

The primary costs are:

1. context supplied to the model;
2. model and tool round trips;
3. invalid mutations and correction turns;
4. graph validation and compilation scope; and
5. unnecessary generated output returned to the model.

The common edit target is one compact projection, one batched semantic mutation,
one incremental compiler transaction, and one concise verified result.

Every protocol experiment should measure:

```text
input/output tokens       tool calls          correction turns
mutation success rate     invalid mutations   inspection calls
wall-clock latency        compiler time       affected node count
```

A shorter protocol is not an improvement if it lowers mutation accuracy or
requires more retries.

## Todo vertical-slice acceptance

The canonical fixture is `examples/application-graph-todo/graph.json`. The first
vertical slice must prove:

1. Compile the initial Todo graph into a runnable authenticated application.
2. Inspect it through the compact projection without reading generated files.
3. Add `Task.priority` to the entity, form, and list in one mutation transaction.
4. Generate a safe database migration and only affected application modules.
5. Reject binding `Task.done` to a text-only component property.
6. Rename `Task.title` without searching or rewriting textual references.
7. Prevent one user from reading or toggling another user's task.
8. Report incoming references before removing a field.
9. Override only the Tasks view loading mode.
10. Undo the priority revision and restore the prior graph and output.

The end-to-end verification bundle must include graph, type, migration, database,
API, authorization, browser, accessibility, and deterministic-build checks.

## Implementation sequence

1. Freeze the existing textual language work as a reusable compiler/runtime proof.
2. Define strict TypeScript graph and semantic-operation unions.
3. Validate and load the Todo JSON fixture into an in-memory graph.
4. Implement revision-scoped handles and the compact `inspect` projection.
5. Implement transactional in-memory `mutate` for the priority acceptance case.
6. Add SQLite revision, node, edge, and mutation persistence.
7. Lower the graph into the existing UI graph/runtime for the first browser slice.
8. Add server operation host implementations, storage-neutral relational
   lowering, direct PostgreSQL emission, migration execution, and OXE-owned clients.
9. Bind Better Auth sessions to `userId` and validated multi-tenant context.
10. Generate and run the acceptance verification bundle.
11. Measure tokens, tool calls, compiler invalidation, and wall-clock latency before
    expanding the graph or mutation vocabulary. The controlled trial collector
    rejects malformed or duplicate records and reports task-by-arm coverage; local
    representation proxies are never presented as provider trial results. Its first
    provider harness uses the Responses API behind a replaceable adapter, keeps task
    assertions in an isolated held-out evaluator, deterministically randomizes the
    three representation arms, and records exact provider usage in resumable JSONL.

Implementation should add language or runtime surface only when the vertical slice
demonstrates an irreducible semantic need.
