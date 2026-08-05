import {
  createJavaScriptReadinessAdapter,
  defaultServerErrorResponse,
  renderToString,
  renderToStringWithHydrationState,
  streamServerRenderPlan,
  type ServerCapabilityPlanV1,
  type ServerErrorResponse,
  type ServerI18nRuntime,
  type ServerJavaScriptReadinessOptions,
  type ServerReadinessErrorContext,
  type ServerRenderOptions,
  type ServerRenderPlanV1,
  type ServerRenderPlanV2,
  type ServerViewV1,
} from '@oxe/runtime-server';
import {
  createInProcessServerFunctionTransport,
  createServerFunctionCapabilityMap,
  createServerFunctionFetchHandler,
  type ServerFunctionFetchHandlerOptions,
  type ServerFunctionRegistry,
  type ServerFunctionSerializationLimits,
} from '@oxe/server-functions';

import { OxeRouterError } from './errors.js';
import {
  localePreferenceFromCookie,
  localizedHref,
  negotiateLocale,
  supportedLocale,
} from './localization.js';
import { createRouteSearchRecord, matchRoute } from './match.js';
import { serializeRouteSnapshotData } from './snapshot.js';
import type {
  RouteManifestV1,
  RouteMatch,
  RouteSegmentDefinitionV1,
  RouteSnapshot,
} from './types.js';

export type LoadRouteServerPlan = (
  segment: RouteSegmentDefinitionV1,
) => Promise<ServerRenderPlanV1>;

export type LoadRouteDeferredServerPlan = (
  segment: RouteSegmentDefinitionV1,
) => Promise<ServerRenderPlanV2>;

const invalidPlan = (message: string): never => {
  throw new OxeRouterError('OXE_ROUTE_INVALID_SERVER_PLAN', message);
};

const replaceContentSlot = (
  view: ServerViewV1,
  childComponentId: string,
  replacementId: string,
  count: { value: number },
): ServerViewV1 => {
  if (view.kind === 'content-slot') {
    count.value += 1;
    return {
      children: [],
      componentId: childComponentId,
      id: replacementId,
      kind: 'component',
      props: [],
    };
  }
  if (view.kind === 'element' || view.kind === 'component' || view.kind === 'context-provider') {
    return {
      ...view,
      children: view.children.map((child, index) =>
        replaceContentSlot(child, childComponentId, `${replacementId}/${index}`, count),
      ),
    };
  }
  if (view.kind === 'choice') {
    return {
      ...view,
      branches: view.branches.map((branch, index) => ({
        ...branch,
        view: replaceContentSlot(
          branch.view,
          childComponentId,
          `${replacementId}/branch[${index}]`,
          count,
        ),
      })),
    };
  }
  if (view.kind === 'collection') {
    return {
      ...view,
      row: replaceContentSlot(view.row, childComponentId, `${replacementId}/row`, count),
    };
  }
  return view;
};

const uniqueById = <Value extends { readonly id: string }>(
  values: readonly Value[],
  description: string,
): readonly Value[] => {
  const result = new Map<string, Value>();
  for (const value of values) {
    const existing = result.get(value.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(value)) {
      return invalidPlan(
        `Route server plans contain conflicting ${description} ${JSON.stringify(value.id)}.`,
      );
    }
    result.set(value.id, value);
  }
  return [...result.values()];
};

