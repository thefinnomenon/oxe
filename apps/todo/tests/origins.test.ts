import { describe, expect, it } from 'vitest';

import { resolveTodoAllowedOrigins, resolveTodoRequestOrigin } from '../src/server.js';

describe('Todo public origin policy', () => {
  it('normalizes an exact multi-origin deployment and selects by Host', () => {
    const origins = resolveTodoAllowedOrigins('http://127.0.0.1:3000', [
      'https://dev.oxe.example',
      'https://oxe.example',
      'https://dev.oxe.example',
    ]);
    expect(origins).toEqual([
      'http://127.0.0.1:3000',
      'https://dev.oxe.example',
      'https://oxe.example',
    ]);
    expect(
      resolveTodoRequestOrigin(
        { headers: { host: 'dev.oxe.example', 'x-forwarded-host': 'malicious.example' } },
        origins,
      ),
    ).toBe('https://dev.oxe.example');
  });

  it('rejects malformed origins and unknown request hosts', () => {
    expect(() =>
      resolveTodoAllowedOrigins('http://127.0.0.1:3000', ['https://oxe.example/path']),
    ).toThrow('exact HTTP or HTTPS origin');
    expect(() =>
      resolveTodoRequestOrigin({ headers: { host: 'malicious.example' } }, ['https://oxe.example']),
    ).toThrow('is not allowed');
  });
});
