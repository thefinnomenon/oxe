import { analyzeSource } from '@oxe/compiler';
import { OxeAsyncFailure } from '@oxe/runtime';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  createInProcessServerFunctionTransport,
  createFetchServerFunctionTransport,
  createServerFunctionFetchHandler,
  createServerFunctionCaller,
  createServerFunctionCapabilityMap,
  createServerFunctionManifest,
  createServerFunctionRegistry,
  implementServerFunction,
  OxeServerFunctionError,
  OxeServerFunctionPublicError,
  parseServerFunctionResponse,
  serializeServerFunctionManifest,
  serializeServerFunctionRequest,
  type ServerFunctionImplementation,
} from '../src/index.js';
import { defineServerFunction } from '../src/contract.js';

const projectSchema = {
  fields: [
    { name: 'name', schema: { kind: 'string', maximumLength: 80 } },
    { name: 'id', schema: { kind: 'string', minimumLength: 1 } },
  ],
  kind: 'record',
} as const;

const readProject = defineServerFunction({
  id: 'projects.read.v1',
  mode: 'query',
  parameters: [{ name: 'id', schema: { kind: 'string', minimumLength: 1 } }],
  path: ['projects', 'read'],
  returns: projectSchema,
});

const renameProject = defineServerFunction({
  id: 'projects.rename.v1',
  mode: 'mutation',
  parameters: [
    { name: 'id', schema: { kind: 'string', minimumLength: 1 } },
    { name: 'name', schema: { kind: 'string', maximumLength: 80, minimumLength: 1 } },
  ],
  path: ['projects', 'rename'],
  returns: projectSchema,
});

interface RequestContext {
  readonly actorId: string;
}

const registryWith = (
  rename: (
    arguments_: readonly [string, string],
    context: RequestContext,
    signal: AbortSignal,
  ) =>
    | { readonly id: string; readonly name: string }
    | PromiseLike<{
        readonly id: string;
        readonly name: string;
      }>,
  onRead?: () => void,
) =>
  createServerFunctionRegistry<RequestContext>([
    implementServerFunction<typeof readProject, RequestContext>(readProject, ([id], context) => {
      onRead?.();
      return { id, name: `${context.actorId}'s project` };
    }),
    implementServerFunction<typeof renameProject, RequestContext>(renameProject, rename),
  ]);

