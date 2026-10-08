import {
  canonicalizeApplicationGraph,
  serializeCompactApplicationJson,
} from './application-serialize.js';
import { collectApplicationGraphReferences } from './application-validate.js';
import type {
  ApplicationGraphV1,
  ApplicationSemanticIdV1,
  ApplicationViewElementV1,
} from './application-types.js';

export interface IndexedApplicationNodeV1 {
  readonly bodyJson: string;
  readonly id: ApplicationSemanticIdV1;
  readonly kind: string;
  readonly path: string;
}

export interface IndexedApplicationReferenceV1 {
  readonly label: string;
  readonly path: string;
  readonly sourceId: ApplicationSemanticIdV1;
  readonly targetId: ApplicationSemanticIdV1;
}

export interface IndexedApplicationGraphV1 {
  readonly nodes: readonly IndexedApplicationNodeV1[];
  readonly references: readonly IndexedApplicationReferenceV1[];
}

interface NodeSource {
  readonly id: string;
  readonly kind: string;
  readonly path: string;
  readonly value: unknown;
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const collectElementSources = (
  element: ApplicationViewElementV1,
  path: string,
  sources: NodeSource[],
): void => {
  if (element.id) sources.push({ id: element.id, kind: element.kind, path, value: element });
  if (element.kind === 'repeat')
    collectElementSources(element.template, `${path}.template`, sources);
  else
    element.children?.forEach((child, index) =>
      collectElementSources(child, `${path}.children[${index}]`, sources),
    );
};

const collectNodeSources = (graph: ApplicationGraphV1): NodeSource[] => {
  const sources: NodeSource[] = [
    { id: graph.app.id, kind: graph.app.kind, path: '$.app', value: graph.app },
  ];
  const groups = [
    ['capabilities', graph.capabilities ?? []],
    ['components', graph.components ?? []],
    ['contexts', graph.contexts ?? []],
    ['features', graph.features],
    ['entities', graph.entities],
    ['fields', graph.fields],
    ['modules', graph.modules ?? []],
    ['relations', graph.relations],
    ['policies', graph.policies],
    ['queries', graph.queries],
    ['operations', graph.operations],
    ['routes', graph.routes],
    ['styles', graph.styles ?? []],
    ['uniques', graph.uniques ?? []],
    ['views', graph.views],
  ] as const;
  for (const [name, values] of groups)
    values.forEach((value, index) =>
      sources.push({
        id: value.id,
        kind: value.kind,
        path: `$.${name}[${index}]`,
        value,
      }),
    );
  graph.views.forEach((view, index) =>
    collectElementSources(view.tree, `$.views[${index}].tree`, sources),
  );
  graph.verification.invariants.forEach((value, index) =>
    sources.push({
      id: value.id,
      kind: value.kind,
      path: `$.verification.invariants[${index}]`,
      value,
    }),
  );
  graph.verification.flows.forEach((value, index) =>
    sources.push({
      id: value.id,
      kind: value.kind,
      path: `$.verification.flows[${index}]`,
      value,
    }),
  );
  return sources.sort((left, right) => compareText(left.id, right.id));
};

const compactNodeBody = (value: unknown, nodeId: string): unknown => {
  if (Array.isArray(value)) return value.map((item) => compactNodeBody(item, nodeId));
  if (!isRecord(value)) return value;
  if (typeof value.id === 'string' && value.id !== nodeId) return { id: value.id };
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, compactNodeBody(item, nodeId)]),
  );
};

/** Builds dense storage records and reference edges from stable application-level identities. */
export const indexApplicationGraph = (graph: ApplicationGraphV1): IndexedApplicationGraphV1 => {
  const canonicalGraph = canonicalizeApplicationGraph(graph);
  const sources = collectNodeSources(canonicalGraph);
  const referenceLabel = (path: string): string => {
    const containerPath = path.replace(/(?:\[\d+\]|\["(?:[^"\\]|\\.)*"\])$/u, '');
    return /\.([A-Za-z_$][A-Za-z0-9_$]*)$/u.exec(containerPath)?.[1] ?? 'reference';
  };
  const references: IndexedApplicationReferenceV1[] = collectApplicationGraphReferences(
    canonicalGraph,
  ).map((reference) => ({ ...reference, label: referenceLabel(reference.path) }));
  references.sort(
    (left, right) =>
      compareText(left.sourceId, right.sourceId) ||
      compareText(left.targetId, right.targetId) ||
      compareText(left.path, right.path),
  );
  return {
    nodes: sources.map((source) => ({
      bodyJson: serializeCompactApplicationJson(compactNodeBody(source.value, source.id)),
      id: source.id,
      kind: source.kind,
      path: source.path,
    })),
    references,
  };
};
