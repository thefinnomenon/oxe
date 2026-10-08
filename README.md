# OXE

OXE is an AI-first application language and runtime. Its long-term design is one
compiler-visible graph spanning UI, asynchronous work, data, authorization,
caching, errors, logs, metrics, and traces.

The current architecture direction makes that normalized application graph the
semantic source of truth. AI agents inspect compact projections and submit typed,
atomic semantic mutations; source text and generated JavaScript are projections
rather than the primary editing interface. See
[docs/application-graph-architecture.md](docs/application-graph-architecture.md)
and the canonical
[Todo graph fixture](examples/application-graph-todo/graph.json).

The project is being rebuilt from the UI language outward. Its production path
does not use React, Solid, a virtual DOM, or `innerHTML`.

## Working UI slices

The current composition slices compile both the required-prop baseline in
[examples/component-composition/App.oxe](examples/component-composition/App.oxe)
and the extended contract in
[examples/composition-features/App.oxe](examples/composition-features/App.oxe):

```oxe
export App():
  count = 0

  increment():
    count = count + 1

  <main>
    <h1>Component composition
    <Counter count={count} onIncrement={increment}>

Counter(count, onIncrement):
  doubled = count * 2

  <section>
    <button onClick={onIncrement}>Count: {count}
    <p>Doubled: {doubled}
```

The extended example adds reactive defaults, one final rest parameter, ordered
component prop forwarding, and implicit child content:

```oxe
Wrapper(title, ...props):
  <Card title={title} {...props}>
    {children}

Card(title, subtitle = title, ...props):
  <article>
    <h2>{title}
    <p>Subtitle: {subtitle}
    {children}
```

The linked-project slice compiles the named import in
[examples/component-modules/App.oxe](examples/component-modules/App.oxe) against
the direct export in
[examples/component-modules/Card.oxe](examples/component-modules/Card.oxe):

```oxe
import { Card } from "./Card.oxe"

export App():
  <Card title={"Modules"}>
```

The implemented path is:

1. Scan strict indentation and produce precise diagnostics and source spans.
2. Parse local components, strict prop contracts, parameterized handlers,
   records, member access, ordinary calls, exhaustive scalar/content choices,
   multiline callbacks, `map`/`filter`/`flatMap`/`reduce`/pure `sort`, collection
   `add`/`update`/`remove`, direct record-field writes, `untrack`, and
   indentation-closed markup into an immutable syntax tree.
3. Resolve uppercase local component references and exact named prop contracts;
   infer reactive value parameters, explicit procedure capabilities, rest
   capture, defaults, and the reserved implicit `children` contract.
4. Validate and canonically serialize a versioned semantic UI graph.
5. Specialize authored component instances into readable direct-DOM JavaScript
   while retaining definitions, instances, props, and ownership in the graph.
6. Mount real DOM nodes, update text and DOM values, replace only changed
   conditional branches, reconcile keyed rows by identity, and deterministically
   dispose removed owners.

The original counter remains as the smallest single-component proof. The
composition acceptance gate is stricter: updates must flow through required
props, defaults, and caller-owned child content while preserving DOM node
identities and creating or removing no DOM nodes.

This is deliberately a narrow implemented proof, not yet a general UI framework.
Value props and defaults stay reactive, procedure props are explicit
capabilities, and additional props can be captured and forwarded only to another
component. Arbitrary spreading onto a host DOM element is intentionally not
implemented; named host properties and attributes use typed lowering. Fixed multi-file
projects use JavaScript-style named imports and direct declaration exports, with
one explicit exported entry selected by the host. Incremental conditional regions,
first-class captured content, record/member values, immutable collection
transformations and writes, authored `untrack`, generated source maps, and reactive DOM values are
now implemented. Context providers, typed external capability contracts,
compiler-owned disposable resources, platform-element refs, cloned static DOM
templates, and compiler-owned async data are implemented as well. Async values
deduplicate by canonical identity, cancel obsolete work, retain ready data during
`refresh(value)`, propagate through component props, and update only consuming
text/attributes. A serializable server render plan and synchronous JavaScript
reference SSR backend render the pure UI slice; a v2 deferred-region plan, inert
patch protocol, serialized checkpoints, and eager DOM adoption establish the
streaming/hydration boundary. The portable readiness executor now deduplicates
request-local resources, streams independent regions without source-order
blocking, awaits sink backpressure, propagates cancellation/errors, and writes
hydration checkpoints. It now traces dependent identities through forwarded and
mapped props, generates localized inert skeletons, routes failures through one
global policy, gates root HTTP status work before headers, and recovers the
smallest compiler-owned hydration range with source-linked build diagnostics.
Top-level `server` declarations now generate their versioned RPC contract,
browser proxy, and ordinary sequential server implementation. The standard Fetch
host joins URL matching, nested plan composition, pre-header status gates,
streamed SSR/hydration state, and server-function dispatch; the Node adapter
bridges that same handler to native HTTP. Authored nullable types and multiple
roots remain on the task list. The JavaScript adapter expands compiler templates into request-local
component and keyed-row paths—including granular attributes, derived child props,
structural choices, and keyed async collections. Deferred consumers inside a
revealed structural branch resolve immediately when they share its ready resource
or dynamically register their additional resource and patch work when they do not.