const composeRoutePlan = async <Plan extends ServerRenderPlanV1 | ServerRenderPlanV2>(
  match: RouteMatch,
  load: (segment: RouteSegmentDefinitionV1) => Promise<Plan>,
): Promise<Plan> => {
  const loaded = await Promise.all(
    match.route.segments.map(async (segment) => ({ plan: await load(segment), segment })),
  );
  for (const { plan, segment } of loaded) {
    if (plan.source.moduleId !== segment.moduleId) {
      return invalidPlan(
        `Loaded server plan ${JSON.stringify(plan.source.moduleId)} for route segment ${JSON.stringify(segment.moduleId)}.`,
      );
    }
  }
  const leaf = loaded.at(-1);
  if (!leaf) return invalidPlan(`Route ${JSON.stringify(match.route.id)} has no server segments.`);
  let composed = leaf.plan;
  for (const { plan, segment } of loaded.slice(0, -1).reverse()) {
    if (segment.kind !== 'layout') {
      return invalidPlan(`Only layouts may precede the leaf page in a route server plan.`);
    }
    const entry = plan.components.find((component) => component.id === plan.entry.componentId);
    if (!entry)
      return invalidPlan(`Layout plan ${JSON.stringify(segment.id)} has no entry component.`);
    const count = { value: 0 };
    const root = replaceContentSlot(
      entry.boundary.root,
      composed.entry.componentId,
      `${entry.id}/route-child`,
      count,
    );
    if (count.value !== 1) {
      return invalidPlan(
        `Route layout ${JSON.stringify(segment.moduleId)} must render children exactly once.`,
      );
    }
    const entryWithChild = { ...entry, boundary: { ...entry.boundary, root } };
    if (plan.schemaVersion !== composed.schemaVersion) {
      return invalidPlan('All route segments must use the same server render plan version.');
    }
    const shared = {
      ...plan,
      capabilities: uniqueById([...plan.capabilities, ...composed.capabilities], 'capability'),
      components: uniqueById(
        [
          entryWithChild,
          ...plan.components.filter((component) => component.id !== entry.id),
          ...composed.components,
        ],
        'component',
      ),
      contexts: uniqueById([...plan.contexts, ...composed.contexts], 'context'),
      nonRenderingWork: uniqueById(
        [...plan.nonRenderingWork, ...composed.nonRenderingWork],
        'non-rendering work',
      ),
      source: {
        ...plan.source,
        buildFingerprint: `route:${match.route.segments
          .map((routeSegment) => routeSegment.id)
          .join('|')}`,
        moduleId: `route:${match.route.id}`,
      },
    };
    // The generic is narrowed by the compiler-owned schema discriminator at this boundary.
    composed = (
      plan.schemaVersion === 'oxe.server-render-plan.v2' &&
      composed.schemaVersion === 'oxe.server-render-plan.v2'
        ? {
            ...shared,
            regions: uniqueById([...plan.regions, ...composed.regions], 'deferred region'),
          }
        : shared
    ) as Plan;
  }
  return composed;
};

export const composeRouteServerPlan = (
  match: RouteMatch,
  load: LoadRouteServerPlan,
): Promise<ServerRenderPlanV1> => composeRoutePlan(match, load);

export const composeRouteDeferredServerPlan = (
  match: RouteMatch,
  load: LoadRouteDeferredServerPlan,
): Promise<ServerRenderPlanV2> => composeRoutePlan(match, load);

const routeCapabilityValue = (capability: ServerCapabilityPlanV1, match: RouteMatch): unknown => {
  if (capability.routeIntrinsic === 'location') return match.location;
  if (capability.routeIntrinsic === 'params') return match.params;
  if (capability.routeIntrinsic === 'search-params') {
    return createRouteSearchRecord(match.location.search);
  }
  return undefined;
};

export const routeServerRenderOptions = (
  match: RouteMatch,
  options: ServerRenderOptions = {},
): ServerRenderOptions => ({
  ...options,
  callCapability: (capability, arguments_) => {
    if (capability.routeIntrinsic) {
      const value = routeCapabilityValue(capability, match);
      if (value !== undefined) return value;
      return invalidPlan(
        `Route mutation ${JSON.stringify(capability.routeIntrinsic)} cannot execute during SSR.`,
      );
    }
    if (!options.callCapability) {
      return invalidPlan(
        `SSR requires a host resolver for capability ${JSON.stringify(capability.path.join('.'))}.`,
      );
    }
    return options.callCapability(capability, arguments_);
  },
});

export const renderRouteToString = (
  plan: ServerRenderPlanV1,
  match: RouteMatch,
  options: ServerRenderOptions = {},
): string => renderToString(plan, routeServerRenderOptions(match, options));

export const renderRouteToStringWithHydrationState = (
  plan: ServerRenderPlanV1,
  match: RouteMatch,
  options: ServerRenderOptions = {},
): string => renderToStringWithHydrationState(plan, routeServerRenderOptions(match, options));

