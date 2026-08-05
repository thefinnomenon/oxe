import type {
  GraphSpanV1,
  ServerValueSchemaV1,
  UiEdgeV1,
  UiGraphV1,
  ValueExpressionV1,
} from './types.js';

type JsonValue = boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareSpans = (left: GraphSpanV1, right: GraphSpanV1): number =>
  compareText(left.fileName, right.fileName) ||
  left.start.offset - right.start.offset ||
  left.start.line - right.start.line ||
  left.start.column - right.start.column ||
  left.end.offset - right.end.offset ||
  left.end.line - right.end.line ||
  left.end.column - right.end.column;

const spanKey = (span: GraphSpanV1): string =>
  `${span.fileName}\0${span.start.offset}\0${span.start.line}\0${span.start.column}\0` +
  `${span.end.offset}\0${span.end.line}\0${span.end.column}`;

const accessKey = (access: {
  readonly path: readonly string[];
  readonly span: GraphSpanV1;
}): string => `${access.path.join('\0')}\0${spanKey(access.span)}`;

const expressionKey = (expression: ValueExpressionV1): string => {
  switch (expression.kind) {
    case 'array':
      return `array\0${expression.elements.map(expressionKey).join('\0')}\0${spanKey(expression.span)}`;
    case 'binary':
      return (
        `binary\0${expression.operator}\0${expressionKey(expression.left)}\0` +
        `${expressionKey(expression.right)}\0${spanKey(expression.span)}`
      );
    case 'call':
      return `call\0${expression.returnType ?? ''}\0${expressionKey(expression.callee)}\0${expression.arguments.map(expressionKey).join('\0')}\0${spanKey(expression.span)}`;
    case 'capability-read':
      return `capability-read\0${expression.targetId}\0${spanKey(expression.span)}`;
    case 'collection':
      return `collection\0${expression.operation}\0${expressionKey(expression.source)}\0${expression.callback.parameters.map((parameter) => parameter.name).join('\0')}\0${expressionKey(expression.callback.result)}\0${expression.initial ? expressionKey(expression.initial) : ''}\0${expression.options ? expressionKey(expression.options) : ''}\0${spanKey(expression.span)}`;
    case 'conditional':
      return `conditional\0${expression.branches
        .map(
          (branch) =>
            `${branch.condition ? expressionKey(branch.condition) : 'fallback'}\0${expressionKey(branch.result)}\0${spanKey(branch.span)}`,
        )
        .join('\0')}\0${spanKey(expression.span)}`;
    case 'literal':
      return `literal\0${typeof expression.value}\0${JSON.stringify(expression.value)}\0${spanKey(expression.span)}`;
    case 'local-read':
      return `local-read\0${expression.targetId}\0${expression.type}\0${expression.record ? expressionKey(expression.record) : ''}\0${spanKey(expression.span)}`;
    case 'member':
      return `member\0${expressionKey(expression.object)}\0${expression.property}\0${spanKey(expression.span)}`;
    case 'record':
      return `record\0${expression.entries.map((entry) => `${entry.name}\0${expressionKey(entry.value)}`).join('\0')}\0${spanKey(expression.span)}`;
    case 'read':
      return `read\0${expression.tracked === false ? 'untracked' : 'tracked'}\0${expression.targetId}\0${spanKey(expression.span)}`;
  }
};

