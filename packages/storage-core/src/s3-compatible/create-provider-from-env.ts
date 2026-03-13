import { S3CompatibleStorageProvider } from './provider.js';
import type { S3CompatibleProviderConfig } from './types.js';

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (!value) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'y'].includes(value.trim().toLowerCase());
};

export const readS3CompatibleProviderConfigFromEnv = (): S3CompatibleProviderConfig => {
  const endpoint = process.env.OXE_STORAGE_ENDPOINT;
  const region = process.env.OXE_STORAGE_REGION ?? 'us-east-1';
  const accessKeyId = process.env.OXE_STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.OXE_STORAGE_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'Missing storage provider environment variables. Required: OXE_STORAGE_ENDPOINT, OXE_STORAGE_ACCESS_KEY_ID, OXE_STORAGE_SECRET_ACCESS_KEY. Optional: OXE_STORAGE_REGION, OXE_STORAGE_FORCE_PATH_STYLE.',
    );
  }

  return {
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: parseBoolean(process.env.OXE_STORAGE_FORCE_PATH_STYLE, true),
    sessionToken: process.env.OXE_STORAGE_SESSION_TOKEN,
  };
};

export const createS3CompatibleProviderFromEnv = (): S3CompatibleStorageProvider => {
  return new S3CompatibleStorageProvider(readS3CompatibleProviderConfigFromEnv());
};
