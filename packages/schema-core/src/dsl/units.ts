export const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'KiB', 'MiB', 'GiB', 'TiB'] as const;

export const DURATION_UNITS = ['ms', 's', 'm', 'h', 'd', 'w'] as const;

export type SizeUnit = (typeof SIZE_UNITS)[number];

export type DurationUnit = (typeof DURATION_UNITS)[number];

export type SizeInput = number | `${number}${SizeUnit}` | `${number} ${SizeUnit}`;

export type DurationInput = number | `${number}${DurationUnit}` | `${number} ${DurationUnit}`;

const SIZE_MULTIPLIERS: Record<string, number> = {
  b: 1,
  kb: 1_000,
  mb: 1_000_000,
  gb: 1_000_000_000,
  tb: 1_000_000_000_000,
  kib: 1_024,
  mib: 1_048_576,
  gib: 1_073_741_824,
  tib: 1_099_511_627_776,
};

const DURATION_MULTIPLIERS: Record<string, number> = {
  ms: 1 / 1_000,
  s: 1,
  m: 60,
  h: 3_600,
  d: 86_400,
  w: 604_800,
};

const parseUnitNumber = (value: number, label: string): number => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number.`);
  }

  return value;
};

const parseUnitString = (
  value: string,
  multipliers: Record<string, number>,
  label: string,
): number => {
  const trimmed = value.trim();
  const match = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)$/);

  if (!match) {
    throw new Error(
      `${label} must use <number><unit> format (for example: "1MB", "512KiB", "30s", "1h").`,
    );
  }

  const numericValue = Number.parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = multipliers[unit];

  if (multiplier === undefined) {
    throw new Error(`Unsupported ${label} unit "${match[2]}".`);
  }

  return parseUnitNumber(numericValue * multiplier, label);
};

export const toSizeBytes = (value: SizeInput): number => {
  if (typeof value === 'number') {
    return parseUnitNumber(value, 'Size');
  }

  return parseUnitString(value, SIZE_MULTIPLIERS, 'Size');
};

export const toDurationSeconds = (value: DurationInput): number => {
  if (typeof value === 'number') {
    return parseUnitNumber(value, 'Duration');
  }

  return parseUnitString(value, DURATION_MULTIPLIERS, 'Duration');
};

export const units = {
  size: {
    B: (value: number): number => parseUnitNumber(value, 'Size'),
    KB: (value: number): number => parseUnitNumber(value * 1_000, 'Size'),
    MB: (value: number): number => parseUnitNumber(value * 1_000_000, 'Size'),
    GB: (value: number): number => parseUnitNumber(value * 1_000_000_000, 'Size'),
    TB: (value: number): number => parseUnitNumber(value * 1_000_000_000_000, 'Size'),
    KiB: (value: number): number => parseUnitNumber(value * 1_024, 'Size'),
    MiB: (value: number): number => parseUnitNumber(value * 1_048_576, 'Size'),
    GiB: (value: number): number => parseUnitNumber(value * 1_073_741_824, 'Size'),
    TiB: (value: number): number => parseUnitNumber(value * 1_099_511_627_776, 'Size'),
  },
  duration: {
    ms: (value: number): number => parseUnitNumber(value / 1_000, 'Duration'),
    s: (value: number): number => parseUnitNumber(value, 'Duration'),
    m: (value: number): number => parseUnitNumber(value * 60, 'Duration'),
    h: (value: number): number => parseUnitNumber(value * 3_600, 'Duration'),
    d: (value: number): number => parseUnitNumber(value * 86_400, 'Duration'),
    w: (value: number): number => parseUnitNumber(value * 604_800, 'Duration'),
  },
} as const;
