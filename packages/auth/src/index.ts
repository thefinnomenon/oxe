import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import type { Pool } from 'pg';

import type { ApplicationContextSelectionV1, ApplicationExecutionContextV1 } from '@oxe/graph';
import {
  createBetterAuthApplicationContext,
  type ResolveApplicationActiveContextsV1,
} from '@oxe/server-functions/auth';

export interface OxeBetterAuthOptionsV1 {
  readonly appName?: string;
  readonly basePath?: string;
  readonly baseURL: OxeBetterAuthBaseURLV1;
  readonly database: Pool;
  readonly secret: string;
  readonly trustedOrigins?: readonly string[];
}

export type OxeBetterAuthBaseURLV1 =
  | string
  | {
      /** Exact hosts, including an optional port. Wildcards are intentionally unsupported. */
      readonly allowedHosts: readonly string[];
      readonly fallback?: string;
      readonly protocol?: 'auto' | 'http' | 'https';
    };

const validateOrigin = (value: string, label: string): URL => {
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
  return url;
};

const validateHost = (value: string): void => {
  if (!value || value.includes('*') || value.includes('?') || /[/#@]/u.test(value))
    throw new TypeError('Better Auth allowed hosts must be exact host[:port] values.');
  const parsed = new URL(`http://${value}`);
  if (parsed.host !== value.toLowerCase())
    throw new TypeError('Better Auth allowed hosts must be exact host[:port] values.');
};

export const validateOxeBetterAuthOptions = (options: OxeBetterAuthOptionsV1): void => {
  if (options.secret.length < 32)
    throw new TypeError('Better Auth requires a secret containing at least 32 characters.');
  if (typeof options.baseURL === 'string') validateOrigin(options.baseURL, 'Better Auth baseURL');
  else {
    if (options.baseURL.allowedHosts.length === 0)
      throw new TypeError('Better Auth requires at least one allowed host.');
    for (const host of options.baseURL.allowedHosts) validateHost(host);
    if (
      new Set(options.baseURL.allowedHosts.map((host) => host.toLowerCase())).size !==
      options.baseURL.allowedHosts.length
    )
      throw new TypeError('Better Auth allowed hosts must be unique.');
    if (options.baseURL.fallback)
      validateOrigin(options.baseURL.fallback, 'Better Auth fallback URL');
  }
  for (const origin of options.trustedOrigins ?? [])
    validateOrigin(origin, 'Better Auth trusted origin');
};

/** Node/PostgreSQL Better Auth configuration selected for OXE applications. */
export const createOxeBetterAuth = (options: OxeBetterAuthOptionsV1) => {
  validateOxeBetterAuthOptions(options);
  return betterAuth({
    advanced: { database: { joins: true }, trustedProxyHeaders: false },
    appName: options.appName ?? 'OXE application',
    basePath: options.basePath ?? '/api/auth',
    baseURL:
      typeof options.baseURL === 'string'
        ? options.baseURL
        : {
            allowedHosts: [...options.baseURL.allowedHosts],
            ...(options.baseURL.fallback ? { fallback: options.baseURL.fallback } : {}),
            ...(options.baseURL.protocol ? { protocol: options.baseURL.protocol } : {}),
          },
    database: options.database,
    emailAndPassword: { enabled: true },
    secret: options.secret,
    ...(options.trustedOrigins ? { trustedOrigins: [...options.trustedOrigins] } : {}),
  });
};

export type OxeBetterAuthV1 = ReturnType<typeof createOxeBetterAuth>;

export interface OxeBetterAuthMigrationResultV1 {
  readonly added: number;
  readonly created: number;
}

/** Applies Better Auth's provider-owned schema. OXE application migrations stay separate. */
export const migrateOxeBetterAuth = async (
  auth: OxeBetterAuthV1,
): Promise<OxeBetterAuthMigrationResultV1> => {
  const migrations = await getMigrations(auth.options);
  const result = {
    added: migrations.toBeAdded.length,
    created: migrations.toBeCreated.length,
  };
  await migrations.runMigrations();
  return Object.freeze(result);
};

/** Resolves a cookie session on the server; anonymous requests produce an empty context. */
export const readBetterAuthApplicationContext = async (
  auth: OxeBetterAuthV1,
  headers: Headers,
  requested: readonly ApplicationContextSelectionV1[] = [],
  resolveActiveContexts?: ResolveApplicationActiveContextsV1,
): Promise<ApplicationExecutionContextV1> => {
  const session = await auth.api.getSession({ headers });
  return createBetterAuthApplicationContext(session, requested, resolveActiveContexts);
};