const edgeKey = (edge: UiEdgeV1): string => {
  switch (edge.kind) {
    case 'child':
      return `${edge.kind}\0${edge.from}\0${edge.to}\0${edge.index.toString().padStart(10, '0')}`;
    case 'event':
      return (
        `${edge.kind}\0${edge.from}\0${edge.to}\0${edge.authoredName}\0${edge.event}\0` +
        spanKey(edge.span)
      );
    case 'owner':
      return `${edge.kind}\0${edge.from}\0${edge.to}`;
    case 'prop':
      return edge.mode === 'reactive'
        ? `${edge.kind}\0${edge.from}\0${edge.to}\0${edge.index ?? ''}\0${edge.authoredName ?? ''}\0${edge.mode}\0${expressionKey(edge.value)}\0${spanKey(edge.span)}`
        : `${edge.kind}\0${edge.from}\0${edge.to}\0${edge.index ?? ''}\0${edge.authoredName ?? ''}\0${edge.mode}\0${edge.targetId}\0${spanKey(edge.span)}`;
    case 'spread-prop':
      return edge.source.kind === 'rest'
        ? `${edge.kind}\0${edge.from}\0${edge.to}\0${edge.index}\0${edge.source.kind}\0${edge.source.targetId}\0${spanKey(edge.source.span)}\0${spanKey(edge.span)}`
        : `${edge.kind}\0${edge.from}\0${edge.to}\0${edge.index}\0${edge.source.kind}\0${expressionKey(edge.source.value)}\0${spanKey(edge.span)}`;
    case 'read':
      return (
        `${edge.kind}\0${edge.from}\0${edge.to}\0${edge.mode}\0` +
        `${(edge.accesses ?? []).map(accessKey).join('\0')}\0` +
        edge.sites.map(spanKey).join('\0')
      );
    case 'write':
      return (
        `${edge.kind}\0${edge.from}\0${edge.to}\0${edge.mode}\0` +
        `${(edge.accesses ?? []).map(accessKey).join('\0')}\0` +
        edge.sites.map(spanKey).join('\0')
      );
  }
};

const normalizeEdge = (edge: UiEdgeV1): UiEdgeV1 => {
  if (edge.kind === 'read' || edge.kind === 'write') {
    return {
      ...edge,
      ...(edge.accesses
        ? {
            accesses: [...edge.accesses].sort(
              (left, right) =>
                compareText(left.path.join('\0'), right.path.join('\0')) ||
                compareSpans(left.span, right.span),
            ),
          }
        : {}),
      sites: [...edge.sites].sort(compareSpans),
    };
  }
  return edge;
};

const normalizeServerSchema = (schema: ServerValueSchemaV1): ServerValueSchemaV1 => {
  if (schema.kind === 'array') {
    return { ...schema, items: normalizeServerSchema(schema.items) };
  }
  if (schema.kind === 'record') {
    return {
      ...schema,
      fields: schema.fields
        .map((field) => ({ ...field, schema: normalizeServerSchema(field.schema) }))
        .sort((left, right) => compareText(left.name, right.name)),
    };
  }
  if (schema.kind === 'string' && schema.enum) {
    return { ...schema, enum: [...schema.enum].sort(compareText) };
  }
  return schema;
};

const normalizeGraph = (graph: UiGraphV1): UiGraphV1 => ({
  ...graph,
  edges: [...graph.edges]
    .map(normalizeEdge)
    .sort((left, right) => compareText(edgeKey(left), edgeKey(right))),
  entryComponents: [...graph.entryComponents].sort(compareText),
  nodes: [...graph.nodes].sort((left, right) => compareText(left.id, right.id)),
  ...(graph.serverFunctions
    ? {
        serverFunctions: [...graph.serverFunctions]
          .map((definition) => ({
            ...definition,
            parameters: definition.parameters.map((parameter) => ({
              ...parameter,
              schema: normalizeServerSchema(parameter.schema),
            })),
            returns: normalizeServerSchema(definition.returns),
          }))
          .sort((left, right) => compareText(left.id, right.id)),
      }
    : {}),
});

const canonicalize = (value: unknown): JsonValue => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('OXE graph numbers must be finite.');
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (typeof value === 'object') {
    // This is the single serialization boundary. Graph interfaces guarantee string
    // keys; the runtime check below rejects non-JSON values before output.
    const record = value as Record<string, unknown>;
    const result: { [key: string]: JsonValue } = {};

    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
        throw new TypeError(`OXE graph field "${key}" is not JSON-serializable.`);
      }
      result[key] = canonicalize(item);
    }

    return result;
  }

  throw new TypeError(`OXE graph contains a non-JSON value of type ${typeof value}.`);
};

export const serializeUiGraph = (graph: UiGraphV1): string =>
  `${JSON.stringify(canonicalize(normalizeGraph(graph)), null, 2)}\n`;

/** Stable, non-cryptographic build identity used only to reject incompatible hydration payloads. */
export const fingerprintUiGraph = (graph: UiGraphV1): string => {
  let hash = 0x811c9dc5;
  for (const character of serializeUiGraph(graph)) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return `oxe-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};
