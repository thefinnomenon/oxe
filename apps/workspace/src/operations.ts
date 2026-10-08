import type {
  ApplicationMetricV1,
  ApplicationOutboxJobV1,
  ApplicationTelemetrySnapshotV1,
  ApplicationTraceSpanV1,
} from '@oxe/graph';

export interface WorkspaceJobWorkerSnapshotV1 {
  readonly claimed: number;
  readonly completed: number;
  readonly failed: number;
  readonly pendingRetry: number;
  readonly runs: number;
  readonly state: 'idle' | 'running' | 'stopped' | 'stopping';
}

export interface WorkspaceOperationsSnapshotV1 {
  readonly appId: string;
  readonly capturedAt: string;
  readonly deadLetterJobs: readonly ApplicationOutboxJobV1[];
  readonly graphRevision: number;
  readonly schemaVersion: 'oxe.application-development-operations.v1';
  readonly telemetry: ApplicationTelemetrySnapshotV1;
  readonly worker: WorkspaceJobWorkerSnapshotV1;
}

export interface WorkspaceRuntimeOperationsV1 {
  replayJob(jobId: string, maxAttempts?: number): Promise<ApplicationOutboxJobV1>;
  snapshot(): Promise<WorkspaceOperationsSnapshotV1>;
}

export interface FetchWorkspaceRuntimeOperationsOptionsV1 {
  readonly endpoint: string;
  readonly token: string;
}

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError(`${label} must be an object.`);
  return value as Record<string, unknown>;
};

const string = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0)
    throw new TypeError(`${label} must be a non-empty string.`);
  return value;
};

const number = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new TypeError(`${label} must be a non-negative finite number.`);
  return value;
};

const integer = (value: unknown, label: string): number => {
  const result = number(value, label);
  if (!Number.isInteger(result)) throw new TypeError(`${label} must be an integer.`);
  return result;
};

const parseJob = (input: unknown, label: string): ApplicationOutboxJobV1 => {
  const value = record(input, label);
  const status = string(value.status, `${label}.status`);
  if (!['completed', 'deadLetter', 'pending', 'running'].includes(status))
    throw new TypeError(`${label}.status is invalid.`);
  if (value.lastErrorKind !== undefined && value.lastErrorKind !== 'delivery')
    throw new TypeError(`${label}.lastErrorKind is invalid.`);
  return Object.freeze({
    attempts: integer(value.attempts, `${label}.attempts`),
    availableAt: string(value.availableAt, `${label}.availableAt`),
    capabilityId: string(value.capabilityId, `${label}.capabilityId`),
    createdAt: string(value.createdAt, `${label}.createdAt`),
    id: string(value.id, `${label}.id`),
    ...(value.lastErrorKind === 'delivery' ? { lastErrorKind: 'delivery' as const } : {}),
    maxAttempts: integer(value.maxAttempts, `${label}.maxAttempts`),
    method: string(value.method, `${label}.method`),
    status: status as ApplicationOutboxJobV1['status'],
  });
};

const parseMetric = (input: unknown, label: string): ApplicationMetricV1 => {
  const value = record(input, label);
  const kind = string(value.kind, `${label}.kind`);
  if (!['job', 'operation', 'query'].includes(kind))
    throw new TypeError(`${label}.kind is invalid.`);
  return Object.freeze({
    failureCount: integer(value.failureCount, `${label}.failureCount`),
    kind: kind as ApplicationMetricV1['kind'],
    maxDurationMs: number(value.maxDurationMs, `${label}.maxDurationMs`),
    semanticId: string(value.semanticId, `${label}.semanticId`),
    successCount: integer(value.successCount, `${label}.successCount`),
    totalCount: integer(value.totalCount, `${label}.totalCount`),
    totalDurationMs: number(value.totalDurationMs, `${label}.totalDurationMs`),
  });
};

const parseSpan = (input: unknown, label: string): ApplicationTraceSpanV1 => {
  const value = record(input, label);
  const kind = string(value.kind, `${label}.kind`);
  const outcome = string(value.outcome, `${label}.outcome`);
  if (!['job', 'operation', 'query'].includes(kind))
    throw new TypeError(`${label}.kind is invalid.`);
  if (!['failure', 'success'].includes(outcome))
    throw new TypeError(`${label}.outcome is invalid.`);
  if (value.schemaVersion !== 'oxe.application-trace-span.v1')
    throw new TypeError(`${label}.schemaVersion is invalid.`);
  const failureKind = value.failureKind;
  if (
    failureKind !== undefined &&
    !['forbidden', 'internal', 'not-found', 'unauthorized', 'validation'].includes(
      String(failureKind),
    )
  )
    throw new TypeError(`${label}.failureKind is invalid.`);
  const parsedFailureKind = failureKind as
    NonNullable<ApplicationTraceSpanV1['failureKind']> | undefined;
  return Object.freeze({
    appId: string(value.appId, `${label}.appId`),
    durationMs: number(value.durationMs, `${label}.durationMs`),
    ...(parsedFailureKind !== undefined ? { failureKind: parsedFailureKind } : {}),
    graphRevision: integer(value.graphRevision, `${label}.graphRevision`),
    kind: kind as ApplicationTraceSpanV1['kind'],
    outcome: outcome as ApplicationTraceSpanV1['outcome'],
    schemaVersion: value.schemaVersion,
    semanticId: string(value.semanticId, `${label}.semanticId`),
    spanId: string(value.spanId, `${label}.spanId`),
    traceId: string(value.traceId, `${label}.traceId`),
  });
};

