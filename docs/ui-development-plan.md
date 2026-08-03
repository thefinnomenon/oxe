# OXE UI development plan

This plan treats OXE as an original language and runtime. Solid is a behavioral
reference and an optional temporary comparison target, not OXE's production
runtime.

## Implementation language

OXE starts in TypeScript.

- The web runtime must ultimately execute as JavaScript and call the DOM directly.
- A TypeScript compiler keeps the language frontend, generated JavaScript, source
  maps, tests, and browser tooling in one ecosystem while semantics are changing.
- TypeScript is easier for AI and contributors to inspect and modify than a split
  TypeScript/Rust implementation.
- Rust would not make browser DOM updates intrinsically faster; a WASM runtime would
  add a costly boundary around DOM operations.

Rust remains a future option for the parser, analyzer, optimizer, or CLI after the
language and intermediate representation stabilize. It should be introduced only
after profiles show compiler throughput or memory is a meaningful bottleneck and a
Rust implementation can preserve identical diagnostics and source maps.

## Architectural boundaries

1. **Language frontend**: source text to tokens, syntax tree, diagnostics, and
   formatter-safe source locations.
2. **Semantic graph**: bindings, ownership, reactivity, capabilities, effects,
   async dependencies, and platform constraints.
3. **UI intermediate representation**: platform-neutral elements, dynamic regions,
   events, context, collections, and resources.
4. **Reactive runtime**: cells, computations, ownership, batching, disposal,
   context, async coordination, and errors.
5. **Renderers**: DOM first, followed by server rendering and later native adapters.
6. **Application graph integration**: routing, server functions, schema, database,
   authorization, caching, logging, and metrics.

The compiler may specialize or remove runtime primitives when relationships are
known statically. Runtime APIs are implementation details and do not define the
authored OXE language.

## Developer playground

- [x] Load native `.oxe` examples from a grouped picker and retain local drafts.
- [x] Compile off the main thread and execute generated code in a sandboxed preview.
- [x] Keep the last valid preview visible when current source has diagnostics.
- [x] Expose diagnostics, generated JavaScript, semantic graph, AST, and tokens.
- [x] Forward preview console errors and uncaught runtime failures.
- [x] Report compile time, mount time, graph shape, and DOM mutation counts.
- [x] Inspect a selected graph node's source, owner, inputs, consumers, prop flow,
      and component relationships.
- [x] Measure the tree-shaken shipped payload as raw, minified, gzip, and Brotli
      bytes, with runtime/module attribution and tooling explicitly excluded.
- [ ] Add precise source maps from generated JavaScript and graph nodes to OXE.
- [ ] Explain why each computation reran and which dependency invalidated it.
- [ ] Add owner/resource leak reporting and retained-memory inspection.

Acceptance: valid examples render and update in a real browser; invalid examples
produce clickable source diagnostics without destroying the last valid preview;
and size figures identify their exact payload boundary and measurement method.

## Milestone 1: reactive ownership kernel

- [x] Establish the fresh workspace and TypeScript build.
- [x] Implement writable cells and derived computations.
- [x] Execute compiler-emitted dependency edges without runtime discovery.
- [x] Batch writes without exposing intermediate states.
- [x] Own and deterministically dispose nested computations and resources.
- [x] Define the compiler-visible `untrack` runtime boundary.
- [x] Implement identity-based context scopes.
- [x] Reject direct reactive cycles with actionable runtime diagnostics.
- [x] Cover the implemented kernel behaviors with deterministic tests.

Acceptance: the runtime passes tests for diamonds, explicit graph edges, batching,
cleanup, nested ownership, context shadowing, the `untrack` boundary, equality
suppression, owner lifetimes, and cycles.

## Milestone 2: language frontend

- [x] Specify the initial tokens, indentation, and source spans.
- [ ] Preserve comments and whitespace trivia for formatter-safe round trips.
- [x] Implement the first lexer slice with `INDENT`/`DEDENT` diagnostics.
- [x] Parse the counter slice: zero-argument components and handlers, assignments,
      scalar literals, identifiers, and arithmetic.
- [x] Parse declaration parameters and uppercase local component invocations with
      named props.
- [x] Parse component defaults, one final rest parameter, prop spreads, and
      indented content as the reserved `children` value.
- [x] Parse JavaScript-style named component imports and `export Component():`
      declarations.
- [ ] Extend expressions with ordinary calls, member access, and records.
- [x] Parse indentation-closed host markup without closing tags.
- [x] Parse the single UI `if` construct and concise markup-producing `map`
      callbacks.
