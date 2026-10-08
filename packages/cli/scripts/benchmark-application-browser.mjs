import { brotliCompressSync, gzipSync } from 'node:zlib';
import { copyFile, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildProject } from '../dist/index.js';

const projectDirectory = await mkdtemp(join(tmpdir(), 'oxe-browser-build-benchmark-'));
const repositoryDirectory = fileURLToPath(new URL('../../../', import.meta.url));
const graphSource = resolve(repositoryDirectory, 'examples/application-graph-todo/graph.json');

const filesBelow = async (directory, prefix = '') =>
  (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map(async (entry) => {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        return entry.isDirectory() ? filesBelow(join(directory, entry.name), relative) : [relative];
      }),
    )
  ).flat();

try {
  await copyFile(graphSource, join(projectDirectory, 'graph.json'));
  const startedAt = performance.now();
  await buildProject({ applicationGraph: 'graph.json', projectDirectory });
  const buildMilliseconds = performance.now() - startedAt;
  const browserDirectory = join(projectDirectory, 'dist', 'browser');
  const manifest = JSON.parse(
    await readFile(join(browserDirectory, 'asset-manifest.json'), 'utf8'),
  );
  const logicalPaths = (await filesBelow(browserDirectory)).filter(
    (path) =>
      !path.startsWith('assets/') &&
      path !== 'asset-manifest.json' &&
      path !== 'index.html' &&
      path !== 'application.css',
  );
  const logicalSources = await Promise.all(
    logicalPaths.map((path) => readFile(join(browserDirectory, path))),
  );
  const productionSources = await Promise.all(
    manifest.assets.map(({ path }) => readFile(join(browserDirectory, path))),
  );
  const combine = (sources) => Buffer.concat(sources);
  const logical = combine(logicalSources);
  const production = combine(productionSources);
  const size = (source) => ({
    brotliBytes: brotliCompressSync(source).byteLength,
    gzipBytes: gzipSync(source).byteLength,
    rawBytes: source.byteLength,
  });
  const logicalSize = size(logical);
  const productionSize = size(production);
  process.stdout.write(
    `${JSON.stringify(
      {
        assets: manifest.assets.length,
        buildMilliseconds,
        logical: logicalSize,
        production: productionSize,
        rawReductionPercent: Number(
          ((1 - productionSize.rawBytes / logicalSize.rawBytes) * 100).toFixed(1),
        ),
        schemaVersion: 'oxe.application-browser-build-benchmark.v1',
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await rm(projectDirectory, { force: true, recursive: true });
}