const array = (value: unknown, label: string): readonly unknown[] => {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
};

export const parseWorkspaceOperationsSnapshot = (input: unknown): WorkspaceOperationsSnapshotV1 => {
  const value = record(input, 'operations');
  if (value.schemaVersion !== 'oxe.application-development-operations.v1')
    throw new TypeError('operations.schemaVersion is invalid.');
  const telemetry = record(value.telemetry, 'operations.telemetry');
  const worker = record(value.worker, 'operations.worker');
  const state = string(worker.state, 'operations.worker.state');
  if (!['idle', 'running', 'stopped', 'stopping'].includes(state))
    throw new TypeError('operations.worker.state is invalid.');
  return Object.freeze({
    appId: string(value.appId, 'operations.appId'),
    capturedAt: string(value.capturedAt, 'operations.capturedAt'),
    deadLetterJobs: Object.freeze(
      array(value.deadLetterJobs, 'operations.deadLetterJobs').map((job, index) =>
        parseJob(job, `operations.deadLetterJobs[${index}]`),
      ),
    ),
    graphRevision: integer(value.graphRevision, 'operations.graphRevision'),
    schemaVersion: value.schemaVersion,
    telemetry: Object.freeze({
      metrics: Object.freeze(
        array(telemetry.metrics, 'operations.telemetry.metrics').map((metric, index) =>
          parseMetric(metric, `operations.telemetry.metrics[${index}]`),
        ),
      ),
      spans: Object.freeze(
        array(telemetry.spans, 'operations.telemetry.spans').map((span, index) =>
          parseSpan(span, `operations.telemetry.spans[${index}]`),
        ),
      ),
    }),
    worker: Object.freeze({
      claimed: integer(worker.claimed, 'operations.worker.claimed'),
      completed: integer(worker.completed, 'operations.worker.completed'),
      failed: integer(worker.failed, 'operations.worker.failed'),
      pendingRetry: integer(worker.pendingRetry, 'operations.worker.pendingRetry'),
      runs: integer(worker.runs, 'operations.worker.runs'),
      state: state as WorkspaceJobWorkerSnapshotV1['state'],
    }),
  });
};

const responseValue = async (response: Response): Promise<unknown> => {
  const source = await response.text();
  if (new TextEncoder().encode(source).byteLength > 1_048_576)
    throw new RangeError('Runtime operations response is too large.');
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw new TypeError('Runtime operations returned invalid JSON.');
  }
  if (!response.ok) {
    const failure = record(value, 'runtime operations error');
    throw new Error(
      typeof failure.error === 'string'
        ? failure.error
        : `Runtime operations returned HTTP ${response.status}.`,
    );
  }
  return value;
};

/** Server-only adapter; its bearer token is never serialized into workspace configuration. */
export class FetchWorkspaceRuntimeOperations implements WorkspaceRuntimeOperationsV1 {
  readonly #endpoint: string;
  readonly #token: string;

  constructor(options: FetchWorkspaceRuntimeOperationsOptionsV1) {
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:')
      throw new TypeError('Runtime operations endpoint must use HTTP or HTTPS.');
    if (endpoint.username || endpoint.password || endpoint.hash)
      throw new TypeError('Runtime operations endpoint cannot contain credentials or a fragment.');
    if (options.token.length < 32)
      throw new TypeError('Runtime operations token must contain at least 32 characters.');
    this.#endpoint = endpoint.href;
    this.#token = options.token;
  }

  async snapshot(): Promise<WorkspaceOperationsSnapshotV1> {
    const response = await fetch(this.#endpoint, {
      headers: { authorization: `Bearer ${this.#token}` },
      signal: AbortSignal.timeout(2_500),
    });
    return parseWorkspaceOperationsSnapshot(await responseValue(response));
  }

  async replayJob(jobId: string, maxAttempts?: number): Promise<ApplicationOutboxJobV1> {
    const response = await fetch(this.#endpoint, {
      body: JSON.stringify({ jobId, ...(maxAttempts === undefined ? {} : { maxAttempts }) }),
      headers: {
        authorization: `Bearer ${this.#token}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      signal: AbortSignal.timeout(2_500),
    });
    return parseJob(await responseValue(response), 'replayedJob');
  }
}
