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

Rust remains a future option for the parser, analyzer, optimizer, CLI, or server
renderer after the relevant intermediate representation stabilizes. The
serializable server render plan now provides a language-neutral backend boundary.
Rust should still be introduced only after profiles show compiler throughput,
memory, or SSR throughput is a meaningful bottleneck and a native implementation
can preserve the JavaScript reference backend's golden outputs and diagnostics.

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
- [x] Add precise source maps from generated JavaScript and graph nodes to OXE.
- [x] Explain why each computation reran and which dependency invalidated it.
- [x] Add opt-in live owner/resource snapshots and cleanup leak inspection.
- [ ] Add retained-memory sizing and host-level retainer inspection.

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
- [x] Track standalone record and nested member dependencies by selected field path.
- [x] Reject direct reactive cycles with actionable runtime diagnostics.
- [x] Cover the implemented kernel behaviors with deterministic tests.

Acceptance: the runtime passes tests for diamonds, explicit graph edges, batching,
cleanup, nested ownership, context shadowing, the `untrack` boundary, equality
suppression, owner lifetimes, and cycles.

## Milestone 2: language frontend

- [x] Specify the initial tokens, indentation, and source spans.
- [x] Preserve comments and whitespace trivia for formatter-safe round trips.
- [x] Implement the first lexer slice with `INDENT`/`DEDENT` diagnostics.
- [x] Parse the counter slice: zero-argument components and handlers, assignments,
      scalar literals, identifiers, and arithmetic.
- [x] Parse declaration parameters and uppercase local component invocations with
      named props.
- [x] Parse component defaults, one final rest parameter, prop spreads, and
      indented content as the reserved `children` value.
- [x] Parse JavaScript-style named component imports and `export Component():`
      declarations.
- [x] Extend expressions with ordinary calls, member access, and records.
- [x] Parse indentation-closed host markup without closing tags.
- [x] Parse punctuation-led UI conditionals, exhaustive inline and `=?`
      conditional values, and concise markup-producing `map` callbacks.
- [x] Extend functional callbacks to multiline bodies and non-rendering
      `filter`, `flatMap`, and `reduce` expressions.
- [x] Add pure stable `sort`, direct record-field writes, and deterministic
      `add`/`update`/`remove` collection mutations with optional limits.
- [x] Recover at line and dedent boundaries so one syntax error does not hide later
      diagnostics.
- [x] Produce a stable, versioned syntax tree and formatter.

Acceptance: every settled example in `language-decisions.md` parses, round-trips
through the formatter, and produces stable diagnostics for malformed variants.

## Milestone 3: semantic graph and JavaScript lowering

- [x] Resolve component-local bindings, procedures, and host elements for the
      counter slice.
- [x] Resolve local component parameters and exact required prop contracts.
- [x] Resolve local defaults, rest-prop contracts, component prop spreads, and
      the reserved implicit `children` contract.
- [x] Resolve imported components and one explicit exported entry component.
- [x] Resolve contexts and typed platform capabilities.
- [x] Distinguish persistent declarative relationships from procedural handlers.
- [x] Infer scalar types and explicit reactive/procedural read and write edges.
- [x] Lower `untrack` by excluding nested reads from emitted dependency edges.
- [x] Lower conditional value expressions with explicit branch dependencies,
      type agreement, constant folding, and deterministic JavaScript.
- [x] Reject duplicate declarations, unresolved names, reactive cycles, invalid
      event targets, and type-invalid procedural writes.
- [x] Reject multiple declarative writers and missing context providers when those
      language features are introduced.
- [x] Lower the counter into an explicit, versioned, inspectable UI graph.
- [x] Preserve local component definitions, instances, reactive/procedure props,
      and ownership as explicit graph nodes and edges.
- [x] Generate deterministic, readable ESM JavaScript for the counter slice.
- [x] Lower record member consumers to stable field-path sources without changing
      authored assignment syntax.
- [x] Specialize local component instances into direct DOM with reactive parent to
      child value flow and explicit procedure capabilities.
- [x] Emit precise source maps.

Acceptance: a counter, derived-value form, nested context, conditional region, and
keyed list compile deterministically and execute against the runtime.

## Milestone 4: DOM renderer

- [x] Hoist and clone static DOM templates.
- [x] Implement owned direct-DOM node creation, text bindings, event listeners, and
      mount/unmount cleanup without a virtual DOM.
- [x] Generate static and reactive property/attribute updates, including class
      and style string attributes.
- [x] Implement incremental conditional regions.
- [x] Implement keyed list insertion, movement, removal, row reuse, duplicate-key
      diagnostics, and owner disposal.
- [x] Define platform refs and compiler-known disposable adapters.
- [x] Add browser conformance tests and mutation-count assertions.

