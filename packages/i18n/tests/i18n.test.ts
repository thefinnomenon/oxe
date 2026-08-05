import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { analyzeSource } from '@oxe/compiler';
import { resolveLocalizationContext } from '@oxe/runtime';

import {
  extractProjectMessages,
  createI18n,
  I18N_CATALOG_SCHEMA,
  loadProjectConfig,
  prepareI18nBuild,
  readCatalog,
  readManifest,
  syncI18n,
  validateI18n,
  type TranslationProvider,
  type TranslationRequest,
} from '../src/index.js';

const project = async (source: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'oxe-i18n-'));
  await writeFile(
    join(directory, 'oxe.config.json'),
    `${JSON.stringify(
      {
        i18n: {
          locales: ['es', 'fr'],
          onMissing: 'error',
          source: 'en-US',
          translation: {
            apiKeyEnv: 'OXE_TEST_OPENAI_KEY',
            concurrency: 1,
            model: 'gpt-test',
            provider: 'openai',
          },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  await writeFile(join(directory, 'App.oxe'), source, 'utf8');
  return directory;
};

class FakeProvider implements TranslationProvider {
  readonly id = 'openai' as const;
  readonly model = 'fake-openai';
  readonly requests: TranslationRequest[] = [];

  translate(request: TranslationRequest): Promise<readonly string[]> {
    this.requests.push(request);
    return Promise.resolve(request.items.map((item) => `[${request.targetLanguage}] ${item.text}`));
  }
}

describe('OXE localization tooling', () => {
  it('uses the same implicit message ids in extraction and compiler lowering', async () => {
    const source = `App(name = "Ada"):
  <main>
    <p>Hello {name}
    <input placeholder={"Search stories"}>
`;
    const directory = await project(source);
    const extracted = await extractProjectMessages(await loadProjectConfig(directory));
    const analyzed = analyzeSource(source, 'App.oxe', 'App.oxe', { localization: true });
    if (!analyzed.graph) {
      throw new Error(`Expected a graph, received ${JSON.stringify(analyzed.diagnostics)}.`);
    }
    const loweredIds = analyzed.graph.nodes.flatMap((node) => {
      if (node.kind === 'text' && node.localization) return [node.localization.key];
      if (node.kind === 'element') {
        return (node.dynamicAttributes ?? []).flatMap((attribute) =>
          attribute.localization ? [attribute.localization.key] : [],
        );
      }
      return [];
    });

    expect(new Set(loweredIds)).toEqual(new Set(extracted.messages.map((message) => message.id)));
  });

  it('extracts visible prose, attributes, placeholders, explicit keys, and inherited opt-outs', async () => {
    const directory = await project(`App(name):
  <main>
    <h1 i18n={{ key: "home.title" }}>Hello {name}
    <p>Recent stories
    <input placeholder={"Search stories"}>
    <section i18n={false}>
      <p>Not translated
      <p i18n={{ key: "forced" }}>Translated again
    <section contenteditable={true}>
      <p>Editable draft
    <section translate={"no"}>
      <p>Brand copy
`);
    const config = await loadProjectConfig(directory);
    const result = await extractProjectMessages(config);

    expect(result.diagnostics).toEqual([]);
    expect(result.messages.map((message) => message.source).sort()).toEqual([
      'Hello {name}',
      'Recent stories',
      'Search stories',
      'Translated again',
    ]);
    expect(result.messages.find((message) => message.id === 'home.title')).toMatchObject({
      explicitKey: true,
      placeholders: [{ kind: 'expression', name: 'name', token: '{name}' }],
    });
    expect(result.messages.some((message) => message.source === 'Not translated')).toBe(false);
    expect(result.messages.some((message) => message.source === 'Editable draft')).toBe(false);
    expect(result.messages.some((message) => message.source === 'Brand copy')).toBe(false);
  });

  it('syncs incrementally, protects manual edits, and identifies stale reviewed translations', async () => {
    const directory = await project(`App(name):
  <main>
    <h1 i18n={{ key: "home.title" }}>Hello {name}
    <p>Recent stories
`);
    const provider = new FakeProvider();
    const first = await syncI18n({ projectDirectory: directory, provider });
    expect(first).toMatchObject({ generated: 4, messages: 2, unchanged: 0 });

    const second = await syncI18n({ projectDirectory: directory, provider });
    expect(second).toMatchObject({ generated: 0, messages: 2, unchanged: 4 });

    const spanishPath = join(directory, 'locales', 'es.json');
    const spanish = JSON.parse(await readFile(spanishPath, 'utf8')) as {
      messages: Record<string, string>;
    };
    spanish.messages['home.title'] = 'Hola {name}';
    await writeFile(spanishPath, `${JSON.stringify(spanish, null, 2)}\n`, 'utf8');
    await writeFile(
      join(directory, 'App.oxe'),
      `App(name):
  <main>
    <h1 i18n={{ key: "home.title" }}>Welcome {name}
    <p>Recent stories
`,
      'utf8',
    );

    const third = await syncI18n({ projectDirectory: directory, provider });
    expect(third.generated).toBe(1);
    expect(third.preservedReviewed).toBe(1);
    expect((await readCatalog(join(directory, 'locales'), 'es'))?.messages['home.title']).toBe(
      'Hola {name}',
    );
    const validation = await validateI18n(directory);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({ id: 'home.title', locale: 'es', reason: 'stale' }),
    );
  });

  it('rejects conflicting explicit message keys', async () => {
    const directory = await project(`App():
  <main>
    <p i18n={{ key: "same" }}>First
    <p i18n={{ key: "same" }}>Second
`);
    const result = await extractProjectMessages(await loadProjectConfig(directory));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'OXEI18N003' }));

    const malformed = await project(`App():
  <data i18n={{ format: { type: "currency" } }}>{10}
`);
    expect(
      (await extractProjectMessages(await loadProjectConfig(malformed))).diagnostics,
    ).toContainEqual(expect.objectContaining({ code: 'OXEI18N010' }));
  });

  it('generates locale-specific cardinal and ordinal cases with context and glossary guidance', async () => {
    const directory = await project(`App(count, rank, audience):
  <main>
    <h1 i18n={{ key: "dashboard.title" }}>Your dashboard
    <p i18n={{ key: "story.count", count: count, context: { audience: audience }, purpose: "reading-list item count" }}>{count} stories saved to your reading list
    <p i18n={{ key: "challenge.rank", ordinal: rank, purpose: "weekly reading challenge placement" }}>You finished in {rank} place
`);
    const configPath = join(directory, 'oxe.config.json');
    const config = JSON.parse(await readFile(configPath, 'utf8')) as {
      i18n: Record<string, unknown>;
    };
    config.i18n.glossary = {
      'reading list': {
        description: 'A collection of articles saved by the user.',
        translations: { es: 'lista de lectura', fr: 'liste de lecture' },
      },
    };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

    const extracted = await extractProjectMessages(await loadProjectConfig(directory));
    expect(extracted.diagnostics).toEqual([]);
    expect(extracted.messages.find((message) => message.id === 'story.count')).toMatchObject({
      selection: { kind: 'cardinal' },
      translationContext: {
        component: 'App',
        contextSelectors: ['audience'],
        purpose: 'reading-list item count',
      },
    });

    const provider = new FakeProvider();
    await syncI18n({ projectDirectory: directory, provider });
    expect(
      provider.requests.find((request) => request.targetLanguage === 'es')?.glossary,
    ).toContainEqual(
      expect.objectContaining({ source: 'reading list', translation: 'lista de lectura' }),
    );
    expect((await readCatalog(join(directory, 'locales'), 'es'))?.messages['story.count']).toEqual({
      cases: {
        many: '[es] {count} stories saved to your reading list',
        one: '[es] {count} stories saved to your reading list',
        other: '[es] {count} stories saved to your reading list',
      },
      kind: 'cardinal',
    });
    expect(
      (await readCatalog(join(directory, 'locales'), 'en-US'))?.messages['challenge.rank'],
    ).toMatchObject({ kind: 'ordinal' });
    await expect(validateI18n(directory)).resolves.toMatchObject({ valid: true });
  });

  it('formats generated selection catalogs in a small browser-safe runtime', () => {
    const runtime = createI18n({
      catalogs: [
        {
          locale: 'en-US',
          messages: {
            rank: {
              cases: { few: '{rank}rd', one: '{rank}st', other: '{rank}th', two: '{rank}nd' },
              kind: 'ordinal',
            },
            stories: {
              cases: { one: '{count} story', other: '{count} stories' },
              kind: 'cardinal',
            },
          },
          schemaVersion: I18N_CATALOG_SCHEMA,
        },
        {
          locale: 'fr',
          messages: {
            stories: {
              cases: {
                many: '{count} histoires',
                one: '{count} histoire',
                other: '{count} histoires',
              },
              kind: 'cardinal',
            },
          },
          schemaVersion: I18N_CATALOG_SCHEMA,
        },
      ],
      locale: 'en-US',
    });

    expect(runtime.format('stories', { count: 1, values: { count: 1 } })).toBe('1 story');
    expect(runtime.format('rank', { ordinal: 22, values: { rank: 22 } })).toBe('22nd');
    runtime.setLocale('fr');
    expect(runtime.format('stories', { count: 2, values: { count: 2 } })).toBe('2 histoires');
  });

  it('returns safe structured parts so translations can reorder compiler-owned inline markup', () => {
    const runtime = createI18n({
      catalogs: [
        {
          locale: 'en-US',
          messages: { greeting: 'Hello <strong>{name}</strong>' },
          schemaVersion: I18N_CATALOG_SCHEMA,
        },
        {
          locale: 'fr',
          messages: { greeting: '<strong>{name}</strong>, bonjour' },
          schemaVersion: I18N_CATALOG_SCHEMA,
        },
      ],
      locale: 'en-US',
    });
    const initialRevision = runtime.revision.read();

    expect(
      runtime.formatToParts('greeting', { markup: ['strong'], values: { name: 'Ada' } }),
    ).toEqual(['Hello ', { children: ['Ada'], kind: 'markup', name: 'strong' }]);
    runtime.setLocale('fr');
    expect(runtime.revision.read()).toBe(initialRevision + 1);
    expect(
      runtime.formatToParts('greeting', { markup: ['strong'], values: { name: 'Ada' } }),
    ).toEqual([{ children: ['Ada'], kind: 'markup', name: 'strong' }, ', bonjour']);
  });

  it('formats currency and temporal values through cached platform Intl formatters', () => {
    const runtime = createI18n({
      catalogs: [
        { locale: 'en-US', messages: {}, schemaVersion: I18N_CATALOG_SCHEMA },
        { locale: 'fr-FR', messages: {}, schemaVersion: I18N_CATALOG_SCHEMA },
      ],
      calendar: 'gregory',
      locale: 'en-US',
      numberingSystem: 'latn',
      timeZone: 'America/New_York',
    });
    const date = new Date('2026-08-04T01:30:00.000Z');

    expect(runtime.context).toEqual(
      resolveLocalizationContext({
        calendar: 'gregory',
        locale: 'en-US',
        numberingSystem: 'latn',
        timeZone: 'America/New_York',
      }),
    );
    expect(runtime.formatValue(10, { currency: 'USD', type: 'currency' })).toBe('$10.00');
    expect(runtime.formatValue(date, { dateStyle: 'long', type: 'date' })).toBe('August 3, 2026');
    expect(runtime.formatValue(date, { dateStyle: 'long', timeZone: 'UTC', type: 'date' })).toBe(
      'August 4, 2026',
    );
    expect(runtime.machineValue(date, 'datetime')).toBe('2026-08-04T01:30:00.000Z');
    const initialRevision = runtime.revision.read();
    runtime.adoptContext(
      resolveLocalizationContext({
        calendar: 'gregory',
        locale: 'fr-FR',
        numberingSystem: 'latn',
        timeZone: 'UTC',
      }),
    );
    expect(runtime.revision.read()).toBe(initialRevision + 1);
    expect(runtime.context).toMatchObject({ locale: 'fr-FR', timeZone: 'UTC' });
    expect(runtime.formatValue(10, { currency: 'EUR', type: 'currency' })).toMatch(/10,00\s€/u);
  });

  it('bounds independent locale translation work by configured concurrency', async () => {
    const directory = await project(`App():
  <p>Hello world
`);
    const configPath = join(directory, 'oxe.config.json');
    const config = JSON.parse(await readFile(configPath, 'utf8')) as {
      i18n: { translation: Record<string, unknown> };
    };
    config.i18n.translation.concurrency = 2;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    let active = 0;
    let peak = 0;
    const provider: TranslationProvider = {
      id: 'openai',
      model: 'concurrency-test',
      async translate(request) {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return request.items.map((item) => item.text);
      },
    };

    await syncI18n({ projectDirectory: directory, provider });
    expect(peak).toBe(2);
  });

  it('falls back to fixed placeholder reconstruction when a model corrupts markers', async () => {
    const directory = await project(`App(name):
  <p i18n={{ key: "greeting" }}>Welcome back, {name}
`);
    const provider: TranslationProvider = {
      id: 'openai',
      model: 'corrupting-openai',
      translate(request) {
        return Promise.resolve(
          request.items.map((item) =>
            item.text.includes('<x0/>')
              ? 'Marker was removed'
              : `[${request.targetLanguage}] ${item.text}`,
          ),
        );
      },
    };
    await syncI18n({ projectDirectory: directory, provider });

    expect((await readCatalog(join(directory, 'locales'), 'es'))?.messages.greeting).toBe(
      '[es] Welcome back, {name}',
    );
    expect(
      (await readManifest(join(directory, 'locales')))?.translations.es?.greeting,
    ).toMatchObject({ placeholderStrategy: 'fixed', status: 'generated' });
    await expect(prepareI18nBuild({ projectDirectory: directory })).resolves.toMatchObject({
      validation: { valid: true },
    });
  });

  it('checkpoints completed API batches so a failed sync can resume without retranslating them', async () => {
    const messages = Array.from({ length: 501 }, (_, index) => `    <p>Message ${index}`).join(
      '\n',
    );
    const directory = await project(`App():
  <main>
${messages}
`);
    let requests = 0;
    const interrupted: TranslationProvider = {
      id: 'openai',
      model: 'interrupted-openai',
      translate(request) {
        requests += 1;
        if (requests === 2) {
          return Promise.reject(new Error('Temporary provider failure.'));
        }
        return Promise.resolve(
          request.items.map((item) => `[${request.targetLanguage}] ${item.text}`),
        );
      },
    };

    await expect(syncI18n({ projectDirectory: directory, provider: interrupted })).rejects.toThrow(
      'Temporary provider failure',
    );
    expect(
      Object.keys((await readCatalog(join(directory, 'locales'), 'es'))?.messages ?? {}),
    ).toHaveLength(500);

    const resumed = await syncI18n({ projectDirectory: directory, provider: new FakeProvider() });
    expect(resumed).toMatchObject({ generated: 502, unchanged: 500 });
  });

  it('does not require a key or call OpenAI when a sync has no translation work', async () => {
    const directory = await project(`App():
  <p>Already translated
`);
    await syncI18n({ projectDirectory: directory, provider: new FakeProvider() });
    let requested = false;
    const { createOpenAITranslationProvider } = await import('../src/index.js');
    const provider = createOpenAITranslationProvider({
      apiKeyEnv: 'DELIBERATELY_MISSING_OPENAI_KEY',
      fetch() {
        requested = true;
        throw new Error('The provider should stay lazy.');
      },
      model: 'gpt-test',
    });

    await expect(syncI18n({ projectDirectory: directory, provider })).resolves.toMatchObject({
      generated: 0,
      unchanged: 2,
    });
    expect(requested).toBe(false);
  });
});
