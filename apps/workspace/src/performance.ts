import type { ApplicationMetricV1 } from '@oxe/graph';

export interface PageNavigationPerformanceSample {
  readonly decodedBodySize: number;
  readonly domContentLoadedEventEnd: number;
  readonly duration: number;
  readonly loadEventEnd: number;
  readonly requestStart: number;
  readonly responseStart: number;
  readonly startTime: number;
  readonly transferSize: number;
}

export interface PageResourcePerformanceSample {
  readonly decodedBodySize: number;
  readonly duration: number;
  readonly initiatorType: string;
  readonly name: string;
  readonly transferSize: number;
}

export interface PagePerformanceInput {
  readonly firstContentfulPaintMs?: number;
  readonly navigation?: PageNavigationPerformanceSample;
  readonly resources: readonly PageResourcePerformanceSample[];
}

export interface PagePerformanceSummary {
  readonly decodedBytes: number;
  readonly domContentLoadedMs?: number;
  readonly firstContentfulPaintMs?: number;
  readonly loadMs?: number;
  readonly requestCount: number;
  readonly slowestResources: readonly PageResourcePerformanceSample[];
  readonly transferBytes: number;
  readonly ttfbMs?: number;
}

export interface RuntimePerformanceSummary {
  readonly averageDurationMs: number;
  readonly failureCount: number;
  readonly maximumDurationMs: number;
  readonly slowestSemanticId?: string;
  readonly totalCount: number;
}

const elapsed = (end: number, start: number): number | undefined =>
  end > 0 && end >= start ? end - start : undefined;

/** Produces a small, deterministic page-load summary from browser Performance API samples. */
export const summarizePagePerformance = (input: PagePerformanceInput): PagePerformanceSummary => {
  const navigation = input.navigation;
  const domContentLoadedMs = navigation
    ? elapsed(navigation.domContentLoadedEventEnd, navigation.startTime)
    : undefined;
  const loadMs = navigation
    ? (elapsed(navigation.loadEventEnd, navigation.startTime) ??
      (navigation.duration > 0 ? navigation.duration : undefined))
    : undefined;
  const ttfbMs = navigation
    ? elapsed(navigation.responseStart, navigation.requestStart)
    : undefined;
  const sortedResources = [...input.resources].sort(
    (left, right) => right.duration - left.duration || left.name.localeCompare(right.name),
  );
  return Object.freeze({
    decodedBytes:
      (navigation?.decodedBodySize ?? 0) +
      input.resources.reduce((total, resource) => total + resource.decodedBodySize, 0),
    ...(domContentLoadedMs === undefined ? {} : { domContentLoadedMs }),
    ...(input.firstContentfulPaintMs === undefined
      ? {}
      : { firstContentfulPaintMs: input.firstContentfulPaintMs }),
    ...(loadMs === undefined ? {} : { loadMs }),
    requestCount: input.resources.length + (navigation ? 1 : 0),
    slowestResources: Object.freeze(sortedResources.slice(0, 5).map((entry) => ({ ...entry }))),
    transferBytes:
      (navigation?.transferSize ?? 0) +
      input.resources.reduce((total, resource) => total + resource.transferSize, 0),
    ...(ttfbMs === undefined ? {} : { ttfbMs }),
  });
};

/** Aggregates privacy-safe application telemetry without exposing arguments or record values. */
export const summarizeRuntimePerformance = (
  metrics: readonly ApplicationMetricV1[],
): RuntimePerformanceSummary => {
  const totalCount = metrics.reduce((total, metric) => total + metric.totalCount, 0);
  const totalDurationMs = metrics.reduce((total, metric) => total + metric.totalDurationMs, 0);
  const slowest = [...metrics].sort(
    (left, right) =>
      right.maxDurationMs - left.maxDurationMs || left.semanticId.localeCompare(right.semanticId),
  )[0];
  return Object.freeze({
    averageDurationMs: totalCount === 0 ? 0 : totalDurationMs / totalCount,
    failureCount: metrics.reduce((total, metric) => total + metric.failureCount, 0),
    maximumDurationMs: slowest?.maxDurationMs ?? 0,
    ...(slowest ? { slowestSemanticId: slowest.semanticId } : {}),
    totalCount,
  });
};

export const formatPerformanceBytes = (bytes: number): string => {
  if (bytes < 1_024) return `${Math.round(bytes)} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(2)} MB`;
};

export const formatPerformanceMilliseconds = (milliseconds?: number): string =>
  milliseconds === undefined ? '—' : `${milliseconds.toFixed(milliseconds < 10 ? 1 : 0)} ms`;
