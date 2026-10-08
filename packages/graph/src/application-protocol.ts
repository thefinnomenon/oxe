import { indexApplicationGraph } from './application-index.js';
import {
  measureCompactApplicationProjection,
  projectCompactApplicationGraph,
  type CompactApplicationProjectionSize,
} from './application-inspect.js';
import {
  analyzeApplicationGraphImpact,
  previewApplicationMutation,
  type ApplicationGraphImpactV1,
  type ApplicationMutationPreviewV1,
} from './application-impact.js';
import type {
  IndexedApplicationNodeV1,
  IndexedApplicationReferenceV1,
} from './application-index.js';
import {
  validateApplicationMutationBatch,
  type ApplicationMutationBatchV1,
  type ApplicationMutationResultV1,
} from './application-mutate.js';
import { serializeApplicationGraph } from './application-serialize.js';
import type { ApplicationGraphV1 } from './application-types.js';

export const APPLICATION_AGENT_REQUEST_SCHEMA = 'oxe.application-agent-request.v1' as const;
export const APPLICATION_AGENT_RESPONSE_SCHEMA = 'oxe.application-agent-response.v1' as const;

export type ApplicationAgentInspectV1 =
  | { readonly kind: 'map' }
  | { readonly kind: 'history'; readonly limit?: number }
  | {
      readonly fromRevision: number;
      readonly kind: 'diff';
      readonly toRevision?: number;
    }
  | { readonly kind: 'incoming'; readonly semanticId: string }
  | { readonly kind: 'node'; readonly semanticId: string }
  | { readonly kind: 'nodes'; readonly kinds?: readonly string[]; readonly limit?: number }
  | { readonly kind: 'search'; readonly limit?: number; readonly text: string };

export type ApplicationAgentOperationV1 =
  | {
      readonly inspect: ApplicationAgentInspectV1;
      readonly kind: 'inspect';
      readonly revision?: number;
    }
  | { readonly batch: ApplicationMutationBatchV1; readonly kind: 'preview' }
  | {
      readonly batch: ApplicationMutationBatchV1;
      readonly kind: 'commit';
      readonly previewFingerprint?: string;
    }
  | {
      readonly baseRevision: number;
      readonly kind: 'revert';
      readonly targetRevision: number;
    };

export interface ApplicationAgentRequestV1 {
  readonly appId: string;
  readonly operation: ApplicationAgentOperationV1;
  readonly requestId: string;
  readonly schemaVersion: typeof APPLICATION_AGENT_REQUEST_SCHEMA;
}

export interface ApplicationAgentProtocolDiagnosticV1 {
  readonly code: 'OXE3401' | 'OXE3402' | 'OXE3403' | 'OXE3404';
  readonly message: string;
  readonly path: string;
}

export interface ApplicationAgentRevisionMetadataV1 {
  readonly contentHash: string;
  readonly createdAt: string;
  readonly mutationCount: number;
  readonly parentRevision: number | null;
  readonly reason: string;
  readonly revision: number;
}

export interface ApplicationAgentArtifactPlanV1 {
  readonly artifacts: readonly {
    readonly id: string;
    readonly kind: string;
    readonly semanticIds: readonly string[];
  }[];
  readonly rebuildAll: boolean;
  readonly schemaVersion: string;
}

export interface ApplicationAgentArtifactPublicationV1 {
  readonly artifacts: readonly {
    readonly bytes: number;
    readonly fingerprint: string;
    readonly id: string;
    readonly status: 'built' | 'reused';
  }[];
  readonly stats: {
    readonly built: number;
    readonly removed: number;
    readonly reused: number;
  };
}

