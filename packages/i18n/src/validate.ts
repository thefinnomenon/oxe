import { loadProjectConfig } from './config.js';
import { extractProjectMessages } from './extract.js';
import { translationSourceHash } from './generation.js';
import { readCatalog, readManifest } from './catalog.js';
import { hasValidPlaceholders } from './placeholders.js';
import { pluralCategories } from './runtime.js';
import type { CatalogMessage, ValidateI18nResult, ValidationIssue } from './types.js';

const translations = (message: CatalogMessage): readonly string[] =>
  typeof message === 'string' ? [message] : Object.values(message.cases);

export const validateI18n = async (projectDirectory: string): Promise<ValidateI18nResult> => {
  const config = await loadProjectConfig(projectDirectory);
  const extracted = await extractProjectMessages(config);
  if (extracted.diagnostics.length > 0) {
    throw new Error(
      extracted.diagnostics
        .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        .join('\n'),
    );
  }
  const manifest = await readManifest(config.i18n.catalogDirectory);
  const issues: ValidationIssue[] = [];
  const locales = [
    ...config.i18n.locales,
    ...(extracted.messages.some((message) => message.selection) ? [config.i18n.source] : []),
  ];
  for (const locale of locales) {
    const catalog = await readCatalog(config.i18n.catalogDirectory, locale);
    for (const message of extracted.messages) {
      if (locale === config.i18n.source && !message.selection) {
        continue;
      }
      const translated = catalog?.messages[message.id];
      const state = manifest?.translations[locale]?.[message.id];
      if (translated === undefined || state === undefined) {
        issues.push({
          id: message.id,
          locale,
          message: `Missing translation for ${message.source}`,
          reason: 'missing',
        });
        continue;
      }
      if (state.sourceHash !== translationSourceHash(config, locale, message)) {
        issues.push({
          id: message.id,
          locale,
          message: `Translation is stale for ${message.source}`,
          reason: 'stale',
        });
      }
      if (message.selection) {
        const categories = pluralCategories(locale, message.selection.kind);
        if (
          typeof translated === 'string' ||
          translated.kind !== message.selection.kind ||
          categories.some((category) => translated.cases[category] === undefined)
        ) {
          issues.push({
            id: message.id,
            locale,
            message: `Translation is missing one or more ${message.selection.kind} cases for ${message.source}`,
            reason: 'missing-case',
          });
        }
      } else if (typeof translated !== 'string') {
        issues.push({
          id: message.id,
          locale,
          message: `Translation unexpectedly contains selection cases for ${message.source}`,
          reason: 'missing-case',
        });
      }
      if (translations(translated).some((value) => !hasValidPlaceholders(message, value))) {
        issues.push({
          id: message.id,
          locale,
          message: `Translation does not preserve every placeholder for ${message.source}`,
          reason: 'invalid-placeholders',
        });
      }
    }
  }
  return { issues, valid: issues.length === 0 };
};
