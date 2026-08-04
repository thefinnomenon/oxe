import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';

import { analyzeSource, generateDomFactorySource } from '@oxe/compiler';
import * as runtime from '@oxe/runtime';
import * as dom from '@oxe/runtime-dom';
import { describe, expect, it } from 'vitest';

import {
  createServerRenderPlan,
  createDeferredServerRenderPlan,
  createJavaScriptReadinessAdapter,
  defaultServerErrorResponse,
  OXE_STREAM_BOOTSTRAP_CSP_HASH,
  OXE_STREAM_BOOTSTRAP_SOURCE,
  OxeServerReadinessError,
  renderServerStreamToString,
  renderToSink,
  renderToString,
  renderToStringWithMetrics,
  serializeAsyncCheckpoints,
  serializeServerStreamPatch,
  streamServerRenderPlan,
  type ServerDeferredRegionOutput,
  type ServerDeferredRegionV2,
  type ServerPreparedRegionV2,
  type ServerReadinessAdapter,
  type ServerRenderPlanV2,
  type ServerRenderPlanV1,
} from '../src/index.js';
import { FakeDocument, FakeElement, serializeChildren } from './fake-dom.js';

const requirePlan = (
  source: string,
  moduleId = 'server.oxe',
  options?: Parameters<typeof analyzeSource>[3],
): ServerRenderPlanV1 => {
  const analyzed = analyzeSource(source, moduleId, moduleId, options);
  if (!analyzed.graph) {
    throw new Error(`Expected a graph, received ${JSON.stringify(analyzed.diagnostics)}.`);
  }
  return createServerRenderPlan(analyzed.graph);
};

const representativeSource = `export App():
  title = "<Team & Friends>"
  visible = true
  users = [{ id: 1, name: "Ada" }, { id: 2, name: "Lin" }]
  <main class={"page"} title={title}>
    ?
      visible ? <h1>{title}
      : <p>Hidden
    <ul>
      {users.map(user => <li key={user.id}>{user.name})}
`;

const requireDeferredPlan = (
  source: string,
  moduleId = 'deferred.oxe',
  returns: 'array' | 'record' = 'record',
): ServerRenderPlanV2 => {
  const analyzed = analyzeSource(source, moduleId, moduleId, {
    capabilities: [{ kind: 'async', name: 'users.load', parameters: ['number'], returns }],
    target: 'server',
  });
  if (!analyzed.graph) {
    throw new Error(`Expected a graph, received ${JSON.stringify(analyzed.diagnostics)}.`);
  }
  return createDeferredServerRenderPlan(analyzed.graph);
};

const createTestReadinessAdapter = (
  plan: ServerRenderPlanV2,
  options: {
    readonly identity?: (resourceId: string) => string;
    readonly load: (resourceId: string, signal: AbortSignal) => unknown | PromiseLike<unknown>;
    readonly render: (
      region: ServerDeferredRegionV2,
      resources: ReadonlyMap<string, unknown>,
      signal: AbortSignal,
    ) => ServerDeferredRegionOutput | PromiseLike<ServerDeferredRegionOutput>;
    readonly shell: string;
  },
): ServerReadinessAdapter => ({
  prepare: () => {
    const resourceIds = [...new Set(plan.regions.flatMap((region) => region.resourceIds))];
    return {
      regions: plan.regions.map((template) => ({
        id: template.id,
        render: (resources: ReadonlyMap<string, unknown>, signal: AbortSignal) =>
          options.render(template, resources, signal),
        resourceIds: template.resourceIds,
        template,
      })),
      resources: resourceIds.map((resourceId) => ({
        id: resourceId,
        identity: options.identity?.(resourceId) ?? resourceId,
        load: (signal: AbortSignal) => options.load(resourceId, signal),
      })),
      shell: options.shell,
    };
  },
});

