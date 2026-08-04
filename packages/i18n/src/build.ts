import { loadProjectConfig } from './config.js';
import { syncI18n } from './sync.js';
import { validateI18n } from './validate.js';
import type { SyncI18nOptions, SyncI18nResult, ValidateI18nResult } from './types.js';

export interface PrepareI18nBuildOptions {
  readonly projectDirectory: string;
  readonly sync?: Omit<SyncI18nOptions, 'projectDirectory'>;
}

export interface PrepareI18nBuildResult {
  readonly sync?: SyncI18nResult;
  readonly validation: ValidateI18nResult;
}

export const prepareI18nBuild = async (
  options: PrepareI18nBuildOptions,
): Promise<PrepareI18nBuildResult> => {
  const config = await loadProjectConfig(options.projectDirectory);
  const syncResult = options.sync
    ? await syncI18n({ ...options.sync, projectDirectory: config.projectDirectory })
    : undefined;
  const validation = await validateI18n(config.projectDirectory);
  if (!validation.valid && config.i18n.onMissing === 'error') {
    throw new Error(
      `Localization build validation failed:\n${validation.issues
        .map((issue) => `${issue.locale} ${issue.id}: ${issue.message}`)
        .join('\n')}`,
    );
  }
  return {
    ...(syncResult === undefined ? {} : { sync: syncResult }),
    validation,
  };
};
