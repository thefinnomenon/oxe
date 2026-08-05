import { OxeServerFunctionError } from './errors.js';
import type { OxeServerFunctionSerializationError } from './errors.js';
import {
  enforceEncodedSize,
  normalizeArguments,
  normalizeValue,
  resolveSerializationLimits,
} from './schema.js';
import {
  SERVER_FUNCTION_REQUEST_SCHEMA,
  SERVER_FUNCTION_RESPONSE_SCHEMA,
  type ResolvedServerFunctionSerializationLimits,
  type ServerFunctionDefinitionV1,
  type ServerFunctionErrorPayloadV1,
  type ServerFunctionRequestV1,
  type ServerFunctionResponseV1,
  type ServerFunctionSerializationLimits,
} from './types.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const protocolError = (message: string, cause?: unknown): never => {
  throw new OxeServerFunctionError(
    'OXE_SERVER_FUNCTION_PROTOCOL',
    message,
    cause === undefined ? {} : { cause },
  );
};

const parseJson = (payload: string, limits: ResolvedServerFunctionSerializationLimits): unknown => {
  enforceEncodedSize(payload, limits);
  try {
    return JSON.parse(payload) as unknown;
  } catch (error) {
    return protocolError('Server-function payload is not valid JSON.', error);
  }
};

const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const normalizedExpected = [...expected].sort();
  return (
    actual.length === normalizedExpected.length &&
    actual.every((key, index) => key === normalizedExpected[index])
  );
};

export const readServerFunctionRequest = (
  payload: string,
  limits?: ServerFunctionSerializationLimits,
): ServerFunctionRequestV1 => {
  const resolved = resolveSerializationLimits(limits);
  const value = parseJson(payload, resolved);
  if (
    !isRecord(value) ||
    !exactKeys(value, ['arguments', 'functionId', 'schemaVersion']) ||
    value.schemaVersion !== SERVER_FUNCTION_REQUEST_SCHEMA ||
    typeof value.functionId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(value.functionId) ||
    value.functionId.length > 200 ||
    !Array.isArray(value.arguments)
  ) {
    return protocolError('Invalid oxe.server-function-request.v1 envelope.');
  }
  return Object.freeze({
    arguments: Object.freeze(value.arguments),
    functionId: value.functionId,
    schemaVersion: SERVER_FUNCTION_REQUEST_SCHEMA,
  });
};

export const serializeServerFunctionRequest = (
  definition: ServerFunctionDefinitionV1,
  arguments_: readonly unknown[],
  limits?: ServerFunctionSerializationLimits,
): string => {
  const resolved = resolveSerializationLimits(limits);
  const request: ServerFunctionRequestV1 = {
    arguments: normalizeArguments(definition, arguments_, resolved),
    functionId: definition.id,
    schemaVersion: SERVER_FUNCTION_REQUEST_SCHEMA,
  };
  return enforceEncodedSize(JSON.stringify(request), resolved);
};

const normalizedIssues = (value: unknown): ServerFunctionErrorPayloadV1['issues'] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 20) {
    return protocolError('A server-function error contains invalid validation issues.');
  }
  return Object.freeze(
    value.map((issue) => {
      if (
        !isRecord(issue) ||
        !exactKeys(issue, ['message', 'path']) ||
        typeof issue.message !== 'string' ||
        issue.message.length > 300 ||
        typeof issue.path !== 'string' ||
        issue.path.length > 300
      ) {
        return protocolError('A server-function error contains an invalid validation issue.');
      }
      return Object.freeze({ message: issue.message, path: issue.path });
    }),
  );
};

const asyncFailureKinds = new Set([
  'forbidden',
  'not-found',
  'unauthorized',
  'unexpected',
  'validation',
]);