- [ ] Extend functional callbacks to multiline bodies and non-rendering
      `filter`, `flatMap`, and `reduce` expressions.
- [x] Recover at line and dedent boundaries so one syntax error does not hide later
      diagnostics.
- [ ] Produce a stable, versioned syntax tree and formatter.

Acceptance: every settled example in `language-decisions.md` parses, round-trips
through the formatter, and produces stable diagnostics for malformed variants.

## Milestone 3: semantic graph and JavaScript lowering

- [x] Resolve component-local bindings, procedures, and host elements for the
      counter slice.
- [x] Resolve local component parameters and exact required prop contracts.
- [x] Resolve local defaults, rest-prop contracts, component prop spreads, and
      the reserved implicit `children` contract.
- [x] Resolve imported components and one explicit exported entry component.
- [ ] Resolve contexts and platform capabilities.
- [x] Distinguish persistent declarative relationships from procedural handlers.
- [x] Infer scalar types and explicit reactive/procedural read and write edges.
- [x] Lower `untrack` by excluding nested reads from emitted dependency edges.
- [x] Reject duplicate declarations, unresolved names, reactive cycles, invalid
      event targets, and type-invalid procedural writes.
- [ ] Reject multiple declarative writers and missing context providers when those
      language features are introduced.
- [x] Lower the counter into an explicit, versioned, inspectable UI graph.
- [x] Preserve local component definitions, instances, reactive/procedure props,
      and ownership as explicit graph nodes and edges.
- [x] Generate deterministic, readable ESM JavaScript for the counter slice.
- [x] Specialize local component instances into direct DOM with reactive parent to
      child value flow and explicit procedure capabilities.
- [ ] Emit precise source maps.

Acceptance: a counter, derived-value form, nested context, conditional region, and
keyed list compile deterministically and execute against the runtime.

## Milestone 4: DOM renderer

- [ ] Hoist and clone static DOM templates.
- [x] Implement owned direct-DOM node creation, text bindings, event listeners, and
      mount/unmount cleanup without a virtual DOM.
- [x] Generate static and reactive property/attribute updates, including class
      and style string attributes.
- [x] Implement incremental conditional regions.
- [x] Implement keyed list insertion, movement, removal, row reuse, duplicate-key
      diagnostics, and owner disposal.
- [ ] Define refs and compiler-known disposable adapters.
- [ ] Add browser conformance tests and mutation-count assertions.

Acceptance: representative components update only affected DOM nodes, preserve focus
and selection, clean up removed regions, and remain keyboard accessible.

## Milestone 5: server rendering and hydration

- [ ] Render deterministic HTML on the server.
- [ ] Stream async regions while preserving document order.
- [ ] Serialize the minimum graph state required by the client.
- [ ] Hydrate without rerunning server work or replacing matching DOM.
- [ ] Diagnose server/client divergence with source locations.

Acceptance: server-rendered examples hydrate without duplicate requests or DOM
replacement and recover safely from deliberate mismatches.

## Milestone 6: native async UI behavior

- [ ] Lower ordinary async assignments into cancellable graph resources.
- [ ] Generate component skeletons and error modes from their real structure.
- [ ] Implement override precedence and skeleton hints.
- [ ] Retain prior data for same-identity refreshes and reset for identity changes.
- [ ] Integrate typed expected failures separately from unexpected faults.

## Milestone 7: application framework integration

- [ ] Add routing and navigation as graph inputs.
- [ ] Add typed server functions and serialization boundaries.
- [ ] Reintroduce the schema graph around OXE's final type system.
- [ ] Generate validated and authorized database/storage clients.
- [ ] Connect reads and writes to semantic cache dependencies and invalidation.
- [ ] Emit structured logs, metrics, traces, and AI-readable impact explanations.

## Performance gates

OXE will compare total application output, not an isolated runtime file:

- compressed and uncompressed JavaScript,
- parse and initialization time,
- initial DOM creation,
- update latency and DOM mutation count,
- allocations, retained memory, and garbage collection,
- SSR throughput and streamed first-byte timing,
- hydration time and duplicated work,
- end-to-end data requests and transferred fields.

Benchmarks must include dynamic dependencies, large keyed lists, forms, context,
async navigation, SSR dashboards, and authorized data—not only signal loops.

## Provisional implementation assumptions

The first scanner enforces two spaces per indentation level because every settled
language example currently uses two spaces and OXE intends to have a canonical
formatter. The width remains a language decision to confirm before parser syntax is
declared stable.
