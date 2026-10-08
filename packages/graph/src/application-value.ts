import type { ApplicationScalarValueV1, ApplicationValueTypeV1 } from './application-types.js';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
const decimalPattern = /^-?(?:0|[1-9]\d*)(?:\.(\d+))?$/u;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

const validDate = (value: string): boolean => {
  if (!datePattern.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
};

const validDecimal = (
  value: string,
  type: Extract<ApplicationValueTypeV1, { readonly kind: 'decimal' }>,
): boolean => {
  const match = decimalPattern.exec(value);
  if (!match) return false;
  const unsigned = value.startsWith('-') ? value.slice(1) : value;
  const [integer = '', fraction = ''] = unsigned.split('.');
  const significantInteger = integer.replace(/^0+/u, '') || '0';
  return (
    fraction.length <= type.scale && significantInteger.length + fraction.length <= type.precision
  );
};

/** Exact JSON-domain validation shared by graph, memory, and PostgreSQL boundaries. */
export const applicationValueMatchesType = (
  value: unknown,
  type: ApplicationValueTypeV1,
): boolean => {
  switch (type.kind) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'bytes':
      return typeof value === 'string' && value.length % 4 === 0 && base64Pattern.test(value);
    case 'date':
      return typeof value === 'string' && validDate(value);
    case 'dateTime':
      return (
        typeof value === 'string' &&
        Number.isFinite(Date.parse(value)) &&
        /(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
      );
    case 'decimal':
      return typeof value === 'string' && validDecimal(value, type);
    case 'email':
      return typeof value === 'string' && emailPattern.test(value);
    case 'entityId':
    case 'string':
      return typeof value === 'string';
    case 'url':
      if (typeof value !== 'string') return false;
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    case 'enum':
      return typeof value === 'string' && type.values.includes(value);
    case 'integer':
      return (
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        (type.minimum === undefined || value >= type.minimum) &&
        (type.maximum === undefined || value <= type.maximum)
      );
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'entity':
      return isRecord(value);
    case 'list':
      return (
        Array.isArray(value) &&
        (type.minimumItems === undefined || value.length >= type.minimumItems) &&
        (type.maximumItems === undefined || value.length <= type.maximumItems) &&
        value.every((item) => applicationValueMatchesType(item, type.items))
      );
    case 'optional':
      return value === null || applicationValueMatchesType(value, type.value);
    case 'record': {
      if (!isRecord(value)) return false;
      const expected = Object.keys(type.fields).sort();
      const actual = Object.keys(value).sort();
      return (
        expected.length === actual.length &&
        expected.every(
          (name, index) =>
            name === actual[index] && applicationValueMatchesType(value[name], type.fields[name]!),
        )
      );
    }
    case 'result': {
      if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'outcome,value') return false;
      if (value.outcome === 'ok') return applicationValueMatchesType(value.value, type.value);
      return (
        typeof value.outcome === 'string' &&
        type.outcomes[value.outcome] !== undefined &&
        applicationValueMatchesType(value.value, type.outcomes[value.outcome]!)
      );
    }
  }
};

export const applicationScalarMatchesType = (
  value: ApplicationScalarValueV1,
  type: ApplicationValueTypeV1,
): boolean => applicationValueMatchesType(value, type);
