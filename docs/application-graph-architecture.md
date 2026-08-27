# OXE graph-first application architecture

Status: architectural direction for the first vertical slice. This document
defines the boundaries to implement and the questions that the Todo experiment
must answer. It does not claim that the graph-first pipeline is implemented.

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
  -> JavaScript, Prisma/SQL, CSS, tests, and deployment artifacts
```

Generated artifacts are disposable. A textual OXE projection may remain useful
for debugging, export, and advanced inspection, but it must not contain semantics
that are absent from the canonical graph.

## First supported application class

The first vertical slice is deliberately closed:

- browser UI with direct DOM output and fine-grained updates;
- JavaScript server operations;
- Prisma Postgres persistence;
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

## AI interaction protocol

The model-facing surface begins with two functions.

### `inspect`

`inspect` returns compact semantic projections rather than serialized graph
documents. It supports an application map, search, a node neighborhood, incoming
references, impact analysis, and UI-mode inspection.

An ordinary Todo projection may look like:

```text
TinyTodo r12

E1 Task
  F1 title: str required len 1..120
  F2 done: bool = false
  R1 owner -> User required default actor
  access owner: read update delete

Q1 myTasks: Task[] where owner=actor
O1 createTask(title) -> Task writes E1
O2 toggleTask(task) -> Task writes F2

V1 /tasks TasksPage auth
  Form1 create E1 [F1]
  List1 Q1
    CheckboxRow label=F1 checked=F2
    change -> O2
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

Each semantic node has a fingerprint derived from its content and referenced
public contracts. A mutation invalidates only the changed nodes and their incoming
impact closure. Full validation remains a release gate and periodic consistency
check.

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
8. Add server operation and Prisma Postgres lowering.
9. Generate and run the acceptance verification bundle.
10. Measure tokens, tool calls, compiler invalidation, and wall-clock latency before
    expanding the graph or mutation vocabulary.

Implementation should add language or runtime surface only when the vertical slice
demonstrates an irreducible semantic need.
