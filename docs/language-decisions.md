# OXE language decisions

This document records the current authored language surface for OXE. It separates
decisions that are settled from syntax and runtime details that are still open.

OXE is designed for applications written and maintained primarily by AI while
remaining straightforward for people to review. The authored language expresses
relationships and product behavior; the compiler owns reactivity, scheduling,
loading, cancellation, cleanup, and targeted updates.

## Settled principles

- Prefer one canonical way to express common application behavior.
- Add syntax only when intent cannot be inferred safely or meaningful policy must
  be explicit.
- Keep the source ordinary and reviewable. Compiler complexity must not become
  hidden ambiguity.
- Compile source into a normalized dependency graph that tooling and AI can
  inspect.
- Reject conflicting or cyclic relationships with actionable diagnostics.

## Components and values

Components use this shape:

```oxe
UserCard(userId):
  user = getUser(userId)
  displayName = user.name

  <article>
    <h2>{displayName}
```

Components, functions, and handlers use a trailing colon and significant
indentation. Conditional choices use `?`, `=?`, and indentation. Curly braces
never delimit blocks.

Ordinary component code does not require `function`, `let`, `const`, `return`,
`state`, `async`, or `await`.

A top-level assignment establishes a persistent reactive relationship:

```oxe
displayName = user.name
editor.draft.title = initialTitle
document.title = editor.draft.title
```

The compiler evaluates the relationship initially and again when a dependency
changes. The component is initialized once to construct this graph; the compiler
updates only affected graph nodes afterward.

Functions and event handlers are procedural, transactional, and source ordered:

```oxe
reset():
  editor.draft.title = initialTitle
  editor.draft.body = initialBody
  editor.dirty = false
```

Procedural writes do not create persistent relationships.

Record dependencies are tracked at the field path that is actually read. A
consumer of `profile.name` does not rerun when `profile.status` changes, while a
consumer of the whole `profile` record observes any unequal replacement. Nested
reads such as `profile.account.name` track the complete leaf path. This is a
compiler/runtime optimization and adds no alternate authored record API:

```oxe
rename():
  profile.name = "Grace"

incrementScore():
  profile.stats.score = profile.stats.score + 1
```

Both writes remain immutable internally. The runtime preserves stable selected
path sources and invalidates only selections whose resulting values changed.

Record literals use `{ name: value }`, member access uses `.`, and calls use the
ordinary `callee(arguments)` form:

```oxe
user = { name: "Chris", active: true }
label = formatName(user.name)

notify(message):
  logger.info(message)
```

Curly braces remain syntax for record values and markup interpolation, never for
blocks. Calls are graph expressions. The executable slice resolves procedure
capabilities; value-returning helpers and external platform capabilities follow
with their function declarations and metadata.

### Local component composition

Component composition uses uppercase local component names and an exact named
contract:

```oxe
App():
  count = 0

  increment():
    count = count + 1

  <Counter count={count} onIncrement={increment}>

Counter(count, onIncrement):
  doubled = count * 2

  <section>
    <button onClick={onIncrement}>Count: {count}
    <p>Doubled: {doubled}
```

The narrow slice is intentionally strict:

- An uppercase markup name resolves to exactly one component declaration in the
  same module. Lowercase names remain platform elements.
- Declaration parameters define the complete ordered contract. Required
  parameters must be supplied once as named props; defaults may be omitted, and
  unknown props require one final rest parameter. Duplicate props remain
  compiler errors.
- A value prop is a reactive relationship, not a snapshot. Here, changing the
  parent `count` updates both the child's direct read and `doubled` without
  rerunning or replacing the component tree.
- A procedure prop is an explicit capability. `onIncrement` lets the child invoke
  the parent-owned procedure without giving it ambient write access to the
  parent's state.
- Each invocation creates a child ownership region. Its computations, event
  listeners, and future resources are disposed with that instance.
- Defaults, rest capture, component prop forwarding, and implicit child content
  are implemented for local components. Ordinary function calls remain a
  separate feature.

The semantic graph retains component definitions, parameter contracts,
invocations, reactive/procedure prop edges, and ownership even when the compiler
specializes a local component into smaller direct-DOM output.

### Defaults, rest props, spreads, and children

Component parameter defaults use the familiar JavaScript spelling. A caller may
omit a parameter only when the declaration supplies its default:

```oxe
Label(text, prefix = "Status"):
  <p>{prefix}: {text}
```

