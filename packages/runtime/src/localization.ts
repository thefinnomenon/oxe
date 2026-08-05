export const OXE_LOCALIZATION_CONTEXT_SCHEMA = 'oxe.localization-context.v1' as const;

export interface LocalizationContextInput {
  readonly calendar?: string;
  readonly locale: string;
  readonly numberingSystem?: string;
  readonly timeZone?: string;
}

/** Concrete request-local Intl inputs shared by server rendering and hydration. */
export interface LocalizationContextV1 {
  readonly calendar: string;
  readonly locale: string;
  readonly numberingSystem: string;
  readonly schemaVersion: typeof OXE_LOCALIZATION_CONTEXT_SCHEMA;
  readonly timeZone: string;
}

const nonEmpty = (value: string | undefined, name: string): string | undefined => {
  if (value === undefined) return undefined;
  if (value.trim().length === 0) throw new TypeError(`${name} must be a non-empty string.`);
  return value;
};

/** Resolves every host default once so server and browser formatting cannot drift. */
export const resolveLocalizationContext = (
  input: LocalizationContextInput,
): LocalizationContextV1 => {
  const locale = Intl.getCanonicalLocales(nonEmpty(input.locale, 'locale') ?? '')[0];
  if (!locale) throw new RangeError('locale must identify a canonical BCP 47 locale.');
  const timeZone = nonEmpty(input.timeZone, 'timeZone');
  const calendar = nonEmpty(input.calendar, 'calendar');
  const numberingSystem = nonEmpty(input.numberingSystem, 'numberingSystem');
  const date = new Intl.DateTimeFormat(locale, {
    ...(calendar ? { calendar } : {}),
    ...(numberingSystem ? { numberingSystem } : {}),
    ...(timeZone ? { timeZone } : {}),
  }).resolvedOptions();
  const number = new Intl.NumberFormat(locale, {
    ...(numberingSystem ? { numberingSystem } : {}),
  }).resolvedOptions();
  if (calendar && date.calendar !== calendar.toLowerCase()) {
    throw new RangeError(`Unsupported calendar ${JSON.stringify(calendar)} for ${locale}.`);
  }
  if (numberingSystem && number.numberingSystem !== numberingSystem.toLowerCase()) {
    throw new RangeError(
      `Unsupported numbering system ${JSON.stringify(numberingSystem)} for ${locale}.`,
    );
  }
  return Object.freeze({
    calendar: date.calendar,
    locale,
    numberingSystem: number.numberingSystem,
    schemaVersion: OXE_LOCALIZATION_CONTEXT_SCHEMA,
    timeZone: date.timeZone,
  });
};

export const localizationContextsEqual = (
  left: LocalizationContextV1,
  right: LocalizationContextV1,
): boolean =>
  left.locale === right.locale &&
  left.timeZone === right.timeZone &&
  left.calendar === right.calendar &&
  left.numberingSystem === right.numberingSystem;

export const parseLocalizationContext = (value: unknown): LocalizationContextV1 => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== OXE_LOCALIZATION_CONTEXT_SCHEMA ||
    !('locale' in value) ||
    typeof value.locale !== 'string' ||
    !('timeZone' in value) ||
    typeof value.timeZone !== 'string' ||
    !('calendar' in value) ||
    typeof value.calendar !== 'string' ||
    !('numberingSystem' in value) ||
    typeof value.numberingSystem !== 'string'
  ) {
    throw new TypeError('Serialized OXE localization context is invalid.');
  }
  return resolveLocalizationContext({
    calendar: value.calendar,
    locale: value.locale,
    numberingSystem: value.numberingSystem,
    timeZone: value.timeZone,
  });
};
