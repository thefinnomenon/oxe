import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type Server } from 'node:http';

import { ApplicationDevelopmentSession } from '@oxe/compiler/application-session';
import type { ApplicationPublicationAdapterV1, PreparedApplicationRuntimeV1 } from '@oxe/compiler';
import {
  APPLICATION_AGENT_REQUEST_SCHEMA,
  loadApplicationGraph,
  type ApplicationGraphV1,
} from '@oxe/graph';
import { ApplicationRevisionStore } from '@oxe/graph/store';
import { createNodeHandler, type FetchRouteHandler } from '@oxe/router';

import {
  FetchWorkspaceAgentModel,
  parseWorkspaceChatRequest,
  streamWorkspaceChat,
  type WorkspaceAgentModelV1,
} from './agent.js';
import {
  FetchWorkspaceRuntimeOperations,
  type WorkspaceRuntimeOperationsV1,
} from './operations.js';
import { OpenAIWorkspaceAgentModel } from './openai.js';
import { WorkspaceApplicationTarget } from './application-target.js';
import { createHotApplicationPublication } from './hot-publication.js';

export interface WorkspaceRuntimeOptions {
  readonly agentModel?: WorkspaceAgentModelV1;
  /** Server-side transport for the running application. Defaults to global fetch. */
  readonly applicationFetch?: typeof fetch;
  /** Same-origin path used to mount the running application inside the development workspace. */
  readonly applicationPath?: string;
  /** Private application origin used only by the workspace server. */
  readonly applicationUrl?: string;
  /** Mutable private target used by blue-green hot publication. */
  readonly applicationTarget?: WorkspaceApplicationTarget;
  /** Exact public origins accepted by this workspace. Defaults to its loopback origin. */
  readonly allowedOrigins?: readonly string[];
  /** Required for mutation access from any non-loopback origin. */
  authorizeMutation?(request: Request): boolean | PromiseLike<boolean>;
  readonly databasePath: string;
  readonly graph: ApplicationGraphV1;
  /** Optional isolated migration/runtime activation boundary for committed revisions. */
  readonly publicationAdapter?: ApplicationPublicationAdapterV1;
  readonly publicationRuntime?: PreparedApplicationRuntimeV1;
  /** Server-only metadata and replay adapter for the running application. */
  readonly runtimeOperations?: WorkspaceRuntimeOperationsV1;
  readonly staticRoot?: URL;
}

export interface WorkspaceRuntime {
  readonly allowedOrigins: readonly string[];
  readonly applicationPath: string;
  readonly applicationUrl: string;
  readonly appId: string;
  readonly close: () => Promise<void>;
  readonly handler: FetchRouteHandler;
  readonly session: ApplicationDevelopmentSession;
}

const artifactContentType = (id: string): string =>
  id.endsWith('.html')
    ? 'text/html; charset=utf-8'
    : id.endsWith('.js')
      ? 'text/javascript; charset=utf-8'
      : id.endsWith('.json')
        ? 'application/json; charset=utf-8'
        : id.endsWith('.sql')
          ? 'text/plain; charset=utf-8'
          : 'application/octet-stream';

const json = (value: unknown, status = 200): Response =>
  Response.json(value, {
    headers: { 'cache-control': 'no-store' },
    status,
  });

const readRequestText = async (request: Request, maximumBytes: number): Promise<string> => {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > maximumBytes)
    throw new RangeError('Request body is too large.');
  const source = await request.text();
  if (new TextEncoder().encode(source).byteLength > maximumBytes)
    throw new RangeError('Request body is too large.');
  return source;
};

const exactOrigin = (value: string): string => {
  const url = new URL(value);
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new TypeError('Workspace origins must be exact HTTP or HTTPS origins.');
  return url.origin;
};

const exactApplicationPath = (value: string): string => {
  const url = new URL(value, 'http://workspace.invalid');
  if (
    !value.startsWith('/') ||
    url.origin !== 'http://workspace.invalid' ||
    url.pathname === '/' ||
    url.pathname.endsWith('/') ||
    url.search ||
    url.hash
  )
    throw new TypeError(
      'Workspace applicationPath must be a non-root absolute path without a trailing slash.',
    );
  return url.pathname;
};

const loopbackOrigin = (origin: string): boolean => {
  const hostname = new URL(origin).hostname;
  return hostname === '127.0.0.1' || hostname === '[::1]' || hostname === 'localhost';
};

