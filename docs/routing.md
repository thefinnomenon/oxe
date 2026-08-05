# Routing and navigation

OXE routing is a small application-graph layer, not a requirement to adopt a
monolithic framework. The current slice supplies route discovery, matching,
browser history, atomic navigation, and persistent DOM segment ownership. The
compiler can emit each layout or page as an independently loadable artifact.

## Filesystem contract

Routes live beneath `src/routes` by default:

```text
src/routes/
  layout.oxe
  page.oxe
  projects/
    layout.oxe
    page.oxe
    [projectId]/
      page.oxe
  docs/
    [...path]/
      page.oxe
```

- `page.oxe` creates a URL route and exports `Page`.
- `layout.oxe` exports `Layout`, may render the implicit `{children}` slot, and
  persists while navigation remains beneath its directory.
- `[name]` captures one decoded path segment as a string.
- `[...name]` captures one or more final segments as a readonly string array.
- Static routes take precedence over dynamic routes, which take precedence over
  catch-all routes. Ambiguous URL shapes are compile-time manifest errors.

Matching is case-sensitive. Application URLs never retain a trailing slash. A
base path is configured when the manifest is created. The server request URL is
the source of truth for initial matching; the browser adopts that same location.

## Segment compilation and persistence

`createFileRouteManifest` produces a serializable manifest whose routes contain
a root-to-leaf chain of stable layout and page segment ids. Each id points to one
independently loadable module. The compiler's `routeSegment` mode allows a layout
entry to consume only `children`, keeps pages prop-free, and emits a
`build…RouteSegment` export.

`createDomRouteSegmentArtifact` adapts that generated builder to an owned DOM
artifact. `createDomSegmentTransition` retains the longest common segment prefix,
loads and builds the divergent suffix away from the live document, and performs
one synchronous commit. Consequently:

- existing UI remains interactive while route code loads;
- abandoned loads receive an `AbortSignal` and their staged owners are disposed;
- persistent layouts and same-page owners retain local state;
- a different page disposes only the old divergent suffix.

## Authored route inputs

Route reads and navigation are compiler intrinsics, so pages and layouts do not
need a framework context object or host adapter:

```oxe
export Page():
  location = useLocation()
  params = useParams()
  search = useSearchParams()

  openNext():
    navigate("/projects/beta", { scroll: "preserve" })

  showActivity():
    setSearchParams({ tab: "activity" }, { replace: true })

  <main>
    <h1>Project {params.projectId}
    <p>{location.pathname}: {search.tab}
    <button onClick={openNext}>Next project
    <button onClick={showActivity}>Activity
```

Semantic analysis lowers each intrinsic to an explicit route capability node in
the UI graph. Generated route builders receive a narrow reactive route runtime;
ordinary component mounts require that runtime only when their graph reads or
writes route state. Nested generated components inherit the same runtime.

## URL state

The router runtime exposes reactive `location`, `params`, `search`, and
`snapshot` readables plus `navigate` and `setSearchParams` operations. In authored
code, `useSearchParams()` is property-readable and returns the first value for a
key. A missing search key returns `null`; an explicitly empty key returns `""`.
The lower-level router search API preserves repeated keys through `getAll`.
Passing `null` to `setSearchParams` deletes the key.

This follows the language-wide decision that `null` is the single authored
absence value. Authored nullable type syntax (`string?`) and null-coalescing are
still a separate language implementation step; the router boundary does not
introduce `undefined` as an alternate state.

Navigation keeps the current UI until preparation succeeds, then updates DOM,
history, and reactive route state atomically. Push history and scroll-to-top are
the defaults. `{ replace: true }` replaces history and
`{ scroll: "preserve" }` retains scroll. Browser back/forward leaves native scroll
restoration intact. After a client push or replacement, focus moves to the last
`data-oxe-route-focus` target, or the deepest available `main`/`h1` fallback.

## Server rendering and browser adoption

`@oxe/router/server` composes the matched segment chain without introducing a
second routing model. `composeRouteServerPlan` independently loads every matched
layout/page plan, validates that each plan belongs to the expected segment, and
fills the single layout content slot from leaf to root. Route capability reads
resolve from the server match, so `location`, `params`, and search values produce
the same initial HTML as the browser runtime.

`renderRouteToString` renders that composed plan and returns the matched route.
`serializeRouteSnapshotScript` emits the adoption payload. A browser router uses
the serialized snapshot only when its schema, route id, matched URL, and current
browser URL all agree; otherwise it rematches the browser URL rather than
hydrating stale route state.

## Playground

The **Persistent routing** playground project compiles five real filesystem
route modules as independently loadable segment artifacts. It demonstrates a
root persistent layout, a nested projects layout, dynamic `projectId` params,
property-readable search state, push navigation, scroll preservation, and
replacement search updates. The preview imports a segment only when the router
first requests it and uses the same persistent transition implementation as an
application host.
