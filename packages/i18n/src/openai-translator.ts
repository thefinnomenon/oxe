import type { TranslationProvider, TranslationRequest } from './types.js';

export const DEFAULT_OPENAI_TRANSLATION_MODEL = 'gpt-5.6-luna';

const defaultEndpoint = 'https://api.openai.com/v1/responses';
const defaultApiKeyEnvironment = 'OPENAI_API_KEY';
const defaultMaxRetries = 3;
const requestTimeoutMilliseconds = 120_000;

export type OpenAIFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface OpenAITranslationProviderOptions {
  readonly apiKey?: string;
  readonly apiKeyEnv?: string;
  readonly endpoint?: string;
  readonly fetch?: OpenAIFetch;
  readonly maxRetries?: number;
  readonly model?: string;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const isTransientStatus = (status: number): boolean =>
  status === 408 || status === 409 || status === 429 || status >= 500;

const retryDelay = (response: Response, attempt: number): number => {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, 30_000);
    }
  }
  return Math.min(500 * 2 ** attempt, 8_000);
};

const errorMessage = (value: unknown): string | undefined => {
  const root = object(value);
  const error = object(root?.error);
  return typeof error?.message === 'string' ? error.message : undefined;
};

const outputText = (value: unknown): string => {
  const root = object(value);
  const apiError = errorMessage(root);
  if (apiError) {
    throw new Error(`OpenAI translation failed: ${apiError}`);
  }
  if (root?.status !== undefined && root.status !== 'completed') {
    throw new Error(`OpenAI translation did not complete (status: ${String(root.status)}).`);
  }
  if (!Array.isArray(root?.output)) {
    throw new TypeError('OpenAI returned a response without output items.');
  }
  const parts: string[] = [];
  for (const item of root.output) {
    const message = object(item);
    if (!Array.isArray(message?.content)) {
      continue;
    }
    for (const content of message.content) {
      const part = object(content);
      if (part?.type === 'refusal' && typeof part.refusal === 'string') {
        throw new Error(`OpenAI declined the translation request: ${part.refusal}`);
      }
      if (part?.type === 'output_text' && typeof part.text === 'string') {
        parts.push(part.text);
      }
    }
  }
  if (parts.length === 0) {
    throw new TypeError('OpenAI returned no translation output text.');
  }
  return parts.join('');
};

const translationsFromResponse = (value: unknown, expected: number): readonly string[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText(value)) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new TypeError('OpenAI returned malformed structured translation output.');
    }
    throw error;
  }
  const translations = object(parsed)?.translations;
  if (
    !Array.isArray(translations) ||
    translations.length !== expected ||
    translations.some((translation) => typeof translation !== 'string')
  ) {
    throw new TypeError(
      `OpenAI returned ${Array.isArray(translations) ? translations.length : 0} translations; expected ${expected}.`,
    );
  }
  return translations as readonly string[];
};

const requestBody = (
  request: TranslationRequest,
  model: string,
): Readonly<Record<string, unknown>> => ({
  input: JSON.stringify({
    glossary: request.glossary,
    messages: request.items,
    sourceLocale: request.sourceLanguage,
    targetLocale: request.targetLanguage,
  }),
  instructions: `Localize each product-interface message from ${request.sourceLanguage} to ${request.targetLanguage}, returning one concise, natural result in the same order. Use each message's UI context and purpose. When variation is present, produce the grammatical ${request.targetLanguage} form for its cardinal or ordinal category and example number even if the source uses another form. Follow the glossary exactly: preserve protected terms and use supplied target terms. Preserve every placeholder and XML-like marker exactly; never alter, add, remove, translate, or duplicate markers such as {name}, <strong>, </strong>, or <x0/>. Return no commentary.`,
  model,
  reasoning: { effort: 'none' },
  store: false,
  text: {
    format: {
      name: 'oxe_translations',
      schema: {
        additionalProperties: false,
        properties: {
          translations: {
            items: { type: 'string' },
            maxItems: request.items.length,
            minItems: request.items.length,
            type: 'array',
          },
        },
        required: ['translations'],
        type: 'object',
      },
      strict: true,
      type: 'json_schema',
    },
  },
});

export const createOpenAITranslationProvider = (
  options: OpenAITranslationProviderOptions = {},
): TranslationProvider => {
  const model = options.model ?? DEFAULT_OPENAI_TRANSLATION_MODEL;
  const apiKeyEnv = options.apiKeyEnv ?? defaultApiKeyEnvironment;
  const fetcher = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxRetries = options.maxRetries ?? defaultMaxRetries;
  if (model.length === 0) {
    throw new TypeError('The OpenAI translation model id cannot be empty.');
  }
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) {
    throw new RangeError('OpenAI maxRetries must be an integer from 0 through 10.');
  }

  return {
    id: 'openai',
    model,
    async translate(request: TranslationRequest): Promise<readonly string[]> {
      if (request.items.length === 0) {
        return [];
      }
      const apiKey = options.apiKey ?? process.env[apiKeyEnv];
      if (!apiKey) {
        throw new Error(
          `Missing OpenAI API key. Set ${apiKeyEnv}, or change i18n.translation.apiKeyEnv in oxe.config.json.`,
        );
      }

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        let response: Response;
        try {
          response = await fetcher(options.endpoint ?? defaultEndpoint, {
            body: JSON.stringify(requestBody(request, model)),
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            method: 'POST',
            signal: AbortSignal.timeout(requestTimeoutMilliseconds),
          });
        } catch (error) {
          if (attempt < maxRetries) {
            await sleep(Math.min(500 * 2 ** attempt, 8_000));
            continue;
          }
          throw new Error(`Could not reach OpenAI: ${(error as Error).message}`);
        }

        if (response.ok) {
          return translationsFromResponse(await response.json(), request.items.length);
        }
        if (isTransientStatus(response.status) && attempt < maxRetries) {
          const delay = retryDelay(response, attempt);
          await response.text();
          await sleep(delay);
          continue;
        }
        let message: string | undefined;
        try {
          message = errorMessage(await response.json());
        } catch {
          // Preserve the stable status-only error when the provider did not return JSON.
        }
        throw new Error(
          `OpenAI translation request failed with HTTP ${response.status}${message ? `: ${message}` : '.'}`,
        );
      }
      throw new Error('OpenAI translation retries were exhausted.');
    },
  };
};