/** Trusts identity headers only at this loopback-bound process behind Cloudflare Access. */
export const createCloudflareAccessMutationAuthorizer = (
  allowedEmails: readonly string[],
): NonNullable<WorkspaceRuntimeOptions['authorizeMutation']> => {
  const emails = new Set(allowedEmails.map((email) => email.trim().toLowerCase()).filter(Boolean));
  if (emails.size === 0) throw new TypeError('Remote workspace access requires an allowed email.');
  return (request) => {
    if (loopbackOrigin(new URL(request.url).origin)) return true;
    const email = request.headers.get('cf-access-authenticated-user-email')?.toLowerCase();
    const assertion = request.headers.get('cf-access-jwt-assertion');
    return Boolean(email && emails.has(email) && assertion);
  };
};

const sameOrigin = (request: Request, allowedOrigins: readonly string[]): boolean => {
  if (!allowedOrigins.includes(new URL(request.url).origin)) return false;
  const origin = request.headers.get('origin');
  return !origin || (allowedOrigins.includes(origin) && origin === new URL(request.url).origin);
};

const mutationAuthorized = async (
  request: Request,
  options: WorkspaceRuntimeOptions,
  allowedOrigins: readonly string[],
): Promise<boolean> =>
  request.headers.get('x-oxe-workspace-request') === '1' &&
  sameOrigin(request, allowedOrigins) &&
  (options.authorizeMutation ? await options.authorizeMutation(request) : true);

const staticResponse = (root: URL, name: string, contentType: string): Response => {
  try {
    return new Response(readFileSync(new URL(name, root)), {
      headers: { 'cache-control': 'no-cache', 'content-type': contentType },
    });
  } catch {
    return new Response('Workspace asset not found.', { status: 404 });
  }
};

const applicationRequestPath = (pathname: string, applicationPath: string): string =>
  pathname === applicationPath
    ? '/'
    : pathname.startsWith(`${applicationPath}/`)
      ? pathname.slice(applicationPath.length)
      : pathname;

const proxyApplicationRequest = async (
  request: Request,
  applicationFetch: typeof fetch,
  applicationPath: string,
  applicationUrl: string,
): Promise<Response> => {
  const requestUrl = new URL(request.url);
  const upstreamUrl = new URL(
    `${applicationRequestPath(requestUrl.pathname, applicationPath)}${requestUrl.search}`,
    `${applicationUrl}/`,
  );
  const headers = new Headers(request.headers);
  for (const name of [
    'cf-access-authenticated-user-email',
    'cf-access-jwt-assertion',
    'connection',
    'content-length',
    'host',
    'transfer-encoding',
  ])
    headers.delete(name);
  try {
    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await request.arrayBuffer();
    if (body && body.byteLength > 1_048_576)
      throw new RangeError('Application request body is too large.');
    const response = await applicationFetch(
      new Request(upstreamUrl, {
        ...(body ? { body } : {}),
        headers,
        method: request.method,
        redirect: 'manual',
      }),
    );
    const responseHeaders = new Headers(response.headers);
    const location = responseHeaders.get('location');
    if (location) {
      const resolvedLocation = new URL(location, upstreamUrl);
      if (resolvedLocation.origin === applicationUrl)
        responseHeaders.set(
          'location',
          `${requestUrl.origin}${resolvedLocation.pathname}${resolvedLocation.search}${resolvedLocation.hash}`,
        );
    }
    return new Response(response.body, {
      headers: responseHeaders,
      status: response.status,
      statusText: response.statusText,
    });
  } catch (error) {
    return new Response(
      error instanceof RangeError ? error.message : 'The development application is unavailable.',
      {
        headers: {
          'cache-control': 'no-store',
          'content-type': 'text/plain; charset=utf-8',
        },
        status: error instanceof RangeError ? 413 : 502,
      },
    );
  }
};

