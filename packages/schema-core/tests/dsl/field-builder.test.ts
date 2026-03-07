import { describe, expect, it } from 'vitest';

import { field, table, toFieldDefinition } from '../../src/index.js';

describe('field builder', () => {
  it('supports immutable chaining across metadata categories', () => {
    const base = field.string();

    const chained = base
      .trim()
      .lowercase()
      .minLength(3)
      .maxLength(120)
      .default('hello')
      .unique()
      .optional()
      .array()
      .auth({ read: 'public', update: ['admin'] })
      .owner();

    const original = toFieldDefinition(base);
    const built = toFieldDefinition(chained);

    expect(original.transforms).toEqual([]);
    expect(original.validators).toEqual([]);
    expect(original.optional).toBe(false);

    expect(built.optional).toBe(true);
    expect(built.array).toBe(true);
    expect(built.owner).toBe(true);
    expect(built.transforms.map((transform) => transform.kind)).toEqual(['trim', 'lowercase']);
    expect(built.validators).toEqual([
      { kind: 'minLength', value: 3 },
      { kind: 'maxLength', value: 120 },
    ]);
    expect(built.db.defaultValue).toBe('hello');
    expect(built.db.unique).toBe(true);
    expect(built.auth).toEqual({ read: 'public', update: ['admin'] });
  });

  it('accepts table declarations in references()', () => {
    const User = table('User', {
      fields: {
        email: field.string().email(),
      },
    });

    const authorId = toFieldDefinition(field.id().references(User).index());

    expect(authorId.db.references).toBe('User');
    expect(authorId.db.index).toBe(true);
  });
});
