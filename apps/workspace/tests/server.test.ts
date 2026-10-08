import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  APPLICATION_AGENT_REQUEST_SCHEMA,
  APPLICATION_DEVELOPMENT_INTERACTION_SCHEMA,
  loadApplicationGraph,
  type ApplicationAgentRequestV1,
  type ApplicationAgentResponseV1,
  type ApplicationGraphV1,
  type ApplicationMutationBatchV1,
} from '@oxe/graph';
import type { ApplicationPublicationAdapterV1 } from '@oxe/compiler';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createCloudflareAccessMutationAuthorizer,
  createWorkspaceRuntime,
  type WorkspaceRuntime,
} from '../src/server.js';
import {
  WORKSPACE_MODEL_RESPONSE_SCHEMA,
  type WorkspaceAgentModelV1,
  type WorkspaceModelRequestV1,
} from '../src/agent.js';
import type { WorkspaceRuntimeOperationsV1 } from '../src/operations.js';
import { WorkspaceApplicationTarget } from '../src/application-target.js';

const fixtureUrl = new URL('../../../examples/application-graph-todo/graph.json', import.meta.url);
const todoGraph = (): ApplicationGraphV1 =>
  loadApplicationGraph(JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown);

const directories: string[] = [];
const runtimes: WorkspaceRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  for (const directory of directories.splice(0))
    rmSync(directory, { force: true, recursive: true });
});

const setup = (databasePath?: string): WorkspaceRuntime => {
  let resolvedPath = databasePath;
  if (!resolvedPath) {
    const directory = mkdtempSync(join(tmpdir(), 'oxe-workspace-'));
    directories.push(directory);
    resolvedPath = join(directory, 'workspace.sqlite');
  }
  const runtime = createWorkspaceRuntime({
    applicationUrl: 'http://127.0.0.1:39999',
    databasePath: resolvedPath,
    graph: todoGraph(),
  });
  runtimes.push(runtime);
  return runtime;
};

