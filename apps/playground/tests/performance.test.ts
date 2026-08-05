import { describe, expect, it } from 'vitest';

import { summarizeDurations } from '../src/performance.js';

describe('playground performance summaries', () => {
  it('calculates stable medians and nearest-rank p95 values', () => {
    expect(summarizeDurations([20, 1, 4, 2, 3])).toEqual({
      maximum: 20,
      median: 3,
      minimum: 1,
      p95: 20,
    });
    expect(summarizeDurations([4, 2])).toEqual({
      maximum: 4,
      median: 3,
      minimum: 2,
      p95: 4,
    });
    expect(summarizeDurations([])).toBeUndefined();
  });
});
