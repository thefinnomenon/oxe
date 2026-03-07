const stableSerialize = (value: unknown): string => {
  if (value === undefined) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`);

    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
};

export const stableJsonStringify = (value: unknown, indent = 2): string => {
  const normalized = JSON.parse(stableSerialize(value));
  return `${JSON.stringify(normalized, null, indent)}\n`;
};
