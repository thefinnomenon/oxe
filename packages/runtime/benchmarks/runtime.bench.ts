import { afterAll, bench, describe } from 'vitest';

import { batch, createCell, createDerived, createReaction, createRoot } from '../src/index.js';

let checksum = 0;
const graph = createRoot(() => {
  const source = createCell(0, { name: 'benchmark source' });
  for (let index = 1; index <= 100; index += 1) {
    const derived = createDerived([source], () => source.read() * index, {
      name: `derived ${index}`,
    });
    createReaction([derived], () => {
      checksum += derived.read();
    });
  }
  return source;
});

let nextValue = 0;

afterAll(() => graph.dispose());

describe('reactive runtime baselines', () => {
  bench('propagate one write through 100 explicit computations', () => {
    nextValue += 1;
    graph.value.write(nextValue);
    void checksum;
  });

  bench('batch four writes through 100 explicit computations', () => {
    batch(() => {
      for (let offset = 1; offset <= 4; offset += 1) {
        nextValue += 1;
        graph.value.write(nextValue);
      }
    });
    void checksum;
  });
});
