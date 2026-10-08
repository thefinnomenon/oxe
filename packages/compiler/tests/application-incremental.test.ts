import { readFileSync } from 'node:fs';

import { loadApplicationGraph, mutateApplicationGraph, type ApplicationGraphV1 } from '@oxe/graph';
import { describe, expect, it } from 'vitest';

import {
  ApplicationArtifactCache,
  generateApplicationBrowserClientFacet,
  generateApplicationBrowserClientRuntimeModule,
  generateApplicationPostgresServerEntry,
  generateApplicationPostgresWorkerEntry,
  lowerApplicationRouteToUiGraph,
  planApplicationArtifactInvalidation,
  projectApplicationBrowserView,
  renderApplicationBrowserViewLoadingHtml,
} from '../src/index.js';

const fixtureUrl = new URL('../../../examples/application-graph-todo/graph.json', import.meta.url);
const todoGraph = (): ApplicationGraphV1 =>
  loadApplicationGraph(JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown);

describe('incremental application projections', () => {
  it('emits one generic runtime and manifest-only typed client facets', () => {
    const graph = todoGraph();
    const definitions = lowerApplicationRouteToUiGraph(graph).graph.serverFunctions ?? [];
    const facet = generateApplicationBrowserClientFacet(graph, definitions.slice(0, 2));
    const runtime = generateApplicationBrowserClientRuntimeModule();

    expect(facet.moduleSource).toContain('from "./application-client-runtime.js"');
    expect(facet.moduleSource).not.toContain('const cache = new Map');
    expect(runtime).toContain('const cache = new Map');
    expect(runtime).toContain('createApplicationClientRuntime');
    expect(generateApplicationBrowserClientRuntimeModule()).toBe(runtime);
  });

  it('renders deterministic SSR loading structure with an explicit hydration identity', () => {
    const projection = projectApplicationBrowserView(todoGraph());
    const html = renderApplicationBrowserViewLoadingHtml(projection);

    expect(projection.hydrationKey).toBe('app.todo@r16:view.tasks');
    expect(html).toContain('data-oxe-browser-view="app.todo@r16:view.tasks"');
    expect(html).toContain('data-oxe-view-content');
    expect(html.match(/data-oxe-loading-collection=/gu)).toHaveLength(3);
    expect(renderApplicationBrowserViewLoadingHtml(projection)).toBe(html);
  });

  it('invalidates only artifacts reached by semantic impact closure', () => {
    const graph = todoGraph();
    const query = graph.queries.find((candidate) => candidate.id === 'query.myTasks');
    if (!query) throw new Error('Todo query is missing.');
    const result = mutateApplicationGraph(graph, {
      base: graph.revision,
      ops: [{ node: { ...query, cache: { kind: 'no-store' } }, op: 'semantic.replace' }],
    });
    if (!result.ok) throw new Error(result.diagnostics[0]?.message);

    const plan = planApplicationArtifactInvalidation(graph, result.graph);
    expect(plan.rebuildAll).toBe(false);
    expect(plan.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'application/manifest.json' }),
        expect.objectContaining({ id: 'browser/client-manifest.js' }),
        expect.objectContaining({ id: 'browser/views/view.tasks.js' }),
        expect.objectContaining({ id: 'server/functions.js' }),
      ]),
    );
    expect(plan.artifacts.some((artifact) => artifact.kind === 'database')).toBe(false);
    expect(plan.artifacts.some((artifact) => artifact.kind === 'browser-runtime')).toBe(false);
    expect(planApplicationArtifactInvalidation(graph, result.graph)).toEqual(plan);
  });

  it('builds real deterministic projections once and reuses a warm revision', () => {
    const graph = todoGraph();
    const cache = new ApplicationArtifactCache();
    const cold = cache.compile(graph);

    expect(cold.stats).toEqual({ built: 19, removed: 0, reused: 0 });
    expect(cold.artifacts.map((artifact) => artifact.id)).toEqual([
      'application/graph.json',
      'application/manifest.json',
      'browser/application-browser-host.js',
      'browser/application-client-loader.js',
      'browser/application-client-runtime.js',
      'browser/client-manifest.js',
      'browser/clients/account-client.js',
      'browser/clients/ownedTeam-client.js',
      'browser/clients/team-client.js',
      'browser/index.html',
      'browser/start.js',
      'browser/views/view.tasks.js',
      'database/migration.js',
      'database/schema.sql',
      'routes/route.tasks.js',
      'server/application.js',
      'server/functions.js',
      'server/start.js',
      'verification/contract.json',
    ]);
    expect(
      cold.artifacts.find((artifact) => artifact.id === 'database/schema.sql')?.contents,
    ).toContain('CREATE TABLE');
    expect(
      cold.artifacts.find((artifact) => artifact.id === 'browser/views/view.tasks.js')?.contents,
    ).not.toContain(' as const');
    const manifest = JSON.parse(
      cold.artifacts.find((artifact) => artifact.id === 'application/manifest.json')?.contents ??
        'null',
    ) as unknown;
    expect(manifest).toMatchObject({
      deployment: {
        runtimeEntry: 'server/application.js',
        serverEntry: 'server/start.js',
        workerDeployment: 'embedded',
      },
      runtimeRequirements: {
        authentication: { provider: 'betterAuth' },
        persistence: { engine: 'postgresql' },
        schemaVersion: 'oxe.application-runtime-requirements.v1',
      },
    });

    const warm = cache.compile(graph);
    expect(warm.stats).toEqual({ built: 0, removed: 0, reused: 19 });
    expect(warm.artifacts.map(({ fingerprint }) => fingerprint)).toEqual(
      cold.artifacts.map(({ fingerprint }) => fingerprint),
    );
    expect(cache.current('app.todo')).toMatchObject({ revision: 16, stats: { reused: 19 } });
  });

  it('rebuilds only the semantic impact closure and preserves unaffected fingerprints', () => {
    const graph = todoGraph();
    const query = graph.queries.find((candidate) => candidate.id === 'query.myTasks');
    if (!query) throw new Error('Todo query is missing.');
    const mutation = mutateApplicationGraph(graph, {
      base: graph.revision,
      ops: [{ node: { ...query, cache: { kind: 'no-store' } }, op: 'semantic.replace' }],
    });
    if (!mutation.ok) throw new Error(mutation.diagnostics[0]?.message);
    const cache = new ApplicationArtifactCache();
    const before = cache.compile(graph);
    const after = cache.compile(mutation.graph);

    expect(after.stats).toEqual({ built: 6, removed: 0, reused: 13 });
    expect(
      after.artifacts.filter((artifact) => artifact.status === 'built').map(({ id }) => id),
    ).toEqual([
      'application/graph.json',
      'application/manifest.json',
      'browser/client-manifest.js',
      'browser/clients/team-client.js',
      'browser/index.html',
      'browser/views/view.tasks.js',
    ]);
    for (const id of [
      'browser/application-client-runtime.js',
      'browser/application-browser-host.js',
      'browser/application-client-loader.js',
      'browser/clients/account-client.js',
      'browser/clients/ownedTeam-client.js',
      'browser/start.js',
      'database/migration.js',
      'database/schema.sql',
      'routes/route.tasks.js',
      'server/functions.js',
      'server/start.js',
      'verification/contract.json',
    ])
      expect(after.artifacts.find((artifact) => artifact.id === id)?.fingerprint).toBe(
        before.artifacts.find((artifact) => artifact.id === id)?.fingerprint,
      );
  });

  it('emits deterministic embedded or separately owned worker deployment entries', () => {
    const embedded = generateApplicationPostgresServerEntry('embedded');
    const separate = generateApplicationPostgresServerEntry('separate');
    const worker = generateApplicationPostgresWorkerEntry();

    expect(embedded).toContain('createPostgresApplicationServerRuntime');
    expect(embedded).toContain("workerDeployment = 'embedded'");
    expect(separate).toContain('createPostgresApplicationServerFunctions');
    expect(separate).not.toContain('createPostgresApplicationServerRuntime');
    expect(worker).toContain('createPostgresApplicationJobWorker');
    expect(worker).toContain("process.once('SIGTERM', close)");
    expect(generateApplicationPostgresServerEntry('embedded')).toBe(embedded);
    expect(generateApplicationPostgresWorkerEntry()).toBe(worker);

    const compilation = new ApplicationArtifactCache().compile(todoGraph(), {
      workerDeployment: 'separate',
    });
    expect(compilation.stats).toEqual({ built: 20, removed: 0, reused: 0 });
    expect(compilation.artifacts.map(({ id }) => id)).toContain('server/worker.js');
    expect(
      JSON.parse(
        compilation.artifacts.find(({ id }) => id === 'application/manifest.json')?.contents ??
          'null',
      ),
    ).toMatchObject({
      deployment: {
        runtimeEntry: 'server/application.js',
        serverEntry: 'server/start.js',
        workerDeployment: 'separate',
        workerEntry: 'server/worker.js',
      },
    });
  });

  it('projects target-owned extension modules, typed components, and theme styles', () => {
    const graph = todoGraph();
    const extensionGraph: ApplicationGraphV1 = {
      ...graph,
      capabilities: [
        ...(graph.capabilities ?? []),
        {
          adapter: { export: 'mailAdapter', module: 'module.mail' },
          contract: 'example.mail',
          id: 'capability.mail',
          kind: 'capability',
          methods: {
            send: {
              input: { fields: { subject: { kind: 'string' } }, kind: 'record' },
              output: { fields: { deliveryId: { kind: 'string' } }, kind: 'record' },
            },
          },
          name: 'Mail',
          version: '1',
        },
      ],
      components: [
        {
          children: 'none',
          id: 'component.sparkline',
          implementation: { export: 'sparkline', module: 'module.sparkline' },
          kind: 'componentExtension',
          name: 'Sparkline',
          props: { label: { kind: 'string' } },
          ssr: { tag: 'oxe-sparkline' },
        },
      ],
      modules: [
        {
          format: 'javascript',
          id: 'module.mail',
          integrity: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
          kind: 'extensionModule',
          name: 'Mail adapter',
          source: 'extensions/mail.js',
          target: 'server',
        },
        {
          format: 'javascript',
          id: 'module.sparkline',
          integrity: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
          kind: 'extensionModule',
          name: 'Sparkline',
          source: 'extensions/sparkline.js',
          target: 'browser',
        },
        {
          format: 'css',
          id: 'module.theme',
          integrity: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
          kind: 'extensionModule',
          name: 'Theme',
          source: 'styles/theme.css',
          target: 'browser',
        },
      ],
      styles: [
        {
          id: 'style.application',
          kind: 'style',
          name: 'Application theme',
          stylesheets: ['module.theme'],
          themes: { dark: { 'color-surface': '#111' } },
          tokens: { 'color-surface': '#fff' },
        },
      ],
      views: graph.views.map((view, index) =>
        index === 0 && view.tree.kind === 'component'
          ? {
              ...view,
              tree: {
                ...view.tree,
                children: [
                  ...(view.tree.children ?? []),
                  {
                    component: 'component.sparkline',
                    id: 'element.sparkline',
                    kind: 'component' as const,
                    props: { label: { kind: 'literal' as const, value: 'Weekly tasks' } },
                  },
                ],
              },
            }
          : view,
      ),
    };
    const compilation = new ApplicationArtifactCache().compile(extensionGraph, {
      extensions: {
        'module.mail': { server: 'export const mailAdapter = { invoke() { return {}; } };\n' },
        'module.sparkline': {
          browser: 'export const sparkline = { define() {} };\n',
        },
        'module.theme': { browser: 'oxe-sparkline { color: var(--color-surface); }\n' },
      },
    });

    expect(compilation.stats).toEqual({ built: 25, removed: 0, reused: 0 });
    expect(compilation.artifacts.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        'browser/application.css',
        'browser/extensions.js',
        'browser/extensions/module.sparkline.js',
        'browser/extensions/module.theme.css',
        'server/extensions.js',
        'server/extensions/module.mail.js',
      ]),
    );
    expect(
      compilation.artifacts.find(({ id }) => id === 'server/application.js')?.contents,
    ).toContain('applicationCapabilityAdapters');
    expect(
      compilation.artifacts.find(({ id }) => id === 'browser/application.css')?.contents,
    ).toContain('--color-surface: #fff');
    expect(
      compilation.artifacts.find(({ id }) => id === 'browser/extensions.js')?.contents,
    ).toContain('implementation.define');
    expect(lowerApplicationRouteToUiGraph(extensionGraph).graph.nodes).toContainEqual(
      expect.objectContaining({
        kind: 'element',
        tag: 'oxe-sparkline',
      }),
    );
    const extensionModules = extensionGraph.modules;
    if (!extensionModules) throw new Error('Extension graph has no modules.');
    const retargeted: ApplicationGraphV1 = {
      ...extensionGraph,
      modules: extensionModules.map((module) =>
        module.id === 'module.mail' ? { ...module, target: 'universal' as const } : module,
      ),
      revision: extensionGraph.revision + 1,
    };
    expect(planApplicationArtifactInvalidation(extensionGraph, retargeted).artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'browser/extensions/module.mail.js' }),
        expect.objectContaining({ id: 'server/extensions/module.mail.js' }),
      ]),
    );
  });

  it('removes stale route artifacts when a revision no longer projects them', () => {
    const graph = todoGraph();
    const withAlias: ApplicationGraphV1 = {
      ...graph,
      routes: [
        ...graph.routes,
        {
          authentication: 'required',
          id: 'route.alias',
          kind: 'route',
          path: '/alias',
          view: 'view.tasks',
        },
      ],
    };
    const withoutAlias: ApplicationGraphV1 = { ...graph, revision: graph.revision + 1 };
    const cache = new ApplicationArtifactCache();

    expect(
      cache.compile(withAlias).artifacts.some(({ id }) => id === 'routes/route.alias.js'),
    ).toBe(true);
    const next = cache.compile(withoutAlias);
    expect(next.stats.removed).toBe(1);
    expect(next.artifacts.some(({ id }) => id === 'routes/route.alias.js')).toBe(false);
  });
});
