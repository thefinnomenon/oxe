import { describe, expect, it } from 'vitest';

import {
  createFileRouteManifest,
  createRouteSearchRecord,
  readSerializedRouteSnapshot,
  serializeRouteSnapshotData,
  createRouteSearchParams,
  createRouter,
  localizedHref,
  matchRoute,
  negotiateLocale,
  OxeRouterError,
  type NavigateOptions,
  type PreparedRouteTransition,
  type RouteHistoryAdapter,
  type RouteMatch,
} from '../src/index.js';

const modules = [
  'src/routes/layout.oxe',
  'src/routes/page.oxe',
  'src/routes/docs/[...path]/page.oxe',
  'src/routes/users/layout.oxe',
  'src/routes/users/[id]/page.oxe',
  'src/routes/users/new/page.oxe',
] as const;

class FakeHistory implements RouteHistoryAdapter {
  public readonly completed: Array<{ action: string; options: NavigateOptions }> = [];
  public readonly pushed: string[] = [];
  public readonly replaced: string[] = [];
  readonly #listeners = new Set<(href: string) => void>();

  public constructor(private href: string) {}

  public complete(action: string, options: NavigateOptions): void {
    this.completed.push({ action, options });
  }

  public current(): string {
    return this.href;
  }

  public push(href: string): void {
    this.href = href;
    this.pushed.push(href);
  }

  public replace(href: string): void {
    this.href = href;
    this.replaced.push(href);
  }