An explicit final rest parameter collects additional named props. Unknown props
remain errors when a declaration has no rest parameter:

```oxe
App():
  <Card title={"Release notes"} tone={"quiet"}>
    <p>Everything shipped successfully.

Card(title, ...props):
  <Frame {...props}>
    <h2>{title}
    {children}

Frame(...props):
  <article>
    {children}
```

Prop spreads use the JavaScript form and preserve their authored ordering among
individually named props. In the current implemented slice, a spread source must
be the component's final rest parameter and its target must be another local
component. This keeps every forwarded prop compiler-visible. Arbitrary host
element spreading such as `<article {...props}>` is not implemented; DOM
attributes will use a typed platform contract instead of an opaque property bag.

Indented content under an uppercase component invocation is passed as the
reserved reactive `children` value. The callee renders it where `{children}`
appears:

```oxe
App():
  <Card title={"Release notes"}>
    <p>Everything shipped successfully.
```

There is no declared or named `children` prop, separate wrapper component, or
provider. Using `{children}` once in a component body synthesizes its optional
reserved children contract; indented caller content supplies it. Defaults, a
single final `...props` parameter, component `{...props}` forwarding, and
indented child content are the canonical forms.

### Component modules

Component imports and exports use JavaScript-familiar spellings:

```oxe
import { Card } from "./Card.oxe"

export App():
  <Card title={"Release notes"}>
    <p>Everything shipped successfully.
```

Named imports and direct declaration exports are implemented for fixed project
files. An uppercase component reference resolves to a local declaration or one
explicit named import; OXE does not add an alternate component registry or
implicit file lookup. The first module slice deliberately has no default,
namespace, aliased, dynamic, side-effect-only, or re-export forms. Relative
imports name an exact `.oxe` file, and the host selects one explicitly exported
zero-parameter component as the application entry.

## Markup

Markup opening declarations always end with `>`. Indentation defines children,
and a dedent closes the element. Authored OXE has no closing element tags and no
separate `/>` form.

Inline text or an expression follows the opening declaration on the same line:

```oxe
<h1>{heading}
<button onClick={save}>Save changes
```

Indented lines form a child tree:

```oxe
<main>
  <header>
    <h1>{heading}
    <button onClick={createProject}>New project
  {content}
```

The dedent before `{content}` closes `header`; the later dedent closes `main`.
A leaf element still ends its opening declaration with `>` but needs no special
self-closing punctuation:

```oxe
<input value={editor.draft.title}>
```

For multiline properties, the formatter places `>` on its own line so new
properties can be inserted without moving the terminator:

```oxe
<ProjectRow
  key={project.id}
  project={project}
  onOpen={() => openProject(project)}
>
```

The compiler rejects `</Element>` and `/>` and explains that elements close by
dedentation. Lowercase platform elements and uppercase components follow the same
rules.

## Logical operators

Boolean composition uses the word operators `and` and `or`. Unary negation uses
`!` rather than `not`:

```oxe
user and !user.disabled ? <Profile user={user}>

canPublish = isOwner or permissions.canPublish
```

`!` binds more tightly than comparison, `and`, and `or`. Membership and
null-value syntax are separate decisions.

## Equality

OXE has one type-safe equality pair:

```oxe
user.id == owner.id
user.status != "disabled"
```

There is no `===` or `!==` and no coercive equality. The compiler rejects
comparisons between incompatible types.

## Control flow

OXE has one punctuation-led conditional family and no `if` keyword. A single
guard can stay on one line:

```oxe
sidebar.open ? <Sidebar>
```

Its inline binary form adds a `:` fallback and can produce a value:

```oxe
label = user ? user.name : "Guest"
```

Adjacent guards are independent. Both results can therefore occur when both
conditions are true:

```oxe
isAdmin ? <AdminBadge>
isOnline ? <OnlineBadge>
```

A standalone `?` opens one uncaptured, first-match choice. All arms are
indented, each condition and short result stay on one line, and a bare `:`
introduces the optional catchall and must be last:

```oxe
?
  user ?
    greeting = formatGreeting(user)
    <Profile user={user} greeting={greeting}>
  error ?
    logger.error(error)
    <Error error={error}>
  : <Login>
```

`=?` is the single token that opens the captured form of the same first-match
choice:

```oxe
displayName =?
  user ? user.name
  error ? "Unavailable"
  : "Guest"
```

