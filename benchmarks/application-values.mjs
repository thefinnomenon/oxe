import { readFile } from 'node:fs/promises';

import {
  applicationValueMatchesType,
  createStandardApplicationCapability,
  loadApplicationGraph,
  measureCompactApplicationProjection,
  projectCompactApplicationGraph,
  serializeApplicationGraph,
} from '../packages/graph/dist/index.js';

const graph = loadApplicationGraph(
  JSON.parse(
    await readFile(
      new URL('../examples/application-graph-todo/graph.json', import.meta.url),
      'utf8',
    ),
  ),
);
const capabilities = [
  'email',
  'objectStorage',
  'payments',
  'realtime',
  'search',
  'webhookDelivery',
].map((kind) => createStandardApplicationCapability(kind));
const capabilityGraph = loadApplicationGraph({ ...graph, capabilities });
const compact = projectCompactApplicationGraph(capabilityGraph);
const normalized = serializeApplicationGraph(capabilityGraph);
const valueType = {
  items: {
    fields: {
      amount: { kind: 'decimal', precision: 12, scale: 2 },
      attempts: { kind: 'integer', maximum: 10, minimum: 0 },
      callback: { kind: 'optional', value: { kind: 'url' } },
      contact: { kind: 'email' },
    },
    kind: 'record',
  },
  kind: 'list',
  maximumItems: 100,
};
const values = Array.from({ length: 100 }, (_, index) => ({
  amount: `${index}.25`,
  attempts: index % 10,
  callback: index % 2 === 0 ? null : `https://example.test/${index}`,
  contact: `person-${index}@example.test`,
}));
const rounds = [];
for (let round = 0; round < 9; round += 1) {
  const startedAt = performance.now();
  for (let iteration = 0; iteration < 5_000; iteration += 1) {
    if (!applicationValueMatchesType(values, valueType))
      throw new Error('Valid benchmark value failed.');
  }
  rounds.push(((performance.now() - startedAt) * 1_000) / 5_000);
}
rounds.sort((left, right) => left - right);
const compactBytes = Buffer.byteLength(compact);
const normalizedBytes = Buffer.byteLength(normalized);
process.stdout.write(
  `${JSON.stringify(
    {
      claimScope: 'local deterministic runtime and representation proxy',
      representation: {
        compact: measureCompactApplicationProjection(compact),
        compactVsNormalizedRatio: normalizedBytes / compactBytes,
        normalizedBytes,
        standardCapabilityCount: capabilities.length,
      },
      validation: {
        iterationsPerRound: 5_000,
        medianMicrosecondsPerHundredRecordValue: rounds[Math.floor(rounds.length / 2)],
        rounds: rounds.length,
      },
    },
    null,
    2,
  )}\n`,
);
