import { describe, expect, it } from 'vitest';

import {
  bucket,
  defineSchema,
  enumType,
  field,
  objectType,
  role,
  table,
  units,
} from '../../src/index.js';

bucket('TypedMimeBucket', {
  config: {
    fileType: ['image/png', 'video/mp4'],
  },
});
bucket('InvalidTypedMimeBucket', {
  config: {
    // @ts-expect-error invalid mime type should fail typing
    fileType: ['not/a-real-mime'],
  },
});

describe('declaration builders', () => {
  it('creates top-level declarations and schema definition', () => {
    const admin = role('admin');
    const Status = enumType('Status', ['draft', 'published']);
    const Meta = objectType('Meta', {
      title: field.string().trim().maxLength(70),
    });

    const Post = table('Post', {
      config: {
        dbName: 'posts',
        description: 'Posts table',
        tags: ['content', 'content'],
        timestamps: true,
      },
      crud: ['read', 'delete'],
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
    expect(Post.metadata).toEqual({
      dbName: 'posts',
      description: 'Posts table',
      tags: ['content'],
      timestamps: true,
    });
    expect(Post.crud).toEqual(['read', 'delete']);
    expect(schema.declarationKind).toBe('schema');
    expect(schema.tables.map((entry) => entry.name)).toEqual(['Post']);
  });

  it('supports bucket metadata config fields', () => {
    const Uploads = bucket('Uploads', {
      fields: {
        ownerId: field.id().owner(),
      },
      config: {
        fileType: ['image/*', 'video/*', 'image/png', 'image/jpeg', 'image/webp'],
        minSize: '10KB',
        maxSize: units.size.MB(1),
        duration: ['500ms', '2m'],
        minDimensions: [320, 200],
        maxDimensions: { width: 1920, height: 1080 },
        ttl: '1h',
      },
    });

    expect(Uploads.metadata.mimeType).toEqual(['image/*', 'video/*']);
    expect(Uploads.metadata.duplicateMimeType).toContain('image/png');
    expect(Uploads.metadata.duplicateMimeType).toContain('image/jpeg');
    expect(Uploads.metadata.duplicateMimeType).toContain('image/webp');
    expect(Uploads.metadata.size).toEqual({ min: 10_000, max: 1_000_000 });
    expect(Uploads.metadata.duration).toEqual({ min: 0.5, max: 120 });
    expect(Uploads.metadata.dimensions).toEqual({
      min: { width: 320, height: 200 },
      max: { width: 1920, height: 1080 },
    });
    expect(Uploads.metadata.ttlSeconds).toBe(3_600);
  });

  it('supports single-value range metadata fields', () => {
    const SingleRanges = bucket('SingleRanges', {
      config: {
        size: '1MB',
        duration: '2m',
        dimensions: { width: 640, height: 360 },
      },
    });

    expect(SingleRanges.metadata.size).toEqual({
      min: 1_000_000,
      max: 1_000_000,
    });
    expect(SingleRanges.metadata.duration).toEqual({
      min: 120,
      max: 120,
    });
    expect(SingleRanges.metadata.dimensions).toEqual({
      min: { width: 640, height: 360 },
      max: { width: 640, height: 360 },
    });
  });
});
