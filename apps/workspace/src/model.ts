export interface WorkspaceNodeSummary {
  readonly id: string;
  readonly incoming: number;
  readonly kind: string;
  readonly outgoing: number;
  readonly path: string;
}

export interface WorkspaceNodeGroup {
  readonly kind: string;
  readonly nodes: readonly WorkspaceNodeSummary[];
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const groupWorkspaceNodes = (
  nodes: readonly WorkspaceNodeSummary[],
): readonly WorkspaceNodeGroup[] => {
  const grouped = new Map<string, WorkspaceNodeSummary[]>();
  for (const node of nodes) {
    const values = grouped.get(node.kind);
    if (values) values.push(node);
    else grouped.set(node.kind, [node]);
  }
  return [...grouped]
    .sort(([left], [right]) => compareText(left, right))
    .map(([kind, values]) => ({
      kind,
      nodes: [...values].sort((left, right) => compareText(left.id, right.id)),
    }));
};

export const filterWorkspaceNodes = (
  nodes: readonly WorkspaceNodeSummary[],
  query: string,
): readonly WorkspaceNodeSummary[] => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return nodes;
  return nodes.filter((node) => `${node.id}\n${node.kind}`.toLowerCase().includes(normalized));
};

export const semanticLabel = (semanticId: string): string =>
  semanticId
    .split('.')
    .at(-1)
    ?.replace(/([a-z0-9])([A-Z])/gu, '$1 $2') ?? semanticId;
