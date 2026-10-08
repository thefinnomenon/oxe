import type { ApplicationGraphV1 } from '@oxe/graph';

export type ApplicationWorkerDeploymentV1 = 'embedded' | 'separate';

const header = '/* Generated from the normalized OXE application graph. Do not edit. */';

const graphLoader = `const applicationGraph = loadApplicationGraph(
  JSON.parse(readFileSync(new URL('../application/graph.json', import.meta.url), 'utf8')),
);`;

/** Generates the backend runtime factory imported by a Node HTTP application host. */
export const generateApplicationPostgresServerEntry = (
  workerDeployment: ApplicationWorkerDeploymentV1,
  hasGeneratedCapabilityAdapters = false,
): string => {
  const adapterImport = hasGeneratedCapabilityAdapters
    ? `import { applicationCapabilityAdapters } from './extensions.js';\n`
    : '';
  const embeddedOptions = hasGeneratedCapabilityAdapters
    ? `const configuredOptions = {
    ...options,
    host: {
      ...options.host,
      capabilityAdapters: { ...applicationCapabilityAdapters, ...options.host?.capabilityAdapters },
    },
  };`
    : '';
  const separateHostOptions = hasGeneratedCapabilityAdapters
    ? `const hostOptions = {
    ...options.host,
    capabilityAdapters: { ...applicationCapabilityAdapters, ...options.host?.capabilityAdapters },
  };`
    : '';
  if (workerDeployment === 'embedded')
    return `${header}
import { readFileSync, realpathSync } from 'node:fs';

import { loadApplicationGraph } from '@oxe/graph';
import { createPostgresApplicationServerRuntime } from '@oxe/server-functions/application-postgres';

import { applicationServerFunctionDefinitions } from './functions.js';
${adapterImport}

${graphLoader}

export { applicationGraph };
export const workerDeployment = 'embedded';

export const createApplicationServerRuntime = (pool, options = {}) => {
  ${embeddedOptions}
  const runtime = createPostgresApplicationServerRuntime(
    applicationGraph,
    applicationServerFunctionDefinitions,
    pool,
    ${hasGeneratedCapabilityAdapters ? 'configuredOptions' : 'options'},
  );
  return Object.freeze({ ...runtime, workerDeployment });
};
`;

  return `${header}
import { readFileSync } from 'node:fs';

import { createApplicationTelemetryCollector, loadApplicationGraph } from '@oxe/graph';
import { createPostgresApplicationServerFunctions } from '@oxe/server-functions/application-postgres';

import { applicationServerFunctionDefinitions } from './functions.js';
${adapterImport}

${graphLoader}

export { applicationGraph };
export const workerDeployment = 'separate';

export const createApplicationServerRuntime = (pool, options = {}) => {
  ${separateHostOptions}
  const telemetry = createApplicationTelemetryCollector({
    maximumSpans: options.telemetryMaximumSpans ?? 1000,
  });
  const functions = createPostgresApplicationServerFunctions(
    applicationGraph,
    applicationServerFunctionDefinitions,
    pool,
    { ...${hasGeneratedCapabilityAdapters ? 'hostOptions' : 'options.host'}, telemetry },
  );
  return Object.freeze({
    ...functions,
    close: async () => undefined,
    telemetry,
    workerDeployment,
  });
};
`;
};

/** Generates an independently executable/factory-compatible outbox worker entry. */
export const generateApplicationPostgresWorkerEntry = (
  hasGeneratedCapabilityAdapters = false,
): string => `${header}
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { createPostgresApplicationHost, createNodePostgresPool, createPostgresApplicationJobWorker } from '@oxe/postgres';
import { loadApplicationGraph } from '@oxe/graph';
${
  hasGeneratedCapabilityAdapters
    ? `import { applicationCapabilityAdapters } from './extensions.js';`
    : ''
}

${graphLoader}

export { applicationGraph };

export const createApplicationWorkerRuntime = (pool, options = {}) => {
  const host = createPostgresApplicationHost(applicationGraph, pool, {
    ...options.host,
    ${hasGeneratedCapabilityAdapters ? 'capabilityAdapters: { ...applicationCapabilityAdapters, ...options.host?.capabilityAdapters },' : ''}
  });
  const worker = createPostgresApplicationJobWorker(host, options.worker);
  worker.start();
  return Object.freeze({
    close: () => worker.stop(),
    host,
    worker,
  });
};

const start = async () => {
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL) throw new TypeError('DATABASE_URL is required.');
  const pool = createNodePostgresPool({ connectionString: databaseURL });
  const runtime = createApplicationWorkerRuntime(pool);
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    void runtime.close()
      .then(() => pool.close())
      .catch((error) => {
        console.error('OXE application worker shutdown failed.', error);
        process.exitCode = 1;
      });
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  process.stdout.write('OXE application worker started for ' + applicationGraph.app.id + '.\\n');
};

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href)
  void start().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
`;