describe('portable server render plans', () => {
  it('marks only root structural async work as an inferred HTTP status gate', () => {
    const root = requireDeferredPlan(`export App():
  page = users.load(1)
  ?
    page.available ? <main>Available
    : <main>Missing
`);
    const nested = requireDeferredPlan(`export App():
  page = users.load(1)
  <main>
    <p>Shell
    ?
      page.available ? <strong>Available
      : <em>Missing
`);

    expect(root.regions).toEqual([
      expect.objectContaining({ kind: 'structural', statusGate: true }),
    ]);
    expect(nested.regions).toEqual([
      expect.objectContaining({ kind: 'structural', statusGate: false }),
    ]);
  });

  it('derives stable smallest-consumer regions from async value lineage', () => {
    const analyzed = analyzeSource(
      `export App():
  user = users.load(1)
  <main>
    <p>Static introduction
    <img src={user.avatar}>
    <h1>{user.name}
    <p>{user.role}
`,
      'async-plan.oxe',
      'async-plan.oxe',
      {
        capabilities: [
          { kind: 'async', name: 'users.load', parameters: ['number'], returns: 'record' },
        ],
        target: 'server',
      },
    );
    if (!analyzed.graph) {
      throw new Error(`Expected a graph, received ${JSON.stringify(analyzed.diagnostics)}.`);
    }
    const plan = createDeferredServerRenderPlan(analyzed.graph);
    const reordered = createDeferredServerRenderPlan({
      ...analyzed.graph,
      edges: [...analyzed.graph.edges].reverse(),
      nodes: [...analyzed.graph.nodes].reverse(),
    });

    expect(reordered).toEqual(plan);
    expect(plan).toMatchObject({
      schemaVersion: 'oxe.server-render-plan.v2',
      execution: {
        batching: 'resource-and-short-window',
        delivery: 'readiness-stream',
        mode: 'asynchronous',
        ordering: 'stable-document-markers',
      },
    });
    expect(plan.regions).toHaveLength(3);
    expect(plan.regions.map((region) => region.kind).sort()).toEqual(['attribute', 'text', 'text']);
    expect(new Set(plan.regions.flatMap((region) => region.resourceIds))).toEqual(
      new Set(['async-plan.oxe#component/App/binding/user']),
    );
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
  });

  it('lowers deterministically to a JSON-only blocking-boundary contract', () => {
    const analyzed = analyzeSource(representativeSource, 'deterministic.oxe', 'deterministic.oxe');
    if (!analyzed.graph) {
      throw new Error(`Expected a graph, received ${JSON.stringify(analyzed.diagnostics)}.`);
    }
    const canonical = createServerRenderPlan(analyzed.graph);
    const reordered = createServerRenderPlan({
      ...analyzed.graph,
      edges: [...analyzed.graph.edges].reverse(),
      nodes: [...analyzed.graph.nodes].reverse(),
    });

    expect(reordered).toEqual(canonical);
    expect(canonical).toMatchObject({
      schemaVersion: 'oxe.server-render-plan.v1',
      execution: { delivery: 'ordered-chunks', mode: 'synchronous' },
      entry: { boundaryId: expect.stringContaining('/server-boundary') as string },
    });
    expect(canonical.components.every((component) => component.boundary.mode === 'blocking')).toBe(
      true,
    );
    expect(
      canonical.components.find((component) => component.id === canonical.entry.componentId)
        ?.boundary.id,
    ).toBe(canonical.entry.boundaryId);
    const serialized = JSON.stringify(canonical);
    expect(serialized).not.toContain('span');
    expect(JSON.parse(serialized)).toEqual(canonical);
  });
});

describe('inert streaming transport', () => {
  it('keeps the fixed bootstrap below its target and pins its CSP digest', () => {
    expect(gzipSync(OXE_STREAM_BOOTSTRAP_SOURCE, { level: 9 }).byteLength).toBeLessThan(1_024);
    expect(
      `sha256-${createHash('sha256').update(OXE_STREAM_BOOTSTRAP_SOURCE).digest('base64')}`,
    ).toBe(OXE_STREAM_BOOTSTRAP_CSP_HASH);
  });

  it('serializes replacement, attribute, and checkpoint payloads as inert data', () => {
    expect(
      serializeServerStreamPatch({
        html: '<strong>Ada</strong>',
        kind: 'replace',
        regionId: 'profile/name',
        token: 2,
      }),
    ).toBe(
      '<template data-oxe-patch="profile/name" data-oxe-kind="replace" data-oxe-token="2"><strong>Ada</strong></template>',
    );
    const attribute = serializeServerStreamPatch({
      kind: 'attribute',
      mode: 'attribute',
      name: 'title',
      regionId: 'profile/title',
      token: 3,
      value: '<Admin & owner>',
    });
    expect(attribute).toContain('<template ');
    expect(attribute).not.toContain('<Admin');
    expect(attribute).not.toContain('<script');
    expect(serializeAsyncCheckpoints([{ identity: '</script>', value: '<Admin>' }])).toContain(
      '\\u003c/script\\u003e',
    );
  });
});

