import { describe, expect, it } from 'vitest';

import { validateOxeBetterAuthOptions } from '../src/index.js';

const database = {} as Parameters<typeof validateOxeBetterAuthOptions>[0]['database'];
const secret = 'test-only-secret-with-at-least-32-characters';

describe('OXE Better Auth options', () => {
  it('accepts exact dynamic hosts for multi-origin applications', () => {
    expect(() =>
      validateOxeBetterAuthOptions({
        baseURL: {
          allowedHosts: ['127.0.0.1:3000', 'dev.oxe.example', 'oxe.example'],
          protocol: 'auto',
        },
        database,
        secret,
        trustedOrigins: ['http://127.0.0.1:3000', 'https://dev.oxe.example', 'https://oxe.example'],
      }),
    ).not.toThrow();
  });

  it('rejects wildcard hosts and non-origin trusted values', () => {
    expect(() =>
      validateOxeBetterAuthOptions({
        baseURL: { allowedHosts: ['*.example.test'] },
        database,
        secret,
      }),
    ).toThrow('exact host');
    expect(() =>
      validateOxeBetterAuthOptions({
        baseURL: 'https://example.test',
        database,
        secret,
        trustedOrigins: ['https://example.test/path'],
      }),
    ).toThrow('exact HTTP or HTTPS origin');
  });
});
