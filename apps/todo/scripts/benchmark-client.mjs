import { readFile } from 'node:fs/promises';
import { brotliCompressSync, gzipSync } from 'node:zlib';

import { build, transform } from 'esbuild';

import {
  generateApplicationBrowserClient,
  lowerApplicationRouteToUiGraph,
  projectApplicationBrowserView,
} from '../../../packages/compiler/dist/index.js';
import { loadApplicationGraph } from '../../../packages/graph/dist/index.js';

const generatedUrl = new URL('../dist/generated/application-client.js', import.meta.url);
const browserUrl = new URL('../dist/client.js', import.meta.url);
const generatedSource = await readFile(generatedUrl, 'utf8');
const browserSource = await readFile(browserUrl, 'utf8');
const graph = loadApplicationGraph(
  JSON.parse(
    await readFile(
      new URL('../../../examples/application-graph-todo/graph.json', import.meta.url),
      'utf8',
    ),
  ),
);

const compressedSize = (source) => ({
  brotli: brotliCompressSync(source).byteLength,
  gzip: gzipSync(source).byteLength,
  raw: Buffer.byteLength(source),
});

const generatedMinified = (
  await transform(generatedSource, { format: 'esm', minify: true, target: 'es2022' })
).code;
const browserBundle = (
  await build({
    bundle: true,
    entryPoints: [browserUrl.pathname],
    format: 'esm',
    minify: true,
    platform: 'browser',
    target: 'es2022',
    write: false,
  })
).outputFiles[0]?.text;
if (!browserBundle) throw new Error('esbuild did not produce a browser bundle.');
const splitBuild = await build({
  bundle: true,
  entryPoints: [browserUrl.pathname],
  format: 'esm',
  minify: true,
  outdir: '/oxe-client-benchmark',
  platform: 'browser',
  splitting: true,
  target: 'es2022',
  write: false,
});
const splitFiles = splitBuild.outputFiles.filter((file) => file.path.endsWith('.js'));
const entryChunk = splitFiles.find((file) => file.path.endsWith('/client.js'));
if (!entryChunk) throw new Error('esbuild did not produce a split entry chunk.');
const asyncChunks = splitFiles.filter((file) => file !== entryChunk);
const combinedSize = (files) => ({
  brotli: files.reduce((total, file) => total + brotliCompressSync(file.contents).byteLength, 0),
  gzip: files.reduce((total, file) => total + gzipSync(file.contents).byteLength, 0),
  raw: files.reduce((total, file) => total + file.contents.byteLength, 0),
});
const definitions = lowerApplicationRouteToUiGraph(graph).graph.serverFunctions ?? [];
const view = projectApplicationBrowserView(graph);
const duplicatedFacets = new Map();
for (const moduleName of new Set(view.functions.map((definition) => definition.clientModule))) {
  const ids = new Set(
    view.functions
      .filter((definition) => definition.clientModule === moduleName)
      .map((definition) => definition.id),
  );
  duplicatedFacets.set(
    moduleName,
    generateApplicationBrowserClient(
      graph,
      definitions.filter((definition) => ids.has(definition.id)),
    ).moduleSource,
  );
}
const duplicatedBuild = await build({
  bundle: true,
  entryPoints: [browserUrl.pathname],
  format: 'esm',
  minify: true,
  outdir: '/oxe-client-duplicated-runtime-benchmark',
  platform: 'browser',
  plugins: [
    {
      name: 'duplicated-application-client-runtime',
      setup(build_) {
        build_.onResolve({ filter: /\/(?:account|ownedTeam|team)-client\.js$/ }, (args) => ({
          namespace: 'duplicated-client',
          path: args.path.slice(args.path.lastIndexOf('/') + 1, -'.js'.length),
        }));
        build_.onLoad({ filter: /.*/, namespace: 'duplicated-client' }, (args) => ({
          contents: duplicatedFacets.get(args.path),
          loader: 'ts',
        }));
      },
    },
  ],
  splitting: true,
  target: 'es2022',
  write: false,
});
const duplicatedFiles = duplicatedBuild.outputFiles.filter((file) => file.path.endsWith('.js'));
const duplicatedSize = combinedSize(duplicatedFiles);
const sharedSize = combinedSize(splitFiles);

