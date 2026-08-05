import type { PlatformCapabilityContract } from '@oxe/compiler';
import { OxeAsyncFailure } from '@oxe/runtime';
import {
  createFetchServerFunctionTransport,
  createServerFunctionCapability,
  createServerFunctionFetchHandler,
  createServerFunctionRegistry,
  type ServerFunctionCapability,
  type ServerFunctionDefinitionV1,
  type ServerFunctionImplementation,
  type ServerFunctionTransport,
} from '@oxe/server-functions';

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

/** The host capability used inside the authored `server readProject` body. */
export const serverFunctionDemoCompilerCapabilities = Object.freeze([
  {
    kind: 'async',
    name: 'database.readDemoProject',
    parameters: ['number'],
    parameterSchemas: [{ kind: 'number', integer: true, minimum: 1, maximum: 404 }],
    returns: 'record',
    returnSchema: projectSchema,
    target: 'server',
  },
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

const demoDefinition = (
  definitions: readonly ServerFunctionDefinitionV1[],
): ServerFunctionDefinitionV1 => {
  const definition = definitions[0];
  if (!definition || definitions.length !== 1) {
    throw new Error('The server-function playground expects one compiler-generated definition.');
  }
  return definition;
};

export const createServerFunctionDemoTransport = (
  definitions: readonly ServerFunctionDefinitionV1[],
  options: ServerFunctionDemoOptions,
): ServerFunctionTransport => {
  const definition = demoDefinition(definitions);
  let requestSequence = 0;
  const implementation: ServerFunctionImplementation<DemoRequestContext> = {
    definition,
    async invoke(arguments_, context, signal) {
      const id = Number(arguments_[0]);
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
  };
  const registry = createServerFunctionRegistry([implementation]);
  const handler = createServerFunctionFetchHandler(registry, {
    allowedOrigins: [options.origin],
    createContext: (request) => ({
      actorId: request.headers.get('x-demo-actor') ?? 'anonymous',
    }),
  });
  return createFetchServerFunctionTransport({
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
};

export const createServerFunctionDemoCapability = (
  definition: ServerFunctionDefinitionV1,
  options: ServerFunctionDemoOptions,
): ServerFunctionCapability<ServerFunctionDefinitionV1> =>
  createServerFunctionCapability(
    definition,
    createServerFunctionDemoTransport([definition], options),
  );
