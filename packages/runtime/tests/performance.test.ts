import { describe, expect, it } from 'vitest';

import { batch, createCell, createDerived, createReaction, createRoot } from '../src/index.js';

describe('reactive runtime structural performance contracts', () => {
  it('runs each fan-out consumer once for a batched update and suppresses equal writes', () => {
    const fanout = 100;
    let executions = 0;
    const root = createRoot(() => {
      const source = createCell(0);
      for (let index = 1; index <= fanout; index += 1) {
        const derived = createDerived([source], () => source.read() * index);
        createReaction([derived], () => {
          derived.read();
          executions += 1;
        });
      }
      return source;
    });

    expect(executions).toBe(fanout);
    batch(() => {
      root.value.write(1);
      root.value.write(2);
      root.value.write(3);
    });
    expect(executions).toBe(fanout * 2);

    root.value.write(3);
    expect(executions).toBe(fanout * 2);
    root.dispose();
  });
});
