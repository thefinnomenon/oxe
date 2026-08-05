import { loadEnvFile } from 'node:process';
import { join, resolve } from 'node:path';

import {
  createOpenAITranslationProvider,
  loadProjectConfig,
  syncI18n,
  type SyncProgress,
  validateI18n,
} from '@oxe/i18n';

import { buildProject, type BuildProjectOptions, type BuildProjectResult } from './build.js';

export {
  buildProject,
  OXE_BUILD_MANIFEST_SCHEMA,
  type BuildArtifactManifestV1,
  type BuildArtifactKind,
  type BuildMode,
  type BuildProjectOptions,
  type BuildProjectResult,
  type OxeBuildManifestV1,
} from './build.js';

export interface CliIo {
  readonly error: (message: string) => void;
  readonly log: (message: string) => void;
}

export interface RunCliOptions {
  readonly cwd: string;
  readonly io: CliIo;
}

interface ParsedOptions {
  readonly projectDirectory: string;
  readonly workingDirectory: string;
}

interface ParsedBuildOptions extends ParsedOptions {
  readonly basePath?: string;
  readonly entryExport?: string;
  readonly entryModuleId?: string;
  readonly outputDirectory?: string;
  readonly routesDirectory?: string;
  readonly syncI18n: boolean;
}

const usage = `OXE command line

Usage:
  oxe build [--project PATH] [--entry FILE] [--export NAME] [--out-dir PATH]
            [--routes-dir PATH] [--base-path PATH] [--sync-i18n]
  oxe i18n sync [--project PATH]
  oxe i18n check [--project PATH]

Build emits browser modules, source maps, semantic graphs, blocking and deferred
server plans, and a versioned build manifest. Filesystem routes beneath
src/routes are detected automatically. Localization validation never uses the
network; generation occurs only with --sync-i18n or an explicit i18n sync. API
keys are read from .env or the environment variable named in oxe.config.json and
are never stored in catalogs.`;

const parseOptions = (arguments_: readonly string[], cwd: string): ParsedOptions => {
  let projectDirectory = cwd;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--project') {
      const value = arguments_[index + 1];
      if (!value) {
        throw new TypeError(`${argument} requires a path.`);
      }
      projectDirectory = resolve(cwd, value);
      index += 1;
      continue;
    }
    throw new TypeError(`Unknown option ${argument}.`);
  }
  return { projectDirectory, workingDirectory: cwd };
};

const parseBuildOptions = (arguments_: readonly string[], cwd: string): ParsedBuildOptions => {
  let projectDirectory = cwd;
  let basePath: string | undefined;
  let entryExport: string | undefined;
  let entryModuleId: string | undefined;
  let outputDirectory: string | undefined;
  let routesDirectory: string | undefined;
  let syncI18n = false;
  const values = new Map<string, (value: string) => void>([
    ['--base-path', (value) => (basePath = value)],
    ['--entry', (value) => (entryModuleId = value)],
    ['--export', (value) => (entryExport = value)],
    ['--out-dir', (value) => (outputDirectory = value)],
    ['--project', (value) => (projectDirectory = resolve(cwd, value))],
    ['--routes-dir', (value) => (routesDirectory = value)],
  ]);
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--sync-i18n') {
      syncI18n = true;
      continue;
    }
    const assign = argument ? values.get(argument) : undefined;
    if (!assign) {
      throw new TypeError(`Unknown option ${argument}.`);
    }
    const value = arguments_[index + 1];
    if (!value) {
      throw new TypeError(`${argument} requires a value.`);
    }
    assign(value);
    index += 1;
  }
  return {
    ...(basePath === undefined ? {} : { basePath }),
    ...(entryExport === undefined ? {} : { entryExport }),
    ...(entryModuleId === undefined ? {} : { entryModuleId }),
    ...(outputDirectory === undefined ? {} : { outputDirectory }),
    projectDirectory,
    ...(routesDirectory === undefined ? {} : { routesDirectory }),
    syncI18n,
    workingDirectory: cwd,
  };
};

const loadEnvironmentFile = (directory: string): void => {
  try {
    loadEnvFile(join(directory, '.env'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`Could not load ${join(directory, '.env')}: ${(error as Error).message}`);
    }
  }
};

const runSync = async (parsed: ParsedOptions, io: CliIo): Promise<number> => {
  const config = await loadProjectConfig(parsed.projectDirectory);
  loadEnvironmentFile(config.projectDirectory);
  if (resolve(parsed.workingDirectory) !== config.projectDirectory) {
    loadEnvironmentFile(resolve(parsed.workingDirectory));
  }
  const provider = createOpenAITranslationProvider({
    apiKeyEnv: config.i18n.translation.apiKeyEnv,
    model: config.i18n.translation.model,
  });
  io.log(
    `Syncing ${config.i18n.locales.length} locale(s) from ${config.i18n.source} with OpenAI ${provider.model}...`,
  );
  const result = await syncI18n({
    onProgress(progress: SyncProgress) {
      if (progress.phase === 'translate' && progress.total > 0) {
        io.log(`${progress.locale}: ${progress.completed}/${progress.total} messages translated`);
      }
    },
    projectDirectory: config.projectDirectory,
    provider,
  });
  io.log(
    `Sync complete: ${result.generated} generated, ${result.unchanged} unchanged, ${result.preservedReviewed} reviewed preserved.`,
  );
  return 0;
};

