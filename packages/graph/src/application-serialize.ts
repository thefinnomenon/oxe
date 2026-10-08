import type { ApplicationGraphV1 } from './application-types.js';

type JsonValue = boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const byId = <T extends { readonly id: string }>(left: T, right: T): number =>
  compareText(left.id, right.id);

/** Returns a canonical graph value without changing semantically ordered nested collections. */
export const canonicalizeApplicationGraph = (graph: ApplicationGraphV1): ApplicationGraphV1 => ({
  ...graph,
  ...(graph.capabilities ? { capabilities: [...graph.capabilities].sort(byId) } : {}),
  ...(graph.components ? { components: [...graph.components].sort(byId) } : {}),
  ...(graph.contexts ? { contexts: [...graph.contexts].sort(byId) } : {}),
  entities: [...graph.entities].sort(byId),
  features: [...graph.features].sort(byId),
  fields: [...graph.fields].sort(byId),
  ...(graph.modules ? { modules: [...graph.modules].sort(byId) } : {}),
  operations: [...graph.operations].sort(byId),
  policies: [...graph.policies].sort(byId),
  queries: [...graph.queries].sort(byId),
  relations: [...graph.relations].sort(byId),
  routes: [...graph.routes].sort(byId),
  ...(graph.styles ? { styles: [...graph.styles].sort(byId) } : {}),
  ...(graph.uniques ? { uniques: [...graph.uniques].sort(byId) } : {}),
  verification: {
    flows: [...graph.verification.flows].sort(byId),
    invariants: [...graph.verification.invariants].sort(byId),
  },
  views: [...graph.views].sort(byId),
});

export const canonicalizeApplicationJson = (value: unknown): JsonValue => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new TypeError('OXE application graph numbers must be finite.');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalizeApplicationJson);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const result: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(record).sort(compareText)) {
      const item = record[key];
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol')
        throw new TypeError(`OXE application graph field "${key}" is not JSON-serializable.`);
      result[key] = canonicalizeApplicationJson(item);
    }
    return result;
  }
  throw new TypeError(`OXE application graph contains a non-JSON value of type ${typeof value}.`);
};

/** Deterministic canonical export. Semantically unordered top-level node collections sort by id. */
export const serializeApplicationGraph = (graph: ApplicationGraphV1): string =>
  `${JSON.stringify(canonicalizeApplicationJson(canonicalizeApplicationGraph(graph)), null, 2)}\n`;

/** Compact canonical JSON used for SQLite node bodies and mutation log entries. */
export const serializeCompactApplicationJson = (value: unknown): string =>
  JSON.stringify(canonicalizeApplicationJson(value));
