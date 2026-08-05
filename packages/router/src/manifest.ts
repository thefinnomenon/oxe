import { OxeRouterError } from './errors.js';
import type {
  RouteDefinitionV1,
  RouteManifestV1,
  RoutePathSegmentV1,
  RouteSegmentDefinitionV1,
} from './types.js';
import { createRouteLocalization } from './localization.js';

export interface FileRouteManifestOptions {
  readonly basePath?: string;
  readonly localization?: {
    readonly defaultLocale: string;
    readonly locales: readonly string[];
  };
  readonly routesDirectory?: string;
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const invalid = (message: string): never => {
  throw new OxeRouterError('OXE_ROUTE_INVALID_MANIFEST', message);
};

const normalizeModuleId = (value: string): string => {
  if (value.length === 0 || value.startsWith('/') || value.includes('\\')) {
    return invalid(
      `Route module id ${JSON.stringify(value)} must be a project-relative POSIX path.`,
    );
  }
  const result: string[] = [];
  for (const segment of value.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (result.length === 0) return invalid('Route module ids cannot escape the project root.');
      result.pop();
    } else {
      result.push(segment);
    }
  }
  return result.join('/');
};

const normalizeRoutesDirectory = (value: string): string => {
  const normalized = normalizeModuleId(value).replace(/\/$/u, '');
  if (normalized.length === 0) return invalid('The routes directory cannot be empty.');
  return normalized;
};

const normalizeBasePath = (value: string): string => {
  if (!value.startsWith('/') || value.includes('?') || value.includes('#')) {
    return invalid('The route base path must begin with / and cannot contain a query or fragment.');
  }
  const segments = value.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return invalid('The route base path cannot contain . or .. segments.');
  }
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
};

const parameterName = (value: string, moduleId: string): string => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
    return invalid(
      `Route parameter ${JSON.stringify(value)} in ${JSON.stringify(moduleId)} must be an identifier.`,
    );
  }
  return value;
};

const parsePath = (directory: string, moduleId: string): readonly RoutePathSegmentV1[] => {
  const segments: RoutePathSegmentV1[] = [];
  const names = new Set<string>();
  for (const [index, segment] of directory.split('/').filter(Boolean).entries()) {
    const catchAll = /^\[\.\.\.([^\]]+)\]$/u.exec(segment);
    const dynamic = /^\[([^\]]+)\]$/u.exec(segment);
    if (catchAll) {
      const name = parameterName(catchAll[1] ?? '', moduleId);
      if (index !== directory.split('/').filter(Boolean).length - 1) {
        return invalid(`Catch-all route segment ${JSON.stringify(segment)} must be final.`);
      }
      if (names.has(name)) return invalid(`Route parameter ${JSON.stringify(name)} is duplicated.`);
      names.add(name);
      segments.push({ kind: 'catch-all', name });
    } else if (dynamic) {
      const name = parameterName(dynamic[1] ?? '', moduleId);
      if (names.has(name)) return invalid(`Route parameter ${JSON.stringify(name)} is duplicated.`);
      names.add(name);
      segments.push({ kind: 'dynamic', name });
    } else {
      if (
        segment.includes('[') ||
        segment.includes(']') ||
        segment.startsWith('(') ||
        segment.endsWith(')')
      ) {
        return invalid(
          `Unsupported route directory ${JSON.stringify(segment)} in ${JSON.stringify(moduleId)}.`,
        );
      }
      if (!/^[A-Za-z0-9][A-Za-z0-9._~-]*$/u.test(segment)) {
        return invalid(`Static route directory ${JSON.stringify(segment)} is not URL-safe.`);
      }
      segments.push({ kind: 'static', value: segment });
    }
  }
  return segments;
};

const routePattern = (segments: readonly RoutePathSegmentV1[]): string =>
  segments.length === 0
    ? '/'
    : `/${segments
        .map((segment) =>
          segment.kind === 'static'
            ? segment.value
            : segment.kind === 'dynamic'
              ? `:${segment.name}`
              : `*${segment.name}`,
        )
        .join('/')}`;

const ambiguityKey = (segments: readonly RoutePathSegmentV1[]): string =>
  segments
    .map((segment) =>
      segment.kind === 'static' ? `s:${segment.value}` : segment.kind === 'dynamic' ? 'd' : 'c',
    )
    .join('/');