const generated = await import(generatedUrl.href);
const task = {
  createdAt: '2026-08-28T12:00:00.000Z',
  done: false,
  id: 'task-benchmark',
  title: 'Benchmark task',
};
const hundredTasks = Array.from({ length: 100 }, (_, index) => ({
  ...task,
  id: `task-benchmark-${index}`,
}));
const responseFetch = (tasks) => async (_input, init) => {
  const request = JSON.parse(String(init?.body));
  return Response.json({
    functionId: request.functionId,
    ok: true,
    schemaVersion: 'oxe.server-function-response.v1',
    value: request.functionId.endsWith('query.myTasks') ? tasks : task,
  });
};
const fetchStub = responseFetch([task]);
const options = {
  context: {
    activeContexts: [
      { contextId: 'context.team', entityId: 'entity.team', recordId: 'team-benchmark' },
    ],
    schemaVersion: 'oxe.application-client-context.v1',
    userId: 'user-benchmark',
  },
  fetch: fetchStub,
  now: () => 1_000,
};

const median = (values) =>
  [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
const measure = async (iterations, run) => {
  const samples = [];
  for (let round = 0; round < 7; round += 1) {
    const startedAt = performance.now();
    await run(iterations);
    samples.push((performance.now() - startedAt) / iterations);
  }
  return median(samples);
};

const factoryMicroseconds =
  (await measure(20_000, (iterations) => {
    for (let index = 0; index < iterations; index += 1) generated.createApplicationClient(options);
  })) * 1_000;
const cacheClient = generated.createApplicationClient(options);
await cacheClient.myTasks();
const cacheHitMicroseconds =
  (await measure(50_000, async (iterations) => {
    for (let index = 0; index < iterations; index += 1) await cacheClient.myTasks();
  })) * 1_000;
const responseClient = generated.createApplicationClient(options);
const responseMicroseconds =
  (await measure(2_000, async (iterations) => {
    for (let index = 0; index < iterations; index += 1)
      await responseClient.myTasks({ refresh: true });
  })) * 1_000;
const largeResponseClient = generated.createApplicationClient({
  ...options,
  fetch: responseFetch(hundredTasks),
});
const largeResponseMicroseconds =
  (await measure(500, async (iterations) => {
    for (let index = 0; index < iterations; index += 1)
      await largeResponseClient.myTasks({ refresh: true });
  })) * 1_000;
if (!globalThis.gc) throw new Error('Client memory benchmark requires node --expose-gc.');
globalThis.gc();
const retainedBefore = process.memoryUsage().heapUsed;
const retainedClients = Array.from({ length: 10_000 }, () =>
  generated.createApplicationClient(options),
);
globalThis.gc();
const retainedAfter = process.memoryUsage().heapUsed;
const retainedBytesPerClient = (retainedAfter - retainedBefore) / retainedClients.length;

process.stdout.write(
  `${JSON.stringify(
    {
      runtime: {
        cacheHitMicroseconds,
        clientFactoryMicroseconds: factoryMicroseconds,
        responseValidationMicroseconds: responseMicroseconds,
        responseValidation100RowsMicroseconds: largeResponseMicroseconds,
        retainedBytesPerClient,
        retainedClientSampleSize: retainedClients.length,
      },
      size: {
        browserBundle: compressedSize(browserBundle),
        browserSplitAsync: combinedSize(asyncChunks),
        browserSplitEntry: compressedSize(entryChunk.contents),
        browserSplitTotal: combinedSize(splitFiles),
        browserSplitChunks: splitFiles.length,
        browserSplitDuplicatedRuntimeBaseline: duplicatedSize,
        browserSplitSharedRuntimeSavings: {
          brotliPercent:
            ((duplicatedSize.brotli - sharedSize.brotli) / duplicatedSize.brotli) * 100,
          gzipPercent: ((duplicatedSize.gzip - sharedSize.gzip) / duplicatedSize.gzip) * 100,
          rawPercent: ((duplicatedSize.raw - sharedSize.raw) / duplicatedSize.raw) * 100,
        },
        generatedClient: compressedSize(generatedSource),
        generatedClientMinified: compressedSize(generatedMinified),
        handwrittenBrowserClient: compressedSize(browserSource),
      },
    },
    null,
    2,
  )}\n`,
);