describe('readiness-driven server execution', () => {
  it('deduplicates identities, batches shared readiness, and writes one checkpoint', async () => {
    const plan = requireDeferredPlan(`export App():
  first = users.load(1)
  second = users.load(1)
  <main>
    <p>{first.name}
    <p>{second.name}
`);
    let loads = 0;
    const seenValues: unknown[] = [];
    const adapter = createTestReadinessAdapter(plan, {
      identity: () => 'request:user:1',
      load: () => {
        loads += 1;
        return { name: 'Ada' };
      },
      render: (region, resources) => {
        seenValues.push(resources.get(region.resourceIds[0] as string));
        return { html: 'Ada', kind: 'replace', regionId: region.id, token: 1 };
      },
      shell: '<main>shell</main>',
    });

    const result = await renderServerStreamToString(plan, adapter, { includeBootstrap: false });

    expect(loads).toBe(1);
    expect(seenValues).toEqual([{ name: 'Ada' }, { name: 'Ada' }]);
    expect(result.metrics).toMatchObject({
      batchesWritten: 1,
      checkpointsWritten: 1,
      patchesWritten: 2,
      regionsCompleted: 2,
      requestsDeduplicated: 1,
      requestsStarted: 1,
    });
    expect(result.html.startsWith('<main>shell</main>')).toBe(true);
    expect(result.html.match(/data-oxe-patch=/gu)).toHaveLength(2);
    expect(result.html.match(/request:user:1/gu)).toHaveLength(1);
  });

  it('streams a later document region first when its independent resource wins the race', async () => {
    const plan = requireDeferredPlan(`export App():
  slow = users.load(1)
  fast = users.load(2)
  <main>
    <p>{slow.name}
    <p>{fast.name}
`);
    const resourceIds = [...new Set(plan.regions.flatMap((region) => region.resourceIds))];
    const [slowId, fastId] = resourceIds;
    if (!slowId || !fastId) throw new Error('Expected two deferred resources.');
    const adapter = createTestReadinessAdapter(plan, {
      load: (resourceId) =>
        new Promise((resolve) => {
          setTimeout(() => resolve(resourceId), resourceId === slowId ? 20 : 0);
        }),
      render: (region) => ({
        html: region.resourceIds[0] === slowId ? 'slow' : 'fast',
        kind: 'replace',
        regionId: region.id,
        token: 1,
      }),
      shell: 'shell',
    });

    const result = await renderServerStreamToString(plan, adapter, {
      includeBootstrap: false,
      includeCheckpoints: false,
    });
    const slowPatch = result.html.indexOf('>slow</template>');
    const fastPatch = result.html.indexOf('>fast</template>');

    expect(fastPatch).toBeGreaterThan(-1);
    expect(slowPatch).toBeGreaterThan(fastPatch);
    expect(result.metrics.batchesWritten).toBe(2);
  });

  it('distinguishes repeated runtime instances while sharing their equal request identity', async () => {
    const plan = requireDeferredPlan(`export App():
  user = users.load(1)
  <p>{user.name}
`);
    const template = plan.regions[0];
    if (!template) throw new Error('Expected a deferred region template.');
    let loads = 0;
    const adapter: ServerReadinessAdapter = {
      prepare: () => ({
        regions: ['left', 'right'].map((instance) => ({
          id: `${template.id}@${instance}`,
          render: () => ({
            html: instance,
            kind: 'replace',
            regionId: `${template.id}@${instance}`,
            token: 1,
          }),
          resourceIds: [`resource@${instance}`],
          template,
        })),
        resources: ['left', 'right'].map((instance) => ({
          id: `resource@${instance}`,
          identity: 'users.load:[1]:public',
          load: () => {
            loads += 1;
            return { name: 'Ada' };
          },
        })),
        shell: 'two instances',
      }),
    };

    const result = await renderServerStreamToString(plan, adapter, { includeBootstrap: false });

    expect(loads).toBe(1);
    expect(result.metrics).toMatchObject({
      checkpointsWritten: 1,
      patchesWritten: 2,
      requestsDeduplicated: 1,
      requestsStarted: 1,
    });
    expect(result.html).toContain(`data-oxe-patch="${template.id}@left"`);
    expect(result.html).toContain(`data-oxe-patch="${template.id}@right"`);
  });

  it('accepts new resources and regions revealed by an earlier prepared region', async () => {
    const plan = requireDeferredPlan(`export App():
  user = users.load(1)
  <p>{user.name}
`);
    const template = plan.regions[0];
    if (!template) throw new Error('Expected a deferred region template.');
    const loads: string[] = [];
    const nestedRegion: ServerPreparedRegionV2 = {
      id: `${template.id}@nested`,
      render: () => ({
        html: 'nested ready',
        kind: 'replace',
        regionId: `${template.id}@nested`,
        token: 1,
      }),
      resourceIds: ['resource@nested'],
      template,
    };
    const adapter: ServerReadinessAdapter = {
      prepare: () => ({
        regions: [
          {
            id: `${template.id}@outer`,
            render: () => ({
              kind: 'expansion',
              patches: [
                {
                  html: 'outer ready',
                  kind: 'replace',
                  regionId: `${template.id}@outer`,
                  token: 1,
                },
              ],
              regions: [nestedRegion],
              resources: [
                {
                  id: 'resource@nested',
                  identity: 'nested',
                  load: () => {
                    loads.push('nested');
                    return 'nested';
                  },
                },
              ],
            }),
            resourceIds: ['resource@outer'],
            template,
          },
        ],
        resources: [
          {
            id: 'resource@outer',
            identity: 'outer',
            load: () => {
              loads.push('outer');
              return 'outer';
            },
          },
        ],
        shell: 'shell',
      }),
    };

    const result = await renderServerStreamToString(plan, adapter, { includeBootstrap: false });

    expect(loads).toEqual(['outer', 'nested']);
    expect(result.html.indexOf('>outer ready</template>')).toBeLessThan(
      result.html.indexOf('>nested ready</template>'),
    );
    expect(result.metrics).toMatchObject({
      checkpointsWritten: 2,
      patchesWritten: 2,
      regionsCompleted: 2,
      requestsStarted: 2,
    });
  });

  it('serializes sink writes to honor backpressure', async () => {
    const plan = requireDeferredPlan(`export App():
  first = users.load(1)
  second = users.load(2)
  <main>
    <p>{first.name}
    <p>{second.name}
`);
    let activeWrites = 0;
    let maxActiveWrites = 0;
    const resourceIds = [...new Set(plan.regions.flatMap((region) => region.resourceIds))];
    const firstResource = resourceIds[0];
    const adapter = createTestReadinessAdapter(plan, {
      load: (resourceId) =>
        new Promise((resolve) => {
          setTimeout(() => resolve(resourceId), resourceId === firstResource ? 0 : 15);
        }),
      render: (region) => ({
        html: 'ready',
        kind: 'replace',
        regionId: region.id,
        token: 1,
      }),
      shell: 'shell',
    });

    const metrics = await streamServerRenderPlan(
      plan,
      adapter,
      {
        write: async () => {
          activeWrites += 1;
          maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
          await new Promise((resolve) => setTimeout(resolve, 10));
          activeWrites -= 1;
        },
      },
      { includeBootstrap: false },
    );

    expect(maxActiveWrites).toBe(1);
    expect(metrics.batchesWritten).toBe(2);
  });

  it('cancels outstanding requests when its caller aborts', async () => {
    const plan = requireDeferredPlan(`export App():
  user = users.load(1)
  <p>{user.name}
`);
    const controller = new AbortController();
    let requestAborted = false;
    const adapter = createTestReadinessAdapter(plan, {
      identity: () => 'request:user:1',
      load: (_resourceId, signal) =>
        new Promise(() => {
          signal.addEventListener('abort', () => {
            requestAborted = true;
          });
        }),
      render: () => null,
      shell: 'shell',
    });
    const streaming = streamServerRenderPlan(
      plan,
      adapter,
      { write: () => undefined },
      { includeBootstrap: false, signal: controller.signal },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(streaming).rejects.toMatchObject({
      code: 'OXE_SERVER_STREAM_ABORTED',
      name: OxeServerReadinessError.name,
    });
    expect(requestAborted).toBe(true);
  });

  it('bubbles the original resource failure through the global error hook', async () => {
    const plan = requireDeferredPlan(`export App():
  user = users.load(1)
  <p>{user.name}
`);
    const failure = new runtime.OxeAsyncFailure('not-found', 'User not found.');
    const observed: unknown[] = [];
    const adapter = createTestReadinessAdapter(plan, {
      identity: () => 'request:user:missing',
      load: () => Promise.reject(failure),
      render: () => null,
      shell: 'shell',
    });

    await expect(
      streamServerRenderPlan(
        plan,
        adapter,
        { write: () => undefined },
        {
          includeBootstrap: false,
          onError: (error, context) => {
            observed.push(error, context);
          },
        },
      ),
    ).rejects.toBe(failure);
    expect(observed).toEqual([
      failure,
      expect.objectContaining({ headersCommitted: true, phase: 'resource' }),
    ]);
  });

  it('lets a pre-header status gate render a typed global error response', async () => {
    const plan = requireDeferredPlan(`export App():
  page = users.load(1)
  ?
    page.available ? <main>Available
    : <main>Missing
`);
    const failure = new runtime.OxeAsyncFailure('not-found', 'Page not found.');
    const adapter = createJavaScriptReadinessAdapter({
      callCapability: () => Promise.reject(failure),
    });

    const result = await renderServerStreamToString(plan, adapter, {
      includeBootstrap: false,
      onError: (error, context) => {
        expect(context).toMatchObject({ headersCommitted: false, phase: 'resource' });
        return defaultServerErrorResponse(error);
      },
    });

    expect(result).toMatchObject({
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      html: 'Not found',
      status: 404,
    });
    expect(result.html).not.toContain('Available');
  });
});

describe('JavaScript v2 readiness adapter', () => {
  it('does not start an async binding with no rendering consumer', async () => {
    const plan = requireDeferredPlan(`export App():
  unused = users.load(1)
  <p>Static only
`);
    let calls = 0;
    const adapter = createJavaScriptReadinessAdapter({
      callCapability: () => {
        calls += 1;
        return { name: 'unused' };
      },
    });

    const result = await renderServerStreamToString(plan, adapter, { includeBootstrap: false });

    expect(calls).toBe(0);
    expect(result.html).toContain('<p>Static only</p>');
    expect(result.metrics).toMatchObject({
      checkpointsWritten: 0,
      patchesWritten: 0,
      requestsStarted: 0,
    });
  });

  it('renders a static shell and granular text/attribute patches from one request', async () => {
    const plan = requireDeferredPlan(`export App():
  user = users.load(1)
  <main>
    <p>Static introduction
    <img src={user.avatar} alt={"Profile"}>
    <h1>{user.name}
    <p>{user.role}
`);
    let calls = 0;
    const adapter = createJavaScriptReadinessAdapter({
      callCapability: (_capability, arguments_, signal) => {
        calls += 1;
        expect(arguments_).toEqual([1]);
        expect(signal.aborted).toBe(false);
        return Promise.resolve({ avatar: '/ada.png', name: 'Ada', role: 'Engineer' });
      },
      scope: 'public',
    });

    const result = await renderServerStreamToString(plan, adapter, { includeBootstrap: false });
    const firstPatch = result.html.indexOf('data-oxe-patch=');
    const shell = result.html.slice(0, firstPatch);

    expect(calls).toBe(1);
    expect(shell).toContain('Static introduction');
    expect(shell).not.toContain('Ada');
    expect(shell).toContain('data-oxe-attr-region=');
    expect(shell.match(/data-oxe-region=/gu)).toHaveLength(2);
    expect(result.html).toContain('data-oxe-attribute="src"');
    expect(result.html).toContain('data-oxe-kind="attribute"');
    expect(result.html).toContain('>Ada</template>');
    expect(result.html).toContain('>Engineer</template>');
    expect(result.metrics).toMatchObject({
      batchesWritten: 1,
      checkpointsWritten: 1,
      patchesWritten: 3,
      requestsStarted: 1,
    });
  });

  it('waits to compute a dependent async request identity until its argument resource is ready', async () => {
    const plan = requireDeferredPlan(`export App():
  user = users.load(1)
  details = users.load(user.id)
  <main>
    <p>Immediate
    <p>{details.name}
`);
    const calls: unknown[][] = [];
    const adapter = createJavaScriptReadinessAdapter({
      callCapability: (_capability, arguments_) => {
        calls.push([...arguments_]);
        return arguments_[0] === 1 ? { id: 2 } : { name: 'Dependent result' };
      },
    });

    const result = await renderServerStreamToString(plan, adapter, { includeBootstrap: false });

    expect(calls).toEqual([[1], [2]]);
    expect(result.html).toContain('Immediate');
    expect(result.html).toContain('>Dependent result</template>');
    expect(result.metrics.requestsStarted).toBe(2);
    expect(result.metrics.patchesWritten).toBe(1);
  });

  it('traces a dependent async request through a forwarded component prop', async () => {
    const plan = requireDeferredPlan(`export App():
  user = users.load(1)
  <Profile user={user}>

Profile(user):
  details = users.load(user.id)
  <article>{details.name}
`);
    const calls: unknown[][] = [];
    const adapter = createJavaScriptReadinessAdapter({
      callCapability: (_capability, arguments_) => {
        calls.push([...arguments_]);
        return arguments_[0] === 1 ? { id: 2 } : { name: 'Forwarded result' };
      },
    });

    const result = await renderServerStreamToString(plan, adapter, { includeBootstrap: false });

    expect(calls).toEqual([[1], [2]]);
    expect(result.html).toContain('>Forwarded result</template>');
    expect(result.metrics.requestsStarted).toBe(2);
    expect(result.metrics.patchesWritten).toBe(1);
  });

  it('preserves async lineage through a child prop and derived field', async () => {
    const plan = requireDeferredPlan(`export App():
  user = users.load(1)
  <main>
    <p>Parent static
    <Profile user={user}>

Profile(user):
  displayName = user.name
  <article>
    <p>Child static
    <h2>{displayName}
`);
    const adapter = createJavaScriptReadinessAdapter({
      callCapability: () => ({ name: 'Ada' }),
    });

    const result = await renderServerStreamToString(plan, adapter, { includeBootstrap: false });
    const firstPatch = result.html.indexOf('data-oxe-patch=');
    const shell = result.html.slice(0, firstPatch);

    expect(shell).toContain('Parent static');
    expect(shell).toContain('Child static');
    expect(shell).not.toContain('Ada');
    expect(result.html).toContain('>Ada</template>');
    expect(result.metrics.patchesWritten).toBe(1);
  });

  it('streams a structural choice whose branch depends on an async record', async () => {
    const plan = requireDeferredPlan(`export App():
  user = users.load(1)
  <main>
    <p>Always visible
    ?
      user.active ? <strong>Active account: {user.name}
      : <em>Inactive account
`);
    const adapter = createJavaScriptReadinessAdapter({
      callCapability: () => Promise.resolve({ active: true, name: 'Ada' }),
    });

    const result = await renderServerStreamToString(plan, adapter, { includeBootstrap: false });
    const firstPatch = result.html.indexOf('data-oxe-patch=');
    const shell = result.html.slice(0, firstPatch);
    const structuralRegion = plan.regions.find((region) => region.kind === 'structural');
    if (!structuralRegion) throw new Error('Expected a structural deferred region.');
    const hydrationId = encodeURIComponent(structuralRegion.consumerId).replaceAll('-', '%2D');

    expect(shell).toContain('Always visible');
    expect(shell).toContain('data-oxe-skeleton');
    expect(shell).toContain('████████');
    expect(shell).not.toContain('Active account');
    expect(result.html).toContain(`<!--oxe:${hydrationId}:start-->`);
    expect(result.html).toContain(`<!--oxe:${hydrationId}:end-->`);
    expect(result.html).toContain('<strong>Active account: Ada</strong>');
    expect(result.metrics.patchesWritten).toBe(1);
  });

  it('discovers and streams additional-resource work revealed by a structural patch', async () => {
    const plan = requireDeferredPlan(`export App():
  gate = users.load(1)
  <main>
    <p>Immediate shell
    ?
      gate.active ? <Details>
      : <p>Unavailable

Details():
  details = users.load(2)
  <article>Details: {details.name}
`);
    const calls: unknown[][] = [];
    const adapter = createJavaScriptReadinessAdapter({
      callCapability: (_capability, arguments_) => {
        calls.push([...arguments_]);
        return arguments_[0] === 1 ? { active: true } : { name: 'Loaded later' };
      },
    });

    const result = await renderServerStreamToString(plan, adapter, { includeBootstrap: false });
    const outerPatch = result.html.indexOf('data-oxe-patch=');
    const nestedMarker = result.html.indexOf('data-oxe-region=', outerPatch);
    const nestedValue = result.html.indexOf('>Loaded later</template>', nestedMarker);

    expect(result.html.slice(0, outerPatch)).toContain('Immediate shell');
    expect(nestedMarker).toBeGreaterThan(outerPatch);
    expect(nestedValue).toBeGreaterThan(nestedMarker);
    expect(calls).toEqual([[1], [2]]);
    expect(result.metrics.requestsStarted).toBe(2);
    expect(result.metrics.regionsCompleted).toBe(2);
    expect(result.metrics.patchesWritten).toBe(2);
  });

  it('preserves dependent scheduling inside a dynamically revealed component', async () => {
    const plan = requireDeferredPlan(`export App():
  gate = users.load(1)
  ?
    gate.active ? <Details>
    : <p>Unavailable

Details():
  base = users.load(2)
  details = users.load(base.id)
  <article>{details.name}
`);
    const calls: unknown[][] = [];
    const adapter = createJavaScriptReadinessAdapter({
      callCapability: (_capability, arguments_) => {
        calls.push([...arguments_]);
        if (arguments_[0] === 1) return { active: true };
        if (arguments_[0] === 2) return { id: 3 };
        return { name: 'Nested dependent result' };
      },
    });

    const result = await renderServerStreamToString(plan, adapter, { includeBootstrap: false });

    expect(calls).toEqual([[1], [2], [3]]);
    expect(result.html).toContain('>Nested dependent result</template>');
    expect(result.metrics.requestsStarted).toBe(3);
    expect(result.metrics.patchesWritten).toBe(2);
  });

  it('streams keyed rows from an async collection as one structural reveal', async () => {
    const plan = requireDeferredPlan(
      `export App():
  users = users.load(1)
  <main>
    <p>Directory
    <ul>
      {users.map(user => <li key={user.id}>{user.name})}
`,
      'async-list.oxe',
      'array',
    );
    const adapter = createJavaScriptReadinessAdapter({
      callCapability: () => [
        { id: 1, name: 'Ada' },
        { id: 2, name: 'Grace' },
      ],
    });

    const result = await renderServerStreamToString(plan, adapter, { includeBootstrap: false });
    const firstPatch = result.html.indexOf('data-oxe-patch=');
    const shell = result.html.slice(0, firstPatch);

    expect(shell).toContain('Directory');
    expect(shell).toContain('<li data-oxe-region=');
    expect(shell).toContain('data-oxe-skeleton');
    expect(result.html).toContain('<li>Ada</li><li>Grace</li>');
    expect(result.html).toContain('<!--oxe:');
    expect(result.metrics.patchesWritten).toBe(1);
  });

  it('expands repeated async component consumers into distinct markers while deduplicating equal requests', async () => {
    const plan = requireDeferredPlan(`export App():
  <main>
    <Profile id={1}>
    <Profile id={1}>

Profile(id):
  profile = users.load(id)
  <p>{profile.name}
`);
    const calls: unknown[][] = [];
    const adapter = createJavaScriptReadinessAdapter({
      callCapability: (_capability, arguments_) => {
        calls.push([...arguments_]);
        return { name: 'Ada' };
      },
    });

    const result = await renderServerStreamToString(plan, adapter, { includeBootstrap: false });
    const markerIds = [...result.html.matchAll(/data-oxe-region="([^"]+)"/gu)].map(
      (match) => match[1],
    );

    expect(markerIds).toHaveLength(2);
    expect(new Set(markerIds).size).toBe(2);
    expect(result.html.match(/>Ada<\/template>/gu)).toHaveLength(2);
    expect(calls).toEqual([[1]]);
    expect(result.metrics.requestsStarted).toBe(1);
    expect(result.metrics.requestsDeduplicated).toBe(1);
    expect(result.metrics.patchesWritten).toBe(2);
  });

  it('passes map callback values into row-local async child resources', async () => {
    const plan = requireDeferredPlan(`export App():
  users = [1, 2]
  <ul>
    {users.map(id => <Profile id={id}>)}

Profile(id = 1):
  profile = users.load(id)
  <li>{profile.name}
`);
    const calls: unknown[][] = [];
    const adapter = createJavaScriptReadinessAdapter({
      callCapability: (_capability, arguments_) => {
        calls.push([...arguments_]);
        return { name: `User ${String(arguments_[0])}` };
      },
    });

    const result = await renderServerStreamToString(plan, adapter, { includeBootstrap: false });
    const markerIds = [...result.html.matchAll(/data-oxe-region="([^"]+)"/gu)].map(
      (match) => match[1],
    );

    expect(markerIds).toHaveLength(2);
    expect(new Set(markerIds).size).toBe(2);
    expect(result.html).toContain('>User 1</template>');
    expect(result.html).toContain('>User 2</template>');
    expect(calls).toEqual([[1], [2]]);
    expect(result.metrics.requestsStarted).toBe(2);
    expect(result.metrics.requestsDeduplicated).toBe(0);
    expect(result.metrics.patchesWritten).toBe(2);
  });
});

