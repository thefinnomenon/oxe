import type { ApplicationHostFailureKindV1 } from './application-host.js';

export type ApplicationTraceSpanKindV1 = 'job' | 'operation' | 'query';

/** Privacy-safe runtime span. Values, identities, record ids, and provider payloads are excluded. */
export interface ApplicationTraceSpanV1 {
  readonly appId: string;
  readonly durationMs: number;
  readonly failureKind?: ApplicationHostFailureKindV1 | 'internal';
  readonly graphRevision: number;
  readonly kind: ApplicationTraceSpanKindV1;
  readonly outcome: 'failure' | 'success';
  readonly schemaVersion: 'oxe.application-trace-span.v1';
  readonly semanticId: string;
  readonly spanId: string;
  readonly traceId: string;
}

export interface ApplicationTelemetrySinkV1 {
  /** Implementations must not throw. Hosts still isolate a misbehaving sink defensively. */
  emit(span: ApplicationTraceSpanV1): void;
}

export interface ApplicationMetricV1 {
  readonly failureCount: number;
  readonly kind: ApplicationTraceSpanKindV1;
  readonly maxDurationMs: number;
  readonly semanticId: string;
  readonly successCount: number;
  readonly totalCount: number;
  readonly totalDurationMs: number;
}

export interface ApplicationTelemetrySnapshotV1 {
  readonly metrics: readonly ApplicationMetricV1[];
  readonly spans: readonly ApplicationTraceSpanV1[];
}

export interface ApplicationTelemetryCollectorV1 extends ApplicationTelemetrySinkV1 {
  snapshot(): ApplicationTelemetrySnapshotV1;
}

export interface ApplicationTelemetryCollectorOptionsV1 {
  /** Maximum recent spans retained in memory. Defaults to 1,000. */
  readonly maximumSpans?: number;
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/** Small bounded collector for tests, local development, and adapter-backed export. */
export const createApplicationTelemetryCollector = (
  options: ApplicationTelemetryCollectorOptionsV1 = {},
): ApplicationTelemetryCollectorV1 => {
  const maximumSpans = options.maximumSpans ?? 1_000;
  if (!Number.isInteger(maximumSpans) || maximumSpans < 1)
    throw new TypeError('maximumSpans must be a positive integer.');
  const spans: ApplicationTraceSpanV1[] = [];
  return Object.freeze({
    emit(span: ApplicationTraceSpanV1): void {
      spans.push(Object.freeze({ ...span }));
      if (spans.length > maximumSpans) spans.splice(0, spans.length - maximumSpans);
    },
    snapshot(): ApplicationTelemetrySnapshotV1 {
      const aggregates = new Map<string, ApplicationMetricV1>();
      for (const span of spans) {
        const key = `${span.kind}\0${span.semanticId}`;
        const previous = aggregates.get(key);
        aggregates.set(key, {
          failureCount: (previous?.failureCount ?? 0) + (span.outcome === 'failure' ? 1 : 0),
          kind: span.kind,
          maxDurationMs: Math.max(previous?.maxDurationMs ?? 0, span.durationMs),
          semanticId: span.semanticId,
          successCount: (previous?.successCount ?? 0) + (span.outcome === 'success' ? 1 : 0),
          totalCount: (previous?.totalCount ?? 0) + 1,
          totalDurationMs: (previous?.totalDurationMs ?? 0) + span.durationMs,
        });
      }
      return Object.freeze({
        metrics: Object.freeze(
          [...aggregates.values()]
            .sort(
              (left, right) =>
                compareText(left.kind, right.kind) ||
                compareText(left.semanticId, right.semanticId),
            )
            .map((metric) => Object.freeze(metric)),
        ),
        spans: Object.freeze(spans.map((span) => Object.freeze({ ...span }))),
      });
    },
  });
};

export interface ApplicationSpanRecorderV1 {
  observeAsync<T>(
    kind: ApplicationTraceSpanKindV1,
    semanticId: string,
    run: () => Promise<T>,
  ): Promise<T>;
  observeSync<T>(kind: ApplicationTraceSpanKindV1, semanticId: string, run: () => T): T;
}

export interface ApplicationSpanRecorderOptionsV1 {
  readonly appId: string;
  readonly clock?: () => number;
  readonly generateSpanId?: () => string;
  readonly graphRevision: number;
  readonly telemetry?: ApplicationTelemetrySinkV1;
}

const failureKind = (error: unknown): ApplicationHostFailureKindV1 | 'internal' => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'kind' in error &&
    (error.kind === 'forbidden' ||
      error.kind === 'not-found' ||
      error.kind === 'unauthorized' ||
      error.kind === 'validation')
  )
    return error.kind;
  return 'internal';
};

/** Creates one defensive recorder; telemetry failures never change application behavior. */
export const createApplicationSpanRecorder = (
  options: ApplicationSpanRecorderOptionsV1,
): ApplicationSpanRecorderV1 => {
  let sequence = 0;
  const clock = options.clock ?? (() => performance.now());
  const nextSpanId = options.generateSpanId ?? (() => `span-${(sequence += 1)}`);
  const safeClock = (): number => {
    try {
      const value = clock();
      return Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  };
  const emit = (
    kind: ApplicationTraceSpanKindV1,
    semanticId: string,
    startedAt: number,
    outcome: 'failure' | 'success',
    error?: unknown,
  ): void => {
    if (!options.telemetry) return;
    try {
      const spanId = nextSpanId();
      options.telemetry.emit({
        appId: options.appId,
        durationMs: Math.max(0, safeClock() - startedAt),
        ...(outcome === 'failure' ? { failureKind: failureKind(error) } : {}),
        graphRevision: options.graphRevision,
        kind,
        outcome,
        schemaVersion: 'oxe.application-trace-span.v1',
        semanticId,
        spanId,
        traceId: spanId,
      });
    } catch {
      // Observability is non-authoritative and cannot break application execution.
    }
  };
  return Object.freeze({
    async observeAsync<T>(
      kind: ApplicationTraceSpanKindV1,
      semanticId: string,
      run: () => Promise<T>,
    ): Promise<T> {
      if (!options.telemetry) return run();
      const startedAt = safeClock();
      try {
        const value = await run();
        emit(kind, semanticId, startedAt, 'success');
        return value;
      } catch (error) {
        emit(kind, semanticId, startedAt, 'failure', error);
        throw error;
      }
    },
    observeSync<T>(kind: ApplicationTraceSpanKindV1, semanticId: string, run: () => T): T {
      if (!options.telemetry) return run();
      const startedAt = safeClock();
      try {
        const value = run();
        emit(kind, semanticId, startedAt, 'success');
        return value;
      } catch (error) {
        emit(kind, semanticId, startedAt, 'failure', error);
        throw error;
      }
    },
  });
};
