import type { PlatformCapabilityContract } from '@oxe/compiler';
import { OxeAsyncFailure } from '@oxe/runtime';
import {
  createFetchServerFunctionTransport,
  createServerFunctionCapability,
  createServerFunctionFetchHandler,
  createServerFunctionRegistry,
  defineServerFunction,
  implementServerFunction,
  type ServerFunctionCapability,
} from '@oxe/server-functions';
import { serverFunctionCompilerCapability } from '@oxe/server-functions/compiler';

const projectSchema = {
  kind: 'record',
  fields: [
    { name: 'id', schema: { kind: 'number', integer: true } },
    { name: 'name', schema: { kind: 'string' } },
    { name: 'summary', schema: { kind: 'string' } },
    { name: 'viewer', schema: { kind: 'string' } },
    { name: 'request', schema: { kind: 'number', integer: true } },
  ],
} as const;

export const readDemoProject = defineServerFunction({
  id: 'projects.read.v1',
  mode: 'query',
  parameters: [
    {
      name: 'id',
      schema: { kind: 'number', integer: true, minimum: 1, maximum: 404 },
    },
  ],
  path: ['projects', 'read'],
  returns: projectSchema,
});

export const serverFunctionDemoCompilerCapabilities = Object.freeze([
  serverFunctionCompilerCapability(readDemoProject),
]) satisfies readonly PlatformCapabilityContract[];

interface DemoRequestContext {
  readonly actorId: string;
}

export interface ServerFunctionDemoOptions {
  readonly delayMilliseconds?: number;
  readonly onExchange?: (direction: 'request' | 'response', payload: string) => void;
  readonly origin: string;
}

const demoProjects = [
  {
    id: 1,
    name: 'Compiler graph',
    summary: 'Typed capability metadata is preserved in the semantic graph.',
  },
  {
    id: 2,
    name: 'Runtime boundary',
    summary: 'Arguments and results are validated on both sides of serialization.',
  },
  {
    id: 3,
    name: 'Fetch transport',
    summary: 'The standard adapter enforces the HTTP and JSON boundary.',
  },
] as const;

const waitForDemoResponse = (milliseconds: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('The server-function request was cancelled.', 'AbortError'));
      return;
    }
    const timeout = globalThis.setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        globalThis.clearTimeout(timeout);
        reject(new DOMException('The server-function request was cancelled.', 'AbortError'));
      },
      { once: true },
    );
  });

export const createServerFunctionDemoCapability = (
  options: ServerFunctionDemoOptions,
): ServerFunctionCapability<typeof readDemoProject> => {
  let requestSequence = 0;
  const registry = createServerFunctionRegistry<DemoRequestContext>([
    implementServerFunction<typeof readDemoProject, DemoRequestContext>(
      readDemoProject,
      async ([id], context, signal) => {
        const request = ++requestSequence;
        await waitForDemoResponse(options.delayMilliseconds ?? 700, signal);
        if (id === 404) {
          throw new OxeAsyncFailure(
            'not-found',
            'Private demo-store detail: project row 404 is absent.',
            { status: 404 },
          );
        }
        const project = demoProjects[(id - 1) % demoProjects.length] ?? demoProjects[0];
        return { ...project, request, viewer: context.actorId };
      },
    ),
  ]);
  const handler = createServerFunctionFetchHandler(registry, {
    allowedOrigins: [options.origin],
    createContext: (request) => ({
      actorId: request.headers.get('x-demo-actor') ?? 'anonymous',
    }),
  });
  const transport = createFetchServerFunctionTransport({
    endpoint: new URL('/__oxe/functions', options.origin),
    headers: { origin: options.origin, 'x-demo-actor': 'Ada' },
    fetch: async (input, init) => {
      const request = new Request(input, init);
      options.onExchange?.('request', await request.clone().text());
      const response = await handler(request);
      options.onExchange?.('response', await response.clone().text());
      return response;
    },
  });
  return createServerFunctionCapability(readDemoProject, transport);
};