const contentTypeEntries: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

/** Generates the executable Node HTTP/auth/migration host around the backend runtime factory. */
export const generateApplicationNodeHostEntry = (graph: ApplicationGraphV1): string => {
  const pagePaths = [
    '/',
    ...graph.routes.map((route) => route.path),
    ...(graph.app.authentication
      ? [graph.app.authentication.signInPath, graph.app.authentication.signUpPath]
      : []),
  ];
  const contentTypes = JSON.stringify(contentTypeEntries);
  return `${header}
import { createServer } from 'node:http';
import { readFileSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createOxeBetterAuth, migrateOxeBetterAuth, readBetterAuthApplicationContext } from '@oxe/auth';
import { applyApplicationPostgresMigration, createNodePostgresPool, listPostgresApplicationContextOptions, resolvePostgresApplicationActiveContexts } from '@oxe/postgres';
import { createNodeHandler } from '@oxe/router';
import { createServerFunctionFetchHandler } from '@oxe/server-functions';
import { createApplicationClientContext, readApplicationActiveContextRequest } from '@oxe/server-functions/auth';
import { Pool } from 'pg';

import { createApplicationServerRuntime, applicationGraph } from './application.js';
import { applicationPostgresMigration } from '../database/migration.js';

const contentTypes = Object.freeze(${contentTypes});
const browserAssetManifest = JSON.parse(readFileSync(new URL('../browser/asset-manifest.json', import.meta.url), 'utf8'));
if (browserAssetManifest?.schemaVersion !== 'oxe.browser-asset-manifest.v1' || !Array.isArray(browserAssetManifest.assets))
  throw new TypeError('Invalid generated browser asset manifest.');
const browserAssets = new Set(browserAssetManifest.assets.map((asset) => {
  if (typeof asset?.path !== 'string' || !/^assets[/][A-Za-z0-9._/-]+$/u.test(asset.path) || asset.path.includes('..'))
    throw new TypeError('Invalid generated browser asset path.');
  return asset.path;
}));
const pagePaths = new Set(${JSON.stringify(pagePaths)});

const exactOrigin = (value, label) => {
  const url = new URL(value);
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new TypeError(label + ' must be an exact HTTP or HTTPS origin.');
  return url.origin;
};

const configuredOrigins = (baseURL, configured = '') => Object.freeze([
  ...new Set([exactOrigin(baseURL, 'BETTER_AUTH_URL'), ...configured.split(',').map((value) => value.trim()).filter(Boolean).map((value) => exactOrigin(value, 'OXE_ALLOWED_ORIGINS entry'))]),
]);

const noStoreJson = (value, init = {}) => Response.json(value, {
  ...init,
  headers: { 'cache-control': 'no-store', ...init.headers },
});

export const createApplicationHttpRuntime = async (options) => {
  const allowedOrigins = configuredOrigins(options.baseURL, options.allowedOrigins?.join(',') ?? '');
  const applicationPool = createNodePostgresPool({ connectionString: options.databaseURL, max: options.applicationPoolSize ?? 8 });
  let authPool;
  let auth;
  try {
    if (applicationGraph.app.authentication) {
      const adminPool = new Pool({ connectionString: options.databaseURL, max: 1 });
      try { await adminPool.query('CREATE SCHEMA IF NOT EXISTS auth'); }
      finally { await adminPool.end(); }
      authPool = new Pool({ connectionString: options.databaseURL, max: 4, options: '-c search_path=auth' });
      auth = createOxeBetterAuth({
        appName: applicationGraph.app.name,
        baseURL: { allowedHosts: allowedOrigins.map((origin) => new URL(origin).host), fallback: options.baseURL, protocol: 'auto' },
        database: authPool,
        secret: options.authSecret,
        trustedOrigins: allowedOrigins,
      });
      await migrateOxeBetterAuth(auth);
    }
    await applyApplicationPostgresMigration(applicationPool, applicationPostgresMigration);
  } catch (error) {
    await applicationPool.close();
    if (authPool) await authPool.end();
    throw error;
  }
  const runtime = createApplicationServerRuntime(applicationPool, {
    host: {
      externalReferenceExists: async ({ entityId, recordId }) => {
        if (!authPool || entityId !== applicationGraph.app.actorEntity) return false;
        const result = await authPool.query('SELECT 1 FROM "user" WHERE "id" = $1', [recordId]);
        return result.rowCount === 1;
      },
    },
    ...(options.worker ? { worker: options.worker } : {}),
  });
  const applicationContext = async (request) => {
    if (!auth) return Object.freeze({});
    return readBetterAuthApplicationContext(
      auth,
      request.headers,
      readApplicationActiveContextRequest(request.headers, applicationGraph.app.contexts ?? []),
      (userId, requested) => resolvePostgresApplicationActiveContexts(applicationGraph, applicationPool, userId, requested),
    );
  };
  const rpc = createServerFunctionFetchHandler(runtime.registry, { allowedOrigins, createContext: applicationContext });
  const handle = async (request) => {
    const url = new URL(request.url);
    if (!allowedOrigins.includes(url.origin)) return new Response('Request origin is not allowed.', { status: 421 });
    if (auth && url.pathname.startsWith('/api/auth/')) return auth.handler(request);
    if (url.pathname === '/api/functions') return rpc(request);
    if (url.pathname === '/api/context') {
      if (request.method !== 'GET') return noStoreJson({ error: 'Application context requires GET.' }, { status: 405, headers: { allow: 'GET' } });
      try {
        const context = await applicationContext(request);
        if (!context.userId) return noStoreJson({ error: 'Authentication is required.' }, { status: 401 });
        return noStoreJson(createApplicationClientContext(context));
      } catch (error) {
        return noStoreJson({ error: error instanceof Error ? error.message : 'Invalid context.' }, { status: 400 });
      }
    }
    if (url.pathname === '/api/context-options') {
      if (request.method !== 'GET') return noStoreJson({ error: 'Application context options require GET.' }, { status: 405, headers: { allow: 'GET' } });
      const contextId = url.searchParams.get('contextId');
      if (!contextId) return noStoreJson({ error: 'contextId is required.' }, { status: 400 });
      const context = await applicationContext(request);
      if (!context.userId) return noStoreJson({ error: 'Authentication is required.' }, { status: 401 });
      try { return noStoreJson(await listPostgresApplicationContextOptions(applicationGraph, applicationPool, context.userId, contextId)); }
      catch (error) { return noStoreJson({ error: error instanceof Error ? error.message : 'Invalid context.' }, { status: 400 }); }
    }
    if (url.pathname === '/health') return noStoreJson({ appId: applicationGraph.app.id, revision: applicationGraph.revision, status: 'ok' });
    const artifact = url.pathname.slice(1);
    if (browserAssets.has(artifact)) {
      const extension = extname(artifact);
      return new Response(await readFile(new URL('../browser/' + artifact, import.meta.url)), {
        headers: { 'cache-control': 'public, max-age=31536000, immutable', 'content-type': contentTypes[extension] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff' },
      });
    }
    if (pagePaths.has(url.pathname))
      return new Response(await readFile(new URL('../browser/index.html', import.meta.url)), {
        headers: {
          'cache-control': 'no-store',
          'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
          'content-type': 'text/html; charset=utf-8',
          'referrer-policy': 'no-referrer',
          'x-content-type-options': 'nosniff',
        },
      });
    return new Response('Not found.', { status: 404 });
  };
  let closing;
  return Object.freeze({
    allowedOrigins,
    applicationGraph,
    close: () => closing ??= (async () => { await runtime.close(); await applicationPool.close(); if (authPool) await authPool.end(); })(),
    handle,
  });
};

const start = async () => {
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError('PORT must be an integer between 1 and 65535.');
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL) throw new TypeError('DATABASE_URL is required.');
  const baseURL = exactOrigin(process.env.BETTER_AUTH_URL ?? 'http://' + host + ':' + port, 'BETTER_AUTH_URL');
  const configuredSecret = process.env.BETTER_AUTH_SECRET;
  if (applicationGraph.app.authentication && !configuredSecret && process.env.NODE_ENV === 'production')
    throw new TypeError('BETTER_AUTH_SECRET is required in production.');
  const application = await createApplicationHttpRuntime({
    allowedOrigins: (process.env.OXE_ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean),
    authSecret: configuredSecret ?? 'local-development-only-secret-change-before-deploying',
    baseURL,
    databaseURL,
    worker: { onError: (error) => console.error('OXE application worker failed.', error instanceof Error ? error.message : String(error)) },
  });
  const origin = (request) => {
    const requestHost = request.headers.host?.toLowerCase();
    const match = application.allowedOrigins.find((candidate) => new URL(candidate).host.toLowerCase() === requestHost);
    if (!match) throw new TypeError('Request Host header is not allowed.');
    return match;
  };
  const nodeHandler = createNodeHandler(application.handle, { origin });
  const server = createServer((request, response) => void nodeHandler(request, response));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  process.stdout.write(applicationGraph.app.name + ' is running at ' + baseURL + '\\n');
  let shuttingDown = false;
  const close = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.closeIdleConnections();
    server.close((error) => void application.close().then(() => { if (error) throw error; }).catch((shutdownError) => { console.error('OXE application shutdown failed.', shutdownError); process.exitCode = 1; }));
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
};

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href)
  void start().catch((error) => { console.error(error); process.exitCode = 1; });
`;
};