## Packages

- `@oxe/cli`: the `oxe` executable and explicit localization sync/check workflow.
- `@oxe/auth`: Node/Better Auth email-password accounts, explicit provider-owned
  PostgreSQL migration execution, cookie-session-to-`userId` resolution, and
  optional server-validated active-context resolution for multi-tenant apps.
- `@oxe/compiler`: scanner, parser, semantic analysis, and deterministic DOM code
  generation; deterministic application-route projection into the lowered UI
  graph with semantic provenance and typed RPC contracts; a generated generic
  browser-view contract with standard modes and lazy account/context client
  facets over one shared transport/cache/validation runtime, scoped graph-declared
  caching/invalidation, interned response schemas, structure-derived SSR loading
  projections with hydration identity, and semantic impact-closure artifact
  invalidation; and a separate
  storage-neutral relational schema IR with safe additive migration planning for
  application graph revisions, including stable composite unique constraints;
  plus a revision-aware cache for real browser/database/server/verification
  projections, compiler-owned embedded/separate PostgreSQL worker deployment
  entries, and a Node-only development session that joins that cache to the
  authoritative revision store and agent protocol; plus serialized staged
  publication with disposable PostgreSQL/generated-Node candidates, atomic
  last-good activation and restart recovery, candidate cleanup, and versioned
  failure status.
- `@oxe/graph`: distinct versioned application and lowered UI graph types,
  structural and semantic validation, compact AI inspection, atomic typed
  add/replace/remove/rename/UI-move/policy mutation with incoming-reference and
  impact previews, canonical application serialization,
  graph-declared query predicates/cache policy, typed transactional workflows,
  finite numeric values, refined integers and decimals, dates, bytes, URLs,
  email addresses, exact lists/optionals/results, provider-neutral capability
  contracts and optional standard recipes, and runtime-binding
  readiness diagnostics, privacy-safe semantic trace/metric collection,
  deterministic AI-readable impact explanations, durable queued capability
  delivery with stable idempotency keys, bounded retry policy, dead-letter replay,
  and adapter conformance probes, generic context roles
  with direct/membership authorization and parent-role DAGs, a policy-enforcing
  in-memory semantic query/operation host, and an isolated Node-only SQLite WAL
  revision store with indexed semantic references, atomic compare-and-commit,
  mutation history, and undo; and a strict versioned inspect/preview/commit agent
  protocol with reviewed-preview fingerprints. It also retains lowered UI dependency-edge
  reconciliation, topology checks, and canonical UI-graph JSON.
- `@oxe/i18n`: automatic message extraction, content-addressed catalogs,
  incremental sync, reviewed-translation protection, deterministic validation,
  and OpenAI translation isolated from application packages.
- `@oxe/runtime`: platform-neutral cells, derived and async values, identity
  deduplication, cancellation, refresh, batching, ownership, cleanup, context,
  and `untrack` primitives for generated code.
- `@oxe/runtime-dom`: direct DOM creation, owned sync/async text and attribute
  bindings, conditional and keyed regions, batched event listeners, mounting,
  eager hydration adoption, and unmounting.
- `@oxe/runtime-server`: language-neutral blocking/deferred render-plan lowering,
  the deterministic synchronous JavaScript reference renderer, a portable
  readiness scheduler, inert stream transport/checkpoints, and structural
  performance metrics.
