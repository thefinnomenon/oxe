import { randomUUID } from 'node:crypto';

import type { ApplicationJobRunSummaryV1 } from '@oxe/graph';

import type { ApplicationPostgresHostV1 } from './application.js';

export interface ApplicationPostgresJobWorkerOptionsV1 {
  readonly batchSize?: number;
  readonly leaseMs?: number;
  readonly onError?: (error: unknown) => void;
  readonly pollIntervalMs?: number;
  readonly shutdownTimeoutMs?: number;
  readonly workerId?: string;
}

export interface ApplicationPostgresJobWorkerSnapshotV1 {
  readonly claimed: number;
  readonly completed: number;
  readonly failed: number;
  readonly pendingRetry: number;
  readonly runs: number;
  readonly state: 'idle' | 'running' | 'stopped' | 'stopping';
}

export interface ApplicationPostgresJobWorkerStopResultV1 {
  readonly forced: boolean;
}

export interface ApplicationPostgresJobWorkerV1 {
  runOnce(signal?: AbortSignal): Promise<ApplicationJobRunSummaryV1>;
  snapshot(): ApplicationPostgresJobWorkerSnapshotV1;
  start(): void;
  stop(): Promise<ApplicationPostgresJobWorkerStopResultV1>;
}

const positiveInteger = (value: number, label: string): number => {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${label} must be positive.`);
  return value;
};

/** Scheduled, single-consumer orchestration around the host's leased outbox claim primitive. */
export const createPostgresApplicationJobWorker = (
  host: ApplicationPostgresHostV1,
  options: ApplicationPostgresJobWorkerOptionsV1 = {},
): ApplicationPostgresJobWorkerV1 => {
  const batchSize = positiveInteger(options.batchSize ?? 25, 'batchSize');
  const leaseMs = positiveInteger(options.leaseMs ?? 30_000, 'leaseMs');
  const pollIntervalMs = positiveInteger(options.pollIntervalMs ?? 1_000, 'pollIntervalMs');
  const shutdownTimeoutMs = positiveInteger(
    options.shutdownTimeoutMs ?? 30_000,
    'shutdownTimeoutMs',
  );
  const workerId = options.workerId ?? `worker-${randomUUID()}`;
  let state: ApplicationPostgresJobWorkerSnapshotV1['state'] = 'idle';
  let loop: Promise<void> | undefined;
  let stopRequested = false;
  let currentRun: AbortController | undefined;
  let wakePoll: (() => void) | undefined;
  const totals = { claimed: 0, completed: 0, failed: 0, pendingRetry: 0, runs: 0 };

  const record = (summary: ApplicationJobRunSummaryV1): void => {
    totals.claimed += summary.claimed;
    totals.completed += summary.completed;
    totals.failed += summary.failed;
    totals.pendingRetry += summary.pendingRetry;
    totals.runs += 1;
  };

  const runOnce = async (signal?: AbortSignal): Promise<ApplicationJobRunSummaryV1> => {
    const summary = await host.runJobs({
      leaseMs,
      limit: batchSize,
      ...(signal ? { signal } : {}),
      workerId,
    });
    record(summary);
    return summary;
  };

  const waitForPoll = (): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        wakePoll = undefined;
        resolve();
      }, pollIntervalMs);
      wakePoll = () => {
        clearTimeout(timer);
        wakePoll = undefined;
        resolve();
      };
    });

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // An error observer cannot terminate job delivery.
    }
  };

  const runLoop = async (): Promise<void> => {
    try {
      while (!stopRequested) {
        currentRun = new AbortController();
        try {
          await runOnce(currentRun.signal);
        } catch (error) {
          if (!currentRun.signal.aborted) reportError(error);
        } finally {
          currentRun = undefined;
        }
        if (!stopRequested) await waitForPoll();
      }
    } finally {
      state = 'stopped';
    }
  };

  const start = (): void => {
    if (state === 'running' || state === 'stopping') return;
    if (state === 'stopped') throw new Error('A stopped application job worker cannot restart.');
    state = 'running';
    loop = runLoop();
    void loop.catch(reportError);
  };

  const stop = async (): Promise<ApplicationPostgresJobWorkerStopResultV1> => {
    if (state === 'idle') {
      state = 'stopped';
      return { forced: false };
    }
    if (state === 'stopped') return { forced: false };
    state = 'stopping';
    stopRequested = true;
    wakePoll?.();
    if (!loop) {
      state = 'stopped';
      return { forced: false };
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const forced = await Promise.race([
      loop.then(() => false),
      new Promise<true>((resolve) => {
        timer = setTimeout(() => resolve(true), shutdownTimeoutMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (forced) currentRun?.abort();
    return { forced };
  };

  return Object.freeze({
    runOnce,
    snapshot: (): ApplicationPostgresJobWorkerSnapshotV1 => ({ ...totals, state }),
    start,
    stop,
  });
};
