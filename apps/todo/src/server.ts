import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';

import {
  createOxeBetterAuth,
  migrateOxeBetterAuth,
  readBetterAuthApplicationContext,
} from '@oxe/auth';
import {
  compileApplicationPostgresBootstrap,
  compileApplicationPostgresMigration,
  generateApplicationPostgresInfrastructureSql,
  lowerApplicationRouteToUiGraph,
  projectApplicationBrowserView,
  renderApplicationBrowserViewLoadingHtml,
} from '@oxe/compiler';
import { ApplicationHostError, loadApplicationGraph, type ApplicationGraphV1 } from '@oxe/graph';
import {
  applyApplicationPostgresMigration,
  createNodePostgresPool,
  listPostgresApplicationContextOptions,
  resolvePostgresApplicationActiveContexts,
  type ApplicationPostgresJobWorkerOptionsV1,
  type ApplicationSqlPoolV1,
} from '@oxe/postgres';
import { createServerFunctionFetchHandler } from '@oxe/server-functions';
import {
  createPostgresApplicationServerRuntime,
  type PostgresApplicationDevelopmentOperationsV1,
  type PostgresApplicationServerRuntimeV1,
} from '@oxe/server-functions/application-postgres';
import {
  createApplicationClientContext,
  readApplicationActiveContextRequest,
} from '@oxe/server-functions/auth';
import { Pool } from 'pg';

import {
  renderTodoPage,
  serializeTodoBrowserConfiguration,
  type TodoBrowserConfigurationV1,
} from './page.js';
import {
  backfillTodoRevision13Teams,
  todoRevision12Graph,
  todoRevision13Graph,
  todoRevision14Graph,
  todoRevision15Graph,
} from './migrations.js';

const fixtureUrl = new URL('../../../examples/application-graph-todo/graph.json', import.meta.url);
const maximumRequestBytes = 1_048_576;
const deployedRevision12BootstrapChecksum =
  '8e7b6f93f98d9f5fb4acac14dce1f083ce81d018ce60f077731879863e3be700';

const todoGraph = (): ApplicationGraphV1 =>
  loadApplicationGraph(JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown);

const requestHeaders = (request: IncomingMessage): Headers => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  return headers;
};

const requestBody = async (request: IncomingMessage): Promise<ArrayBuffer | undefined> => {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const value of request) {
    const chunk = typeof value === 'string' ? Buffer.from(value) : (value as Buffer);
    length += chunk.byteLength;
    if (length > maximumRequestBytes) throw new RangeError('Request body is too large.');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return undefined;
  const bytes = Uint8Array.from(Buffer.concat(chunks));
  return bytes.buffer;
};

const exactOrigin = (value: string, label: string): string => {
  const url = new URL(value);
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new TypeError(`${label} must be an exact HTTP or HTTPS origin.`);
  return url.origin;
};

export const resolveTodoAllowedOrigins = (
  baseURL: string,
  configured: readonly string[] = [],
): readonly string[] => {
  const origins = [exactOrigin(baseURL, 'BETTER_AUTH_URL')];
  for (const value of configured) origins.push(exactOrigin(value, 'OXE_ALLOWED_ORIGINS entry'));
  return Object.freeze([...new Set(origins)]);
};

export const resolveTodoRequestOrigin = (
  request: Pick<IncomingMessage, 'headers'>,
  allowedOrigins: readonly string[],
): string => {
  const host = request.headers.host?.toLowerCase();
  if (!host) throw new TypeError('Request Host header is required.');
  const origin = allowedOrigins.find((candidate) => new URL(candidate).host.toLowerCase() === host);
  if (!origin) throw new TypeError(`Request host ${JSON.stringify(host)} is not allowed.`);
  return origin;
};

const fetchRequest = async (
  request: IncomingMessage,
  allowedOrigins: readonly string[],
): Promise<Request> => {
  const method = request.method ?? 'GET';
  const body = await requestBody(request);
  const origin = resolveTodoRequestOrigin(request, allowedOrigins);
  return new Request(new URL(request.url ?? '/', origin), {
    ...(body ? { body } : {}),
    headers: requestHeaders(request),
    method,
  });
};

const writeResponse = async (response: Response, target: ServerResponse): Promise<void> => {
  target.statusCode = response.status;
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') target.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) target.setHeader('set-cookie', cookies);
  target.end(Buffer.from(await response.arrayBuffer()));
};

const frameAncestors = (developmentParentOrigin: string | undefined): string =>
  developmentParentOrigin ? `'self' ${developmentParentOrigin}` : "'none'";

