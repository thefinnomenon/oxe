/* Generated OXE application browser runtime. Do not edit. */
export type ApplicationValueSchemaV1 =
  | { readonly kind: 'array'; readonly items: ApplicationValueSchemaV1 }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'null' }
  | { readonly kind: 'number' }
  | { readonly fields: readonly { readonly name: string; readonly schema: ApplicationValueSchemaV1 }[]; readonly kind: 'record' }
  | { readonly enum?: readonly string[]; readonly kind: 'string' }
  | { readonly kind: 'union'; readonly variants: readonly ApplicationValueSchemaV1[] };
export interface ApplicationRuntimeFunctionV1 {
  readonly cacheMaxAgeMs: number | null;
  readonly id: string;
  readonly invalidates: readonly string[];
  readonly mode: 'mutation' | 'query';
  readonly returns: number;
  readonly semanticId: string;
}
export interface ApplicationRuntimeManifestV1 {
  readonly cache: { readonly defaultMaxAgeMs: number };
  readonly functions: readonly ApplicationRuntimeFunctionV1[];
  readonly schemas: readonly ApplicationValueSchemaV1[];
}
export interface ApplicationClientCallOptionsV1 { readonly signal?: AbortSignal; }
export type ApplicationMutationOptionsV1 = ApplicationClientCallOptionsV1;
export interface ApplicationQueryOptionsV1 extends ApplicationClientCallOptionsV1 {
  readonly maxAgeMs?: number;
  readonly refresh?: boolean;
}
export interface ApplicationActiveContextV1 {
  readonly contextId: string;
  readonly entityId: string;
  readonly recordId: string;
}
export interface ApplicationContextSelectionV1 {
  readonly contextId: string;
  readonly recordId: string;
}
export interface ApplicationClientContextV1 {
  readonly activeContexts: readonly ApplicationActiveContextV1[];
  readonly schemaVersion: 'oxe.application-client-context.v1';
  readonly userId: string;
}
export interface ApplicationClientOptionsV1 {
  readonly context: ApplicationClientContextV1;
  readonly defaultMaxAgeMs?: number;
  readonly endpoint?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
}
export interface ApplicationClientBootstrapOptionsV1 {
  readonly contextEndpoint?: string;
  readonly defaultMaxAgeMs?: number;
  readonly endpoint?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly requestedContexts?: readonly ApplicationContextSelectionV1[];
}
export interface ApplicationClientCacheSnapshotV1 {
  readonly entries: number;
  readonly hits: number;
  readonly misses: number;
  readonly pending: number;
}
export interface ApplicationClientRuntimeV1 {
  clearCache(): void;
  inspectCache(): ApplicationClientCacheSnapshotV1;
  mutate<Value>(functionId: string, arguments_: readonly unknown[], options?: ApplicationMutationOptionsV1): Promise<Value>;
  query<Value>(functionId: string, arguments_: readonly unknown[], options?: ApplicationQueryOptionsV1): Promise<Value>;
}
export class ApplicationClientError extends Error {
  public constructor(public readonly kind: string, message: string, public readonly status: number) {
    super(message);
    this.name = 'ApplicationClientError';
  }
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean =>
  Object.keys(value).length === expected.length && expected.every((name) => Object.hasOwn(value, name));
const readContextEntry = (value: unknown, path: string): ApplicationActiveContextV1 => {
  if (!isRecord(value) || !exactKeys(value, ['contextId', 'entityId', 'recordId']))
    throw new TypeError(`Invalid active context at ${path}.`);
  if (typeof value.contextId !== 'string' || typeof value.entityId !== 'string' || typeof value.recordId !== 'string' || value.recordId.length === 0)
    throw new TypeError(`Invalid active context identity at ${path}.`);
  return Object.freeze({ contextId: value.contextId, entityId: value.entityId, recordId: value.recordId });
};
const readApplicationClientContext = (value: unknown): ApplicationClientContextV1 => {
  if (!isRecord(value) || !exactKeys(value, ['activeContexts', 'schemaVersion', 'userId']))
    throw new TypeError('Server returned an invalid application client context.');
  if (value.schemaVersion !== 'oxe.application-client-context.v1' || typeof value.userId !== 'string' || value.userId.length === 0 || !Array.isArray(value.activeContexts))
    throw new TypeError('Server returned an invalid application client context.');
  const activeContexts = value.activeContexts.map((entry, index) => readContextEntry(entry, `$.activeContexts[${index}]`));
  if (new Set(activeContexts.map((entry) => entry.contextId)).size !== activeContexts.length)
    throw new TypeError('Server returned duplicate active context roles.');
  return Object.freeze({ activeContexts: Object.freeze(activeContexts), schemaVersion: value.schemaVersion, userId: value.userId });
};
const readValue = (schema: ApplicationValueSchemaV1, value: unknown, path: string): unknown => {
  if (schema.kind === 'boolean') {
    if (typeof value !== 'boolean') throw new TypeError(`Invalid boolean at ${path}.`);
    return value;
  }
  if (schema.kind === 'null') {
    if (value !== null) throw new TypeError(`Invalid null at ${path}.`);
    return null;
  }
  if (schema.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Invalid number at ${path}.`);
    return value;
  }
  if (schema.kind === 'string') {
    if (typeof value !== 'string' || (schema.enum && !schema.enum.includes(value))) throw new TypeError(`Invalid string at ${path}.`);
    return value;
  }
  if (schema.kind === 'array') {
    if (!Array.isArray(value)) throw new TypeError(`Invalid array at ${path}.`);
    return value.map((item, index) => readValue(schema.items, item, `${path}[${index}]`));
  }
  if (schema.kind === 'union') {
    for (const variant of schema.variants) {
      try { return readValue(variant, value, path); } catch { /* try the next exact variant */ }
    }
    throw new TypeError(`Invalid union value at ${path}.`);
  }
  if (!isRecord(value)) throw new TypeError(`Invalid record at ${path}.`);
  if (Object.keys(value).length !== schema.fields.length || schema.fields.some((field) => !Object.hasOwn(value, field.name)))
    throw new TypeError(`Invalid record fields at ${path}.`);
  return Object.fromEntries(schema.fields.map((field) => [field.name, readValue(field.schema, value[field.name], `${path}.${field.name}`)]));
};
export const createApplicationClientRuntime = (
  manifest: ApplicationRuntimeManifestV1,
  options: ApplicationClientOptionsV1,
): ApplicationClientRuntimeV1 => {
  const context = readApplicationClientContext(options.context);
  const byId = new Map(manifest.functions.map((definition) => [definition.id, definition]));
  const scopeKey = JSON.stringify([context.userId, context.activeContexts.map(({ contextId, entityId, recordId }) => [contextId, entityId, recordId])]);
  const activeContextHeader = context.activeContexts.length === 0 ? undefined : JSON.stringify(context.activeContexts.map(({ contextId, recordId }) => ({ contextId, recordId })));
  const endpoint = options.endpoint ?? '/api/functions';
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const defaultMaxAgeMs = options.defaultMaxAgeMs ?? manifest.cache.defaultMaxAgeMs;
  const cache = new Map<string, { readonly semanticId: string; readonly storedAt: number; readonly value: unknown }>();
  const pending = new Map<string, { readonly promise: Promise<unknown>; readonly semanticId: string }>();
  const generations = new Map<string, number>();
  const keyGenerations = new Map<string, number>();
  let hits = 0;
  let misses = 0;
  const keyFor = (functionId: string, arguments_: readonly unknown[]): string => `${scopeKey}\u0000${functionId}\u0000${JSON.stringify(arguments_)}`;
  const invoke = async <Value>(functionId: string, arguments_: readonly unknown[], callOptions?: ApplicationClientCallOptionsV1): Promise<Value> => {
    const definition = byId.get(functionId);
    if (!definition) throw new TypeError(`Unknown generated application function "${functionId}".`);
    const response = await fetchImplementation(endpoint, {
      body: JSON.stringify({ arguments: arguments_, functionId, schemaVersion: 'oxe.server-function-request.v1' }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-oxe-server-function': '1', ...(activeContextHeader ? { 'x-oxe-active-contexts': activeContextHeader } : {}) },
      method: 'POST',
      ...(callOptions?.signal ? { signal: callOptions.signal } : {}),
    });
    const value: unknown = await response.json();
    if (!isRecord(value) || value.schemaVersion !== 'oxe.server-function-response.v1') throw new TypeError('Server returned an invalid application response.');
    if (value.ok === false) {
      const error = value.error;
      if (!isRecord(error) || typeof error.kind !== 'string' || typeof error.message !== 'string' || typeof error.status !== 'number') throw new TypeError('Server returned an invalid application error.');
      throw new ApplicationClientError(error.kind, error.message, error.status);
    }
    if (value.ok !== true || value.functionId !== functionId) throw new TypeError('Application response did not match the request.');
    const schema = manifest.schemas[definition.returns];
    if (!schema) throw new TypeError('Generated application function has no result schema.');
    return readValue(schema, value.value, '$.value') as Value;
  };
  const query = async <Value>(functionId: string, arguments_: readonly unknown[], queryOptions: ApplicationQueryOptionsV1 = {}): Promise<Value> => {
    const key = keyFor(functionId, arguments_);
    const definition = byId.get(functionId);
    if (!definition || definition.mode !== 'query') throw new TypeError(`Generated application function "${functionId}" is not a query.`);
    const maximumAge = Math.min(definition.cacheMaxAgeMs ?? 0, queryOptions.maxAgeMs ?? defaultMaxAgeMs);
    const cached = cache.get(key);
    if (maximumAge > 0 && !queryOptions.refresh && cached && now() - cached.storedAt <= maximumAge) {
      hits += 1;
      return cached.value as Value;
    }
    if (!queryOptions.refresh && !queryOptions.signal) {
      const existing = pending.get(key);
      if (existing) {
        hits += 1;
        return existing.promise as Promise<Value>;
      }
    }
    misses += 1;
    const generation = generations.get(definition.semanticId) ?? 0;
    const keyGeneration = (keyGenerations.get(key) ?? 0) + 1;
    keyGenerations.set(key, keyGeneration);
    const request = invoke<Value>(functionId, arguments_, queryOptions).then((value) => {
      if (maximumAge > 0 && (generations.get(definition.semanticId) ?? 0) === generation && keyGenerations.get(key) === keyGeneration) cache.set(key, { semanticId: definition.semanticId, storedAt: now(), value });
      return value;
    });
    if (!queryOptions.signal) {
      pending.set(key, { promise: request, semanticId: definition.semanticId });
      void request.then(() => { if (pending.get(key)?.promise === request) pending.delete(key); }, () => { if (pending.get(key)?.promise === request) pending.delete(key); });
    }
    return request;
  };
  const mutate = async <Value>(functionId: string, arguments_: readonly unknown[], mutationOptions: ApplicationMutationOptionsV1 = {}): Promise<Value> => {
    const definition = byId.get(functionId);
    if (!definition || definition.mode !== 'mutation') throw new TypeError(`Generated application function "${functionId}" is not a mutation.`);
    const result = await invoke<Value>(functionId, arguments_, mutationOptions);
    const invalidated = new Set(definition.invalidates);
    for (const semanticId of invalidated) generations.set(semanticId, (generations.get(semanticId) ?? 0) + 1);
    for (const [key, entry] of cache) if (invalidated.has(entry.semanticId)) cache.delete(key);
    for (const [key, entry] of pending) if (invalidated.has(entry.semanticId)) pending.delete(key);
    return result;
  };
  return Object.freeze({
    clearCache: () => {
      for (const definition of manifest.functions) if (definition.mode === 'query') generations.set(definition.semanticId, (generations.get(definition.semanticId) ?? 0) + 1);
      for (const key of new Set([...cache.keys(), ...pending.keys()])) keyGenerations.set(key, (keyGenerations.get(key) ?? 0) + 1);
      cache.clear();
      pending.clear();
    },
    inspectCache: () => Object.freeze({ entries: cache.size, hits, misses, pending: pending.size }),
    mutate,
    query,
  });
};
export const bootstrapApplicationClientContext = async (options: ApplicationClientBootstrapOptionsV1 = {}): Promise<ApplicationClientContextV1> => {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const requestedContexts = options.requestedContexts ?? [];
  const response = await fetchImplementation(options.contextEndpoint ?? '/api/context', {
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...(requestedContexts.length === 0 ? {} : { 'x-oxe-active-contexts': JSON.stringify(requestedContexts) }) },
    method: 'GET',
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const message = isRecord(value) && typeof value.error === 'string' ? value.error : 'Could not resolve application context.';
    throw new ApplicationClientError(response.status === 401 ? 'unauthorized' : 'context', message, response.status);
  }
  return readApplicationClientContext(value);
};

const manifest = {"cache":{"defaultMaxAgeMs":30000},"functions":[{"cacheMaxAgeMs":null,"id":"app.todo/operation.acceptTeamInvitation","invalidates":["query.myTeamInvitations","query.teamInvitations"],"mode":"mutation","returns":0,"semanticId":"operation.acceptTeamInvitation"},{"cacheMaxAgeMs":null,"id":"app.todo/operation.createTask","invalidates":["query.myTasks"],"mode":"mutation","returns":1,"semanticId":"operation.createTask"},{"cacheMaxAgeMs":null,"id":"app.todo/operation.createTeam","invalidates":[],"mode":"mutation","returns":2,"semanticId":"operation.createTeam"},{"cacheMaxAgeMs":null,"id":"app.todo/operation.deleteTask","invalidates":["query.myTasks"],"mode":"mutation","returns":1,"semanticId":"operation.deleteTask"},{"cacheMaxAgeMs":null,"id":"app.todo/operation.inviteTeamMember","invalidates":["query.myTeamInvitations","query.teamInvitations"],"mode":"mutation","returns":0,"semanticId":"operation.inviteTeamMember"},{"cacheMaxAgeMs":null,"id":"app.todo/operation.renameTask","invalidates":["query.myTasks"],"mode":"mutation","returns":1,"semanticId":"operation.renameTask"},{"cacheMaxAgeMs":null,"id":"app.todo/operation.revokeTeamInvitation","invalidates":["query.myTeamInvitations","query.teamInvitations"],"mode":"mutation","returns":0,"semanticId":"operation.revokeTeamInvitation"},{"cacheMaxAgeMs":null,"id":"app.todo/operation.toggleTask","invalidates":["query.myTasks"],"mode":"mutation","returns":1,"semanticId":"operation.toggleTask"},{"cacheMaxAgeMs":30000,"id":"app.todo/query.myTasks","invalidates":[],"mode":"query","returns":3,"semanticId":"query.myTasks"},{"cacheMaxAgeMs":5000,"id":"app.todo/query.myTeamInvitations","invalidates":[],"mode":"query","returns":4,"semanticId":"query.myTeamInvitations"},{"cacheMaxAgeMs":5000,"id":"app.todo/query.teamInvitations","invalidates":[],"mode":"query","returns":4,"semanticId":"query.teamInvitations"}],"schemas":[{"fields":[{"name":"accepted","schema":{"kind":"boolean"}},{"name":"createdAt","schema":{"kind":"string"}},{"name":"id","schema":{"kind":"string"}},{"name":"role","schema":{"enum":["member"],"kind":"string"}},{"name":"status","schema":{"enum":["active"],"kind":"string"}},{"name":"userId","schema":{"kind":"string"}}],"kind":"record"},{"fields":[{"name":"createdAt","schema":{"kind":"string"}},{"name":"done","schema":{"kind":"boolean"}},{"name":"id","schema":{"kind":"string"}},{"name":"title","schema":{"kind":"string","maximumLength":120,"minimumLength":1}}],"kind":"record"},{"fields":[{"name":"createdAt","schema":{"kind":"string"}},{"name":"id","schema":{"kind":"string"}},{"name":"name","schema":{"kind":"string","maximumLength":80,"minimumLength":1}}],"kind":"record"},{"items":{"fields":[{"name":"createdAt","schema":{"kind":"string"}},{"name":"done","schema":{"kind":"boolean"}},{"name":"id","schema":{"kind":"string"}},{"name":"title","schema":{"kind":"string","maximumLength":120,"minimumLength":1}}],"kind":"record"},"kind":"array"},{"items":{"fields":[{"name":"accepted","schema":{"kind":"boolean"}},{"name":"createdAt","schema":{"kind":"string"}},{"name":"id","schema":{"kind":"string"}},{"name":"role","schema":{"enum":["member"],"kind":"string"}},{"name":"status","schema":{"enum":["active"],"kind":"string"}},{"name":"userId","schema":{"kind":"string"}}],"kind":"record"},"kind":"array"}]} as const;
export interface ApplicationClientV1 {
  readonly "acceptTeamInvitation": (invitation: { readonly "accepted": boolean; readonly "createdAt": string; readonly "id": string; readonly "role": "member"; readonly "status": "active"; readonly "userId": string; }, options?: ApplicationMutationOptionsV1) => Promise<{ readonly "accepted": boolean; readonly "createdAt": string; readonly "id": string; readonly "role": "member"; readonly "status": "active"; readonly "userId": string; }>;
  readonly "createTask": (title: string, options?: ApplicationMutationOptionsV1) => Promise<{ readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }>;
  readonly "createTeam": (name: string, options?: ApplicationMutationOptionsV1) => Promise<{ readonly "createdAt": string; readonly "id": string; readonly "name": string; }>;
  readonly "deleteTask": (task: { readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }, options?: ApplicationMutationOptionsV1) => Promise<{ readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }>;
  readonly "inviteTeamMember": (userId: string, options?: ApplicationMutationOptionsV1) => Promise<{ readonly "accepted": boolean; readonly "createdAt": string; readonly "id": string; readonly "role": "member"; readonly "status": "active"; readonly "userId": string; }>;
  readonly "renameTask": (task: { readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }, title: string, options?: ApplicationMutationOptionsV1) => Promise<{ readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }>;
  readonly "revokeTeamInvitation": (invitation: { readonly "accepted": boolean; readonly "createdAt": string; readonly "id": string; readonly "role": "member"; readonly "status": "active"; readonly "userId": string; }, options?: ApplicationMutationOptionsV1) => Promise<{ readonly "accepted": boolean; readonly "createdAt": string; readonly "id": string; readonly "role": "member"; readonly "status": "active"; readonly "userId": string; }>;
  readonly "toggleTask": (task: { readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }, options?: ApplicationMutationOptionsV1) => Promise<{ readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }>;
  readonly "myTasks": (options?: ApplicationQueryOptionsV1) => Promise<readonly { readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }[]>;
  readonly "myTeamInvitations": (options?: ApplicationQueryOptionsV1) => Promise<readonly { readonly "accepted": boolean; readonly "createdAt": string; readonly "id": string; readonly "role": "member"; readonly "status": "active"; readonly "userId": string; }[]>;
  readonly "teamInvitations": (options?: ApplicationQueryOptionsV1) => Promise<readonly { readonly "accepted": boolean; readonly "createdAt": string; readonly "id": string; readonly "role": "member"; readonly "status": "active"; readonly "userId": string; }[]>;
  clearCache(): void;
  inspectCache(): ApplicationClientCacheSnapshotV1;
}
export const createApplicationClient = (options: ApplicationClientOptionsV1): ApplicationClientV1 => {
  const { clearCache, inspectCache, mutate, query } = createApplicationClientRuntime(manifest, options);
  return Object.freeze({
    "acceptTeamInvitation": (invitation: { readonly "accepted": boolean; readonly "createdAt": string; readonly "id": string; readonly "role": "member"; readonly "status": "active"; readonly "userId": string; }, options?: ApplicationMutationOptionsV1) => mutate<{ readonly "accepted": boolean; readonly "createdAt": string; readonly "id": string; readonly "role": "member"; readonly "status": "active"; readonly "userId": string; }>("app.todo/operation.acceptTeamInvitation", [invitation], options),
    "createTask": (title: string, options?: ApplicationMutationOptionsV1) => mutate<{ readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }>("app.todo/operation.createTask", [title], options),
    "createTeam": (name: string, options?: ApplicationMutationOptionsV1) => mutate<{ readonly "createdAt": string; readonly "id": string; readonly "name": string; }>("app.todo/operation.createTeam", [name], options),
    "deleteTask": (task: { readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }, options?: ApplicationMutationOptionsV1) => mutate<{ readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }>("app.todo/operation.deleteTask", [task], options),
    "inviteTeamMember": (userId: string, options?: ApplicationMutationOptionsV1) => mutate<{ readonly "accepted": boolean; readonly "createdAt": string; readonly "id": string; readonly "role": "member"; readonly "status": "active"; readonly "userId": string; }>("app.todo/operation.inviteTeamMember", [userId], options),
    "renameTask": (task: { readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }, title: string, options?: ApplicationMutationOptionsV1) => mutate<{ readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }>("app.todo/operation.renameTask", [task, title], options),
    "revokeTeamInvitation": (invitation: { readonly "accepted": boolean; readonly "createdAt": string; readonly "id": string; readonly "role": "member"; readonly "status": "active"; readonly "userId": string; }, options?: ApplicationMutationOptionsV1) => mutate<{ readonly "accepted": boolean; readonly "createdAt": string; readonly "id": string; readonly "role": "member"; readonly "status": "active"; readonly "userId": string; }>("app.todo/operation.revokeTeamInvitation", [invitation], options),
    "toggleTask": (task: { readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }, options?: ApplicationMutationOptionsV1) => mutate<{ readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }>("app.todo/operation.toggleTask", [task], options),
    "myTasks": (options?: ApplicationQueryOptionsV1) => query<readonly { readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }[]>("app.todo/query.myTasks", [], options),
    "myTeamInvitations": (options?: ApplicationQueryOptionsV1) => query<readonly { readonly "accepted": boolean; readonly "createdAt": string; readonly "id": string; readonly "role": "member"; readonly "status": "active"; readonly "userId": string; }[]>("app.todo/query.myTeamInvitations", [], options),
    "teamInvitations": (options?: ApplicationQueryOptionsV1) => query<readonly { readonly "accepted": boolean; readonly "createdAt": string; readonly "id": string; readonly "role": "member"; readonly "status": "active"; readonly "userId": string; }[]>("app.todo/query.teamInvitations", [], options),
    clearCache,
    inspectCache,
  });
};
export const bootstrapApplicationClient = async (options: ApplicationClientBootstrapOptionsV1 = {}): Promise<ApplicationClientV1> =>
  createApplicationClient({ ...options, context: await bootstrapApplicationClientContext(options) });
