import { describe, expect, it } from 'vitest';

import { loadFixtureProject } from '../helpers.js';

describe('schema loader', () => {
  it('loads schema files and prefers defineSchema default exports', async () => {
    const project = await loadFixtureProject('basic');

    expect(project.schemaFiles).toHaveLength(2);
    expect(project.declarations.roles.map((entry) => entry.declaration.name)).toEqual(['admin', 'member']);
    expect(project.declarations.tables.map((entry) => entry.declaration.name).sort()).toEqual([
      'Comment',
      'Post',
      'User',
    ]);
    expect(project.declarations.tables.some((entry) => entry.declaration.name === 'IgnoredByLoader')).toBe(
      false,
    );
  });

  it('loads named declarations when no default schema is exported', async () => {
    const project = await loadFixtureProject('named-only');

    expect(project.declarations.roles.map((entry) => entry.declaration.name)).toEqual(['admin']);
    expect(project.declarations.enums.map((entry) => entry.declaration.name)).toEqual(['Visibility']);
    expect(project.declarations.tables.map((entry) => entry.declaration.name).sort()).toEqual([
      'Post',
      'User',
    ]);
  });
});
