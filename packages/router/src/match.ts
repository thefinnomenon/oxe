import { OxeRouterError } from './errors.js';
import type {
  RouteLocation,
  RouteManifestV1,
  RouteMatch,
  RouteParamValue,
  RouteParams,
  RoutePathSegmentV1,
  RouteSearchParams,
  RouteSearchRecord,
} from './types.js';

const decodeSegment = (segment: string): string | undefined => {
  try {
    const decoded = decodeURIComponent(segment);
    return decoded.includes('/') ? undefined : decoded;
  } catch {
    return undefined;
  }
};

const normalizedPathname = (pathname: string): string | undefined => {
  if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('//')) {
    return undefined;
  }
  return pathname.length > 1 ? pathname.replace(/\/+$/u, '') : '/';
};

const removeBasePath = (pathname: string, basePath: string): string | undefined => {
  if (basePath === '/') return pathname;
  if (pathname === basePath) return '/';
  return pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : undefined;
};

const matchPath = (
  pattern: readonly RoutePathSegmentV1[],
  encodedSegments: readonly string[],
): RouteParams | undefined => {
  const params: Record<string, RouteParamValue> = {};
  let position = 0;
  for (const segment of pattern) {
    if (segment.kind === 'catch-all') {
      const values: string[] = [];
      while (position < encodedSegments.length) {
        const decoded = decodeSegment(encodedSegments[position] ?? '');
        if (decoded === undefined) return undefined;
        values.push(decoded);
        position += 1;
      }
      if (values.length === 0) return undefined;
      params[segment.name] = Object.freeze(values);
      continue;
    }
    const encoded = encodedSegments[position];
    if (encoded === undefined) return undefined;
    const decoded = decodeSegment(encoded);
    if (decoded === undefined) return undefined;
    if (segment.kind === 'static') {
      if (decoded !== segment.value) return undefined;
    } else {
      params[segment.name] = decoded;
    }
    position += 1;
  }
  return position === encodedSegments.length ? Object.freeze(params) : undefined;
};

const parseLocation = (input: string | URL): URL => {
  try {
    return input instanceof URL ? input : new URL(input, 'http://oxe.invalid');
  } catch (error) {
    throw new OxeRouterError(
      'OXE_ROUTE_NOT_FOUND',
      `Cannot interpret route URL ${JSON.stringify(String(input))}: ${String(error)}.`,
    );
  }
};

export const matchRoute = (
  manifest: RouteManifestV1,
  input: string | URL,
): RouteMatch | undefined => {
  const url = parseLocation(input);
  const pathname = normalizedPathname(url.pathname);
  if (!pathname) return undefined;
  const applicationPath = removeBasePath(pathname, manifest.basePath);
  if (!applicationPath) return undefined;
  const encodedSegments = applicationPath.split('/').filter(Boolean);
  for (const route of manifest.routes) {
    const params = matchPath(route.path, encodedSegments);
    if (!params) continue;
    const location: RouteLocation = Object.freeze({
      hash: url.hash,
      href: `${pathname}${url.search}${url.hash}`,
      pathname,
      search: url.search,
    });
    return Object.freeze({ location, params, route });
  }
  return undefined;
};

class ImmutableRouteSearchParams implements RouteSearchParams {
  readonly #params: URLSearchParams;

  public constructor(search: string) {
    this.#params = new URLSearchParams(search);
  }

  public entries(): IterableIterator<[string, string]> {
    return this.#params.entries();
  }

  public get(name: string): string | null {
    return this.#params.get(name);
  }

  public getAll(name: string): readonly string[] {
    return Object.freeze(this.#params.getAll(name));
  }

  public has(name: string): boolean {
    return this.#params.has(name);
  }

  public toString(): string {
    return this.#params.toString();
  }
}

export const createRouteSearchParams = (search: string): RouteSearchParams =>
  Object.freeze(new ImmutableRouteSearchParams(search));

export const createRouteSearchRecord = (search: string): RouteSearchRecord => {
  const params = new URLSearchParams(search);
  const target: Record<string, string | null> = {};
  return new Proxy(target, {
    get: (_target, property) => (typeof property === 'string' ? params.get(property) : undefined),
    getOwnPropertyDescriptor: (_target, property) =>
      typeof property === 'string' && params.has(property)
        ? { configurable: true, enumerable: true, value: params.get(property) }
        : undefined,
    has: (_target, property) => typeof property === 'string' && params.has(property),
    ownKeys: () => [...new Set(params.keys())],
  });
};
