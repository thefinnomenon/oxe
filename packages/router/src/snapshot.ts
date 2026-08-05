import type { RouteManifestV1, RouteSnapshot } from './types.js';
import { matchRoute } from './match.js';

export const ROUTE_SNAPSHOT_SELECTOR = 'script[data-oxe-route-snapshot]' as const;

export interface SerializedRouteSnapshotV1 {
  readonly href: string;
  readonly routeId: string;
  readonly schemaVersion: 'oxe.route-snapshot.v1';
}

export const serializeRouteSnapshotData = (snapshot: RouteSnapshot): string =>
  JSON.stringify({
    href: snapshot.location.href,
    routeId: snapshot.route.id,
    schemaVersion: 'oxe.route-snapshot.v1',
  } satisfies SerializedRouteSnapshotV1).replaceAll('<', '\\u003c');

export const readSerializedRouteSnapshot = (
  document: Document,
  manifest: RouteManifestV1,
  currentHref: string,
): RouteSnapshot | undefined => {
  const text = document.querySelector(ROUTE_SNAPSHOT_SELECTOR)?.textContent;
  if (!text) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('schemaVersion' in value) ||
      value.schemaVersion !== 'oxe.route-snapshot.v1' ||
      !('href' in value) ||
      typeof value.href !== 'string' ||
      !('routeId' in value) ||
      typeof value.routeId !== 'string'
    ) {
      return undefined;
    }
    const current = matchRoute(manifest, currentHref);
    const serialized = matchRoute(manifest, value.href);
    if (
      !current ||
      !serialized ||
      current.location.href !== serialized.location.href ||
      serialized.route.id !== value.routeId
    ) {
      return undefined;
    }
    return Object.freeze({ ...serialized, navigationId: 0 });
  } catch {
    return undefined;
  }
};