- `@oxe/router`: serializable filesystem route manifests, strict URL matching,
  graph-backed route inputs, nested SSR composition, reactive browser
  navigation, persistent independently loaded DOM segments, and Fetch/Node
  application hosts.
- `@oxe/postgres`: Node `pg` connectivity, checksummed forward-only migration
  application under PostgreSQL advisory locks, and a graph-compiled semantic
  query/operation host with authoritative reloads, server-side context-role
  resolution, generic authorized context-option discovery, direct-or-membership
  authorization, external-entity existence validation, semantic unique-violation
  errors, scoped policy enforcement, and a leased at-least-once outbox worker whose
  inserts commit atomically with graph workflow writes, with scheduled polling,
  exponential backoff/jitter, metadata-only inspection, replay, and graceful drain.
- `@oxe/server-functions`: versioned typed RPC contracts, deterministic manifests,
  exact request/result validation, safe error envelopes, cancellation, and
  Fetch/in-process transports for compiler-generated functions, including the
  server-only application adapters used to execute graph-owned contracts against
  in-memory or PostgreSQL hosts, a managed PostgreSQL server composition with
  bounded telemetry and graceful outbox-worker ownership, plus a Better Auth session-to-`userId` and
  server-validated multi-tenant context boundary with a browser-safe context
  bootstrap projection.
- `@oxe/playground`: browser compiler lab with native examples, an isolated DOM
  preview, diagnostics, generated output, graph inspection, and payload sizing.
- `@oxe/todo`: runnable Node/PostgreSQL browser projection of the authenticated
  TinyTodo application graph, with Better Auth accounts, shared team membership,
  pending accept/revoke invitations, duplicate prevention, a team switcher, and
  generated OXE RPC/client projections; its leased outbox worker starts after
  migrations and drains before database shutdown.
- `@oxe/workspace`: local graph-first development workspace with a live preview,
  semantic explorer, revision review, protected runtime telemetry/dead-letter
  controls, collapsible agent protocol rail, typed revision restore, publication
  retry, keyboard navigation, and committed-versus-active publication status
  backed by the authoritative SQLite revision session and concrete hot target.
- `docs/language-decisions.md`: settled authored-language decisions and open
  syntax.
- `docs/ui-development-plan.md`: staged tasks and acceptance gates.

## Why TypeScript

The compiler and runtime start in strict TypeScript. The web runtime must execute
as JavaScript and call the DOM directly while the language and graph are changing
quickly. Intermediate representations remain plain and serializable. The server
render plan contains no JavaScript closures or DOM values, so a future Rust SSR
backend can consume the same contract; measured compiler or rendering profiles
can justify that move without changing authored language semantics.

## Commands

```sh
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm bench
pnpm bench:application-values
pnpm todo:bench:authoring
pnpm todo:bench:browser # while TinyTodo is running
pnpm ai:trials:test
pnpm ai:trials:dry # validates the 30-cell harness without a provider key
pnpm ai:trials:pilot # 90 OpenAI trials; requires an explicit OPENAI_API_KEY
pnpm ai:trials:full # 900 OpenAI trials after the pilot is reviewed
pnpm ai:trials:record -- trial.json trials.jsonl
pnpm ai:trials:run -- --adapter adapter.mjs --evaluator evaluator.mjs --output trials.jsonl
pnpm ai:trials:score -- trials.jsonl
pnpm --filter @oxe/runtime-server bench

# Run TinyTodo after setting DATABASE_URL.
pnpm todo
pnpm workspace # then open http://127.0.0.1:4175
```

## Building an OXE project

After building the workspace packages, the CLI compiles a conventional
`src/App.oxe` or `App.oxe` entry with:

```sh
node packages/cli/dist/cli.js build --project path/to/project
```

The default `dist` directory contains a versioned `oxe-manifest.json`, generated
browser modules and source maps, canonical semantic graphs, and blocking and
deferred server render plans. Localized builds also emit
`localization-manifest.json` plus one independent catalog file per configured
locale; browser modules do not import every locale. When `src/routes` contains
`page.oxe` files, the command automatically emits a filesystem route manifest
and one independently loadable artifact set per unique layout or page segment.

Entry, output, and routing conventions can be overridden explicitly:

```sh
node packages/cli/dist/cli.js build \
  --project path/to/project \
  --entry src/Shell.oxe \
  --export Shell \
  --out-dir build

node packages/cli/dist/cli.js build \
  --project path/to/project \
  --routes-dir src/routes \
  --base-path /dashboard
```

