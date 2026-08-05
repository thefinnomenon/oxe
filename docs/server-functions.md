# Typed server functions

OXE server functions are a versioned transport boundary around existing typed
capabilities. The authored language continues to use an ordinary assignment:

```oxe
ProjectPage():
  project = projects.read("project-1")

  <h1>{project.name}
```

The host defines the function once in TypeScript:

```ts
import {
  createServerFunctionRegistry,
  defineServerFunction,
  implementServerFunction,
} from '@oxe/server-functions';
import { serverFunctionCompilerCapability } from '@oxe/server-functions/compiler';

const readProject = defineServerFunction({
  id: 'projects.read.v1',
  mode: 'query',
  parameters: [{ name: 'id', schema: { kind: 'string', minimumLength: 1 } }],
  path: ['projects', 'read'],
  returns: {
    kind: 'record',
    fields: [
      { name: 'id', schema: { kind: 'string' } },
      { name: 'name', schema: { kind: 'string' } },
    ],
  },
});

const compilerCapability = serverFunctionCompilerCapability(readProject);

interface RequestContext {
  readonly projects: {
    read(id: string, signal: AbortSignal): Promise<{ id: string; name: string }>;
  };
}

const registry = createServerFunctionRegistry([
  implementServerFunction<typeof readProject, RequestContext>(
    readProject,
    async ([id], context, signal) => context.projects.read(id, signal),
  ),
]);
```

`serverFunctionCompilerCapability` creates an async universal capability. The
generated DOM artifact calls a host-installed client adapter, while server
rendering can resolve the same stable function id locally. The semantic UI graph
and serialized server render plan retain `serverFunctionId`; the executable
handler and its request context never enter either artifact.

## Contract and manifest

Each `oxe.server-function.v1` definition contains:

- a stable id, which changes when an incompatible contract replaces an old one;
- a dot path used by compiler-emitted capability calls;
- a `query` or `mutation` classification for later caching, invalidation, retry,
  and observability policy;
- ordered named parameter schemas; and
- one result schema.

`createServerFunctionManifest` rejects duplicate ids and paths, sorts functions
by id, sorts record fields by name, and freezes the normalized definitions.
`serializeServerFunctionManifest` therefore produces identical bytes regardless
of registration order.

Version 1 values are deliberately narrow:

- Boolean values.
- Finite numbers, with optional integer and inclusive range constraints.
- Strings, with optional length and enum constraints.
- Homogeneous arrays, with optional item-count constraints.
- Exact records with required fields and nested schemas.

There is no implicit `undefined`, optional field, `null`, special date encoding,
binary encoding, class instance, function, symbol, `BigInt`, or non-finite number.
Unknown fields and non-plain records fail validation. A later nullable or special
scalar design must version the contract rather than quietly changing JSON
semantics.

## Invocation boundary

`createServerFunctionCaller` accepts the definition and a platform transport. It
validates arguments before producing an `oxe.server-function-request.v1`
envelope. The registry parses and revalidates the envelope before invoking the
handler, validates its result, and returns an
`oxe.server-function-response.v1` envelope. The caller validates the response
again before exposing the value.

`createFetchServerFunctionTransport` and `createServerFunctionFetchHandler`
provide the standard browser/host adapter. They use POST, require JSON, send a
non-form `x-oxe-server-function` header, default credentials to `same-origin`,
reject mismatched browser origins, disable response caching, and enforce the body
limit while reading the request stream. Hosts may configure an explicit origin
allowlist for deployments whose public origin differs from their internal request
URL.

Default limits are 1 MiB encoded payloads, 32 nested levels, and 10,000 visited
values. Hosts may lower all three limits. Limits apply independently on both
sides, and values are normalized into frozen JSON-only arrays and records.

Compiler-generated async resources pass their cancellation signal to
`createServerFunctionCapability`. Transports must stop their request when that
signal aborts. The registry passes the same signal to the handler and rejects an
aborted in-process execution without converting it into an application failure.

## Errors and security boundary

`OxeServerFunctionPublicError` is the only exception whose authored message may
cross the wire. It carries one of the existing async failure kinds and optional
bounded validation issues. An `OxeAsyncFailure` keeps its classification and
status but receives a standard public message. Every other thrown value is sent
to the registry's `onError` observer and becomes a generic `unexpected` response;
private exception messages, causes, and stacks are never serialized.

Handler context is passed out of band. Authentication state, tenant identity,
authorization services, database handles, secrets, headers, and request objects
must live there rather than in serialized arguments. The transport-neutral
package intentionally does not guess HTTP policy. A production host remains
responsible for restrictive CORS, stronger CSRF policy when its cookie model
requires it, session construction, authorization, rate limiting, and request
tracing before calling the registry.
