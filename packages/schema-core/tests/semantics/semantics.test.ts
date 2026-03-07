import { describe, expect, it } from 'vitest';

import { validateSchemaProject } from '../../src/index.js';
import { loadFixtureProject } from '../helpers.js';

describe('schema semantics', () => {
  it('reports semantic errors for invalid schemas', async () => {
    const project = await loadFixtureProject('invalid-object-type');
    const result = validateSchemaProject(project);

    expect(result.ok).toBe(false);

    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toContain('DUPLICATE_DECLARATION_NAME');
    expect(codes).toContain('DUPLICATE_ENUM_MEMBER');
    expect(codes).toContain('DUPLICATE_FIELD_NAME');
    expect(codes).toContain('MULTIPLE_OWNER_FIELDS');
    expect(codes).toContain('OBJECT_TYPE_AUTH_NOT_ALLOWED');
    expect(codes).toContain('OBJECT_TYPE_OWNER_NOT_ALLOWED');
    expect(codes).toContain('OBJECT_TYPE_DB_METADATA_NOT_ALLOWED');
    expect(codes).toContain('BUCKET_METADATA_ON_NON_BUCKET');
    expect(codes).toContain('ON_DELETE_WITHOUT_REFERENCES');
    expect(codes).toContain('UNKNOWN_TABLE_REFERENCE');
    expect(codes).toContain('UNKNOWN_ENUM_REFERENCE');
    expect(codes).toContain('UNKNOWN_OBJECT_TYPE_REFERENCE');
    expect(codes).toContain('BUILT_IN_FIELD_OVERRIDE');
  });
});
