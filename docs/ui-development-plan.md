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
- [x] Add retained-memory sizing for generated application clients.
- [ ] Add host-level retainer inspection.

Acceptance: valid examples render and update in a real browser; invalid examples
produce clickable source diagnostics without destroying the last valid preview;
and size figures identify their exact payload boundary and measurement method.

## Graph-first development workspace

The application-graph workspace replaces source-first editing for normalized
applications. Its primary surface is a live, full-height application preview. A
small persistent agent control sits in the lower-right corner and expands into a
resizable right rail; collapsing it must return all space to the preview without
destroying the conversation or pending reviewed draft.

Desktop layout uses three independently collapsible surfaces:

1. A narrow semantic explorer on the left for features, entities, queries,
   operations, policies, contexts, routes, and views.
2. The live preview in the center, with route and viewport controls in a restrained
   top bar.
3. The agent/revision rail on the right. Chat is the default tab; revisions shows
   immutable history and the selected revision's semantic changes and artifact
   impact.

On narrow screens the preview remains the default surface. Structure and revision
history open as full-height sheets, while agent chat expands upward from the corner.
The UI must preserve keyboard focus, expose labeled resize/collapse controls, and
never hide a failed diagnostic behind a transient toast.

The workspace reads and writes only through `oxe.application-agent-request.v1`:

- `inspect.map`, `inspect.node`, `inspect.incoming`, and `inspect.search` populate
  the semantic explorer without loading the normalized document.
- `inspect.history` drives the revision timeline. Selecting an old revision is
  read-only and visibly distinct from the current head.
- `preview` creates a review card containing semantic changes, diagnostics,
  affected nodes, generated-artifact work, and a preview fingerprint. The live
  preview may render disposable draft artifacts, but it does not advance history.
- `commit` must carry the reviewed fingerprint. A successful compare-and-swap
  advances the head and refreshes only published affected artifacts; stale review
  cards remain visible but cannot be committed.

The chat transcript stores protocol request IDs and revision/fingerprint links,
not hidden source edits. Clicking a referenced semantic ID selects the same node in
the explorer. Clicking a revision restores its review context; undo is a new
semantic revision rather than destructive history rewriting.

First workspace milestone:

- [x] Add a local development-server transport around `ApplicationDevelopmentSession`.
- [x] Embed a configured Todo server in a sandboxed live-preview frame and retain a compact
      semantic fallback when that server is unavailable.
- [x] Build the collapsible agent rail and semantic explorer from typed protocol results.
- [x] Review and commit a priority-field preview with explicit semantic/artifact impact.
- [x] Browse immutable revisions and compare any revision with its parent.
- [x] Add last-good runnable artifact fallback when the configured application server fails.
- [ ] Add responsive, keyboard, light/dark, stale-head, diagnostics, and reconnect tests.

Acceptance: an agent can inspect Todo, preview one atomic semantic mutation, show
the user exactly what semantic nodes and artifacts change, commit the reviewed
fingerprint, and update the live application without a full page reload or direct
editing of OXE/generated files.

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
- [x] Implement override precedence and skeleton hints.
- [x] Retain prior data for same-identity refreshes and reset for identity changes.
- [x] Define and implement typed async failure classes for runtime and server
      policy.
- [x] Connect generated pending companions and one global browser/server failure
      policy without rendering private error strings into content.

## Milestone 7: application framework integration

- [x] Define filesystem route discovery, deterministic matching, URL policy, and
      a serializable manifest.
- [x] Implement atomic browser navigation with persistent layout owners,
      independently loaded segment artifacts, cancellation, history, scroll, and
      focus behavior.
- [x] Add compiler route-segment mode for prop-free pages and layouts whose sole
      input is the implicit children outlet.
- [x] Lower route snapshots and navigation operations into explicit graph inputs.
- [x] Compose matched layout/page server plans and adopt the serialized route
      snapshot during hydration.
- [x] Extract authored visible prose into stable messages while preserving dynamic
      values and inline markup as reorderable placeholders.
- [x] Lower strict compiler-only `i18n` records for message keys, plural/ordinal
      counts, named selectors, and inherited `i18n={false}` opt-outs.
- [x] Format currency, date, time, and datetime values through the platform
      `Intl` implementations, using native option names and cached formatter
      instances rather than bundled locale algorithms.