export type ApplicationAgentResultV1 =
  | {
      readonly kind: 'inspect.map';
      readonly projection: string;
      readonly size: CompactApplicationProjectionSize;
    }
  | {
      readonly kind: 'inspect.history';
      readonly revisions: readonly ApplicationAgentRevisionMetadataV1[];
    }
  | {
      readonly fromRevision: number;
      readonly impact: ApplicationGraphImpactV1;
      readonly kind: 'inspect.diff';
      readonly toRevision: number;
    }
  | {
      readonly kind: 'inspect.incoming';
      readonly references: readonly IndexedApplicationReferenceV1[];
      readonly semanticId: string;
    }
  | {
      readonly incoming: readonly IndexedApplicationReferenceV1[];
      readonly kind: 'inspect.node';
      readonly node: IndexedApplicationNodeV1;
      readonly outgoing: readonly IndexedApplicationReferenceV1[];
    }
  | {
      readonly kind: 'inspect.nodes';
      readonly nodes: readonly {
        readonly id: string;
        readonly incoming: number;
        readonly kind: string;
        readonly outgoing: number;
        readonly path: string;
      }[];
    }
  | {
      readonly kind: 'inspect.search';
      readonly matches: readonly IndexedApplicationNodeV1[];
      readonly text: string;
    }
  | {
      readonly artifactPlan?: ApplicationAgentArtifactPlanV1;
      readonly kind: 'preview';
      readonly preview: ApplicationMutationPreviewV1;
      readonly previewFingerprint?: string;
    }
  | {
      readonly changes: Extract<ApplicationMutationResultV1, { readonly ok: true }>['changes'];
      readonly contentHash?: string;
      readonly kind: 'commit';
      readonly parentRevision?: number;
      readonly publication?: ApplicationAgentArtifactPublicationV1;
      readonly summary: string;
    }
  | {
      readonly changes: Extract<ApplicationMutationResultV1, { readonly ok: true }>['changes'];
      readonly contentHash?: string;
      readonly kind: 'revert';
      readonly parentRevision?: number;
      readonly publication?: ApplicationAgentArtifactPublicationV1;
      readonly restoredRevision: number;
      readonly summary: string;
    };

type AgentCommitResult = ApplicationMutationResultV1 & {
  readonly contentHash?: string;
  readonly parentRevision?: number;
};

export interface ApplicationAgentProtocolAdapterV1 {
  readonly commit: (appId: string, batch: ApplicationMutationBatchV1) => AgentCommitResult;
  readonly current: (appId: string) => ApplicationGraphV1 | undefined;
  readonly history?: (appId: string) => readonly ApplicationAgentRevisionMetadataV1[];
  readonly load?: (appId: string, revision: number) => ApplicationGraphV1 | undefined;
  readonly undo?: (
    appId: string,
    baseRevision: number,
    targetRevision: number,
  ) => AgentCommitResult;
  readonly planArtifacts?: (
    before: ApplicationGraphV1,
    after: ApplicationGraphV1,
  ) => ApplicationAgentArtifactPlanV1;
  readonly publishArtifacts?: (
    before: ApplicationGraphV1,
    after: ApplicationGraphV1,
  ) => ApplicationAgentArtifactPublicationV1;
}

export type ApplicationAgentResponseV1 =
  | {
      readonly appId: string;
      readonly diagnostics: readonly ApplicationAgentProtocolDiagnosticV1[];
      readonly ok: false;
      readonly requestId: string;
      readonly schemaVersion: typeof APPLICATION_AGENT_RESPONSE_SCHEMA;
    }
  | {
      readonly appId: string;
      readonly ok: true;
      readonly requestId: string;
      readonly result: ApplicationAgentResultV1;
      readonly revision: number;
      readonly schemaVersion: typeof APPLICATION_AGENT_RESPONSE_SCHEMA;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const exactKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  diagnostics: ApplicationAgentProtocolDiagnosticV1[],
): void => {
  for (const key of Object.keys(value).sort())
    if (!allowed.includes(key))
      diagnostics.push({
        code: 'OXE3401',
        message: `Unknown protocol property "${key}".`,
        path: `${path}.${key}`,
      });
};

