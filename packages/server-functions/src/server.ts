import { OxeAsyncFailure } from '@oxe/runtime';

import { createServerFunctionManifest } from './contract.js';
import {
  abortedServerFunction,
  OxeServerFunctionError,
  OxeServerFunctionPublicError,
  OxeServerFunctionSerializationError,
} from './errors.js';
import {
  readServerFunctionRequest,
  serializeServerFunctionError,
  serializeServerFunctionSuccess,
  validationErrorPayload,
} from './protocol.js';
import { normalizeArguments, normalizeDefinition, resolveSerializationLimits } from './schema.js';
import type {
  ServerFunctionDefinitionV1,
  ServerFunctionErrorPayloadV1,
  ServerFunctionHandler,
  ServerFunctionImplementation,
  ServerFunctionRegistry,
  ServerFunctionSerializationLimits,
} from './types.js';

const safeMessage = (kind: ServerFunctionErrorPayloadV1['kind']): string =>
  kind === 'not-found'
    ? 'Not found.'
    : kind === 'unauthorized'
      ? 'Unauthorized.'
      : kind === 'forbidden'
        ? 'Forbidden.'
        : kind === 'validation'
          ? 'Invalid request.'
          : 'Internal server error.';

const safeAsyncFailure = (error: OxeAsyncFailure): ServerFunctionErrorPayloadV1 => ({
  kind: error.kind,
  message: safeMessage(error.kind),
  status:
    Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
      ? error.status
      : error.kind === 'not-found'
        ? 404
        : error.kind === 'unauthorized'
          ? 401
          : error.kind === 'forbidden'
            ? 403
            : error.kind === 'validation'
              ? 400
              : 500,
});

const publicFailure = (error: OxeServerFunctionPublicError): ServerFunctionErrorPayloadV1 => ({
  ...(error.issues
    ? {
        issues: error.issues.slice(0, 20).map((issue) => ({
          message: String(issue.message).slice(0, 300),
          path: String(issue.path).slice(0, 300),
        })),
      }
    : {}),
  kind: error.kind,
  message: error.message.slice(0, 500),
  status: error.status,
});

const unexpectedFailure = (): ServerFunctionErrorPayloadV1 => ({
  kind: 'unexpected',
  message: 'Internal server error.',
  status: 500,
});

const awaitAbortable = <Value>(
  value: Value | PromiseLike<Value>,
  signal: AbortSignal,
): Promise<Value> => {
  if (signal.aborted) return Promise.reject(abortedServerFunction());
  return new Promise((resolve, reject) => {
    const aborted = (): void => reject(abortedServerFunction());
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(value).then(
      (result) => {
        signal.removeEventListener('abort', aborted);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', aborted);
        reject(error);
      },
    );
  });
};

export const implementServerFunction = <Definition extends ServerFunctionDefinitionV1, Context>(
  definition: Definition,
  handler: ServerFunctionHandler<Definition, Context>,
): ServerFunctionImplementation<Context> => {
  const normalized = normalizeDefinition(definition);
  return {
    definition: normalized,
    invoke(arguments_, context, signal): unknown {
      // The registry validates every argument against Definition before reaching this adapter.
      return handler(arguments_ as Parameters<typeof handler>[0], context, signal);
    },
  };
};

export const createServerFunctionRegistry = <Context>(
  implementations: readonly ServerFunctionImplementation<Context>[],
  limits?: ServerFunctionSerializationLimits,
): ServerFunctionRegistry<Context> => {
  const manifest = createServerFunctionManifest(
    implementations.map((implementation) => implementation.definition),
  );
  const resolvedLimits = resolveSerializationLimits(limits);
  const byId = new Map<string, ServerFunctionImplementation<Context>>();
  for (const implementation of implementations) {
    if (byId.has(implementation.definition.id)) {
      throw new OxeServerFunctionError(
        'OXE_SERVER_FUNCTION_DUPLICATE',
        `Duplicate implementation for ${JSON.stringify(implementation.definition.id)}.`,
      );
    }
    byId.set(implementation.definition.id, implementation);
  }

  const registry: ServerFunctionRegistry<Context> = {
    async dispatch(payload, options): Promise<string> {
      const signal = options.signal ?? new AbortController().signal;
      if (signal.aborted) throw abortedServerFunction();
      let functionId: string | undefined;
      let invoked = false;
      try {
        const request = readServerFunctionRequest(payload, resolvedLimits);
        functionId = request.functionId;
        const implementation = byId.get(request.functionId);
        if (!implementation) {
          return serializeServerFunctionError(
            { kind: 'not-found', message: 'Server function not found.', status: 404 },
            request.functionId,
            resolvedLimits,
          );
        }
        const arguments_ = normalizeArguments(
          implementation.definition,
          request.arguments,
          resolvedLimits,
        );
        invoked = true;
        const value = await awaitAbortable(
          implementation.invoke(arguments_, options.context, signal),
          signal,
        );
        return serializeServerFunctionSuccess(implementation.definition, value, resolvedLimits);
      } catch (error) {
        if (
          error instanceof OxeServerFunctionError &&
          error.code === 'OXE_SERVER_FUNCTION_ABORTED'
        ) {
          throw error;
        }
        if (error instanceof OxeServerFunctionSerializationError) {
          if (invoked) {
            options.onError?.(error, functionId);
            return serializeServerFunctionError(unexpectedFailure(), functionId, resolvedLimits);
          }
          return serializeServerFunctionError(
            validationErrorPayload(error),
            functionId,
            resolvedLimits,
          );
        }
        if (
          error instanceof OxeServerFunctionError &&
          error.code === 'OXE_SERVER_FUNCTION_PROTOCOL'
        ) {
          return serializeServerFunctionError(
            { kind: 'validation', message: 'Invalid server-function request.', status: 400 },
            functionId,
            resolvedLimits,
          );
        }
        if (error instanceof OxeServerFunctionPublicError) {
          return serializeServerFunctionError(publicFailure(error), functionId, resolvedLimits);
        }
        if (error instanceof OxeAsyncFailure) {
          return serializeServerFunctionError(safeAsyncFailure(error), functionId, resolvedLimits);
        }
        options.onError?.(error, functionId);
        return serializeServerFunctionError(unexpectedFailure(), functionId, resolvedLimits);
      }
    },
    manifest,
  };
  return Object.freeze(registry);
};

export const createInProcessServerFunctionTransport = <Context>(
  registry: ServerFunctionRegistry<Context>,
  context: (signal: AbortSignal) => Context | PromiseLike<Context>,
) => ({
  async invoke(payload: string, signal: AbortSignal): Promise<string> {
    return registry.dispatch(payload, { context: await context(signal), signal });
  },
});
