import {
  access,
  glob,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, resolve, sep } from 'node:path';

import {
  analyzeProject,
  generateDomArtifact,
  type Diagnostic,
  type DomCodeArtifact,
} from '@oxe/compiler';
import { serializeUiGraph, type UiGraphV1 } from '@oxe/graph';
import { prepareI18nBuild, type PrepareI18nBuildResult, type SyncI18nOptions } from '@oxe/i18n';
import {
  createFileRouteManifest,
  type RouteManifestV1,
  type RouteSegmentDefinitionV1,
} from '@oxe/router';
import { createDeferredServerRenderPlan, createServerRenderPlan } from '@oxe/runtime-server';

export const OXE_BUILD_MANIFEST_SCHEMA = 'oxe.build-manifest.v1' as const;
const CONFIG_FILE = 'oxe.config.json';

export type BuildMode = 'app' | 'routes';
export type BuildArtifactKind = 'app' | 'layout' | 'page';

export interface BuildProjectOptions {
  readonly basePath?: string;
  readonly entryExport?: string;
  readonly entryModuleId?: string;
  readonly i18nSync?: Omit<SyncI18nOptions, 'projectDirectory'>;
  readonly outputDirectory?: string;
  readonly projectDirectory: string;
  readonly routesDirectory?: string;
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
  readonly artifacts: readonly BuildArtifactManifestV1[];
  readonly entry?: {
    readonly exportName: string;
    readonly moduleId: string;
  };
  readonly localization: {
    readonly enabled: boolean;
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

interface CompiledArtifact {
  readonly files: readonly OutputFile[];
  readonly manifest: BuildArtifactManifestV1;
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const prettyJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

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
  const hasLocalization = await hasFile(join(projectDirectory, CONFIG_FILE));
  const localization = hasLocalization
    ? await prepareI18nBuild({
        projectDirectory,
        ...(options.i18nSync ? { sync: options.i18nSync } : {}),
      })
    : undefined;
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
  const manifest: OxeBuildManifestV1 = {
    artifacts: compiled.map((artifact) => artifact.manifest),
    ...(entry ? { entry } : {}),
    localization: {
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
