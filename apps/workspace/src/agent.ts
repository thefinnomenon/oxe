import {
  parseApplicationDevelopmentInteraction,
  type ApplicationAgentRequestV1,
  type ApplicationAgentResponseV1,
  type ApplicationDevelopmentInteractionV1,
  type ApplicationMutationBatchV1,
} from '@oxe/graph';

import type { ApplicationDevelopmentSession } from '@oxe/compiler/application-session';

export const WORKSPACE_MODEL_REQUEST_SCHEMA = 'oxe.workspace-model-request.v1' as const;
export const WORKSPACE_MODEL_RESPONSE_SCHEMA = 'oxe.workspace-model-response.v1' as const;

type InspectionOperation = Extract<
  ApplicationAgentRequestV1['operation'],
  { readonly kind: 'inspect' }
>;
type PreviewResult = Extract<
  Extract<ApplicationAgentResponseV1, { readonly ok: true }>['result'],
  { readonly kind: 'preview' }
>;

export interface WorkspaceConversationMessageV1 {
  readonly role: 'assistant' | 'user';
  readonly text: string;
}

export interface WorkspaceModelMessageV1 {
  readonly callId?: string;
  readonly role: 'assistant' | 'system' | 'tool' | 'user';
  readonly text: string;
}

export interface WorkspaceModelToolV1 {
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly name: 'inspect' | 'preview';
}

export interface WorkspaceModelRequestV1 {
  readonly appId: string;
  readonly interactions: readonly ApplicationDevelopmentInteractionV1[];
  readonly messages: readonly WorkspaceModelMessageV1[];
  readonly revision: number;
  readonly schemaVersion: typeof WORKSPACE_MODEL_REQUEST_SCHEMA;
  readonly tools: readonly WorkspaceModelToolV1[];
}

export type WorkspaceModelResponseV1 =
  | {
      readonly kind: 'message';
      readonly schemaVersion: typeof WORKSPACE_MODEL_RESPONSE_SCHEMA;
      readonly text: string;
    }
  | {
      readonly callId: string;
      readonly input: InspectionOperation;
      readonly kind: 'tool';
      readonly schemaVersion: typeof WORKSPACE_MODEL_RESPONSE_SCHEMA;
      readonly tool: 'inspect';
    }
  | {
      readonly callId: string;
      readonly input: ApplicationMutationBatchV1;
      readonly kind: 'tool';
      readonly schemaVersion: typeof WORKSPACE_MODEL_RESPONSE_SCHEMA;
      readonly tool: 'preview';
    };

export interface WorkspaceAgentModelV1 {
  complete(
    request: WorkspaceModelRequestV1,
    signal: AbortSignal,
  ): Promise<WorkspaceModelResponseV1>;
}

export type WorkspaceChatEventV1 =
  | { readonly kind: 'message'; readonly text: string }
  | {
      readonly detail: string;
      readonly kind: 'progress';
      readonly stage: 'inspecting' | 'previewing' | 'thinking';
      readonly step: number;
    }
  | {
      readonly batch: ApplicationMutationBatchV1;
      readonly kind: 'preview';
      readonly result: PreviewResult;
    }
  | {
      readonly kind: 'tool';
      readonly name: 'inspect' | 'preview';
      readonly response: ApplicationAgentResponseV1;
    };