Captured markup uses the same form and stores a content template rather than DOM
nodes. Every `{view}` placement owns its own instantiated branch, listeners, and
reactive work:

```oxe
view =?
  user ? <Profile user={user}>
  : <Login>

<main>
  {view}
  {view}
```

Only results containing multiple statements open an additional indented block.
A one-expression result stays on the same line as `?` or `:`, including the
catchall. The first condition in a choice that evaluates to true wins. A
value-producing inline conditional or `=?` choice must be exhaustive; an
uncaptured guard or `?` choice may omit its catchall.

These are inline, guarded, and multi-arm forms of the same conditional family,
not separate control-flow constructs. OXE does not add `if`, `else`, `when`,
`match`, `switch`, or `case`. The `=>` token is reserved for functions and
callbacks.

Collections use pure transformations when producing another value:

```oxe
items.map(item => <Item item={item}>)
```

OXE has no `for` loop and does not require framework wrappers such as `Show`,
`For`, or `Map`. Collections use value-producing functional operations such as
`map`, `filter`, `flatMap`, `reduce`, and `sort`. `sort` never changes its source;
it returns a stable ordering by the callback key:

```oxe
alphabetical = users.sort(user => user.name)
newestFirst = users.sort(user => user.createdAt, { descending: true })
```

Writable collections have one small mutation surface:

```oxe
addUser():
  users.add({ id: nextId, name: "Ada" })

renameUser():
  users.update(user => user.id == selectedId, user => user.name = newName, 1)

removeInactive():
  users.remove(user => user.active == false)
```

`add(value)` appends one value. `update(predicate, updater, limit?)` and
`remove(predicate, limit?)` affect every match when the limit is omitted and the
first N matches in current collection order when it is present. A limit must be
a nonnegative integer. An update callback can make several related field writes
in an indented body; those writes produce one replacement item:

```oxe
users.update(user => user.id == selectedId, user =>
  user.name = newName
  user.active = true
)
```

Record fields use the same direct write style in procedures:

```oxe
rename():
  profile.name = "Chris"
  profile.address.city = "New York"
```

These operations do not expose in-place array or object mutation. The compiler
lowers them to immutable replacements, suppresses no-op collection writes, and
lets keyed UI rows preserve identity. The same operation contract can be lowered
by a server data provider, but a provider must require a stable order or unique
predicate before accepting a limited multi-record mutation.

The compiler turns markup-producing conditionals and `map` expressions into
incremental regions and infers identity where possible. An explicit `key` on the
produced component remains an escape hatch:

```oxe
users.map(user => <UserCard key={user.id} user={user}>)
```

Callbacks use arrow syntax. A simple callback remains on one line:

```oxe
activeUsers = users.filter(user => user.active)
```

A callback with multiple statements uses indentation rather than curly braces;
its final expression is the result:

```oxe
cards = users.map(user =>
  displayName = formatName(user)
  <UserCard user={user} displayName={displayName}>
)
```

## Context

A context declaration is identified by `createContext()`, not by a naming suffix. The
recommended convention is a descriptive name ending in `Context`:

```oxe
SessionContext = createContext()
```

Names such as `Session` and `Theme` remain valid because the convention is not a
compiler rule. An ordinary component or value may also end in `Context`; spelling
never determines context identity.

The context object itself provides and retrieves its value:

```oxe
App():
  session = createSession()

  <SessionContext value={session}>
    <Router>

Header():
  session = SessionContext()

  <Avatar user={session.user}>
```

Context rules:

- `createContext()` creates a unique identity; matching never uses a variable's
  textual name.
- `<SessionContext value={session}>` provides a value to its descendant subtree.
- `SessionContext()` retrieves the nearest matching value.
- Nested providers override the value only for their descendants.
- Context transports the original reactive value and preserves its writability.
- Context does not create state or persistence. It scopes access to a value.
- Shared context state may be written directly; no setter, reducer, action object,
  or separate store primitive is required.
- A top-level shared write is a reactive relationship. A write inside a function
  or handler is procedural.

Example shared write:

```oxe
TitleInput():
  editor = EditorContext()

  rename(title):
    editor.draft.title = title

  <input value={editor.draft.title}>
```

## Automatic reactive work

OXE application code does not expose `createEffect`. Top-level assignments,
function calls, and control flow are automatically tracked:

```oxe
document.title = editor.draft.title
analytics.identify(session.user.id)

session.user ? analytics.identify(session.user.id)
```

The compiler still generates internal effect nodes. Removing the authored
primitive does not remove effect ownership, dependency tracking, scheduling, or
error reporting from the runtime.

Multiple imperative statements can be grouped in an ordinary helper:

```oxe
synchronizeEditor(element, draft):
  element.setDocument(draft)
  element.refreshPlugins()
  element.measure()

Editor():
  editor = EditorContext()

  synchronizeEditor(element, editor.draft)

  <LegacyEditor ref={element}>
```

## Untracked reads

`untrack(expression)` is a compiler intrinsic:

```oxe
analytics.trackUserChange(user.id, untrack(cart.items.length))
```

It evaluates its complete argument expression when the surrounding relationship
runs but does not add reactive reads inside that expression as dependencies. It
does not copy, freeze, or otherwise change the resulting value.

In the example above, `user.id` reruns the call. A change to `cart.items.length`
alone does not.

`snapshot` is intentionally not used for this behavior because a future snapshot
feature may represent a stable state capture for debugging, replay, undo, or
transactions.

## Resource cleanup

OXE application code does not expose `onCleanup`. Resources must use a
compiler-known disposal contract. A reactive resource is disposed before it is
replaced and when its owning graph region is removed.

Conceptually, an adapter for a subscription library looks like this:

```oxe
subscribeToMessages(roomId): Disposable:
  subscription = legacyMessages.subscribe(roomId)

  {
    dispose():
      subscription.unsubscribe()
  }
```

Application code remains declarative:

```oxe
Chat():
  room = RoomContext()
  connection = subscribeToMessages(room.id)

  <Messages>
```

The compiler must reject an effectful external resource whose cleanup behavior is
unknown and direct the author to create or install a typed adapter. Cleanup must
not be guessed from a function or method name.

External resources use an explicit compiler capability contract with
`kind: "resource"` and `dispose: "dispose"`. Generated ownership disposes the
previous resource before dependency-driven replacement and disposes the current
resource when its graph region is removed. A resource contract without disposal
metadata is rejected; cleanup is never guessed from a method name.

## Platform capability contracts

External calls are unavailable until the host supplies a compiler contract. A
contract declares the exact dot path, parameter types, optional return type,
effect classification, target availability, and—when relevant—the persistent
host target it writes:

```ts
{
  name: "analytics.identify",
  kind: "effect",
  parameters: ["string"],
  target: "client"
}

{
  name: "messages.subscribe",
  kind: "resource",
  parameters: ["string"],
  dispose: "dispose"
}
```

`pure` capabilities must declare a return type when their result is captured.
`effect` capabilities cannot be captured as values. `resource` capabilities are
compiler-owned and cannot be assigned procedurally. Client/server mismatches,
argument count/type mismatches, unknown cleanup, and competing persistent
writers are compile errors.

## Absence, optional values, and returns

The synchronous language foundation uses these rules:

- Authored application data has no implicit `undefined`. The compiler may use an
  internal unbound state for a DOM ref, but ref-dependent work is installed only
  after the element has been bound.
- `null` will be the single authored absence value when nullable types are added;
  `undefined`, missing record keys, and sentinel strings will not be alternate
  spellings.
- Record fields are required by default. Schema/type contracts will mark an
  optional field explicitly; reading one therefore produces a nullable value.
- Procedures and effects return no value. A pure external capability must declare
  its return type before it can appear on the right side of an assignment. An
  omitted capability return contract means that the call is non-value-producing.

This locks the contracts without exposing partially implemented nullable syntax
in authored `.oxe` files.

## Async dataflow

Async values use ordinary assignments:

```oxe
user = getUser(id)
organization = getOrganization(user.organizationId)
```

The graph determines sequencing and concurrency. Strict consumers wait for the
value they need, and obsolete work is cancelled or ignored. Authored code does
not expose `async`, `await`, pending state, concurrency, priority, or scheduler
controls for normal dataflow.

Compiler-visible async platform capabilities use `kind: "async"` and must
declare a return type. Their return values remain plain in authored OXE; the
graph records the capability, canonical arguments, and host scope that form the
resource identity.

Equal identities share one in-flight request across consumers. Owners are
reference-counted, the last disappearing consumer aborts pending work, and a
late completion from an obsolete identity is ignored. An identity change resets
the value to pending. The one explicit refresh operation is:

```oxe
reload():
  refresh(user)
```

Refreshing the same identity retains its ready value while new work runs. Async
lineage propagates through derived values and component props, including exact
record paths such as `user.name`; authored resource wrappers are not required.

## Loading and errors

The compiler generates pending modes from the real consuming template without
authored loading syntax. Text receives a short inline placeholder; a pending
attribute preserves its owning element and dimensions; a conditional preserves
one inert branch shape; and a collection preserves one representative inert row.
Compiler-generated controls do not receive event behavior while pending.

Call-site/component overrides and skeleton hints are deliberately not part of the
language yet. They should be introduced only after concrete applications show
that automatic geometry plus host styling is insufficient.

Async failures use one typed error channel with `not-found`, `unauthorized`,
`forbidden`, `validation`, and `unexpected` classifications plus an HTTP status.
They bubble to one global error policy. Validation failures normally stop at a
form/action boundary; authentication policy may render, redirect, or choose the
final response. A nearest component/route error boundary remains a possible
future feature, not settled authored syntax.

Loading regions are compiler-derived at the smallest consuming text, attribute,
or structural site. Static siblings render immediately. Disconnected consumers
of one resource retain separate visual regions while one resource completion can
reveal all of them in the same streamed batch.

## Routing

Routing is filesystem-based beneath `src/routes`: `page.oxe` defines a route,
`layout.oxe` defines a persistent parent, `[param]` is dynamic, and
`[...param]` is a final one-or-more catch-all. Static segments take precedence
over dynamic segments and catch-alls. Matching is case-sensitive, canonical URLs
omit trailing slashes, and deployments may configure one base path.

The authored graph exposes focused route primitives:

```oxe
location = useLocation()
params = useParams()
search = useSearchParams()

openProject():
  navigate("/projects/alpha")

showActivity():
  setSearchParams({ tab: "activity" }, { replace: true })
```

URL state is not directly assignable because navigation can require options such
as history replacement and scrolling. Missing search keys produce `null`, empty
keys produce `""`, and repeated keys remain available as ordered values. Client
navigation keeps the current view while independently compiled changed segments
load, retains the common layout prefix, cancels abandoned owners, and commits the
new suffix atomically. Push history and scroll-to-top are defaults; replace and
scroll preservation are explicit options. The server request URL is the initial
source of truth.

## Typed server functions

Server functions reuse the existing external capability and ordinary async-value
syntax. OXE does not add `server`, `async`, RPC, request, or response syntax to an
application component:

```oxe
ProjectPage():
  project = projects.read("project-1")

  <h1>{project.name}
```

The host supplies a versioned `oxe.server-function.v1` definition. It contains a
stable id, compiler-visible dot path, `query` or `mutation` classification,
ordered named parameters, and a result schema. The compiler records the stable
server-function id on the async capability node and preserves it in the server
render plan. Browser code calls a transport adapter; SSR hosts may execute the
same definition locally through their capability resolver.

The first transport schema deliberately supports only required JSON values:
booleans, finite numbers, strings, homogeneous arrays, and exact records. Nested
schemas provide runtime validation rather than relying on TypeScript alone.
`undefined`, `null`, optional fields, non-finite numbers, `Date`, `BigInt`, binary
data, class instances, symbols, functions, unknown record fields, and cyclic
values do not cross this boundary. Later type-system work may add nullable or
special scalar encodings by versioning the schema instead of accepting ambiguous
JSON conventions.

Client arguments are validated before transport, then revalidated before a
handler runs. Handler results are validated before serialization and again after
the client receives them. Payload byte, depth, and node-count limits are explicit.
Request context—including authentication, authorization, credentials, database
handles, and tenant scope—is supplied directly to the server handler and is never
part of an argument or response envelope.

Handlers may raise a deliberately public typed failure. Existing async failure
classes map to safe standard messages; arbitrary exceptions are reported only to
the host and cross the boundary as a generic unexpected failure. Abort signals
propagate from compiler-owned async resources through the transport into the
handler. HTTP route mapping, restrictive CORS, session construction, stronger
application-specific CSRF policy, rate limiting, and deployment-provider wiring
remain host responsibilities around this platform-neutral contract; the standard
Fetch adapter supplies POST, JSON, custom-header, same-origin, cache, and streaming
body-limit defaults without trying to construct an authenticated application
context.

