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
indentation. Conditional arms use `=>` and indentation. Curly braces never
delimit blocks.

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
if user and !user.disabled ? <Profile user={user}>

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

OXE has one conditional construct: `if`. A single condition can stay on one
line:

```oxe
if sidebar.open ? <Sidebar>
```

Its inline binary form adds a `:` fallback:

```oxe
label = if user ? user.name : "Guest"
```

When there are multiple conditional arms, `if` stands alone and all arms are
indented. `?` separates every condition from its result. A bare `:` introduces
the optional catchall and must be last:

```oxe
view = if
  user ?
    greeting = formatGreeting(user)
    <Profile user={user} greeting={greeting}>
  error ?
    logger.error(error)
    <Error error={error}>
  : <Login>
```

Only results containing multiple statements open an additional indented block.
A one-expression result stays on the same line as `?` or `:`, including the
catchall. The first condition that evaluates to true wins. A value-producing
conditional must be exhaustive; an action or UI region may omit its catchall.

This is the inline and multiline form of the same `if` construct, not a second
conditionless ternary operator. OXE does not add `else`, `when`, `match`,
`switch`, or `case`. The `=>` token is reserved for functions and callbacks.

Collections use functional operations:

```oxe
items.map(item => <Item item={item}>)
```

OXE has no `for` loop and does not require framework wrappers such as `Show`,
`For`, or `Map`. Collections use value-producing functional operations such as
`map`, `filter`, `flatMap`, and `reduce`.

The compiler turns markup-producing `if` and `map` expressions into
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

A context declaration must use an identifier ending in `Context`:

```oxe
SessionContext = createContext()
```

The compiler rejects both a context created without that suffix and a non-context
declaration that uses the reserved suffix.

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

if session.user ? analytics.identify(session.user.id)
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

The exact `Disposable`/cleanup type syntax and external-package metadata format
remain open.

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

## Loading and errors

The compiler generates skeleton and error modes from the real component template.
Components may provide companions:

```oxe
UserCard.skeleton = <UserCardSkeleton>
UserCard.error = (error) => <UserCardError error={error}>
```

Call sites may override or suppress their display:

```oxe
<UserCard skeleton={CustomSkeleton}>
<UserCard skeleton={false}>
<UserCard error={CustomError}>
<UserCard error={false}>
```

Override precedence is:

1. Call-site override
2. Component companion
3. Compiler-generated default

Supported skeleton hints include `skeleton:length`, `skeleton:lines`, and
`skeleton:count`.

Suppressing an error display does not suppress internal logging or development
tooling.

## Routing

Routing follows the focused Solid Router primitives:

```oxe
location = useLocation()
params = useParams()
[searchParams, setSearchParams] = useSearchParams()
navigate = useNavigate()
```

URL state is not directly assignable because navigation can require options such
as history replacement, scrolling, and navigation state.

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

- A context whose identifier does not end in `Context`
- A `Context`-suffixed identifier that is not a context
- A missing required context provider
- Multiple persistent declarative writers for the same target
- Direct and indirect reactive cycles
- A self-dependent reactive assignment
- An external resource without a known disposal contract
- A server-only or client-only capability used in an incompatible target

Multiple procedural handlers may write the same value because their execution is
explicit and discrete.

## Current compiler slice

The executable slice now covers:

- required/default/rest component contracts, spreads, children, and named modules,
- component-local scalar and homogeneous scalar-array assignments,
- arithmetic, strict equality, `and`, `or`, and authored `untrack(...)`,
- incremental single- and multi-branch UI `if` regions,
- concise `items.map(item => <Row ...>)` regions keyed by a scalar item or explicit
  `key`,
- static and reactive DOM attributes/properties, text interpolation, and
  `onClick`, and
- direct-DOM ownership, branch cleanup, and keyed insertion/movement/removal
  without a virtual DOM.

The compiler classifies assignments as constants, writable cells, or derived
computations and emits explicit reactive/procedural edges. Keyed collection item
bindings and region ownership are also explicit graph nodes. This is
implementation status, not a reduction of the settled language. General calls,
member access, records, multiline collection callbacks, contexts, async dataflow,
refs, source maps, SSR, and hydration remain subsequent slices.

## Open language questions

- The expression syntax used inside markup and the record/object literal syntax;
  indentation is locked for blocks, but these non-block uses of curly braces have
  not been decided
- Whether `createContext` should support a default value or always require a
  provider
- The exact nominal disposal types and external-library adapter metadata
- Focused primitives, if any, for previous values, change-only observation, and
  special lifecycle timing
- The exact database client, cache, and external invalidation APIs
- The final syntax for platform-specific capabilities across web, mobile, and
  desktop targets
- Whether the canonical indentation width is two spaces. The initial scanner uses
  two spaces to exercise strict indentation diagnostics, but this is not yet a
  settled language decision.