- [x] Generate machine-readable `datetime` and `value` attributes for semantic
      `time` and `data` formatting sites.
- [x] Make locale, time zone, calendar, and numbering system explicit SSR inputs
      and serialize them into hydration state to prevent server/client drift.
- [x] Split locale catalogs into lazy chunks and prove through payload inspection
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
- [x] Invoke localization preparation from the `oxe build` pipeline and
      provide an explicit `--sync-i18n` composition for developer-controlled
      generation before build.
- [ ] Add optional design-system locale and currency pickers driven by configured
      supported values while keeping locale selection and currency conversion
      separate.
- [x] Add typed server functions with versioned JSON-only parameter/result schemas,
      deterministic manifests, exact validation on both sides of the boundary,
      cancellation, safe error envelopes, server-only request context, and stable
      capability identities preserved in UI graphs and server render plans.
- [x] Lower application-graph queries and operations into those contracts, bind
      form and keyed-row DOM events with typed arguments, and refresh affected
      query resources after successful in-memory-host mutations.
- [x] Execute Todo query/create/update bodies against semantic-id in-memory state,
      reload client entity inputs authoritatively, enforce actor/relation policies,
      and adapt the generated contracts into the ordinary server-function registry.
- [x] Lower entities, fields, generated values, constraints, external actors, and
      relation endpoints into deterministic storage-neutral database schema IR,
      with additive migration planning for the Todo priority revision and explicit
      rejection of unsafe or destructive transitions.
- [x] Extend the semantic type system through refined integers/decimals, domain
      scalars, exact lists, optional values, and typed result outcomes while
      keeping application types out of the lowered UI graph.
- [x] Emit deterministic PostgreSQL schema/migrations directly from database IR,
      apply checksummed forward migrations under advisory locks to a real
      temporary PostgreSQL database, and execute validated and authorized Todo
      queries/operations through OXE's own Node `pg` semantic host.
- [x] Convert verified Better Auth session identity to server-only `userId` plus
      request-scoped context roles; validate direct ownership, membership-backed
      authorization, arbitrary parent-role DAGs, and context policies/defaults.
- [x] Extend TinyTodo with owner-or-member Team contexts, owner-only membership
      grants, generic context-option discovery, and a generated-client team
      switcher while keeping Team outside the framework type system.
- [x] Add stable graph-owned composite uniqueness, additive PostgreSQL constraint
      migration, external-user existence checks, and pending invitation
      accept/revoke flows without introducing a framework-specific tenant model.
- [x] Instantiate Better Auth in the Node application boundary, apply its
      provider-owned PostgreSQL schema explicitly, resolve cookie sessions to
      `userId`, and prove sign-up/sign-out/sign-in plus per-user generated Todo RPC
      isolation against a real temporary database.
- [x] Add graph-generated sign-in/sign-up/account UI and a generic browser view
      interpreter for forms, repeats, context-aware operations, and standard modes.
- [x] Implement generic direct-or-membership context discovery and authorization
      for organization, team, project, or application-specific selection.
- [x] Generate a typed browser client with user-and-active-context-scoped memory
      caching, same-key in-flight deduplication, bounded freshness, and semantic
      query invalidation after writes, including protection against stale
      in-flight reads repopulating the cache.
- [x] Bootstrap generated clients from a no-store, server-verified public context
      endpoint; strictly parse declared context selections, omit server-only
      session identity, derive cache scope internally, and propagate the resolved
      ordered chain on every RPC.
- [x] Add a reproducible generated-client size/runtime benchmark, remove
      compiler-only manifest metadata from browser output, and avoid response-key
      sorting on the validation hot path.
- [x] Make query cache freshness/no-store and scalar query predicates graph
      semantics, with PostgreSQL/in-memory execution and cache-aware compact inspect.
- [x] Split reachable generated browser functions into lazy account and context-role
      client modules, and intern repeated result schemas in each artifact.
- [x] Expand atomic graph mutation with typed whole-semantic-node add/replace and
      singleton application replacement while retaining full-draft validation.
- [x] Add typed semantic removal, stable-ID symbol rename, identified UI movement,
      policy-rule replacement, incoming-reference preflight, and deterministic
      semantic impact previews.
- [x] Generate one reusable browser transport/cache/validation runtime with small
      typed context facets, eliminating duplicated runtime code across lazy chunks.
