import { contentHash } from './hash.js';
import type { ExtractedMessage, OxeProjectConfig, TranslationGlossaryTerm } from './types.js';

export const glossaryFor = (
  config: OxeProjectConfig,
  locale: string,
): readonly TranslationGlossaryTerm[] =>
  Object.entries(config.i18n.glossary)
    .map(([source, entry]) => ({
      ...(entry.description ? { description: entry.description } : {}),
      preserve: entry.preserve,
      source,
      ...(entry.translations[locale] ? { translation: entry.translations[locale] } : {}),
    }))
    .sort((left, right) => left.source.localeCompare(right.source));

export const translationSourceHash = (
  config: OxeProjectConfig,
  locale: string,
  message: ExtractedMessage,
): string =>
  contentHash(
    JSON.stringify({
      glossary: glossaryFor(config, locale),
      messageSourceHash: message.sourceHash,
    }),
  );
