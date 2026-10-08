import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseAuthoringCandidate, validateAuthoringCandidate } from './candidate-format.mjs';

const taskId = 'add-task-priority';

describe('AI authoring candidate format', () => {
  it('accepts each typed action and freezes the envelope', () => {
    for (const action of [
      { batch: { base: 16, ops: [] }, kind: 'mutation' },
      { graph: { revision: 17 }, kind: 'replaceGraph' },
      { kind: 'protocol', request: { kind: 'inspect' } },
      { kind: 'dryRun' },
    ]) {
      const candidate = validateAuthoringCandidate(
        {
          action,
          schemaVersion: 'oxe.ai-authoring-candidate.v1',
          taskId,
        },
        taskId,
      );
      assert.equal(Object.isFrozen(candidate), true);
      assert.equal(Object.isFrozen(candidate.action), true);
    }
  });

  it('rejects unknown fields, task mismatches, and malformed JSON', () => {
    assert.throws(
      () =>
        validateAuthoringCandidate(
          {
            action: { kind: 'dryRun' },
            extra: true,
            schemaVersion: 'oxe.ai-authoring-candidate.v1',
            taskId,
          },
          taskId,
        ),
      /unknown field/u,
    );
    assert.throws(
      () =>
        validateAuthoringCandidate(
          {
            action: { kind: 'dryRun' },
            schemaVersion: 'oxe.ai-authoring-candidate.v1',
            taskId: 'wrong-task',
          },
          taskId,
        ),
      /taskId/u,
    );
    assert.throws(() => parseAuthoringCandidate('{', taskId), SyntaxError);
  });
});