const runCheck = async (parsed: ParsedOptions, io: CliIo): Promise<number> => {
  const config = await loadProjectConfig(parsed.projectDirectory);
  const result = await validateI18n(config.projectDirectory);
  if (result.valid) {
    io.log('Localization catalogs are complete and current.');
    return 0;
  }
  for (const issue of result.issues) {
    io.error(`${issue.locale} ${issue.id}: ${issue.message}`);
  }
  if (config.i18n.onMissing === 'error') {
    return 1;
  }
  io.log(
    config.i18n.onMissing === 'source'
      ? 'Build may continue with source-language fallback.'
      : 'Build may continue with localization warnings.',
  );
  return 0;
};

const buildOptions = async (
  parsed: ParsedBuildOptions,
  io: CliIo,
): Promise<BuildProjectOptions> => {
  const common: BuildProjectOptions = {
    ...(parsed.basePath === undefined ? {} : { basePath: parsed.basePath }),
    ...(parsed.entryExport === undefined ? {} : { entryExport: parsed.entryExport }),
    ...(parsed.entryModuleId === undefined ? {} : { entryModuleId: parsed.entryModuleId }),
    ...(parsed.outputDirectory === undefined ? {} : { outputDirectory: parsed.outputDirectory }),
    projectDirectory: parsed.projectDirectory,
    ...(parsed.routesDirectory === undefined ? {} : { routesDirectory: parsed.routesDirectory }),
  };
  if (!parsed.syncI18n) return common;

  const config = await loadProjectConfig(parsed.projectDirectory);
  loadEnvironmentFile(config.projectDirectory);
  if (resolve(parsed.workingDirectory) !== config.projectDirectory) {
    loadEnvironmentFile(resolve(parsed.workingDirectory));
  }
  const provider = createOpenAITranslationProvider({
    apiKeyEnv: config.i18n.translation.apiKeyEnv,
    model: config.i18n.translation.model,
  });
  io.log(
    `Syncing ${config.i18n.locales.length} locale(s) from ${config.i18n.source} with OpenAI ${provider.model} before build...`,
  );
  return {
    ...common,
    i18nSync: {
      onProgress(progress: SyncProgress) {
        if (progress.phase === 'translate' && progress.total > 0) {
          io.log(`${progress.locale}: ${progress.completed}/${progress.total} messages translated`);
        }
      },
      provider,
    },
  };
};

const reportBuild = (result: BuildProjectResult, io: CliIo): void => {
  for (const issue of result.localization?.validation.issues ?? []) {
    io.log(`Localization warning: ${issue.locale} ${issue.id}: ${issue.message}`);
  }
  if (result.localization?.sync) {
    const sync = result.localization.sync;
    io.log(
      `Sync complete: ${sync.generated} generated, ${sync.unchanged} unchanged, ${sync.preservedReviewed} reviewed preserved.`,
    );
  }
  const noun = result.manifest.artifacts.length === 1 ? 'artifact' : 'artifacts';
  io.log(
    `Built ${result.manifest.artifacts.length} ${noun} (${result.manifest.mode}) to ${result.outputDirectory}.`,
  );
};

const runBuild = async (parsed: ParsedBuildOptions, io: CliIo): Promise<number> => {
  const result = await buildProject(await buildOptions(parsed, io));
  reportBuild(result, io);
  return 0;
};

export const runCli = async (
  arguments_: readonly string[],
  options: RunCliOptions,
): Promise<number> => {
  const [group, ...groupArguments] = arguments_;
  if (!group || group === '--help' || group === '-h') {
    options.io.log(usage);
    return 0;
  }
  if (groupArguments[0] === '--help' || groupArguments[0] === '-h') {
    options.io.log(usage);
    return 0;
  }
  try {
    if (group === 'build') {
      return await runBuild(parseBuildOptions(groupArguments, options.cwd), options.io);
    }
    const [command, ...rest] = groupArguments;
    if (group === 'i18n' && (command === 'sync' || command === 'check')) {
      const parsed = parseOptions(rest, options.cwd);
      return command === 'sync'
        ? await runSync(parsed, options.io)
        : await runCheck(parsed, options.io);
    }
    options.io.error(usage);
    return 1;
  } catch (error) {
    options.io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
};
