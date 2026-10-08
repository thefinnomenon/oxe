import { createHash } from 'node:crypto';
import {
  access,
  glob,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';

import {
  ApplicationArtifactCache,
  analyzeProject,
  generateDomArtifact,
  type ApplicationWorkerDeploymentV1,
  type ApplicationCompiledExtensionModulesV1,
  type Diagnostic,
  type DomCodeArtifact,
} from '@oxe/compiler';
import {
  loadApplicationGraph,
  serializeUiGraph,
  type ApplicationGraphV1,
  type UiGraphV1,
} from '@oxe/graph';
import { build as buildWithEsbuild, type Plugin } from 'esbuild';
import {
  extractProjectMessages,
  I18N_CATALOG_SCHEMA,
  I18N_CHUNK_MANIFEST_SCHEMA,
  loadProjectConfig,
  prepareI18nBuild,
  readCatalog,
  type CatalogMessage,
  type LocaleCatalog,
  type LocaleCatalogChunkManifestV1,
  type OxeProjectConfig,
  type PrepareI18nBuildResult,
  type SyncI18nOptions,
} from '@oxe/i18n';
import {
  createFileRouteManifest,
  createRouteLocalization,
  localePathPrefix,
  type RouteManifestV1,
  type RouteSegmentDefinitionV1,
} from '@oxe/router';
import { createDeferredServerRenderPlan, createServerRenderPlan } from '@oxe/runtime-server';

export const OXE_BUILD_MANIFEST_SCHEMA = 'oxe.build-manifest.v1' as const;
const CONFIG_FILE = 'oxe.config.json';

export type BuildMode = 'app' | 'application' | 'routes';
export type BuildArtifactKind = 'app' | 'layout' | 'page';

export interface BuildProjectOptions {
  readonly applicationGraph?: string;
  readonly basePath?: string;
  readonly entryExport?: string;
  readonly entryModuleId?: string;
  readonly i18nSync?: Omit<SyncI18nOptions, 'projectDirectory'>;
  readonly outputDirectory?: string;
  readonly projectDirectory: string;
  readonly routesDirectory?: string;
  readonly workerDeployment?: ApplicationWorkerDeploymentV1;
}

export interface BuildArtifactManifestV1 {
  readonly browserModule: string;
  readonly browserSourceMap: string;
  readonly componentExport: string;
  readonly deferredServerPlan: string;
  readonly graph: string;
  readonly hydrateExport?: string;
  readonly kind: BuildArtifactKind;
  readonly moduleId: string;
  readonly mountExport: string;
  readonly routeSegmentExport?: string;
  readonly serverPlan: string;
}

export interface OxeBuildManifestV1 {
  readonly application?: {
    readonly appId: string;
    readonly artifacts: readonly {
      readonly id: string;
      readonly kind: string;
    }[];
    readonly deployment: {
      readonly runtimeEntry: string;
      readonly serverEntry: string;
      readonly workerDeployment: ApplicationWorkerDeploymentV1;
      readonly workerEntry?: string;
    };
    readonly browserAssets: string;
    readonly graph: string;
    readonly revision: number;
  };
  readonly artifacts: readonly BuildArtifactManifestV1[];
  readonly entry?: {
    readonly exportName: string;
    readonly moduleId: string;
  };
  readonly localization: {
    readonly defaultLocale?: string;
    readonly enabled: boolean;
    readonly locales?: readonly {
      readonly catalog: string;
      readonly locale: string;
      readonly pathPrefix: string;
    }[];
    readonly manifest?: string;
    readonly synced: boolean;
    readonly validationIssues: number;
  };
  readonly mode: BuildMode;
  readonly routeManifest?: string;
  readonly schemaVersion: typeof OXE_BUILD_MANIFEST_SCHEMA;
}

export interface BuildProjectResult {
  readonly manifest: OxeBuildManifestV1;
  readonly outputDirectory: string;
  readonly localization?: PrepareI18nBuildResult;
}

interface OutputFile {
  readonly contents: string;
  readonly path: string;
}

interface ApplicationBrowserAssetManifestV1 {
  readonly assets: readonly {
    readonly bytes: number;
    readonly integrity: `sha256:${string}`;
    readonly path: string;
  }[];
  readonly entries: {
    readonly script: string;
    readonly style?: string;
  };
  readonly schemaVersion: 'oxe.browser-asset-manifest.v1';
}

interface CompiledArtifact {
  readonly files: readonly OutputFile[];
  readonly manifest: BuildArtifactManifestV1;
}

interface VerifiedApplicationExtensionSource {
  readonly canonicalPath: string;
  readonly module: NonNullable<ApplicationGraphV1['modules']>[number];
  readonly sourcePath: string;
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const prettyJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const packageNameForSpecifier = (specifier: string): string | undefined => {
  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('#') ||
    specifier.startsWith('node:')
  )
    return undefined;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

const compileApplicationExtensions = async (
  graph: ApplicationGraphV1,
  projectDirectory: string,
): Promise<ApplicationCompiledExtensionModulesV1> => {
  const packageManifest = await readFile(resolve(projectDirectory, 'package.json'), 'utf8')
    .then((source) => JSON.parse(source) as unknown)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
  const projectPackages = (
    typeof packageManifest === 'object' && packageManifest !== null
      ? Object.assign(
          {},
          'dependencies' in packageManifest &&
            typeof packageManifest.dependencies === 'object' &&
            packageManifest.dependencies !== null
            ? packageManifest.dependencies
            : {},
          'devDependencies' in packageManifest &&
            typeof packageManifest.devDependencies === 'object' &&
            packageManifest.devDependencies !== null
            ? packageManifest.devDependencies
            : {},
          'optionalDependencies' in packageManifest &&
            typeof packageManifest.optionalDependencies === 'object' &&
            packageManifest.optionalDependencies !== null
            ? packageManifest.optionalDependencies
            : {},
        )
      : {}
  ) as Readonly<Record<string, unknown>>;
  const extensionSources = new Map<string, VerifiedApplicationExtensionSource>();
  const extensionSourcesByPath = new Map<string, VerifiedApplicationExtensionSource>();
  for (const module of graph.modules ?? []) {
    const sourcePath = resolve(projectDirectory, module.source);
    const canonicalPath = await realpath(sourcePath);
    const source = await readFile(sourcePath);
    const integrity = `sha256:${createHash('sha256').update(source).digest('hex')}`;
    if (integrity !== module.integrity)
      throw new Error(
        `Extension module ${JSON.stringify(module.id)} integrity mismatch: expected ${module.integrity}, received ${integrity}.`,
      );
    const entry = { canonicalPath, module, sourcePath };
    extensionSources.set(module.id, entry);
    extensionSourcesByPath.set(canonicalPath, entry);
  }
  const compiled: Record<string, { browser?: string; server?: string }> = {};
  for (const module of [...(graph.modules ?? [])].sort((left, right) =>
    compareText(left.id, right.id),
  )) {
    const extensionSource = extensionSources.get(module.id);
    if (!extensionSource)
      throw new Error(`Extension module ${JSON.stringify(module.id)} has no verified source.`);
    const { canonicalPath: canonicalSourcePath, sourcePath } = extensionSource;
    const directPackages = new Set<string>();
    const directImports: Plugin = {
      name: 'oxe-extension-direct-imports',
      setup(build) {
        build.onResolve({ filter: /.*/ }, async (arguments_) => {
          if (!arguments_.importer) return undefined;
          const canonicalImporter = await realpath(arguments_.importer).catch(() =>
            resolve(arguments_.importer),
          );
          if (canonicalImporter !== canonicalSourcePath) return undefined;
          const packageName = packageNameForSpecifier(arguments_.path);
          if (packageName) directPackages.add(packageName);
          return undefined;
        });
      },
    };
    const compile = async (target: 'browser' | 'server'): Promise<string> => {
      const result = await buildWithEsbuild({
        absWorkingDir: projectDirectory,
        bundle: true,
        entryPoints: [sourcePath],
        format: 'esm',
        logLevel: 'silent',
        metafile: true,
        outdir: 'out',
        platform: target === 'browser' ? 'browser' : 'node',
        plugins: [directImports],
        sourcemap: false,
        target: 'es2022',
        write: false,
      });
      const output = result.outputFiles.find((file) =>
        file.path.endsWith(module.format === 'css' ? '.css' : '.js'),
      );
      if (!output)
        throw new Error(`Extension module ${JSON.stringify(module.id)} produced no output.`);
      for (const input of Object.keys(result.metafile.inputs)) {
        const canonicalInput = await realpath(resolve(projectDirectory, input));
        if (canonicalInput === canonicalSourcePath || canonicalInput.includes('/node_modules/'))
          continue;
        const dependency = extensionSourcesByPath.get(canonicalInput);
        if (!dependency)
          throw new Error(
            `Extension module ${JSON.stringify(module.id)} bundles undeclared local source ${JSON.stringify(input)}. Declare it as an integrity-pinned extensionModule.`,
          );
        if (
          (target === 'browser' && dependency.module.target === 'server') ||
          (target === 'server' && dependency.module.target === 'browser')
        )
          throw new Error(
            `Extension module ${JSON.stringify(module.id)} imports target-incompatible module ${JSON.stringify(dependency.module.id)}.`,
          );
      }
      return output.text;
    };
    const outputs: { browser?: string; server?: string } = {};
    if (module.target !== 'server') outputs.browser = await compile('browser');
    if (module.target !== 'browser') outputs.server = await compile('server');
    const declaredPackages = new Set(Object.keys(module.packages ?? {}));
    for (const [packageName, version] of Object.entries(module.packages ?? {}).sort(
      ([left], [right]) => compareText(left, right),
    ))
      if (projectPackages[packageName] !== version)
        throw new Error(
          `Extension module ${JSON.stringify(module.id)} requires ${packageName}@${version} in the project package.json.`,
        );
    for (const packageName of [...directPackages].sort(compareText))
      if (!declaredPackages.has(packageName))
        throw new Error(
          `Extension module ${JSON.stringify(module.id)} imports undeclared package ${JSON.stringify(packageName)}.`,
        );
    for (const packageName of [...declaredPackages].sort(compareText))
      if (!directPackages.has(packageName))
        throw new Error(
          `Extension module ${JSON.stringify(module.id)} declares unused package ${JSON.stringify(packageName)}.`,
        );
    compiled[module.id] = outputs;
  }
  return compiled;
};

const compileApplicationBrowserAssets = async (
  artifacts: readonly { readonly contents: string; readonly id: string }[],
  projectDirectory: string,
): Promise<{
  readonly files: readonly OutputFile[];
  readonly manifest: ApplicationBrowserAssetManifestV1;
}> => {
  const browserSources = artifacts.filter(({ id }) => id.startsWith('browser/'));
  const sourceById = new Map(browserSources.map(({ contents, id }) => [id, contents]));
  const startSource = sourceById.get('browser/start.js');
  const shellSource = sourceById.get('browser/index.html');
  if (!startSource || !shellSource)
    throw new Error(
      'Application browser projection requires browser/start.js and browser/index.html.',
    );

  const staging = await mkdtemp(join(projectDirectory, '.oxe-browser-assets-'));
  const sourceDirectory = join(staging, 'browser');
  const outputDirectory = join(staging, 'assets');
  try {
    for (const source of browserSources) {
      const target = resolve(staging, source.id);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source.contents, 'utf8');
    }
    const entryPoints: Record<string, string> = { start: join(sourceDirectory, 'start.js') };
    if (sourceById.has('browser/application.css'))
      entryPoints.application = join(sourceDirectory, 'application.css');
    const result = await buildWithEsbuild({
      absWorkingDir: sourceDirectory,
      assetNames: 'asset-[hash]',
      bundle: true,
      chunkNames: 'chunk-[hash]',
      entryNames: '[name]-[hash]',
      entryPoints,
      format: 'esm',
      logLevel: 'silent',
      minify: true,
      outdir: outputDirectory,
      platform: 'browser',
      sourcemap: false,
      splitting: true,
      target: 'es2022',
      write: false,
    });
    const files = result.outputFiles
      .map((file): OutputFile => ({
        contents: file.text,
        path: `browser/assets/${relative(outputDirectory, file.path).split(sep).join('/')}`,
      }))
      .sort((left, right) => compareText(left.path, right.path));
    const script = files.find(({ path }) => /\/start-[A-Z0-9]+\.js$/iu.test(path));
    const style = files.find(({ path }) => /\/application-[A-Z0-9]+\.css$/iu.test(path));
    if (!script) throw new Error('Application browser projection produced no script entry.');
    const manifest: ApplicationBrowserAssetManifestV1 = {
      assets: files.map(({ contents, path }) => ({
        bytes: Buffer.byteLength(contents),
        integrity: `sha256:${createHash('sha256').update(contents).digest('hex')}`,
        path: path.slice('browser/'.length),
      })),
      entries: {
        script: script.path.slice('browser/'.length),
        ...(style ? { style: style.path.slice('browser/'.length) } : {}),
      },
      schemaVersion: 'oxe.browser-asset-manifest.v1',
    };
    const shell = shellSource
      .replace('./start.js', `./${manifest.entries.script}`)
      .replace(
        './application.css',
        manifest.entries.style ? `./${manifest.entries.style}` : './application.css',
      );
    return {
      files: [
        ...files,
        { contents: prettyJson(manifest), path: 'browser/asset-manifest.json' },
        { contents: shell, path: 'browser/index.html' },
      ],
      manifest,
    };
  } finally {
    await rm(staging, { force: true, recursive: true });
  }
};

const localizedBuildFiles = async (
  config: OxeProjectConfig,
): Promise<{
  readonly files: readonly OutputFile[];
  readonly manifest: LocaleCatalogChunkManifestV1;
}> => {
  const extracted = await extractProjectMessages(config);
  if (extracted.diagnostics.length > 0) {
    throw new Error(
      `Localization extraction failed:\n${extracted.diagnostics
        .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        .join('\n')}`,
    );
  }
  const locales = [config.i18n.source, ...config.i18n.locales];
  const existing = new Map(
    await Promise.all(
      locales.map(
        async (locale) =>
          [locale, await readCatalog(config.i18n.catalogDirectory, locale)] as const,
      ),
    ),
  );
  const sourceCatalog = existing.get(config.i18n.source);
  const sourceMessage = (
    id: string,
    source: string,
    selection: 'cardinal' | 'ordinal' | undefined,
  ): CatalogMessage =>
    sourceCatalog?.messages[id] ??
    (selection ? { cases: { other: source }, kind: selection } : source);
  const routeLocalization = createRouteLocalization(config.i18n.source, config.i18n.locales);
  const chunks = locales.map((locale) => ({
    catalog: `locales/${locale}.json`,
    locale,
    pathPrefix: localePathPrefix(routeLocalization, locale),
  }));
  const files = locales.map((locale): OutputFile => {
    const catalog = existing.get(locale);
    const messages = Object.fromEntries(
      extracted.messages.map((message) => [
        message.id,
        catalog?.messages[message.id] ??
          sourceMessage(message.id, message.source, message.selection?.kind),
      ]),
    );
    const emitted: LocaleCatalog = {
      locale,
      messages,
      schemaVersion: I18N_CATALOG_SCHEMA,
    };
    return { contents: prettyJson(emitted), path: `locales/${locale}.json` };
  });
  const manifest: LocaleCatalogChunkManifestV1 = {
    defaultLocale: config.i18n.source,
    locales: chunks,
    schemaVersion: I18N_CHUNK_MANIFEST_SCHEMA,
  };
  return {
    files: [...files, { contents: prettyJson(manifest), path: 'localization-manifest.json' }],
    manifest,
  };
};

const normalizeProjectPath = (value: string, description: string): string => {
  if (value.length === 0 || isAbsolute(value) || value.includes('\\')) {
    throw new TypeError(`${description} must be a project-relative POSIX path.`);
  }
  const normalized = posix.normalize(value).replace(/^\.\//u, '');
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new TypeError(`${description} must stay inside the project directory.`);
  }
  return normalized;
};

const outputPath = (value: string): string => normalizeProjectPath(value, 'The output directory');

const validateOutputLocation = (
  relativeOutputDirectory: string,
  modules: readonly string[],
): void => {
  const prefix = `${relativeOutputDirectory}/`;
  const containedSource = modules.find(
    (moduleId) => moduleId === relativeOutputDirectory || moduleId.startsWith(prefix),
  );
  if (containedSource) {
    throw new TypeError(
      `The output directory cannot contain OXE source files; ${containedSource} would be removed.`,
    );
  }
  const firstSegment = relativeOutputDirectory.split('/')[0];
  if (firstSegment === '.git' || firstSegment === 'node_modules') {
    throw new TypeError(`The output directory cannot target ${firstSegment}.`);
  }
};

const sourceMapFor = (artifact: DomCodeArtifact, browserModule: string): string =>
  prettyJson({ ...artifact.moduleSourceMap, file: posix.basename(browserModule) });

const sourceWithMap = (artifact: DomCodeArtifact, browserSourceMap: string): string =>
  `${artifact.moduleSource}//# sourceMappingURL=${posix.basename(browserSourceMap)}\n`;

const diagnosticText = (diagnostic: Diagnostic): string => {
  const location = `${diagnostic.span.fileName}:${diagnostic.span.start.line}:${diagnostic.span.start.column}`;
  const related = (diagnostic.related ?? [])
    .map(
      (item) =>
        `  ${item.span.fileName}:${item.span.start.line}:${item.span.start.column} ${item.message}`,
    )
    .join('\n');
  return `${location} ${diagnostic.code} ${diagnostic.message}${related ? `\n${related}` : ''}`;
};

const hasFile = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
};

