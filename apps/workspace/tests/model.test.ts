import { describe, expect, it } from 'vitest';

import {
  filterWorkspaceNodes,
  groupWorkspaceNodes,
  semanticLabel,
  type WorkspaceNodeSummary,
} from '../src/model.js';

const nodes: readonly WorkspaceNodeSummary[] = [
  { id: 'query.myTasks', incoming: 2, kind: 'query', outgoing: 5, path: '$.queries[0]' },
  { id: 'field.task.title', incoming: 4, kind: 'field', outgoing: 1, path: '$.fields[0]' },
  { id: 'field.task.done', incoming: 3, kind: 'field', outgoing: 1, path: '$.fields[1]' },
];

describe('workspace semantic explorer model', () => {
  it('groups and sorts semantic nodes deterministically', () => {
    expect(groupWorkspaceNodes(nodes)).toEqual([
      { kind: 'field', nodes: [nodes[2], nodes[1]] },
      { kind: 'query', nodes: [nodes[0]] },
    ]);
  });

  it('filters by ID or kind and produces readable stable-ID labels', () => {
    expect(filterWorkspaceNodes(nodes, 'QUERY')).toEqual([nodes[0]]);
    expect(filterWorkspaceNodes(nodes, 'task.done')).toEqual([nodes[2]]);
    expect(filterWorkspaceNodes(nodes, '')).toBe(nodes);
    expect(semanticLabel('operation.inviteTeamMember')).toBe('invite Team Member');
  });
});
