import {
  projectApplicationRuntimeRequirements,
  serializeApplicationGraph,
  type ApplicationGraphV1,
  type UiServerFunctionDefinitionV1,
} from '@oxe/graph';

import {
  createApplicationClientManifest,
  generateApplicationBrowserClientFacetJavaScript,
  generateApplicationBrowserClientRuntimeJavaScriptModule,
} from './application-client.js';
import {
  generateApplicationBrowserHostRuntime,
  generateApplicationBrowserStart,
} from './application-browser.js';
import {
  projectApplicationExtensionArtifacts,
  type ApplicationCompiledExtensionModulesV1,
} from './application-extension.js';
import {
  planApplicationArtifactInvalidation,
  type ApplicationArtifactInvalidationPlanV1,
  type ApplicationArtifactKindV1,
} from './application-incremental.js';
import { lowerApplicationRouteToUiGraph } from './application-lower.js';
import {
  compileApplicationPostgresBootstrap,
  compileApplicationPostgresSchema,
  generateApplicationPostgresSchemaSql,
} from './application-postgres.js';
import {
  generateApplicationNodeHostEntry,
  generateApplicationPostgresServerEntry,
  generateApplicationPostgresWorkerEntry,
  type ApplicationWorkerDeploymentV1,
} from './application-server.js';
import {
  projectApplicationBrowserView,
  renderApplicationBrowserViewLoadingHtml,
} from './application-view.js';

export interface ApplicationCompiledArtifactV1 {
  readonly builtAtRevision: number;
  readonly bytes: number;
  readonly contents: string;
  readonly fingerprint: string;
  readonly id: string;
  readonly kind: ApplicationArtifactKindV1;
  readonly status: 'built' | 'reused';
}

export interface ApplicationArtifactBuildStatsV1 {
  readonly built: number;
  readonly removed: number;
  readonly reused: number;
}

export interface ApplicationArtifactCompilationV1 {
  readonly appId: string;
  readonly artifacts: readonly ApplicationCompiledArtifactV1[];
  readonly invalidation?: ApplicationArtifactInvalidationPlanV1;
  readonly revision: number;
  readonly schemaVersion: 'oxe.application-artifact-compilation.v1';
  readonly stats: ApplicationArtifactBuildStatsV1;
}

export interface ApplicationArtifactCompilationOptionsV1 {
  /** Integrity-verified, target-specific outputs supplied by the project build boundary. */
  readonly extensions?: ApplicationCompiledExtensionModulesV1;
  /** Defaults to one worker embedded with the generated application server runtime. */
  readonly workerDeployment?: ApplicationWorkerDeploymentV1;
}

interface StoredArtifact {
  readonly builtAtRevision: number;
  readonly bytes: number;
  readonly contents: string;
  readonly fingerprint: string;
  readonly id: string;
  readonly kind: ApplicationArtifactKindV1;
}

interface CacheEntry {
  readonly artifacts: ReadonlyMap<string, StoredArtifact>;
  readonly extensionFingerprint: string;
  readonly graph: ApplicationGraphV1;
  readonly workerDeployment: ApplicationWorkerDeploymentV1;
}

