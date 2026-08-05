import { OxeServerFunctionError, OxeServerFunctionSerializationError } from './errors.js';
import type {
  ArraySchemaV1,
  NumberSchemaV1,
  RecordFieldV1,
  RecordSchemaV1,
  ResolvedServerFunctionSerializationLimits,
  ServerFunctionDefinitionV1,
  ServerFunctionParameterV1,
  ServerFunctionSerializationLimits,
  ServerValueSchemaV1,
  StringSchemaV1,
} from './types.js';

const DEFAULT_LIMITS: ResolvedServerFunctionSerializationLimits = Object.freeze({
  maximumDepth: 32,
  maximumEncodedBytes: 1024 * 1024,
  maximumNodes: 10_000,
});

const identifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const functionIdPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;

const positiveInteger = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new OxeServerFunctionError(
      'OXE_SERVER_FUNCTION_INVALID_CONTRACT',
      `${name} must be a positive safe integer.`,
    );
  }
  return value;
};

export const resolveSerializationLimits = (
  limits: ServerFunctionSerializationLimits = {},
): ResolvedServerFunctionSerializationLimits =>
  Object.freeze({
    maximumDepth:
      limits.maximumDepth === undefined
        ? DEFAULT_LIMITS.maximumDepth
        : positiveInteger('maximumDepth', limits.maximumDepth),
    maximumEncodedBytes:
      limits.maximumEncodedBytes === undefined
        ? DEFAULT_LIMITS.maximumEncodedBytes
        : positiveInteger('maximumEncodedBytes', limits.maximumEncodedBytes),
    maximumNodes:
      limits.maximumNodes === undefined
        ? DEFAULT_LIMITS.maximumNodes
        : positiveInteger('maximumNodes', limits.maximumNodes),
  });

export const utf8ByteLength = (value: string): number => {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
};

export const enforceEncodedSize = (
  value: string,
  limits: ResolvedServerFunctionSerializationLimits,
): string => {
  const bytes = utf8ByteLength(value);
  if (bytes > limits.maximumEncodedBytes) {
    throw new OxeServerFunctionSerializationError({
      message: `Encoded value is ${bytes} bytes; the limit is ${limits.maximumEncodedBytes}.`,
      path: '$',
    });
  }
  return value;
};

const contractError = (message: string): never => {
  throw new OxeServerFunctionError('OXE_SERVER_FUNCTION_INVALID_CONTRACT', message);
};

const boundedInteger = (name: string, value: number | undefined): number | undefined => {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    return contractError(`${name} must be a non-negative safe integer.`);
  }
  return value;
};

const finiteNumber = (name: string, value: number | undefined): number | undefined => {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) return contractError(`${name} must be finite.`);
  return Object.is(value, -0) ? 0 : value;
};

const normalizeStringSchema = (schema: StringSchemaV1): StringSchemaV1 => {
  const minimumLength = boundedInteger('minimumLength', schema.minimumLength);
  const maximumLength = boundedInteger('maximumLength', schema.maximumLength);
  if (minimumLength !== undefined && maximumLength !== undefined && minimumLength > maximumLength) {
    return contractError('minimumLength cannot exceed maximumLength.');
  }
  const values = schema.enum === undefined ? undefined : [...new Set(schema.enum)].sort();
  if (values?.some((value) => typeof value !== 'string')) {
    return contractError('A string enum may contain only strings.');
  }
  if (values?.length === 0) return contractError('A string enum cannot be empty.');
  return Object.freeze({
    ...(values ? { enum: Object.freeze(values) } : {}),
    kind: 'string',
    ...(maximumLength === undefined ? {} : { maximumLength }),
    ...(minimumLength === undefined ? {} : { minimumLength }),
  });
};

const normalizeNumberSchema = (schema: NumberSchemaV1): NumberSchemaV1 => {
  const minimum = finiteNumber('minimum', schema.minimum);
  const maximum = finiteNumber('maximum', schema.maximum);
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    return contractError('minimum cannot exceed maximum.');
  }
  return Object.freeze({
    ...(schema.integer === undefined ? {} : { integer: schema.integer }),
    kind: 'number',
    ...(maximum === undefined ? {} : { maximum }),
    ...(minimum === undefined ? {} : { minimum }),
  });
};

const normalizeArraySchema = (schema: ArraySchemaV1, depth: number): ArraySchemaV1 => {
  const minimumItems = boundedInteger('minimumItems', schema.minimumItems);
  const maximumItems = boundedInteger('maximumItems', schema.maximumItems);
  if (minimumItems !== undefined && maximumItems !== undefined && minimumItems > maximumItems) {
    return contractError('minimumItems cannot exceed maximumItems.');
  }
  return Object.freeze({
    items: normalizeSchema(schema.items, depth + 1),
    kind: 'array',
    ...(maximumItems === undefined ? {} : { maximumItems }),
    ...(minimumItems === undefined ? {} : { minimumItems }),
  });
};