const segmentRank = (segment: RoutePathSegmentV1 | undefined): number =>
  !segment ? 3 : segment.kind === 'static' ? 0 : segment.kind === 'dynamic' ? 1 : 2;

const compareRoutes = (left: RouteDefinitionV1, right: RouteDefinitionV1): number => {
  const length = Math.max(left.path.length, right.path.length);
  for (let index = 0; index < length; index += 1) {
    const rank = segmentRank(left.path[index]) - segmentRank(right.path[index]);
    if (rank !== 0) return rank;
    const leftSegment = left.path[index];
    const rightSegment = right.path[index];
    if (leftSegment?.kind === 'static' && rightSegment?.kind === 'static') {
      const staticOrder = compareText(leftSegment.value, rightSegment.value);
      if (staticOrder !== 0) return staticOrder;
    }
  }
  return compareText(left.pattern, right.pattern);
};

const routeSegment = (kind: 'layout' | 'page', moduleId: string): RouteSegmentDefinitionV1 => ({
  exportName: kind === 'layout' ? 'Layout' : 'Page',
  id: `${kind}:${moduleId}`,
  kind,
  moduleId,
});

export const createFileRouteManifest = (
  moduleIds: readonly string[],
  options: FileRouteManifestOptions = {},
): RouteManifestV1 => {
  const routesDirectory = normalizeRoutesDirectory(options.routesDirectory ?? 'src/routes');
  const basePath = normalizeBasePath(options.basePath ?? '/');
  const normalized = [...new Set(moduleIds.map(normalizeModuleId))].sort(compareText);
  const prefix = `${routesDirectory}/`;
  const routeFiles = normalized.filter((moduleId) => moduleId.startsWith(prefix));
  const layouts = new Map<string, string>();
  const pages = new Map<string, string>();

  for (const moduleId of routeFiles) {
    const relative = moduleId.slice(prefix.length);
    const slash = relative.lastIndexOf('/');
    const directory = slash < 0 ? '' : relative.slice(0, slash);
    const fileName = slash < 0 ? relative : relative.slice(slash + 1);
    if (fileName === 'layout.oxe') layouts.set(directory, moduleId);
    if (fileName === 'page.oxe') pages.set(directory, moduleId);
  }

  if (pages.size === 0) {
    return invalid(`No page.oxe files were found beneath ${JSON.stringify(routesDirectory)}.`);
  }

  const ambiguity = new Map<string, string>();
  const routes = [...pages.entries()].map(([directory, pageModuleId]): RouteDefinitionV1 => {
    const path = parsePath(directory, pageModuleId);
    const key = ambiguityKey(path);
    const previous = ambiguity.get(key);
    if (previous) {
      return invalid(
        `Routes ${JSON.stringify(previous)} and ${JSON.stringify(pageModuleId)} match the same URL shape.`,
      );
    }
    ambiguity.set(key, pageModuleId);

    const prefixes = [''];
    const directorySegments = directory.split('/').filter(Boolean);
    for (let index = 1; index <= directorySegments.length; index += 1) {
      prefixes.push(directorySegments.slice(0, index).join('/'));
    }
    const segments = prefixes
      .map((candidate) => layouts.get(candidate))
      .filter((candidate): candidate is string => candidate !== undefined)
      .map((moduleId) => routeSegment('layout', moduleId));
    segments.push(routeSegment('page', pageModuleId));
    const pattern = routePattern(path);
    return {
      id: `route:${directory || '/'}`,
      parameterNames: path
        .filter(
          (segment): segment is Exclude<RoutePathSegmentV1, { readonly kind: 'static' }> =>
            segment.kind !== 'static',
        )
        .map((segment) => segment.name),
      path,
      pattern,
      segments,
    };
  });

  return Object.freeze({
    basePath,
    ...(options.localization
      ? {
          localization: createRouteLocalization(
            options.localization.defaultLocale,
            options.localization.locales,
          ),
        }
      : {}),
    routes: Object.freeze(routes.sort(compareRoutes)),
    schemaVersion: 'oxe.route-manifest.v1',
    trailingSlash: 'never',
  });
};
