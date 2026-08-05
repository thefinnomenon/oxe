import { I18N_MANIFEST_SCHEMA, type I18nManifest } from './types.js';
import { readCatalog, readManifest, writeCatalog, writeManifest } from './catalog.js';
import { loadProjectConfig } from './config.js';
import { extractProjectMessages } from './extract.js';
import { glossaryFor, translationSourceHash } from './generation.js';
import { contentHash } from './hash.js';
import { protectMessage } from './placeholders.js';
import { pluralCategories, pluralCategoryExample } from './runtime.js';
import type {
  CatalogMessage,
  CatalogVariantMessage,
  ExtractedMessage,
  ManifestMessage,
  OxeProjectConfig,
  PluralCategory,
  SyncI18nOptions,
  SyncI18nResult,
  TranslationInput,
  TranslationState,
} from './types.js';

const MAX_BATCH_ITEMS = 500;
const MAX_BATCH_SOURCE_CHARACTERS = 50_000;

const catalogMessageHash = (message: CatalogMessage): string =>
  contentHash(
    typeof message === 'string'
      ? message
      : JSON.stringify({
          cases: Object.fromEntries(
            Object.entries(message.cases).sort(([a], [b]) => a.localeCompare(b)),
          ),
          kind: message.kind,
        }),
  );

const messageVariantCount = (message: ExtractedMessage, locale: string): number =>
  message.selection ? pluralCategories(locale, message.selection.kind).length : 1;

const translationBatches = (
  messages: readonly ExtractedMessage[],
  locale: string,
): readonly (readonly ExtractedMessage[])[] => {
  const result: ExtractedMessage[][] = [];
  let batch: ExtractedMessage[] = [];
  let characters = 0;
  let items = 0;
  for (const message of messages) {
    const variants = messageVariantCount(message, locale);
    const messageCharacters = message.source.length * variants;
    if (
      batch.length > 0 &&
      (items + variants > MAX_BATCH_ITEMS ||
        characters + messageCharacters > MAX_BATCH_SOURCE_CHARACTERS)
    ) {
      result.push(batch);
      batch = [];
      characters = 0;
      items = 0;
    }
    batch.push(message);
    characters += messageCharacters;
    items += variants;
  }
  if (batch.length > 0) {
    result.push(batch);
  }
  return result;
};

const manifestMessage = (message: ExtractedMessage): ManifestMessage => ({
  explicitKey: message.explicitKey,
  locations: message.locations,
  placeholders: message.placeholders,
  ...(message.selection ? { selection: message.selection } : {}),
  source: message.source,
  sourceHash: message.sourceHash,
  translationContext: message.translationContext,
});

const escapeRegularExpression = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const restoreBySegments = async (
  message: ExtractedMessage,
  input: TranslationInput,
  sourceLanguage: string,
  targetLanguage: string,
  glossary: ReturnType<typeof glossaryFor>,
  options: SyncI18nOptions,
): Promise<string> => {
  const tokens = message.placeholders.map((placeholder) => placeholder.token);
  const pattern = new RegExp(
    `(${tokens
      .map(escapeRegularExpression)
      .sort((left, right) => right.length - left.length)
      .join('|')})`,
    'gu',
  );
  const parts = message.source.split(pattern);
  const prose: { readonly index: number; readonly leading: string; readonly trailing: string }[] =
    [];
  const items: TranslationInput[] = [];
  for (const [index, part] of parts.entries()) {
    if (tokens.includes(part) || !/[\p{L}\p{N}]/u.test(part)) {
      continue;
    }
    const leading = part.match(/^\s*/u)?.[0] ?? '';
    const trailing = part.match(/\s*$/u)?.[0] ?? '';
    prose.push({ index, leading, trailing });
    items.push({
      ...input,
      id: `${input.id}:segment:${index}`,
      text: part.slice(leading.length, part.length - trailing.length),
    });
  }
  const output = await options.provider.translate({
    glossary,
    items,
    sourceLanguage,
    targetLanguage,
  });
  if (output.length !== prose.length) {
    throw new Error('The translation provider returned an incomplete placeholder fallback batch.');
  }
  for (const [index, translated] of output.entries()) {
    const target = prose[index];
    if (!target) {
      throw new Error(
        'The translation provider returned an unexpected placeholder fallback result.',
      );
    }
    parts[target.index] = `${target.leading}${translated}${target.trailing}`;
  }
  return parts.join('');
};

interface TranslationUnit {
  readonly category?: PluralCategory;
  readonly input: TranslationInput;
  readonly message: ExtractedMessage;
  readonly protectedMessage: ReturnType<typeof protectMessage>;
}

