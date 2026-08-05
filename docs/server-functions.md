# Server functions

Server functions are declarations in OXE source. Authors do not create an RPC
schema, capability contract, manifest entry, client proxy, or registry entry by
hand:

```oxe
export server readProject(id):
  project = database.projects.read(id)
  project

export ProjectPage():
  project = readProject("project-1")

  <h1>{project.name}
```

`server` is the execution boundary. The body is ordinary procedural server code:
statements run once, in source order, for each invocation. Assignments introduce
immutable locals, and the final expression is the result. OXE omits `function`,
`async`, `await`, and `return`; the compiler emits those JavaScript details.

This is different from module initialization. A deployed module may be initialized
once per process, isolate, or cold start, but `readProject` runs again for every
call.

## Compiler-owned contract

The compiler turns each reachable declaration into one
`oxe.server-function.v1` definition. It owns:

- a stable id derived from the module, name, parameters, and result;
- an internal capability path;
- ordered named parameter schemas and the result schema;
- `query` or `mutation` classification; and
- the client proxy and server registry implementation.

Scalar parameter types are inferred from their uses. An explicit annotation can
be added when inference is ambiguous:

```oxe
server findProject(id: string):
  database.projects.read(id)
```

The current boundary supports booleans, finite numbers, strings, homogeneous
arrays, and exact records. It does not silently serialize `undefined`, `null`,
dates, `BigInt`, binary values, class instances, functions, symbols, unknown
record fields, or cycles.

Calls inside a server body resolve through configured server or universal host
capabilities. For example, `database.projects.read` is a server capability whose
exact result schema comes from the database adapter. Client-only and disposable
resource capabilities are rejected in server bodies.

## Next: infer package and import ownership

Add JavaScript and package imports to OXE projects, then classify every imported
binding from its actual references. A binding used only by `server` declarations
must appear only in the generated server module graph; a binding used only by
component code must appear only in the browser graph; and a binding used on both
sides may appear in both when it is compatible with both targets. A server-only
dependency that reaches component code must be a compile-time error.

This split must be semantic. OXE will not require `.server.ts`, `.client.ts`, or
another filename convention to decide where an import belongs. The generated
client artifact must omit server-only imports and their transitive dependencies
by construction rather than depending on downstream tree-shaking to remove them.

## Generated artifacts

After `analyzeProject`, the compiler produces both halves from the same source:

```ts
import { generateDomArtifact, generateServerFunctionModuleSource } from '@oxe/compiler';

const client = generateDomArtifact(project.graph);
const serverModule = generateServerFunctionModuleSource(project);
```

The browser mount accepts `serverFunctionTransport`; generated code creates the
capabilities automatically. The generated server module exports
`serverFunctionDefinitions` and `serverFunctionRegistry`. Each implementation
calls `context.callCapability(path, arguments, signal)` for host operations, so
authentication, authorization, database handles, tenant identity, tracing, and
secrets remain request-local and never enter an RPC payload or compiler artifact.

Arguments are validated before transport and again before execution. Results are
validated before serialization and again in the browser. Abort signals propagate
from an async UI resource through Fetch and into the implementation.

## Fetch and Node hosts

`@oxe/router/server` provides the application host. One handler route-matches page
requests, composes layouts, waits for status gates, streams SSR patches and
hydration state, and dispatches server-function POSTs:

```ts
import { createFetchRouteHandler } from '@oxe/router/server';

const handleRequest = createFetchRouteHandler({
  manifest,
  loadPlan,
  serverFunctions: {
    registry: serverFunctionRegistry,
    createContext: (request, signal) => ({
      callCapability: (path, args) =>
        applicationCapabilities.call(path, args, {
          request,
          signal,
        }),
    }),
  },
});
```

The returned `(request: Request) => Promise<Response>` function is the portable
boundary for Workers, serverless platforms, and deployment layers such as Nitro.
Those tools adapt platform events and deployment packaging; they do not define
OXE server-function semantics.

For a native Node HTTP server, use the same options with `createNodeRouteHandler`,
or adapt an existing Fetch handler with `createNodeHandler`:

```ts
import { createServer } from 'node:http';
import { createNodeRouteHandler } from '@oxe/router/server';

const handleNodeRequest = createNodeRouteHandler({
  manifest,
  loadPlan,
  serverFunctions: { registry: serverFunctionRegistry, createContext },
});

createServer((request, response) => {
  void handleNodeRequest(request, response);
}).listen(3000);
```

The standard server-function endpoint defaults to `/__oxe/functions`. It requires
POST, JSON, and `x-oxe-server-function`, applies origin checks and body limits,
and returns no-store JSON. Production hosts remain responsible for session and
authorization policy, restrictive CORS, CSRF policy appropriate to their cookie
model, rate limiting, secrets, and observability.

Only deliberately public typed failures may expose authored messages. Other
failures are reported to the host and cross the wire as safe generic errors.
