import type { ApplicationJobRetryV1 } from './application-types.js';

export interface ApplicationResolvedJobRetryV1 {
  readonly initialDelayMs: number;
  readonly jitterRatio: number;
  readonly maxAttempts: number;
  readonly maxDelayMs: number;
  readonly multiplier: number;
}

export const resolveApplicationJobRetry = (
  retry: ApplicationJobRetryV1,
): ApplicationResolvedJobRetryV1 => {
  const initialDelayMs = retry.initialDelayMs ?? 1_000;
  return {
    initialDelayMs,
    jitterRatio: retry.jitterRatio ?? 0.2,
    maxAttempts: retry.maxAttempts,
    maxDelayMs: retry.maxDelayMs ?? Math.max(60_000, initialDelayMs),
    multiplier: retry.multiplier ?? 2,
  };
};

/** Calculates the delay after a numbered failed attempt with bounded symmetric jitter. */
export const calculateApplicationJobRetryDelay = (
  retry: ApplicationJobRetryV1,
  failedAttempt: number,
  random: () => number = Math.random,
): number => {
  const resolved = resolveApplicationJobRetry(retry);
  const exponent = Math.max(0, failedAttempt - 1);
  const exponential = Math.min(
    resolved.maxDelayMs,
    resolved.initialDelayMs * resolved.multiplier ** exponent,
  );
  const sample = Math.min(1, Math.max(0, random()));
  const jitter = exponential * resolved.jitterRatio * (sample * 2 - 1);
  return Math.min(resolved.maxDelayMs, Math.max(0, Math.round(exponential + jitter)));
};