interface TranslatedMessage {
  readonly placeholderStrategy?: 'fixed' | 'movable';
  readonly value: CatalogMessage;
}

const translateBatch = async (
  batch: readonly ExtractedMessage[],
  config: OxeProjectConfig,
  locale: string,
  options: SyncI18nOptions,
): Promise<Readonly<Record<string, TranslatedMessage>>> => {
  const units: TranslationUnit[] = [];
  for (const message of batch) {
    const protectedMessage = protectMessage(message);
    const categories = message.selection
      ? pluralCategories(locale, message.selection.kind)
      : ([undefined] as const);
    for (const category of categories) {
      const input: TranslationInput = {
        context: message.translationContext,
        id: category ? `${message.id}:${message.selection?.kind}:${category}` : message.id,
        text: protectedMessage.masked,
        ...(category && message.selection
          ? {
              variation: {
                category,
                example: pluralCategoryExample(locale, message.selection.kind, category),
                kind: message.selection.kind,
              },
            }
          : {}),
      };
      units.push({
        ...(category ? { category } : {}),
        input,
        message,
        protectedMessage,
      });
    }
  }
  const glossary = glossaryFor(config, locale);
  const output = await options.provider.translate({
    glossary,
    items: units.map((unit) => unit.input),
    sourceLanguage: config.i18n.source,
    targetLanguage: locale,
  });
  if (output.length !== units.length) {
    throw new Error(
      `The translation provider returned ${output.length} translations for ${units.length} requested variants.`,
    );
  }

  const translated = new Map<string, TranslatedMessage>();
  for (const [index, unit] of units.entries()) {
    const value = output[index];
    if (value === undefined) {
      throw new Error('The translation provider returned an incomplete translation batch.');
    }
    let restored: string;
    let placeholderStrategy: 'fixed' | 'movable' | undefined =
      unit.message.placeholders.length === 0 ? undefined : 'movable';
    try {
      restored = unit.protectedMessage.restore(value);
    } catch {
      placeholderStrategy = 'fixed';
      restored = await restoreBySegments(
        unit.message,
        unit.input,
        config.i18n.source,
        locale,
        glossary,
        options,
      );
    }
    if (!unit.category || !unit.message.selection) {
      translated.set(unit.message.id, {
        ...(placeholderStrategy ? { placeholderStrategy } : {}),
        value: restored,
      });
      continue;
    }
    const existing = translated.get(unit.message.id);
    const variant: CatalogVariantMessage =
      typeof existing?.value === 'object'
        ? existing.value
        : { cases: {}, kind: unit.message.selection.kind };
    const combinedStrategy =
      existing?.placeholderStrategy === 'fixed' || placeholderStrategy === 'fixed'
        ? 'fixed'
        : placeholderStrategy;
    translated.set(unit.message.id, {
      ...(combinedStrategy ? { placeholderStrategy: combinedStrategy } : {}),
      value: {
        ...variant,
        cases: { ...variant.cases, [unit.category]: restored },
      },
    });
  }
  return Object.fromEntries(translated);
};

