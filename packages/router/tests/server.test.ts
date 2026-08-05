import { analyzeProject } from '@oxe/compiler';
import { OxeAsyncFailure, resolveLocalizationContext } from '@oxe/runtime';
import { createDeferredServerRenderPlan, createServerRenderPlan } from '@oxe/runtime-server';
import {
  createServerFunctionRegistry,
  serializeServerFunctionRequest,
  type ServerFunctionImplementation,
} from '@oxe/server-functions';
import { describe, expect, it } from 'vitest';

import { createFileRouteManifest, matchRoute } from '../src/index.js';
import {
  composeRouteServerPlan,
  createFetchRouteHandler,
  createNodeHandler,
  renderRouteToString,
  renderRouteToStringWithHydrationState,
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
  it('adapts streamed Fetch responses and request bodies to Node HTTP', async () => {
    const nodeHandler = createNodeHandler(async (request) => {
      const body = await request.text();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(`received:${body}:`));
          controller.enqueue(encoder.encode('streamed'));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { 'content-type': 'text/plain; charset=utf-8', 'x-oxe-test': 'node' },
        status: 201,
      });
    });
    const server = createServer((request, response) => {
      void nodeHandler(request, response);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected a TCP address.');
      const response = await fetch(`http://127.0.0.1:${address.port}/test`, {
        body: 'request-body',
        method: 'POST',
      });
      expect(response.status).toBe(201);
      expect(response.headers.get('x-oxe-test')).toBe('node');
      await expect(response.text()).resolves.toBe('received:request-body:streamed');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('turns route matching, streamed SSR, hydration state, and server functions into Fetch', async () => {
    const source = `export server readProject(id: string):
  project = database.read(id)
  project

export Page():
  project = readProject("p1")
  <main>
    <h1>{project.name}
`;
    const analyzed = await analyzeProject({
      capabilities: [
        {
          kind: 'async',
          name: 'database.read',
          parameters: ['string'],
          parameterSchemas: [{ kind: 'string' }],
          returns: 'record',
          returnSchema: {
            fields: [
              { name: 'id', schema: { kind: 'string' } },
              { name: 'name', schema: { kind: 'string' } },
            ],
            kind: 'record',
          },
          target: 'server',
        },
      ],
      entryExport: 'Page',
      entryModuleId: 'src/routes/page.oxe',
      loadModule: async () => source,
      routeSegment: 'page',
      target: 'server',
    });
    if (!analyzed.graph) throw new Error(JSON.stringify(analyzed.diagnostics));
    const definition = analyzed.graph.serverFunctions?.[0];
    if (!definition) throw new Error('Expected the compiler-owned server definition.');
    const calls: string[] = [];
    const implementation: ServerFunctionImplementation<{ readonly actor: string }> = {
      definition,
      invoke(arguments_, context) {
        const id = String(arguments_[0]);
        calls.push(`${context.actor}:${id}`);
        return { id, name: 'Compiler graph' };
      },
    };
    const registry = createServerFunctionRegistry([implementation]);
    const manifest = createFileRouteManifest(['src/routes/page.oxe']);
    const handler = createFetchRouteHandler({
      loadPlan: async () => createDeferredServerRenderPlan(analyzed.graph!),
      manifest,
      serverFunctions: {
        createContext: (request) => ({ actor: request.headers.get('x-actor') ?? 'anonymous' }),
        registry,
      },
    });

    const response = await handler(
      new Request('https://example.test/', { headers: { 'x-actor': 'Ada' } }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const html = await response.text();
    expect(html).toContain('Compiler graph');
    expect(html).toContain('data-oxe-route-snapshot');
    expect(html).toContain('data-oxe-state');
    expect(calls).toEqual(['Ada:p1']);

    const payload = serializeServerFunctionRequest(definition, ['p2']);
    const functionResponse = await handler(
      new Request('https://example.test/__oxe/functions', {
        body: payload,
        headers: {
          'content-type': 'application/json',
          'x-actor': 'Grace',
          'x-oxe-server-function': '1',
        },
        method: 'POST',
      }),
    );
    expect(functionResponse.status).toBe(200);
    await expect(functionResponse.json()).resolves.toMatchObject({ ok: true });
    expect(calls).toEqual(['Ada:p1', 'Grace:p2']);

    await expect(handler(new Request('https://example.test/missing'))).resolves.toMatchObject({
      status: 404,
    });
    await expect(
      handler(new Request('https://example.test/', { method: 'DELETE' })),
    ).resolves.toMatchObject({ status: 405 });
  });

  it('settles root status gates before creating the Fetch response', async () => {
    const source = `export server readProject(id: string):
  project = database.read(id)
  project

export Page():
  project = readProject("missing")
  project.visible ? <main>{project.name} : <p>Hidden
`;
    const analyzed = await analyzeProject({
      capabilities: [
        {
          kind: 'async',
          name: 'database.read',
          parameters: ['string'],
          returns: 'record',
          returnSchema: {
            fields: [
              { name: 'name', schema: { kind: 'string' } },
              { name: 'visible', schema: { kind: 'boolean' } },
            ],
            kind: 'record',
          },
          target: 'server',
        },
      ],
      entryExport: 'Page',
      entryModuleId: 'src/routes/page.oxe',
      loadModule: async () => source,
      routeSegment: 'page',
      target: 'server',
    });
    if (!analyzed.graph) throw new Error(JSON.stringify(analyzed.diagnostics));
    const definition = analyzed.graph.serverFunctions?.[0];
    if (!definition) throw new Error('Expected the compiler-owned server definition.');
    const implementation: ServerFunctionImplementation<Record<never, never>> = {
      definition,
      invoke() {
        throw new OxeAsyncFailure('not-found', 'Private database detail.', { status: 404 });
      },
    };
    const registry = createServerFunctionRegistry([implementation]);
    const handler = createFetchRouteHandler({
      loadPlan: async () => createDeferredServerRenderPlan(analyzed.graph!),
      manifest: createFileRouteManifest(['src/routes/page.oxe']),
      serverFunctions: { createContext: () => ({}), registry },
    });

    const response = await handler(new Request('https://example.test/'));
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe('Not found');
  });

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
        context: resolveLocalizationContext({ locale: 'fr', timeZone: 'UTC' }),
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
    const hydratable = renderRouteToStringWithHydrationState(plan, match, {
      i18n: {
        context: resolveLocalizationContext({ locale: 'fr', timeZone: 'UTC' }),
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
    expect(hydratable).toContain(html);
    expect(hydratable).toContain('"schemaVersion":"oxe.hydration-state.v1"');
    expect(hydratable).toContain('"locale":"fr"');
  });
});
import { createServer } from 'node:http';
