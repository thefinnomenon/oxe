# Server rendering boundary

OXE's first server backend is intentionally a reference implementation, not the
final deployment architecture. It proves that the existing semantic graph can
render without the DOM and establishes the contract that later JavaScript, Rust,
streaming, and hydration work must preserve.

## Implemented pipeline

The pipeline has three separate stages:

1. `@oxe/compiler` produces the versioned `UiGraphV1` semantic graph.
2. `@oxe/runtime-server` lowers that graph into `ServerRenderPlanV1`.
3. The synchronous JavaScript backend interprets v1 and writes ordered HTML chunks
   to a host-provided sink. `renderToString` is a small string-sink wrapper.
4. For v2, a backend preparation step expands template ids into request-local
   resource and region instances. The portable readiness executor deduplicates
   equal identities, starts the resulting requests, and writes patches as their
   exact consumers become ready.

The render plans are plain JSON data. They contain stable semantic ids, component
contracts, value expressions, context providers, choices, keyed collections,
captured content, HTML nodes, capability contracts, and explicit component render
boundaries. They contain no JavaScript functions, closures, reactive runtime
objects, DOM nodes, or host-global references.

Version 1 boundaries are all `blocking`, and execution is explicitly
`synchronous`. Delivery is still expressed as ordered chunks so the sink boundary
does not need to change when a later plan version adds deferred regions. Version
2 now records the smallest text, attribute, and structural consumers derived from
async lineage, their underlying resource ids, stable markers, readiness delivery,
and batching policy. Its portable scheduler is implemented. The initial
JavaScript adapter expands component and keyed-row occurrences into request-local
resource ids, document markers, and render closures. It reveals keyed rows from an
async collection, folds same-resource consumers inside a structural reveal into
that patch, and dynamically registers additional resources and regions exposed by
the reveal.

## Async and hydration contracts now implemented

- `kind: "async"` platform capabilities lower ordinary assignments into explicit
  async-resource graph and server binding nodes.
- Canonical capability, argument, and scope identities deduplicate requests.
  Consumer ownership aborts the final pending request, identity changes ignore
  stale completions, and `refresh(value)` retains ready data.
- Ready resource checkpoints serialize into inert `application/json` state and
  restore the client coordinator before generated hydration creates resources,
  avoiding a duplicate request.
- The generated browser artifact exposes an eager hydration entry. Matching DOM
  is adopted by identity and receives live bindings without replacement. Exact
  mismatch errors and controlled replacement recovery are tested for the current
  non-structural adoption slice. Conditional and keyed regions adopt content
  between compiler-owned comment boundaries.
- Stream patches are inert `<template>` payloads for replacement or attribute
  work. A fixed inline observer applies them in readiness order, ignores obsolete
  tokens, supports multiple independently deferred attributes on one element,
  and captures early click/input metadata for hydration. Its CSP SHA-256 digest
  is pinned by test; the current bootstrap measures 791 bytes gzip.
- Pending text uses an inline inert skeleton, pending attributes preserve their
  element while exposing `aria-busy`/`data-oxe-pending`, and pending structural
  choices or collections use compiler-derived geometry. Structural skeletons
  hide branch copy, disable controls, and collections render one representative
  row until the real keyed values arrive.
- Compiler and server output share stable event-target ids. Eager hydration
  attaches every generated listener first, then replays matching captured clicks
  and inputs in their original order while retaining unmatched events.
- The readiness executor expands backend-prepared runtime instance ids separately
  from compiler template ids, so repeated component and keyed-row instances can
  keep distinct document markers while still sharing an equal request identity.
- A completed region may register resources and regions newly exposed by its
  patch. The executor writes the enclosing patch first, then schedules that work
  with the same deduplication, cancellation, error, batching, and checkpoint rules.
- Independent resources race without source-order head-of-line blocking. Regions
  sharing a resource reveal in one batch, a configurable short window coalesces
  nearby completions, every sink write is awaited, caller cancellation aborts all
  outstanding loads, and the original typed failure reaches the global error hook.
