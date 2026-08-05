import { createRouter } from './router.js';
import { readSerializedRouteSnapshot } from './snapshot.js';
import type {
  BrowserRouterOptions,
  NavigateOptions,
  NavigationAction,
  OxeRouter,
  RouteHistoryAdapter,
  RouteManifestV1,
} from './types.js';

const browserHref = (window: Window): string =>
  `${window.location.pathname}${window.location.search}${window.location.hash}`;

const isElement = (target: EventTarget | null): target is Element =>
  target !== null && 'nodeType' in target && target.nodeType === 1;

const isAnchor = (element: Element): element is HTMLAnchorElement => element.tagName === 'A';

const lastMatch = (document: Document, selector: string): HTMLElement | undefined => {
  const matches = document.querySelectorAll<HTMLElement>(selector);
  return matches.item(matches.length - 1) ?? undefined;
};

export const createBrowserHistory = (
  window: Window,
  options: Pick<BrowserRouterOptions, 'focus' | 'scroll'> = {},
): RouteHistoryAdapter => ({
  complete: (action: NavigationAction, navigateOptions: NavigateOptions) => {
    if (action !== 'pop' && options.scroll !== false && navigateOptions.scroll !== 'preserve') {
      window.scrollTo({ left: 0, top: 0 });
    }
    if (action !== 'pop' && options.focus !== false) {
      const target =
        lastMatch(window.document, '[data-oxe-route-focus]') ??
        lastMatch(window.document, 'main, h1');
      if (target) {
        const hadTabIndex = target.hasAttribute('tabindex');
        if (!hadTabIndex) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
        if (!hadTabIndex) {
          target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
        }
      }
    }
  },
  current: () => browserHref(window),
  push: (href) => window.history.pushState(null, '', href),
  replace: (href) => window.history.replaceState(null, '', href),
  subscribe: (listener) => {
    const onPopState = (): void => listener(browserHref(window));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  },
});

const eligibleAnchor = (event: MouseEvent, window: Window): HTMLAnchorElement | undefined => {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return undefined;
  }
  const target = event.target;
  const anchor = isElement(target) ? target.closest('a[href]') : null;
  if (
    !anchor ||
    !isAnchor(anchor) ||
    anchor.hasAttribute('download') ||
    (anchor.target && anchor.target !== '_self')
  ) {
    return undefined;
  }
  const url = new URL(anchor.href, window.location.href);
  return url.origin === window.location.origin ? anchor : undefined;
};

export const attachBrowserLinks = (
  router: OxeRouter,
  window: Window,
  onError?: (error: unknown) => void,
): (() => void) => {
  const onClick = (event: MouseEvent): void => {
    const anchor = eligibleAnchor(event, window);
    if (!anchor) return;
    const url = new URL(anchor.href, window.location.href);
    event.preventDefault();
    void router
      .navigate(`${url.pathname}${url.search}${url.hash}`)
      .catch((error: unknown) => onError?.(error));
  };
  window.document.addEventListener('click', onClick);
  return () => window.document.removeEventListener('click', onClick);
};

export const createBrowserRouter = (
  manifest: RouteManifestV1,
  options: BrowserRouterOptions = {},
): OxeRouter => {
  const window = options.window ?? globalThis.window;
  const history = createBrowserHistory(window, options);
  const cookieName =
    options.localeCookieName === false ? undefined : (options.localeCookieName ?? 'oxe_locale');
  const initialSnapshot =
    options.hydrateSnapshot === false
      ? undefined
      : readSerializedRouteSnapshot(window.document, manifest, history.current());
  const router = createRouter(manifest, {
    history,
    ...(initialSnapshot ? { initialSnapshot } : {}),
    ...(options.onError ? { onError: options.onError } : {}),
    ...(options.prepareLocale ? { prepareLocale: options.prepareLocale } : {}),
    ...(cookieName
      ? {
          persistLocale: (locale: string) => {
            const secure = window.location.protocol === 'https:' ? '; Secure' : '';
            window.document.cookie = `${cookieName}=${encodeURIComponent(locale)}; Path=${manifest.basePath}; Max-Age=31536000; SameSite=Lax${secure}`;
          },
        }
      : {}),
    ...(options.transition ? { transition: options.transition } : {}),
  });
  const detachLinks = attachBrowserLinks(router, window, options.onError);
  return {
    ...router,
    dispose: () => {
      detachLinks();
      router.dispose();
    },
  };
};
