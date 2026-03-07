import { describe, expect, it } from 'vitest';

import { toDurationSeconds, toSizeBytes, units } from '../../src/index.js';

describe('bucket unit parsing', () => {
  it('parses size and duration strings', () => {
    expect(toSizeBytes('1MB')).toBe(1_000_000);
    expect(toSizeBytes('512 KiB')).toBe(524_288);

    expect(toDurationSeconds('1h')).toBe(3_600);
    expect(toDurationSeconds('250ms')).toBe(0.25);
  });

  it('provides unit helper functions', () => {
    expect(units.size.GB(1)).toBe(1_000_000_000);
    expect(units.duration.m(2)).toBe(120);
  });
});
