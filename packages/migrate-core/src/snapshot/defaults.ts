import type { DatabaseColumnDefault } from './types.js';

export const normalizeDefaultValue = (value: unknown): DatabaseColumnDefault | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value === 'now') {
    return { kind: 'raw_sql', sql: 'now()' };
  }

  if (value === 'uuidv7') {
    return { kind: 'raw_sql', sql: 'uuidv7()' };
  }

  return { kind: 'literal', value };
};
