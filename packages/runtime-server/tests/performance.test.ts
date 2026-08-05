import { analyzeSource } from '@oxe/compiler';
import { describe, expect, it } from 'vitest';

import { createServerRenderPlan, renderToStringWithMetrics } from '../src/index.js';

describe('server renderer structural performance contracts', () => {
  it('renders 250 keyed rows with one collection visit and one element per row', () => {
    const rows = Array.from(
      { length: 250 },
      (_, index) => `{ id: ${index + 1}, name: "User ${index + 1}" }`,
    ).join(', ');
    const analyzed = analyzeSource(
      `export App():
  users = [${rows}]
  <ul>
    {users.map(user => <li key={user.id}>{user.name})}
`,
      'performance.oxe',
      'performance.oxe',
      { target: 'server' },
    );
    expect(analyzed.diagnostics).toEqual([]);
    if (!analyzed.graph) {
      throw new Error('The server performance fixture did not produce a semantic graph.');
    }

    const result = renderToStringWithMetrics(createServerRenderPlan(analyzed.graph));
    expect(result.metrics).toMatchObject({
      collectionItems: 250,
      components: 1,
      elements: 251,
      maxComponentDepth: 1,
      textNodes: 250,
    });
    expect(result.html.match(/<li>/gu)).toHaveLength(250);
  });
});
