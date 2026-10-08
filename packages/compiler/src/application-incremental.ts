import {
  analyzeApplicationGraphImpact,
  indexApplicationGraph,
  type ApplicationGraphImpactV1,
  type ApplicationGraphV1,
} from '@oxe/graph';

import { projectApplicationBrowserView } from './application-view.js';

export type ApplicationArtifactKindV1 =
  | 'browser-extension'
  | 'browser-client'
  | 'browser-runtime'
  | 'browser-shell'
  | 'browser-view'
  | 'database'
  | 'graph'
  | 'manifest'
  | 'route'
  | 'server-functions'
  | 'server-entry'
  | 'server-extension'
  | 'style'
  | 'worker'
  | 'verification';

export interface ApplicationInvalidatedArtifactV1 {
  readonly id: string;
  readonly kind: ApplicationArtifactKindV1;
  readonly semanticIds: readonly string[];
}

export interface ApplicationArtifactInvalidationPlanV1 {
  readonly artifacts: readonly ApplicationInvalidatedArtifactV1[];
  readonly impact: ApplicationGraphImpactV1;
  readonly rebuildAll: false;
  readonly schemaVersion: 'oxe.application-artifact-invalidation.v1';
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const DATABASE_KINDS = new Set(['entity', 'field', 'relation', 'unique']);
const FUNCTION_KINDS = new Set([
  'capability',
  'context',
  'entity',
  'field',
  'operation',
  'policy',
  'query',
  'relation',
]);
const VIEW_KINDS = new Set(['component', 'componentExtension', 'repeat', 'view']);
const VERIFICATION_KINDS = new Set(['invariant', 'verificationFlow']);

/** Maps semantic impact closure to the minimum deterministic generated-artifact set. */
export const planApplicationArtifactInvalidation = (
  before: ApplicationGraphV1,
  after: ApplicationGraphV1,
): ApplicationArtifactInvalidationPlanV1 => {
  const impact = analyzeApplicationGraphImpact(before, after);
  const indexed = [...indexApplicationGraph(before).nodes, ...indexApplicationGraph(after).nodes];
  const nodeById = new Map(indexed.map((node) => [node.id, node]));
  const clientModulesBySemanticId = new Map<string, Set<string>>();
  for (const graph of [before, after])
    for (const route of graph.routes)
      for (const definition of projectApplicationBrowserView(graph, route.id).functions) {
        const modules = clientModulesBySemanticId.get(definition.semanticId) ?? new Set<string>();
        modules.add(definition.clientModule);
        clientModulesBySemanticId.set(definition.semanticId, modules);
      }
  const artifacts = new Map<
    string,
    { readonly kind: ApplicationArtifactKindV1; readonly semanticIds: Set<string> }
  >();
  const add = (id: string, kind: ApplicationArtifactKindV1, semanticId: string): void => {
    const artifact = artifacts.get(id) ?? { kind, semanticIds: new Set<string>() };
    artifact.semanticIds.add(semanticId);
    artifacts.set(id, artifact);
  };
  if (impact.changes.length > 0) {
    const semanticId = impact.changes[0]?.id ?? after.app.id;
    add('browser/index.html', 'browser-shell', semanticId);
    for (const view of [...before.views, ...after.views])
      add(`browser/views/${view.id}.js`, 'browser-view', semanticId);
  }
  for (const node of impact.impacted) {
    add('application/manifest.json', 'manifest', node.id);
    add('application/graph.json', 'graph', node.id);
    add('server/start.js', 'server-entry', node.id);
    if (node.kind === 'app' && node.reason !== 'dependent') {
      add('database/schema.sql', 'database', node.id);
      add('database/migration.js', 'database', node.id);
      add('server/functions.js', 'server-functions', node.id);
      add('browser/client-manifest.js', 'browser-client', node.id);
      add('verification/contract.json', 'verification', node.id);
      for (const route of [...before.routes, ...after.routes])
        add(`routes/${route.id}.js`, 'route', node.id);
      for (const view of [...before.views, ...after.views])
        add(`browser/views/${view.id}.js`, 'browser-view', node.id);
      add('browser/index.html', 'browser-shell', node.id);
    }
    if (DATABASE_KINDS.has(node.kind)) {
      add('database/migration.js', 'database', node.id);
      add('database/schema.sql', 'database', node.id);
    }
    if (FUNCTION_KINDS.has(node.kind)) {
      add('server/functions.js', 'server-functions', node.id);
      add('browser/client-manifest.js', 'browser-client', node.id);
      add('browser/application-client-loader.js', 'browser-client', node.id);
      for (const moduleName of clientModulesBySemanticId.get(node.id) ?? [])
        add(`browser/clients/${moduleName}.js`, 'browser-client', node.id);
    }
    if (node.kind === 'extensionModule') {
      add('server/extensions.js', 'server-extension', node.id);
      add('browser/extensions.js', 'browser-extension', node.id);
      add('browser/application.css', 'style', node.id);
      for (const graph of [before, after]) {
        const module = graph.modules?.find(({ id }) => id === node.id);
        if (!module) continue;
        if (module.target !== 'server')
          add(
            `browser/extensions/${module.id}.${module.format === 'css' ? 'css' : 'js'}`,
            module.format === 'css' ? 'style' : 'browser-extension',
            node.id,
          );
        if (module.target !== 'browser')
          add(`server/extensions/${module.id}.js`, 'server-extension', node.id);
      }
    }
    if (node.kind === 'componentExtension')
      add('browser/extensions.js', 'browser-extension', node.id);
    if (node.kind === 'style') add('browser/application.css', 'style', node.id);
    if (node.kind === 'route') add(`routes/${node.id}.js`, 'route', node.id);
    if (VIEW_KINDS.has(node.kind)) {
      const path = nodeById.get(node.id)?.path;
      const viewIndex = path ? /^\$\.views\[(\d+)\]/u.exec(path)?.[1] : undefined;
      const viewId =
        node.kind === 'view'
          ? node.id
          : viewIndex === undefined
            ? 'unknown'
            : ((after.views[Number(viewIndex)] ?? before.views[Number(viewIndex)])?.id ??
              'unknown');
      add(`browser/views/${viewId}.js`, 'browser-view', node.id);
      add('browser/index.html', 'browser-shell', node.id);
    }
    if (VERIFICATION_KINDS.has(node.kind))
      add('verification/contract.json', 'verification', node.id);
  }
  return Object.freeze({
    artifacts: Object.freeze(
      [...artifacts]
        .sort(([left], [right]) => compareText(left, right))
        .map(([id, artifact]) => ({
          id,
          kind: artifact.kind,
          semanticIds: Object.freeze([...artifact.semanticIds].sort(compareText)),
        })),
    ),
    impact,
    rebuildAll: false,
    schemaVersion: 'oxe.application-artifact-invalidation.v1',
  });
};
