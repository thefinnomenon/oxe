import { readFileSync } from 'node:fs';

import { loadApplicationGraph, type ApplicationGraphV1 } from '@oxe/graph';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  createApplicationClientManifest,
  generateApplicationBrowserHostRuntime,
  generateApplicationBrowserClient,
  lowerApplicationRouteToUiGraph,
  projectApplicationBrowserView,
  projectApplicationLoading,
} from '../src/index.js';

const fixtureUrl = new URL('../../../examples/application-graph-todo/graph.json', import.meta.url);
const todoGraph = (): ApplicationGraphV1 =>
  loadApplicationGraph(JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown);

interface GeneratedClientModuleV1 {
  bootstrapApplicationClient(options: {
    readonly contextEndpoint?: string;
    readonly fetch: typeof fetch;
    readonly now: () => number;
    readonly requestedContexts?: readonly {
      readonly contextId: string;
      readonly recordId: string;
    }[];
  }): Promise<GeneratedApplicationClientV1>;
  createApplicationClient(options: {
    readonly context: {
      readonly activeContexts: readonly {
        readonly contextId: string;
        readonly entityId: string;
        readonly recordId: string;
      }[];
      readonly schemaVersion: 'oxe.application-client-context.v1';
      readonly userId: string;
    };
    readonly fetch: typeof fetch;
    readonly now: () => number;
  }): GeneratedApplicationClientV1;
}

interface GeneratedApplicationClientV1 {
  clearCache(): void;
  createTask(title: string): Promise<unknown>;
  inspectCache(): {
    readonly entries: number;
    readonly hits: number;
    readonly misses: number;
    readonly pending: number;
  };
  myTasks(options?: { readonly maxAgeMs?: number; readonly refresh?: boolean }): Promise<unknown>;
}

