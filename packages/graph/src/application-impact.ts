import { indexApplicationGraph } from './application-index.js';
import {
  mutateApplicationGraph,
  type ApplicationMutationBatchV1,
  type ApplicationMutationResultV1,
} from './application-mutate.js';
import type { ApplicationGraphV1, ApplicationSemanticIdV1 } from './application-types.js';

export type ApplicationNodeChangeKindV1 = 'added' | 'changed' | 'removed';

export interface ApplicationNodeChangeV1 {
  readonly change: ApplicationNodeChangeKindV1;
  readonly id: ApplicationSemanticIdV1;
  readonly kind: string;
}

export interface ApplicationImpactedNodeV1 {
  readonly id: ApplicationSemanticIdV1;
  readonly kind: string;
  readonly reason: 'changed' | 'dependent';
}

export interface ApplicationGraphImpactV1 {
  readonly changes: readonly ApplicationNodeChangeV1[];
  readonly impacted: readonly ApplicationImpactedNodeV1[];
  readonly schemaVersion: 'oxe.application-graph-impact.v1';
}

/** Deterministic, compact explanation intended for AI review and revision UIs. */
export const formatApplicationGraphImpact = (impact: ApplicationGraphImpactV1): string => {
  const changes = [...impact.changes].sort(
    (left, right) =>
      compareText(left.id, right.id) ||
      compareText(left.change, right.change) ||
      compareText(left.kind, right.kind),
  );
  const dependents = impact.impacted
    .filter((node) => node.reason === 'dependent')
    .sort((left, right) => compareText(left.id, right.id) || compareText(left.kind, right.kind));
  const lines = [
    `impact changes=${impact.changes.length} affected=${impact.impacted.length}`,
    ...changes.map((change) => `change ${change.change} ${change.kind} ${change.id}`),
    ...dependents.map((node) => `because dependent ${node.kind} ${node.id}`),
  ];
  return `${lines.join('\n')}\n`;
};

export interface ApplicationIncomingReferenceV1 {
  readonly label: string;
  readonly path: string;
  readonly sourceId: ApplicationSemanticIdV1;
  readonly targetId: ApplicationSemanticIdV1;
}

export type ApplicationMutationPreviewV1 =
  | {
      readonly impact: ApplicationGraphImpactV1;
      readonly ok: true;
      readonly result: Extract<ApplicationMutationResultV1, { readonly ok: true }>;
    }
  | {
      readonly incomingReferences: readonly ApplicationIncomingReferenceV1[];
      readonly ok: false;
      readonly result: Extract<ApplicationMutationResultV1, { readonly ok: false }>;
    };

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/** Computes the stable-ID change set and the transitive incoming dependency closure. */
export const analyzeApplicationGraphImpact = (
  before: ApplicationGraphV1,
  after: ApplicationGraphV1,
): ApplicationGraphImpactV1 => {
  const beforeIndex = indexApplicationGraph(before);
  const afterIndex = indexApplicationGraph(after);
  const beforeNodes = new Map(beforeIndex.nodes.map((node) => [node.id, node]));
  const afterNodes = new Map(afterIndex.nodes.map((node) => [node.id, node]));
  const referenceKey = (sourceId: string, targetId: string, label: string): string =>
    `${sourceId}\u0000${targetId}\u0000${label}`;
  const beforeReferences = new Set(
    beforeIndex.references.map(({ label, sourceId, targetId }) =>
      referenceKey(sourceId, targetId, label),
    ),
  );
  const afterReferences = new Set(
    afterIndex.references.map(({ label, sourceId, targetId }) =>
      referenceKey(sourceId, targetId, label),
    ),
  );
  const referenceChangedSources = new Set<string>();
  for (const reference of beforeIndex.references)
    if (!afterReferences.has(referenceKey(reference.sourceId, reference.targetId, reference.label)))
      referenceChangedSources.add(reference.sourceId);
  for (const reference of afterIndex.references)
    if (
      !beforeReferences.has(referenceKey(reference.sourceId, reference.targetId, reference.label))
    )
      referenceChangedSources.add(reference.sourceId);

  const ids = new Set([...beforeNodes.keys(), ...afterNodes.keys()]);
  const changes: ApplicationNodeChangeV1[] = [];
  for (const id of [...ids].sort(compareText)) {
    const previous = beforeNodes.get(id);
    const next = afterNodes.get(id);
    if (!previous && next) changes.push({ change: 'added', id, kind: next.kind });
    else if (previous && !next) changes.push({ change: 'removed', id, kind: previous.kind });
    else if (
      previous &&
      next &&
      (previous.bodyJson !== next.bodyJson || referenceChangedSources.has(id))
    )
      changes.push({ change: 'changed', id, kind: next.kind });
  }

  const incoming = new Map<string, Set<string>>();
  for (const reference of [...beforeIndex.references, ...afterIndex.references]) {
    const sources = incoming.get(reference.targetId) ?? new Set<string>();
    sources.add(reference.sourceId);
    incoming.set(reference.targetId, sources);
  }
  const impactedIds = new Set(changes.map((change) => change.id));
  const queue = [...impactedIds].sort(compareText);
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    if (!id) continue;
    for (const sourceId of [...(incoming.get(id) ?? [])].sort(compareText)) {
      if (impactedIds.has(sourceId)) continue;
      impactedIds.add(sourceId);
      queue.push(sourceId);
    }
  }
  const changedIds = new Set(changes.map((change) => change.id));
  const impacted = [...impactedIds].sort(compareText).map((id): ApplicationImpactedNodeV1 => {
    const node = afterNodes.get(id) ?? beforeNodes.get(id);
    return {
      id,
      kind: node?.kind ?? 'unknown',
      reason: changedIds.has(id) ? 'changed' : 'dependent',
    };
  });
  return Object.freeze({
    changes: Object.freeze(changes),
    impacted: Object.freeze(impacted),
    schemaVersion: 'oxe.application-graph-impact.v1',
  });
};

/** Runs a typed mutation without publishing it and reports its exact semantic blast radius. */
export const previewApplicationMutation = (
  graph: ApplicationGraphV1,
  batch: ApplicationMutationBatchV1,
): ApplicationMutationPreviewV1 => {
  const result = mutateApplicationGraph(graph, batch);
  if (!result.ok) {
    const removals = new Set(
      batch.ops.flatMap((operation) =>
        operation.op === 'semantic.remove' && !operation.node.startsWith('$')
          ? [operation.node]
          : [],
      ),
    );
    const incomingReferences = indexApplicationGraph(graph)
      .references.filter((reference) => removals.has(reference.targetId))
      .map(({ label, path, sourceId, targetId }) => ({ label, path, sourceId, targetId }));
    return Object.freeze({
      incomingReferences: Object.freeze(incomingReferences),
      ok: false,
      result,
    });
  }
  return Object.freeze({
    impact: analyzeApplicationGraphImpact(graph, result.graph),
    ok: true,
    result,
  });
};
