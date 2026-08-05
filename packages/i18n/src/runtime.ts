import {
  createCell,
  localizationContextsEqual,
  resolveLocalizationContext,
  type LocalizationContextInput,
  type LocalizationContextV1,
  type Readable,
} from '@oxe/runtime';

import type {
  CatalogMessage,
  LocaleCatalog,
  MessageSelectionKind,
  PluralCategory,
} from './types.js';

export type { LocaleCatalog } from './types.js';

const categoryOrder: readonly PluralCategory[] = ['zero', 'one', 'two', 'few', 'many', 'other'];

const rules = new Map<string, Intl.PluralRules>();

const pluralRules = (locale: string, kind: MessageSelectionKind): Intl.PluralRules => {
  const key = `${locale}\0${kind}`;
  const existing = rules.get(key);
  if (existing) {
    return existing;
  }
  const created = new Intl.PluralRules(locale, {
    type: kind === 'cardinal' ? 'cardinal' : 'ordinal',
  });
  rules.set(key, created);
  return created;
};

export const pluralCategories = (
  locale: string,
  kind: MessageSelectionKind,
): readonly PluralCategory[] => {
  const available = new Set(pluralRules(locale, kind).resolvedOptions().pluralCategories);
  return categoryOrder.filter((category) => available.has(category));
};

export const pluralCategoryExample = (
  locale: string,
  kind: MessageSelectionKind,
  category: PluralCategory,
): number => {
  const selector = pluralRules(locale, kind);
  for (let value = 0; value <= 1000; value += 1) {
    if (selector.select(value) === category) {
      return value;
    }
  }
  for (let exponent = 3; exponent <= 15; exponent += 1) {
    const value = 10 ** exponent;
    if (selector.select(value) === category) {
      return value;
    }
  }
  if (kind === 'cardinal') {
    for (let tenth = 1; tenth <= 1000; tenth += 1) {
      const value = tenth / 10;
      if (selector.select(value) === category) {
        return value;
      }
    }
  }
  throw new RangeError(`Could not find a ${kind} ${category} example for ${locale}.`);
};

export interface FormatCatalogMessageOptions {
  readonly count?: number;
  readonly ordinal?: number;
  readonly values?: Readonly<Record<string, boolean | number | string>>;
}

export type LocalizedContentPart =
  | string
  | {
      readonly children: readonly LocalizedContentPart[];
      readonly kind: 'markup';
      readonly name: string;
    };

export interface FormatCatalogPartsOptions extends FormatCatalogMessageOptions {
  readonly markup?: readonly string[];
}

export type FormatValueOptions =
  | ({ readonly type: 'currency'; readonly currency: string } & Omit<
      Intl.NumberFormatOptions,
      'currency' | 'style'
    >)
  | ({ readonly type: 'date' | 'datetime' | 'time' } & Intl.DateTimeFormatOptions);

const numberFormatters = new Map<string, Intl.NumberFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

const formatterKey = (locale: string, options: object): string =>
  `${locale}\0${JSON.stringify(
    Object.entries(options).sort(([left], [right]) => left.localeCompare(right)),
  )}`;

const dateValue = (value: unknown): Date | number => {
  if (value instanceof Date || typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) return parsed;
  }
  throw new TypeError('A localized date or time value must be a Date, timestamp, or ISO string.');
};

export const formatIntlValue = (
  locale: string,
  value: unknown,
  options: FormatValueOptions,
): string => {
  if (options.type === 'currency') {
    const numberOptions = Object.fromEntries(
      Object.entries(options).filter(([name]) => name !== 'type'),
    ) as Intl.NumberFormatOptions;
    const resolved = { ...numberOptions, style: 'currency' as const };
    const key = formatterKey(locale, resolved);
    let formatter = numberFormatters.get(key);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, resolved);
      numberFormatters.set(key, formatter);
    }
    if (typeof value !== 'number') {
      throw new TypeError('A localized currency value must be a number.');
    }
    return formatter.format(value);
  }
  const { type, ...dateOptions } = options;
  const resolved: Intl.DateTimeFormatOptions =
    type === 'date'
      ? dateOptions
      : type === 'time'
        ? { ...dateOptions, ...(dateOptions.timeStyle ? {} : { timeStyle: 'short' }) }
        : dateOptions;
  const key = formatterKey(locale, resolved);
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, resolved);
    dateFormatters.set(key, formatter);
  }
  return formatter.format(dateValue(value));
};