describe('synchronous JavaScript SSR', () => {
  it('emits the same stable early-event marker used by generated hydration', () => {
    const plan = requirePlan(`export App():
  count = 0
  increment():
    count = count + 1
  <button onClick={increment}>Count: {count}
`);
    const button = plan.components[0]?.boundary.root;
    if (!button || button.kind !== 'element' || !button.eventId) {
      throw new Error('Expected an event-marked server button.');
    }
    const replayId = encodeURIComponent(button.eventId).replaceAll('-', '%2D');

    expect(renderToString(plan)).toBe(`<button data-oxe-event="${replayId}">Count: 0</button>`);
  });

  it('renders escaped text, attributes, conditionals, and keyed collections', () => {
    const plan = requirePlan(representativeSource);

    expect(renderToString(plan)).toBe(
      '<main class="page" title="&lt;Team &amp; Friends&gt;"><h1>&lt;Team &amp; Friends&gt;</h1><ul><li>Ada</li><li>Lin</li></ul></main>',
    );
  });

  it('renders compiler-lowered localization with selections, attributes, and inline markup', () => {
    const plan = requirePlan(
      `export App():
  name = "Ada"
  stories = 2
  total = 10
  <main>
    <h1 i18n={{ key: "greeting" }}>Hello {name}
    <p i18n={{ key: "stories", count: stories }}>{stories} stories
    <p i18n={{ key: "welcome" }}>Welcome
      <strong>{name}
    <input placeholder={"Search stories"}>
    <data i18n={{ format: { type: "currency", currency: "EUR" } }}>{total}
`,
      'localized-server.oxe',
      { localization: true },
    );
    const html = renderToString(plan, {
      i18n: {
        format(id, options): string {
          if (id === 'greeting') return `Bonjour ${String(options?.values?.name)}`;
          if (id === 'stories') return `${String(options?.count)} histoires`;
          return 'Rechercher des histoires';
        },
        formatToParts(_id, options) {
          return [
            { children: [String(options?.values?.name)], kind: 'markup', name: 'strong' },
            ', bienvenue',
          ];
        },
        formatValue(value): string {
          return `${String(value)},00 €`;
        },
        machineValue(value): string {
          return String(value);
        },
      },
    });

    expect(html).toContain('<h1>Bonjour Ada</h1>');
    expect(html).toContain('<p>2 histoires</p>');
    expect(html).toMatch(
      /<p><!--oxe:[^:]+:start--><strong>Ada<\/strong>, bienvenue<!--oxe:[^:]+:end--><\/p>/u,
    );
    expect(html).toContain('<input placeholder="Rechercher des histoires">');
    expect(html).toContain('<data value="10">10,00 €</data>');
  });

  it('matches the browser backend for the same semantic graph and initial state', () => {
    const analyzed = analyzeSource(representativeSource, 'parity.oxe', 'parity.oxe');
    if (!analyzed.graph) {
      throw new Error(`Expected a graph, received ${JSON.stringify(analyzed.diagnostics)}.`);
    }
    const factory = runInNewContext(`(${generateDomFactorySource(analyzed.graph)})`) as (
      runtimeApi: typeof runtime,
      domApi: typeof dom,
    ) => { mountApp(container: unknown): dom.MountHandle };
    const document = new FakeDocument();
    const container = new FakeElement(document, 'container');
    const mounted = factory(runtime, dom).mountApp(container);

    expect(renderToString(createServerRenderPlan(analyzed.graph))).toBe(
      serializeChildren(container),
    );
    mounted.unmount();
  });

  it('renders component props, captured children, defaults, and rest forwarding', () => {
    const plan = requirePlan(`export App():
  title = "First"
  <Wrapper title={title} tone={"quiet"}>
    <p>Child: {title}

Wrapper(title, ...props):
  <Card title={title} {...props}>
    {children}

Card(title, subtitle = title, ...props):
  <article>
    <h2>{title}
    <p>Subtitle: {subtitle}
    {children}
`);

    expect(renderToString(plan)).toBe(
      '<article><h2>First</h2><p>Subtitle: First</p><p>Child: First</p></article>',
    );
  });

  it('resolves provider-scoped context in descendant components', () => {
    const plan = requirePlan(`SessionContext = createContext()

export App():
  session = { name: "Ada" }
  <SessionContext value={session}>
    <Profile>

Profile():
  session = SessionContext()
  <p>Signed in as {session.name}
`);

    expect(renderToString(plan)).toBe('<p>Signed in as Ada</p>');
  });

  it('executes declared pure server capabilities only through the host resolver', () => {
    const plan = requirePlan(
      `export App():
  greeting = locale.greeting("Ada")
  <p>{greeting}
`,
      'capability.oxe',
      {
        capabilities: [
          {
            kind: 'pure',
            name: 'locale.greeting',
            parameters: ['string'],
            returns: 'string',
            target: 'server',
          },
        ],
        target: 'server',
      },
    );

    expect(() => renderToString(plan)).toThrow('requires a host resolver');
    expect(
      renderToString(plan, {
        callCapability: (capability, arguments_) =>
          capability.path.join('.') === 'locale.greeting' ? `Hello, ${String(arguments_[0])}` : '',
      }),
    ).toBe('<p>Hello, Ada</p>');
  });

  it('writes ordered chunks and returns reproducible structural performance metrics', () => {
    const plan = requirePlan(representativeSource, 'performance.oxe');
    const chunks: string[] = [];
    const metrics = renderToSink(plan, { write: (chunk) => chunks.push(chunk) });
    const measured = renderToStringWithMetrics(plan);

    expect(chunks.join('')).toBe(measured.html);
    expect(metrics).toEqual(measured.metrics);
    expect(metrics).toEqual({
      bytesWritten: 129,
      collectionItems: 2,
      components: 1,
      elements: 5,
      expressions: 11,
      maxComponentDepth: 1,
      textNodes: 3,
      views: 10,
    });
  });
});
