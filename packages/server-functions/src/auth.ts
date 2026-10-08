import type {
  ApplicationContextSelectionV1,
  ApplicationExecutionContextEntryV1,
  ApplicationExecutionContextV1,
} from '@oxe/graph';

export const APPLICATION_ACTIVE_CONTEXT_HEADER = 'x-oxe-active-contexts' as const;
export const APPLICATION_CLIENT_CONTEXT_SCHEMA = 'oxe.application-client-context.v1' as const;

export interface ApplicationClientContextV1 {
  readonly activeContexts: readonly ApplicationExecutionContextEntryV1[];
  readonly schemaVersion: typeof APPLICATION_CLIENT_CONTEXT_SCHEMA;
  readonly userId: string;
}

/** Minimal stable shape read from Better Auth's server-side getSession result. */
export interface BetterAuthSessionContextV1 {
  readonly session: { readonly id: string };
  readonly user: { readonly id: string };
}

export type ResolveApplicationActiveContextsV1 = (
  userId: string,
  requested: readonly ApplicationContextSelectionV1[],
) => Promise<readonly ApplicationExecutionContextEntryV1[]>;

const stableIdPattern = /^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$/u;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Parses an untrusted per-request context selection before server-side membership resolution. */
export const readApplicationActiveContextRequest = (
  headers: Headers,
  allowedContextIds: readonly string[],
): readonly ApplicationContextSelectionV1[] => {
  const encoded = headers.get(APPLICATION_ACTIVE_CONTEXT_HEADER);
  if (encoded === null) return Object.freeze([]);
  if (new TextEncoder().encode(encoded).byteLength > 8_192)
    throw new TypeError('Active-context selection exceeds 8192 UTF-8 bytes.');
  let value: unknown;
  try {
    value = JSON.parse(encoded) as unknown;
  } catch {
    throw new TypeError('Active-context selection must be valid JSON.');
  }
  if (!Array.isArray(value)) throw new TypeError('Active-context selection must be an array.');
  if (value.length > 16) throw new TypeError('Active-context selection cannot exceed 16 entries.');
  const allowed = new Set(allowedContextIds);
  const seen = new Set<string>();
  const entries = value.map((entry, index): ApplicationContextSelectionV1 => {
    if (!isRecord(entry)) throw new TypeError(`Active-context entry ${index} must be an object.`);
    const keys = Object.keys(entry).sort();
    if (keys.length !== 2 || keys[0] !== 'contextId' || keys[1] !== 'recordId')
      throw new TypeError(
        `Active-context entry ${index} must contain exactly contextId and recordId.`,
      );
    const { contextId, recordId } = entry;
    if (typeof contextId !== 'string' || !stableIdPattern.test(contextId))
      throw new TypeError(`Active-context entry ${index} has an invalid semantic context id.`);
    if (!allowed.has(contextId))
      throw new TypeError(`Active-context role "${contextId}" is not declared by the application.`);
    if (seen.has(contextId))
      throw new TypeError(`Active-context role "${contextId}" is selected more than once.`);
    if (typeof recordId !== 'string' || recordId.length === 0 || recordId.length > 1_024)
      throw new TypeError(`Active-context entry ${index} has an invalid record id.`);
    seen.add(contextId);
    return Object.freeze({ contextId, recordId });
  });
  return Object.freeze(entries);
};

/** Removes server-only session identity before exposing verified context to a browser client. */
export const createApplicationClientContext = (
  context: ApplicationExecutionContextV1,
): ApplicationClientContextV1 => {
  if (!context.userId) throw new TypeError('Authentication is required.');
  return Object.freeze({
    activeContexts: Object.freeze([...(context.activeContexts ?? [])]),
    schemaVersion: APPLICATION_CLIENT_CONTEXT_SCHEMA,
    userId: context.userId,
  });
};

/**
 * Converts a verified Better Auth session plus a per-request context selection into OXE context.
 * The resolver must reload membership/hierarchy server-side; requested ids are never trusted.
 */
export const createBetterAuthApplicationContext = async (
  session: BetterAuthSessionContextV1 | null | undefined,
  requested: readonly ApplicationContextSelectionV1[] = [],
  resolveActiveContexts?: ResolveApplicationActiveContextsV1,
): Promise<ApplicationExecutionContextV1> => {
  if (!session) return Object.freeze({});
  if (requested.length > 0 && !resolveActiveContexts)
    throw new TypeError('Active-context selection requires a server-side resolver.');
  const activeContexts = resolveActiveContexts
    ? await resolveActiveContexts(session.user.id, requested)
    : [];
  return Object.freeze({
    ...(activeContexts.length === 0 ? {} : { activeContexts: Object.freeze([...activeContexts]) }),
    sessionId: session.session.id,
    userId: session.user.id,
  });
};