const runConcurrent = async <Value>(
  values: readonly Value[],
  concurrency: number,
  run: (value: Value) => Promise<void>,
): Promise<void> => {
  let next = 0;
  let failure: unknown;
  const worker = async (): Promise<void> => {
    while (failure === undefined) {
      const index = next;
      next += 1;
      const value = values[index];
      if (value === undefined) return;
      try {
        await run(value);
      } catch (error) {
        failure = error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  if (failure !== undefined) {
    throw failure;
  }
};

export const syncI18n = async (options: SyncI18nOptions): Promise<SyncI18nResult> => {
  const config = await loadProjectConfig(options.projectDirectory);
  options.onProgress?.({ completed: 0, locale: config.i18n.source, phase: 'extract', total: 1 });
  const extracted = await extractProjectMessages(config);
  if (extracted.diagnostics.length > 0) {
    throw new Error(
      `Message extraction failed:\n${extracted.diagnostics
        .map(
          (diagnostic) =>
            `${diagnostic.file ?? '<project>'}:${diagnostic.line ?? 0}:${diagnostic.column ?? 0} ${diagnostic.code} ${diagnostic.message}`,
        )
        .join('\n')}`,
    );
  }
  options.onProgress?.({ completed: 1, locale: config.i18n.source, phase: 'extract', total: 1 });

  const directory = config.i18n.catalogDirectory;
  const previousManifest = await readManifest(directory);
  if (previousManifest && previousManifest.sourceLocale !== config.i18n.source) {
    throw new Error(
      `Existing catalogs use source locale ${previousManifest.sourceLocale}; configured source is ${config.i18n.source}.`,
    );
  }

  const locales = [config.i18n.source, ...config.i18n.locales];
  const currentMessages = new Map(extracted.messages.map((message) => [message.id, message]));
  const manifestMessages = Object.fromEntries(
    extracted.messages.map((message) => [message.id, manifestMessage(message)]),
  );
  const translations: Record<string, Record<string, TranslationState>> = Object.fromEntries(
    locales.map((locale) => [locale, { ...(previousManifest?.translations[locale] ?? {}) }]),
  );
  const currentManifest = (): I18nManifest => ({
    messages: manifestMessages,
    schemaVersion: I18N_MANIFEST_SCHEMA,
    sourceLocale: config.i18n.source,
    translations,
  });
  let generated = 0;
  let preservedReviewed = 0;
  let removedGenerated = 0;
  let unchanged = 0;
  const catalogs = new Map<string, Record<string, CatalogMessage>>();
  let checkpoint = Promise.resolve();
  const saveCheckpoint = (
    locale: string,
    catalog: Readonly<Record<string, CatalogMessage>>,
  ): Promise<void> => {
    checkpoint = checkpoint.then(async () => {
      await writeCatalog(directory, locale, catalog);
      await writeManifest(directory, currentManifest());
    });
    return checkpoint;
  };

  await runConcurrent(locales, config.i18n.translation.concurrency, async (locale) => {
    const sourceLocale = locale === config.i18n.source;
    const previousCatalog = await readCatalog(directory, locale);
    const catalog: Record<string, CatalogMessage> = { ...(previousCatalog?.messages ?? {}) };
    const states = translations[locale] ?? {};
    translations[locale] = states;

    for (const [id, state] of Object.entries(states)) {
      const value = catalog[id];
      if (value !== undefined && catalogMessageHash(value) !== state.outputHash) {
        states[id] = { ...state, outputHash: catalogMessageHash(value), status: 'reviewed' };
      }
      if (!currentMessages.has(id) && state.status === 'generated') {
        delete catalog[id];
        delete states[id];
        removedGenerated += 1;
      }
    }
    if (sourceLocale) {
      for (const id of Object.keys(catalog)) {
        if (!currentMessages.has(id)) {
          delete catalog[id];
          delete states[id];
        }
      }
    }

    const pending: ExtractedMessage[] = [];
    for (const message of extracted.messages) {
      if (sourceLocale && !message.selection) {
        catalog[message.id] = message.source;
        delete states[message.id];
        continue;
      }
      const value = catalog[message.id];
      const state = states[message.id];
      const sourceHash = translationSourceHash(config, locale, message);
      if (value === undefined) {
        pending.push(message);
        continue;
      }
      if (!state) {
        if (sourceLocale && message.selection) {
          pending.push(message);
        } else {
          states[message.id] = {
            outputHash: catalogMessageHash(value),
            provider: options.provider.id,
            sourceHash,
            status: 'reviewed',
          };
          preservedReviewed += 1;
        }
        continue;
      }
      if (state.status === 'reviewed') {
        preservedReviewed += 1;
        continue;
      }
      if (state.sourceHash !== sourceHash) {
        pending.push(message);
      } else {
        unchanged += 1;
      }
    }

    let completed = 0;
    for (const batch of translationBatches(pending, locale)) {
      const output = await translateBatch(batch, config, locale, options);
      for (const message of batch) {
        const translated = output[message.id];
        if (translated === undefined) {
          throw new Error(`The translation provider omitted ${message.id}.`);
        }
        catalog[message.id] = translated.value;
        states[message.id] = {
          model: options.provider.model,
          outputHash: catalogMessageHash(translated.value),
          ...(translated.placeholderStrategy
            ? { placeholderStrategy: translated.placeholderStrategy }
            : {}),
          provider: options.provider.id,
          sourceHash: translationSourceHash(config, locale, message),
          status: 'generated',
        };
        generated += 1;
      }
      completed += batch.length;
      options.onProgress?.({ completed, locale, phase: 'translate', total: pending.length });
      await saveCheckpoint(locale, catalog);
    }
    catalogs.set(locale, catalog);
  });

  await checkpoint;
  for (const [locale, catalog] of catalogs) {
    await writeCatalog(directory, locale, catalog);
  }
  await writeManifest(directory, currentManifest());
  options.onProgress?.({ completed: 1, locale: config.i18n.source, phase: 'write', total: 1 });

  return {
    generated,
    messages: extracted.messages.length,
    preservedReviewed,
    removedGenerated,
    unchanged,
  };
};