export const machineIntlValue = (value: unknown, type: FormatValueOptions['type']): string => {
  if (type === 'currency') return String(value);
  const date = dateValue(value);
  const iso = new Date(typeof date === 'number' ? date : date.valueOf()).toISOString();
  if (type === 'date') return iso.slice(0, 10);
  if (type === 'time') return iso.slice(11, 19);
  return iso;
};

const selectedText = (
  locale: string,
  message: CatalogMessage,
  options: FormatCatalogMessageOptions,
): string => {
  if (typeof message === 'string') {
    return message;
  }
  const value = message.kind === 'cardinal' ? options.count : options.ordinal;
  if (value === undefined) {
    throw new TypeError(
      `${message.kind === 'cardinal' ? 'count' : 'ordinal'} is required for this localized message.`,
    );
  }
  const category = pluralRules(locale, message.kind).select(value) as PluralCategory;
  const selected = message.cases[category] ?? message.cases.other;
  if (selected !== undefined) {
    return selected;
  }
  const fallback = categoryOrder.map((candidate) => message.cases[candidate]).find(Boolean);
  if (fallback === undefined) {
    throw new TypeError(`The ${locale} ${message.kind} message has no cases.`);
  }
  return fallback;
};

const interpolate = (
  message: string,
  values: Readonly<Record<string, boolean | number | string>>,
): string =>
  message.replace(/\{([A-Za-z0-9_]+)\}/gu, (token, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : token,
  );

export const formatCatalogMessage = (
  catalog: LocaleCatalog,
  id: string,
  options: FormatCatalogMessageOptions = {},
): string => {
  const message = catalog.messages[id];
  if (message === undefined) {
    throw new RangeError(`Missing ${catalog.locale} translation for ${id}.`);
  }
  return interpolate(selectedText(catalog.locale, message, options), options.values ?? {});
};

export const formatCatalogParts = (
  catalog: LocaleCatalog,
  id: string,
  options: FormatCatalogPartsOptions = {},
): readonly LocalizedContentPart[] => {
  const message = catalog.messages[id];
  if (message === undefined) {
    throw new RangeError(`Missing ${catalog.locale} translation for ${id}.`);
  }
  const text = selectedText(catalog.locale, message, options);
  const markup = new Set(options.markup ?? []);
  const root: LocalizedContentPart[] = [];
  const stack: { children: LocalizedContentPart[]; name?: string }[] = [{ children: root }];
  const pattern = /(<\/?[A-Za-z0-9_]+>|\{[A-Za-z0-9_]+\})/gu;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    const index = match.index;
    const current = stack.at(-1);
    if (!current) throw new TypeError(`Invalid localized markup in ${id}.`);
    if (index > offset) current.children.push(text.slice(offset, index));
    if (token.startsWith('{')) {
      const name = token.slice(1, -1);
      current.children.push(
        Object.hasOwn(options.values ?? {}, name) ? String(options.values?.[name]) : token,
      );
    } else if (token.startsWith('</')) {
      const name = token.slice(2, -1);
      const completed = stack.pop();
      const parent = stack.at(-1);
      if (!completed?.name || completed.name !== name || !parent) {
        throw new TypeError(`Mismatched localized markup token ${token} in ${id}.`);
      }
      parent.children.push({ children: completed.children, kind: 'markup', name });
    } else {
      const name = token.slice(1, -1);
      if (!markup.has(name)) {
        current.children.push(token);
      } else {
        stack.push({ children: [], name });
      }
    }
    offset = index + token.length;
  }
  const current = stack.at(-1);
  if (!current) throw new TypeError(`Invalid localized markup in ${id}.`);
  if (offset < text.length) current.children.push(text.slice(offset));
  if (stack.length !== 1) {
    throw new TypeError(`Unclosed localized markup token <${stack.at(-1)?.name}> in ${id}.`);
  }
  return root;
};

