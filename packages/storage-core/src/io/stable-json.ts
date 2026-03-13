const stableSortValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => stableSortValue(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return Object.fromEntries(entries.map(([key, entry]) => [key, stableSortValue(entry)]));
};

export const stableJsonStringify = (value: unknown): string =>
  `${JSON.stringify(stableSortValue(value), null, 2)}\n`;