Acceptance: representative components update only affected DOM nodes, preserve focus
and selection, clean up removed regions, and remain keyboard accessible.

## Milestone 5: server rendering and hydration

- [x] Define a deterministic, serializable server render plan with explicit
      blocking boundaries and ordered sink delivery.
- [x] Render deterministic HTML for the current synchronous UI slice with a
      JavaScript reference backend.
- [x] Compare initial browser and server output for representative components,
      conditions, collections, content, and context.
- [x] Define v2 deferred regions at the smallest async consumers with stable
      document markers and readiness delivery metadata.
- [x] Define inert streamed replacement/attribute patches, CSP bootstrap hashing,
      short-window batching policy, and stale patch tokens.
- [x] Serialize ready resource checkpoints required by the client.
- [x] Add eager hydration adoption that restores checkpoints without rerunning
      resource work or replacing matching simple DOM.
- [x] Schedule backend-instantiated v2 regions as backpressure-aware readiness
      streams with request-identity deduplication, cancellation, batching, typed
      error bubbling, and final checkpoints.
- [x] Instantiate the initial one-instance JavaScript v2 path into async
      capability requests, static shell markers, granular text/attribute patches,
      structural-choice patches, and derived child-prop consumers.
- [x] Expand repeated components and keyed rows into request-local marker paths,
      and dynamically schedule additional resources revealed by nested regions.
- [x] Adopt matching conditionals and keyed collections between compiler-owned
      hydration comments without replacing their existing nodes.
- [x] Capture early click/input metadata and replay matching events in original
      order only after eager hydration has attached all generated listeners.
- [x] Trace dependent request identities through forwarded component props and
      mapped child values.
- [x] Infer root structural HTTP status gates and allow host promotion of
      additional resources before headers commit.
- [x] Recover only the smallest conditional/keyed mismatch when possible and
      fall back to controlled root replacement.
- [x] Diagnose server/client divergence with compiler boundary source locations
      and reject incompatible build fingerprints before adoption.

Acceptance: server-rendered examples hydrate without duplicate requests or DOM
replacement and recover safely from deliberate mismatches.

## Milestone 6: native async UI behavior

- [x] Lower ordinary async assignments into cancellable graph resources.
- [x] Generate component skeletons and pending modes from their real structure.
- [ ] Implement override precedence and skeleton hints.
- [x] Retain prior data for same-identity refreshes and reset for identity changes.
- [x] Define and implement typed async failure classes for runtime and server
      policy.
- [x] Connect generated pending companions and one global browser/server failure
      policy without rendering private error strings into content.

## Milestone 7: application framework integration

- [ ] Add routing and navigation as graph inputs.
- [x] Extract authored visible prose into stable messages while preserving dynamic
      values and inline markup as reorderable placeholders.
- [x] Lower strict compiler-only `i18n` records for message keys, plural/ordinal
      counts, named selectors, and inherited `i18n={false}` opt-outs.
- [x] Format currency, date, time, and datetime values through the platform
      `Intl` implementations, using native option names and cached formatter
      instances rather than bundled locale algorithms.
- [x] Generate machine-readable `datetime` and `value` attributes for semantic
      `time` and `data` formatting sites.
- [ ] Make locale, time zone, calendar, and numbering system explicit SSR inputs
      and serialize them into hydration state to prevent server/client drift.
- [ ] Split locale catalogs into lazy chunks and prove through payload inspection
      that unused translation, plural, ordinal, and formatting capabilities are
      absent.
- [x] Extract and hash messages during development without translating, then add
      explicit incremental OpenAI-backed `oxe i18n sync` generation with
      environment-only credentials, generated/reviewed provenance, and protection
      for human edits.
- [x] Add deterministic `i18n check` and build-preparation validation that performs
      no model, provider, network, or catalog writes.
- [x] Generate complete platform-derived cardinal and ordinal catalogs with
      purpose/context guidance, glossary invalidation, bounded locale concurrency,
      and a tree-shakable browser selection runtime.
- [ ] Invoke localization preparation from the eventual `oxe build` pipeline and
      provide an explicit `--sync-i18n` composition for developer-controlled
      generation before build.
- [ ] Add optional design-system locale and currency pickers driven by configured
      supported values while keeping locale selection and currency conversion
      separate.
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
Until timing benchmarks run in a controlled environment, the synchronous SSR
reference backend gates reproducible structural work: bytes written, views,
elements, expressions, components, collection items, and maximum component depth.
The runtime-server package also includes repeatable blocking/keyed and
readiness/deduplication microbenchmarks; browser and end-to-end cases remain.

## Provisional implementation assumptions

The first scanner enforces two spaces per indentation level because every settled
language example currently uses two spaces and OXE intends to have a canonical
formatter. The width remains a language decision to confirm before parser syntax is
declared stable.
