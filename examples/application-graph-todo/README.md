# TinyTodo application graph

`graph.json` is the semantic source of truth for the authenticated Todo example.
It declares:

- a built-in authenticated `User` entity;
- `Team` entities owned by authenticated users;
- an owner-or-active-member `context.team` role and `Task.team -> Team` relation;
- an owner-only `context.ownedTeam` role for membership grants;
- graph-owned `TeamMembership` entities with explicit member, team, role, status,
  and pending-acceptance semantics;
- a stable `(member, team)` uniqueness constraint and server-validated external
  reference to a real Better Auth user;
- a required `Task.owner -> User` relation populated from the server `userId`;
- a required-authentication `/tasks` route;
- team-scoped task query, update, and delete policy predicates; and
- create, toggle, rename, and delete operations that never accept an owner ID
  from the browser.

After building the workspace packages, compile every disposable application
projection with an embedded worker:

```sh
node packages/cli/dist/cli.js build \
  --project examples/application-graph-todo \
  --application-graph graph.json \
  --worker-mode embedded
```

Choose `--worker-mode separate` to emit `dist/server/worker.js` for an
independently scaled worker process. The generated manifests record the chosen
topology; the source `graph.json` remains authoritative in either mode.

`@oxe/auth` provides the concrete Node/Better Auth account boundary. Email and
password sign-up, sign-in, sign-out, and cookie sessions are handled by Better
Auth. The server resolves the cookie to `ApplicationExecutionContextV1.userId`
before dispatching generated OXE server functions. Better Auth owns its auth
schema and migrations; OXE owns the `oxe_todo` application schema and migrations.

The integration test in `apps/todo/tests/server.test.ts` runs this flow against
a temporary PostgreSQL server with separate `auth` and `oxe_todo` schemas. It
creates Alice and Bob accounts and teams, invites Bob to Alice's team, proves the
pending invitation grants no access, accepts it as Bob, resolves owner and member
Team roles, creates scoped tasks through generated Fetch RPC functions, rejects
duplicate and unknown-user invitations, verifies shared access, revokes the
membership, and rejects Bob claiming either the revoked Team or owner-only role.

`@oxe/compiler` projects the successful view, authentication paths, standard
modes, context requirements, and semantic functions into the Todo package. A
generic browser host interprets that projection; Todo no longer maintains a
parallel task/invitation renderer. Account, Team, and owner-only contracts are
separate lazy generated client modules. Their user-and-active-context-scoped
memory caches deduplicate equal reads and use each query's graph-declared
freshness (`30s` for tasks and `5s` for invitations); successful writes
invalidate affected semantic queries. The pending invitation query also declares
`accepted = false` in the graph, so both in-memory and PostgreSQL hosts apply it.
The structure-preserving loading mode and all six standard view modes are
generated from the same view contract.

Before creating that client, the browser loads a no-store public application
context projection. It contains the Better Auth `userId` and resolved active
contexts but never the server-only session ID. The client derives its private
cache scope from that response and carries the verified chain on subsequent
semantic RPC calls.

The browser discovers switchable teams through the generic no-store
`/api/context-options` endpoint. The endpoint uses each context's `labelField`
and the same direct-or-membership authorization rules used to verify a selection.