## Persistence

Persistence is expressed through a structured `db` client rather than assignment
or database-specific language syntax:

```oxe
project = db.project.findUnique({
  where: { id: params.id }
})

updatedProject = db.project.update({
  where: { id: project.id },
  data: { name }
})
```

The compiler-visible client must expose models, fields, predicates, ordering,
relationships, writes, runtime tenant inputs, and consumers to the normalized
application graph. This information will support automatic caching, invalidation,
authorization auditing, metrics, debugging, and AI impact analysis.

The exact client API and cache invalidation utilities remain open.

## Required diagnostics

The compiler should reject or clearly diagnose:

- A missing required context provider
- Multiple persistent declarative writers for the same target
- Direct and indirect reactive cycles
- A self-dependent reactive assignment
- A non-Boolean conditional condition
- A value-producing conditional without a final fallback
- Conditional value branches with incompatible result types
- An external resource without a known disposal contract
- A server-only or client-only capability used in an incompatible target

Multiple procedural handlers may write the same value because their execution is
explicit and discrete.

## Current compiler slice

The executable slice now covers:

- required/default/rest component contracts, spreads, children, and named modules,
- component-local scalar, record, and homogeneous array assignments with member
  access,
- exhaustive inline and multi-arm scalar/content values, including multiline
  branch-local assignments and ownership-safe repeated content placement,
- arithmetic, strict equality, `and`, `or`, and authored `untrack(...)`,
- incremental single- and multi-branch UI conditional regions,
- concise and multiline collection callbacks; value-producing `map`, `filter`,
  `flatMap`, `reduce`, and stable pure `sort`; `add`/`update`/`remove` writes; direct
  record-field writes; and markup maps keyed by a scalar item or explicit `key`,
- static and reactive DOM attributes/properties, text interpolation, and
  `onClick`, and
- direct-DOM ownership, branch cleanup, and keyed insertion/movement/removal
  without a virtual DOM,
- compiler-owned async capabilities with canonical identity deduplication,
  cancellation, stale-result rejection, same-identity refresh retention,
  field-path derivation, component-prop propagation, and granular text/attribute
  bindings, and
- generated eager hydration entry points that restore serialized ready resources
  and adopt matching DOM without replacement.

The compiler classifies assignments as constants, writable cells, or derived
computations and emits explicit reactive/procedural edges. Keyed collection item
bindings and region ownership are also explicit graph nodes. This is
implementation status, not a reduction of the settled language. Ordinary calls
through compiler-visible procedure capabilities are implemented. Contexts,
typed platform capabilities, compiler-owned resources, platform refs, and static
DOM template cloning are also implemented. The current graph lowers to both a
JSON-only synchronous server plan and a v2 deferred-region plan. The inert patch
transport, checkpoint serialization, and eager DOM-adoption primitives are
implemented. A backend-neutral readiness executor now deduplicates equal runtime
identities, writes independent regions as they settle, batches shared readiness,
awaits sink backpressure, aborts outstanding work, preserves typed failures, and
serializes final checkpoints. The initial JavaScript plan adapter renders a
static shell plus granular text, attribute, derived-child-prop, structural, and
keyed-collection patches using request-local component and keyed-row paths.
Same-resource consumers inside structural reveals resolve in the enclosing patch;
newly exposed resources and regions register dynamically with the portable
executor. Compiler-owned comment markers let eager hydration adopt conditional
and keyed regions, while stable event ids plus occurrence indexes replay early
clicks and inputs after listener attachment. Direct same-component async request
dependencies wait for their argument resources before calculating identity or
starting work. Dependent identities now trace through forwarded component props
and mapped row values. The compiler generates localized text, attribute,
structural, and representative-row pending companions; failures route to one
global policy; root structural work gates HTTP status; and hydration recovers the
nearest source-linked conditional or keyed boundary after verifying the build
fingerprint. Authored loading/error override syntax remains intentionally absent.
Top-level helper declarations and authored nullable types also remain open.

## Open language questions

- Contexts always require a provider; `createContext()` has no default-value form
- Focused primitives, if any, for previous values, change-only observation, and
  special lifecycle timing
- The exact database client, cache, and external invalidation APIs
- Whether the canonical indentation width is two spaces. The initial scanner uses
  two spaces to exercise strict indentation diagnostics, but this is not yet a
  settled language decision.
