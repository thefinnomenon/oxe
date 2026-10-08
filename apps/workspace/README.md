# OXE development workspace

The running application is the development workspace. It fills the browser while
a floating OXE control opens the agent, graph, revision, runtime, and performance
tools in an overlay. The agent panel is responsive down to phone viewports and
can be closed at any time to retest the application directly.

From the repository root:

```sh
pnpm workspace
```

Open `http://127.0.0.1:4175`. By default the workspace connects to TinyTodo at
`http://127.0.0.1:3000`. Override the URL or workspace port when needed:

```sh
OXE_APPLICATION_URL=http://127.0.0.1:3001 OXE_WORKSPACE_PORT=4176 pnpm workspace
```

For a remotely accessible workspace, keep `OXE_APPLICATION_URL` on loopback.
The workspace mounts the application at `/__app` on its own origin, so the live
application, authentication cookies, and development tools share one `-dev`
hostname:

```sh
OXE_APPLICATION_URL=http://127.0.0.1:3000 \
OXE_WORKSPACE_ALLOWED_ORIGINS=https://oxe-dev.example.com \
pnpm workspace
```

Revisions persist in `apps/workspace/.oxe/workspace.sqlite`. Override
`OXE_WORKSPACE_DB` to use a different revision store. The directory is ignored by
Git; generated artifacts remain disposable and can be rebuilt from the stored
graph revision.

## Revision publication

The workspace reports the committed graph head separately from the active
last-good application revision. Commits are serialized through a staged
publication coordinator. Generated artifacts become active immediately when no
runtime adapter is configured. When `DATABASE_URL` is configured, the shipped
Node adapter builds a production candidate, creates and migrates a disposable
PostgreSQL database, copies bounded development data, health-checks the generated
runtime, and atomically activates its database, server, and browser target.
Build, migration, runtime, and activation failures leave artifact routes on the
previous revision and appear in the connection footer with the failed candidate
and stage. The committed revision remains in history for inspection and repair.

The active hot-runtime pointer is persisted atomically and recovered after a
workspace restart. A failed candidate is cleaned up and can be retried explicitly;
any historical revision can be restored as a new semantic revision without
rewriting history.

Set `OXE_AGENT_ENDPOINT` to a server-side provider adapter that implements the
versioned workspace model JSON boundary. The adapter receives the compact
semantic map and may request only typed `inspect` and `preview` tools. It never
receives `commit`; publication remains a fingerprinted human action in the review
card. `OXE_AGENT_BEARER_TOKEN` is optional and remains server-only. Without an
adapter, the composer falls back to bounded semantic search.

Alternatively, set `OPENAI_API_KEY` to use the built-in server-only Responses API
adapter. It defaults to `gpt-5.6-sol`; `OXE_OPENAI_MODEL` can pin another model.
`OXE_AGENT_ENDPOINT` takes precedence when both are configured. The API key,
model request, and tool results never pass through the browser.

For a Cloudflare Access-protected remote origin, keep this process bound to
loopback and configure exact origins and user emails:

```sh
OXE_WORKSPACE_ALLOWED_ORIGINS=https://dev.oxe.example \
OXE_WORKSPACE_ALLOWED_EMAILS=you@example.com \
pnpm workspace
```

Remote mutation and chat requests require both Cloudflare Access identity
headers and an allowlisted email. Forwarded host/protocol headers are not trusted;
the Node boundary selects the public origin from the exact Host allowlist. Local
loopback access remains available. A deployment that exposes the Node port
directly must install a cryptographic `authorizeMutation` callback instead of
relying on proxy-asserted identity headers.

## Runtime operations

Set the same random, server-only token on TinyTodo and the workspace to enable the
Runtime tab:

```sh
export OXE_DEVELOPMENT_OPERATIONS_TOKEN='replace-with-at-least-32-random-characters'
pnpm todo
# In a second shell with DATABASE_URL and the same exported token:
pnpm workspace
```

`OXE_DEVELOPMENT_OPERATIONS_URL` overrides the default
`$OXE_APPLICATION_URL/api/development/operations` upstream. The workspace proxies this
connection on the server, validates its versioned shape, and exposes only bounded
semantic metrics, worker counters, and dead-letter metadata. Job payloads,
execution context, provider errors, and the bearer token are never returned to
the browser. Reading runtime state and replaying a dead-letter job use the same
same-origin and Cloudflare Access-compatible authorization boundary as graph
mutations.

## Performance measurements

The Performance tab reads Navigation Timing, Paint Timing, and Resource Timing
from the same-origin application frame. It reports TTFB, first contentful paint,
DOM-ready and page-load timing, transferred and decoded bytes, request count,
and the five slowest resources. Resource URLs are reduced to paths so query
parameters are not displayed. When runtime operations are enabled, the panel
also aggregates privacy-safe call counts, failures, average duration, maximum
duration, and the slowest semantic node. Open the tab or select **Measure** to
refresh the snapshot.

## Development interaction context

An application may opt into the versioned
`oxe.application-development-interaction.v1` bridge by configuring the exact
development origin. TinyTodo uses:

```sh
OXE_DEVELOPMENT_PARENT_ORIGIN=https://oxe-dev.example.com
```

The application CSP then permits only that exact origin to embed it. The browser
host emits a bounded stream of semantic breadcrumbs containing the pathname,
interaction kind, outcome, and available stable element/operation/field IDs. It
never sends input values, record IDs, user IDs, query parameters, fragments, or
record-derived page text. The workspace accepts messages only from its configured
application frame and exact development origin, validates their structure, keeps
the most recent 20 in page memory, and sends at most 12 with a chat request.
Clearing the context removes them immediately.