export interface WorkspaceChatRequestV1 {
  readonly interactions: readonly ApplicationDevelopmentInteractionV1[];
  readonly messages: readonly WorkspaceConversationMessageV1[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

export const parseWorkspaceChatRequest = (value: unknown): WorkspaceChatRequestV1 => {
  if (
    !isRecord(value) ||
    !Object.keys(value).every((key) => key === 'interactions' || key === 'messages') ||
    !Object.hasOwn(value, 'messages') ||
    !Array.isArray(value.messages)
  )
    throw new TypeError('Workspace chat request must contain messages and optional interactions.');
  if (value.messages.length === 0 || value.messages.length > 40)
    throw new TypeError('Workspace chat requires between 1 and 40 messages.');
  let characters = 0;
  const messages = value.messages.map((candidate, index): WorkspaceConversationMessageV1 => {
    if (!isRecord(candidate) || !exactKeys(candidate, ['role', 'text']))
      throw new TypeError(`Workspace chat message ${index} has invalid fields.`);
    if (candidate.role !== 'assistant' && candidate.role !== 'user')
      throw new TypeError(`Workspace chat message ${index} has an invalid role.`);
    if (
      typeof candidate.text !== 'string' ||
      candidate.text.trim().length === 0 ||
      candidate.text.length > 8_000
    )
      throw new TypeError(`Workspace chat message ${index} has invalid text.`);
    characters += candidate.text.length;
    return Object.freeze({ role: candidate.role, text: candidate.text });
  });
  if (messages.at(-1)?.role !== 'user')
    throw new TypeError('Workspace chat must end with a user message.');
  if (characters > 32_000) throw new TypeError('Workspace chat history is too large.');
  const candidates = value.interactions ?? [];
  if (!Array.isArray(candidates) || candidates.length > 20)
    throw new TypeError('Workspace chat accepts at most 20 development interactions.');
  const interactions = candidates.map((candidate, index) => {
    try {
      return parseApplicationDevelopmentInteraction(candidate);
    } catch (error) {
      throw new TypeError(
        `Workspace development interaction ${index} is invalid: ${error instanceof Error ? error.message : 'invalid interaction'}`,
      );
    }
  });
  return Object.freeze({
    interactions: Object.freeze(interactions),
    messages: Object.freeze(messages),
  });
};

export const parseWorkspaceModelResponse = (value: unknown): WorkspaceModelResponseV1 => {
  if (!isRecord(value) || value.schemaVersion !== WORKSPACE_MODEL_RESPONSE_SCHEMA)
    throw new TypeError('Workspace model returned an invalid schema.');
  if (value.kind === 'message') {
    if (
      !exactKeys(value, ['kind', 'schemaVersion', 'text']) ||
      typeof value.text !== 'string' ||
      value.text.trim().length === 0 ||
      value.text.length > 16_000
    )
      throw new TypeError('Workspace model returned an invalid message.');
    return value as unknown as WorkspaceModelResponseV1;
  }
  if (
    value.kind !== 'tool' ||
    !exactKeys(value, ['callId', 'input', 'kind', 'schemaVersion', 'tool']) ||
    typeof value.callId !== 'string' ||
    value.callId.length === 0 ||
    value.callId.length > 120 ||
    (value.tool !== 'inspect' && value.tool !== 'preview') ||
    !isRecord(value.input)
  )
    throw new TypeError('Workspace model returned an invalid tool call.');
  if (value.tool === 'inspect' && value.input.kind !== 'inspect')
    throw new TypeError('Workspace model inspect calls must contain an inspect operation.');
  if (value.tool === 'preview' && (!('base' in value.input) || !('ops' in value.input)))
    throw new TypeError('Workspace model preview calls must contain a mutation batch.');
  return value as unknown as WorkspaceModelResponseV1;
};

export interface FetchWorkspaceAgentModelOptionsV1 {
  readonly endpoint: string | URL;
  readonly fetch?: typeof fetch;
  readonly headers?: HeadersInit;
  readonly maximumResponseBytes?: number;
}

/** Provider-neutral JSON transport. Provider adapters translate their native API to this boundary. */
export class FetchWorkspaceAgentModel implements WorkspaceAgentModelV1 {
  readonly #endpoint: string | URL;
  readonly #fetch: typeof fetch;
  readonly #headers: Headers;
  readonly #maximumResponseBytes: number;

  public constructor(options: FetchWorkspaceAgentModelOptionsV1) {
    this.#endpoint = options.endpoint;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#headers = new Headers(options.headers);
    this.#maximumResponseBytes = options.maximumResponseBytes ?? 1_048_576;
  }

  public async complete(
    request: WorkspaceModelRequestV1,
    signal: AbortSignal,
  ): Promise<WorkspaceModelResponseV1> {
    const headers = new Headers(this.#headers);
    headers.set('accept', 'application/json');
    headers.set('content-type', 'application/json; charset=utf-8');
    const response = await this.#fetch(this.#endpoint, {
      body: JSON.stringify(request),
      headers,
      method: 'POST',
      redirect: 'error',
      signal,
    });
    if (!response.ok) throw new Error(`Workspace model endpoint returned HTTP ${response.status}.`);
    const source = await response.text();
    if (new TextEncoder().encode(source).byteLength > this.#maximumResponseBytes)
      throw new Error('Workspace model response is too large.');
    return parseWorkspaceModelResponse(JSON.parse(source) as unknown);
  }
}

const tools: readonly WorkspaceModelToolV1[] = Object.freeze([
  Object.freeze({
    description:
      'Inspect the compact map, bounded node lists, a node and its edges, incoming references, revision history, revision diffs, or semantic search results.',
    inputSchema: Object.freeze({
      properties: {
        inspect: { type: 'object' },
        kind: { const: 'inspect' },
        revision: { minimum: 0, type: 'integer' },
      },
      required: ['inspect', 'kind'],
      type: 'object',
    }),
    name: 'inspect' as const,
  }),
  Object.freeze({
    description:
      'Preview one typed atomic semantic mutation batch. This never publishes; only the human review card can commit its fingerprint.',
    inputSchema: Object.freeze({
      properties: {
        base: { minimum: 0, type: 'integer' },
        ops: { items: { type: 'object' }, minItems: 1, type: 'array' },
      },
      required: ['base', 'ops'],
      type: 'object',
    }),
    name: 'preview' as const,
  }),
]);

const systemMessage = (
  projection: string,
  interactions: readonly ApplicationDevelopmentInteractionV1[],
): string => `You are the OXE graph-first development agent.
The normalized application graph and immutable revisions are authoritative. Source and generated JavaScript are disposable projections.
Use inspection tools for missing context. Submit only typed atomic semantic previews. You cannot commit; the user reviews and commits a fingerprinted preview.
Do not claim a mutation is published after preview. Keep prose concise and reference stable semantic IDs.

Current compact semantic projection:
${projection}

Recent privacy-safe preview interactions (oldest to newest):
${
  interactions.length === 0
    ? '(none captured)'
    : interactions
        .map((interaction) =>
          JSON.stringify({
            kind: interaction.kind,
            ...(interaction.outcome ? { outcome: interaction.outcome } : {}),
            route: interaction.route,
            ...(interaction.target ? { target: interaction.target } : {}),
          }),
        )
        .join('\n')
}`;

const protocolSummary = (response: ApplicationAgentResponseV1): string =>
  JSON.stringify(
    response.ok
      ? { ok: true, result: response.result, revision: response.revision }
      : { diagnostics: response.diagnostics, ok: false },
  );

/** Runs a bounded model/tool loop. Model code never receives a commit capability. */
export const streamWorkspaceChat = async function* (
  session: ApplicationDevelopmentSession,
  model: WorkspaceAgentModelV1,
  appId: string,
  conversation: readonly WorkspaceConversationMessageV1[],
  signal: AbortSignal,
  interactions: readonly ApplicationDevelopmentInteractionV1[] = [],
  maximumSteps = 8,
): AsyncGenerator<WorkspaceChatEventV1> {
  const map = session.request(appId, 'workspace-chat-map', {
    inspect: { kind: 'map' },
    kind: 'inspect',
  });
  if (!map.ok || map.result.kind !== 'inspect.map')
    throw new Error('The application compact projection is unavailable.');
  const messages: WorkspaceModelMessageV1[] = [
    { role: 'system', text: systemMessage(map.result.projection, interactions) },
    ...conversation,
  ];
  for (let step = 0; step < maximumSteps; step += 1) {
    if (signal.aborted) throw signal.reason;
    const graph = session.store.current(appId);
    if (!graph) throw new Error(`Application ${JSON.stringify(appId)} is unavailable.`);
    yield {
      detail: step === 0 ? 'Reading the graph and recent preview context…' : 'Continuing…',
      kind: 'progress',
      stage: 'thinking',
      step: step + 1,
    };
    const response = await model.complete(
      {
        appId,
        interactions,
        messages: Object.freeze([...messages]),
        revision: graph.revision,
        schemaVersion: WORKSPACE_MODEL_REQUEST_SCHEMA,
        tools,
      },
      signal,
    );
    if (response.kind === 'message') {
      yield { kind: 'message', text: response.text };
      return;
    }
    const operation: ApplicationAgentRequestV1['operation'] =
      response.tool === 'inspect' ? response.input : { batch: response.input, kind: 'preview' };
    yield {
      detail:
        response.tool === 'inspect'
          ? 'Inspecting the semantic graph…'
          : 'Validating a typed semantic revision…',
      kind: 'progress',
      stage: response.tool === 'inspect' ? 'inspecting' : 'previewing',
      step: step + 1,
    };
    const protocol = session.request(
      appId,
      `workspace-chat-${step + 1}-${response.callId}`,
      operation,
    );
    yield { kind: 'tool', name: response.tool, response: protocol };
    if (response.tool === 'preview' && protocol.ok && protocol.result.kind === 'preview')
      yield { batch: response.input, kind: 'preview', result: protocol.result };
    messages.push(
      {
        role: 'assistant',
        text: JSON.stringify({ callId: response.callId, tool: response.tool }),
      },
      {
        callId: response.callId,
        role: 'tool',
        text: protocolSummary(protocol),
      },
    );
  }
  throw new Error(`Workspace agent exceeded its ${maximumSteps}-step tool budget.`);
};
