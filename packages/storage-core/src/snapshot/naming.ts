const sanitizeSegment = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

export const buildProviderBucketName = (logicalName: string, bucketPrefix?: string): string => {
  const sanitizedName = sanitizeSegment(logicalName);
  const sanitizedPrefix = bucketPrefix ? sanitizeSegment(bucketPrefix) : '';

  const combined = sanitizedPrefix ? `${sanitizedPrefix}-${sanitizedName}` : sanitizedName;
  if (combined.length < 3) {
    return `${combined}-bucket`;
  }
  if (combined.length <= 63) {
    return combined;
  }

  return combined.slice(0, 63);
};
