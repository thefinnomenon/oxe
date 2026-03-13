import { afterEach, describe, expect, it } from 'vitest';

import { readS3CompatibleProviderConfigFromEnv } from '../../src/s3-compatible/create-provider-from-env.js';

const resetEnv = (key: string): void => {
  delete process.env[key];
};

afterEach(() => {
  resetEnv('OXE_STORAGE_ENDPOINT');
  resetEnv('OXE_STORAGE_REGION');
  resetEnv('OXE_STORAGE_ACCESS_KEY_ID');
  resetEnv('OXE_STORAGE_SECRET_ACCESS_KEY');
  resetEnv('OXE_STORAGE_FORCE_PATH_STYLE');
  resetEnv('OXE_STORAGE_SESSION_TOKEN');
});

describe('readS3CompatibleProviderConfigFromEnv', () => {
  it('parses provider config from env', () => {
    process.env.OXE_STORAGE_ENDPOINT = 'http://localhost:9000';
    process.env.OXE_STORAGE_REGION = 'us-east-1';
    process.env.OXE_STORAGE_ACCESS_KEY_ID = 'minio';
    process.env.OXE_STORAGE_SECRET_ACCESS_KEY = 'miniosecret';
    process.env.OXE_STORAGE_FORCE_PATH_STYLE = 'true';

    const config = readS3CompatibleProviderConfigFromEnv();

    expect(config).toEqual({
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      accessKeyId: 'minio',
      secretAccessKey: 'miniosecret',
      forcePathStyle: true,
      sessionToken: undefined,
    });
  });

  it('throws when required env vars are missing', () => {
    expect(() => readS3CompatibleProviderConfigFromEnv()).toThrow(
      'Missing storage provider environment variables',
    );
  });
});
