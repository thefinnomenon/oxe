import { describe, expect, it } from 'vitest';

import {
  calculateApplicationJobRetryDelay,
  createStandardApplicationCapability,
  probeApplicationCapabilityAdapterContract,
  probeApplicationCapabilityAdapterIdempotency,
} from '../src/index.js';

describe('application job delivery contracts', () => {
  it('executes provider adapters against standard semantic contracts', async () => {
    const capability = createStandardApplicationCapability('email');
    let calls = 0;
    const valid = await probeApplicationCapabilityAdapterContract({
      adapter: {
        invoke: (invocation) => {
          calls += 1;
          expect(invocation).toMatchObject({
            contract: 'oxe.capability.email',
            method: 'send',
            version: '1',
          });
          return { messageId: 'message-1' };
        },
      },
      capability,
      context: { userId: 'probe-user' },
      input: { body: 'Hello', subject: 'Welcome', to: 'person@example.com' },
      method: 'send',
    });
    expect(valid).toMatchObject({ ok: true, output: { messageId: 'message-1' } });

    const invalid = await probeApplicationCapabilityAdapterContract({
      adapter: { invoke: () => ({ messageId: 'should-not-run' }) },
      capability,
      context: {},
      input: { body: 'Hello', subject: 'Welcome', to: 'invalid' },
      method: 'send',
    });
    expect(invalid).toMatchObject({
      diagnostics: [{ code: 'OXE3602', message: 'Capability probe input is invalid.' }],
      ok: false,
    });
    const invalidOutput = await probeApplicationCapabilityAdapterContract({
      adapter: { invoke: () => ({ id: 'wrong-shape' }) },
      capability,
      context: {},
      input: { body: 'Hello', subject: 'Welcome', to: 'person@example.com' },
      method: 'send',
    });
    expect(invalidOutput).toMatchObject({
      diagnostics: [{ code: 'OXE3602', message: 'Capability probe output is invalid.' }],
      ok: false,
    });
    expect(calls).toBe(1);
  });

  it('calculates deterministic bounded exponential backoff with symmetric jitter', () => {
    const retry = {
      initialDelayMs: 1_000,
      jitterRatio: 0.25,
      maxAttempts: 6,
      maxDelayMs: 5_000,
      multiplier: 2,
    } as const;

    expect(calculateApplicationJobRetryDelay(retry, 1, () => 0)).toBe(750);
    expect(calculateApplicationJobRetryDelay(retry, 2, () => 0.5)).toBe(2_000);
    expect(calculateApplicationJobRetryDelay(retry, 3, () => 1)).toBe(5_000);
    expect(calculateApplicationJobRetryDelay(retry, 8, () => 0.5)).toBe(5_000);
  });

  it('probes repeated jobId delivery against observable provider effects', async () => {
    const deliveries = new Map<string, { readonly deliveryId: string }>();
    let effects = 0;
    const result = await probeApplicationCapabilityAdapterIdempotency({
      adapter: {
        idempotency: 'jobId',
        invoke: (invocation) => {
          const jobId = invocation.delivery?.jobId;
          if (!jobId) throw new Error('Missing job id.');
          const existing = deliveries.get(jobId);
          if (existing) return existing;
          const delivery = { deliveryId: `delivery-${jobId}` };
          deliveries.set(jobId, delivery);
          effects += 1;
          return delivery;
        },
      },
      context: { userId: 'probe-user' },
      effectCount: () => effects,
      invocation: {
        capabilityId: 'capability.mail',
        contract: 'oxe.capability.mail',
        delivery: { attempt: 1, jobId: 'job-probe' },
        input: { to: 'person@example.com' },
        method: 'send',
        version: '1',
      },
    });

    expect(result).toEqual({
      diagnostics: [],
      effectCountAfterFirst: 1,
      effectCountAfterSecond: 1,
      effectCountBefore: 0,
      ok: true,
      schemaVersion: 'oxe.application-capability-idempotency-probe.v1',
    });
  });

  it('reports adapters that duplicate provider-side effects', async () => {
    let effects = 0;
    const result = await probeApplicationCapabilityAdapterIdempotency({
      adapter: {
        invoke: () => {
          effects += 1;
          return { deliveryId: String(effects) };
        },
      },
      context: {},
      effectCount: () => effects,
      invocation: {
        capabilityId: 'capability.mail',
        contract: 'oxe.capability.mail',
        delivery: { attempt: 1, jobId: 'job-duplicate' },
        input: {},
        method: 'send',
        version: '1',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'Queued capability adapter must declare jobId idempotency.',
      'Repeated delivery returned a different result for the same jobId.',
      'Repeated delivery produced an additional provider-side effect.',
    ]);
  });
});
