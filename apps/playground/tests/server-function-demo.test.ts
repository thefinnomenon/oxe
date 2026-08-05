import { analyzeProject } from '@oxe/compiler';
import type { OxeAsyncFailure } from '@oxe/runtime';
import { describe, expect, it, vi } from 'vitest';

import { capabilitiesForPlayground } from '../src/demo-capabilities.js';
import { findExample } from '../src/examples.js';
import {
  createServerFunctionDemoCapability,
  serverFunctionDemoCompilerCapabilities,
} from '../src/server-function-demo.js';

const compileDemo = async () => {
  const example = findExample('server-functions');
  if (!example) throw new Error('Expected the server-function example.');
  const sources = new Map(example.files.map((file) => [file.moduleId, file.source]));
  return analyzeProject({
    capabilities: capabilitiesForPlayground(example.capabilitySet),
    entryExport: example.entryExport,
    entryModuleId: example.entryModuleId,
    loadModule: async (moduleId) => sources.get(moduleId),
  });
};

const compileDemoDefinition = async () => {
  const analyzed = await compileDemo();
  const definition = analyzed.graph?.serverFunctions?.[0];
  if (!definition) throw new Error(JSON.stringify(analyzed.diagnostics));
  return definition;
};

describe('playground server-function demo', () => {
  it('compiles the authored playground example with its server-function identity', async () => {
    const analyzed = await compileDemo();

    expect(analyzed.diagnostics).toEqual([]);
    const definition = analyzed.graph?.serverFunctions?.[0];
    expect(definition).toMatchObject({ mode: 'query', name: 'readProject' });
    expect(analyzed.graph?.nodes).toContainEqual(
      expect.objectContaining({
        kind: 'platform-capability',
        serverFunctionId: definition?.id,
      }),
    );
  });

  it('exposes only the server-body host capability to analysis', () => {
    expect(serverFunctionDemoCompilerCapabilities).toEqual([
      expect.objectContaining({
        kind: 'async',
        name: 'database.readDemoProject',
        target: 'server',
      }),
    ]);
  });

  it('round-trips Fetch envelopes and keeps request context out of the arguments', async () => {
    const onExchange = vi.fn();
    const read = createServerFunctionDemoCapability(await compileDemoDefinition(), {
      delayMilliseconds: 0,
      onExchange,
      origin: 'https://playground.example.test',
    });

    await expect(read(2, new AbortController().signal)).resolves.toEqual({
      id: 2,
      name: 'Runtime boundary',
      request: 1,
      summary: 'Arguments and results are validated on both sides of serialization.',
      viewer: 'Ada',
    });
    expect(onExchange).toHaveBeenCalledTimes(2);
    expect(onExchange.mock.calls[0]?.[1]).toContain(
      '"schemaVersion":"oxe.server-function-request.v1"',
    );
    expect(onExchange.mock.calls[0]?.[1]).not.toContain('Ada');
    expect(onExchange.mock.calls[1]?.[1]).toContain('"viewer":"Ada"');
  });

  it('redacts private handler errors at the response boundary', async () => {
    const responses: string[] = [];
    const read = createServerFunctionDemoCapability(await compileDemoDefinition(), {
      delayMilliseconds: 0,
      onExchange: (direction, payload) => {
        if (direction === 'response') responses.push(payload);
      },
      origin: 'https://playground.example.test',
    });

    await expect(read(404, new AbortController().signal)).rejects.toEqual(
      expect.objectContaining<Partial<OxeAsyncFailure>>({
        kind: 'not-found',
        message: 'Not found.',
      }),
    );
    expect(responses[0]).not.toContain('Private demo-store detail');
  });
});
