export { attachBrowserLinks, createBrowserHistory, createBrowserRouter } from './browser.js';
export {
  appendDomRouteOutlet,
  createDomRouteOutlet,
  createDomSegmentTransition,
} from './dom-segments.js';
export { OxeRouterError, type RouterErrorCode } from './errors.js';
export { createFileRouteManifest, type FileRouteManifestOptions } from './manifest.js';
export {
  createRouteLocalization,
  localePathPrefix,
  localePreferenceFromCookie,
  localizedHref,
  negotiateLocale,
  supportedLocale,
} from './localization.js';
export { createRouteSearchParams, createRouteSearchRecord, matchRoute } from './match.js';
export { createRouter } from './router.js';
export { createDomRouteSegmentArtifact } from './segment-artifact.js';
export {
  readSerializedRouteSnapshot,
  ROUTE_SNAPSHOT_SELECTOR,
  serializeRouteSnapshotData,
  type SerializedRouteSnapshotV1,
} from './snapshot.js';
export type {
  BrowserRouterOptions,
  DomRouteOutlet,
  DomRouteNavigation,
  DomRouteRuntime,
  DomRouteSegmentArtifact,
  DomRouteSegmentArtifactOptions,
  DomRouteSegmentBuildContext,
  DomRouteSegmentContent,
  DomRouteSegmentContext,
  DomRouteSegmentInstance,
  DomSegmentRendererOptions,
  LoadDomRouteSegment,
  NavigateOptions,
  NavigationAction,
  OxeRouter,
  PreparedRouteTransition,
  RouteDefinitionV1,
  RouteHistoryAdapter,
  RouteLocation,
  RouteLocalizationV1,
  RouteManifestV1,
  RouteMatch,
  RouteParamValue,
  RouteParams,
  RoutePathSegmentV1,
  RouteSearchParams,
  RouteSearchRecord,
  RouteSegmentDefinitionV1,
  RouteSnapshot,
  RouterOptions,
  RouteTransition,
  SearchParamUpdate,
} from './types.js';
