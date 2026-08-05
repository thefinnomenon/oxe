import { describe, expect, it } from 'vitest';

import { createOpenAITranslationProvider, type OpenAIFetch } from '../src/index.js';

const completed = (translations: readonly string[]): Response =>
  new Response(
    JSON.stringify({
      output: [
        {
          content: [
            {
              text: JSON.stringify({ translations }),
              type: 'output_text',
            },
          ],
          type: 'message',
        },
      ],
      status: 'completed',
    }),
    { headers: { 'Content-Type': 'application/json' }, status: 200 },
  );

describe('OpenAI translation provider', () => {
  it('uses the Responses API with strict structured output and preserves result order', async () => {
    let body: Record<string, unknown> | undefined;
    let authorization: string | null = null;
    const fetcher: OpenAIFetch = (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      authorization = new Headers(init?.headers).get('authorization');
      return Promise.resolve(completed(['Hola <x0/>', 'Historias recientes']));
    };
    const provider = createOpenAITranslationProvider({
      apiKey: 'test-key',
      fetch: fetcher,
      model: 'gpt-test',
    });

    await expect(
      provider.translate({
        glossary: [],
        items: [
          {
            context: {
              component: 'App',
              contextSelectors: [],
              element: 'h1',
              purpose: 'heading',
            },
            id: 'greeting',
            text: 'Hello <x0/>',
          },
          {
            context: {
              component: 'App',
              contextSelectors: [],
              element: 'p',
              purpose: 'body text',
            },
            id: 'stories',
            text: 'Recent stories',
          },
        ],
        sourceLanguage: 'en-US',
        targetLanguage: 'es',
      }),
    ).resolves.toEqual(['Hola <x0/>', 'Historias recientes']);
    expect(body).toMatchObject({
      model: 'gpt-test',
      reasoning: { effort: 'none' },
      store: false,
      text: {
        format: {
          name: 'oxe_translations',
          schema: { properties: { translations: { maxItems: 2, minItems: 2 } } },
          strict: true,
          type: 'json_schema',
        },
      },
    });
    expect(authorization).toBe('Bearer test-key');
  });

  it('retries transient API failures but not authentication failures', async () => {
    let requests = 0;
    const delays: number[] = [];
    const provider = createOpenAITranslationProvider({
      apiKey: 'test-key',
      fetch() {
        requests += 1;
        return Promise.resolve(
          requests === 1
            ? new Response('', { headers: { 'Retry-After': '0' }, status: 429 })
            : completed(['Bonjour']),
        );
      },
      maxRetries: 1,
      model: 'gpt-test',
      sleep(milliseconds) {
        delays.push(milliseconds);
        return Promise.resolve();
      },
    });

    await expect(
      provider.translate({
        glossary: [],
        items: [
          {
            context: {
              component: 'App',
              contextSelectors: [],
              element: 'p',
              purpose: 'body text',
            },
            id: 'hello',
            text: 'Hello',
          },
        ],
        sourceLanguage: 'en',
        targetLanguage: 'fr',
      }),
    ).resolves.toEqual(['Bonjour']);
    expect(requests).toBe(2);
    expect(delays).toEqual([0]);

    requests = 0;
    const unauthorized = createOpenAITranslationProvider({
      apiKey: 'invalid-test-key',
      fetch() {
        requests += 1;
        return Promise.resolve(
          new Response(JSON.stringify({ error: { message: 'Incorrect API key.' } }), {
            headers: { 'Content-Type': 'application/json' },
            status: 401,
          }),
        );
      },
      model: 'gpt-test',
    });
    await expect(
      unauthorized.translate({
        glossary: [],
        items: [
          {
            context: {
              component: 'App',
              contextSelectors: [],
              element: 'p',
              purpose: 'body text',
            },
            id: 'hello',
            text: 'Hello',
          },
        ],
        sourceLanguage: 'en',
        targetLanguage: 'fr',
      }),
    ).rejects.toThrow('HTTP 401: Incorrect API key.');
    expect(requests).toBe(1);
  });

  it('requires an environment key only when translation work begins', async () => {
    const provider = createOpenAITranslationProvider({
      apiKeyEnv: 'DELIBERATELY_MISSING_OPENAI_KEY',
      model: 'gpt-test',
    });

    await expect(
      provider.translate({ glossary: [], items: [], sourceLanguage: 'en', targetLanguage: 'de' }),
    ).resolves.toEqual([]);
    await expect(
      provider.translate({
        glossary: [],
        items: [
          {
            context: {
              component: 'App',
              contextSelectors: [],
              element: 'p',
              purpose: 'body text',
            },
            id: 'hello',
            text: 'Hello',
          },
        ],
        sourceLanguage: 'en',
        targetLanguage: 'de',
      }),
    ).rejects.toThrow('Set DELIBERATELY_MISSING_OPENAI_KEY');
  });

  it('rejects incomplete structured translation output', async () => {
    const provider = createOpenAITranslationProvider({
      apiKey: 'test-key',
      fetch: () => Promise.resolve(completed(['Only one'])),
      model: 'gpt-test',
    });

    await expect(
      provider.translate({
        glossary: [],
        items: [
          {
            context: {
              component: 'App',
              contextSelectors: [],
              element: 'p',
              purpose: 'body text',
            },
            id: 'first',
            text: 'First',
          },
          {
            context: {
              component: 'App',
              contextSelectors: [],
              element: 'p',
              purpose: 'body text',
            },
            id: 'second',
            text: 'Second',
          },
        ],
        sourceLanguage: 'en',
        targetLanguage: 'de',
      }),
    ).rejects.toThrow('returned 1 translations; expected 2');
  });
});