const collectProjectModules = async (projectDirectory: string): Promise<readonly string[]> => {
  const files: string[] = [];
  for await (const file of glob('**/*.oxe', {
    cwd: projectDirectory,
    exclude: ['**/.git/**', '**/dist/**', '**/dist-typecheck/**', '**/node_modules/**'],
  })) {
    files.push(file.split(sep).join('/'));
  }
  return [...new Set(files)].sort(compareText);
};

const loadProjectModule =
  (projectDirectory: string) =>
  async (moduleId: string): Promise<string | undefined> => {
    try {
      return await readFile(resolve(projectDirectory, moduleId), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  };

const compileGraph = async (
  projectDirectory: string,
  localization: boolean,
  entryModuleId: string,
  entryExport: string,
  routeSegment?: 'layout' | 'page',
): Promise<UiGraphV1> => {
  const result = await analyzeProject({
    entryExport,
    entryModuleId,
    loadModule: loadProjectModule(projectDirectory),
    localization,
    ...(routeSegment ? { routeSegment } : {}),
  });
  if (!result.graph) {
    const details = result.diagnostics.map(diagnosticText).join('\n');
    throw new Error(`OXE compilation failed${details ? `:\n${details}` : '.'}`);
  }
  return result.graph;
};

const artifactPrefix = (kind: BuildArtifactKind, moduleId: string): string =>
  kind === 'app' ? 'app' : `modules/${moduleId.slice(0, -'.oxe'.length)}`;

const compileArtifact = async (options: {
  readonly entryExport: string;
  readonly kind: BuildArtifactKind;
  readonly localization: boolean;
  readonly moduleId: string;
  readonly projectDirectory: string;
}): Promise<CompiledArtifact> => {
  const routeSegment = options.kind === 'app' ? undefined : options.kind;
  const graph = await compileGraph(
    options.projectDirectory,
    options.localization,
    options.moduleId,
    options.entryExport,
    routeSegment,
  );
  const artifact = generateDomArtifact(graph, routeSegment ? { routeSegment } : {});
  const prefix = artifactPrefix(options.kind, options.moduleId);
  const browserModule = `${prefix}.js`;
  const browserSourceMap = `${browserModule}.map`;
  const graphPath = `${prefix}.graph.json`;
  const serverPlan = `${prefix}.server.json`;
  const deferredServerPlan = `${prefix}.server-deferred.json`;
  return {
    files: [
      { contents: sourceWithMap(artifact, browserSourceMap), path: browserModule },
      { contents: sourceMapFor(artifact, browserModule), path: browserSourceMap },
      { contents: serializeUiGraph(graph), path: graphPath },
      { contents: prettyJson(createServerRenderPlan(graph)), path: serverPlan },
      { contents: prettyJson(createDeferredServerRenderPlan(graph)), path: deferredServerPlan },
    ],
    manifest: {
      browserModule,
      browserSourceMap,
      componentExport: artifact.componentExport,
      deferredServerPlan,
      graph: graphPath,
      ...(artifact.hydrateExport ? { hydrateExport: artifact.hydrateExport } : {}),
      kind: options.kind,
      moduleId: options.moduleId,
      mountExport: artifact.mountExport,
      ...(artifact.routeSegmentExport ? { routeSegmentExport: artifact.routeSegmentExport } : {}),
      serverPlan,
    },
  };
};

const uniqueSegments = (manifest: RouteManifestV1): readonly RouteSegmentDefinitionV1[] =>
  [
    ...new Map(
      manifest.routes.flatMap((route) => route.segments).map((segment) => [segment.id, segment]),
    ).values(),
  ].sort(
    (left, right) =>
      compareText(left.moduleId, right.moduleId) || compareText(left.kind, right.kind),
  );

const selectMode = (
  modules: readonly string[],
  options: BuildProjectOptions,
  routesDirectory: string,
): BuildMode => {
  if (options.routesDirectory !== undefined) return 'routes';
  if (options.entryModuleId !== undefined || options.entryExport !== undefined) return 'app';
  const prefix = `${routesDirectory}/`;
  return modules.some(
    (moduleId) => moduleId.startsWith(prefix) && moduleId.endsWith('/page.oxe'),
  ) || modules.includes(`${routesDirectory}/page.oxe`)
    ? 'routes'
    : 'app';
};

const defaultEntry = (modules: readonly string[]): string =>
  modules.includes('src/App.oxe') ? 'src/App.oxe' : 'App.oxe';

const writeOutput = async (
  projectDirectory: string,
  relativeOutputDirectory: string,
  files: readonly OutputFile[],
): Promise<string> => {
  const destination = resolve(projectDirectory, relativeOutputDirectory);
  const parent = dirname(destination);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, `.${posix.basename(relativeOutputDirectory)}-oxe-`));
  try {
    for (const file of [...files].sort((left, right) => compareText(left.path, right.path))) {
      const target = resolve(staging, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.contents, 'utf8');
    }
    await rm(destination, { force: true, recursive: true });
    await rename(staging, destination);
  } catch (error) {
    await rm(staging, { force: true, recursive: true });
    throw error;
  }
  return destination;
};

