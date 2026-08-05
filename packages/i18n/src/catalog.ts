import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import {
  I18N_CATALOG_SCHEMA,
  I18N_MANIFEST_SCHEMA,
  type CatalogMessage,
  type CatalogVariantMessage,
  type I18nManifest,
  type LocaleCatalog,
} from './types.js';

const legacyCatalogSchema = 'oxe.i18n.catalog.v1';
const legacyManifestSchema = 'oxe.i18n.manifest.v1';
const pluralCategories = new Set(['few', 'many', 'one', 'other', 'two', 'zero']);

const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const readJson = async (path: string): Promise<unknown | undefined> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw new Error(`Could not read ${path}: ${(error as Error).message}`);
  }
};

const sortedRecord = <Value>(
  entries: Iterable<readonly [string, Value]>,
): Readonly<Record<string, Value>> =>
  Object.fromEntries([...entries].sort(([left], [right]) => left.localeCompare(right)));

const stableJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const writeJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  await writeFile(temporary, stableJson(value), 'utf8');
  await rename(temporary, path);
};

export const catalogPath = (directory: string, locale: string): string =>
  join(directory, `${locale}.json`);

export const manifestPath = (directory: string): string => join(directory, '.oxe-manifest.json');

const variantMessage = (value: unknown): value is CatalogVariantMessage => {
  const candidate = object(value);
  const cases = object(candidate?.cases);
  return (
    (candidate?.kind === 'cardinal' || candidate?.kind === 'ordinal') &&
    cases !== undefined &&
    Object.entries(cases).every(
      ([category, message]) => pluralCategories.has(category) && typeof message === 'string',
    )
  );
};

const catalogMessage = (value: unknown): value is CatalogMessage =>
  typeof value === 'string' || variantMessage(value);

const sortedMessage = (message: CatalogMessage): CatalogMessage =>
  typeof message === 'string'
    ? message
    : { ...message, cases: sortedRecord(Object.entries(message.cases)) };

export const readCatalog = async (
  directory: string,
  locale: string,
): Promise<LocaleCatalog | undefined> => {
  const path = catalogPath(directory, locale);
  const parsed = await readJson(path);
  if (parsed === undefined) {
    return undefined;
  }
  const root = object(parsed);
  const messages = object(root?.messages);
  if (
    (root?.schemaVersion !== I18N_CATALOG_SCHEMA && root?.schemaVersion !== legacyCatalogSchema) ||
    root.locale !== locale ||
    !messages ||
    Object.values(messages).some((message) => !catalogMessage(message))
  ) {
    throw new TypeError(`${path} is not a valid ${I18N_CATALOG_SCHEMA} catalog.`);
  }
  return {
    locale,
    messages: messages as Readonly<Record<string, CatalogMessage>>,
    schemaVersion: I18N_CATALOG_SCHEMA,
  };
};

export const writeCatalog = async (
  directory: string,
  locale: string,
  messages: Readonly<Record<string, CatalogMessage>>,
): Promise<void> => {
  const catalog: LocaleCatalog = {
    locale,
    messages: sortedRecord(
      Object.entries(messages).map(([id, message]) => [id, sortedMessage(message)]),
    ),
    schemaVersion: I18N_CATALOG_SCHEMA,
  };
  await writeJson(catalogPath(directory, locale), catalog);
};

export const readManifest = async (directory: string): Promise<I18nManifest | undefined> => {
  const path = manifestPath(directory);
  const parsed = await readJson(path);
  if (parsed === undefined) {
    return undefined;
  }
  const root = object(parsed);
  if (
    (root?.schemaVersion !== I18N_MANIFEST_SCHEMA &&
      root?.schemaVersion !== legacyManifestSchema) ||
    typeof root.sourceLocale !== 'string' ||
    !object(root.messages) ||
    !object(root.translations)
  ) {
    throw new TypeError(`${path} is not a valid ${I18N_MANIFEST_SCHEMA} manifest.`);
  }
  return parsed as I18nManifest;
};

export const writeManifest = async (directory: string, manifest: I18nManifest): Promise<void> => {
  const messages = sortedRecord(Object.entries(manifest.messages));
  const translations = sortedRecord(
    Object.entries(manifest.translations).map(
      ([locale, states]) => [locale, sortedRecord(Object.entries(states))] as const,
    ),
  );
  await writeJson(manifestPath(directory), { ...manifest, messages, translations });
};