- The JavaScript adapter executes only async resources with actual rendering
  consumers, canonicalizes their captured capability arguments, keeps static
  siblings in the shell, and emits exact text, attribute, derived child-prop,
  structural, or keyed-collection patches. Repeated component and keyed-row
  occurrences receive stable request-local paths. Same-resource consumers nested
  in a structural reveal resolve directly inside that patch; additional-resource
  consumers become dynamically scheduled follow-up regions.
- Conditional and keyed client regions adopt server content between stable
  compiler-owned comment markers, then preserve those anchors during updates.
- Async failures never become inline `Error: ...` strings. Browser mounts expose
  one `onError` policy, while server failures reach one typed policy with phase
  and header-commit context.
- Root structural dependencies are marked as status gates. The JavaScript adapter
  also lets a host promote additional resources. Gates settle before the 200
  response commits, so a global policy can return a 404/401/403/validation/500
  response. Non-gated work continues to stream without head-of-line blocking.
- Hydration mismatches carry the nearest compiler boundary and source location.
  Production recovery replaces only that conditional or keyed range when one is
  available, otherwise it replaces the root. Canonical graph fingerprints travel
  with async checkpoints; incompatible client/server builds request a reload
  before DOM adoption.

## Current guarantees

The reference backend currently provides:

- deterministic plan lowering independent of graph node and edge input order;
- deterministic, escaped HTML for elements, text, attributes, component props,
  defaults, rest forwarding, captured children, conditions, content choices,
  context, and keyed collections;
- side-effect-free rendering: procedures and effects do not run;
- explicit host resolution for pure server or universal capabilities;
- rejection of client-only, resource, and effect capabilities during rendering;
- duplicate keyed-item rejection matching the DOM backend's invariant;
- ordered sink output and reproducible structural metrics; and
- an initial-state parity test that executes the DOM and server backends from the
  same semantic graph and compares their serialized HTML.

The plan records reachable effects and resources as non-rendering work rather
than silently treating them as server values. DOM refs fail if a render expression
tries to read them.

## Deliberate limitations

The v2 plan, transport, backend-neutral readiness executor, request-local
JavaScript tree expansion, dynamic nested scheduling, forwarded-prop dependency
tracing, pending companions, status gates, build fingerprints, and localized
hydration recovery are implemented. The v1 reference renderer remains
intentionally side-effect-free and does not execute disposable resources.

There is no authored loading or error-boundary syntax yet. Skeleton generation is
deliberately automatic, and post-header failures bubble to the global host policy;
a future nearest-error-boundary feature should be added only with a concrete UX
case. Exact HTTP status still requires a resource to be inferred or promoted into
the pre-header gate, because an already-committed streaming response cannot change
its status.

Structural metrics remain deterministic regression gates. A repeatable Vitest
benchmark now covers 250 keyed blocking rows and 100 granular readiness consumers
sharing one request. It is a local comparison baseline, not a production latency
claim; browser transfer, hydration, retained-memory, and application workloads
still need dedicated profiles.

## Path to async, hydration, and Rust

The next server steps should happen in this order:

1. Add routing/navigation and host response integration around the completed
   readiness and status contracts.
2. Add an authored nearest error boundary only if application examples need more
   than the global policy.
3. Expand benchmarks to browser transfer, hydration, navigation, retained memory,
   and authorized application workloads.
4. Implement a Rust consumer of the serialized plan only if those measurements
   justify it. The Rust backend must pass the same plan fixtures, HTML golden
   outputs, capability rules, escaping cases, and structural metrics before it can
   replace the JavaScript reference backend.

This separation means async and hydration will extend the backend contract rather
than becoming authored syntax decisions by accident. It also means a Rust server
renderer can coexist with JavaScript hydration: both consume compiler-owned data,
while the browser continues to use the direct-DOM runtime where JavaScript is the
native platform language.
