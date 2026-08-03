import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  createOxeSizeMeasurementService,
  measureGeneratedAppBundle,
  readLimitedJsonRequest,
} from '../src/size-plugin.js';
import type { OxeSizeRequestError } from '../src/size-plugin.js';

const counterSource = `export App():
  count = 0
  doubled = count * 2

  increment():
    count = count + 1

  <main>
    <button onClick={increment}>Count: {count}
    <p>Doubled: {doubled}
`;

describe('playground size measurement', () => {
  it('measures only the generated app and browser runtime with truthful compression', async () => {
    const service = createOxeSizeMeasurementService();
    const request = {
      entryModuleId: 'examples/counter/App.oxe',
      entryExport: 'App',
      files: [{ source: counterSource, moduleId: 'examples/counter/App.oxe' }],
    };
    const first = await service.measure(request);
    const second = await service.measure(request);

    expect(second).toBe(first);
    expect(first.report.boundary).toEqual({
      scope: 'shipped-app-payload',
      includes: ['generated app', '@oxe/runtime', '@oxe/runtime-dom'],
      excludesTooling: ['@oxe/compiler', 'playground editor', 'Vite dev client'],
    });
    expect(first.report.bytes.raw).toBeGreaterThan(first.report.bytes.minified);
    expect(first.report.bytes.minified).toBeGreaterThan(first.report.bytes.gzip);
    expect(first.report.bytes.gzip).toBeGreaterThan(first.report.bytes.brotli);
    expect(first.report.attribution.modules.some((module) => module.kind === 'generated-app')).toBe(
      true,
    );
    expect(first.report.attribution.modules.some((module) => module.kind === 'runtime')).toBe(true);
    expect(first.report.attribution.modules.some((module) => module.kind === 'runtime-dom')).toBe(
      true,
    );
    expect(first.report.attribution.modules.map((module) => module.id).join('\n')).not.toMatch(
      /compiler|playground|node_modules/u,
    );

    const attributedMinified = first.report.attribution.modules.reduce(
      (total, module) => total + module.minified,
      first.report.attribution.unattributed.minified,
    );
    expect(attributedMinified).toBe(first.report.bytes.minified);
  });

  it('links every supplied source through the selected exported entry', async () => {
    const service = createOxeSizeMeasurementService();
    const request = {
      entryModuleId: 'examples/modules/App.oxe',
      entryExport: 'App',
      files: [
        {
          moduleId: 'examples/modules/App.oxe',
          source: `import { Card } from "./Card.oxe"

export App():
  <Card title={"Hello"}>
`,
        },
        {
          moduleId: 'examples/modules/Card.oxe',
          source: `export Card(title):
  <article>{title}
`,
        },
      ],
    };
    const result = await service.measure(request);
    const cached = await service.measure(request);
    const changedDependency = await service.measure({
      ...request,
      files: request.files.map((file) =>
        file.moduleId.endsWith('/Card.oxe')
          ? { ...file, source: file.source.replace('<article>', '<article>Changed: ') }
          : file,
      ),
    });

    expect(cached).toBe(result);
    expect(changedDependency).not.toBe(result);
    expect(result.report.bytes.minified).toBeGreaterThan(0);
    expect(
      result.report.attribution.modules.filter((module) => module.kind === 'generated-app'),
    ).toHaveLength(1);
  });

  it('rejects imports outside the generated app runtime boundary', async () => {
    await expect(
      measureGeneratedAppBundle('import "react"; export const App = () => null;'),
    ).rejects.toThrow('may import only @oxe/runtime and @oxe/runtime-dom');
  });

  it('enforces the request byte limit before parsing JSON', async () => {
    const request = Readable.from(['{"entryModuleId":"App.oxe","entryExport":"App","files":[]}']);
    await expect(readLimitedJsonRequest(request, 8)).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      status: 413,
    } satisfies Partial<OxeSizeRequestError>);
  });
});
