import type {
  WorkspaceAgentModelV1,
  WorkspaceModelRequestV1,
  WorkspaceModelResponseV1,
} from './agent.js';
import { parseWorkspaceModelResponse, WORKSPACE_MODEL_RESPONSE_SCHEMA } from './agent.js';

export interface OpenAIWorkspaceAgentModelOptionsV1 {
  readonly apiKey: string;
  readonly endpoint?: string | URL;
  readonly fetch?: typeof fetch;
  readonly model?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const modelInput = (request: WorkspaceModelRequestV1): readonly Record<string, unknown>[] =>
  request.messages.map((message) => ({
    content:
      message.role === 'tool'
        ? `<tool_result call_id=${JSON.stringify(message.callId ?? '')}>${message.text}</tool_result>`
        : message.text,
    role: message.role === 'tool' ? 'user' : message.role,
  }));

const parseResponse = (value: unknown): WorkspaceModelResponseV1 => {
  if (!isRecord(value) || !Array.isArray(value.output))
    throw new TypeError('OpenAI returned an invalid response.');
  const toolCall = value.output.find(
    (item): item is Record<string, unknown> => isRecord(item) && item.type === 'function_call',
  );
  if (toolCall) {
    if (
      typeof toolCall.call_id !== 'string' ||
      (toolCall.name !== 'inspect' && toolCall.name !== 'preview') ||
      typeof toolCall.arguments !== 'string'
    )
      throw new TypeError('OpenAI returned an invalid function call.');
    const input = JSON.parse(toolCall.arguments) as unknown;
    if (!isRecord(input)) throw new TypeError('OpenAI function arguments must be an object.');
    return parseWorkspaceModelResponse({
      callId: toolCall.call_id,
      input,
      kind: 'tool',
      schemaVersion: WORKSPACE_MODEL_RESPONSE_SCHEMA,
      tool: toolCall.name,
    });
  }
  const text = value.output
    .filter((item): item is Record<string, unknown> => isRecord(item) && item.type === 'message')
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .filter(
      (item): item is Record<string, unknown> =>
        isRecord(item) && item.type === 'output_text' && typeof item.text === 'string',
    )
    .map((item) => item.text as string)
    .join('')
    .trim();
  if (!text) throw new TypeError('OpenAI returned neither a message nor a function call.');
  return {
    kind: 'message',
    schemaVersion: WORKSPACE_MODEL_RESPONSE_SCHEMA,
    text,
  };
};

/** Server-only OpenAI Responses adapter for the provider-neutral workspace model boundary. */
export class OpenAIWorkspaceAgentModel implements WorkspaceAgentModelV1 {
  readonly #apiKey: string;
  readonly #endpoint: string | URL;
  readonly #fetch: typeof fetch;
  readonly #model: string;

  public constructor(options: OpenAIWorkspaceAgentModelOptionsV1) {
    if (!options.apiKey.trim()) throw new TypeError('OpenAI API key is required.');
    this.#apiKey = options.apiKey;
    this.#endpoint = options.endpoint ?? 'https://api.openai.com/v1/responses';
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#model = options.model ?? 'gpt-5.6-sol';
  }

  public async complete(
    request: WorkspaceModelRequestV1,
    signal: AbortSignal,
  ): Promise<WorkspaceModelResponseV1> {
    const response = await this.#fetch(this.#endpoint, {
      body: JSON.stringify({
        input: modelInput(request),
        model: this.#model,
        parallel_tool_calls: false,
        store: false,
        tool_choice: 'auto',
        tools: request.tools.map((tool) => ({
          description: tool.description,
          name: tool.name,
          parameters: tool.inputSchema,
          strict: false,
          type: 'function',
        })),
      }),
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${this.#apiKey}`,
        'content-type': 'application/json; charset=utf-8',
      },
      method: 'POST',
      redirect: 'error',
      signal,
    });
    if (!response.ok) throw new Error(`OpenAI Responses API returned HTTP ${response.status}.`);
    return parseResponse((await response.json()) as unknown);
  }
}
