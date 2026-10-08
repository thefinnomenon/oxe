# TinyTodo local application

This package is a runnable browser projection of
`examples/application-graph-todo/graph.json`. The graph supplies the app name,
authentication routes, authenticated landing route, and generated server
function IDs. Better Auth owns account/session storage in the PostgreSQL `auth`
schema; OXE owns Todo data in `oxe_todo`.

## Run locally

Prerequisites: Node 24+, pnpm 10.11, and a running PostgreSQL database you can
create schemas and tables in.

```sh
createdb oxe_todo_dev
export DATABASE_URL='postgres://localhost/oxe_todo_dev'
pnpm todo
```

Then open <http://127.0.0.1:3000>. The development server applies idempotent
Better Auth and OXE migrations before accepting requests. It uses a local-only
development auth secret when `BETTER_AUTH_SECRET` is unset; set a secret of at
least 32 characters before sharing or deploying the server.

Optional settings:

- `HOST` defaults to `127.0.0.1`.
- `PORT` defaults to `3000`.
- `BETTER_AUTH_URL` defaults to `http://$HOST:$PORT`.
- `OXE_ALLOWED_ORIGINS` is an optional comma-separated list of additional exact
  public origins (for example a Cloudflare Tunnel hostname). The canonical
  Better Auth URL is always included.
- `BETTER_AUTH_SECRET` is required when `NODE_ENV=production`.
- `OXE_DEVELOPMENT_OPERATIONS_TOKEN` optionally enables the metadata-only runtime
  operations endpoint. Use a random value of at least 32 characters and set the
  same server-only value on the workspace. The token is never emitted to a browser.

The application starts its leased PostgreSQL outbox worker after all migrations
succeed. `SIGINT` and `SIGTERM` stop HTTP acceptance, drain the current worker
batch up to its configured timeout, and close the application and authentication
pools in order. Worker errors are reported without serializing job input or user
context.

Create two accounts in separate browser sessions to verify sharing and isolation.
Each user can create teams; an owner can invite another existing account by the
user ID shown in its header. The invited user must accept before the shared team
appears in their switcher. Owners can inspect and revoke pending or accepted
memberships, and the database permits at most one membership per user and team.
Tasks are assigned from the server-resolved Team context, and users can list,
create, toggle, rename, and delete tasks only inside an authorized selected team.
Authorization is enforced
at the generated PostgreSQL operation boundary rather than by hidden UI controls.

The build regenerates typed client facets plus one shared browser runtime from the
normalized application graph. The runtime validates server result shapes,
deduplicates equal in-flight reads, and keeps successful reads in a user-scoped
memory cache for 30 seconds by default. Successful Todo mutations
invalidate `query.myTasks` automatically. The generated async factory loads the
no-store `/api/context` endpoint and derives cache scope from its server-verified
`userId` and ordered active context-role chain. The client then
propagates that resolved chain on every RPC; callers cannot supply an arbitrary
cache key. TinyTodo uses owner-or-member access plus an owner-only management
role. Personalized HTML and
configuration remain `no-store`.

`pnpm --filter @oxe/todo bench:client` rebuilds and reports raw, gzip, and Brotli
sizes for the generated client and complete browser bundle, plus median client
factory, cache-hit, and validated-response timings. On the r16 fixture, the latest
local run measured a 34,778-byte monolithic browser bundle (8,744 gzip, 7,793
Brotli) and a 34,481-byte five-chunk split bundle (9,959 gzip, 8,875 Brotli).
The split entry was 23,867 bytes (6,294 gzip, 5,603 Brotli). Building the same
graph with a deliberately duplicated self-contained runtime in every facet measured
12,146 Brotli bytes, so the shared-runtime split is 26.9% smaller. Runtime medians
were 0.709 µs for client construction, 0.240 µs for a cache hit, 5.572 µs for
one-row validation, and 56.025 µs for 100 rows. A 10,000-client sample retained
about 2,702 heap bytes per client; results vary by machine.

`pnpm --filter @oxe/todo bench:authoring` measures the compact semantic projection,
typed mutation output, normalized/lowered/generated comparison inputs, diagnostics,
impact scope, and mutation-preview time. `pnpm --filter @oxe/todo bench:browser`
launches installed Chrome headlessly against a running app and verifies authenticated
SSR shell adoption, keyboard/mobile behavior, dark theme, and reduced motion. See
`docs/ai-authoring-benchmark.md` for the proxy's limits and controlled model A/B
protocol.

The initial task-list placeholder is graph-derived and server-rendered. The browser
host adopts the matching revision/view hydration identity before loading data. The generated loading
projection preserves the repeat template's form, checkbox, text field, and
buttons as one inert representative row, with responsive, dark-mode, and
reduced-motion styling supplied by this host.
