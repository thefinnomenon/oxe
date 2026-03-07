import { describe, expect, it } from 'vitest';

import { auth, normalizeAuth, role } from '../../src/index.js';

describe('auth normalization', () => {
  it('normalizes read/write sugar and canonical actions', () => {
    const normalized = normalizeAuth({
      read: 'public',
      write: ['admin', 'owner'],
      update: ['editor'],
      delete: 'private',
    });

    expect(normalized.get).toEqual(['public']);
    expect(normalized.getMany).toEqual(['public']);
    expect(normalized.create).toEqual(['admin', 'owner']);
    expect(normalized.update).toEqual(['admin', 'owner', 'editor']);
    expect(normalized.delete).toEqual(['private']);
  });

  it('supports auth subject references and role declarations', () => {
    const admin = role('admin');

    const normalized = normalizeAuth({
      read: auth.public,
      write: [admin, auth.owner],
      delete: auth.private,
    });

    expect(normalized.get).toEqual(['public']);
    expect(normalized.getMany).toEqual(['public']);
    expect(normalized.create).toEqual(['admin', 'owner']);
    expect(normalized.update).toEqual(['admin', 'owner']);
    expect(normalized.delete).toEqual(['private']);
  });
});
