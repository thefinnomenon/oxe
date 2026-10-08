import { describe, expect, it } from 'vitest';

import { parseWorkspaceOperationsSnapshot } from '../src/operations.js';

describe('workspace runtime operations protocol', () => {
  it('validates the metadata boundary and strips undeclared provider payloads', () => {
    const snapshot = parseWorkspaceOperationsSnapshot({
      appId: 'app.todo',
      capturedAt: '2026-08-30T12:00:00.000Z',
      deadLetterJobs: [
        {
          attempts: 3,
          availableAt: '2026-08-30T11:30:00.000Z',
          capabilityId: 'capability.mail',
          createdAt: '2026-08-30T11:00:00.000Z',
          id: 'job-1',
          lastErrorKind: 'delivery',
          maxAttempts: 3,
          method: 'send',
          payload: { email: 'private@example.test' },
          status: 'deadLetter',
        },
      ],
      graphRevision: 16,
      schemaVersion: 'oxe.application-development-operations.v1',
      telemetry: { metrics: [], spans: [] },
      worker: {
        claimed: 1,
        completed: 0,
        failed: 1,
        pendingRetry: 0,
        runs: 1,
        state: 'running',
      },
    });

    expect(snapshot.deadLetterJobs).toEqual([
      {
        attempts: 3,
        availableAt: '2026-08-30T11:30:00.000Z',
        capabilityId: 'capability.mail',
        createdAt: '2026-08-30T11:00:00.000Z',
        id: 'job-1',
        lastErrorKind: 'delivery',
        maxAttempts: 3,
        method: 'send',
        status: 'deadLetter',
      },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('private@example.test');
  });

  it('rejects malformed worker and job metadata', () => {
    expect(() =>
      parseWorkspaceOperationsSnapshot({
        appId: 'app.todo',
        capturedAt: 'now',
        deadLetterJobs: [],
        graphRevision: 16,
        schemaVersion: 'oxe.application-development-operations.v1',
        telemetry: { metrics: [], spans: [] },
        worker: {
          claimed: 0,
          completed: 0,
          failed: 0,
          pendingRetry: 0,
          runs: 0,
          state: 'unknown',
        },
      }),
    ).toThrow('operations.worker.state is invalid.');
  });
});