If the project contains `oxe.config.json`, every build performs deterministic
localization validation without contacting a provider or writing catalogs. Add
`--sync-i18n` only when generation should run explicitly before validation and
compilation:

```sh
node packages/cli/dist/cli.js build --project examples/localization --sync-i18n
```

Build output is staged before replacing the previous output directory, so a
compiler or localization error leaves the last successful build intact. Host
capability adapter implementation and the HTTP/auth edge remain deployment
integration responsibilities.

### Building a normalized application graph

The application build path validates the authoritative graph and emits its
canonical copy alongside deterministic PostgreSQL, browser, route, server-function,
verification, runtime-requirement, and deployment artifacts:

```sh
node packages/cli/dist/cli.js build \
  --project examples/application-graph-todo \
  --application-graph graph.json \
  --worker-mode embedded
```

`embedded` is the default. Its `server/application.js` factory owns one managed
outbox worker and drains it when the host closes. Use `separate` when the web and
worker processes scale independently:

```sh
node packages/cli/dist/cli.js build \
  --project examples/application-graph-todo \
  --application-graph graph.json \
  --worker-mode separate

DATABASE_URL=postgres://... node examples/application-graph-todo/dist/server/worker.js
```

Separate mode emits an independently executable `server/worker.js`; the server
factory never polls the outbox. `oxe-manifest.json` and
`application/manifest.json` identify the selected topology and entry paths. Both
modes keep `graph.json` authoritative—the copy under `dist/application` and all
JavaScript/SQL are disposable projections. The build also emits an executable
`server/start.js` Node host. It applies the checksummed OXE migration, applies
Better Auth's provider-owned migrations when authentication is declared, starts
the generated RPC and optional embedded worker, serves the generated browser
host, and resolves every request to server-verified `userId` and active-context
state:

```sh
DATABASE_URL=postgres://localhost/oxe \
BETTER_AUTH_URL=http://127.0.0.1:3000 \
BETTER_AUTH_SECRET=replace-in-production \
node examples/application-graph-todo/dist/server/start.js
```

`HOST`, `PORT`, and a comma-separated `OXE_ALLOWED_ORIGINS` are optional. The
production host refuses to start an authenticated application without an auth
secret. Generated pages, lazy account/context clients, the cache/transport
runtime, view projections, custom components, and theme CSS are served from the
same origin. Production application builds preserve the logical browser modules
as inspectable disposable projections, then emit a minified, code-split
`browser/assets` projection with content-hashed filenames. `browser/index.html`
references those hashed entries, `browser/asset-manifest.json` records exact byte
counts and SHA-256 integrity, and the generated host serves only the manifest's
hashed assets with one-year immutable caching; HTML remains `no-store`.

### JavaScript, npm packages, custom components, and styles

Arbitrary behavior stays outside the compact semantic graph as an explicitly
declared, integrity-pinned extension asset. An `extensionModule` gives the asset a
stable semantic ID, project-relative source, SHA-256 digest, browser/server target,
format, and the package dependencies it directly imports. Browser and server
entries are bundled independently, so a Node-only dependency cannot silently leak
into browser output. Every declared package must also exist at the exact declared
specifier in the project's `package.json`; undeclared and stale declarations fail
the build. Relative imports are allowed only when every reached project-local file
has its own unique, integrity-pinned extension-module declaration with a compatible
target.

```json
{
  "id": "module.chart",
  "kind": "extensionModule",
  "name": "Chart implementation",
  "source": "extensions/chart.js",
  "integrity": "sha256:…",
  "target": "browser",
  "format": "javascript",
  "packages": { "uplot": "1.6.32" }
}
```

A `componentExtension` binds a browser/universal JavaScript export to an exact
prop, event, children, and SSR custom-element contract. A capability's optional
`adapter` binds a server/universal export to its already typed provider-neutral
contract; queued adapters must declare `jobId` idempotency. The graph therefore
remains inspectable and type-checkable without embedding an npm API or arbitrary
JavaScript AST into application semantics.

Styles use graph-owned semantic tokens and theme overrides. Optional CSS modules
are browser-only, integrity-pinned extension assets and are bundled into the
generated application stylesheet. Custom component definitions are loaded before
the generic browser host adopts the graph-derived SSR shell. Extension source is
an opaque revisioned asset pinned by the graph; generated bundles remain
disposable projections.