export const validateApplicationAgentRequest = (
  value: unknown,
): readonly ApplicationAgentProtocolDiagnosticV1[] => {
  const diagnostics: ApplicationAgentProtocolDiagnosticV1[] = [];
  if (!isRecord(value))
    return [{ code: 'OXE3401', message: 'Agent request must be an object.', path: '$' }];
  exactKeys(value, ['appId', 'operation', 'requestId', 'schemaVersion'], '$', diagnostics);
  if (value.schemaVersion !== APPLICATION_AGENT_REQUEST_SCHEMA)
    diagnostics.push({
      code: 'OXE3401',
      message: `Agent request schema must be "${APPLICATION_AGENT_REQUEST_SCHEMA}".`,
      path: '$.schemaVersion',
    });
  for (const key of ['appId', 'requestId'] as const)
    if (typeof value[key] !== 'string' || value[key].length === 0)
      diagnostics.push({
        code: 'OXE3401',
        message: `${key} must be a non-empty string.`,
        path: `$.${key}`,
      });
  if (!isRecord(value.operation)) {
    diagnostics.push({
      code: 'OXE3401',
      message: 'Agent operation must be an object.',
      path: '$.operation',
    });
    return diagnostics;
  }
  const operation = value.operation;
  if (operation.kind === 'inspect') {
    exactKeys(operation, ['inspect', 'kind', 'revision'], '$.operation', diagnostics);
    if (
      operation.revision !== undefined &&
      (typeof operation.revision !== 'number' ||
        !Number.isSafeInteger(operation.revision) ||
        operation.revision < 0)
    )
      diagnostics.push({
        code: 'OXE3401',
        message: 'Inspection revision must be a nonnegative integer.',
        path: '$.operation.revision',
      });
    if (!isRecord(operation.inspect))
      diagnostics.push({
        code: 'OXE3401',
        message: 'Inspection selector must be an object.',
        path: '$.operation.inspect',
      });
    else {
      const inspect = operation.inspect;
      const kind = inspect.kind;
      const allowed =
        kind === 'map'
          ? ['kind']
          : kind === 'history'
            ? ['kind', 'limit']
            : kind === 'diff'
              ? ['fromRevision', 'kind', 'toRevision']
              : kind === 'incoming' || kind === 'node'
                ? ['kind', 'semanticId']
                : kind === 'nodes'
                  ? ['kind', 'kinds', 'limit']
                  : kind === 'search'
                    ? ['kind', 'limit', 'text']
                    : undefined;
      if (!allowed)
        diagnostics.push({
          code: 'OXE3401',
          message: 'Unknown inspection kind.',
          path: '$.operation.inspect.kind',
        });
      else exactKeys(inspect, allowed, '$.operation.inspect', diagnostics);
      if (
        (kind === 'incoming' || kind === 'node') &&
        (typeof inspect.semanticId !== 'string' || inspect.semanticId.length === 0)
      )
        diagnostics.push({
          code: 'OXE3401',
          message: 'Inspection semanticId must be a non-empty string.',
          path: '$.operation.inspect.semanticId',
        });
      if (kind === 'search' && (typeof inspect.text !== 'string' || inspect.text.length === 0))
        diagnostics.push({
          code: 'OXE3401',
          message: 'Search text must be a non-empty string.',
          path: '$.operation.inspect.text',
        });
      if (
        (kind === 'search' || kind === 'history' || kind === 'nodes') &&
        inspect.limit !== undefined &&
        (typeof inspect.limit !== 'number' ||
          !Number.isSafeInteger(inspect.limit) ||
          inspect.limit < 1 ||
          inspect.limit > 100)
      )
        diagnostics.push({
          code: 'OXE3401',
          message: 'Inspection limit must be an integer from 1 through 100.',
          path: '$.operation.inspect.limit',
        });
      if (kind === 'nodes' && inspect.kinds !== undefined) {
        if (
          !Array.isArray(inspect.kinds) ||
          inspect.kinds.length === 0 ||
          inspect.kinds.some((candidate) => typeof candidate !== 'string' || candidate.length === 0)
        )
          diagnostics.push({
            code: 'OXE3401',
            message: 'Inspection kinds must be a non-empty array of non-empty strings.',
            path: '$.operation.inspect.kinds',
          });
        else if (new Set(inspect.kinds).size !== inspect.kinds.length)
          diagnostics.push({
            code: 'OXE3401',
            message: 'Inspection kinds must not contain duplicates.',
            path: '$.operation.inspect.kinds',
          });
      }
      if (kind === 'diff')
        for (const key of ['fromRevision', 'toRevision'] as const) {
          const revision = inspect[key];
          if (
            (key === 'fromRevision' || revision !== undefined) &&
            (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)
          )
            diagnostics.push({
              code: 'OXE3401',
              message: `${key} must be a nonnegative integer revision.`,
              path: `$.operation.inspect.${key}`,
            });
        }
      if (kind === 'diff' && operation.revision !== undefined)
        diagnostics.push({
          code: 'OXE3401',
          message: 'Diff inspection declares its revisions inside the selector.',
          path: '$.operation.revision',
        });
    }
  } else if (operation.kind === 'preview' || operation.kind === 'commit') {
    exactKeys(
      operation,
      operation.kind === 'preview' ? ['batch', 'kind'] : ['batch', 'kind', 'previewFingerprint'],
      '$.operation',
      diagnostics,
    );
    if (
      operation.kind === 'commit' &&
      operation.previewFingerprint !== undefined &&
      (typeof operation.previewFingerprint !== 'string' ||
        operation.previewFingerprint.length === 0)
    )
      diagnostics.push({
        code: 'OXE3401',
        message: 'Commit previewFingerprint must be a non-empty string.',
        path: '$.operation.previewFingerprint',
      });
    for (const diagnostic of validateApplicationMutationBatch(operation.batch))
      diagnostics.push({ code: 'OXE3401', message: diagnostic.message, path: diagnostic.path });
  } else if (operation.kind === 'revert') {
    exactKeys(operation, ['baseRevision', 'kind', 'targetRevision'], '$.operation', diagnostics);
    for (const key of ['baseRevision', 'targetRevision'] as const)
      if (
        typeof operation[key] !== 'number' ||
        !Number.isSafeInteger(operation[key]) ||
        operation[key] < 0
      )
        diagnostics.push({
          code: 'OXE3401',
          message: `${key} must be a nonnegative integer revision.`,
          path: `$.operation.${key}`,
        });
  } else
    diagnostics.push({
      code: 'OXE3401',
      message: 'Unknown agent operation kind.',
      path: '$.operation.kind',
    });
  return diagnostics;
};