describe('typed server-function contracts', () => {
  it('preserves exact TypeScript argument and result types', () => {
    expectTypeOf<
      Parameters<ReturnType<typeof createServerFunctionCaller<typeof renameProject>>>[0]
    >().toEqualTypeOf<readonly [string, string]>();
    expectTypeOf<
      Awaited<ReturnType<ReturnType<typeof createServerFunctionCaller<typeof readProject>>>>
    >().toEqualTypeOf<{ readonly id: string; readonly name: string }>();
  });

  it('creates deterministic manifests independent of registration and record-field order', () => {
    const reversedProject = defineServerFunction({
      ...readProject,
      returns: {
        fields: [...projectSchema.fields].reverse(),
        kind: 'record',
      },
    });
    const left = createServerFunctionManifest([renameProject, readProject]);
    const right = createServerFunctionManifest([reversedProject, renameProject]);

    expect(serializeServerFunctionManifest(left)).toBe(serializeServerFunctionManifest(right));
    expect(left.functions.map((definition) => definition.id)).toEqual([
      'projects.read.v1',
      'projects.rename.v1',
    ]);
    expect(
      (left.functions[0]?.returns.kind === 'record' ? left.functions[0].returns.fields : []).map(
        (field) => field.name,
      ),
    ).toEqual(['id', 'name']);
  });

  it('round-trips validated calls while keeping request context on the server', async () => {
    const registry = registryWith(([id, name], context) => ({
      id,
      name: `${name} by ${context.actorId}`,
    }));
    const transport = createInProcessServerFunctionTransport(registry, () => ({ actorId: 'Ada' }));
    const rename = createServerFunctionCaller(renameProject, transport);

    await expect(rename(['p1', 'Compiler'])).resolves.toEqual({
      id: 'p1',
      name: 'Compiler by Ada',
    });
    const request = serializeServerFunctionRequest(renameProject, ['p1', 'Compiler']);
    expect(request).not.toContain('Ada');
  });

  it('round-trips through the standard Fetch adapters', async () => {
    const registry = registryWith(([id, name], context) => ({
      id,
      name: `${name} by ${context.actorId}`,
    }));
    const handler = createServerFunctionFetchHandler(registry, {
      createContext: (request) => ({ actorId: request.headers.get('x-actor') ?? 'anonymous' }),
    });
    const transport = createFetchServerFunctionTransport({
      endpoint: 'https://app.example.test/__oxe/functions',
      fetch: (input, init) => handler(new Request(input, init)),
      headers: { 'x-actor': 'Grace' },
    });
    const rename = createServerFunctionCaller(renameProject, transport);

    await expect(rename(['p1', 'Runtime'])).resolves.toEqual({
      id: 'p1',
      name: 'Runtime by Grace',
    });
  });

  it('enforces Fetch endpoint method, content type, origin, custom header, and body size', async () => {
    const registry = registryWith(([id, name]) => ({ id, name }));
    const handler = createServerFunctionFetchHandler(registry, {
      allowedOrigins: ['https://app.example.test'],
      createContext: () => ({ actorId: 'Ada' }),
      limits: { maximumEncodedBytes: 64 },
    });
    const endpoint = 'https://app.example.test/__oxe/functions';

    await expect(handler(new Request(endpoint))).resolves.toMatchObject({ status: 405 });
    await expect(
      handler(
        new Request(endpoint, {
          body: '{}',
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        }),
      ),
    ).resolves.toMatchObject({ status: 403 });
    await expect(
      handler(
        new Request(endpoint, {
          body: '{}',
          headers: {
            'content-type': 'application/json',
            origin: 'https://evil.example.test',
            'x-oxe-server-function': '1',
          },
          method: 'POST',
        }),
      ),
    ).resolves.toMatchObject({ status: 403 });
    await expect(
      handler(
        new Request(endpoint, {
          body: 'x'.repeat(65),
          headers: {
            'content-type': 'application/json',
            origin: 'https://app.example.test',
            'x-oxe-server-function': '1',
          },
          method: 'POST',
        }),
      ),
    ).resolves.toMatchObject({ status: 413 });
  });

  it('provides positional compiler capability adapters with cancellation signals', async () => {
    const registry = registryWith(([id, name]) => ({ id, name }));
    const transport = createInProcessServerFunctionTransport(registry, () => ({ actorId: 'Ada' }));
    const capabilities = createServerFunctionCapabilityMap([renameProject], transport);
    const rename = capabilities.get('projects.rename');

    expect(rename).toBeDefined();
    await expect(rename?.('p1', 'New name', new AbortController().signal)).resolves.toEqual({
      id: 'p1',
      name: 'New name',
    });
  });

  it('rejects invalid requests before invoking handlers', async () => {
    const read = vi.fn();
    const registry = registryWith(([id, name]) => ({ id, name }), read);
    const response = await registry.dispatch(
      JSON.stringify({
        arguments: ['p1', 'unexpected'],
        functionId: readProject.id,
        schemaVersion: 'oxe.server-function-request.v1',
      }),
      { context: { actorId: 'Ada' } },
    );
    const parsed = parseServerFunctionResponse(readProject, response);

    expect(parsed).toMatchObject({ error: { kind: 'validation', status: 400 }, ok: false });
    expect(read).not.toHaveBeenCalled();
  });

  it('enforces exact nested records, finite numbers, malformed values, and payload limits', () => {
    const update = defineServerFunction({
      id: 'projects.update.v1',
      mode: 'mutation',
      parameters: [{ name: 'project', schema: projectSchema }],
      path: ['projects', 'update'],
      returns: { kind: 'boolean' },
    });
    expect(() =>
      serializeServerFunctionRequest(update, [{ extra: true, id: 'p1', name: 'Name' }]),
    ).toThrow('Unknown record field');
    const cyclic: { id: string; name: unknown } = { id: 'p1', name: '' };
    cyclic.name = cyclic;
    expect(() => serializeServerFunctionRequest(update, [cyclic])).toThrow();
    expect(() =>
      serializeServerFunctionRequest(update, [{ id: 'p1', name: 'Long value' }], {
        maximumEncodedBytes: 10,
      }),
    ).toThrow('limit is 10');

    const score = defineServerFunction({
      id: 'scores.save.v1',
      mode: 'mutation',
      parameters: [{ name: 'score', schema: { kind: 'number' } }],
      path: ['scores', 'save'],
      returns: { kind: 'boolean' },
    });
    expect(() => serializeServerFunctionRequest(score, [Number.POSITIVE_INFINITY])).toThrow(
      'finite number',
    );
  });

  it('exposes intentional public failures and redacts private exceptions', async () => {
    const publicRegistry = registryWith(() => {
      throw new OxeServerFunctionPublicError('validation', 'That name is already used.', {
        issues: [{ message: 'Choose another name.', path: '$.arguments[1] (name)' }],
      });
    });
    const publicCall = createServerFunctionCaller(
      renameProject,
      createInProcessServerFunctionTransport(publicRegistry, () => ({ actorId: 'Ada' })),
    );
    await expect(publicCall(['p1', 'Duplicate'])).rejects.toMatchObject({
      details: [{ message: 'Choose another name.', path: '$.arguments[1] (name)' }],
      kind: 'validation',
      message: 'That name is already used.',
    });

    const observed = vi.fn();
    const privateRegistry = registryWith(() => {
      throw new Error('database password is secret');
    });
    const request = serializeServerFunctionRequest(renameProject, ['p1', 'Name']);
    const response = await privateRegistry.dispatch(request, {
      context: { actorId: 'Ada' },
      onError: observed,
    });
    const parsed = parseServerFunctionResponse(renameProject, response);
    expect(parsed).toMatchObject({
      error: { kind: 'unexpected', message: 'Internal server error.', status: 500 },
      ok: false,
    });
    expect(response).not.toContain('database password');
    expect(observed).toHaveBeenCalledOnce();
  });

  it('treats an invalid handler result as an internal contract failure', async () => {
    const invalid: ServerFunctionImplementation<RequestContext> = {
      definition: readProject,
      invoke: () => ({ id: 'p1', name: 42 }),
    };
    const observed = vi.fn();
    const registry = createServerFunctionRegistry([invalid]);
    const response = await registry.dispatch(serializeServerFunctionRequest(readProject, ['p1']), {
      context: { actorId: 'Ada' },
      onError: observed,
    });

    expect(parseServerFunctionResponse(readProject, response)).toMatchObject({
      error: { kind: 'unexpected', message: 'Internal server error.' },
      ok: false,
    });
    expect(observed).toHaveBeenCalledOnce();
  });

  it('turns declared async failures into safe client failures', async () => {
    const registry = registryWith(() => {
      throw new OxeAsyncFailure('forbidden', 'private authorization reason');
    });
    const rename = createServerFunctionCaller(
      renameProject,
      createInProcessServerFunctionTransport(registry, () => ({ actorId: 'Ada' })),
    );

    await expect(rename(['p1', 'Name'])).rejects.toMatchObject({
      kind: 'forbidden',
      message: 'Forbidden.',
      status: 403,
    });
  });

  it('propagates cancellation without converting it into a remote failure', async () => {
    const registry = registryWith(
      (_arguments, _context, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('handler aborted')), {
            once: true,
          });
        }),
    );
    const rename = createServerFunctionCaller(
      renameProject,
      createInProcessServerFunctionTransport(registry, () => ({ actorId: 'Ada' })),
    );
    const controller = new AbortController();
    const promise = rename(['p1', 'Name'], { signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ code: 'OXE_SERVER_FUNCTION_ABORTED' });
  });

  it('rejects duplicate runtime ids while the compiler owns authored function capabilities', () => {
    expect(() => createServerFunctionManifest([readProject, readProject])).toThrow(
      OxeServerFunctionError,
    );
    const analyzed = analyzeSource(
      `export server readProject(id):
  project = database.read(id)
  project

export App():
  project = readProject("p1")
  <p>{project.name}
`,
      'server-function.oxe',
      'server-function.oxe',
      {
        capabilities: [
          {
            kind: 'async',
            name: 'database.read',
            parameters: ['string'],
            parameterSchemas: [{ kind: 'string' }],
            returns: 'record',
            returnSchema: projectSchema,
            target: 'server',
          },
        ],
        target: 'client',
      },
    );
    expect(analyzed.diagnostics).toEqual([]);
    expect(analyzed.graph?.nodes).toContainEqual(
      expect.objectContaining({
        capabilityKind: 'async',
        kind: 'platform-capability',
        serverFunctionId: analyzed.graph?.serverFunctions?.[0]?.id,
        target: 'universal',
      }),
    );
  });
});