const normalizeRecordSchema = (schema: RecordSchemaV1, depth: number): RecordSchemaV1 => {
  const names = new Set<string>();
  const fields = schema.fields
    .map((field): RecordFieldV1 => {
      if (!identifierPattern.test(field.name)) {
        return contractError(`Invalid record field name ${JSON.stringify(field.name)}.`);
      }
      if (names.has(field.name)) {
        return contractError(`Duplicate record field ${JSON.stringify(field.name)}.`);
      }
      names.add(field.name);
      return Object.freeze({ name: field.name, schema: normalizeSchema(field.schema, depth + 1) });
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  return Object.freeze({ fields: Object.freeze(fields), kind: 'record' });
};

export const normalizeSchema = (schema: ServerValueSchemaV1, depth = 0): ServerValueSchemaV1 => {
  if (depth > 32) return contractError('A server-function schema cannot exceed 32 levels.');
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    return contractError('A server-function value schema must be a record.');
  }
  switch (schema.kind) {
    case 'array':
      return normalizeArraySchema(schema, depth);
    case 'boolean':
      return Object.freeze({ kind: 'boolean' });
    case 'number':
      return normalizeNumberSchema(schema);
    case 'record':
      return normalizeRecordSchema(schema, depth);
    case 'string':
      return normalizeStringSchema(schema);
    default:
      return contractError('A server-function value schema has an unknown kind.');
  }
};

export const normalizeDefinition = (
  definition: ServerFunctionDefinitionV1,
): ServerFunctionDefinitionV1 => {
  if (definition.schemaVersion !== 'oxe.server-function.v1') {
    return contractError('Expected an oxe.server-function.v1 definition.');
  }
  if (definition.mode !== 'query' && definition.mode !== 'mutation') {
    return contractError('A server function must be a query or mutation.');
  }
  if (!functionIdPattern.test(definition.id)) {
    return contractError(`Invalid server-function id ${JSON.stringify(definition.id)}.`);
  }
  if (
    !Array.isArray(definition.path) ||
    definition.path.length === 0 ||
    definition.path.some((segment) => !identifierPattern.test(segment))
  ) {
    return contractError(`Invalid server-function path ${JSON.stringify(definition.path)}.`);
  }
  if (!Array.isArray(definition.parameters)) {
    return contractError('Server-function parameters must be an array.');
  }
  const names = new Set<string>();
  const parameters = definition.parameters.map((parameter): ServerFunctionParameterV1 => {
    if (!identifierPattern.test(parameter.name)) {
      return contractError(`Invalid server-function parameter ${JSON.stringify(parameter.name)}.`);
    }
    if (names.has(parameter.name)) {
      return contractError(
        `Duplicate server-function parameter ${JSON.stringify(parameter.name)}.`,
      );
    }
    names.add(parameter.name);
    return Object.freeze({ name: parameter.name, schema: normalizeSchema(parameter.schema) });
  });
  return Object.freeze({
    id: definition.id,
    mode: definition.mode,
    parameters: Object.freeze(parameters),
    path: Object.freeze([...definition.path]),
    returns: normalizeSchema(definition.returns),
    schemaVersion: definition.schemaVersion,
  });
};

interface VisitState {
  readonly limits: ResolvedServerFunctionSerializationLimits;
  nodes: number;
  readonly seen: Set<object>;
}

const serializationError = (path: string, message: string): never => {
  throw new OxeServerFunctionSerializationError({ message, path });
};

const visitNode = (state: VisitState, depth: number, path: string): void => {
  if (depth > state.limits.maximumDepth) {
    serializationError(path, `Value exceeds the maximum depth of ${state.limits.maximumDepth}.`);
  }
  state.nodes += 1;
  if (state.nodes > state.limits.maximumNodes) {
    serializationError(
      path,
      `Value exceeds the maximum node count of ${state.limits.maximumNodes}.`,
    );
  }
};

const withSeen = <Value>(
  value: object,
  path: string,
  state: VisitState,
  run: () => Value,
): Value => {
  if (state.seen.has(value)) serializationError(path, 'Values cannot contain cycles.');
  state.seen.add(value);
  try {
    return run();
  } finally {
    state.seen.delete(value);
  }
};

const normalizeArrayValue = (
  schema: ArraySchemaV1,
  value: unknown,
  path: string,
  depth: number,
  state: VisitState,
): readonly unknown[] => {
  if (!Array.isArray(value)) return serializationError(path, 'Expected an array.');
  if (schema.minimumItems !== undefined && value.length < schema.minimumItems) {
    serializationError(path, `Expected at least ${schema.minimumItems} array items.`);
  }
  if (schema.maximumItems !== undefined && value.length > schema.maximumItems) {
    serializationError(path, `Expected at most ${schema.maximumItems} array items.`);
  }
  return withSeen(value, path, state, () =>
    Object.freeze(
      value.map((item, index) =>
        normalizeValueInternal(schema.items, item, `${path}[${index}]`, depth + 1, state),
      ),
    ),
  );
};

const plainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const normalizeRecordValue = (
  schema: RecordSchemaV1,
  value: unknown,
  path: string,
  depth: number,
  state: VisitState,
): Readonly<Record<string, unknown>> => {
  if (!plainRecord(value)) return serializationError(path, 'Expected a plain record.');
  if (Object.getOwnPropertySymbols(value).length > 0) {
    serializationError(path, 'Records cannot contain symbol keys.');
  }
  const expected = new Set(schema.fields.map((field) => field.name));
  const actual = Object.keys(value);
  const unknown = actual.find((name) => !expected.has(name));
  if (unknown !== undefined) serializationError(`${path}.${unknown}`, 'Unknown record field.');
  return withSeen(value, path, state, () => {
    const result: Record<string, unknown> = Object.create(null);
    for (const field of schema.fields) {
      if (!Object.hasOwn(value, field.name)) {
        serializationError(`${path}.${field.name}`, 'Missing required record field.');
      }
      Object.defineProperty(result, field.name, {
        configurable: false,
        enumerable: true,
        value: normalizeValueInternal(
          field.schema,
          value[field.name],
          `${path}.${field.name}`,
          depth + 1,
          state,
        ),
        writable: false,
      });
    }
    return Object.freeze(result);
  });
};

const normalizeValueInternal = (
  schema: ServerValueSchemaV1,
  value: unknown,
  path: string,
  depth: number,
  state: VisitState,
): unknown => {
  visitNode(state, depth, path);
  switch (schema.kind) {
    case 'array':
      return normalizeArrayValue(schema, value, path, depth, state);
    case 'boolean':
      if (typeof value !== 'boolean') return serializationError(path, 'Expected a boolean.');
      return value;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return serializationError(path, 'Expected a finite number.');
      }
      if (schema.integer && !Number.isInteger(value)) {
        return serializationError(path, 'Expected an integer.');
      }
      if (schema.minimum !== undefined && value < schema.minimum) {
        return serializationError(
          path,
          `Expected a number greater than or equal to ${schema.minimum}.`,
        );
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        return serializationError(
          path,
          `Expected a number less than or equal to ${schema.maximum}.`,
        );
      }
      return Object.is(value, -0) ? 0 : value;
    case 'record':
      return normalizeRecordValue(schema, value, path, depth, state);
    case 'string':
      if (typeof value !== 'string') return serializationError(path, 'Expected a string.');
      if (schema.minimumLength !== undefined && value.length < schema.minimumLength) {
        return serializationError(path, `Expected at least ${schema.minimumLength} characters.`);
      }
      if (schema.maximumLength !== undefined && value.length > schema.maximumLength) {
        return serializationError(path, `Expected at most ${schema.maximumLength} characters.`);
      }
      if (schema.enum && !schema.enum.includes(value)) {
        return serializationError(
          path,
          `Expected one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}.`,
        );
      }
      return value;
  }
};

export const normalizeValue = (
  schema: ServerValueSchemaV1,
  value: unknown,
  path: string,
  limits: ResolvedServerFunctionSerializationLimits,
): unknown =>
  normalizeValueInternal(schema, value, path, 0, {
    limits,
    nodes: 0,
    seen: new Set(),
  });

export const normalizeArguments = (
  definition: ServerFunctionDefinitionV1,
  values: readonly unknown[],
  limits: ResolvedServerFunctionSerializationLimits,
): readonly unknown[] => {
  if (values.length !== definition.parameters.length) {
    return serializationError(
      '$.arguments',
      `Expected ${definition.parameters.length} arguments, but received ${values.length}.`,
    );
  }
  const state: VisitState = { limits, nodes: 0, seen: new Set() };
  return Object.freeze(
    definition.parameters.map((parameter, index) =>
      normalizeValueInternal(
        parameter.schema,
        values[index],
        `$.arguments[${index}] (${parameter.name})`,
        0,
        state,
      ),
    ),
  );
};