const fingerprint = (graph: ApplicationGraphV1): string => {
  let hash = 0x811c9dc5;
  for (const character of serializeApplicationGraph(graph)) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return `oxe-application-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const failed = (
  appId: string,
  requestId: string,
  diagnostic: ApplicationAgentProtocolDiagnosticV1,
): ApplicationAgentResponseV1 => ({
  appId,
  diagnostics: [diagnostic],
  ok: false,
  requestId,
  schemaVersion: APPLICATION_AGENT_RESPONSE_SCHEMA,
});

/** Executes the strict agent protocol against caller-owned authoritative revision storage. */
export const executeApplicationAgentRequest = (
  adapter: ApplicationAgentProtocolAdapterV1,
  value: unknown,
): ApplicationAgentResponseV1 => {
  const diagnostics = validateApplicationAgentRequest(value);
  const record = isRecord(value) ? value : {};
  const appId = typeof record.appId === 'string' ? record.appId : '';
  const requestId = typeof record.requestId === 'string' ? record.requestId : '';
  if (diagnostics.length > 0)
    return {
      appId,
      diagnostics,
      ok: false,
      requestId,
      schemaVersion: APPLICATION_AGENT_RESPONSE_SCHEMA,
    };
  // Full boundary validation above makes this the one isolated protocol cast.
  const request = value as ApplicationAgentRequestV1;
  const current = adapter.current(request.appId);
  if (!current)
    return failed(request.appId, request.requestId, {
      code: 'OXE3402',
      message: `Application "${request.appId}" is not initialized.`,
      path: '$.appId',
    });
  const operation = request.operation;
  if (operation.kind === 'inspect') {
    if (operation.inspect.kind === 'diff') {
      const from =
        adapter.load?.(request.appId, operation.inspect.fromRevision) ??
        (operation.inspect.fromRevision === current.revision ? current : undefined);
      const toRevision = operation.inspect.toRevision ?? current.revision;
      const to =
        adapter.load?.(request.appId, toRevision) ??
        (toRevision === current.revision ? current : undefined);
      if (!from || !to)
        return failed(request.appId, request.requestId, {
          code: 'OXE3402',
          message: `Application diff r${operation.inspect.fromRevision}..r${toRevision} cannot be loaded.`,
          path: '$.operation.inspect',
        });
      return {
        appId: request.appId,
        ok: true,
        requestId: request.requestId,
        result: {
          fromRevision: from.revision,
          impact: analyzeApplicationGraphImpact(from, to),
          kind: 'inspect.diff',
          toRevision: to.revision,
        },
        revision: current.revision,
        schemaVersion: APPLICATION_AGENT_RESPONSE_SCHEMA,
      };
    }
    const graph =
      operation.revision === undefined
        ? current
        : (adapter.load?.(request.appId, operation.revision) ??
          (operation.revision === current.revision ? current : undefined));
    if (!graph)
      return failed(request.appId, request.requestId, {
        code: 'OXE3402',
        message: `Application revision r${operation.revision} does not exist.`,
        path: '$.operation.revision',
      });
    const inspect = operation.inspect;
    let result: ApplicationAgentResultV1;
    if (inspect.kind === 'map') {
      const projection = projectCompactApplicationGraph(graph);
      result = {
        kind: 'inspect.map',
        projection,
        size: measureCompactApplicationProjection(projection),
      };
    } else if (inspect.kind === 'history') {
      const history = adapter.history?.(request.appId) ?? [];
      result = {
        kind: 'inspect.history',
        revisions: history.slice(-(inspect.limit ?? 20)).reverse(),
      };
    } else {
      const indexed = indexApplicationGraph(graph);
      if (inspect.kind === 'incoming')
        result = {
          kind: 'inspect.incoming',
          references: indexed.references.filter(
            (reference) => reference.targetId === inspect.semanticId,
          ),
          semanticId: inspect.semanticId,
        };
      else if (inspect.kind === 'node') {
        const node = indexed.nodes.find((candidate) => candidate.id === inspect.semanticId);
        if (!node)
          return failed(request.appId, request.requestId, {
            code: 'OXE3402',
            message: `Semantic node "${inspect.semanticId}" does not exist in r${graph.revision}.`,
            path: '$.operation.inspect.semanticId',
          });
        result = {
          incoming: indexed.references.filter((reference) => reference.targetId === node.id),
          kind: 'inspect.node',
          node,
          outgoing: indexed.references.filter((reference) => reference.sourceId === node.id),
        };
      } else if (inspect.kind === 'nodes') {
        const kinds = inspect.kinds ? new Set(inspect.kinds) : undefined;
        result = {
          kind: 'inspect.nodes',
          nodes: indexed.nodes
            .filter((node) => !kinds || kinds.has(node.kind))
            .slice(0, inspect.limit ?? 100)
            .map((node) => ({
              id: node.id,
              incoming: indexed.references.filter((reference) => reference.targetId === node.id)
                .length,
              kind: node.kind,
              outgoing: indexed.references.filter((reference) => reference.sourceId === node.id)
                .length,
              path: node.path,
            })),
        };
      } else {
        const query = inspect.text.toLowerCase();
        result = {
          kind: 'inspect.search',
          matches: indexed.nodes
            .filter((node) =>
              `${node.id}\n${node.kind}\n${node.bodyJson}`.toLowerCase().includes(query),
            )
            .slice(0, inspect.limit ?? 20),
          text: inspect.text,
        };
      }
    }
    return {
      appId: request.appId,
      ok: true,
      requestId: request.requestId,
      result,
      revision: graph.revision,
      schemaVersion: APPLICATION_AGENT_RESPONSE_SCHEMA,
    };
  }

  if (operation.kind === 'revert') {
    const commit = adapter.undo?.(request.appId, operation.baseRevision, operation.targetRevision);
    if (!commit)
      return failed(request.appId, request.requestId, {
        code: 'OXE3402',
        message: 'Revision revert is not supported by this application store.',
        path: '$.operation',
      });
    if (!commit.ok)
      return failed(request.appId, request.requestId, {
        code: 'OXE3403',
        message: commit.diagnostics[0]?.message ?? 'Revision revert failed.',
        path: commit.diagnostics[0]?.path ?? '$.operation',
      });
    let publication: ApplicationAgentArtifactPublicationV1 | undefined;
    try {
      publication = adapter.publishArtifacts?.(current, commit.graph);
    } catch (error) {
      return failed(request.appId, request.requestId, {
        code: 'OXE3404',
        message: `Revision reverted but artifact publication failed: ${error instanceof Error ? error.message : String(error)}`,
        path: '$.operation',
      });
    }
    return {
      appId: request.appId,
      ok: true,
      requestId: request.requestId,
      result: {
        ...(publication ? { publication } : {}),
        changes: commit.changes,
        ...(commit.contentHash === undefined ? {} : { contentHash: commit.contentHash }),
        kind: 'revert',
        ...(commit.parentRevision === undefined ? {} : { parentRevision: commit.parentRevision }),
        restoredRevision: operation.targetRevision,
        summary: commit.summary,
      },
      revision: commit.revision,
      schemaVersion: APPLICATION_AGENT_RESPONSE_SCHEMA,
    };
  }

  const preview = previewApplicationMutation(current, operation.batch);
  if (operation.kind === 'preview') {
    const artifactPlan = preview.ok
      ? adapter.planArtifacts?.(current, preview.result.graph)
      : undefined;
    return {
      appId: request.appId,
      ok: true,
      requestId: request.requestId,
      result: {
        ...(artifactPlan ? { artifactPlan } : {}),
        kind: 'preview',
        ...(preview.ok ? { previewFingerprint: fingerprint(preview.result.graph) } : {}),
        preview,
      },
      revision: current.revision,
      schemaVersion: APPLICATION_AGENT_RESPONSE_SCHEMA,
    };
  }
  if (!preview.ok)
    return failed(request.appId, request.requestId, {
      code: 'OXE3403',
      message: preview.result.diagnostics[0]?.message ?? 'Mutation preview failed.',
      path: preview.result.diagnostics[0]?.path ?? '$.operation.batch',
    });
  const expectedFingerprint = fingerprint(preview.result.graph);
  if (
    operation.previewFingerprint !== undefined &&
    operation.previewFingerprint !== expectedFingerprint
  )
    return failed(request.appId, request.requestId, {
      code: 'OXE3403',
      message: 'Commit does not match the reviewed preview.',
      path: '$.operation.previewFingerprint',
    });
  const commit = adapter.commit(request.appId, operation.batch);
  if (!commit.ok)
    return failed(request.appId, request.requestId, {
      code: 'OXE3403',
      message: commit.diagnostics[0]?.message ?? 'Mutation commit failed.',
      path: commit.diagnostics[0]?.path ?? '$.operation.batch',
    });
  let publication: ApplicationAgentArtifactPublicationV1 | undefined;
  try {
    publication = adapter.publishArtifacts?.(current, commit.graph);
  } catch (error) {
    return failed(request.appId, request.requestId, {
      code: 'OXE3404',
      message: `Revision committed but artifact publication failed: ${error instanceof Error ? error.message : String(error)}`,
      path: '$.operation',
    });
  }
  return {
    appId: request.appId,
    ok: true,
    requestId: request.requestId,
    result: {
      ...(publication ? { publication } : {}),
      changes: commit.changes,
      ...(commit.contentHash === undefined ? {} : { contentHash: commit.contentHash }),
      kind: 'commit',
      ...(commit.parentRevision === undefined ? {} : { parentRevision: commit.parentRevision }),
      summary: commit.summary,
    },
    revision: commit.revision,
    schemaVersion: APPLICATION_AGENT_RESPONSE_SCHEMA,
  };
};
