import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import type {
  MissingTranslationPolicy,
  OxeGlossaryEntry,
  OxeI18nConfig,
  OxeProjectConfig,
} from './types.js';

const CONFIG_FILE = 'oxe.config.json';
const missingPolicies = new Set<MissingTranslationPolicy>(['error', 'source', 'warn']);
const environmentVariableName = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const defaultTranslationConcurrency = 4;

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const strings = (value: unknown, field: string): readonly string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError(`${field} must be an array of strings.`);
  }
  return value as readonly string[];
};

const canonicalLocale = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty locale string.`);
  }
  try {
    const canonical = Intl.getCanonicalLocales(value)[0];
    if (!canonical) {
      throw new RangeError('No locale was returned.');
    }
    return canonical;
  } catch {
    throw new TypeError(`${field} must be a valid BCP 47 locale.`);
  }
};

const glossaryConfig = (
  value: unknown,
  supportedLocales: ReadonlySet<string>,
): Readonly<Record<string, OxeGlossaryEntry>> => {
  if (value === undefined) {
    return {};
  }
  const entries = record(value);
  if (!entries) {
    throw new TypeError('i18n.glossary must be an object keyed by source term.');
  }
  return Object.fromEntries(
    Object.entries(entries).map(([term, rawEntry]) => {
      if (term.trim().length === 0) {
        throw new TypeError('i18n.glossary terms cannot be empty.');
      }
      const entry = record(rawEntry);
      if (!entry) {
        throw new TypeError(`i18n.glossary[${JSON.stringify(term)}] must be an object.`);
      }
      if (entry.description !== undefined && typeof entry.description !== 'string') {
        throw new TypeError(`i18n.glossary[${JSON.stringify(term)}].description must be a string.`);
      }
      if (entry.preserve !== undefined && typeof entry.preserve !== 'boolean') {
        throw new TypeError(`i18n.glossary[${JSON.stringify(term)}].preserve must be Boolean.`);
      }
      const rawTranslations = entry.translations ?? {};
      const translationsRecord = record(rawTranslations);
      if (!translationsRecord) {
        throw new TypeError(
          `i18n.glossary[${JSON.stringify(term)}].translations must be an object.`,
        );
      }
      const translations = Object.fromEntries(
        Object.entries(translationsRecord).map(([rawLocale, translation]) => {
          const locale = canonicalLocale(
            rawLocale,
            `i18n.glossary[${JSON.stringify(term)}].translations`,
          );
          if (!supportedLocales.has(locale)) {
            throw new TypeError(
              `Glossary term ${JSON.stringify(term)} has a translation for unconfigured locale ${locale}.`,
            );
          }
          if (typeof translation !== 'string' || translation.length === 0) {
            throw new TypeError(
              `Glossary translation for ${JSON.stringify(term)} in ${locale} must be non-empty.`,
            );
          }
          return [locale, translation];
        }),
      );
      return [
        term,
        {
          ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
          preserve: entry.preserve === true,
          translations,
        },
      ];
    }),
  );
};

export const loadProjectConfig = async (projectDirectory: string): Promise<OxeProjectConfig> => {
  const absoluteProjectDirectory = resolve(projectDirectory);
  const configPath = join(absoluteProjectDirectory, CONFIG_FILE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Missing ${CONFIG_FILE} in ${absoluteProjectDirectory}.`);
    }
    throw new Error(`Could not read ${configPath}: ${(error as Error).message}`);
  }

  const root = record(parsed);
  const rawI18n = record(root?.i18n);
  if (!rawI18n) {
    throw new TypeError(`${CONFIG_FILE} must contain an i18n object.`);
  }

  const source = canonicalLocale(rawI18n.source, 'i18n.source');
  const rawLocales = strings(rawI18n.locales, 'i18n.locales');
  const locales = [...new Set(rawLocales.map((locale) => canonicalLocale(locale, 'i18n.locales')))]
    .filter((locale) => locale !== source)
    .sort();
  if (locales.length === 0) {
    throw new TypeError('i18n.locales must contain at least one locale other than the source.');
  }

  const rawTranslation = record(rawI18n.translation);
  if (!rawTranslation || rawTranslation.provider !== 'openai') {
    throw new TypeError('i18n.translation.provider must be "openai".');
  }
  if (typeof rawTranslation.model !== 'string' || rawTranslation.model.length === 0) {
    throw new TypeError('i18n.translation.model must be a non-empty OpenAI model id.');
  }
  const apiKeyEnv = rawTranslation.apiKeyEnv ?? 'OPENAI_API_KEY';
  if (typeof apiKeyEnv !== 'string' || !environmentVariableName.test(apiKeyEnv)) {
    throw new TypeError('i18n.translation.apiKeyEnv must be a valid environment variable name.');
  }
  const concurrency = rawTranslation.concurrency ?? defaultTranslationConcurrency;
  if (
    !Number.isInteger(concurrency) ||
    (concurrency as number) < 1 ||
    (concurrency as number) > 16
  ) {
    throw new RangeError('i18n.translation.concurrency must be an integer from 1 through 16.');
  }
  const translation = {
    apiKeyEnv,
    concurrency: concurrency as number,
    model: rawTranslation.model,
    provider: 'openai' as const,
  };
  const onMissing = rawI18n.onMissing ?? 'warn';
  if (
    typeof onMissing !== 'string' ||
    !missingPolicies.has(onMissing as MissingTranslationPolicy)
  ) {
    throw new TypeError('i18n.onMissing must be "error", "source", or "warn".');
  }

  const include =
    rawI18n.include === undefined ? ['**/*.oxe'] : strings(rawI18n.include, 'i18n.include');
  const rawCatalogDirectory = rawI18n.catalogDirectory ?? 'locales';
  if (typeof rawCatalogDirectory !== 'string' || rawCatalogDirectory.length === 0) {
    throw new TypeError('i18n.catalogDirectory must be a non-empty path string.');
  }
  const catalogDirectory = isAbsolute(rawCatalogDirectory)
    ? rawCatalogDirectory
    : resolve(absoluteProjectDirectory, rawCatalogDirectory);
  const glossary = glossaryConfig(rawI18n.glossary, new Set([source, ...locales]));

  const i18n: OxeI18nConfig = {
    catalogDirectory,
    glossary,
    include,
    locales,
    onMissing: onMissing as MissingTranslationPolicy,
    source,
    translation,
  };
  return { i18n, projectDirectory: absoluteProjectDirectory };
};