const htmlResponse = (html: string, developmentParentOrigin?: string): Response =>
  new Response(html, {
    headers: {
      'cache-control': 'no-store',
      'content-security-policy': `default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors ${frameAncestors(developmentParentOrigin)}`,
      'content-type': 'text/html; charset=utf-8',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  });

export interface TodoApplicationOptionsV1 {
  readonly allowedOrigins?: readonly string[];
  readonly authSecret: string;
  readonly baseURL: string;
  readonly clientSource?: string;
  readonly databaseURL: string;
  readonly developmentSource?: string;
  /** Enables the metadata-only development operations endpoint. Never sent to browsers. */
  readonly developmentOperationsToken?: string;
  /** Exact trusted workspace origin allowed to embed and receive semantic interaction context. */
  readonly developmentParentOrigin?: string;
  readonly generatedClientSource?: string;
  readonly generatedModuleSources?: Readonly<Record<string, string>>;
  readonly jobWorker?: ApplicationPostgresJobWorkerOptionsV1;
  /** Browser-visible mount path. The application server continues to receive root-relative paths. */
  readonly publicBasePath?: string;
}

export type TodoDevelopmentOperationsSnapshotV1 = PostgresApplicationDevelopmentOperationsV1;

export interface TodoApplicationV1 {
  close(): Promise<void>;
  developmentOperations(): Promise<TodoDevelopmentOperationsSnapshotV1>;
  readonly graph: ApplicationGraphV1;
  handle(request: Request): Promise<Response>;
  readonly jobWorker: PostgresApplicationServerRuntimeV1['worker'];
}

const developmentTokenAuthorized = (request: Request, expected: string): boolean => {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(authorization.slice('Bearer '.length));
  const required = Buffer.from(expected);
  return supplied.byteLength === required.byteLength && timingSafeEqual(supplied, required);
};

const normalizePublicBasePath = (value: string | undefined): string => {
  if (!value || value === '/') return '/';
  const url = new URL(value, 'http://application.invalid');
  if (
    !value.startsWith('/') ||
    url.origin !== 'http://application.invalid' ||
    url.pathname.endsWith('/') ||
    url.search ||
    url.hash
  )
    throw new TypeError('publicBasePath must be an absolute path without a trailing slash.');
  return url.pathname;
};

export const createTodoApplication = async (
  options: TodoApplicationOptionsV1,
): Promise<TodoApplicationV1> => {
  if (options.developmentOperationsToken && options.developmentOperationsToken.length < 32)
    throw new TypeError('The development operations token must contain at least 32 characters.');
  const graph = todoGraph();
  const publicBasePath = normalizePublicBasePath(options.publicBasePath);
  const developmentParentOrigin = options.developmentParentOrigin
    ? exactOrigin(options.developmentParentOrigin, 'developmentParentOrigin')
    : undefined;
  const allowedOrigins = resolveTodoAllowedOrigins(options.baseURL, options.allowedOrigins);
  const authentication = graph.app.authentication;
  if (
    !authentication ||
    authentication.provider !== 'betterAuth' ||
    !authentication.methods.includes('emailPassword')
  )
    throw new Error('TinyTodo requires Better Auth email/password graph configuration.');
  const authenticatedRoute = graph.routes.find(
    (route) => route.id === authentication.authenticatedRoute,
  );
  if (!authenticatedRoute) throw new Error('TinyTodo authenticated route is unavailable.');

  const adminPool = new Pool({ connectionString: options.databaseURL, max: 2 });
  try {
    await adminPool.query('CREATE SCHEMA IF NOT EXISTS auth');
  } finally {
    await adminPool.end();
  }
  const authPool = new Pool({
    connectionString: options.databaseURL,
    max: 4,
    options: '-c search_path=auth',
  });
  const applicationPool: ApplicationSqlPoolV1 = createNodePostgresPool({
    connectionString: options.databaseURL,
    max: 8,
  });
  const auth = createOxeBetterAuth({
    appName: graph.app.name,
    baseURL: {
      allowedHosts: allowedOrigins.map((origin) => new URL(origin).host),
      fallback: new URL(options.baseURL).origin,
      protocol: 'auto',
    },
    database: authPool,
    secret: options.authSecret,
    trustedOrigins: allowedOrigins,
  });

  try {
    await migrateOxeBetterAuth(auth);
    const revision15 = todoRevision15Graph(graph);
    const revision14 = todoRevision14Graph(graph);
    const revision13 = todoRevision13Graph(graph);
    const revision12 = todoRevision12Graph(graph);
    await applyApplicationPostgresMigration(
      applicationPool,
      compileApplicationPostgresBootstrap(revision12),
      { acceptedChecksums: [deployedRevision12BootstrapChecksum] },
    );
    await applyApplicationPostgresMigration(
      applicationPool,
      compileApplicationPostgresMigration(revision12, revision13),
    );
    await backfillTodoRevision13Teams(applicationPool);
    await applyApplicationPostgresMigration(
      applicationPool,
      compileApplicationPostgresMigration(revision13, revision14),
    );
    await applyApplicationPostgresMigration(
      applicationPool,
      compileApplicationPostgresMigration(revision14, revision15),
    );
    await applyApplicationPostgresMigration(
      applicationPool,
      compileApplicationPostgresMigration(revision15, graph),
    );
    await applicationPool.query(generateApplicationPostgresInfrastructureSql(graph));
  } catch (error) {
    await applicationPool.close();
    await authPool.end();
    throw error;
  }

  const definitions = lowerApplicationRouteToUiGraph(graph).graph.serverFunctions ?? [];
  const application = createPostgresApplicationServerRuntime(graph, definitions, applicationPool, {
    host: {
      externalReferenceExists: async ({ entityId, recordId }) => {
        if (entityId !== graph.app.actorEntity) return false;
        const result = await authPool.query('SELECT 1 FROM "user" WHERE "id" = $1', [recordId]);
        return result.rowCount === 1;
      },
    },
    ...(options.jobWorker ? { worker: options.jobWorker } : {}),
  });
  const jobWorker = application.worker;
  const applicationContext = (request: Request) =>
    readBetterAuthApplicationContext(
      auth,
      request.headers,
      readApplicationActiveContextRequest(request.headers, graph.app.contexts ?? []),
      (userId, requested) =>
        resolvePostgresApplicationActiveContexts(graph, applicationPool, userId, requested),
    );
  const rpc = createServerFunctionFetchHandler(application.registry, {
    allowedOrigins,
    createContext: applicationContext,
  });
  const clientConfiguration: TodoBrowserConfigurationV1 = {
    appName: graph.app.name,
    authBasePath: publicBasePath === '/' ? '/api/auth' : `${publicBasePath}/api/auth`,
    basePath: publicBasePath,
    ...(developmentParentOrigin ? { developmentParentOrigin } : {}),
  };
  const page = renderTodoPage(
    clientConfiguration,
    renderApplicationBrowserViewLoadingHtml(projectApplicationBrowserView(graph)),
  );
  const configurationSource = serializeTodoBrowserConfiguration(clientConfiguration);
  const clientSource =
    options.clientSource ?? readFileSync(new URL('./client.js', import.meta.url), 'utf8');
  const developmentSource =
    options.developmentSource ?? readFileSync(new URL('./development.js', import.meta.url), 'utf8');
  const generatedClientSource =
    options.generatedClientSource ??
    readFileSync(new URL('./generated/application-client.js', import.meta.url), 'utf8');
  const generatedModuleSource = (path: string, fileName: string): string =>
    options.generatedModuleSources?.[path] ??
    readFileSync(new URL(`./generated/${fileName}`, import.meta.url), 'utf8');
  const generatedSources = new Map<string, string>([
    ['/generated/application-client.js', generatedClientSource],
    [
      '/generated/application-client-runtime.js',
      generatedModuleSource(
        '/generated/application-client-runtime.js',
        'application-client-runtime.js',
      ),
    ],
    [
      '/generated/application-client-loader.js',
      generatedModuleSource(
        '/generated/application-client-loader.js',
        'application-client-loader.js',
      ),
    ],
    [
      '/generated/application-view.js',
      generatedModuleSource('/generated/application-view.js', 'application-view.js'),
    ],
    [
      '/generated/account-client.js',
      generatedModuleSource('/generated/account-client.js', 'account-client.js'),
    ],
    [
      '/generated/team-client.js',
      generatedModuleSource('/generated/team-client.js', 'team-client.js'),
    ],
    [
      '/generated/ownedTeam-client.js',
      generatedModuleSource('/generated/ownedTeam-client.js', 'ownedTeam-client.js'),
    ],
  ]);
  const pagePaths = new Set([
    '/',
    authentication.signInPath,
    authentication.signUpPath,
    authenticatedRoute.path,
  ]);

  const developmentOperations = application.developmentOperations;

  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (!allowedOrigins.includes(url.origin))
      return new Response('Request origin is not allowed.', { status: 421 });
    if (url.pathname === '/api/development/operations') {
      if (!options.developmentOperationsToken) return new Response('Not found.', { status: 404 });
      if (!developmentTokenAuthorized(request, options.developmentOperationsToken))
        return Response.json(
          { error: 'Development operations authentication is required.' },
          { headers: { 'cache-control': 'no-store' }, status: 401 },
        );
      if (request.method === 'GET')
        return Response.json(await developmentOperations(), {
          headers: { 'cache-control': 'no-store' },
        });
      if (request.method === 'POST') {
        try {
          const body = (await request.json()) as unknown;
          if (
            typeof body !== 'object' ||
            body === null ||
            !('jobId' in body) ||
            typeof body.jobId !== 'string' ||
            body.jobId.length === 0
          )
            throw new TypeError('Replay requires a non-empty jobId.');
          const maxAttempts = 'maxAttempts' in body ? body.maxAttempts : undefined;
          if (
            maxAttempts !== undefined &&
            (!Number.isInteger(maxAttempts) || (maxAttempts as number) < 1)
          )
            throw new TypeError('Replay maxAttempts must be a positive integer.');
          return Response.json(
            await application.host.replayJob(body.jobId, {
              ...(typeof maxAttempts === 'number' ? { maxAttempts } : {}),
            }),
            { headers: { 'cache-control': 'no-store' } },
          );
        } catch (error) {
          const status =
            error instanceof ApplicationHostError && error.kind === 'not-found'
              ? 404
              : error instanceof SyntaxError ||
                  error instanceof TypeError ||
                  error instanceof ApplicationHostError
                ? 400
                : 500;
          return Response.json(
            { error: status === 500 ? 'Development job replay failed.' : (error as Error).message },
            { headers: { 'cache-control': 'no-store' }, status },
          );
        }
      }
      return Response.json(
        { error: 'Development operations require GET or POST.' },
        { headers: { allow: 'GET, POST', 'cache-control': 'no-store' }, status: 405 },
      );
    }
    if (url.pathname.startsWith('/api/auth/')) return auth.handler(request);
    if (url.pathname === '/api/functions') return rpc(request);
    if (url.pathname === '/api/context-options') {
      if (request.method !== 'GET')
        return Response.json(
          { error: 'Application context options require GET.' },
          { headers: { allow: 'GET', 'cache-control': 'no-store' }, status: 405 },
        );
      try {
        const contextId = url.searchParams.get('contextId');
        if (!contextId) throw new TypeError('contextId is required.');
        const session = await readBetterAuthApplicationContext(auth, request.headers);
        if (!session.userId)
          return Response.json(
            { error: 'Authentication is required.' },
            { headers: { 'cache-control': 'no-store' }, status: 401 },
          );
        return Response.json(
          await listPostgresApplicationContextOptions(
            graph,
            applicationPool,
            session.userId,
            contextId,
          ),
          { headers: { 'cache-control': 'no-store' } },
        );
      } catch (error) {
        if (error instanceof TypeError)
          return Response.json(
            { error: error.message },
            { headers: { 'cache-control': 'no-store' }, status: 400 },
          );
        if (error instanceof ApplicationHostError)
          return Response.json(
            { error: error.message },
            {
              headers: { 'cache-control': 'no-store' },
              status:
                error.kind === 'unauthorized'
                  ? 401
                  : error.kind === 'forbidden'
                    ? 403
                    : error.kind === 'not-found'
                      ? 404
                      : 400,
            },
          );
        throw error;
      }
    }
    if (url.pathname === '/api/context') {
      if (request.method !== 'GET')
        return Response.json(
          { error: 'Application context requires GET.' },
          { headers: { allow: 'GET', 'cache-control': 'no-store' }, status: 405 },
        );
      try {
        const context = await applicationContext(request);
        if (!context.userId)
          return Response.json(
            { error: 'Authentication is required.' },
            { headers: { 'cache-control': 'no-store' }, status: 401 },
          );
        return Response.json(createApplicationClientContext(context), {
          headers: { 'cache-control': 'no-store' },
        });
      } catch (error) {
        if (error instanceof TypeError)
          return Response.json(
            { error: error.message },
            { headers: { 'cache-control': 'no-store' }, status: 400 },
          );
        if (error instanceof ApplicationHostError)
          return Response.json(
            { error: error.message },
            {
              headers: { 'cache-control': 'no-store' },
              status:
                error.kind === 'unauthorized'
                  ? 401
                  : error.kind === 'forbidden'
                    ? 403
                    : error.kind === 'not-found'
                      ? 404
                      : 400,
            },
          );
        throw error;
      }
    }
    if (url.pathname === '/app.js')
      return new Response(clientSource, {
        headers: {
          'cache-control': 'no-cache',
          'content-type': 'text/javascript; charset=utf-8',
          'x-content-type-options': 'nosniff',
        },
      });
    if (url.pathname === '/development.js')
      return new Response(developmentSource, {
        headers: {
          'cache-control': 'no-cache',
          'content-type': 'text/javascript; charset=utf-8',
          'x-content-type-options': 'nosniff',
        },
      });
    const generatedSource = generatedSources.get(url.pathname);
    if (generatedSource)
      return new Response(generatedSource, {
        headers: {
          'cache-control': 'no-cache',
          'content-type': 'text/javascript; charset=utf-8',
          'x-content-type-options': 'nosniff',
        },
      });
    if (url.pathname === '/config.js')
      return new Response(configurationSource, {
        headers: {
          'cache-control': 'no-store',
          'content-type': 'text/javascript; charset=utf-8',
          'x-content-type-options': 'nosniff',
        },
      });
    if (url.pathname === '/health')
      return Response.json(
        { appId: graph.app.id, revision: graph.revision, status: 'ok' },
        { headers: { 'cache-control': 'no-store' } },
      );
    if (pagePaths.has(url.pathname)) return htmlResponse(page, developmentParentOrigin);
    return new Response('Not found.', {
      headers: {
        'cache-control': 'no-store',
        'content-type': 'text/plain; charset=utf-8',
      },
      status: 404,
    });
  };

  let closing: Promise<void> | undefined;
  return Object.freeze({
    close: () =>
      (closing ??= (async () => {
        await application.close();
        await applicationPool.close();
        await authPool.end();
      })()),
    developmentOperations,
    graph,
    handle,
    jobWorker,
  });
};

