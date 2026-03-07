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

  it('reports duplicate bucket mime types as warnings', async () => {
    const project = await loadFixtureProject('duplicate-bucket-mime');
    const result = validateSchemaProject(project);

    expect(result.ok).toBe(true);

    const duplicateMimeDiagnostic = result.diagnostics.find(
      (diagnostic) => diagnostic.code === 'DUPLICATE_BUCKET_MIME_TYPE',
    );

    expect(duplicateMimeDiagnostic?.severity).toBe('warning');
    expect(duplicateMimeDiagnostic?.message).toContain('image/png');
    expect(duplicateMimeDiagnostic?.message).toContain('video/*');
  });

  it('reports duplicate metadata/auth/validator definitions as warnings', async () => {
    const project = await loadFixtureProject('duplicate-definitions');
    const result = validateSchemaProject(project);

    expect(result.ok).toBe(true);

    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toContain('DUPLICATE_BUCKET_METADATA_SETTING');
    expect(codes).toContain('DUPLICATE_AUTH_SUBJECT');
    expect(codes).toContain('REDUNDANT_FIELD_AUTH');
    expect(codes).toContain('DUPLICATE_FIELD_VALIDATOR');
    expect(codes).toContain('OVERLAPPING_FIELD_VALIDATOR');
  });

  it('errors when field auth loosens parent resource auth', async () => {
    const project = await loadFixtureProject('field-auth-loosening');
    const result = validateSchemaProject(project);

    expect(result.ok).toBe(false);

    const diagnostic = result.diagnostics.find(
      (entry) => entry.code === 'FIELD_AUTH_LOOSENS_RESOURCE',
    );

    expect(diagnostic?.severity).toBe('error');
    expect(diagnostic?.message).toContain('create');
    expect(diagnostic?.message).toContain('public');
  });
});
