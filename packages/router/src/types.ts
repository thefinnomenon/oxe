import type { Readable } from '@oxe/runtime';

export type RoutePathSegmentV1 =
  | { readonly kind: 'catch-all'; readonly name: string }
  | { readonly kind: 'dynamic'; readonly name: string }
  | { readonly kind: 'static'; readonly value: string };

export interface RouteSegmentDefinitionV1 {
  readonly exportName: 'Layout' | 'Page';
  readonly id: string;
  readonly kind: 'layout' | 'page';
  readonly moduleId: string;
}

export interface RouteDefinitionV1 {
  readonly id: string;
  readonly parameterNames: readonly string[];
  readonly path: readonly RoutePathSegmentV1[];
  readonly pattern: string;
  /** Root-to-leaf layout artifacts followed by the page artifact. */
  readonly segments: readonly RouteSegmentDefinitionV1[];
}

export interface RouteManifestV1 {
  readonly basePath: string;
  readonly routes: readonly RouteDefinitionV1[];
  readonly schemaVersion: 'oxe.route-manifest.v1';
  readonly trailingSlash: 'never';
}

export type RouteParamValue = string | readonly string[];
export type RouteParams = Readonly<Record<string, RouteParamValue>>;

export interface RouteLocation {
  /** Normalized application-relative path, query, and fragment. */
  readonly href: string;
  readonly hash: string;
  readonly pathname: string;
  readonly search: string;
}

export interface RouteMatch {
  readonly location: RouteLocation;
  readonly params: RouteParams;
  readonly route: RouteDefinitionV1;
}

export interface RouteSnapshot extends RouteMatch {
  /** Monotonic navigation identity, useful for tracing and focus behavior. */
  readonly navigationId: number;
}

export interface RouteSearchParams {
  entries(): IterableIterator<[string, string]>;
  get(name: string): string | null;
  getAll(name: string): readonly string[];
  has(name: string): boolean;
  toString(): string;
}

/** Property-readable authored view; missing keys resolve to null. */
export type RouteSearchRecord = Readonly<Record<string, string | null>>;

export type SearchParamUpdate = boolean | number | string | readonly string[] | null;

export interface NavigateOptions {
  readonly replace?: boolean;
  readonly scroll?: 'preserve' | 'top';
}

export type NavigationAction = 'pop' | 'push' | 'replace';

export interface RouteHistoryAdapter {
  complete?(action: NavigationAction, options: NavigateOptions, snapshot: RouteSnapshot): void;
  current(): string;
  push(href: string): void;
  replace(href: string): void;
  subscribe(listener: (href: string) => void): () => void;
}

export interface PreparedRouteTransition {
  cancel(): void;
  /** Synchronous after all independently loaded artifacts have been prepared. */
  commit(snapshot: RouteSnapshot): void;
}

export interface RouteTransition {
  prepare(match: RouteMatch, signal: AbortSignal): Promise<PreparedRouteTransition>;
}

export interface RouterOptions {
  readonly history: RouteHistoryAdapter;
  readonly initialSnapshot?: RouteSnapshot;
  readonly onError?: (error: unknown) => void;
  readonly transition?: RouteTransition;
}

export interface OxeRouter {
  readonly location: Readable<RouteLocation>;
  readonly params: Readable<RouteParams>;
  readonly search: Readable<RouteSearchParams>;
  readonly snapshot: Readable<RouteSnapshot>;
  dispose(): void;
  navigate(to: string, options?: NavigateOptions): Promise<RouteSnapshot>;
  setSearchParams(
    updates: Readonly<Record<string, SearchParamUpdate>>,
    options?: NavigateOptions,
  ): Promise<RouteSnapshot>;
}

export interface BrowserRouterOptions {
  readonly focus?: boolean;
  readonly hydrateSnapshot?: boolean;
  readonly onError?: (error: unknown) => void;
  readonly scroll?: boolean;
  readonly transition?: RouteTransition;
  readonly window?: Window;
}

export interface DomRouteOutlet {
  readonly end: Comment;
  readonly start: Comment;
}

export interface DomRouteSegmentContext {
  readonly document: Document;
  readonly match: RouteMatch;
  readonly segment: RouteSegmentDefinitionV1;
}

export interface DomRouteSegmentInstance {
  /** Required for every layout which has a following child segment. */
  readonly childOutlet?: DomRouteOutlet;
  /** Top-level nodes owned by this segment. */
  readonly nodes: readonly ChildNode[];
  dispose(): void;
  update(snapshot: RouteSnapshot): void;
}

export interface DomRouteSegmentArtifact {
  readonly id: string;
  create(context: DomRouteSegmentContext): DomRouteSegmentInstance;
}

export type DomRouteSegmentContent = ChildNode | readonly ChildNode[];

export interface DomRouteSegmentBuildContext {
  /** Layout child markers. Empty for a page artifact. */
  readonly children: readonly ChildNode[];
  readonly document: Document;
  readonly match: Readable<RouteMatch>;
  readonly route: DomRouteRuntime;
  readonly segment: RouteSegmentDefinitionV1;
}

export interface DomRouteNavigation {
  navigate(to: string, options?: NavigateOptions): Promise<RouteSnapshot>;
  setSearchParams(
    updates: Readonly<Record<string, SearchParamUpdate>>,
    options?: NavigateOptions,
  ): Promise<RouteSnapshot>;
}

export interface DomRouteRuntime extends DomRouteNavigation {
  readonly location: Readable<RouteLocation>;
  readonly params: Readable<RouteParams>;
  readonly search: Readable<RouteSearchRecord>;
}

export interface DomRouteSegmentArtifactOptions {
  build(context: DomRouteSegmentBuildContext): DomRouteSegmentContent;
  readonly id: string;
  readonly kind: 'layout' | 'page';
  readonly navigation?: DomRouteNavigation;
}

export type LoadDomRouteSegment = (
  segment: RouteSegmentDefinitionV1,
  signal: AbortSignal,
) => Promise<DomRouteSegmentArtifact>;

export interface DomSegmentRendererOptions {
  readonly onError?: (error: unknown) => void;
}
