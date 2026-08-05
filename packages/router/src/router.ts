import { batch, createCell, createDerived, createRoot, type Cell, type Root } from '@oxe/runtime';

import { abortedNavigation, OxeRouterError } from './errors.js';
import { localizedHref, supportedLocale } from './localization.js';
import { createRouteSearchParams, matchRoute } from './match.js';
import type {
  NavigateOptions,
  NavigationAction,
  OxeRouter,
  PreparedRouteTransition,
  RouteManifestV1,
  RouteMatch,
  RouteSnapshot,
  RouterOptions,
  SearchParamUpdate,
} from './types.js';

const notFound = (href: string): OxeRouterError =>
  new OxeRouterError('OXE_ROUTE_NOT_FOUND', `No OXE route matches ${JSON.stringify(href)}.`);

const externalUrl = (href: string): OxeRouterError =>
  new OxeRouterError(
    'OXE_ROUTE_EXTERNAL_URL',
    `Client navigation requires an application-local URL, but received ${JSON.stringify(href)}.`,
  );

const snapshot = (match: RouteMatch, navigationId: number): RouteSnapshot =>
  Object.freeze({ ...match, navigationId });

const abortError = (signal: AbortSignal): unknown => signal.reason ?? abortedNavigation();

const applySearchUpdate = (
  params: URLSearchParams,
  name: string,
  value: SearchParamUpdate,
): void => {
  params.delete(name);
  if (value === null) return;
  const values = Array.isArray(value) ? value : [String(value)];
  for (const item of values) params.append(name, String(item));
};

interface RouterRootValue extends Omit<OxeRouter, 'dispose'> {
  readonly snapshotCell: Cell<RouteSnapshot>;
}

export const createRouter = (manifest: RouteManifestV1, options: RouterOptions): OxeRouter => {
  const historyHref = options.history.current();
  const historyMatch = matchRoute(manifest, historyHref);
  if (!historyMatch) throw notFound(historyHref);
  const initialSnapshot =
    options.initialSnapshot?.location.href === historyMatch.location.href &&
    options.initialSnapshot.route.id === historyMatch.route.id
      ? options.initialSnapshot
      : snapshot(historyMatch, 0);

  let navigationId = 0;
  let generation = 0;
  let controller: AbortController | undefined;
  let disposed = false;

  const transition = async (
    to: string,
    navigateOptions: NavigateOptions,
    action: NavigationAction,
  ): Promise<RouteSnapshot> => {
    if (disposed) {
      throw new OxeRouterError('OXE_ROUTE_ABORTED', 'Cannot navigate with a disposed router.');
    }
    const current = root.value.snapshot.read();
    const targetUrl = new URL(to, `http://oxe.invalid${current.location.href}`);
    if (targetUrl.origin !== 'http://oxe.invalid') throw externalUrl(to);
    const match = matchRoute(manifest, targetUrl);
    if (!match) throw notFound(`${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`);
    if (action === 'push' && match.location.href === current.location.href) return current;

    generation += 1;
    const ownGeneration = generation;
    controller?.abort(abortedNavigation());
    controller = new AbortController();
    let prepared: PreparedRouteTransition | undefined;
    try {
      const localeChanged = match.locale !== undefined && match.locale !== current.locale;
      if (localeChanged) await options.prepareLocale?.(match.locale as string, controller.signal);
      if (controller.signal.aborted || ownGeneration !== generation) {
        throw abortError(controller.signal);
      }
      prepared = options.transition
        ? await options.transition.prepare(match, controller.signal)
        : { cancel: () => undefined, commit: () => undefined };
      if (controller.signal.aborted || ownGeneration !== generation) {
        throw abortError(controller.signal);
      }
      const next = snapshot(match, navigationId + 1);
      batch(() => {
        if (action === 'push') options.history.push(next.location.href);
        if (action === 'replace') options.history.replace(next.location.href);
        prepared?.commit(next);
        root.value.snapshotCell.write(next);
      });
      navigationId += 1;
      if (localeChanged) options.persistLocale?.(match.locale as string);
      options.history.complete?.(action, navigateOptions, next);
      return next;
    } catch (error) {
      prepared?.cancel();
      throw error;
    }
  };

  const root: Root<RouterRootValue> = createRoot(
    () => {
      const snapshotCell = createCell(initialSnapshot, { name: 'router snapshot' });
      const location = createDerived([snapshotCell], () => snapshotCell.read().location, {
        name: 'router location',
      });
      const locale = createDerived([snapshotCell], () => snapshotCell.read().locale, {
        name: 'router locale',
      });
      const params = createDerived([snapshotCell], () => snapshotCell.read().params, {
        name: 'router params',
      });
      const search = createDerived(
        [snapshotCell],
        () => createRouteSearchParams(snapshotCell.read().location.search),
        { name: 'router search params' },
      );
      const navigate = (
        to: string,
        navigateOptions: NavigateOptions = {},
      ): Promise<RouteSnapshot> =>
        transition(to, navigateOptions, navigateOptions.replace ? 'replace' : 'push');
      return {
        locale,
        location,
        navigate,
        params,
        search,
        setLocale: (
          locale: string,
          navigateOptions: NavigateOptions = {},
        ): Promise<RouteSnapshot> => {
          if (!manifest.localization) {
            throw new OxeRouterError(
              'OXE_ROUTE_INVALID_MANIFEST',
              'Cannot select a locale for a manifest without localization.',
            );
          }
          const canonical = supportedLocale(manifest.localization, locale);
          const href = localizedHref(manifest, canonical, snapshotCell.read().location.href);
          return navigate(href, navigateOptions);
        },
        setSearchParams: (
          updates: Readonly<Record<string, SearchParamUpdate>>,
          navigateOptions: NavigateOptions = {},
        ): Promise<RouteSnapshot> => {
          const current = snapshotCell.read();
          const url = new URL(current.location.href, 'http://oxe.invalid');
          for (const [name, value] of Object.entries(updates)) {
            applySearchUpdate(url.searchParams, name, value);
          }
          const href = `${url.pathname}${url.search}${url.hash}`;
          return navigate(href, navigateOptions);
        },
        snapshot: snapshotCell,
        snapshotCell,
      };
    },
    { name: 'OXE router' },
  );

  const unsubscribe = options.history.subscribe((href) => {
    void transition(href, {}, 'pop').catch((error: unknown) => options.onError?.(error));
  });

  return {
    locale: root.value.locale,
    location: root.value.location,
    navigate: root.value.navigate,
    params: root.value.params,
    search: root.value.search,
    setLocale: root.value.setLocale,
    setSearchParams: root.value.setSearchParams,
    snapshot: root.value.snapshot,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      generation += 1;
      controller?.abort(abortedNavigation());
      unsubscribe();
      root.dispose();
    },
  };
};