export const createWorkspaceRuntime = (options: WorkspaceRuntimeOptions): WorkspaceRuntime => {
  const applicationFetch = options.applicationFetch ?? fetch;
  const applicationPath = exactApplicationPath(options.applicationPath ?? '/__app');
  const configuredApplicationUrl = exactOrigin(
    options.applicationUrl ?? options.applicationTarget?.current().url ?? 'http://127.0.0.1:3000',
  );
  const applicationTarget =
    options.applicationTarget ??
    new WorkspaceApplicationTarget({
      id: 'configured',
      revision: options.graph.revision,
      url: configuredApplicationUrl,
    });
  exactOrigin(applicationTarget.current().url);
  const allowedOrigins = Object.freeze([
    ...new Set(
      (options.allowedOrigins ?? ['http://127.0.0.1:4175']).map((origin) => exactOrigin(origin)),
    ),
  ]);
  if (allowedOrigins.length === 0) throw new TypeError('Workspace requires an allowed origin.');
  if (allowedOrigins.some((origin) => !loopbackOrigin(origin)) && !options.authorizeMutation)
    throw new TypeError('Remote workspace origins require an authorizeMutation boundary.');
  mkdirSync(dirname(options.databasePath), { recursive: true });
  const store = new ApplicationRevisionStore(options.databasePath);
  const session = new ApplicationDevelopmentSession(
    store,
    options.graph,
    undefined,
    options.publicationAdapter,
    options.publicationRuntime,
  );
  const appId = options.graph.app.id;
  const staticRoot = options.staticRoot ?? new URL('./', import.meta.url);
  const handler: FetchRouteHandler = async (request) => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/')
      return staticResponse(staticRoot, 'index.html', 'text/html; charset=utf-8');
    if (request.method === 'GET' && url.pathname === '/client.js')
      return staticResponse(staticRoot, 'client.js', 'text/javascript; charset=utf-8');
    if (request.method === 'GET' && url.pathname === '/model.js')
      return staticResponse(staticRoot, 'model.js', 'text/javascript; charset=utf-8');
    if (request.method === 'GET' && url.pathname === '/styles.css')
      return staticResponse(staticRoot, 'styles.css', 'text/css; charset=utf-8');
    if (request.method === 'GET' && url.pathname === '/health')
      return json({ appId, ok: true, revision: store.current(appId)?.revision });
    if (request.method === 'GET' && url.pathname === '/api/config')
      return json({
        agentRequestSchema: APPLICATION_AGENT_REQUEST_SCHEMA,
        agentAvailable: options.agentModel !== undefined,
        appId,
        artifactRevision: session.artifacts(appId)?.revision,
        operationsAvailable: options.runtimeOperations !== undefined,
        applicationUrl: applicationPath,
        publication: session.publicationState(),
        revision: store.current(appId)?.revision,
      });
    if (request.method === 'GET' && url.pathname === '/api/operations') {
      if (!(await mutationAuthorized(request, options, allowedOrigins)))
        return json({ error: 'Workspace runtime operations access denied.' }, 403);
      if (!options.runtimeOperations)
        return json({ error: 'No runtime operations transport configured.' }, 503);
      try {
        return json(await options.runtimeOperations.snapshot());
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error
                ? `Runtime operations are unavailable: ${error.message}`
                : 'Runtime operations are unavailable.',
          },
          502,
        );
      }
    }
    if (request.method === 'POST' && url.pathname === '/api/operations/replay') {
      if (!(await mutationAuthorized(request, options, allowedOrigins)))
        return json({ error: 'Workspace runtime operations access denied.' }, 403);
      if (!options.runtimeOperations)
        return json({ error: 'No runtime operations transport configured.' }, 503);
      if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
        return json({ error: 'Runtime job replay requires application/json.' }, 415);
      try {
        const body = JSON.parse(await readRequestText(request, 16_384)) as unknown;
        if (
          typeof body !== 'object' ||
          body === null ||
          !('jobId' in body) ||
          typeof body.jobId !== 'string' ||
          body.jobId.length === 0
        )
          throw new TypeError('Runtime job replay requires a non-empty jobId.');
        const maxAttempts = 'maxAttempts' in body ? body.maxAttempts : undefined;
        if (
          maxAttempts !== undefined &&
          (typeof maxAttempts !== 'number' || !Number.isInteger(maxAttempts) || maxAttempts < 1)
        )
          throw new TypeError('Runtime job replay maxAttempts must be a positive integer.');
        return json(
          await options.runtimeOperations.replayJob(
            body.jobId,
            typeof maxAttempts === 'number' ? maxAttempts : undefined,
          ),
        );
      } catch (error) {
        return json(
          {
            error:
              error instanceof SyntaxError || error instanceof TypeError
                ? error.message
                : error instanceof Error
                  ? `Runtime job replay failed: ${error.message}`
                  : 'Runtime job replay failed.',
          },
          error instanceof RangeError
            ? 413
            : error instanceof SyntaxError || error instanceof TypeError
              ? 400
              : 502,
        );
      }
    }
    if (request.method === 'POST' && url.pathname === '/api/chat') {
      if (!(await mutationAuthorized(request, options, allowedOrigins)))
        return json({ error: 'Workspace chat access denied.' }, 403);
      if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
        return json({ error: 'Workspace chat requires application/json.' }, 415);
      if (!options.agentModel)
        return json({ error: 'No workspace model transport configured.' }, 503);
      try {
        const chat = parseWorkspaceChatRequest(
          JSON.parse(await readRequestText(request, 262_144)) as unknown,
        );
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              for await (const event of streamWorkspaceChat(
                session,
                options.agentModel!,
                appId,
                chat.messages,
                request.signal,
                chat.interactions,
              ))
                controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            } catch (error) {
              controller.enqueue(
                encoder.encode(
                  `${JSON.stringify({ error: error instanceof Error ? error.message : 'Workspace chat failed.', kind: 'error' })}\n`,
                ),
              );
            } finally {
              controller.close();
            }
          },
        });
        return new Response(stream, {
          headers: {
            'cache-control': 'no-store',
            'content-type': 'application/x-ndjson; charset=utf-8',
            'x-content-type-options': 'nosniff',
          },
        });
      } catch (error) {
        return json(
          { error: error instanceof Error ? error.message : 'Workspace chat request failed.' },
          error instanceof RangeError ? 413 : 400,
        );
      }
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/artifacts/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/artifacts/'.length));
      const artifact = session.artifacts(appId)?.artifacts.find((candidate) => candidate.id === id);
      if (!artifact) return new Response('Generated artifact not found.', { status: 404 });
      return new Response(artifact.contents, {
        headers: {
          'cache-control': 'no-cache',
          'content-type': artifactContentType(artifact.id),
          etag: `"${artifact.fingerprint}"`,
          'x-oxe-artifact-revision': String(artifact.builtAtRevision),
          'x-oxe-graph-revision': String(
            session.artifacts(appId)?.revision ?? artifact.builtAtRevision,
          ),
        },
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/application-status') {
      try {
        const response = await applicationFetch(applicationTarget.current().url, {
          redirect: 'manual',
          signal: AbortSignal.timeout(1_500),
        });
        return json({
          artifactRevision: session.artifacts(appId)?.revision,
          publication: session.publicationState(),
          reachable: true,
          source: 'configured',
          status: response.status,
          url: applicationPath,
        });
      } catch {
        const artifactRevision = session.artifacts(appId)?.revision;
        return json({
          artifactRevision,
          publication: session.publicationState(),
          reachable: artifactRevision !== undefined,
          source: 'last-good',
          url: '/api/artifacts/browser/index.html',
        });
      }
    }
    if (request.method === 'POST' && url.pathname === '/api/publication/retry') {
      if (!(await mutationAuthorized(request, options, allowedOrigins)))
        return json({ error: 'Workspace publication access denied.' }, 403);
      try {
        const publication = await session.retryPublication(appId);
        return json({
          artifactRevision: publication.revision,
          publication: session.publicationState(),
        });
      } catch (error) {
        return json(
          {
            error: error instanceof Error ? error.message : 'Workspace publication retry failed.',
            publication: session.publicationState(),
          },
          409,
        );
      }
    }
    if (request.method === 'POST' && url.pathname === '/api/agent') {
      if (!(await mutationAuthorized(request, options, allowedOrigins)))
        return json({ error: 'Workspace protocol access denied.' }, 403);
      if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
        return json({ error: 'Workspace protocol requires application/json.' }, 415);
      try {
        const source = await readRequestText(request, 1_048_576);
        return json(await session.handleAndPublish(JSON.parse(source)));
      } catch (error) {
        return json(
          {
            error:
              error instanceof SyntaxError
                ? 'Agent request JSON is invalid.'
                : 'Agent request failed.',
          },
          error instanceof RangeError ? 413 : 400,
        );
      }
    }
    return proxyApplicationRequest(
      request,
      applicationFetch,
      applicationPath,
      applicationTarget.current().url,
    );
  };
  return {
    allowedOrigins,
    applicationPath,
    get applicationUrl() {
      return applicationTarget.current().url;
    },
    appId,
    close: () => session.close(),
    handler,
    session,
  };
};

