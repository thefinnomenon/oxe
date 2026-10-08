import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runTrial } from './openai-responses-adapter.mjs';

describe('OpenAI Responses authoring adapter', () => {
  it('uses a private Responses request and records exact returned usage', async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.OPENAI_API_KEY;
    const originalModel = process.env.OXE_AI_MODEL;
    const bodies = [];
    process.env.OPENAI_API_KEY = 'test-only-key';
    process.env.OXE_AI_MODEL = 'test-snapshot';
    globalThis.fetch = async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return {
        json: async () => ({
          model: 'test-snapshot',
          output: [
            {
              arguments: JSON.stringify({
                candidateJson: JSON.stringify({
                  action: { batch: { base: 16, ops: [] }, kind: 'mutation' },
                  schemaVersion: 'oxe.ai-authoring-candidate.v1',
                  taskId: 'test-task',
                }),
              }),
              call_id: 'call_1',
              name: 'submit_candidate',
              type: 'function_call',
            },
          ],
          usage: { input_tokens: 123, output_tokens: 45 },
        }),
        ok: true,
      };
    };
    try {
      const result = await runTrial({
        arm: 'normalized-graph',
        limits: { maxOutputTokens: 500, maxToolCalls: 3 },
        seed: 7,
        task: { category: 'test', id: 'test-task', prompt: 'Make the test change.' },
        trial: 1,
      });
      assert.deepEqual(result.usage, { inputTokens: 123, outputTokens: 45 });
      assert.equal(result.provider, 'openai');
      assert.equal(result.toolCalls, 1);
      assert.equal(bodies.length, 1);
      assert.equal(bodies[0].model, 'test-snapshot');
      assert.equal(bodies[0].store, false);
      assert.equal(bodies[0].parallel_tool_calls, false);
      assert.equal('temperature' in bodies[0], false);
      assert.equal('top_p' in bodies[0], false);
      assert.equal(JSON.stringify(bodies[0]).includes('test-only-key'), false);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
      if (originalModel === undefined) delete process.env.OXE_AI_MODEL;
      else process.env.OXE_AI_MODEL = originalModel;
    }
  });
});
