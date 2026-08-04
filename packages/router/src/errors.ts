export type RouterErrorCode =
  | 'OXE_ROUTE_ABORTED'
  | 'OXE_ROUTE_EXTERNAL_URL'
  | 'OXE_ROUTE_INVALID_MANIFEST'
  | 'OXE_ROUTE_INVALID_OUTLET'
  | 'OXE_ROUTE_INVALID_SERVER_PLAN'
  | 'OXE_ROUTE_NAVIGATION_UNAVAILABLE'
  | 'OXE_ROUTE_NOT_FOUND'
  | 'OXE_ROUTE_SEGMENT_MISMATCH';

export class OxeRouterError extends Error {
  public constructor(
    public readonly code: RouterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OxeRouterError';
  }
}

export const abortedNavigation = (): OxeRouterError =>
  new OxeRouterError('OXE_ROUTE_ABORTED', 'Navigation was superseded by a newer route.');