export const startWorkspaceServer = (runtime: WorkspaceRuntime, port: number): Promise<Server> =>
  new Promise((resolveServer, reject) => {
    const server = createServer(
      createNodeHandler(runtime.handler, {
        origin: (request) => {
          const host = request.headers.host?.toLowerCase();
          const origin = runtime.allowedOrigins.find(
            (candidate) => new URL(candidate).host.toLowerCase() === host,
          );
          if (!origin) throw new TypeError('Workspace request host is not allowed.');
          return origin;
        },
      }),
    );
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolveServer(server));
  });

const main = async (): Promise<void> => {
  const port = Number(process.env.OXE_WORKSPACE_PORT ?? 4175);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new TypeError('OXE_WORKSPACE_PORT must be an integer between 1 and 65535.');
  const graphUrl = new URL('../../../examples/application-graph-todo/graph.json', import.meta.url);
  const graph = loadApplicationGraph(JSON.parse(readFileSync(graphUrl, 'utf8')) as unknown);
  const databasePath =
    process.env.OXE_WORKSPACE_DB ??
    fileURLToPath(new URL('../.oxe/workspace.sqlite', import.meta.url));
  const localOrigin = `http://127.0.0.1:${port}`;
  const applicationUrl = process.env.OXE_APPLICATION_URL ?? 'http://127.0.0.1:3000';
  const remoteOrigins = (process.env.OXE_WORKSPACE_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedEmails = (process.env.OXE_WORKSPACE_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedOrigins = [localOrigin, ...remoteOrigins];
  const databaseURL = process.env.DATABASE_URL;
  const publicationStore = new ApplicationRevisionStore(databasePath);
  publicationStore.initialize(graph);
  const activeRevision =
    publicationStore.activePublication(graph.app.id)?.revision ?? graph.revision;
  const activeGraph = publicationStore.load(graph.app.id, activeRevision);
  publicationStore.close();
  if (!activeGraph)
    throw new Error(`Active workspace revision r${activeRevision} could not be loaded.`);
  const applicationTarget = new WorkspaceApplicationTarget({
    ...(databaseURL ? { databaseURL } : {}),
    id: 'configured',
    revision: graph.revision,
    url: applicationUrl,
  });
  const hotPublication = databaseURL
    ? await createHotApplicationPublication(
        {
          allowedOrigins,
          applicationTarget,
          authSecret:
            process.env.BETTER_AUTH_SECRET ??
            'local-development-only-secret-change-before-deploying',
          databaseURL,
          expectedActiveRevision: activeRevision,
          projectDirectory: fileURLToPath(
            new URL('../../../examples/application-graph-todo/', import.meta.url),
          ),
        },
        activeGraph,
      )
    : undefined;
  const runtime = createWorkspaceRuntime({
    ...(process.env.OXE_AGENT_ENDPOINT
      ? {
          agentModel: new FetchWorkspaceAgentModel({
            endpoint: process.env.OXE_AGENT_ENDPOINT,
            ...(process.env.OXE_AGENT_BEARER_TOKEN
              ? { headers: { authorization: `Bearer ${process.env.OXE_AGENT_BEARER_TOKEN}` } }
              : {}),
          }),
        }
      : process.env.OPENAI_API_KEY
        ? {
            agentModel: new OpenAIWorkspaceAgentModel({
              apiKey: process.env.OPENAI_API_KEY,
              ...(process.env.OXE_OPENAI_MODEL ? { model: process.env.OXE_OPENAI_MODEL } : {}),
            }),
          }
        : {}),
    databasePath,
    graph,
    applicationTarget,
    ...(hotPublication
      ? {
          publicationAdapter: hotPublication.adapter,
          ...(hotPublication.recoveredRuntime
            ? { publicationRuntime: hotPublication.recoveredRuntime }
            : {}),
        }
      : {}),
    ...(process.env.OXE_DEVELOPMENT_OPERATIONS_TOKEN
      ? {
          runtimeOperations: new FetchWorkspaceRuntimeOperations({
            endpoint:
              process.env.OXE_DEVELOPMENT_OPERATIONS_URL ??
              new URL('/api/development/operations', applicationUrl).href,
            token: process.env.OXE_DEVELOPMENT_OPERATIONS_TOKEN,
          }),
        }
      : {}),
    ...(remoteOrigins.length > 0
      ? {
          allowedOrigins,
          authorizeMutation: createCloudflareAccessMutationAuthorizer(allowedEmails),
        }
      : { allowedOrigins: [localOrigin] }),
    applicationUrl,
  });
  const server = await startWorkspaceServer(runtime, port);
  const close = (): void => {
    server.close((error) => {
      void runtime
        .close()
        .then(() => {
          if (error) throw error;
        })
        .catch((shutdownError: unknown) => {
          console.error('OXE workspace shutdown failed.', shutdownError);
          process.exitCode = 1;
        });
    });
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  process.stdout.write(`OXE workspace: http://127.0.0.1:${port}\n`);
  process.stdout.write(`Development application: ${runtime.applicationPath}\n`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
