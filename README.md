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
- `@oxe/compiler`: scanner, parser, semantic analysis, and deterministic DOM code
  generation.
- `@oxe/graph`: versioned UI graph types, structural validation, dependency-edge
  reconciliation, topology checks, and canonical JSON.
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
- `@oxe/server-functions`: versioned typed RPC contracts, deterministic manifests,
  exact request/result validation, safe error envelopes, cancellation, and
  Fetch/in-process transports for compiler-generated functions.
- `@oxe/playground`: browser compiler lab with native examples, an isolated DOM
  preview, diagnostics, generated output, graph inspection, and payload sizing.
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
pnpm --filter @oxe/runtime-server bench
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
capability contract discovery and final application bundling remain deployment
integration responsibilities in this first CLI build slice.

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