export interface I18nRuntime {
  addCatalog(catalog: LocaleCatalog): void;
  adoptContext(context: LocalizationContextV1): void;
  readonly context: LocalizationContextV1;
  format(id: string, options?: FormatCatalogMessageOptions): string;
  formatToParts(id: string, options?: FormatCatalogPartsOptions): readonly LocalizedContentPart[];
  formatValue(value: unknown, options: FormatValueOptions): string;
  readonly locale: string;
  readonly revision: Readable<number>;
  machineValue(value: unknown, type: FormatValueOptions['type']): string;
  setLocale(locale: string): void;
  readonly supportedLocales: readonly string[];
}

export interface CreateI18nOptions extends LocalizationContextInput {
  readonly catalogs: readonly LocaleCatalog[];
}

export const createI18n = (options: CreateI18nOptions): I18nRuntime => {
  const catalogs = new Map(
    options.catalogs.map((catalog) => [
      Intl.getCanonicalLocales(catalog.locale)[0] ?? catalog.locale,
      catalog,
    ]),
  );
  let context = resolveLocalizationContext(options);
  const revision = createCell(0, { name: 'i18n locale and catalogs' });
  if (!catalogs.has(context.locale)) {
    throw new RangeError(`No localization catalog is loaded for ${context.locale}.`);
  }
  return {
    addCatalog(catalog): void {
      const canonical = Intl.getCanonicalLocales(catalog.locale)[0] ?? catalog.locale;
      catalogs.set(canonical, catalog);
      revision.write(revision.read() + 1);
    },
    adoptContext(nextContext): void {
      const resolved = resolveLocalizationContext(nextContext);
      if (!catalogs.has(resolved.locale)) {
        throw new RangeError(`No localization catalog is loaded for ${resolved.locale}.`);
      }
      if (localizationContextsEqual(context, resolved)) return;
      context = resolved;
      revision.write(revision.read() + 1);
    },
    get context(): LocalizationContextV1 {
      return context;
    },
    format(id, formatOptions = {}): string {
      const catalog = catalogs.get(context.locale);
      if (!catalog) {
        throw new RangeError(`No localization catalog is loaded for ${context.locale}.`);
      }
      return formatCatalogMessage(catalog, id, formatOptions);
    },
    formatToParts(id, formatOptions = {}): readonly LocalizedContentPart[] {
      const catalog = catalogs.get(context.locale);
      if (!catalog) {
        throw new RangeError(`No localization catalog is loaded for ${context.locale}.`);
      }
      return formatCatalogParts(catalog, id, formatOptions);
    },
    formatValue(value, formatOptions): string {
      const contextualOptions: FormatValueOptions =
        formatOptions.type === 'currency'
          ? {
              numberingSystem: context.numberingSystem,
              ...formatOptions,
            }
          : {
              calendar: context.calendar,
              numberingSystem: context.numberingSystem,
              timeZone: context.timeZone,
              ...formatOptions,
            };
      return formatIntlValue(context.locale, value, contextualOptions);
    },
    get locale(): string {
      return context.locale;
    },
    revision,
    machineValue(value, type): string {
      return machineIntlValue(value, type);
    },
    setLocale(nextLocale): void {
      const canonical = Intl.getCanonicalLocales(nextLocale)[0] ?? nextLocale;
      if (!catalogs.has(canonical)) {
        throw new RangeError(`No localization catalog is loaded for ${canonical}.`);
      }
      context = resolveLocalizationContext({ ...context, locale: canonical });
      revision.write(revision.read() + 1);
    },
    get supportedLocales(): readonly string[] {
      return [...catalogs.keys()].sort();
    },
  };
};
