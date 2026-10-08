import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

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
const execFileAsync = promisify(execFile);
const applicationFixture = new URL(
  '../../../examples/application-graph-todo/graph.json',
  import.meta.url,
);

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

  it('builds the authoritative application graph with explicit worker ownership', async () => {
    const projectDirectory = await temporaryProject();
    await copyFile(applicationFixture, join(projectDirectory, 'graph.json'));

    const separate = await run([
      'build',
      '--project',
      projectDirectory,
      '--application-graph',
      'graph.json',
      '--worker-mode',
      'separate',
    ]);

    expect(separate).toMatchObject({ errors: [], exitCode: 0 });
    expect(separate.logs).toEqual([
      `Built 20 artifacts (application) to ${join(projectDirectory, 'dist')}.`,
    ]);
    const manifest = JSON.parse(
      await readFile(join(projectDirectory, 'dist', 'oxe-manifest.json'), 'utf8'),
    ) as unknown;
    expect(manifest).toMatchObject({
      application: {
        appId: 'app.todo',
        browserAssets: 'browser/asset-manifest.json',
        deployment: {
          runtimeEntry: 'server/application.js',
          serverEntry: 'server/start.js',
          workerDeployment: 'separate',
          workerEntry: 'server/worker.js',
        },
        graph: 'application/graph.json',
        revision: 16,
      },
      artifacts: [],
      mode: 'application',
      schemaVersion: 'oxe.build-manifest.v1',
    });
    const browserAssetManifest = JSON.parse(
      await readFile(join(projectDirectory, 'dist', 'browser', 'asset-manifest.json'), 'utf8'),
    ) as {
      assets: { bytes: number; integrity: string; path: string }[];
      entries: { script: string; style?: string };
      schemaVersion: string;
    };
    expect(browserAssetManifest).toMatchObject({
      entries: { script: expect.stringMatching(/^assets\/start-[A-Z0-9]+\.js$/u) },
      schemaVersion: 'oxe.browser-asset-manifest.v1',
    });
    expect(browserAssetManifest.assets.length).toBeGreaterThan(0);
    for (const asset of browserAssetManifest.assets) {
      const contents = await readFile(join(projectDirectory, 'dist', 'browser', asset.path));
      expect(asset.bytes).toBe(contents.byteLength);
      expect(asset.integrity).toBe(`sha256:${createHash('sha256').update(contents).digest('hex')}`);
    }
    const browserShell = await readFile(
      join(projectDirectory, 'dist', 'browser', 'index.html'),
      'utf8',
    );
    expect(browserShell).toContain(`src="./${browserAssetManifest.entries.script}"`);
    expect(browserShell).not.toContain('src="./start.js"');
    await expect(
      readFile(
        join(projectDirectory, 'dist', 'browser', browserAssetManifest.entries.script),
        'utf8',
      ),
    ).resolves.not.toContain('Generated from the normalized OXE application graph');
    await expect(
      readFile(join(projectDirectory, 'dist', 'server', 'application.js'), 'utf8'),
    ).resolves.toContain("workerDeployment = 'separate'");
    await expect(
      readFile(join(projectDirectory, 'dist', 'server', 'worker.js'), 'utf8'),
    ).resolves.toContain('createPostgresApplicationJobWorker');
    await expect(
      readFile(join(projectDirectory, 'dist', 'application', 'graph.json'), 'utf8'),
    ).resolves.toContain('"format": "oxe.application-graph"');
    await execFileAsync(process.execPath, [
      '--check',
      join(projectDirectory, 'dist', 'server', 'application.js'),
    ]);
    await execFileAsync(process.execPath, [
      '--check',
      join(projectDirectory, 'dist', 'server', 'worker.js'),
    ]);
    await execFileAsync(process.execPath, [
      '--check',
      join(projectDirectory, 'dist', 'server', 'start.js'),
    ]);
    await execFileAsync(process.execPath, [
      '--check',
      join(projectDirectory, 'dist', 'database', 'migration.js'),
    ]);
    for (const browserModule of [
      'application-browser-host.js',
      'application-client-loader.js',
      'application-client-runtime.js',
      'clients/account-client.js',
      'clients/ownedTeam-client.js',
      'clients/team-client.js',
      'start.js',
    ])
      await execFileAsync(process.execPath, [
        '--check',
        join(projectDirectory, 'dist', 'browser', browserModule),
      ]);
    const accountModule: unknown = await import(
      `${pathToFileURL(join(projectDirectory, 'dist', 'browser', 'clients', 'account-client.js')).href}?test=${Date.now()}`
    );
    if (typeof accountModule !== 'object' || accountModule === null)
      throw new Error('Generated account client module is invalid.');
    const bootstrap: unknown = Reflect.get(accountModule, 'bootstrapApplicationClient');
    if (typeof bootstrap !== 'function')
      throw new Error('Generated account client has no bootstrap function.');
    let rpcCalls = 0;
    const fetchGeneratedClient: typeof globalThis.fetch = async (_input, init) => {
      if (init?.method === 'GET')
        return Response.json({
          activeContexts: [],
          schemaVersion: 'oxe.application-client-context.v1',
          userId: 'user.generated-test',
        });
      rpcCalls += 1;
      const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
      const functionId =
        typeof body === 'object' && body !== null && 'functionId' in body
          ? body.functionId
          : undefined;
      return Response.json({
        functionId,
        ok: true,
        schemaVersion: 'oxe.server-function-response.v1',
        value: [],
      });
    };
    const accountClient: unknown = await Reflect.apply(bootstrap, undefined, [
      { fetch: fetchGeneratedClient },
    ]);
    if (typeof accountClient !== 'object' || accountClient === null)
      throw new Error('Generated account client did not bootstrap.');
    const invitations: unknown = Reflect.get(accountClient, 'myTeamInvitations');
    if (typeof invitations !== 'function')
      throw new Error('Generated account client has no invitation query.');
    await expect(Reflect.apply(invitations, accountClient, [])).resolves.toEqual([]);
    await expect(Reflect.apply(invitations, accountClient, [])).resolves.toEqual([]);
    expect(rpcCalls).toBe(1);

    const embedded = await run([
      'build',
      '--project',
      projectDirectory,
      '--application-graph',
      'graph.json',
      '--out-dir',
      'dist-embedded',
    ]);
    expect(embedded.logs).toEqual([
      `Built 19 artifacts (application) to ${join(projectDirectory, 'dist-embedded')}.`,
    ]);
    await expect(
      readFile(join(projectDirectory, 'dist-embedded', 'server', 'application.js'), 'utf8'),
    ).resolves.toContain('createPostgresApplicationServerRuntime');
    await expect(
      access(join(projectDirectory, 'dist-embedded', 'server', 'worker.js')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      readFile(join(projectDirectory, 'dist-embedded', 'browser', 'asset-manifest.json'), 'utf8'),
    ).resolves.toBe(
      await readFile(join(projectDirectory, 'dist', 'browser', 'asset-manifest.json'), 'utf8'),
    );

    await expect(
      run([
        'build',
        '--project',
        projectDirectory,
        '--application-graph',
        'graph.json',
        '--worker-mode',
        'invalid',
      ]),
    ).resolves.toMatchObject({
      errors: ['--worker-mode must be embedded or separate.'],
      exitCode: 1,
    });
    await expect(
      run(['build', '--project', projectDirectory, '--worker-mode', 'separate']),
    ).resolves.toMatchObject({
      errors: ['--worker-mode requires --application-graph.'],
      exitCode: 1,
    });
    await expect(
      run([
        'build',
        '--project',
        projectDirectory,
        '--application-graph',
        'dist/application/graph.json',
      ]),
    ).resolves.toMatchObject({
      errors: ['The output directory cannot contain the authoritative application graph.'],
      exitCode: 1,
    });
  });

  it('integrity-checks and target-bundles application extensions', async () => {
    const projectDirectory = await temporaryProject();
    const extensionDirectory = join(projectDirectory, 'extensions');
    const packageDirectory = join(projectDirectory, 'node_modules', 'tiny-extension-package');
    await mkdir(extensionDirectory, { recursive: true });
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(
      join(projectDirectory, 'package.json'),
      JSON.stringify({ dependencies: { 'tiny-extension-package': '1.0.0' }, type: 'module' }),
      'utf8',
    );
    await writeFile(
      join(packageDirectory, 'package.json'),
      JSON.stringify({ exports: './index.js', name: 'tiny-extension-package', type: 'module' }),
      'utf8',
    );
    await writeFile(
      join(packageDirectory, 'index.js'),
      'export const decorate = (value) => `decorated:${value}`;\n',
      'utf8',
    );
    const serverSource = `import { decorate } from 'tiny-extension-package';
export const mailAdapter = { invoke() { return { deliveryId: decorate('delivery') }; } };
`;
    const browserSource = `import { decorate } from 'tiny-extension-package';
export const sparkline = { define(contract) { globalThis.__oxeExtensionProof = decorate(contract.id); } };
`;
    const cssSource = `oxe-sparkline { color: var(--color-accent); }\n`;
    await writeFile(join(extensionDirectory, 'mail.js'), serverSource, 'utf8');
    await writeFile(join(extensionDirectory, 'sparkline.js'), browserSource, 'utf8');
    await writeFile(join(extensionDirectory, 'theme.css'), cssSource, 'utf8');
    const integrity = (source: string): string =>
      `sha256:${createHash('sha256').update(source).digest('hex')}`;
    const graph = JSON.parse(await readFile(applicationFixture, 'utf8')) as Record<string, unknown>;
    graph.modules = [
      {
        format: 'javascript',
        id: 'module.mail',
        integrity: integrity(serverSource),
        kind: 'extensionModule',
        name: 'Mail adapter',
        packages: { 'tiny-extension-package': '1.0.0' },
        source: 'extensions/mail.js',
        target: 'server',
      },
      {
        format: 'javascript',
        id: 'module.sparkline',
        integrity: integrity(browserSource),
        kind: 'extensionModule',
        name: 'Sparkline component',
        packages: { 'tiny-extension-package': '1.0.0' },
        source: 'extensions/sparkline.js',
        target: 'browser',
      },
      {
        format: 'css',
        id: 'module.theme',
        integrity: integrity(cssSource),
        kind: 'extensionModule',
        name: 'Theme',
        source: 'extensions/theme.css',
        target: 'browser',
      },
    ];
    graph.capabilities = [
      {
        adapter: { export: 'mailAdapter', module: 'module.mail' },
        contract: 'example.mail',
        id: 'capability.mail',
        kind: 'capability',
        methods: {
          send: {
            input: { fields: {}, kind: 'record' },
            output: { fields: { deliveryId: { kind: 'string' } }, kind: 'record' },
          },
        },
        name: 'Mail',
        version: '1',
      },
    ];
    graph.components = [
      {
        children: 'none',
        id: 'component.sparkline',
        implementation: { export: 'sparkline', module: 'module.sparkline' },
        kind: 'componentExtension',
        name: 'Sparkline',
        props: { label: { kind: 'string' } },
        ssr: { tag: 'oxe-sparkline' },
      },
    ];
    graph.styles = [
      {
        id: 'style.application',
        kind: 'style',
        name: 'Application',
        stylesheets: ['module.theme'],
        tokens: { 'color-accent': '#0af' },
      },
    ];
    const views = graph.views as { tree: { children?: unknown[] } }[];
    const firstView = views[0];
    if (!firstView) throw new Error('Todo fixture has no view.');
    firstView.tree.children = [
      ...(firstView.tree.children ?? []),
      {
        component: 'component.sparkline',
        id: 'element.sparkline',
        kind: 'component',
        props: { label: { kind: 'literal', value: 'Weekly tasks' } },
      },
    ];
    await writeFile(join(projectDirectory, 'graph.json'), JSON.stringify(graph), 'utf8');

    const result = await run([
      'build',
      '--project',
      projectDirectory,
      '--application-graph',
      'graph.json',
    ]);
    expect(result).toMatchObject({ errors: [], exitCode: 0 });
    expect(result.logs).toEqual([
      `Built 25 artifacts (application) to ${join(projectDirectory, 'dist')}.`,
    ]);
    await expect(
      readFile(
        join(projectDirectory, 'dist', 'browser', 'extensions', 'module.sparkline.js'),
        'utf8',
      ),
    ).resolves.toMatch(/decorated:|decorate/u);
    await expect(
      readFile(join(projectDirectory, 'dist', 'server', 'extensions', 'module.mail.js'), 'utf8'),
    ).resolves.not.toContain("from 'tiny-extension-package'");
    await expect(
      readFile(join(projectDirectory, 'dist', 'browser', 'application.css'), 'utf8'),
    ).resolves.toContain('--color-accent: #0af');
    await import(
      `${pathToFileURL(join(projectDirectory, 'dist', 'browser', 'extensions.js')).href}?test=${Date.now()}`
    );
    expect(Reflect.get(globalThis, '__oxeExtensionProof')).toBe('decorated:component.sparkline');

    const modules = graph.modules as { id: string; integrity: string }[];
    const firstModule = modules[0];
    if (!firstModule) throw new Error('Extension fixture has no module.');
    firstModule.integrity = `sha256:${'f'.repeat(64)}`;
    await writeFile(join(projectDirectory, 'graph.json'), JSON.stringify(graph), 'utf8');
    await expect(
      run([
        'build',
        '--project',
        projectDirectory,
        '--application-graph',
        'graph.json',
        '--out-dir',
        'dist-invalid',
      ]),
    ).resolves.toMatchObject({
      errors: [expect.stringContaining('integrity mismatch')],
      exitCode: 1,
    });

    firstModule.integrity = integrity(serverSource);
    const localHelper = 'export const localDecorate = (value) => `local:${value}`;\n';
    const browserWithLocalSource = `import { decorate } from 'tiny-extension-package';
import { localDecorate } from './helper.js';
export const sparkline = { define(contract) { globalThis.__oxeExtensionProof = decorate(localDecorate(contract.id)); } };
`;
    await writeFile(join(extensionDirectory, 'helper.js'), localHelper, 'utf8');
    await writeFile(join(extensionDirectory, 'sparkline.js'), browserWithLocalSource, 'utf8');
    const browserModule = modules.find(({ id }) => id === 'module.sparkline');
    if (!browserModule) throw new Error('Extension fixture has no browser module.');
    browserModule.integrity = integrity(browserWithLocalSource);
    await writeFile(join(projectDirectory, 'graph.json'), JSON.stringify(graph), 'utf8');
    await expect(
      run([
        'build',
        '--project',
        projectDirectory,
        '--application-graph',
        'graph.json',
        '--out-dir',
        'dist-unpinned-local',
      ]),
    ).resolves.toMatchObject({
      errors: [expect.stringContaining('bundles undeclared local source')],
      exitCode: 1,
    });
    const declaredModules = graph.modules as Record<string, unknown>[];
    declaredModules.push({
      format: 'javascript',
      id: 'module.helper',
      integrity: integrity(localHelper),
      kind: 'extensionModule',
      name: 'Local helper',
      source: 'extensions/helper.js',
      target: 'server',
    });
    await writeFile(join(projectDirectory, 'graph.json'), JSON.stringify(graph), 'utf8');
    await expect(
      run([
        'build',
        '--project',
        projectDirectory,
        '--application-graph',
        'graph.json',
        '--out-dir',
        'dist-wrong-local-target',
      ]),
    ).resolves.toMatchObject({
      errors: [expect.stringContaining('imports target-incompatible module')],
      exitCode: 1,
    });
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

  it('emits locale-aware routes and independent active-locale catalog chunks', async () => {
    const projectDirectory = await temporaryProject();
    const routesDirectory = join(projectDirectory, 'src', 'routes');
    await mkdir(routesDirectory, { recursive: true });
    await writeFile(
      join(projectDirectory, 'oxe.config.json'),
      `${JSON.stringify({
        i18n: {
          locales: ['es', 'pt-BR'],
          onMissing: 'warn',
          source: 'en-US',
          translation: {
            apiKeyEnv: 'OXE_TEST_KEY',
            model: 'gpt-test',
            provider: 'openai',
          },
        },
      })}\n`,
      'utf8',
    );
    await mkdir(join(projectDirectory, 'locales'));
    await writeFile(
      join(projectDirectory, 'locales', 'es.json'),
      `${JSON.stringify({
        locale: 'es',
        messages: { 'home.title': 'Bienvenido' },
        schemaVersion: 'oxe.i18n.catalog.v2',
      })}\n`,
      'utf8',
    );
    await writeFile(
      join(projectDirectory, 'locales', 'pt-BR.json'),
      `${JSON.stringify({
        locale: 'pt-BR',
        messages: { 'home.title': 'Boas-vindas' },
        schemaVersion: 'oxe.i18n.catalog.v2',
      })}\n`,
      'utf8',
    );
    await writeFile(
      join(routesDirectory, 'page.oxe'),
      `export Page():
  <h1 i18n={{ key: "home.title" }}>Welcome
`,
      'utf8',
    );

    const result = await run(['build', '--project', projectDirectory]);

    expect(result).toMatchObject({ errors: [], exitCode: 0 });
    const routeManifest: unknown = JSON.parse(
      await readFile(join(projectDirectory, 'dist', 'route-manifest.json'), 'utf8'),
    );
    expect(routeManifest).toMatchObject({
      localization: {
        defaultLocale: 'en-US',
        locales: ['en-US', 'es', 'pt-BR'],
      },
    });
    const localizationManifest: unknown = JSON.parse(
      await readFile(join(projectDirectory, 'dist', 'localization-manifest.json'), 'utf8'),
    );
    expect(localizationManifest).toMatchObject({
      defaultLocale: 'en-US',
      locales: [
        { catalog: 'locales/en-US.json', locale: 'en-US', pathPrefix: '' },
        { catalog: 'locales/es.json', locale: 'es', pathPrefix: 'es' },
        { catalog: 'locales/pt-BR.json', locale: 'pt-BR', pathPrefix: 'pt-br' },
      ],
      schemaVersion: 'oxe.i18n.chunks.v1',
    });
    await expect(
      access(join(projectDirectory, 'dist', 'locales', 'pt-BR.json')),
    ).resolves.toBeUndefined();
    await expect(
      readFile(join(projectDirectory, 'dist', 'locales', 'es.json'), 'utf8'),
    ).resolves.toContain('Bienvenido');
    const browserModule = await readFile(
      join(projectDirectory, 'dist', 'modules', 'src', 'routes', 'page.js'),
      'utf8',
    );
    expect(browserModule).not.toContain('locales/es.json');
    expect(browserModule).not.toContain('locales/pt-BR.json');
    expect(browserModule).not.toContain('Bienvenido');
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