  public subscribe(listener: (href: string) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

describe('filesystem route manifests', () => {
  it('builds persistent layout chains and deterministic route precedence', () => {
    const manifest = createFileRouteManifest(modules);

    expect(manifest.routes.map((route) => route.pattern)).toEqual([
      '/docs/*path',
      '/users/new',
      '/users/:id',
      '/',
    ]);
    expect(matchRoute(manifest, '/users/new')?.route.pattern).toBe('/users/new');
    expect(matchRoute(manifest, '/users/finn')?.params).toEqual({ id: 'finn' });
    expect(matchRoute(manifest, '/docs/guides/router')?.params).toEqual({
      path: ['guides', 'router'],
    });
    expect(
      matchRoute(manifest, '/users/finn')?.route.segments.map((segment) => segment.id),
    ).toEqual([
      'layout:src/routes/layout.oxe',
      'layout:src/routes/users/layout.oxe',
      'page:src/routes/users/[id]/page.oxe',
    ]);
  });

  it('normalizes trailing slashes and respects a configured base path', () => {
    const manifest = createFileRouteManifest(modules, { basePath: '/app/' });

    expect(matchRoute(manifest, '/app/users/finn/')?.location.pathname).toBe('/app/users/finn');
    expect(matchRoute(manifest, '/users/finn')).toBeUndefined();
  });

  it('rejects ambiguous dynamic routes', () => {
    expect(() =>
      createFileRouteManifest([
        'src/routes/users/[id]/page.oxe',
        'src/routes/users/[name]/page.oxe',
      ]),
    ).toThrowError(OxeRouterError);
  });

  it('matches configured locale prefixes while keeping the default locale bare', () => {
    const manifest = createFileRouteManifest(modules, {
      basePath: '/app',
      localization: { defaultLocale: 'en-US', locales: ['es', 'pt-BR'] },
    });

    expect(matchRoute(manifest, '/app/users/finn')).toMatchObject({
      locale: 'en-US',
      localePrefixed: false,
    });
    expect(matchRoute(manifest, '/app/pt-br/users/finn')).toMatchObject({
      locale: 'pt-BR',
      localePrefixed: true,
    });
    expect(localizedHref(manifest, 'es', '/app/users/finn?tab=one#title')).toBe(
      '/app/es/users/finn?tab=one#title',
    );
    expect(localizedHref(manifest, 'en-US', '/app/pt-br/users/finn')).toBe('/app/users/finn');
    expect(negotiateLocale(manifest.localization!, 'fr;q=0.9, pt-PT;q=0.8, es;q=0.7')).toBe(
      'pt-BR',
    );
  });
});

describe('search parameters', () => {
  it('uses null as the only missing-value sentinel and preserves repeated values', () => {
    const search = createRouteSearchParams('?empty=&tag=one&tag=two');

    expect(search.get('missing')).toBeNull();
    expect(search.get('empty')).toBe('');
    expect(search.get('tag')).toBe('one');
    expect(search.getAll('tag')).toEqual(['one', 'two']);
  });

  it('provides authored property reads with null for missing keys', () => {
    const search = createRouteSearchRecord('?empty=&tab=details');

    expect(search.tab).toBe('details');
    expect(search.empty).toBe('');
    expect(search.missing).toBeNull();
    expect(Object.keys(search)).toEqual(['empty', 'tab']);
  });
});

describe('router navigation', () => {
  it('loads and persists locale changes before committing their canonical URL', async () => {
    const manifest = createFileRouteManifest(modules, {
      localization: { defaultLocale: 'en-US', locales: ['es', 'pt-BR'] },
    });
    const history = new FakeHistory('/users/finn');
    const prepared: string[] = [];
    const persisted: string[] = [];
    const router = createRouter(manifest, {
      history,
      persistLocale: (locale) => persisted.push(locale),
      prepareLocale: (locale) => {
        prepared.push(locale);
      },
    });

    await router.setLocale('pt-br');
    expect(router.locale.read()).toBe('pt-BR');
    expect(history.pushed).toEqual(['/pt-br/users/finn']);
    expect(prepared).toEqual(['pt-BR']);
    expect(persisted).toEqual(['pt-BR']);

    await router.setLocale('en-US');
    expect(history.pushed).toEqual(['/pt-br/users/finn', '/users/finn']);
    expect(prepared).toEqual(['pt-BR', 'en-US']);
    router.dispose();
  });

  it('atomically commits prepared routes and cancels abandoned navigation', async () => {
    const manifest = createFileRouteManifest(modules);
    const history = new FakeHistory('/');
    const pending = new Map<
      string,
      { resolve(value: PreparedRouteTransition): void; signal: AbortSignal }
    >();
    const commits: string[] = [];
    const router = createRouter(manifest, {
      history,
      transition: {
        prepare: (match: RouteMatch, signal: AbortSignal) =>
          new Promise<PreparedRouteTransition>((resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            pending.set(match.location.pathname, { resolve, signal });
          }),
      },
    });

    const abandoned = router.navigate('/users/first');
    expect(router.location.read().pathname).toBe('/');
    const current = router.navigate('/users/second');

    expect(pending.get('/users/first')?.signal.aborted).toBe(true);
    pending.get('/users/second')?.resolve({
      cancel: () => undefined,
      commit: (snapshot) => commits.push(snapshot.location.pathname),
    });
    await current;
    await expect(abandoned).rejects.toMatchObject({ code: 'OXE_ROUTE_ABORTED' });

    expect(router.location.read().pathname).toBe('/users/second');
    expect(history.pushed).toEqual(['/users/second']);
    expect(commits).toEqual(['/users/second']);
    router.dispose();
  });

  it('deletes search keys with null and supports replace and scroll preservation', async () => {
    const history = new FakeHistory('/users/finn?tab=activity&keep=yes');
    const router = createRouter(createFileRouteManifest(modules), { history });

    await router.setSearchParams(
      { keep: null, page: 2, tab: ['profile', 'details'] },
      { replace: true, scroll: 'preserve' },
    );

    expect(history.replaced).toEqual(['/users/finn?page=2&tab=profile&tab=details']);
    expect(router.search.read().get('keep')).toBeNull();
    expect(router.search.read().getAll('tab')).toEqual(['profile', 'details']);
    expect(history.completed).toEqual([
      { action: 'replace', options: { replace: true, scroll: 'preserve' } },
    ]);
    router.dispose();
  });

  it('rejects external URLs instead of converting them into local paths', async () => {
    const router = createRouter(createFileRouteManifest(modules), {
      history: new FakeHistory('/'),
    });

    await expect(router.navigate('https://example.com/users/finn')).rejects.toMatchObject({
      code: 'OXE_ROUTE_EXTERNAL_URL',
    });
    expect(router.location.read().pathname).toBe('/');
    router.dispose();
  });
});

describe('server snapshot adoption', () => {
  it('adopts only a snapshot matching the current browser URL and manifest route', () => {
    const manifest = createFileRouteManifest(modules);
    const match = matchRoute(manifest, '/users/finn?tab=details');
    if (!match) throw new Error('Expected a route match.');
    const document = {
      querySelector: () => ({
        textContent: serializeRouteSnapshotData({ ...match, navigationId: 0 }),
      }),
    } as unknown as Document;

    expect(
      readSerializedRouteSnapshot(document, manifest, '/users/finn?tab=details'),
    ).toMatchObject({ location: { href: '/users/finn?tab=details' }, navigationId: 0 });
    expect(readSerializedRouteSnapshot(document, manifest, '/users/other')).toBeUndefined();
  });
});
