import { OxeServerFunctionError } from './errors.js';
import { serializeServerFunctionError } from './protocol.js';
import { resolveSerializationLimits } from './schema.js';
import type {
  ServerFunctionRegistry,
  ServerFunctionSerializationLimits,
  ServerFunctionTransport,
} from './types.js';

export const SERVER_FUNCTION_REQUEST_HEADER = 'x-oxe-server-function' as const;

export interface FetchServerFunctionTransportOptions {
  readonly credentials?: RequestCredentials;
  readonly endpoint: string | URL;
  readonly fetch?: typeof fetch;
  readonly headers?: HeadersInit;
}

export const createFetchServerFunctionTransport = (
  options: FetchServerFunctionTransportOptions,
): ServerFunctionTransport => {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== 'function') {
    throw new OxeServerFunctionError(
      'OXE_SERVER_FUNCTION_PROTOCOL',
      'A Fetch implementation is required for the server-function transport.',
    );
  }
  return Object.freeze({
    async invoke(payload: string, signal: AbortSignal): Promise<string> {
      const headers = new Headers(options.headers);
      headers.set('content-type', 'application/json; charset=utf-8');
      headers.set(SERVER_FUNCTION_REQUEST_HEADER, '1');
      const response = await fetchImplementation(options.endpoint, {
        body: payload,
        credentials: options.credentials ?? 'same-origin',
        headers,
        method: 'POST',
        redirect: 'error',
        signal,
      });
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (!contentType.startsWith('application/json')) {
        throw new OxeServerFunctionError(
          'OXE_SERVER_FUNCTION_PROTOCOL',
          `Server-function endpoint returned ${response.status} without an application/json response.`,
        );
      }
      return response.text();
    },
  });
};

export interface ServerFunctionFetchHandlerOptions<Context> {
  /** Browser origins allowed to invoke the endpoint. Defaults to the request URL's origin. */
  readonly allowedOrigins?: readonly string[];
  createContext(request: Request, signal: AbortSignal): Context | PromiseLike<Context>;
  readonly limits?: ServerFunctionSerializationLimits;
  readonly onError?: (error: unknown, functionId: string | undefined) => void;
}

export type ServerFunctionFetchHandler = (request: Request) => Promise<Response>;

const responseHeaders = Object.freeze({
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
});

const transportError = (status: number, message: string, headers?: HeadersInit): Response =>
  new Response(JSON.stringify({ error: message }), {
    headers: { ...responseHeaders, ...Object.fromEntries(new Headers(headers)) },
    status,
  });

const readBoundedBody = async (
  request: Request,
  maximumBytes: number,
): Promise<string | Response> => {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      return transportError(400, 'Invalid Content-Length.');
    }
    if (parsed > maximumBytes) {
      return transportError(413, 'Server-function request is too large.');
    }
  }
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        return transportError(413, 'Server-function request is too large.');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    if (error instanceof TypeError) return transportError(400, 'Request body is not valid UTF-8.');
    throw error;
  } finally {
    reader.releaseLock();
  }
};

const allowedOrigin = (request: Request, configured: readonly string[] | undefined): boolean => {
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  const allowed = configured ?? [new URL(request.url).origin];
  return allowed.includes(origin);
};

/**
 * Standard Fetch endpoint adapter. The custom request header prevents form POSTs;
 * deployments must still keep CORS restrictive and construct an authorized context.
 */
export const createServerFunctionFetchHandler = <Context>(
  registry: ServerFunctionRegistry<Context>,
  options: ServerFunctionFetchHandlerOptions<Context>,
): ServerFunctionFetchHandler => {
  const limits = resolveSerializationLimits(options.limits);
  return async (request): Promise<Response> => {
    if (request.method !== 'POST') {
      return transportError(405, 'Server functions require POST.', { allow: 'POST' });
    }
    if (request.headers.get(SERVER_FUNCTION_REQUEST_HEADER) !== '1') {
      return transportError(403, 'Missing server-function request header.');
    }
    if (!allowedOrigin(request, options.allowedOrigins)) {
      return transportError(403, 'Origin is not allowed.');
    }
    const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.startsWith('application/json')) {
      return transportError(415, 'Server functions require application/json.');
    }
    const body = await readBoundedBody(request, limits.maximumEncodedBytes);
    if (body instanceof Response) return body;
    try {
      const context = await options.createContext(request, request.signal);
      const payload = await registry.dispatch(body, {
        context,
        ...(options.onError ? { onError: options.onError } : {}),
        signal: request.signal,
      });
      return new Response(payload, { headers: responseHeaders, status: 200 });
    } catch (error) {
      if (request.signal.aborted) throw error;
      options.onError?.(error, undefined);
      return new Response(
        serializeServerFunctionError(
          { kind: 'unexpected', message: 'Internal server error.', status: 500 },
          undefined,
          limits,
        ),
        { headers: responseHeaders, status: 500 },
      );
    }
  };
};
