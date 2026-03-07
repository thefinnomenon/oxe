import { describe, expect, it } from 'vitest';

import { normalizeCrud } from '../../src/index.js';

describe('crud normalization', () => {
  it('defaults to all actions when unset', () => {
    expect(normalizeCrud()).toEqual({
      enabled: true,
      actions: ['get', 'getMany', 'create', 'update', 'delete'],
    });
  });

  it('expands sugar actions and deduplicates', () => {
    expect(normalizeCrud(['read', 'get', 'write', 'update'])).toEqual({
      enabled: true,
      actions: ['get', 'getMany', 'create', 'update'],
    });
  });

  it('disables crud when set to false', () => {
    expect(normalizeCrud(false)).toEqual({
      enabled: false,
      actions: [],
    });
  });
});
