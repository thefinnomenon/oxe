import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  loadTrialSuite,
  parseTrialJsonLines,
  trialCoverage,
  validateTrial,
  validateTrialSuite,
} from './trial-format.mjs';

const suite = {
  arms: ['compact-semantic', 'normalized-graph'],
  tasks: [{ id: 'task-1' }],
};
const valid = {
  arm: 'compact-semantic',
  correctionTurns: 0,
  inputTokens: 100,
  invalidMutations: 0,
  latencyMs: 250,
  model: 'test-model',
  outputTokens: 25,
  provider: 'test-provider',
  success: true,
  taskId: 'task-1',
  toolCalls: 2,
  trial: 1,
  usageSource: 'provider',
};

describe('AI authoring trial records', () => {
  it('validates a controlled trial and computes explicit coverage', () => {
    assert.deepEqual(validateTrial(valid, suite), valid);
    assert.deepEqual(trialCoverage([valid], suite, 1), {
      balanced: false,
      cells: [
        { arm: 'compact-semantic', complete: true, target: 1, taskId: 'task-1', trials: 1 },
        { arm: 'normalized-graph', complete: false, target: 1, taskId: 'task-1', trials: 0 },
      ],
      targetPerCell: 1,
    });
  });

  it('rejects unknown arms, malformed metrics, and duplicate trial identities', () => {
    assert.throws(() => validateTrial({ ...valid, arm: 'unknown' }, suite), /arm must be one of/u);
    assert.throws(() => validateTrial({ ...valid, inputTokens: -1 }, suite), /inputTokens/u);
    assert.throws(() => validateTrial({ ...valid, inputTokens: 1.5 }, suite), /inputTokens/u);
    assert.throws(
      () => validateTrial({ ...valid, usageSource: 'estimated' }, suite),
      /usageSource/u,
    );
    assert.throws(() => validateTrial({ ...valid, success: false }, suite), /failureReason/u);
    assert.throws(
      () => parseTrialJsonLines(`${JSON.stringify(valid)}\n${JSON.stringify(valid)}\n`, suite),
      /duplicate task\/arm\/trial identity/u,
    );
  });

  it('validates the checked-in multi-category task suite', async () => {
    const loaded = await loadTrialSuite();
    assert.equal(loaded.tasks.length, 10);
    assert.equal(new Set(loaded.tasks.map((task) => task.category)).size, 10);
    assert.throws(
      () =>
        validateTrialSuite({
          arms: ['a', 'b'],
          schemaVersion: 'oxe.ai-authoring-task-suite.v1',
          tasks: [{ category: 'x', expected: [], id: 'task', prompt: 'Do it.' }],
        }),
      /expected/u,
    );
  });
});