- [x] Server-render graph-derived loading structure with revision/view hydration
      identity and adopt the authenticated shell in the generic browser host.
- [x] Compute transitive incoming semantic impact closure and map it to deterministic
      database, server, client-manifest, route, view, and verification artifacts
      without invalidating the shared browser runtime.
- [x] Add headless-Chrome conformance/performance checks and a reproducible AI
      authoring proxy plus a controlled three-arm model trial suite/scorer.
- [x] Add typed transactional operation workflows with ordered local results and
      matching rollback behavior in the memory and PostgreSQL semantic hosts.
- [x] Carry finite numeric values through validation, RPC schemas, generated number
      controls, memory execution, and PostgreSQL storage; broaden the semantic UI
      registry with reusable layout, text, link, textarea, and number primitives.
- [x] Add provider-neutral, versioned capability imports with exact invocation
      contracts, explicit external-call effects, and injectable memory/PostgreSQL
      adapters that keep credentials and provider SDKs outside semantic state.
- [x] Project deterministic production runtime requirements and validate concrete
      auth, PostgreSQL, and capability bindings before startup.
- [x] Emit privacy-safe structured trace spans, aggregate metrics, and deterministic
      AI-readable impact explanations from semantic IDs.
- [x] Add explicit durable capability enqueue steps with atomic memory/PostgreSQL
      outbox behavior, leased `SKIP LOCKED` claims, retries, and delivery idempotency keys.
- [x] Add graph-declared exponential backoff/jitter, dead-letter inspection and replay,
      a scheduled graceful-draining PostgreSQL worker, and adapter idempotency probes.
- [x] Compose the outbox worker into application server startup/shutdown and add a
      protected workspace Runtime panel for bounded telemetry, metadata-only
      dead-letter inspection, and explicit replay.
- [x] Emit compiler-owned PostgreSQL server entries from application graph builds,
      with manifest-declared embedded and independently executable worker modes.
- [x] Add integrity-pinned browser/server/universal extension modules with explicit
      npm package declarations and independent target-aware bundling.
- [x] Add typed custom-component contracts, direct custom-element lowering, and a
      generated browser registry without coupling application semantics to UI IR.
- [x] Add graph-owned design tokens, named theme overrides, and optional validated
      browser CSS extension assets.
- [x] Bind provider-neutral capabilities to generated server extension registries,
      including durable-job idempotency checks.
- [x] Emit executable lazy browser clients, a generic browser view host, checksummed
      migration descriptor, and a production Node HTTP/Better Auth startup entry.
- [x] Minify and code-split production application browser output, emit deterministic
      content-hashed assets with SHA-256 metadata, and serve only those assets with
      immutable caching while keeping generated HTML uncached.
- [x] Exercise the generated Node host in headless Chrome against temporary PostgreSQL,
      including sign-up, custom components/styles, team switching, task isolation,
      and production cache headers.
- [x] Make the live application the development workspace, with a mobile-ready
      floating agent/tool panel and a strict exact-origin semantic interaction
      bridge that gives chat bounded recent-action context without capturing data.
- [x] Separate committed, staged, and active revisions; serialize publication;
      gate activation behind an isolated adapter; retain last-good artifacts on
      build/migration/runtime failure; and expose deterministic status in the
      workspace.
- [x] Bind the publication adapter to disposable PostgreSQL and generated Node
      runtime candidates so one activation swaps the concrete database, server,
      and browser target together, including restart recovery of the active
      last-good revision.
- [x] Add typed revision restore and failed-publication retry through the one
      semantic protocol, plus responsive roving-tab keyboard navigation and
      automatic live-target reconnection in the workspace.
- [x] Add optional provider-neutral capability recipes for email, object storage,
      payments, realtime, search, and webhook delivery on top of the generic
      capability adapter boundary.
- [x] Expand the controlled AI authoring suite to ten independent application
      concerns and add deterministic multi-scenario representation/runtime
      benchmarks without substituting heuristic tokens for provider usage.
- [x] Add a no-key dry-run matrix, OpenAI Responses adapter, isolated held-out
      evaluator, deterministic randomized/resumable scheduling, and explicit
      concurrency, timeout, output-token, total-token, and trial-count limits for
      the 90-trial pilot and later 900-trial controlled authoring experiment.

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
