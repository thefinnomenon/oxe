import { analyzeSource } from '@oxe/compiler';
import { bench, describe } from 'vitest';

import {
  createDeferredServerRenderPlan,
  createJavaScriptReadinessAdapter,
  createServerRenderPlan,
  renderServerStreamToString,
  renderToString,
} from '../src/index.js';

const analyze = (source: string, asynchronous = false) => {
  const result = analyzeSource(source, 'benchmark.oxe', 'benchmark.oxe', {
    capabilities: asynchronous
      ? [
          {
            kind: 'async' as const,
            name: 'users.load',
            parameters: ['number'] as const,
            returns: 'record' as const,
          },
        ]
      : [],
    target: 'server',
  });
  if (!result.graph) throw new Error(JSON.stringify(result.diagnostics));
  return result.graph;
};

const rows = Array.from(
  { length: 250 },
  (_, index) => `{ id: ${index + 1}, name: "User ${index + 1}" }`,
).join(', ');
const blockingPlan = createServerRenderPlan(
  analyze(`export App():
  users = [${rows}]
  <ul>
    {users.map(user => <li key={user.id}>{user.name})}
`),
);

const consumers = Array.from({ length: 100 }, () => '    <p>{user.name}').join('\n');
const deferredPlan = createDeferredServerRenderPlan(
  analyze(
    `export App():
  user = users.load(1)
  <main>
${consumers}
`,
    true,
  ),
);
const readinessAdapter = createJavaScriptReadinessAdapter({
  callCapability: () => Promise.resolve({ name: 'Ada' }),
});

describe('runtime-server reference baselines', () => {
  bench('blocking SSR: 250 keyed rows', () => {
    renderToString(blockingPlan);
  });

  bench('readiness SSR: 100 consumers, one deduplicated request', async () => {
    await renderServerStreamToString(deferredPlan, readinessAdapter, {
      includeBootstrap: false,
      includeCheckpoints: false,
    });
  });
});
