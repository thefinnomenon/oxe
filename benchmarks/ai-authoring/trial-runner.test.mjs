import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createTrialSchedule, runTrialMatrix } from './matrix-runner.mjs';
import { runControlledTrial } from './trial-runner.mjs';

const suite = {
  arms: ['compact-semantic'],
  tasks: [{ category: 'test', expected: ['held-out-secret'], id: 'task-1', prompt: 'Change it.' }],
};
const task = suite.tasks[0];

describe('controlled AI authoring runner', () => {
  it('records exact provider usage and held-out evaluator success', async () => {
    const row = await runControlledTrial({
      adapter: {
        runTrial: async ({ task: publicTask }) => {
          assert.deepEqual(publicTask, {
            category: 'test',
            id: 'task-1',
            prompt: 'Change it.',
          });
          return {
            candidate: { revision: 2 },
            correctionTurns: 0,
            invalidMutations: 0,
            model: 'test-model',
            provider: 'test-provider',
            toolCalls: 2,
            usage: { inputTokens: 101, outputTokens: 23 },
          };
        },
      },
      arm: 'compact-semantic',
      evaluator: {
        evaluateTrial: async ({ candidate }) => ({ success: candidate.revision === 2 }),
      },
      now: (() => {
        const values = [10, 35];
        return () => values.shift();
      })(),
      suite,
      task,
      trial: 1,
    });
    assert.deepEqual(row, {
      arm: 'compact-semantic',
      correctionTurns: 0,
      inputTokens: 101,
      invalidMutations: 0,
      latencyMs: 25,
      model: 'test-model',
      outputTokens: 23,
      provider: 'test-provider',
      success: true,
      taskId: 'task-1',
      toolCalls: 2,
      trial: 1,
      usageSource: 'provider',
    });
  });

  it('rejects adapters that omit exact provider usage', async () => {
    await assert.rejects(
      runControlledTrial({
        adapter: { runTrial: async () => ({ candidate: {} }) },
        arm: 'compact-semantic',
        evaluator: { evaluateTrial: async () => ({ success: true }) },
        now: () => 1,
        suite,
        task,
        trial: 1,
      }),
      /provider usage/u,
    );
  });

  it('records adapter terminal failures without exposing them to the evaluator', async () => {
    const row = await runControlledTrial({
      adapter: {
        runTrial: async () => ({
          candidate: undefined,
          correctionTurns: 2,
          failureReason: 'Model exhausted its output budget.',
          invalidMutations: 1,
          model: 'test-model',
          provider: 'test-provider',
          toolCalls: 3,
          usage: { inputTokens: 50, outputTokens: 10 },
        }),
      },
      arm: 'compact-semantic',
      evaluator: {
        evaluateTrial: async () => {
          throw new Error('Evaluator must not receive a missing terminal artifact.');
        },
      },
      now: (() => {
        const values = [5, 15];
        return () => values.shift();
      })(),
      suite,
      task,
      trial: 2,
    });
    assert.equal(row.success, false);
    assert.equal(row.failureReason, 'Model exhausted its output budget.');
    assert.equal(row.inputTokens, 50);
    assert.equal(row.outputTokens, 10);
  });

  it('shuffles deterministically, resumes exact cells, and enforces the token budget', async () => {
    const matrixSuite = {
      arms: ['compact-semantic', 'normalized-graph'],
      tasks: [
        { category: 'one', id: 'task-1', prompt: 'One.' },
        { category: 'two', id: 'task-2', prompt: 'Two.' },
      ],
    };
    const existing = [{ arm: 'compact-semantic', taskId: 'task-1', trial: 1 }];
    const first = createTrialSchedule({
      arms: matrixSuite.arms,
      existing,
      seed: 42,
      suite: matrixSuite,
      trials: 2,
    });
    const second = createTrialSchedule({
      arms: matrixSuite.arms,
      existing,
      seed: 42,
      suite: matrixSuite,
      trials: 2,
    });
    assert.deepEqual(first, second);
    assert.equal(first.length, 7);

    const rows = [];
    const summary = await runTrialMatrix({
      adapter: {
        runTrial: async ({ task: trialTask }) => ({
          candidate: { taskId: trialTask.id },
          correctionTurns: 0,
          invalidMutations: 0,
          model: 'dry',
          provider: 'synthetic',
          toolCalls: 0,
          usage: { inputTokens: 4, outputTokens: 2 },
        }),
      },
      append: async (row) => rows.push(row),
      arms: matrixSuite.arms,
      concurrency: 1,
      evaluator: { evaluateTrial: async () => ({ success: true }) },
      existing,
      limits: {
        maxOutputTokens: 10,
        maxToolCalls: 3,
        maxTotalTokens: 10,
        maxTotalTrials: 10,
        timeoutMs: 5_000,
      },
      seed: 42,
      startingProviderTokens: 3,
      suite: matrixSuite,
      synthetic: true,
      trials: 2,
    });
    assert.deepEqual(summary, {
      completed: 2,
      providerTokens: 15,
      scheduled: 7,
      stoppedByTokenBudget: true,
    });
    assert.equal(rows.length, 2);
  });

  it('enforces a hard timeout even when an adapter ignores cancellation', async () => {
    await assert.rejects(
      runTrialMatrix({
        adapter: { runTrial: () => new Promise(() => undefined) },
        append: async () => undefined,
        arms: suite.arms,
        concurrency: 1,
        evaluator: { evaluateTrial: async () => ({ success: true }) },
        existing: [],
        limits: {
          maxOutputTokens: 10,
          maxToolCalls: 3,
          maxTotalTokens: 0,
          maxTotalTrials: 1,
          timeoutMs: 10,
        },
        seed: 42,
        suite,
        trials: 1,
      }),
      /exceeded 10 milliseconds/u,
    );
  });
});
