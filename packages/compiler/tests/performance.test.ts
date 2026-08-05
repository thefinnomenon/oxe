import { describe, expect, it } from 'vitest';

import { analyzeSource, generateDomArtifact } from '../src/index.js';

const compileDirectory = (rowCount: number) => {
  const rows = Array.from(
    { length: rowCount },
    (_, index) => `{ id: ${index + 1}, name: "User ${index + 1}" }`,
  ).join(', ');
  const source = `export App():
  users = [${rows}]
  <ul>
    {users.map(user => <li key={user.id}>{user.name})}
`;
  const result = analyzeSource(source, 'performance.oxe', 'performance.oxe');
  expect(result.diagnostics).toEqual([]);
  if (!result.graph) {
    throw new Error('The performance fixture did not produce a semantic graph.');
  }
  const artifact = generateDomArtifact(result.graph);
  return {
    artifact,
    graph: result.graph,
    moduleBytes: Buffer.byteLength(artifact.moduleSource),
  };
};

describe('compiler structural performance contracts', () => {
  it('keeps keyed collection lowering linear as literal input doubles', () => {
    const small = compileDirectory(100);
    const large = compileDirectory(200);

    expect(large.graph.nodes).toHaveLength(small.graph.nodes.length);
    expect(large.graph.edges).toHaveLength(small.graph.edges.length);
    expect(large.moduleBytes).toBeGreaterThan(small.moduleBytes);
    expect(large.moduleBytes).toBeLessThan(small.moduleBytes * 2.2);
    expect(large.artifact.moduleSource).not.toContain('innerHTML');
  });
});