export const serializeRouteSnapshotScript = (match: RouteMatch): string => {
  const snapshot: RouteSnapshot = { ...match, navigationId: 0 };
  return `<script type="application/json" data-oxe-route-snapshot>${serializeRouteSnapshotData(snapshot)}</script>`;
};

export interface FetchRouteServerFunctionsOptions<Context> {
  readonly allowedOrigins?: readonly string[];
  createContext(request: Request, signal: AbortSignal): Context | PromiseLike<Context>;
  /** Defaults to /__oxe/functions. */
  readonly endpoint?: string;
  readonly limits?: ServerFunctionSerializationLimits;
  readonly onError?: (error: unknown, functionId: string | undefined) => void;
  readonly registry: ServerFunctionRegistry<Context>;
}

export interface FetchRouteHandlerOptions<Context = never> {
  readonly batchWindowMilliseconds?: number;
  callCapability?(
    capability: ServerCapabilityPlanV1,
    arguments_: readonly unknown[],
    signal: AbortSignal,
    request: Request,
    match: RouteMatch,
  ): unknown | PromiseLike<unknown>;
  createI18n?(
    request: Request,
    match: RouteMatch,
  ): ServerI18nRuntime | PromiseLike<ServerI18nRuntime | undefined> | undefined;
  readonly headers?: HeadersInit | ((request: Request, match: RouteMatch) => HeadersInit);
  readonly includeBootstrap?: boolean;
  readonly includeCheckpoints?: boolean;
  readonly localization?: FetchRouteLocalizationOptions;
  loadPlan(
    segment: RouteSegmentDefinitionV1,
    request: Request,
    signal: AbortSignal,
  ): Promise<ServerRenderPlanV2>;
  readonly manifest: RouteManifestV1;
  onError?(
    error: unknown,
    context: ServerReadinessErrorContext & {
      readonly match?: RouteMatch;
      readonly request: Request;
    },
  ): ServerErrorResponse | void | PromiseLike<ServerErrorResponse | void>;
  readonly scope?: string | ((request: Request, match: RouteMatch) => string);
  readonly serverFunctions?: FetchRouteServerFunctionsOptions<Context>;
  readonly statusGate?: ServerJavaScriptReadinessOptions['statusGate'];
}

export interface FetchRouteLocalizationOptions {
  /** Defaults to oxe_locale. */
  readonly cookieName?: string;
  /** Host hook for a signed-in user preference. It takes precedence over cookie and browser language. */
  resolvePreference?(
    request: Request,
    signal: AbortSignal,
  ): string | undefined | PromiseLike<string | undefined>;
}

export type FetchRouteHandler = (request: Request) => Promise<Response>;

export interface NodeHandlerOptions {
  /** Public request origin when Host/socket inference is not appropriate. */
  readonly origin?:
    string | URL | ((request: IncomingMessage) => string | URL | PromiseLike<string | URL>);
}

export type NodeRouteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void>;

const plainResponse = (status: number, body: string, headers?: HeadersInit): Response =>
  new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'x-content-type-options': 'nosniff',
      ...Object.fromEntries(new Headers(headers)),
    },
    status,
  });

const localeCookieName = (options: FetchRouteLocalizationOptions | undefined): string => {
  const name = options?.cookieName ?? 'oxe_locale';
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name)) {
    return invalidPlan('The locale preference cookie name contains invalid characters.');
  }
  return name;
};