For localized route builds, the configured source locale owns the bare URL and
other locales use canonical lowercase prefixes (`/es`, `/pt-br`). The Fetch host
redirects a bare first visit using a signed-in preference hook, then the
`oxe_locale` cookie, then `Accept-Language`. SSR receives that locale before
rendering, and hydration adopts the exact serialized localization context.
`createLazyI18n` loads only the active locale chunk and deduplicates a later
client-side language switch. Responses remain `no-store` by default; public CDN
caching is intentionally left to a later host policy.

The translation example uses `examples/localization/oxe.config.json`:

```json
{
  "i18n": {
    "source": "en-US",
    "locales": ["es", "pt", "fr", "it"],
    "glossary": {
      "OXE": { "preserve": true },
      "reading list": {
        "description": "Stories saved to read later.",
        "translations": {
          "es": "lista de lectura",
          "pt": "lista de leitura",
          "fr": "liste de lecture",
          "it": "lista di lettura"
        }
      }
    },
    "translation": {
      "provider": "openai",
      "model": "gpt-5.6-luna",
      "apiKeyEnv": "OPENAI_API_KEY",
      "concurrency": 4
    },
    "onMissing": "error"
  }
}
```

After building the compiler, i18n, and CLI packages, translation is always an
explicit operation:

```dotenv
# .env
OPENAI_API_KEY="your-key"
```

```sh
node packages/cli/dist/cli.js i18n sync --project examples/localization
node packages/cli/dist/cli.js i18n check --project examples/localization
```

The CLI loads `.env` from the project and current working directory without
overriding variables already present in the shell. The API key is read only from
the configured environment variable and is never written to catalogs or
manifests. Sync sends only new and changed authored messages—with dynamic values
represented by placeholders—to OpenAI; it never sends runtime user data.
Successful batches are checkpointed, and an unchanged sync makes no API request.
Plural and ordinal messages generate every category reported by the platform
`Intl.PluralRules` implementation for each locale. Generation also receives the
authored purpose, component/element context, named context selectors, and project
glossary. Glossary changes invalidate generated drafts while preserving reviewed
human translations. Locale concurrency is bounded (four by default, configurable
from one through sixteen) so large locale sets finish faster without issuing an
unbounded request burst.

Compiler lowering is wired into both DOM generation and synchronous SSR. It
reactively formats translated text and attributes, preserves reorderable inline
markup as structured nodes, and uses cached platform `Intl` formatters for
currency and temporal values. The Playground's **Localization and Intl** example
exercises that generated path with the Spanish catalog.
`i18n check` is the deterministic build hook and never accesses the network,
performs translation, or writes catalogs.

Launch the browser playground from the repository root:

```sh
pnpm playground
```

The playground keeps the last valid preview visible while edited source has
errors. Fixed example projects expose accessible file tabs, per-file drafts and
reset state, file-aware diagnostics, and active-file AST and token views. It also
exposes generated JavaScript, preview console/runtime failures, compile and mount
timings, DOM mutation counts, reactive explanations, and the live owner/resource
tree. Its Performance view collects five-run warm-browser compile and mount
distributions alongside graph, mutation, and payload boundaries; the complete
methodology is in [docs/performance.md](docs/performance.md). Its semantic graph inspector links every node
back to the right source file and summarizes its owner, inputs, consumers, props,
and related component nodes. The local size report links the whole project,
builds the generated app with esbuild, and reports raw, minified, gzip, and Brotli
bytes for the shipped application payload (`generated app + @oxe/runtime +
@oxe/runtime-dom`). Compiler, editor, and Vite development code are deliberately
excluded.

The current SSR slice, portability boundary, deliberate limitations, and next
hydration/streaming steps are documented in
[docs/server-rendering.md](docs/server-rendering.md).
The filesystem contract, authored route inputs, nested SSR composition,
persistent layout lifecycle, and URL policy are documented in
[docs/routing.md](docs/routing.md).
Typed server functions reuse ordinary async OXE assignments. Their definitions,
transport validation, safe errors, server-only context, and compiler boundary are
documented in [docs/server-functions.md](docs/server-functions.md).

After `pnpm build`, inspect the JavaScript generated from the authored counter:

```sh
node examples/counter/compile.mjs
```

The lower-level runtime example remains available with:

```sh
node examples/runtime-counter.mjs
```
