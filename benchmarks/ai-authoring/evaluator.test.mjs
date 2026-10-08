import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import { evaluateTrial } from './held-out-evaluator.mjs';

const graphUrl = new URL('../../examples/application-graph-todo/graph.json', import.meta.url);
const task = {
  category: 'schema-ui',
  id: 'add-task-priority',
  prompt: 'Add priority.',
};

describe('held-out AI authoring evaluator', () => {
  it('accepts the exact priority semantic mutation and rejects an unchanged graph', async () => {
    const valid = await evaluateTrial({
      arm: 'compact-semantic',
      candidate: {
        action: {
          batch: {
            base: 16,
            ops: [
              {
                as: 'priority',
                default: 'normal',
                entity: 'entity.task',
                name: 'priority',
                op: 'field.add',
                type: { enum: ['low', 'normal', 'high'] },
              },
              { field: '$priority', form: 'element.createTaskForm', op: 'form.field.add' },
              { field: '$priority', list: 'element.taskList', op: 'list.display.add' },
            ],
          },
          kind: 'mutation',
        },
        schemaVersion: 'oxe.ai-authoring-candidate.v1',
        taskId: task.id,
      },
      task,
      trial: 1,
    });
    assert.deepEqual(valid, { success: true });

    const invalid = await evaluateTrial({
      arm: 'normalized-graph',
      candidate: {
        action: { graph: JSON.parse(await readFile(graphUrl, 'utf8')), kind: 'replaceGraph' },
        schemaVersion: 'oxe.ai-authoring-candidate.v1',
        taskId: task.id,
      },
      task,
      trial: 1,
    });
    assert.equal(invalid.success, false);
    assert.match(invalid.failureReason, /revision 17/u);
  });

  it('accepts a blocked removal preview and a typed immutable restore', async () => {
    const preview = await evaluateTrial({
      arm: 'compact-semantic',
      candidate: {
        action: {
          batch: {
            base: 16,
            ops: [{ node: 'query.myTasks', op: 'semantic.remove' }],
          },
          kind: 'mutation',
        },
        schemaVersion: 'oxe.ai-authoring-candidate.v1',
        taskId: 'preview-remove-task-query',
      },
      task: { id: 'preview-remove-task-query' },
      trial: 1,
    });
    assert.deepEqual(preview, { success: true });

    const restore = await evaluateTrial({
      arm: 'compact-semantic',
      candidate: {
        action: {
          kind: 'protocol',
          request: {
            appId: 'app.todo',
            operation: { baseRevision: 17, kind: 'revert', targetRevision: 16 },
            requestId: 'restore-trial',
            schemaVersion: 'oxe.application-agent-request.v1',
          },
        },
        schemaVersion: 'oxe.ai-authoring-candidate.v1',
        taskId: 'restore-prior-revision',
      },
      task: { id: 'restore-prior-revision' },
      trial: 1,
    });
    assert.deepEqual(restore, { success: true });
  });
});