export const buildProject = async (options: BuildProjectOptions): Promise<BuildProjectResult> => {
  const projectDirectory = resolve(options.projectDirectory);
  const projectStats = await stat(projectDirectory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      throw new Error(`Project directory ${projectDirectory} does not exist.`);
    }
    throw error;
  });
  if (!projectStats.isDirectory()) {
    throw new TypeError(`Project path ${projectDirectory} is not a directory.`);
  }

  const modules = await collectProjectModules(projectDirectory);
  const routesDirectory = normalizeProjectPath(
    options.routesDirectory ?? 'src/routes',
    'The routes directory',
  );
  const relativeOutputDirectory = outputPath(options.outputDirectory ?? 'dist');
  validateOutputLocation(relativeOutputDirectory, modules);
  if (options.applicationGraph !== undefined) {
    if (
      options.basePath !== undefined ||
      options.entryExport !== undefined ||
      options.entryModuleId !== undefined ||
      options.routesDirectory !== undefined ||
      options.i18nSync !== undefined
    )
      throw new TypeError(
        'Application graph builds cannot be combined with UI entry, route, or localization options.',
      );
    const graphPath = normalizeProjectPath(options.applicationGraph, 'The application graph');
    if (!graphPath.endsWith('.json'))
      throw new TypeError('The application graph must be a JSON file.');
    if (
      graphPath === relativeOutputDirectory ||
      graphPath.startsWith(`${relativeOutputDirectory}/`)
    )
      throw new TypeError(
        'The output directory cannot contain the authoritative application graph.',
      );
    let graph: ApplicationGraphV1;
    try {
      graph = loadApplicationGraph(
        JSON.parse(await readFile(resolve(projectDirectory, graphPath), 'utf8')) as unknown,
      );
    } catch (error) {
      throw new Error(
        `Application graph build failed for ${graphPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const workerDeployment = options.workerDeployment ?? 'embedded';
    const extensions = await compileApplicationExtensions(graph, projectDirectory);
    const compilation = new ApplicationArtifactCache().compile(graph, {
      extensions,
      workerDeployment,
    });
    const browserProjection = await compileApplicationBrowserAssets(
      compilation.artifacts,
      projectDirectory,
    );
    const application = {
      appId: graph.app.id,
      artifacts: compilation.artifacts.map(({ id, kind }) => ({ id, kind })),
      browserAssets: 'browser/asset-manifest.json',
      deployment: {
        runtimeEntry: 'server/application.js',
        serverEntry: 'server/start.js',
        workerDeployment,
        ...(workerDeployment === 'separate' ? { workerEntry: 'server/worker.js' } : {}),
      },
      graph: 'application/graph.json',
      revision: graph.revision,
    } as const;
    const manifest: OxeBuildManifestV1 = {
      application,
      artifacts: [],
      localization: {
        enabled: false,
        synced: false,
        validationIssues: 0,
      },
      mode: 'application',
      schemaVersion: OXE_BUILD_MANIFEST_SCHEMA,
    };
    const projectedPaths = new Set(browserProjection.files.map(({ path }) => path));
    const outputFiles = compilation.artifacts
      .filter(({ id }) => !projectedPaths.has(id))
      .map(({ contents, id }) => ({ contents, path: id }));
    outputFiles.push(...browserProjection.files);
    outputFiles.push({ contents: prettyJson(manifest), path: 'oxe-manifest.json' });
    return {
      manifest,
      outputDirectory: await writeOutput(projectDirectory, relativeOutputDirectory, outputFiles),
    };
  }
  if (options.workerDeployment !== undefined)
    throw new TypeError('--worker-mode requires --application-graph.');
  const hasLocalization = await hasFile(join(projectDirectory, CONFIG_FILE));
  const localization = hasLocalization
    ? await prepareI18nBuild({
        projectDirectory,
        ...(options.i18nSync ? { sync: options.i18nSync } : {}),
      })
    : undefined;
  const projectConfig = hasLocalization ? await loadProjectConfig(projectDirectory) : undefined;
  const localizedOutput = projectConfig ? await localizedBuildFiles(projectConfig) : undefined;
  if (!hasLocalization && options.i18nSync) {
    throw new Error(`Cannot sync localization without ${CONFIG_FILE} in ${projectDirectory}.`);
  }

  const mode = selectMode(modules, options, routesDirectory);
  const outputFiles: OutputFile[] = [];
  let compiled: readonly CompiledArtifact[];
  let routeManifest: RouteManifestV1 | undefined;
  let entry: OxeBuildManifestV1['entry'];

  if (mode === 'routes') {
    if (options.entryModuleId !== undefined || options.entryExport !== undefined) {
      throw new TypeError('Route builds cannot be combined with --entry or --export.');
    }
    routeManifest = createFileRouteManifest(modules, {
      ...(options.basePath ? { basePath: options.basePath } : {}),
      ...(projectConfig
        ? {
            localization: {
              defaultLocale: projectConfig.i18n.source,
              locales: projectConfig.i18n.locales,
            },
          }
        : {}),
      routesDirectory,
    });
    compiled = await Promise.all(
      uniqueSegments(routeManifest).map((segment) =>
        compileArtifact({
          entryExport: segment.exportName,
          kind: segment.kind,
          localization: hasLocalization,
          moduleId: segment.moduleId,
          projectDirectory,
        }),
      ),
    );
    outputFiles.push({ contents: prettyJson(routeManifest), path: 'route-manifest.json' });
  } else {
    if (options.basePath !== undefined) {
      throw new TypeError('--base-path is available only for route builds.');
    }
    const entryModuleId = normalizeProjectPath(
      options.entryModuleId ?? defaultEntry(modules),
      'The entry module',
    );
    if (!entryModuleId.endsWith('.oxe')) {
      throw new TypeError('The entry module must end in .oxe.');
    }
    const entryExport = options.entryExport ?? 'App';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(entryExport)) {
      throw new TypeError('The entry export must be an identifier.');
    }
    compiled = [
      await compileArtifact({
        entryExport,
        kind: 'app',
        localization: hasLocalization,
        moduleId: entryModuleId,
        projectDirectory,
      }),
    ];
    entry = { exportName: entryExport, moduleId: entryModuleId };
  }

  for (const artifact of compiled) outputFiles.push(...artifact.files);
  if (localizedOutput) outputFiles.push(...localizedOutput.files);
  const manifest: OxeBuildManifestV1 = {
    artifacts: compiled.map((artifact) => artifact.manifest),
    ...(entry ? { entry } : {}),
    localization: {
      ...(localizedOutput
        ? {
            defaultLocale: localizedOutput.manifest.defaultLocale,
            locales: localizedOutput.manifest.locales,
            manifest: 'localization-manifest.json',
          }
        : {}),
      enabled: hasLocalization,
      synced: localization?.sync !== undefined,
      validationIssues: localization?.validation.issues.length ?? 0,
    },
    mode,
    ...(routeManifest ? { routeManifest: 'route-manifest.json' } : {}),
    schemaVersion: OXE_BUILD_MANIFEST_SCHEMA,
  };
  outputFiles.push({ contents: prettyJson(manifest), path: 'oxe-manifest.json' });
  const outputDirectory = await writeOutput(projectDirectory, relativeOutputDirectory, outputFiles);
  return {
    manifest,
    outputDirectory,
    ...(localization ? { localization } : {}),
  };
};
