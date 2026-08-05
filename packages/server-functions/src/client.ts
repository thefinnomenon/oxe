import { OxeAsyncFailure } from '@oxe/runtime';

import { abortedServerFunction, OxeServerFunctionError } from './errors.js';
import { parseServerFunctionResponse, serializeServerFunctionRequest } from './protocol.js';
import { normalizeDefinition } from './schema.js';
import type {
  ServerFunctionCaller,
  ServerFunctionCapability,
  ServerFunctionDefinitionV1,
  ServerFunctionSerializationLimits,
  ServerFunctionTransport,
} from './types.js';

const call = async <Definition extends ServerFunctionDefinitionV1>(
  definition: Definition,
  arguments_: readonly unknown[],
  transport: ServerFunctionTransport,
  signal: AbortSignal,
  limits?: ServerFunctionSerializationLimits,
): Promise<unknown> => {
  if (signal.aborted) throw abortedServerFunction();
  const payload = serializeServerFunctionRequest(definition, arguments_, limits);
  const responsePayload = await transport.invoke(payload, signal);
  if (signal.aborted) throw abortedServerFunction();
  const response = parseServerFunctionResponse(definition, responsePayload, limits);
  if (!response.ok) {
    throw new OxeAsyncFailure(response.error.kind, response.error.message, {
      details: response.error.issues,
      status: response.error.status,
    });
  }
  return response.value;
};

export const createServerFunctionCaller = <Definition extends ServerFunctionDefinitionV1>(
  definition: Definition,
  transport: ServerFunctionTransport,
  limits?: ServerFunctionSerializationLimits,
): ServerFunctionCaller<Definition> => {
  const normalized = normalizeDefinition(definition);
  return async (arguments_, options) => {
    const signal = options?.signal ?? new AbortController().signal;
    // The return value was validated against Definition by parseServerFunctionResponse.
    return (await call(normalized, arguments_, transport, signal, limits)) as Awaited<
      ReturnType<ServerFunctionCaller<Definition>>
    >;
  };
};

const isAbortSignal = (value: unknown): value is AbortSignal =>
  typeof value === 'object' &&
  value !== null &&
  'aborted' in value &&
  typeof value.aborted === 'boolean' &&
  'addEventListener' in value &&
  typeof value.addEventListener === 'function';

export const createServerFunctionCapability = <Definition extends ServerFunctionDefinitionV1>(
  definition: Definition,
  transport: ServerFunctionTransport,
  limits?: ServerFunctionSerializationLimits,
): ServerFunctionCapability<Definition> => {
  const normalized = normalizeDefinition(definition);
  const capability = async (...argumentsAndSignal: readonly unknown[]): Promise<unknown> => {
    if (argumentsAndSignal.length !== normalized.parameters.length + 1) {
      throw new OxeServerFunctionError(
        'OXE_SERVER_FUNCTION_PROTOCOL',
        `Compiler capability ${JSON.stringify(normalized.path.join('.'))} expected ${normalized.parameters.length} arguments and an AbortSignal.`,
      );
    }
    const signal = argumentsAndSignal.at(-1);
    if (!isAbortSignal(signal)) {
      throw new OxeServerFunctionError(
        'OXE_SERVER_FUNCTION_PROTOCOL',
        `Compiler capability ${JSON.stringify(normalized.path.join('.'))} requires an AbortSignal.`,
      );
    }
    return call(normalized, argumentsAndSignal.slice(0, -1), transport, signal, limits);
  };
  // The adapter checks the positional arity and validates every value at runtime.
  return capability as ServerFunctionCapability<Definition>;
};

export const createServerFunctionCapabilityMap = (
  definitions: readonly ServerFunctionDefinitionV1[],
  transport: ServerFunctionTransport,
  limits?: ServerFunctionSerializationLimits,
): ReadonlyMap<string, ServerFunctionCapability<ServerFunctionDefinitionV1>> => {
  const result = new Map<string, ServerFunctionCapability<ServerFunctionDefinitionV1>>();
  for (const definition of definitions) {
    const path = definition.path.join('.');
    if (result.has(path)) {
      throw new OxeServerFunctionError(
        'OXE_SERVER_FUNCTION_DUPLICATE',
        `Duplicate compiler capability path ${JSON.stringify(path)}.`,
      );
    }
    result.set(path, createServerFunctionCapability(definition, transport, limits));
  }
  return result;
};
