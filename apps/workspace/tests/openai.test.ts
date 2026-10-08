import { describe, expect, it, vi } from 'vitest';

import { WORKSPACE_MODEL_REQUEST_SCHEMA, type WorkspaceModelRequestV1 } from '../src/agent.js';
import { OpenAIWorkspaceAgentModel } from '../src/openai.js';

const request = (): WorkspaceModelRequestV1 => ({
  appId: 'app.todo',
  interactions: [],
  messages: [{ role: 'user', text: 'Inspect the task view.' }],
  revision: 16,
  schemaVersion: WORKSPACE_MODEL_REQUEST_SCHEMA,
  tools: [
    {
      description: 'Inspect the graph.',
      inputSchema: { type: 'object' },
      name: 'inspect',
    },
  ],
});

describe('OpenAI workspace model adapter', () => {
  it('maps a Responses function call to the provider-neutral tool boundary', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json({
        output: [
          {
            arguments: JSON.stringify({
              inspect: { kind: 'node', semanticId: 'entity.task' },
              kind: 'inspect',
            }),
            call_id: 'call-1',
            name: 'inspect',
            type: 'function_call',
          },
        ],
      }),
    );
    const model = new OpenAIWorkspaceAgentModel({ apiKey: 'server-secret', fetch });

    await expect(model.complete(request(), new AbortController().signal)).resolves.toMatchObject({
      callId: 'call-1',
      kind: 'tool',
      tool: 'inspect',
    });
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ authorization: 'Bearer server-secret' });
    expect(String(init?.body)).not.toContain('server-secret');
    expect(String(init?.body)).toContain('"store":false');
  });

  it('maps assistant output text and reports provider failures without leaking bodies', async () => {
    const success = new OpenAIWorkspaceAgentModel({
      apiKey: 'server-secret',
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        Response.json({
          output: [
            {
              content: [{ text: 'I found the semantic button.', type: 'output_text' }],
              type: 'message',
            },
          ],
        }),
      ),
    });
    await expect(success.complete(request(), new AbortController().signal)).resolves.toMatchObject({
      kind: 'message',
      text: 'I found the semantic button.',
    });

    const failure = new OpenAIWorkspaceAgentModel({
      apiKey: 'server-secret',
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response('private provider detail', { status: 429 })),
    });
    await expect(failure.complete(request(), new AbortController().signal)).rejects.toThrow(
      'OpenAI Responses API returned HTTP 429',
    );
  });
});