const localeCookie = (request: Request, name: string, locale: string, path: string): string =>
  `${name}=${encodeURIComponent(locale)}; Path=${path}; Max-Age=31536000; SameSite=Lax${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;

const appendVary = (headers: Headers, ...names: readonly string[]): void => {
  const values = new Set(
    (headers.get('vary') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  for (const name of names) values.add(name);
  if (values.size > 0) headers.set('vary', [...values].join(', '));
};

const configuredPreference = (
  locale: string | undefined,
  options: NonNullable<RouteManifestV1['localization']>,
): string | undefined => {
  if (!locale) return undefined;
  try {
    return supportedLocale(options, locale);
  } catch {
    return undefined;
  }
};

const validEndpoint = (value: string): string => {
  if (!value.startsWith('/') || value.includes('?') || value.includes('#')) {
    return invalidPlan('The server-function endpoint must be an absolute URL pathname.');
  }
  return value.length > 1 ? value.replace(/\/+$/u, '') : value;
};

const routeErrorResponse = async (
  error: unknown,
  request: Request,
  options: FetchRouteHandlerOptions<unknown>,
  match?: RouteMatch,
): Promise<Response> => {
  let resolution: ServerErrorResponse | void;
  try {
    resolution = await options.onError?.(error, {
      headersCommitted: false,
      phase: 'shell',
      request,
      ...(match ? { match } : {}),
    });
  } catch {
    resolution = undefined;
  }
  const response = resolution ?? defaultServerErrorResponse(error);
  return new Response(request.method === 'HEAD' ? null : response.body, {
    ...(response.headers ? { headers: response.headers } : {}),
    status: response.status,
  });
};

/**
 * Standard Fetch host for matched route SSR and compiler-generated server functions.
 * A Node adapter only needs to translate its request/response objects to web standards.
 */
export const createFetchRouteHandler = <Context = never>(
  options: FetchRouteHandlerOptions<Context>,
): FetchRouteHandler => {
  const serverFunctionOptions = options.serverFunctions;
  const endpoint = serverFunctionOptions
    ? validEndpoint(serverFunctionOptions.endpoint ?? '/__oxe/functions')
    : undefined;
  const functionHandler = serverFunctionOptions
    ? createServerFunctionFetchHandler(serverFunctionOptions.registry, {
        createContext: serverFunctionOptions.createContext,
        ...(serverFunctionOptions.allowedOrigins
          ? { allowedOrigins: serverFunctionOptions.allowedOrigins }
          : {}),
        ...(serverFunctionOptions.limits ? { limits: serverFunctionOptions.limits } : {}),
        ...(serverFunctionOptions.onError ? { onError: serverFunctionOptions.onError } : {}),
      } satisfies ServerFunctionFetchHandlerOptions<Context>)
    : undefined;

  return async (request): Promise<Response> => {
    const url = new URL(request.url);
    if (functionHandler && url.pathname === endpoint) {
      return functionHandler(request);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return plainResponse(405, 'Method not allowed', { allow: 'GET, HEAD' });
    }
    const match = matchRoute(options.manifest, url);
    if (!match) return plainResponse(404, 'Not found');

    const localization = options.manifest.localization;
    const preferenceCookieName = localization ? localeCookieName(options.localization) : undefined;
    const cookiePreference =
      localization && preferenceCookieName
        ? localePreferenceFromCookie(
            localization,
            request.headers.get('cookie'),
            preferenceCookieName,
          )
        : undefined;
    if (localization && match.locale) {
      let redirectLocale: string | undefined;
      if (match.localePrefixed && match.locale === localization.defaultLocale) {
        redirectLocale = localization.defaultLocale;
      } else if (!match.localePrefixed) {
        const sessionPreference = configuredPreference(
          await options.localization?.resolvePreference?.(request, request.signal),
          localization,
        );
        const preferred =
          sessionPreference ??
          cookiePreference ??
          negotiateLocale(localization, request.headers.get('accept-language'));
        if (preferred !== localization.defaultLocale) redirectLocale = preferred;
      }
      if (redirectLocale) {
        const headers = new Headers({
          'cache-control': 'private, no-store',
          location: localizedHref(options.manifest, redirectLocale, url),
        });
        appendVary(headers, 'Accept-Language', 'Cookie');
        if (preferenceCookieName && cookiePreference !== redirectLocale) {
          headers.set(
            'set-cookie',
            localeCookie(request, preferenceCookieName, redirectLocale, options.manifest.basePath),
          );
        }
        return new Response(null, { headers, status: 307 });
      }
    }

    try {
      const plan = await composeRouteDeferredServerPlan(match, (segment) =>
        options.loadPlan(segment, request, request.signal),
      );
      const i18n = await options.createI18n?.(request, match);
      let serverCapabilities:
        Promise<ReturnType<typeof createServerFunctionCapabilityMap>> | undefined;
      const resolveServerCapabilities = (): Promise<
        ReturnType<typeof createServerFunctionCapabilityMap>
      > => {
        if (!serverFunctionOptions) {
          return Promise.reject(
            new OxeRouterError(
              'OXE_ROUTE_INVALID_SERVER_PLAN',
              'The route uses a server function, but the Fetch host has no serverFunctions registry.',
            ),
          );
        }
        serverCapabilities ??= Promise.resolve(
          serverFunctionOptions.createContext(request, request.signal),
        ).then((context) =>
          createServerFunctionCapabilityMap(
            serverFunctionOptions.registry.manifest.functions,
            createInProcessServerFunctionTransport(serverFunctionOptions.registry, () => context),
            serverFunctionOptions.limits,
          ),
        );
        return serverCapabilities;
      };
      const adapter = createJavaScriptReadinessAdapter({
        callCapability: (capability, arguments_, signal) => {
          if (capability.routeIntrinsic) {
            const value = routeCapabilityValue(capability, match);
            if (value !== undefined) return value;
            return invalidPlan(
              `Route mutation ${JSON.stringify(capability.routeIntrinsic)} cannot execute during SSR.`,
            );
          }
          if (capability.serverFunctionId) {
            return resolveServerCapabilities().then((capabilities) => {
              const serverFunction = capabilities.get(capability.path.join('.'));
              if (!serverFunction) {
                return invalidPlan(
                  `Server function ${JSON.stringify(capability.serverFunctionId)} is missing from the host registry.`,
                );
              }
              // The compiler plan and registry validate the values on their respective sides.
              const invoke = serverFunction as (
                ...argumentsAndSignal: readonly unknown[]
              ) => Promise<unknown>;
              return invoke(...arguments_, signal);
            });
          }
          if (!options.callCapability) {
            return invalidPlan(
              `SSR requires a host resolver for capability ${JSON.stringify(capability.path.join('.'))}.`,
            );
          }
          return options.callCapability(capability, arguments_, signal, request, match);
        },
        ...(i18n ? { i18n } : {}),
        ...(options.scope
          ? {
              scope:
                typeof options.scope === 'function' ? options.scope(request, match) : options.scope,
            }
          : {}),
        ...(options.statusGate ? { statusGate: options.statusGate } : {}),
      });

      const encoder = new TextEncoder();
      let responseStarted = false;
      let responseStatus = 200;
      let responseHeaders: HeadersInit | undefined;
      let resolveStart!: () => void;
      let rejectStart!: (error: unknown) => void;
      const started = new Promise<void>((resolve, reject) => {
        resolveStart = resolve;
        rejectStart = reject;
      });
      const head = request.method === 'HEAD';
      let appendRouteSnapshot = true;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          void streamServerRenderPlan(
            plan,
            adapter,
            {
              start(metadata) {
                responseStarted = true;
                responseStatus = metadata.status;
                responseHeaders = metadata.headers;
                appendRouteSnapshot = metadata.status === 200;
                resolveStart();
              },
              write(chunk) {
                const output = appendRouteSnapshot
                  ? `${chunk}${serializeRouteSnapshotScript(match)}`
                  : chunk;
                appendRouteSnapshot = false;
                if (!head) controller.enqueue(encoder.encode(output));
              },
            },
            {
              ...(options.batchWindowMilliseconds !== undefined
                ? { batchWindowMilliseconds: options.batchWindowMilliseconds }
                : {}),
              ...(options.includeBootstrap !== undefined
                ? { includeBootstrap: options.includeBootstrap }
                : {}),
              ...(options.includeCheckpoints !== undefined
                ? { includeCheckpoints: options.includeCheckpoints }
                : {}),
              onError: async (error, context) =>
                (await options.onError?.(error, { ...context, match, request })) ??
                defaultServerErrorResponse(error),
              signal: request.signal,
            },
          ).then(
            () => controller.close(),
            (error: unknown) => {
              if (!responseStarted) rejectStart(error);
              if (head) controller.close();
              else controller.error(error);
            },
          );
        },
      });
      await started;

      const headers = new Headers(
        typeof options.headers === 'function' ? options.headers(request, match) : options.headers,
      );
      if (!headers.has('content-type')) headers.set('content-type', 'text/html; charset=utf-8');
      if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
      if (!headers.has('x-content-type-options')) headers.set('x-content-type-options', 'nosniff');
      for (const [name, value] of new Headers(responseHeaders)) headers.set(name, value);
      if (match.locale) headers.set('content-language', match.locale);
      if (localization && !match.localePrefixed) {
        appendVary(headers, 'Accept-Language', 'Cookie');
      }
      if (
        match.locale &&
        preferenceCookieName &&
        match.localePrefixed &&
        cookiePreference !== match.locale
      ) {
        headers.set(
          'set-cookie',
          localeCookie(request, preferenceCookieName, match.locale, options.manifest.basePath),
        );
      }
      return new Response(head ? null : stream, { headers, status: responseStatus });
    } catch (error) {
      return routeErrorResponse(
        error,
        request,
        options as FetchRouteHandlerOptions<unknown>,
        match,
      );
    }
  };
};

const nodeRequestOrigin = async (
  request: IncomingMessage,
  configured: NodeHandlerOptions['origin'],
): Promise<string | URL> => {
  if (typeof configured === 'function') return configured(request);
  if (configured) return configured;
  const host = request.headers.host;
  if (!host) return invalidPlan('A Node request requires a Host header or explicit origin.');
  const encrypted = 'encrypted' in request.socket && request.socket.encrypted === true;
  return `${encrypted ? 'https' : 'http'}://${host}`;
};