const protocolRequest = async (
  runtime: WorkspaceRuntime,
  operation: ApplicationAgentRequestV1['operation'],
): Promise<ApplicationAgentResponseV1> => {
  const response = await runtime.handler(
    new Request('http://127.0.0.1:4175/api/agent', {
      body: JSON.stringify({
        appId: runtime.appId,
        operation,
        requestId: 'workspace-test',
        schemaVersion: APPLICATION_AGENT_REQUEST_SCHEMA,
      }),
      headers: {
        'content-type': 'application/json',
        origin: 'http://127.0.0.1:4175',
        'x-oxe-workspace-request': '1',
      },
      method: 'POST',
    }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as ApplicationAgentResponseV1;
};

const priorityBatch = (base: number): ApplicationMutationBatchV1 => ({
  base,
  ops: [
    {
      as: 'priority',
      default: 'normal',
      entity: 'entity.task',
      name: 'priority',
      op: 'field.add',
      type: { enum: ['low', 'normal', 'high'] },
    },
    { field: '$priority', form: 'element.createTaskForm', op: 'form.field.add' },
    { field: '$priority', list: 'element.taskList', op: 'list.display.add' },
  ],
});

describe('OXE development workspace server', () => {
  it('serves configuration and the semantic agent protocol from one local boundary', async () => {
    const runtime = setup();
    const config = await runtime.handler(new Request('http://127.0.0.1:4175/api/config'));
    await expect(config.json()).resolves.toEqual({
      agentRequestSchema: APPLICATION_AGENT_REQUEST_SCHEMA,
      appId: 'app.todo',
      agentAvailable: false,
      artifactRevision: 16,
      operationsAvailable: false,
      applicationUrl: '/__app',
      publication: {
        activeRevision: 16,
        schemaVersion: 'oxe.application-publication-state.v1',
        status: 'active',
      },
      revision: 16,
    });

    const status = await runtime.handler(
      new Request('http://127.0.0.1:4175/api/application-status'),
    );
    await expect(status.json()).resolves.toEqual({
      artifactRevision: 16,
      publication: {
        activeRevision: 16,
        schemaVersion: 'oxe.application-publication-state.v1',
        status: 'active',
      },
      reachable: true,
      source: 'last-good',
      url: '/api/artifacts/browser/index.html',
    });
    const fallback = await runtime.handler(
      new Request('http://127.0.0.1:4175/api/artifacts/browser/index.html'),
    );
    expect(fallback.status).toBe(200);
    expect(fallback.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(fallback.headers.get('x-oxe-graph-revision')).toBe('16');
    await expect(fallback.text()).resolves.toContain('Last-good generated preview · r16');

    const nodes = await protocolRequest(runtime, {
      inspect: { kind: 'nodes', kinds: ['entity'] },
      kind: 'inspect',
    });
    expect(nodes).toMatchObject({
      ok: true,
      result: {
        kind: 'inspect.nodes',
        nodes: [
          { id: 'builtin.user', kind: 'entity' },
          { id: 'entity.task', kind: 'entity' },
          { id: 'entity.team', kind: 'entity' },
          { id: 'entity.teamMembership', kind: 'entity' },
        ],
      },
    });
  });

  it('mounts the private application transport on the same development origin', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'oxe-workspace-development-app-'));
    directories.push(directory);
    let upstreamRequest: Request | undefined;
    const runtime = createWorkspaceRuntime({
      applicationFetch: (request) => {
        upstreamRequest = request instanceof Request ? request : new Request(request);
        return Promise.resolve(Response.json({ path: new URL(upstreamRequest.url).pathname }));
      },
      applicationUrl: 'http://127.0.0.1:3000',
      databasePath: join(directory, 'workspace.sqlite'),
      graph: todoGraph(),
    });
    runtimes.push(runtime);

    const config = await runtime.handler(new Request('http://127.0.0.1:4175/api/config'));
    await expect(config.json()).resolves.toMatchObject({
      applicationUrl: '/__app',
    });
    const status = await runtime.handler(
      new Request('https://oxe-dev.finnternet.com/api/application-status'),
    );
    await expect(status.json()).resolves.toMatchObject({
      reachable: true,
      status: 200,
      url: '/__app',
    });
    const application = await runtime.handler(
      new Request('https://oxe-dev.finnternet.com/__app/sign-in?next=%2F', {
        headers: {
          'cf-access-authenticated-user-email': 'chris@finnternet.com',
          'cf-access-jwt-assertion': 'private-assertion',
          cookie: 'session=available',
        },
      }),
    );
    await expect(application.json()).resolves.toEqual({ path: '/sign-in' });
    expect(upstreamRequest?.url).toBe('http://127.0.0.1:3000/sign-in?next=%2F');
    expect(upstreamRequest?.headers.get('cookie')).toBe('session=available');
    expect(upstreamRequest?.headers.has('cf-access-authenticated-user-email')).toBe(false);
    expect(upstreamRequest?.headers.has('cf-access-jwt-assertion')).toBe(false);
    expect(runtime.applicationUrl).toBe('http://127.0.0.1:3000');
    expect(runtime.applicationPath).toBe('/__app');
  });

  it('previews, fingerprint-commits, diffs, and reopens an advanced revision', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'oxe-workspace-reopen-'));
    directories.push(directory);
    const databasePath = join(directory, 'workspace.sqlite');
    const runtime = setup(databasePath);
    const batch = priorityBatch(16);
    const preview = await protocolRequest(runtime, { batch, kind: 'preview' });
    if (!preview.ok || preview.result.kind !== 'preview' || !preview.result.previewFingerprint)
      throw new Error('Expected a successful workspace preview.');
    const commit = await protocolRequest(runtime, {
      batch,
      kind: 'commit',
      previewFingerprint: preview.result.previewFingerprint,
    });
    expect(commit).toMatchObject({ ok: true, revision: 17 });
    const diff = await protocolRequest(runtime, {
      inspect: { fromRevision: 16, kind: 'diff', toRevision: 17 },
      kind: 'inspect',
    });
    expect(diff).toMatchObject({
      ok: true,
      result: { fromRevision: 16, kind: 'inspect.diff', toRevision: 17 },
    });
    await runtime.close();
    runtimes.splice(runtimes.indexOf(runtime), 1);

    const reopened = setup(databasePath);
    const config = await reopened.handler(new Request('http://127.0.0.1:4175/api/config'));
    await expect(config.json()).resolves.toMatchObject({ revision: 17 });
  });

  it('rejects stale reviewed commits and returns precise protocol diagnostics', async () => {
    const runtime = setup();
    const batch = priorityBatch(16);
    const preview = await protocolRequest(runtime, { batch, kind: 'preview' });
    if (!preview.ok || preview.result.kind !== 'preview' || !preview.result.previewFingerprint)
      throw new Error('Expected a successful workspace preview.');
    const reviewed = preview.result.previewFingerprint;
    await protocolRequest(runtime, { batch, kind: 'commit', previewFingerprint: reviewed });

    const stale = await protocolRequest(runtime, {
      batch,
      kind: 'commit',
      previewFingerprint: reviewed,
    });
    expect(stale).toMatchObject({
      diagnostics: [
        {
          code: 'OXE3403',
          message: 'Mutation base r16 does not match current revision r17.',
          path: '$.base',
        },
      ],
      ok: false,
    });

    const malformed = await runtime.handler(
      new Request('http://127.0.0.1:4175/api/agent', {
        body: JSON.stringify({
          appId: runtime.appId,
          operation: { baseRevision: -1, kind: 'revert', targetRevision: 'sixteen' },
          requestId: 'malformed',
          schemaVersion: APPLICATION_AGENT_REQUEST_SCHEMA,
        }),
        headers: {
          'content-type': 'application/json',
          'x-oxe-workspace-request': '1',
        },
        method: 'POST',
      }),
    );
    await expect(malformed.json()).resolves.toMatchObject({
      diagnostics: [
        { code: 'OXE3401', path: '$.operation.baseRevision' },
        { code: 'OXE3401', path: '$.operation.targetRevision' },
      ],
      ok: false,
    });
  });

  it('routes health checks and application traffic through a newly activated target', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'oxe-workspace-target-'));
    directories.push(directory);
    const target = new WorkspaceApplicationTarget({
      id: 'configured',
      revision: 16,
      url: 'http://127.0.0.1:3000',
    });
    const requested: string[] = [];
    const runtime = createWorkspaceRuntime({
      applicationFetch: (request) => {
        const url = request instanceof Request ? request.url : String(request);
        requested.push(url);
        if (url.startsWith('http://127.0.0.1:3000')) throw new Error('offline');
        return Promise.resolve(Response.json({ target: new URL(url).origin }));
      },
      applicationTarget: target,
      databasePath: join(directory, 'workspace.sqlite'),
      graph: todoGraph(),
    });
    runtimes.push(runtime);

    const offline = await runtime.handler(
      new Request('http://127.0.0.1:4175/api/application-status'),
    );
    await expect(offline.json()).resolves.toMatchObject({ source: 'last-good' });
    target.activate({ id: 'candidate-r17', revision: 17, url: 'http://127.0.0.1:3001' });
    const online = await runtime.handler(
      new Request('http://127.0.0.1:4175/api/application-status'),
    );
    await expect(online.json()).resolves.toMatchObject({ reachable: true, source: 'configured' });
    const application = await runtime.handler(new Request('http://127.0.0.1:4175/__app/tasks'));
    await expect(application.json()).resolves.toEqual({ target: 'http://127.0.0.1:3001' });
    expect(requested.at(-1)).toBe('http://127.0.0.1:3001/tasks');
  });

  it('serves the last-good artifacts when candidate runtime activation fails', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'oxe-workspace-publication-'));
    directories.push(directory);
    let disposed = false;
    const publicationAdapter: ApplicationPublicationAdapterV1 = {
      prepare: () => ({
        activate: () => {
          throw new Error('candidate health check failed');
        },
        dispose: () => {
          disposed = true;
        },
      }),
    };
    const runtime = createWorkspaceRuntime({
      applicationUrl: 'http://127.0.0.1:39999',
      databasePath: join(directory, 'workspace.sqlite'),
      graph: todoGraph(),
      publicationAdapter,
    });
    runtimes.push(runtime);
    const batch = priorityBatch(16);
    const preview = await protocolRequest(runtime, { batch, kind: 'preview' });
    if (!preview.ok || preview.result.kind !== 'preview' || !preview.result.previewFingerprint)
      throw new Error('Expected a successful publication preview.');

    const commit = await protocolRequest(runtime, {
      batch,
      kind: 'commit',
      previewFingerprint: preview.result.previewFingerprint,
    });
    expect(commit).toMatchObject({ diagnostics: [{ code: 'OXE3404' }], ok: false });
    expect(disposed).toBe(true);

    const config = await runtime.handler(new Request('http://127.0.0.1:4175/api/config'));
    await expect(config.json()).resolves.toMatchObject({
      artifactRevision: 16,
      publication: {
        activeRevision: 16,
        candidateRevision: 17,
        lastAttempt: { stage: 'activation', status: 'failed' },
        status: 'failed',
      },
      revision: 17,
    });
    const artifact = await runtime.handler(
      new Request('http://127.0.0.1:4175/api/artifacts/application/graph.json'),
    );
    expect(artifact.headers.get('x-oxe-graph-revision')).toBe('16');
    await expect(artifact.json()).resolves.toMatchObject({ revision: 16 });
  });

  it('retries a failed publication and restores an inspected revision through typed operations', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'oxe-workspace-retry-'));
    directories.push(directory);
    let activations = 0;
    const publicationAdapter: ApplicationPublicationAdapterV1 = {
      prepare: () => ({
        activate: () => {
          activations += 1;
          if (activations === 1) throw new Error('transient candidate failure');
        },
        dispose: () => undefined,
      }),
    };
    const runtime = createWorkspaceRuntime({
      databasePath: join(directory, 'workspace.sqlite'),
      graph: todoGraph(),
      publicationAdapter,
    });
    runtimes.push(runtime);
    const batch = priorityBatch(16);
    const preview = await protocolRequest(runtime, { batch, kind: 'preview' });
    if (!preview.ok || preview.result.kind !== 'preview' || !preview.result.previewFingerprint)
      throw new Error('Expected a successful publication preview.');
    const commit = await protocolRequest(runtime, {
      batch,
      kind: 'commit',
      previewFingerprint: preview.result.previewFingerprint,
    });
    expect(commit).toMatchObject({ diagnostics: [{ code: 'OXE3404' }], ok: false });

    const retry = await runtime.handler(
      new Request('http://127.0.0.1:4175/api/publication/retry', {
        headers: { 'x-oxe-workspace-request': '1' },
        method: 'POST',
      }),
    );
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({
      artifactRevision: 17,
      publication: { activeRevision: 17, status: 'active' },
    });

    const restored = await protocolRequest(runtime, {
      baseRevision: 17,
      kind: 'revert',
      targetRevision: 16,
    });
    expect(restored).toMatchObject({
      ok: true,
      result: { kind: 'revert', restoredRevision: 16 },
      revision: 18,
    });
    expect(runtime.session.publicationState()).toMatchObject({ activeRevision: 18 });
  });

  it('rejects cross-origin agent writes and oversized bodies', async () => {
    const runtime = setup();
    const crossOrigin = await runtime.handler(
      new Request('http://127.0.0.1:4175/api/agent', {
        body: '{}',
        headers: {
          'content-type': 'application/json',
          origin: 'https://malicious.example',
          'x-oxe-workspace-request': '1',
        },
        method: 'POST',
      }),
    );
    expect(crossOrigin.status).toBe(403);
    const oversized = await runtime.handler(
      new Request('http://127.0.0.1:4175/api/agent', {
        body: '{}',
        headers: {
          'content-length': '1048577',
          'content-type': 'application/json',
          'x-oxe-workspace-request': '1',
        },
        method: 'POST',
      }),
    );
    expect(oversized.status).toBe(413);
  });

  it('protects runtime telemetry and dead-letter replay behind the workspace boundary', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'oxe-workspace-operations-'));
    directories.push(directory);
    let replayed = '';
    const runtimeOperations: WorkspaceRuntimeOperationsV1 = {
      replayJob: (jobId) => {
        replayed = jobId;
        return Promise.resolve({
          attempts: 0,
          availableAt: '2026-08-30T12:00:00.000Z',
          capabilityId: 'capability.mail',
          createdAt: '2026-08-30T11:00:00.000Z',
          id: jobId,
          maxAttempts: 3,
          method: 'send',
          status: 'pending',
        });
      },
      snapshot: () =>
        Promise.resolve({
          appId: 'app.todo',
          capturedAt: '2026-08-30T12:00:00.000Z',
          deadLetterJobs: [],
          graphRevision: 16,
          schemaVersion: 'oxe.application-development-operations.v1',
          telemetry: { metrics: [], spans: [] },
          worker: {
            claimed: 2,
            completed: 1,
            failed: 1,
            pendingRetry: 0,
            runs: 3,
            state: 'running',
          },
        }),
    };
    const runtime = createWorkspaceRuntime({
      databasePath: join(directory, 'workspace.sqlite'),
      graph: todoGraph(),
      runtimeOperations,
    });
    runtimes.push(runtime);
    const denied = await runtime.handler(new Request('http://127.0.0.1:4175/api/operations'));
    expect(denied.status).toBe(403);
    const snapshot = await runtime.handler(
      new Request('http://127.0.0.1:4175/api/operations', {
        headers: { 'x-oxe-workspace-request': '1' },
      }),
    );
    expect(snapshot.status).toBe(200);
    await expect(snapshot.json()).resolves.toMatchObject({
      appId: 'app.todo',
      worker: { claimed: 2, state: 'running' },
    });
    const replay = await runtime.handler(
      new Request('http://127.0.0.1:4175/api/operations/replay', {
        body: JSON.stringify({ jobId: 'job-dead-1' }),
        headers: {
          'content-type': 'application/json',
          'x-oxe-workspace-request': '1',
        },
        method: 'POST',
      }),
    );
    expect(replay.status).toBe(200);
    expect(replayed).toBe('job-dead-1');
  });

  it('requires an explicit authorization boundary for remote origins', () => {
    const directory = mkdtempSync(join(tmpdir(), 'oxe-workspace-remote-'));
    directories.push(directory);
    expect(() =>
      createWorkspaceRuntime({
        allowedOrigins: ['https://dev.oxe.example'],
        databasePath: join(directory, 'workspace.sqlite'),
        graph: todoGraph(),
      }),
    ).toThrow('Remote workspace origins require an authorizeMutation boundary.');
    const authorize = createCloudflareAccessMutationAuthorizer(['finn@example.test']);
    expect(
      authorize(
        new Request('https://dev.oxe.example/api/agent', {
          headers: {
            'cf-access-authenticated-user-email': 'finn@example.test',
            'cf-access-jwt-assertion': 'assertion-present',
          },
        }),
      ),
    ).toBe(true);
    expect(
      authorize(
        new Request('https://dev.oxe.example/api/agent', {
          headers: { 'cf-access-authenticated-user-email': 'attacker@example.test' },
        }),
      ),
    ).toBe(false);
  });

  it('streams provider-neutral model chat without exposing commit as a model tool', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'oxe-workspace-chat-'));
    directories.push(directory);
    let modelRequest: WorkspaceModelRequestV1 | undefined;
    const agentModel: WorkspaceAgentModelV1 = {
      complete: (request) => {
        modelRequest = request;
        return Promise.resolve({
          kind: 'message',
          schemaVersion: WORKSPACE_MODEL_RESPONSE_SCHEMA,
          text: 'The graph is ready for a typed preview.',
        });
      },
    };
    const runtime = createWorkspaceRuntime({
      agentModel,
      databasePath: join(directory, 'workspace.sqlite'),
      graph: todoGraph(),
    });
    runtimes.push(runtime);
    const response = await runtime.handler(
      new Request('http://127.0.0.1:4175/api/chat', {
        body: JSON.stringify({
          interactions: [
            {
              at: 1_788_451_200_000,
              kind: 'click',
              route: '/tasks',
              schemaVersion: APPLICATION_DEVELOPMENT_INTERACTION_SCHEMA,
              sequence: 1,
              target: {
                control: 'button',
                elementId: 'element.createTaskForm',
                label: 'Add task',
                operationId: 'operation.createTask',
              },
            },
          ],
          messages: [{ role: 'user', text: 'That button does nothing.' }],
        }),
        headers: {
          'content-type': 'application/json',
          origin: 'http://127.0.0.1:4175',
          'x-oxe-workspace-request': '1',
        },
        method: 'POST',
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    await expect(response.text()).resolves.toContain('typed preview');
    expect(modelRequest?.tools.map((tool) => tool.name)).toEqual(['inspect', 'preview']);
    expect(modelRequest?.interactions[0]?.target?.operationId).toBe('operation.createTask');
    expect(modelRequest?.messages[0]?.text).toContain('Recent privacy-safe preview interactions');
  });
});
