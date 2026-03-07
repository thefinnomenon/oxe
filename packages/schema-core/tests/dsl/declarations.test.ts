import { describe, expect, it } from 'vitest';

import { bucket, defineSchema, enumType, field, objectType, role, table, units } from '../../src/index.js';

describe('declaration builders', () => {
  it('creates top-level declarations and schema definition', () => {
    const admin = role('admin');
    const Status = enumType('Status', ['draft', 'published']);
    const Meta = objectType('Meta', {
      title: field.string().trim().maxLength(70),
    });

    const Post = table('Post', {
      fields: {
        status: field.enum(Status),
        meta: field.type(Meta).optional(),
      },
    });

    const schema = defineSchema({
      roles: [admin],
      enums: [Status],
      types: [Meta],
      tables: [Post],
    });

    expect(admin.declarationKind).toBe('role');
    expect(Status.declarationKind).toBe('enum');
    expect(Meta.declarationKind).toBe('objectType');
    expect(Post.declarationKind).toBe('table');
    expect(schema.declarationKind).toBe('schema');
    expect(schema.tables.map((entry) => entry.name)).toEqual(['Post']);
  });

  it('supports bucket metadata builder methods', () => {
    const Uploads = bucket('Uploads', {
      fields: {
        ownerId: field.id().owner(),
      },
    })
      .video()
      .fileType('video/mp4')
      .minSize('10KB')
      .maxSize(units.size.MB(1))
      .duration('500ms', '2m')
      .minDimensions(320, 200)
      .maxDimensions({ width: 1920, height: 1080 })
      .ttl('1h');

    expect(Uploads.metadata.mediaType).toBe('video');
    expect(Uploads.metadata.fileTypes).toEqual(['video/mp4']);
    expect(Uploads.metadata.size).toEqual({ min: 10_000, max: 1_000_000 });
    expect(Uploads.metadata.duration).toEqual({ min: 0.5, max: 120 });
    expect(Uploads.metadata.dimensions).toEqual({
      min: { width: 320, height: 200 },
      max: { width: 1920, height: 1080 },
    });
    expect(Uploads.metadata.ttlSeconds).toBe(3_600);
  });
});