const loadGeneratedClient = async (source: string): Promise<GeneratedClientModuleV1> => {
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const imported: unknown = await import(
    `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
  );
  if (
    typeof imported !== 'object' ||
    imported === null ||
    !('createApplicationClient' in imported) ||
    typeof imported.createApplicationClient !== 'function'
  )
    throw new TypeError('Generated application client module has no factory.');
  return imported as GeneratedClientModuleV1;
};

describe('application browser client projection', () => {
  it('emits stable semantic handles and an opt-in privacy-safe development bridge', () => {
    const source = generateApplicationBrowserHostRuntime();

    expect(source).toContain("schemaVersion: 'oxe.application-development-interaction.v1'");
    expect(source).toContain('data-oxe-semantic-id');
    expect(source).toContain('node.dataset.oxeOperationId = invocation.operation');
    expect(source).toContain('route: location.pathname');
    expect(source).not.toContain('location.search');
    expect(source).not.toContain('FormData(form).entries');
  });

  it('derives deterministic typed functions and semantic cache invalidation', () => {
    const graph = todoGraph();
    const definitions = lowerApplicationRouteToUiGraph(graph).graph.serverFunctions ?? [];
    const manifest = createApplicationClientManifest(graph, definitions);
    const reordered = createApplicationClientManifest(graph, [...definitions].reverse());

    expect(reordered).toEqual(manifest);
    expect(manifest.cache).toEqual({
      defaultMaxAgeMs: 30_000,
      scope: 'user-and-active-context',
      strategy: 'memory',
    });
    expect(manifest.functions).toHaveLength(11);
    expect(manifest.functions.find((definition) => definition.name === 'myTasks')).toMatchObject({
      cacheMaxAgeMs: 30_000,
      invalidates: [],
      mode: 'query',
      reads: [
        'context.team',
        'entity.task',
        'field.task.createdAt',
        'field.task.done',
        'field.task.id',
        'field.task.title',
        'relation.taskTeam',
      ],
      semanticId: 'query.myTasks',
    });
    for (const name of ['createTask', 'deleteTask', 'renameTask', 'toggleTask'])
      expect(manifest.functions.find((definition) => definition.name === name)).toMatchObject({
        invalidates: ['query.myTasks'],
        mode: 'mutation',
      });
    for (const name of ['acceptTeamInvitation', 'inviteTeamMember', 'revokeTeamInvitation'])
      expect(manifest.functions.find((definition) => definition.name === name)).toMatchObject({
        invalidates: ['query.myTeamInvitations', 'query.teamInvitations'],
        mode: 'mutation',
      });

    const projection = generateApplicationBrowserClient(graph, definitions);
    expect(projection.moduleSource).toContain('export interface ApplicationClientV1');
    expect(projection.moduleSource).toContain('readonly "renameTask"');
    expect(projection.moduleSource).toContain('bootstrapApplicationClient');
    expect(projection.moduleSource).toContain('ApplicationClientContextV1');
    expect(projection.moduleSource).toContain('const cache = new Map');
    const runtime = projection.moduleSource.slice(projection.declarationSource.length);
    expect(runtime).not.toContain('"parameters"');
    expect(runtime).not.toContain('"path"');
    expect(runtime).not.toContain('"reads"');
    expect(runtime).not.toContain('oxe.application-client-manifest.v1');
  });

  it('projects a deterministic generic view host contract with split context clients', () => {
    const graph = todoGraph();
    const projection = projectApplicationBrowserView(graph);
    const reordered = projectApplicationBrowserView({
      ...graph,
      fields: [...graph.fields].reverse(),
      operations: [...graph.operations].reverse(),
      queries: [...graph.queries].reverse(),
    });

    expect(reordered).toEqual(projection);
    expect(projection.modes).toMatchObject({
      forbidden: { status: 403 },
      loading: { ariaBusy: true },
      unauthorized: { status: 401 },
    });
    expect(projection.functions.find((definition) => definition.name === 'myTasks')).toMatchObject({
      clientModule: 'team-client',
      contexts: ['context.team'],
      mode: 'query',
      refreshContexts: false,
    });
    expect(
      projection.functions.find((definition) => definition.name === 'inviteTeamMember'),
    ).toMatchObject({
      clientModule: 'ownedTeam-client',
      contexts: ['context.ownedTeam'],
      refreshContexts: true,
    });
    expect(
      projection.functions.find((definition) => definition.name === 'createTeam'),
    ).toMatchObject({
      clientModule: 'account-client',
      contexts: [],
      refreshContexts: true,
    });
  });

  it('projects one inert collection row from the successful view structure', () => {
    expect(projectApplicationLoading(todoGraph(), 'view.tasks')).toEqual({
      collections: [
        {
          elementId: 'element.myInvitationList',
          rows: 1,
          template: {
            children: [],
            component: 'ui.Button',
            kind: 'component',
          },
        },
        {
          elementId: 'element.teamInvitationList',
          rows: 1,
          template: {
            children: [],
            component: 'ui.Button',
            kind: 'component',
          },
        },
        {
          elementId: 'element.taskList',
          rows: 1,
          template: {
            children: [
              {
                children: [],
                component: 'ui.CheckboxRow',
                kind: 'component',
              },
              { children: [], component: 'ui.TextField', kind: 'component' },
              { children: [], component: 'ui.Button', kind: 'component' },
              { children: [], component: 'ui.Button', kind: 'component' },
            ],
            component: 'ui.Form',
            kind: 'component',
          },
        },
      ],
      schemaVersion: 'oxe.application-loading-projection.v1',
      strategy: 'preserveStaticStructure',
      viewId: 'view.tasks',
    });
  });

  it('applies graph-declared skeleton row and element overrides deterministically', () => {
    const graph = todoGraph();
    const hinted: ApplicationGraphV1 = {
      ...graph,
      views: graph.views.map((view) =>
        view.id === 'view.tasks'
          ? {
              ...view,
              modes: {
                ...view.modes,
                loading: {
                  kind: 'generated',
                  skeleton: {
                    elements: {
                      'element.taskEditor': { shape: 'block', width: 'full' },
                    },
                    rows: 3,
                  },
                  strategy: 'preserveStaticStructure',
                },
              },
            }
          : view,
      ),
    };

    const projection = projectApplicationLoading(hinted, 'view.tasks');
    expect(projection.collections.every((collection) => collection.rows === 3)).toBe(true);
    expect(
      projection.collections.find((collection) => collection.elementId === 'element.taskList')
        ?.template,
    ).toMatchObject({
      component: 'ui.Form',
      kind: 'component',
      shape: 'block',
      width: 'full',
    });
    expect(projectApplicationLoading(hinted, 'view.tasks')).toEqual(projection);
  });

  it('deduplicates and caches reads, then invalidates them after a semantic write', async () => {
    const graph = todoGraph();
    const definitions = lowerApplicationRouteToUiGraph(graph).graph.serverFunctions ?? [];
    const generated = await loadGeneratedClient(
      generateApplicationBrowserClient(graph, definitions).moduleSource,
    );
    const task = {
      createdAt: '2026-08-27T12:00:00.000Z',
      done: false,
      id: 'task-1',
      title: 'Cached task',
    };
    let requests = 0;
    const fetchStub: typeof fetch = async (_input, init) => {
      requests += 1;
      const request = JSON.parse(String(init?.body)) as {
        readonly functionId: string;
      };
      const value = request.functionId.endsWith('query.myTasks') ? [task] : task;
      return Response.json({
        functionId: request.functionId,
        ok: true,
        schemaVersion: 'oxe.server-function-response.v1',
        value,
      });
    };
    const client = generated.createApplicationClient({
      context: {
        activeContexts: [],
        schemaVersion: 'oxe.application-client-context.v1',
        userId: 'user-1',
      },
      fetch: fetchStub,
      now: () => 1_000,
    });

    await expect(Promise.all([client.myTasks(), client.myTasks()])).resolves.toEqual([
      [task],
      [task],
    ]);
    await expect(client.myTasks()).resolves.toEqual([task]);
    expect(requests).toBe(1);
    expect(client.inspectCache()).toEqual({ entries: 1, hits: 2, misses: 1, pending: 0 });

    await client.createTask('Another task');
    expect(client.inspectCache().entries).toBe(0);
    await client.myTasks();
    expect(requests).toBe(3);
  });

  it('honors graph-declared no-store policy while retaining sequential request validation', async () => {
    const graph = todoGraph();
    const noStore: ApplicationGraphV1 = {
      ...graph,
      queries: graph.queries.map((query) =>
        query.id === 'query.myTasks' ? { ...query, cache: { kind: 'no-store' } } : query,
      ),
    };
    const definitions = lowerApplicationRouteToUiGraph(noStore).graph.serverFunctions ?? [];
    const generated = await loadGeneratedClient(
      generateApplicationBrowserClient(noStore, definitions).moduleSource,
    );
    let requests = 0;
    const fetchStub: typeof fetch = async (_input, init) => {
      requests += 1;
      const request = JSON.parse(String(init?.body)) as { readonly functionId: string };
      return Response.json({
        functionId: request.functionId,
        ok: true,
        schemaVersion: 'oxe.server-function-response.v1',
        value: [],
      });
    };
    const client = generated.createApplicationClient({
      context: {
        activeContexts: [],
        schemaVersion: 'oxe.application-client-context.v1',
        userId: 'user-1',
      },
      fetch: fetchStub,
      now: () => 1_000,
    });

    await client.myTasks();
    await client.myTasks();
    expect(requests).toBe(2);
    expect(client.inspectCache()).toEqual({ entries: 0, hits: 0, misses: 2, pending: 0 });
  });

  it('does not reuse or cache an in-flight read invalidated by a mutation', async () => {
    const graph = todoGraph();
    const definitions = lowerApplicationRouteToUiGraph(graph).graph.serverFunctions ?? [];
    const generated = await loadGeneratedClient(
      generateApplicationBrowserClient(graph, definitions).moduleSource,
    );
    const resolvers: ((response: Response) => void)[] = [];
    let requests = 0;
    const task = {
      createdAt: '2026-08-27T12:00:00.000Z',
      done: false,
      id: 'task-1',
      title: 'Task',
    };
    const fetchStub: typeof fetch = async (_input, init) => {
      requests += 1;
      const request = JSON.parse(String(init?.body)) as { readonly functionId: string };
      if (!request.functionId.endsWith('query.myTasks'))
        return Response.json({
          functionId: request.functionId,
          ok: true,
          schemaVersion: 'oxe.server-function-response.v1',
          value: task,
        });
      return new Promise<Response>((resolve) => resolvers.push(resolve));
    };
    const client = generated.createApplicationClient({
      context: {
        activeContexts: [],
        schemaVersion: 'oxe.application-client-context.v1',
        userId: 'user-1',
      },
      fetch: fetchStub,
      now: () => 1_000,
    });

    const stale = client.myTasks();
    await client.createTask('Mutation');
    const fresh = client.myTasks();
    expect(requests).toBe(3);
    resolvers[0]?.(
      Response.json({
        functionId: 'app.todo/query.myTasks',
        ok: true,
        schemaVersion: 'oxe.server-function-response.v1',
        value: [],
      }),
    );
    resolvers[1]?.(
      Response.json({
        functionId: 'app.todo/query.myTasks',
        ok: true,
        schemaVersion: 'oxe.server-function-response.v1',
        value: [task],
      }),
    );
    await expect(stale).resolves.toEqual([]);
    await expect(fresh).resolves.toEqual([task]);
    await expect(client.myTasks()).resolves.toEqual([task]);
    expect(requests).toBe(3);
  });

  it('lets refresh supersede an older request and clear prevents in-flight repopulation', async () => {
    const graph = todoGraph();
    const definitions = lowerApplicationRouteToUiGraph(graph).graph.serverFunctions ?? [];
    const generated = await loadGeneratedClient(
      generateApplicationBrowserClient(graph, definitions).moduleSource,
    );
    const resolvers: ((response: Response) => void)[] = [];
    let requests = 0;
    const response = (title: string): Response =>
      Response.json({
        functionId: 'app.todo/query.myTasks',
        ok: true,
        schemaVersion: 'oxe.server-function-response.v1',
        value: [
          {
            createdAt: '2026-08-27T12:00:00.000Z',
            done: false,
            id: `task-${title}`,
            title,
          },
        ],
      });
    const client = generated.createApplicationClient({
      context: {
        activeContexts: [],
        schemaVersion: 'oxe.application-client-context.v1',
        userId: 'user-1',
      },
      fetch: () => {
        requests += 1;
        return new Promise<Response>((resolve) => resolvers.push(resolve));
      },
      now: () => 1_000,
    });

    const stale = client.myTasks();
    const refreshed = client.myTasks({ refresh: true });
    expect(requests).toBe(2);
    resolvers[1]?.(response('fresh'));
    await expect(refreshed).resolves.toEqual([expect.objectContaining({ title: 'fresh' })]);
    resolvers[0]?.(response('stale'));
    await stale;
    await expect(client.myTasks()).resolves.toEqual([expect.objectContaining({ title: 'fresh' })]);

    client.clearCache();
    const discarded = client.myTasks();
    client.clearCache();
    const afterClear = client.myTasks();
    expect(requests).toBe(4);
    resolvers[2]?.(response('discarded'));
    resolvers[3]?.(response('after-clear'));
    await discarded;
    await afterClear;
    await expect(client.myTasks()).resolves.toEqual([
      expect.objectContaining({ title: 'after-clear' }),
    ]);
    expect(requests).toBe(4);
  });

  it('bootstraps a verified context and propagates its ordered selection', async () => {
    const graph = todoGraph();
    const definitions = lowerApplicationRouteToUiGraph(graph).graph.serverFunctions ?? [];
    const generated = await loadGeneratedClient(
      generateApplicationBrowserClient(graph, definitions).moduleSource,
    );
    const requestedContexts = [
      { contextId: 'context.organization', recordId: 'org-1' },
      { contextId: 'context.project', recordId: 'project-1' },
    ];
    const resolvedContexts = [
      {
        contextId: 'context.organization',
        entityId: 'builtin.organization',
        recordId: 'org-1',
      },
      { contextId: 'context.project', entityId: 'entity.project', recordId: 'project-1' },
    ];
    const requests: { readonly contexts: string | null; readonly url: string }[] = [];
    const fetchStub: typeof fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      requests.push({ contexts: headers.get('x-oxe-active-contexts'), url });
      if (url === '/api/context')
        return Response.json({
          activeContexts: resolvedContexts,
          schemaVersion: 'oxe.application-client-context.v1',
          userId: 'user-1',
        });
      return Response.json({
        functionId: 'app.todo/query.myTasks',
        ok: true,
        schemaVersion: 'oxe.server-function-response.v1',
        value: [],
      });
    };
    const client = await generated.bootstrapApplicationClient({
      fetch: fetchStub,
      now: () => 1_000,
      requestedContexts,
    });
    await expect(client.myTasks()).resolves.toEqual([]);
    expect(requests).toEqual([
      { contexts: JSON.stringify(requestedContexts), url: '/api/context' },
      { contexts: JSON.stringify(requestedContexts), url: '/api/functions' },
    ]);
  });

  it('isolates cached reads across separately verified active contexts', async () => {
    const graph = todoGraph();
    const definitions = lowerApplicationRouteToUiGraph(graph).graph.serverFunctions ?? [];
    const generated = await loadGeneratedClient(
      generateApplicationBrowserClient(graph, definitions).moduleSource,
    );
    const rpcContexts: (string | null)[] = [];
    const fetchStub: typeof fetch = async (input, init) => {
      const contexts = new Headers(init?.headers).get('x-oxe-active-contexts');
      if (String(input) === '/api/context')
        return Response.json({
          activeContexts: contexts
            ? (
                JSON.parse(contexts) as { readonly contextId: string; readonly recordId: string }[]
              ).map((context) => ({ ...context, entityId: 'entity.project' }))
            : [],
          schemaVersion: 'oxe.application-client-context.v1',
          userId: 'user-1',
        });
      rpcContexts.push(contexts);
      const selected = contexts ? (JSON.parse(contexts) as { readonly recordId: string }[]) : [];
      return Response.json({
        functionId: 'app.todo/query.myTasks',
        ok: true,
        schemaVersion: 'oxe.server-function-response.v1',
        value: [
          {
            createdAt: '2026-08-28T12:00:00.000Z',
            done: false,
            id: `task-${selected[0]?.recordId ?? 'personal'}`,
            title: selected[0]?.recordId ?? 'Personal',
          },
        ],
      });
    };
    const projectA = [{ contextId: 'context.project', recordId: 'project-a' }];
    const projectB = [{ contextId: 'context.project', recordId: 'project-b' }];
    const clientA = await generated.bootstrapApplicationClient({
      fetch: fetchStub,
      now: () => 1_000,
      requestedContexts: projectA,
    });
    const clientB = await generated.bootstrapApplicationClient({
      fetch: fetchStub,
      now: () => 1_000,
      requestedContexts: projectB,
    });

    await expect(clientA.myTasks()).resolves.toEqual([
      expect.objectContaining({ id: 'task-project-a' }),
    ]);
    await expect(clientB.myTasks()).resolves.toEqual([
      expect.objectContaining({ id: 'task-project-b' }),
    ]);
    await clientA.myTasks();
    await clientB.myTasks();
    expect(rpcContexts).toEqual([JSON.stringify(projectA), JSON.stringify(projectB)]);
    expect(clientA.inspectCache()).toMatchObject({ entries: 1, hits: 1, misses: 1 });
    expect(clientB.inspectCache()).toMatchObject({ entries: 1, hits: 1, misses: 1 });
  });
});
