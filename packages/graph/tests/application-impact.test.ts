import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  analyzeApplicationGraphImpact,
  formatApplicationGraphImpact,
  loadApplicationGraph,
  mutateApplicationGraph,
  previewApplicationMutation,
  type ApplicationGraphV1,
} from '../src/index.js';

const fixtureUrl = new URL('../../../examples/application-graph-todo/graph.json', import.meta.url);
const todoGraph = (): ApplicationGraphV1 =>
  loadApplicationGraph(JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown);

describe('application semantic impact and structural mutations', () => {
  it('previews a deterministic incoming dependency closure without publishing a draft', () => {
    const graph = todoGraph();
    const query = graph.queries.find((candidate) => candidate.id === 'query.myTasks');
    if (!query) throw new Error('Todo query is missing.');
    const preview = previewApplicationMutation(graph, {
      base: graph.revision,
      ops: [{ node: { ...query, cache: { kind: 'no-store' } }, op: 'semantic.replace' }],
    });

    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error(preview.result.diagnostics[0]?.message);
    expect(preview.result.graph).not.toBe(graph);
    expect(graph.revision).toBe(16);
    expect(preview.impact.changes).toEqual([
      { change: 'changed', id: 'query.myTasks', kind: 'query' },
    ]);
    expect(preview.impact.impacted).toEqual(
      expect.arrayContaining([
        { id: 'query.myTasks', kind: 'query', reason: 'changed' },
        { id: 'view.tasks', kind: 'view', reason: 'dependent' },
      ]),
    );
    expect(analyzeApplicationGraphImpact(graph, preview.result.graph)).toEqual(preview.impact);
    expect(formatApplicationGraphImpact(preview.impact)).toBe(
      [
        'impact changes=1 affected=5',
        'change changed query query.myTasks',
        'because dependent app app.todo',
        'because dependent verificationFlow flow.createTask',
        'because dependent route route.tasks',
        'because dependent view view.tasks',
        '',
      ].join('\n'),
    );
  });

  it('renames stable symbols and edits policies without changing semantic IDs', () => {
    const graph = todoGraph();
    const result = mutateApplicationGraph(graph, {
      base: graph.revision,
      ops: [
        { name: 'label', node: 'field.task.title', op: 'symbol.rename' },
        {
          action: 'read',
          op: 'policy.rule.set',
          policy: 'policy.task',
          predicate: { kind: 'relationEqualsActor', relation: 'relation.taskOwner' },
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.diagnostics[0]?.message);
    expect(result.graph.fields.find((field) => field.id === 'field.task.title')?.name).toBe(
      'label',
    );
    expect(result.graph.policies.find((policy) => policy.id === 'policy.task')?.rules.read).toEqual(
      { kind: 'relationEqualsActor', relation: 'relation.taskOwner' },
    );
    expect(result.changes.map((change) => change.kind)).toEqual([
      'symbol.renamed',
      'policy.rule.set',
    ]);
  });

  it('rejects removal while references remain and keeps the original graph atomic', () => {
    const graph = todoGraph();
    const result = mutateApplicationGraph(graph, {
      base: graph.revision,
      ops: [{ node: 'query.myTasks', op: 'semantic.remove' }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected referenced removal to fail.');
    expect(result.graph).toBe(graph);
    expect(result.graphDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OXE3103',
          message: 'Semantic reference "query.myTasks" does not resolve.',
        }),
      ]),
    );
    const preview = previewApplicationMutation(graph, {
      base: graph.revision,
      ops: [{ node: 'query.myTasks', op: 'semantic.remove' }],
    });
    expect(preview.ok).toBe(false);
    if (!preview.ok)
      expect(preview.incomingReferences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sourceId: 'view.tasks', targetId: 'query.myTasks' }),
          expect.objectContaining({ sourceId: 'flow.createTask', targetId: 'query.myTasks' }),
        ]),
      );
  });

  it('moves identified UI children atomically and rejects descendant cycles', () => {
    const graph = todoGraph();
    const result = mutateApplicationGraph(graph, {
      base: graph.revision,
      ops: [
        {
          element: 'element.createTaskForm',
          index: 0,
          op: 'ui.move',
          parent: 'element.inviteTeamMemberForm',
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.diagnostics[0]?.message);
    expect(result.changes).toEqual([
      {
        elementId: 'element.createTaskForm',
        index: 0,
        kind: 'ui.moved',
        parentId: 'element.inviteTeamMemberForm',
        viewId: 'view.tasks',
      },
    ]);
    const cycle = mutateApplicationGraph(result.graph, {
      base: result.revision,
      ops: [
        {
          element: 'element.inviteTeamMemberForm',
          index: 0,
          op: 'ui.move',
          parent: 'element.createTaskForm',
        },
      ],
    });
    expect(cycle.ok).toBe(false);
    if (!cycle.ok) expect(cycle.diagnostics[0]?.message).toContain('descendants');
  });
});
