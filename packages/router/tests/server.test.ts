import { analyzeProject } from '@oxe/compiler';
import { createServerRenderPlan } from '@oxe/runtime-server';
import { describe, expect, it } from 'vitest';

import { createFileRouteManifest, matchRoute } from '../src/index.js';
import {
  composeRouteServerPlan,
  renderRouteToString,
  serializeRouteSnapshotScript,
} from '../src/server.js';
import type { RouteSegmentDefinitionV1 } from '../src/types.js';

const files: Readonly<Record<string, string>> = {
  'src/routes/layout.oxe': `export Layout():
  location = useLocation()

  <main>
    <header>Path: {location.pathname}
    {children}
`,
  'src/routes/projects/[projectId]/page.oxe': `export Page():
  params = useParams()
  search = useSearchParams()

  <article>
    <h1>Project {params.projectId}
    <p>Tab: {search.tab}
`,
};

const compileSegment = async (segment: RouteSegmentDefinitionV1) => {
  const analyzed = await analyzeProject({
    entryExport: segment.exportName,
    entryModuleId: segment.moduleId,
    loadModule: async (moduleId) => files[moduleId],
    routeSegment: segment.kind,
    target: 'server',
  });
  if (!analyzed.graph) {
    throw new Error(`Expected a server graph: ${JSON.stringify(analyzed.diagnostics)}`);
  }
  return createServerRenderPlan(analyzed.graph);
};

describe('route server rendering', () => {
  it('composes independently compiled layouts and pages around the server URL', async () => {
    const manifest = createFileRouteManifest(Object.keys(files));
    const match = matchRoute(manifest, '/projects/alpha?tab=activity');
    if (!match) throw new Error('Expected the project route to match.');

    const plan = await composeRouteServerPlan(match, compileSegment);
    const html = renderRouteToString(plan, match);

    expect(plan.entry.componentId).toBe('src/routes/layout.oxe#component/Layout');
    expect(html).toBe(
      '<main><header>Path: /projects/alpha</header><article><h1>Project alpha</h1><p>Tab: activity</p></article></main>',
    );
    expect(serializeRouteSnapshotScript(match)).toContain(
      'data-oxe-route-snapshot>{"href":"/projects/alpha?tab=activity"',
    );
  });

  it('requires every persistent server layout to render children exactly once', async () => {
    const brokenFiles = {
      ...files,
      'src/routes/layout.oxe': `export Layout():
  <main>No outlet
`,
    };
    const manifest = createFileRouteManifest(Object.keys(brokenFiles));
    const match = matchRoute(manifest, '/projects/alpha');
    if (!match) throw new Error('Expected the project route to match.');

    await expect(
      composeRouteServerPlan(match, async (segment) => {
        const analyzed = await analyzeProject({
          entryExport: segment.exportName,
          entryModuleId: segment.moduleId,
          loadModule: async (moduleId) => brokenFiles[moduleId as keyof typeof brokenFiles],
          routeSegment: segment.kind,
          target: 'server',
        });
        if (!analyzed.graph) throw new Error(JSON.stringify(analyzed.diagnostics));
        return createServerRenderPlan(analyzed.graph);
      }),
    ).rejects.toMatchObject({ code: 'OXE_ROUTE_INVALID_SERVER_PLAN' });
  });

  it('preserves request-local localization while resolving route inputs', async () => {
    const localizedFiles: Readonly<Record<string, string>> = {
      'src/routes/layout.oxe': `export Layout():
  <main>
    <header i18n={{ key: "navigation.title" }}>Projects
    {children}
`,
      'src/routes/projects/[projectId]/page.oxe': `export Page():
  params = useParams()

  <h1 i18n={{ key: "project.title" }}>Project {params.projectId}
`,
    };
    const manifest = createFileRouteManifest(Object.keys(localizedFiles));
    const match = matchRoute(manifest, '/projects/alpha');
    if (!match) throw new Error('Expected the localized project route to match.');

    const plan = await composeRouteServerPlan(match, async (segment) => {
      const analyzed = await analyzeProject({
        entryExport: segment.exportName,
        entryModuleId: segment.moduleId,
        loadModule: async (moduleId) => localizedFiles[moduleId],
        localization: true,
        routeSegment: segment.kind,
        target: 'server',
      });
      if (!analyzed.graph) throw new Error(JSON.stringify(analyzed.diagnostics));
      return createServerRenderPlan(analyzed.graph);
    });
    const html = renderRouteToString(plan, match, {
      i18n: {
        format(id, options): string {
          if (id === 'navigation.title') return 'Projets';
          return `Projet ${String(options?.values?.projectId)}`;
        },
        formatToParts(): readonly string[] {
          return [];
        },
        formatValue(value): string {
          return String(value);
        },
        machineValue(value): string {
          return String(value);
        },
      },
    });

    expect(html).toBe('<main><header>Projets</header><h1>Projet alpha</h1></main>');
  });
});