const start = async (): Promise<void> => {
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new TypeError('PORT must be an integer between 1 and 65535.');
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL) throw new TypeError('DATABASE_URL is required.');
  const baseURL = process.env.BETTER_AUTH_URL ?? `http://${host}:${port}`;
  const allowedOrigins = resolveTodoAllowedOrigins(
    baseURL,
    (process.env.OXE_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const configuredSecret = process.env.BETTER_AUTH_SECRET;
  if (!configuredSecret && process.env.NODE_ENV === 'production')
    throw new TypeError('BETTER_AUTH_SECRET is required in production.');
  const authSecret = configuredSecret ?? 'local-development-only-secret-change-before-deploying';
  if (!configuredSecret)
    process.stderr.write(
      'TinyTodo is using its local-development Better Auth secret. Set BETTER_AUTH_SECRET before sharing this server.\n',
    );
  const application = await createTodoApplication({
    allowedOrigins,
    authSecret,
    baseURL,
    databaseURL,
    ...(process.env.OXE_DEVELOPMENT_OPERATIONS_TOKEN
      ? { developmentOperationsToken: process.env.OXE_DEVELOPMENT_OPERATIONS_TOKEN }
      : {}),
    ...(process.env.OXE_PUBLIC_BASE_PATH
      ? { publicBasePath: process.env.OXE_PUBLIC_BASE_PATH }
      : {}),
    ...(process.env.OXE_DEVELOPMENT_PARENT_ORIGIN
      ? { developmentParentOrigin: process.env.OXE_DEVELOPMENT_PARENT_ORIGIN }
      : {}),
    jobWorker: {
      onError: (error) =>
        console.error('TinyTodo application job worker failed.', {
          error: error instanceof Error ? error.message : String(error),
        }),
    },
  });
  const server = createServer(async (request, response) => {
    try {
      await writeResponse(
        await application.handle(await fetchRequest(request, allowedOrigins)),
        response,
      );
    } catch (error) {
      const status = error instanceof RangeError ? 413 : 500;
      response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(error instanceof RangeError ? error.message : 'Internal server error.');
      if (status === 500) console.error(error);
    }
  });
  server.listen(port, host, () => {
    process.stdout.write(`TinyTodo is running at ${baseURL}\n`);
    if (allowedOrigins.length > 1)
      process.stdout.write(`Allowed application origins: ${allowedOrigins.join(', ')}\n`);
  });
  let shuttingDown = false;
  const close = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.closeIdleConnections();
    server.close((error) => {
      void application
        .close()
        .then(() => {
          if (error) throw error;
        })
        .catch((shutdownError: unknown) => {
          console.error('TinyTodo shutdown failed.', shutdownError);
          process.exitCode = 1;
        });
    });
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
};

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href)
  void start().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
