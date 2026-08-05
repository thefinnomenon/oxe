import { bench, describe } from 'vitest';

import { analyzeSource, generateDomArtifact } from '../src/index.js';

const rows = Array.from(
  { length: 250 },
  (_, index) => `{ id: ${index + 1}, name: "User ${index + 1}" }`,
).join(', ');

const source = `export App():
  users = [${rows}]
  <main>
    <h1>Directory
    <ul>
      {users.map(user => <li key={user.id}>{user.name})}
`;

const analyzeDirectory = () => {
  const result = analyzeSource(source, 'compiler-benchmark.oxe', 'compiler-benchmark.oxe');
  if (!result.graph) {
    throw new Error(JSON.stringify(result.diagnostics));
  }
  return result.graph;
};

const graph = analyzeDirectory();

describe('compiler baselines', () => {
  bench('analyze a 250-row keyed collection', () => {
    analyzeDirectory();
  });

  bench('generate direct-DOM JavaScript for a 250-row keyed collection', () => {
    generateDomArtifact(graph);
  });
});
