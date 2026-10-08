import { describe, expect, it } from 'vitest';

import type { ApplicationJobRunSummaryV1 } from '@oxe/graph';

import {
  createPostgresApplicationJobWorker,
  type ApplicationPostgresHostV1,
} from '../src/index.js';

const emptySummary = (): ApplicationJobRunSummaryV1 => ({
  claimed: 0,
  completed: 0,
  failed: 0,
  pendingRetry: 0,
});

const fakeHost = (runJobs: ApplicationPostgresHostV1['runJobs']): ApplicationPostgresHostV1 => ({
  execute: () => Promise.resolve({}),
  listJobs: () => Promise.resolve([]),
  query: () => Promise.resolve([]),
  replayJob: () => Promise.reject(new Error('No jobs.')),
  runJobs,
});

describe('scheduled PostgreSQL application job worker', () => {
  it('polls repeatedly and drains an in-flight run during graceful shutdown', async () => {
    let calls = 0;
    let releaseSecond: (() => void) | undefined;
    let notifySecond: (() => void) | undefined;
    const secondStarted = new Promise<void>((resolve) => {
      notifySecond = resolve;
    });
    const host = fakeHost(async () => {
      calls += 1;
      if (calls === 1) return { ...emptySummary(), claimed: 1, completed: 1 };
      notifySecond?.();
      await new Promise<void>((resolve) => {
        releaseSecond = resolve;
      });
      return emptySummary();
    });
    const worker = createPostgresApplicationJobWorker(host, {
      pollIntervalMs: 1,
      shutdownTimeoutMs: 1_000,
      workerId: 'worker-graceful',
    });

    worker.start();
    await secondStarted;
    const stopping = worker.stop();
    expect(worker.snapshot().state).toBe('stopping');
    releaseSecond?.();
    await expect(stopping).resolves.toEqual({ forced: false });
    expect(worker.snapshot()).toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      pendingRetry: 0,
      runs: 2,
      state: 'stopped',
    });
  });

  it('aborts an in-flight claim after the shutdown timeout', async () => {
    let notifyStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const host = fakeHost(
      (options) =>
        new Promise<ApplicationJobRunSummaryV1>((_resolve, reject) => {
          notifyStarted?.();
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );
    const worker = createPostgresApplicationJobWorker(host, {
      pollIntervalMs: 1,
      shutdownTimeoutMs: 10,
      workerId: 'worker-forced',
    });

    worker.start();
    await started;
    await expect(worker.stop()).resolves.toEqual({ forced: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worker.snapshot().state).toBe('stopped');
  });

  it('isolates error observers and validates scheduling options', async () => {
    let calls = 0;
    let notifySecond: (() => void) | undefined;
    const secondStarted = new Promise<void>((resolve) => {
      notifySecond = resolve;
    });
    const worker = createPostgresApplicationJobWorker(
      fakeHost(() => {
        calls += 1;
        if (calls === 2) notifySecond?.();
        return Promise.reject(new Error('database unavailable'));
      }),
      {
        onError: () => {
          throw new Error('observer unavailable');
        },
        pollIntervalMs: 1,
        shutdownTimeoutMs: 100,
      },
    );
    worker.start();
    await secondStarted;
    await expect(worker.stop()).resolves.toEqual({ forced: false });
    expect(worker.snapshot().state).toBe('stopped');
    expect(() =>
      createPostgresApplicationJobWorker(
        fakeHost(() => Promise.resolve(emptySummary())),
        {
          batchSize: 0,
        },
      ),
    ).toThrow('batchSize must be positive.');
  });
});