const nodeRequestHeaders = (request: IncomingMessage): Headers => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  return headers;
};

const writeNodeResponse = async (response: Response, target: ServerResponse): Promise<void> => {
  target.statusCode = response.status;
  target.statusMessage = response.statusText;
  const getSetCookie = (
    response.headers as Headers & { readonly getSetCookie?: () => readonly string[] }
  ).getSetCookie;
  for (const [name, value] of response.headers) {
    if (name !== 'set-cookie') target.setHeader(name, value);
  }
  const cookies = getSetCookie?.call(response.headers) ?? [];
  if (cookies.length > 0) target.setHeader('set-cookie', cookies);
  if (!response.body) {
    target.end();
    return;
  }
  const reader = response.body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!target.write(chunk.value)) {
        await new Promise<void>((resolve, reject) => {
          const onDrain = (): void => {
            target.removeListener('error', onError);
            resolve();
          };
          const onError = (error: Error): void => {
            target.removeListener('drain', onDrain);
            reject(error);
          };
          target.once('drain', onDrain);
          target.once('error', onError);
        });
      }
    }
    target.end();
  } finally {
    reader.releaseLock();
  }
};

/** Adapts any OXE Fetch handler to Node's IncomingMessage/ServerResponse boundary. */
export const createNodeHandler =
  (fetchHandler: FetchRouteHandler, options: NodeHandlerOptions = {}): NodeRouteHandler =>
  async (incoming, outgoing): Promise<void> => {
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    const abortIfIncomplete = (): void => {
      if (!outgoing.writableEnded) abort();
    };
    incoming.once('aborted', abort);
    outgoing.once('close', abortIfIncomplete);
    try {
      const origin = await nodeRequestOrigin(incoming, options.origin);
      const url = new URL(incoming.url ?? '/', origin);
      const method = incoming.method ?? 'GET';
      const hasBody = method !== 'GET' && method !== 'HEAD';
      const init: RequestInit & { duplex?: 'half' } = {
        headers: nodeRequestHeaders(incoming),
        method,
        signal: controller.signal,
        ...(hasBody
          ? {
              body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>,
              duplex: 'half' as const,
            }
          : {}),
      };
      await writeNodeResponse(await fetchHandler(new Request(url, init)), outgoing);
    } catch (error) {
      if (!outgoing.headersSent) {
        outgoing.statusCode = 500;
        outgoing.setHeader('content-type', 'text/plain; charset=utf-8');
        outgoing.end('Internal server error');
      } else {
        outgoing.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      incoming.removeListener('aborted', abort);
      outgoing.removeListener('close', abortIfIncomplete);
    }
  };

/** Creates the complete Node route host around the same Fetch implementation. */
export const createNodeRouteHandler = <Context = never>(
  options: FetchRouteHandlerOptions<Context>,
  nodeOptions: NodeHandlerOptions = {},
): NodeRouteHandler => createNodeHandler(createFetchRouteHandler(options), nodeOptions);
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
