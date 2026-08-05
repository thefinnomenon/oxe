import { OxeRouterError } from './errors.js';
import type { RouteLocalizationV1, RouteManifestV1 } from './types.js';

const invalid = (message: string): never => {
  throw new OxeRouterError('OXE_ROUTE_INVALID_MANIFEST', message);
};

const canonicalLocale = (value: string, description = 'Locale'): string => {
  try {
    const locale = Intl.getCanonicalLocales(value)[0];
    if (locale) return locale;
  } catch {
    // The common diagnostic below is clearer than the platform exception.
  }
  return invalid(`${description} ${JSON.stringify(value)} must be a valid BCP 47 locale.`);
};

export const createRouteLocalization = (
  defaultLocale: string,
  configuredLocales: readonly string[],
): RouteLocalizationV1 => {
  const canonicalDefault = canonicalLocale(defaultLocale, 'The default locale');
  const locales = [
    canonicalDefault,
    ...new Set(
      configuredLocales
        .map((locale) => canonicalLocale(locale, 'Configured locale'))
        .filter((locale) => locale !== canonicalDefault),
    ),
  ];
  return Object.freeze({ defaultLocale: canonicalDefault, locales: Object.freeze(locales) });
};

export const localePathPrefix = (localization: RouteLocalizationV1, locale: string): string => {
  const canonical = supportedLocale(localization, locale);
  return canonical === localization.defaultLocale ? '' : canonical.toLowerCase();
};

export const supportedLocale = (localization: RouteLocalizationV1, value: string): string => {
  const canonical = canonicalLocale(value);
  const supported = localization.locales.find(
    (locale) => locale.toLowerCase() === canonical.toLowerCase(),
  );
  if (!supported) {
    return invalid(
      `Locale ${JSON.stringify(value)} is not configured; expected one of ${localization.locales.join(', ')}.`,
    );
  }
  return supported;
};

interface LocalizedApplicationPath {
  readonly locale?: string;
  readonly localePrefixed?: boolean;
  readonly pathname: string;
}

export const splitLocalizedApplicationPath = (
  localization: RouteLocalizationV1 | undefined,
  applicationPath: string,
): LocalizedApplicationPath => {
  if (!localization) return { pathname: applicationPath };
  const segments = applicationPath.split('/').filter(Boolean);
  const first = segments[0]?.toLowerCase();
  const locale = localization.locales.find((candidate) => candidate.toLowerCase() === first);
  if (!locale) {
    return { locale: localization.defaultLocale, localePrefixed: false, pathname: applicationPath };
  }
  const pathname = segments.length === 1 ? '/' : `/${segments.slice(1).join('/')}`;
  return { locale, localePrefixed: true, pathname };
};

const parseUrl = (input: string | URL): URL =>
  input instanceof URL ? input : new URL(input, 'http://oxe.invalid');

const applicationPath = (pathname: string, basePath: string): string | undefined => {
  if (basePath === '/') return pathname;
  if (pathname === basePath) return '/';
  return pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : undefined;
};

const withBasePath = (pathname: string, basePath: string): string => {
  if (basePath === '/') return pathname;
  return pathname === '/' ? basePath : `${basePath}${pathname}`;
};

/** Rewrites an application-local URL to the canonical path for a configured locale. */
export const localizedHref = (
  manifest: RouteManifestV1,
  locale: string,
  input: string | URL,
): string => {
  const localization = manifest.localization;
  if (!localization) return invalid('Cannot localize a URL for a manifest without localization.');
  const targetLocale = supportedLocale(localization, locale);
  const url = parseUrl(input);
  const currentApplicationPath = applicationPath(url.pathname, manifest.basePath);
  if (currentApplicationPath === undefined) {
    return invalid(
      `URL ${JSON.stringify(url.pathname)} is outside route base ${manifest.basePath}.`,
    );
  }
  const split = splitLocalizedApplicationPath(localization, currentApplicationPath);
  const prefix = localePathPrefix(localization, targetLocale);
  const localizedPath = prefix
    ? split.pathname === '/'
      ? `/${prefix}`
      : `/${prefix}${split.pathname}`
    : split.pathname;
  return `${withBasePath(localizedPath, manifest.basePath)}${url.search}${url.hash}`;
};

interface AcceptedLanguage {
  readonly index: number;
  readonly quality: number;
  readonly value: string;
}

const acceptedLanguages = (header: string | null): readonly AcceptedLanguage[] =>
  (header ?? '')
    .split(',')
    .map((part, index) => {
      const [rawValue = '', ...parameters] = part.trim().split(';');
      const qualityParameter = parameters.find((parameter) => parameter.trim().startsWith('q='));
      const parsedQuality = qualityParameter ? Number(qualityParameter.trim().slice(2)) : 1;
      return {
        index,
        quality:
          Number.isFinite(parsedQuality) && parsedQuality >= 0 && parsedQuality <= 1
            ? parsedQuality
            : 0,
        value: rawValue.trim(),
      };
    })
    .filter((entry) => entry.value.length > 0 && entry.quality > 0)
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

/** Selects an enabled locale using RFC-style quality order and exact-before-language matching. */
export const negotiateLocale = (
  localization: RouteLocalizationV1,
  acceptLanguage: string | null,
): string => {
  for (const accepted of acceptedLanguages(acceptLanguage)) {
    if (accepted.value === '*') return localization.defaultLocale;
    let canonical: string;
    try {
      canonical = Intl.getCanonicalLocales(accepted.value)[0] ?? accepted.value;
    } catch {
      continue;
    }
    const exact = localization.locales.find(
      (locale) => locale.toLowerCase() === canonical.toLowerCase(),
    );
    if (exact) return exact;
    const language = canonical.split('-')[0]?.toLowerCase();
    const languageMatch = localization.locales.find(
      (locale) => locale.split('-')[0]?.toLowerCase() === language,
    );
    if (languageMatch) return languageMatch;
  }
  return localization.defaultLocale;
};

export const localePreferenceFromCookie = (
  localization: RouteLocalizationV1,
  cookieHeader: string | null,
  cookieName: string,
): string | undefined => {
  for (const part of (cookieHeader ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== cookieName) continue;
    let value: string;
    try {
      value = decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
    try {
      return supportedLocale(localization, value);
    } catch {
      return undefined;
    }
  }
  return undefined;
};
