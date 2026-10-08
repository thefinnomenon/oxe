import { describe, expect, it } from 'vitest';

import {
  formatPerformanceBytes,
  formatPerformanceMilliseconds,
  summarizePagePerformance,
  summarizeRuntimePerformance,
} from '../src/performance.js';

describe('workspace performance summaries', () => {
  it('summarizes navigation and resource timing deterministically', () => {
    const summary = summarizePagePerformance({
      firstContentfulPaintMs: 42.25,
      navigation: {
        decodedBodySize: 2_000,
        domContentLoadedEventEnd: 75,
        duration: 120,
        loadEventEnd: 120,
        requestStart: 5,
        responseStart: 25,
        startTime: 0,
        transferSize: 1_000,
      },
      resources: [
        {
          decodedBodySize: 10_000,
          duration: 30,
          initiatorType: 'script',
          name: '/client.js',
          transferSize: 4_000,
        },
        {
          decodedBodySize: 20_000,
          duration: 50,
          initiatorType: 'css',
          name: '/styles.css',
          transferSize: 5_000,
        },
      ],
    });

    expect(summary).toMatchObject({
      decodedBytes: 32_000,
      domContentLoadedMs: 75,
      firstContentfulPaintMs: 42.25,
      loadMs: 120,
      requestCount: 3,
      transferBytes: 10_000,
      ttfbMs: 20,
    });
    expect(summary.slowestResources.map((resource) => resource.name)).toEqual([
      '/styles.css',
      '/client.js',
    ]);
  });

  it('aggregates privacy-safe runtime metrics and formats display values', () => {
    const summary = summarizeRuntimePerformance([
      {
        failureCount: 1,
        kind: 'query',
        maxDurationMs: 24,
        semanticId: 'query.tasks',
        successCount: 2,
        totalCount: 3,
        totalDurationMs: 45,
      },
      {
        failureCount: 0,
        kind: 'operation',
        maxDurationMs: 12,
        semanticId: 'operation.createTask',
        successCount: 1,
        totalCount: 1,
        totalDurationMs: 12,
      },
    ]);

    expect(summary).toEqual({
      averageDurationMs: 14.25,
      failureCount: 1,
      maximumDurationMs: 24,
      slowestSemanticId: 'query.tasks',
      totalCount: 4,
    });
    expect(formatPerformanceBytes(12_288)).toBe('12.0 KB');
    expect(formatPerformanceMilliseconds(8.25)).toBe('8.3 ms');
    expect(formatPerformanceMilliseconds()).toBe('—');
  });
});
