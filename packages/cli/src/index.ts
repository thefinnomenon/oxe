import { loadEnvFile } from 'node:process';
import { join, resolve } from 'node:path';

import {
  createOpenAITranslationProvider,
  loadProjectConfig,
  syncI18n,
  type SyncProgress,
  validateI18n,
} from '@oxe/i18n';

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

const usage = `OXE command line

Usage:
  oxe i18n sync [--project PATH]
  oxe i18n check [--project PATH]

Translation extraction is automatic, but generation occurs only during an
explicit sync. API keys are read from .env or the environment variable named in
oxe.config.json and are never stored in catalogs.`;

const parseOptions = (arguments_: readonly string[], cwd: string): ParsedOptions => {
  let projectDirectory = cwd;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--project') {
      const value = arguments_[index + 1];
      if (!value) {
        throw new TypeError(`${argument} requires a path.`);
      }
      projectDirectory = value;
      index += 1;
      continue;
    }
    throw new TypeError(`Unknown option ${argument}.`);
  }
  return { projectDirectory, workingDirectory: cwd };
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

export const runCli = async (
  arguments_: readonly string[],
  options: RunCliOptions,
): Promise<number> => {
  const [group, command, ...rest] = arguments_;
  if (!group || group === '--help' || group === '-h') {
    options.io.log(usage);
    return 0;
  }
  if (group !== 'i18n' || (command !== 'sync' && command !== 'check')) {
    options.io.error(usage);
    return 1;
  }
  try {
    const parsed = parseOptions(rest, options.cwd);
    return command === 'sync'
      ? await runSync(parsed, options.io)
      : await runCheck(parsed, options.io);
  } catch (error) {
    options.io.error((error as Error).message);
    return 1;
  }
};
