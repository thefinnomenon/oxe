import { describe, expect, it } from 'vitest';

import {
  defineTransform,
  defineValidator,
  field,
  table,
  toFieldDefinition,
} from '../../src/index.js';

describe('field builder', () => {
  it('supports immutable chaining across ordered metadata categories', () => {
    const base = field.string();

    const chained = base
      .auth({ read: 'public', update: ['admin'] })
      .owner()
      .default('hello')
      .unique()
      .trim()
      .lowercase()
      .minLength(3)
      .maxLength(120)
      .optional()
      .array();

    const original = toFieldDefinition(base);
    const built = toFieldDefinition(chained);

    expect(original.transforms).toEqual([]);
    expect(original.validators).toEqual([]);
    expect(original.optional).toBe(false);

    expect(built.optional).toBe(true);
    expect(built.array).toBe(true);
    expect(built.owner).toBe(true);
    expect(built.transforms).toEqual([
      { kind: 'builtIn', name: 'trim' },
      { kind: 'builtIn', name: 'lowercase' },
    ]);
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

  it('supports single-value range validators', () => {
    const title = toFieldDefinition(field.string().length(12));
    const score = toFieldDefinition(field.int().num(5));

    expect(title.validators).toContainEqual({ kind: 'length', min: 12, max: 12 });
    expect(score.validators).toContainEqual({ kind: 'num', min: 5, max: 5 });
  });

  it('supports custom transforms and validators', () => {
    const slugify = defineTransform<string>('slugify', (value) =>
      value.trim().toLowerCase().replace(/\s+/g, '-'),
    );
    const slug = defineValidator<string>('isSlug', (value) =>
      /^[a-z0-9-]+$/.test(value)
        ? true
        : 'Slug must contain only lowercase letters, numbers, and hyphens.',
    );

    const definition = toFieldDefinition(field.string().transform(slugify).validate(slug));

    expect(definition.transforms).toContainEqual({ kind: 'custom', name: 'slugify' });
    expect(definition.validators).toContainEqual({ kind: 'custom', name: 'isSlug' });
  });
});
