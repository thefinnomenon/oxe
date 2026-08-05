import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli } from '../src/index.js';

interface CliResult {
  readonly errors: readonly string[];
  readonly exitCode: number;
  readonly logs: readonly string[];
}

const run = async (
  arguments_: readonly string[],
  cwd: string = process.cwd(),
): Promise<CliResult> => {
  const errors: string[] = [];
  const logs: string[] = [];
  const exitCode = await runCli(arguments_, {
    cwd,
    io: { error: (message) => errors.push(message), log: (message) => logs.push(message) },
  });
  return { errors, exitCode, logs };
};

const temporaryProject = async (): Promise<string> => mkdtemp(join(tmpdir(), 'oxe-cli-project-'));

describe('OXE CLI', () => {
  it('prints localization commands in help', async () => {
    const logs: string[] = [];
    const exitCode = await runCli(['--help'], {
      cwd: process.cwd(),
      io: { error: (message) => logs.push(message), log: (message) => logs.push(message) },
    });
    expect(exitCode).toBe(0);
    expect(logs.join('\n')).toContain('oxe build');
    expect(logs.join('\n')).toContain('oxe i18n sync');
    expect(logs.join('\n')).toContain('explicit i18n sync');
  });

  it('builds a conventional app into deterministic browser, graph, and server artifacts', async () => {
    const projectDirectory = await temporaryProject();
    await mkdir(join(projectDirectory, 'src'));
    await writeFile(
      join(projectDirectory, 'src', 'App.oxe'),
      `export App():
  count = 0

  increment():
    count = count + 1

  <main>
    <button onClick={increment}>Count: {count}
`,
      'utf8',
    );

    const result = await run(['build', '--project', projectDirectory]);

    expect(result).toMatchObject({ errors: [], exitCode: 0 });
    expect(result.logs).toEqual([`Built 1 artifact (app) to ${join(projectDirectory, 'dist')}.`]);
    const manifest: unknown = JSON.parse(
      await readFile(join(projectDirectory, 'dist', 'oxe-manifest.json'), 'utf8'),
    );
    expect(manifest).toMatchObject({
      artifacts: [
        {
          browserModule: 'app.js',
          deferredServerPlan: 'app.server-deferred.json',
          graph: 'app.graph.json',
          kind: 'app',
          moduleId: 'src/App.oxe',
          serverPlan: 'app.server.json',
        },
      ],
      entry: { exportName: 'App', moduleId: 'src/App.oxe' },
      localization: { enabled: false, synced: false, validationIssues: 0 },
      mode: 'app',
      schemaVersion: 'oxe.build-manifest.v1',
    });
    expect(await readFile(join(projectDirectory, 'dist', 'app.js'), 'utf8')).toContain(
      '//# sourceMappingURL=app.js.map',
    );
    await expect(readFile(join(projectDirectory, 'dist', 'app.js.map'), 'utf8')).resolves.toContain(
      'src/App.oxe',
    );
    await expect(
      readFile(join(projectDirectory, 'dist', 'app.graph.json'), 'utf8'),
    ).resolves.toContain('"schemaVersion": "oxe.ui-graph.v1"');
    await expect(
      readFile(join(projectDirectory, 'dist', 'app.server.json'), 'utf8'),
    ).resolves.toContain('"schemaVersion": "oxe.server-render-plan.v1"');
    await expect(
      readFile(join(projectDirectory, 'dist', 'app.server-deferred.json'), 'utf8'),
    ).resolves.toContain('"schemaVersion": "oxe.server-render-plan.v2"');

    const outputFiles = [
      'app.graph.json',
      'app.js',
      'app.js.map',
      'app.server-deferred.json',
      'app.server.json',
      'oxe-manifest.json',
    ];
    const firstBuild = await Promise.all(
      outputFiles.map((file) => readFile(join(projectDirectory, 'dist', file), 'utf8')),
    );
    await expect(run(['build', '--project', projectDirectory])).resolves.toMatchObject({
      errors: [],
      exitCode: 0,
    });
    const secondBuild = await Promise.all(
      outputFiles.map((file) => readFile(join(projectDirectory, 'dist', file), 'utf8')),
    );
    expect(secondBuild).toEqual(firstBuild);
  });

  it('discovers and compiles each unique filesystem route segment', async () => {
    const projectDirectory = await temporaryProject();
    const routesDirectory = join(projectDirectory, 'src', 'routes');
    await mkdir(join(routesDirectory, 'projects'), { recursive: true });
    await writeFile(
      join(routesDirectory, 'layout.oxe'),
      `export Layout():
  <main>
    {children}
`,
      'utf8',
    );
    await writeFile(
      join(routesDirectory, 'page.oxe'),
      `export Page():
  <h1>Home
`,
      'utf8',
    );
    await writeFile(
      join(routesDirectory, 'projects', 'page.oxe'),
      `export Page():
  <h1>Projects
`,
      'utf8',
    );

    const result = await run(['build', '--project', projectDirectory, '--base-path', '/dashboard']);

    expect(result).toMatchObject({ errors: [], exitCode: 0 });
    expect(result.logs).toEqual([
      `Built 3 artifacts (routes) to ${join(projectDirectory, 'dist')}.`,
    ]);
    const buildManifest: unknown = JSON.parse(
      await readFile(join(projectDirectory, 'dist', 'oxe-manifest.json'), 'utf8'),
    );
    expect(buildManifest).toMatchObject({
      artifacts: [
        { kind: 'layout', moduleId: 'src/routes/layout.oxe' },
        { kind: 'page', moduleId: 'src/routes/page.oxe' },
        { kind: 'page', moduleId: 'src/routes/projects/page.oxe' },
      ],
      mode: 'routes',
      routeManifest: 'route-manifest.json',
    });
    const routeManifest: unknown = JSON.parse(
      await readFile(join(projectDirectory, 'dist', 'route-manifest.json'), 'utf8'),
    );
    expect(routeManifest).toMatchObject({
      basePath: '/dashboard',
      routes: [{ pattern: '/projects' }, { pattern: '/' }],
      schemaVersion: 'oxe.route-manifest.v1',
    });
    await expect(
      access(join(projectDirectory, 'dist', 'modules', 'src', 'routes', 'layout.js')),
    ).resolves.toBeUndefined();
    await expect(
      access(join(projectDirectory, 'dist', 'modules', 'src', 'routes', 'projects', 'page.js')),
    ).resolves.toBeUndefined();
  });

  it('preserves the previous output when compilation fails', async () => {
    const projectDirectory = await temporaryProject();
    await mkdir(join(projectDirectory, 'dist'));
    await writeFile(join(projectDirectory, 'dist', 'keep.txt'), 'previous build\n', 'utf8');
    await writeFile(
      join(projectDirectory, 'App.oxe'),
      `export App():
  <main>{unknown}
`,
      'utf8',
    );

    const result = await run(['build', '--project', projectDirectory]);

    expect(result.exitCode).toBe(1);
    expect(result.errors.join('\n')).toContain('OXE2002');
    await expect(readFile(join(projectDirectory, 'dist', 'keep.txt'), 'utf8')).resolves.toBe(
      'previous build\n',
    );
  });

  it('resolves project paths from the CLI working directory and refuses to clean source', async () => {
    const directory = await temporaryProject();
    const projectDirectory = join(directory, 'project');
    await mkdir(join(projectDirectory, 'src'), { recursive: true });
    await writeFile(
      join(projectDirectory, 'src', 'App.oxe'),
      `export App():
  <main>Safe output
`,
      'utf8',
    );

    const result = await run(['build', '--project', 'project', '--out-dir', 'src'], directory);

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([
      'The output directory cannot contain OXE source files; src/App.oxe would be removed.',
    ]);
    await expect(readFile(join(projectDirectory, 'src', 'App.oxe'), 'utf8')).resolves.toContain(
      'Safe output',
    );
  });

  it('runs an explicit localization sync before building when requested', async () => {
    const projectDirectory = await temporaryProject();
    await writeFile(
      join(projectDirectory, 'oxe.config.json'),
      `${JSON.stringify({
        i18n: {
          locales: ['es'],
          source: 'en-US',
          translation: {
            apiKeyEnv: 'OXE_BUILD_TEST_KEY',
            model: 'gpt-test',
            provider: 'openai',
          },
        },
      })}\n`,
      'utf8',
    );
    await writeFile(
      join(projectDirectory, 'App.oxe'),
      `export App():
  <code i18n={false}>No translation request
`,
      'utf8',
    );

    const result = await run(['build', '--project', projectDirectory, '--sync-i18n']);

    expect(result).toMatchObject({ errors: [], exitCode: 0 });
    expect(result.logs.join('\n')).toContain('before build');
    expect(result.logs.join('\n')).toContain('Sync complete: 0 generated');
    const manifest: unknown = JSON.parse(
      await readFile(join(projectDirectory, 'dist', 'oxe-manifest.json'), 'utf8'),
    );
    expect(manifest).toMatchObject({
      localization: { enabled: true, synced: true, validationIssues: 0 },
    });
  });

  it('loads a working-directory .env without overriding the shell environment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oxe-cli-'));
    const projectDirectory = join(directory, 'project');
    await mkdir(projectDirectory);
    await writeFile(
      join(projectDirectory, 'oxe.config.json'),
      `${JSON.stringify({
        i18n: {
          locales: ['es'],
          source: 'en-US',
          translation: {
            apiKeyEnv: 'OXE_TEST_ENV_LOADED',
            model: 'gpt-test',
            provider: 'openai',
          },
        },
      })}\n`,
      'utf8',
    );
    await writeFile(join(projectDirectory, 'App.oxe'), 'App():\n  <code i18n={false}>Code\n');
    await writeFile(
      join(directory, '.env'),
      'OXE_TEST_ENV_LOADED=from-file\nOXE_TEST_ENV_PRESERVED=from-file\n',
    );
    delete process.env.OXE_TEST_ENV_LOADED;
    process.env.OXE_TEST_ENV_PRESERVED = 'from-shell';

    try {
      await expect(
        runCli(['i18n', 'sync', '--project', projectDirectory], {
          cwd: directory,
          io: { error: () => undefined, log: () => undefined },
        }),
      ).resolves.toBe(0);
      expect(process.env.OXE_TEST_ENV_LOADED).toBe('from-file');
      expect(process.env.OXE_TEST_ENV_PRESERVED).toBe('from-shell');
    } finally {
      delete process.env.OXE_TEST_ENV_LOADED;
      delete process.env.OXE_TEST_ENV_PRESERVED;
    }
  });
});
