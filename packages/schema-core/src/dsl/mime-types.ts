export const POPULAR_MIME_TYPES = [
  'image/*',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
  'image/bmp',
  'image/tiff',
  'image/svg+xml',
  'image/x-icon',
  'video/*',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-ms-wmv',
  'video/mpeg',
  'video/ogg',
  'video/3gpp',
  'video/3gpp2',
  'video/mp2t',
  'video/x-matroska',
  'audio/*',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/ogg',
  'audio/flac',
  'audio/x-flac',
  'audio/midi',
  'audio/x-midi',
  'audio/3gpp',
  'audio/3gpp2',
  'audio/amr',
  'audio/aiff',
  'application/*',
  'application/pdf',
  'application/json',
  'application/zip',
  'application/x-zip-compressed',
  'application/gzip',
  'application/x-7z-compressed',
  'application/vnd.rar',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/*',
  'text/plain',
  'text/csv',
  'text/markdown',
] as const;

export type MimeType = (typeof POPULAR_MIME_TYPES)[number];

export interface ReduceMimeTypesResult {
  mimeType: string[];
  duplicates: string[];
}

export const normalizeMimeType = (value: string): string => {
  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    throw new Error('Bucket fileType()/image()/video() values cannot be empty.');
  }

  return normalized;
};

const getMimeTypeMainType = (value: string): string | undefined => {
  const slashIndex = value.indexOf('/');

  if (slashIndex <= 0 || slashIndex === value.length - 1) {
    return undefined;
  }

  return value.slice(0, slashIndex);
};

const isWildcardMimeType = (value: string): boolean => {
  return value.endsWith('/*') && getMimeTypeMainType(value) !== undefined;
};

export const reduceMimeTypes = (input: string[]): ReduceMimeTypesResult => {
  const mimeType: string[] = [];
  const duplicates = new Set<string>();

  for (const rawMimeType of input) {
    const normalized = normalizeMimeType(rawMimeType);
    const wildcard = isWildcardMimeType(normalized);

    if (mimeType.includes(normalized)) {
      duplicates.add(normalized);
      continue;
    }

    if (wildcard) {
      const mainType = getMimeTypeMainType(normalized);

      if (!mainType) {
        mimeType.push(normalized);
        continue;
      }

      const nextMimeTypes = mimeType.filter((existingMimeType) => {
        const existingMainType = getMimeTypeMainType(existingMimeType);
        const coveredSpecificType =
          existingMainType === mainType && !isWildcardMimeType(existingMimeType);

        if (coveredSpecificType) {
          duplicates.add(existingMimeType);
          return false;
        }

        return true;
      });

      mimeType.length = 0;
      mimeType.push(...nextMimeTypes, normalized);
      continue;
    }

    const mainType = getMimeTypeMainType(normalized);

    if (mainType && mimeType.includes(`${mainType}/*`)) {
      duplicates.add(normalized);
      continue;
    }

    mimeType.push(normalized);
  }

  return {
    mimeType,
    duplicates: [...duplicates],
  };
};
