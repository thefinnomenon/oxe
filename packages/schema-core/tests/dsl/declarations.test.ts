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
      renameFrom: 'Article',
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
      indexes: [['status', 'createdAt']],
      unique: [['status', 'id']],
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
    expect(Post.renameFrom).toBe('Article');
    expect(Post.compositeIndexes).toEqual([{ columns: ['status', 'createdAt'] }]);
    expect(Post.compositeUniques).toEqual([{ columns: ['status', 'id'] }]);
    expect(Post.crud).toEqual(['read', 'delete']);
    expect(schema.declarationKind).toBe('schema');
    expect(schema.tables.map((entry) => entry.name)).toEqual(['Post']);
  });

  it('supports bucket metadata config fields', () => {
    const Uploads = bucket('Uploads', {
      renameFrom: 'LegacyUploads',
      config: {
        fileType: ['image/*', 'video/*', 'image/png', 'image/jpeg', 'image/webp'],
        fileNamePolicy: {
          strategy: 'slugify-uuid',
          maxLength: 140,
        },
        minSize: '10KB',
        maxSize: units.size.MB(1),
        duration: ['500ms', '2m'],
        minDimensions: [320, 200],
        maxDimensions: { width: 1920, height: 1080 },
        ttl: '1h',
        postUpload: {
          optimizeImages: {
            quality: 82,
            formats: ['webp', 'avif'],
            stripMetadata: true,
          },
          imageResize: {
            maxWidth: 4096,
            maxHeight: 4096,
            variants: [
              { name: 'thumb', width: 320, quality: 72, format: 'webp' },
              { name: 'card', width: 768, quality: 80, format: 'avif' },
            ],
          },
          placeholders: {
            kind: 'blurhash',
            width: 32,
            quality: 40,
          },
          responsiveImages: {
            breakpoints: [1280, 640, 320, 640],
            formats: ['avif', 'webp'],
            quality: 78,
            includePlaceholder: true,
          },
        },
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
    expect(Uploads.metadata.fileNamePolicy).toEqual({
      strategy: 'slugify-uuid',
      extension: 'preserve',
      lowercase: true,
      separator: '-',
      maxLength: 140,
    });
    expect(Uploads.metadata.postUpload?.responsiveImages?.breakpoints).toEqual([320, 640, 1280]);
    expect(Uploads.metadata.postUpload?.optimizeImages?.formats).toEqual(['webp', 'avif']);
    expect(Uploads.renameFrom).toBe('LegacyUploads');
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