interface ArtifactSource {
  readonly contents: () => string;
  readonly id: string;
  readonly kind: ApplicationArtifactKindV1;
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const fingerprintText = (value: string): string => {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

const generatedModule = (name: string, value: unknown): string =>
  `/* Generated from the normalized OXE application graph. Do not edit. */\nexport const ${name} = Object.freeze(${JSON.stringify(value)});\n`;

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const fallbackBrowserShell = (graph: ApplicationGraphV1): string => {
  const projection = projectApplicationBrowserView(graph);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <title>${escapeHtml(graph.app.name)} · last-good preview</title>
    ${(graph.styles?.length ?? 0) > 0 ? '<link rel="stylesheet" href="./application.css">' : ''}
    <style>
      :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; --bg: #f5f6f3; --panel: #fff; --text: #181a17; --muted: #676d65; --border: #dce0d8; }
      @media (prefers-color-scheme: dark) { :root { --bg: #111411; --panel: #1a1e1a; --text: #eff2ed; --muted: #a5ada3; --border: #343b34; } }
      * { box-sizing: border-box; } body { margin: 0; min-width: 320px; background: var(--bg); color: var(--text); }
      main { width: min(100% - 2rem, 44rem); margin: 0 auto; padding: clamp(1.5rem, 6vw, 4rem) 0; }
      .notice { margin-bottom: 1rem; color: var(--muted); font-size: .875rem; }
      .card { display: grid; gap: 1rem; padding: clamp(1rem, 4vw, 2rem); border: 1px solid var(--border); border-radius: 1rem; background: var(--panel); }
      [data-oxe-view-content] { display: grid; gap: .65rem; }
      .task { min-height: 3rem; padding: .7rem .8rem; overflow: hidden; border: 1px solid var(--border); border-radius: .65rem; }
      .skeleton-component { display: flex; align-items: center; gap: .75rem; width: 100%; }
      .skeleton-form { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; }
      .skeleton-box, .skeleton-line, .skeleton-button, .skeleton-block { display: block; border-radius: .4rem; background: color-mix(in srgb, var(--muted) 18%, var(--panel)); }
      .skeleton-box { width: 1.15rem; height: 1.15rem; } .skeleton-line { width: min(15rem, 55vw); height: 2.3rem; }
      .skeleton-line-wide { width: min(9rem, 30vw); height: .8rem; } .skeleton-button { width: 3.5rem; height: 2.25rem; }
      .skeleton-block { width: 100%; height: 2.5rem; } .skeleton-width-short { width: 28%; } .skeleton-width-medium { width: 58%; } .skeleton-width-full { width: 100%; }
      @media (max-width: 34rem) { .skeleton-form { grid-template-columns: auto minmax(0, 1fr); } }
      @media (prefers-reduced-motion: no-preference) { .skeleton-box, .skeleton-line, .skeleton-button, .skeleton-block { animation: pulse 1.4s ease-in-out infinite alternate; } }
      @keyframes pulse { to { opacity: .45; } }
    </style>
  </head>
  <body>
    <main>
      <p class="notice" id="status" role="status">Last-good generated preview · r${graph.revision}</p>
      <div id="app" aria-busy="true">${renderApplicationBrowserViewLoadingHtml(projection)}</div>
    </main>
    <script type="module" src="./start.js"></script>
  </body>
</html>\n`;
};

const serverFunctionDefinitions = (
  graph: ApplicationGraphV1,
): readonly UiServerFunctionDefinitionV1[] => {
  const definitions = new Map<string, UiServerFunctionDefinitionV1>();
  for (const route of [...graph.routes].sort((left, right) => compareText(left.id, right.id))) {
    const projection = lowerApplicationRouteToUiGraph(graph, { routeId: route.id });
    for (const definition of projection.graph.serverFunctions ?? [])
      definitions.set(definition.id, definition);
  }
  return Object.freeze(
    [...definitions.values()].sort((left, right) => compareText(left.id, right.id)),
  );
};

const browserClientSources = (
  graph: ApplicationGraphV1,
  definitions: readonly UiServerFunctionDefinitionV1[],
): readonly ArtifactSource[] => {
  const semanticIdsByModule = new Map<string, Set<string>>();
  for (const route of [...graph.routes].sort((left, right) => compareText(left.id, right.id)))
    for (const definition of projectApplicationBrowserView(graph, route.id).functions) {
      const semanticIds = semanticIdsByModule.get(definition.clientModule) ?? new Set<string>();
      semanticIds.add(definition.semanticId);
      semanticIdsByModule.set(definition.clientModule, semanticIds);
    }
  const modules = [...semanticIdsByModule]
    .sort(([left], [right]) => compareText(left, right))
    .map(([moduleName, semanticIds]) => ({
      moduleName,
      source: generateApplicationBrowserClientFacetJavaScript(
        graph,
        definitions.filter(({ id }) => semanticIds.has(id.slice(`${graph.app.id}/`.length))),
        '../application-client-runtime.js',
      ),
    }));
  const loader = `${generatedModule(
    'applicationClientModuleNames',
    modules.map(({ moduleName }) => moduleName),
  )}
export const bootstrapApplicationClientModule = async (moduleName, options = {}) => {
  switch (moduleName) {
${modules
  .map(
    ({ moduleName }) =>
      `    case ${JSON.stringify(moduleName)}: return (await import(${JSON.stringify(`./clients/${moduleName}.js`)})).bootstrapApplicationClient(options);`,
  )
  .join('\n')}
    default: throw new TypeError('Unknown generated application client module "' + moduleName + '".');
  }
};
`;
  return [
    {
      contents: () => loader,
      id: 'browser/application-client-loader.js',
      kind: 'browser-client',
    },
    ...modules.map(({ moduleName, source }): ArtifactSource => ({
      contents: () => source,
      id: `browser/clients/${moduleName}.js`,
      kind: 'browser-client',
    })),
  ];
};

const artifactSources = (
  graph: ApplicationGraphV1,
  workerDeployment: ApplicationWorkerDeploymentV1,
  extensions: ApplicationCompiledExtensionModulesV1,
): readonly ArtifactSource[] => {
  let definitions: readonly UiServerFunctionDefinitionV1[] | undefined;
  const getDefinitions = (): readonly UiServerFunctionDefinitionV1[] =>
    (definitions ??= serverFunctionDefinitions(graph));
  const routes = [...graph.routes].sort((left, right) => compareText(left.id, right.id));
  const hasGeneratedCapabilityAdapters = (graph.capabilities ?? []).some(
    (capability) => capability.adapter !== undefined,
  );
  const viewRoute = new Map<string, string>();
  for (const route of routes) if (!viewRoute.has(route.view)) viewRoute.set(route.view, route.id);
  const sources: ArtifactSource[] = [
    {
      contents: () => serializeApplicationGraph(graph),
      id: 'application/graph.json',
      kind: 'graph',
    },
    {
      contents: () => fallbackBrowserShell(graph),
      id: 'browser/index.html',
      kind: 'browser-shell',
    },
    {
      contents: generateApplicationBrowserHostRuntime,
      id: 'browser/application-browser-host.js',
      kind: 'browser-runtime',
    },
    {
      contents: generateApplicationBrowserClientRuntimeJavaScriptModule,
      id: 'browser/application-client-runtime.js',
      kind: 'browser-runtime',
    },
    ...browserClientSources(graph, getDefinitions()),
    {
      contents: () => generateApplicationBrowserStart(graph),
      id: 'browser/start.js',
      kind: 'browser-shell',
    },
    {
      contents: () =>
        generatedModule(
          'applicationClientManifest',
          createApplicationClientManifest(graph, getDefinitions()),
        ),
      id: 'browser/client-manifest.js',
      kind: 'browser-client',
    },
    ...[...viewRoute]
      .sort(([left], [right]) => compareText(left, right))
      .map(([viewId, routeId]): ArtifactSource => ({
        contents: () =>
          generatedModule('applicationView', projectApplicationBrowserView(graph, routeId)),
        id: `browser/views/${viewId}.js`,
        kind: 'browser-view',
      })),
    {
      contents: () => generateApplicationPostgresSchemaSql(compileApplicationPostgresSchema(graph)),
      id: 'database/schema.sql',
      kind: 'database',
    },
    {
      contents: () =>
        generatedModule('applicationPostgresMigration', compileApplicationPostgresBootstrap(graph)),
      id: 'database/migration.js',
      kind: 'database',
    },
    ...routes.map((route): ArtifactSource => ({
      contents: () => generatedModule('applicationRoute', route),
      id: `routes/${route.id}.js`,
      kind: 'route',
    })),
    {
      contents: () => generatedModule('applicationServerFunctionDefinitions', getDefinitions()),
      id: 'server/functions.js',
      kind: 'server-functions',
    },
    {
      contents: () =>
        generateApplicationPostgresServerEntry(workerDeployment, hasGeneratedCapabilityAdapters),
      id: 'server/application.js',
      kind: 'server-entry',
    },
    {
      contents: () => generateApplicationNodeHostEntry(graph),
      id: 'server/start.js',
      kind: 'server-entry',
    },
    ...(workerDeployment === 'separate'
      ? [
          {
            contents: () => generateApplicationPostgresWorkerEntry(hasGeneratedCapabilityAdapters),
            id: 'server/worker.js',
            kind: 'worker' as const,
          },
        ]
      : []),
    {
      contents: () => `${JSON.stringify(graph.verification)}\n`,
      id: 'verification/contract.json',
      kind: 'verification',
    },
    ...projectApplicationExtensionArtifacts(graph, extensions).map((artifact): ArtifactSource => ({
      contents: () => artifact.contents,
      id: artifact.id,
      kind: artifact.kind,
    })),
  ];
  return sources.sort((left, right) => compareText(left.id, right.id));
};

const buildArtifact = (source: ArtifactSource, revision: number): StoredArtifact => {
  const contents = source.contents();
  return Object.freeze({
    builtAtRevision: revision,
    bytes: byteLength(contents),
    contents,
    fingerprint: fingerprintText(contents),
    id: source.id,
    kind: source.kind,
  });
};

const manifestArtifact = (
  graph: ApplicationGraphV1,
  artifacts: readonly StoredArtifact[],
  workerDeployment: ApplicationWorkerDeploymentV1,
): StoredArtifact => {
  const contents = `${JSON.stringify({
    appId: graph.app.id,
    artifacts: artifacts.map(({ bytes, fingerprint, id, kind }) => ({
      bytes,
      fingerprint,
      id,
      kind,
    })),
    revision: graph.revision,
    deployment: {
      runtimeEntry: 'server/application.js',
      serverEntry: 'server/start.js',
      workerDeployment,
      ...(workerDeployment === 'separate' ? { workerEntry: 'server/worker.js' } : {}),
    },
    runtimeRequirements: projectApplicationRuntimeRequirements(graph),
    schemaVersion: 'oxe.application-artifact-manifest.v1',
  })}\n`;
  return Object.freeze({
    builtAtRevision: graph.revision,
    bytes: byteLength(contents),
    contents,
    fingerprint: fingerprintText(contents),
    id: 'application/manifest.json',
    kind: 'manifest',
  });
};

/** In-memory cache for deterministic compiler projections; the application graph remains authoritative. */
export class ApplicationArtifactCache {
  readonly #entries = new Map<string, CacheEntry>();

  public compile(
    graph: ApplicationGraphV1,
    options: ApplicationArtifactCompilationOptionsV1 = {},
  ): ApplicationArtifactCompilationV1 {
    const workerDeployment = options.workerDeployment ?? 'embedded';
    const extensions = options.extensions ?? {};
    const extensionFingerprint = fingerprintText(
      JSON.stringify(
        Object.entries(extensions)
          .sort(([left], [right]) => compareText(left, right))
          .map(([id, targets]) => [id, targets.browser ?? null, targets.server ?? null]),
      ),
    );
    const previous = this.#entries.get(graph.app.id);
    const sameGraph = previous
      ? previous.workerDeployment === workerDeployment &&
        previous.extensionFingerprint === extensionFingerprint &&
        serializeApplicationGraph(previous.graph) === serializeApplicationGraph(graph)
      : false;
    if (sameGraph) {
      const current = this.current(graph.app.id);
      if (current) return current;
    }
    const invalidation = previous
      ? planApplicationArtifactInvalidation(previous.graph, graph)
      : undefined;
    const invalidated = new Set(invalidation?.artifacts.map((artifact) => artifact.id) ?? []);
    const sources = artifactSources(graph, workerDeployment, extensions);
    const desiredIds = new Set([
      ...sources.map((source) => source.id),
      'application/manifest.json',
    ]);
    const artifacts = new Map<string, StoredArtifact>();
    const status = new Map<string, 'built' | 'reused'>();
    for (const source of sources) {
      const cached = previous?.artifacts.get(source.id);
      const compareGeneratedClient =
        source.id === 'browser/application-client-loader.js' ||
        source.id.startsWith('browser/clients/') ||
        source.id === 'browser/start.js';
      if (cached && !invalidated.has(source.id) && !compareGeneratedClient) {
        artifacts.set(source.id, cached);
        status.set(source.id, 'reused');
      } else {
        const built = buildArtifact(source, graph.revision);
        if (
          cached &&
          cached.fingerprint === built.fingerprint &&
          cached.contents === built.contents
        ) {
          artifacts.set(source.id, cached);
          status.set(source.id, 'reused');
        } else {
          artifacts.set(source.id, built);
          status.set(source.id, 'built');
        }
      }
    }
    const orderedWithoutManifest = [...artifacts.values()].sort((left, right) =>
      compareText(left.id, right.id),
    );
    const cachedManifest = previous?.artifacts.get('application/manifest.json');
    if (cachedManifest && !invalidated.has('application/manifest.json') && sameGraph) {
      artifacts.set(cachedManifest.id, cachedManifest);
      status.set(cachedManifest.id, 'reused');
    } else {
      const manifest = manifestArtifact(graph, orderedWithoutManifest, workerDeployment);
      artifacts.set(manifest.id, manifest);
      status.set(manifest.id, 'built');
    }
    const removed = previous
      ? [...previous.artifacts.keys()].filter((id) => !desiredIds.has(id)).length
      : 0;
    this.#entries.set(graph.app.id, {
      artifacts,
      extensionFingerprint,
      graph,
      workerDeployment,
    });
    const published = [...artifacts.values()]
      .sort((left, right) => compareText(left.id, right.id))
      .map((artifact): ApplicationCompiledArtifactV1 => ({
        ...artifact,
        status: status.get(artifact.id) ?? 'built',
      }));
    const built = published.filter((artifact) => artifact.status === 'built').length;
    return Object.freeze({
      appId: graph.app.id,
      artifacts: Object.freeze(published),
      ...(invalidation ? { invalidation } : {}),
      revision: graph.revision,
      schemaVersion: 'oxe.application-artifact-compilation.v1',
      stats: Object.freeze({ built, removed, reused: published.length - built }),
    });
  }

  public current(appId: string): ApplicationArtifactCompilationV1 | undefined {
    const entry = this.#entries.get(appId);
    if (!entry) return undefined;
    const artifacts = [...entry.artifacts.values()]
      .sort((left, right) => compareText(left.id, right.id))
      .map((artifact): ApplicationCompiledArtifactV1 => ({ ...artifact, status: 'reused' }));
    return Object.freeze({
      appId,
      artifacts: Object.freeze(artifacts),
      revision: entry.graph.revision,
      schemaVersion: 'oxe.application-artifact-compilation.v1',
      stats: Object.freeze({ built: 0, removed: 0, reused: artifacts.length }),
    });
  }
}