const readError = (value: unknown): ServerFunctionErrorPayloadV1 => {
  if (
    !isRecord(value) ||
    !exactKeys(
      value,
      value.issues === undefined
        ? ['kind', 'message', 'status']
        : ['issues', 'kind', 'message', 'status'],
    ) ||
    typeof value.kind !== 'string' ||
    !asyncFailureKinds.has(value.kind) ||
    typeof value.message !== 'string' ||
    value.message.length > 500 ||
    typeof value.status !== 'number' ||
    !Number.isInteger(value.status) ||
    value.status < 400 ||
    value.status > 599
  ) {
    return protocolError('Invalid server-function error payload.');
  }
  const issues = normalizedIssues(value.issues);
  return Object.freeze({
    ...(issues ? { issues } : {}),
    kind: value.kind as ServerFunctionErrorPayloadV1['kind'],
    message: value.message,
    status: value.status,
  });
};

export const serializeServerFunctionSuccess = (
  definition: ServerFunctionDefinitionV1,
  value: unknown,
  limits?: ServerFunctionSerializationLimits,
): string => {
  const resolved = resolveSerializationLimits(limits);
  const response: ServerFunctionResponseV1 = {
    functionId: definition.id,
    ok: true,
    schemaVersion: SERVER_FUNCTION_RESPONSE_SCHEMA,
    value: normalizeValue(definition.returns, value, '$.value', resolved),
  };
  return enforceEncodedSize(JSON.stringify(response), resolved);
};

export const serializeServerFunctionError = (
  error: ServerFunctionErrorPayloadV1,
  functionId: string | undefined,
  limits?: ServerFunctionSerializationLimits,
): string => {
  const resolved = resolveSerializationLimits(limits);
  const normalized = readError(error);
  const response: ServerFunctionResponseV1 = {
    error: normalized,
    ...(functionId === undefined ? {} : { functionId }),
    ok: false,
    schemaVersion: SERVER_FUNCTION_RESPONSE_SCHEMA,
  };
  return enforceEncodedSize(JSON.stringify(response), resolved);
};

export const parseServerFunctionResponse = (
  definition: ServerFunctionDefinitionV1,
  payload: string,
  limits?: ServerFunctionSerializationLimits,
): ServerFunctionResponseV1 => {
  const resolved = resolveSerializationLimits(limits);
  const value = parseJson(payload, resolved);
  if (!isRecord(value) || value.schemaVersion !== SERVER_FUNCTION_RESPONSE_SCHEMA) {
    return protocolError('Invalid oxe.server-function-response.v1 envelope.');
  }
  if (value.ok === true) {
    if (
      !exactKeys(value, ['functionId', 'ok', 'schemaVersion', 'value']) ||
      value.functionId !== definition.id
    ) {
      return protocolError('Server-function response does not match the requested function.');
    }
    return Object.freeze({
      functionId: definition.id,
      ok: true,
      schemaVersion: SERVER_FUNCTION_RESPONSE_SCHEMA,
      value: normalizeValue(definition.returns, value.value, '$.value', resolved),
    });
  }
  if (value.ok === false) {
    const expectedKeys =
      value.functionId === undefined
        ? ['error', 'ok', 'schemaVersion']
        : ['error', 'functionId', 'ok', 'schemaVersion'];
    if (!exactKeys(value, expectedKeys)) {
      return protocolError('Invalid failed server-function response envelope.');
    }
    if (value.functionId !== undefined && value.functionId !== definition.id) {
      return protocolError('Server-function error does not match the requested function.');
    }
    return Object.freeze({
      error: readError(value.error),
      ...(value.functionId === undefined ? {} : { functionId: definition.id }),
      ok: false,
      schemaVersion: SERVER_FUNCTION_RESPONSE_SCHEMA,
    });
  }
  return protocolError('Invalid server-function response state.');
};

export const validationErrorPayload = (
  error: OxeServerFunctionSerializationError,
): ServerFunctionErrorPayloadV1 => ({
  issues: [error.issue],
  kind: 'validation',
  message: 'Invalid server-function request.',
  status: 400,
});
