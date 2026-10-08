import {
  ApplicationGraphValidationError,
  canonicalizeApplicationGraph,
  validateApplicationGraph,
  type ApplicationGraphV1,
  type ApplicationSkeletonElementHintV1,
  type ApplicationViewElementV1,
  type ApplicationViewModeV1,
  type ServerValueSchemaV1,
  type UiServerFunctionDefinitionV1,
} from '@oxe/graph';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

export interface ApplicationClientCachePolicyV1 {
  readonly defaultMaxAgeMs: number;
  readonly scope: 'user-and-active-context';
  readonly strategy: 'memory';
}

export interface ApplicationClientFunctionV1 {
  /** Null disables persistent browser caching while retaining in-flight deduplication. */
  readonly cacheMaxAgeMs: number | null;
  readonly id: string;
  readonly invalidates: readonly string[];
  readonly mode: 'mutation' | 'query';
  readonly name: string;
  readonly parameters: UiServerFunctionDefinitionV1['parameters'];
  readonly path: readonly string[];
  readonly reads: readonly string[];
  readonly returns: UiServerFunctionDefinitionV1['returns'];
  readonly semanticId: string;
}

export interface ApplicationClientManifestV1 {
  readonly appId: string;
  readonly cache: ApplicationClientCachePolicyV1;
  readonly functions: readonly ApplicationClientFunctionV1[];
  readonly revision: number;
  readonly schemaVersion: 'oxe.application-client-manifest.v1';
}

export type ApplicationSkeletonNodeV1 =
  | {
      readonly children: readonly ApplicationSkeletonNodeV1[];
      readonly component: string;
      readonly kind: 'component';
      readonly shape?: ApplicationSkeletonElementHintV1['shape'];
      readonly width?: ApplicationSkeletonElementHintV1['width'];
    }
  | {
      readonly kind: 'collection';
      readonly rows: number;
      readonly template: ApplicationSkeletonNodeV1;
    };

export interface ApplicationLoadingCollectionV1 {
  readonly elementId: string;
  readonly rows: number;
  readonly template: ApplicationSkeletonNodeV1;
}

export interface ApplicationLoadingProjectionV1 {
  readonly collections: readonly ApplicationLoadingCollectionV1[];
  readonly schemaVersion: 'oxe.application-loading-projection.v1';
  readonly strategy: 'preserveStaticStructure';
  readonly viewId: string;
}

export interface ApplicationBrowserClientProjectionV1 {
  readonly declarationSource: string;
  readonly manifest: ApplicationClientManifestV1;
  readonly moduleSource: string;
}

export interface ApplicationBrowserClientFacetProjectionV1 extends ApplicationBrowserClientProjectionV1 {
  readonly runtimeImport: string;
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const validatedGraph = (input: ApplicationGraphV1): ApplicationGraphV1 => {
  const diagnostics = validateApplicationGraph(input);
  if (diagnostics.length > 0) throw new ApplicationGraphValidationError(diagnostics);
  return canonicalizeApplicationGraph(input);
};

const queryReads = (graph: ApplicationGraphV1, queryId: string): readonly string[] => {
  const query = graph.queries.find((candidate) => candidate.id === queryId);
  if (!query) return [];
  const dependencies = new Set<string>([query.entity, ...query.select]);
  query.order?.forEach((order) => dependencies.add(order.field));
  query.where?.forEach((condition) => dependencies.add(condition.field));
  if (
    query.filter?.kind === 'relationEqualsActor' ||
    query.filter?.kind === 'relationEqualsContext'
  )
    dependencies.add(query.filter.relation);
  if (query.filter?.kind === 'relationEqualsContext') dependencies.add(query.filter.context);
  return [...dependencies].sort(compareText);
};

const affectedQueries = (graph: ApplicationGraphV1, operationId: string): readonly string[] => {
  const operation = graph.operations.find((candidate) => candidate.id === operationId);
  if (!operation) return [];
  return graph.queries
    .filter((query) =>
      operation.effects.some((effect) => {
        if (effect.target === query.entity) return true;
        const field = graph.fields.find((candidate) => candidate.id === effect.target);
        if (!field || field.entity !== query.entity) return false;
        return (
          query.select.includes(field.id) ||
          (query.order ?? []).some((order) => order.field === field.id) ||
          (query.where ?? []).some((condition) => condition.field === field.id)
        );
      }),
    )
    .map((query) => query.id)
    .sort(compareText);
};

export const createApplicationClientManifest = (
  input: ApplicationGraphV1,
  definitions: readonly UiServerFunctionDefinitionV1[],
): ApplicationClientManifestV1 => {
  const graph = validatedGraph(input);
  const functions = [...definitions]
    .sort((left, right) => compareText(left.id, right.id))
    .map((definition): ApplicationClientFunctionV1 => {
      const prefix = `${graph.app.id}/`;
      if (!definition.id.startsWith(prefix))
        throw new TypeError(
          `Application client function ${JSON.stringify(definition.id)} does not belong to ${JSON.stringify(graph.app.id)}.`,
        );
      const semanticId = definition.id.slice(prefix.length);
      const query = graph.queries.find((candidate) => candidate.id === semanticId);
      const operation = graph.operations.find((candidate) => candidate.id === semanticId);
      if (!query && !operation)
        throw new TypeError(
          `Application client function ${JSON.stringify(definition.id)} has no semantic query or operation.`,
        );
      if ((query && definition.mode !== 'query') || (operation && definition.mode !== 'mutation'))
        throw new TypeError(
          `Application client function ${JSON.stringify(definition.id)} has an incompatible mode.`,
        );
      return Object.freeze({
        cacheMaxAgeMs: query
          ? query.cache?.kind === 'no-store'
            ? null
            : (query.cache?.maxAgeMs ?? 30_000)
          : null,
        id: definition.id,
        invalidates: operation ? affectedQueries(graph, operation.id) : [],
        mode: definition.mode,
        name: query?.name ?? operation?.name ?? definition.name,
        parameters: definition.parameters,
        path: definition.path,
        reads: query ? queryReads(graph, query.id) : [],
        returns: definition.returns,
        semanticId,
      });
    });
  const names = new Set<string>();
  functions.forEach((definition) => {
    if (names.has(definition.name))
      throw new TypeError(
        `Application browser client method ${JSON.stringify(definition.name)} is declared more than once.`,
      );
    names.add(definition.name);
  });
  return Object.freeze({
    appId: graph.app.id,
    cache: Object.freeze({
      defaultMaxAgeMs: 30_000,
      scope: 'user-and-active-context',
      strategy: 'memory',
    }),
    functions: Object.freeze(functions),
    revision: graph.revision,
    schemaVersion: 'oxe.application-client-manifest.v1',
  });
};

const skeletonNode = (
  element: ApplicationViewElementV1,
  hints: Readonly<Record<string, ApplicationSkeletonElementHintV1>>,
): ApplicationSkeletonNodeV1 =>
  element.kind === 'repeat'
    ? Object.freeze({
        kind: 'collection',
        rows: 1,
        template: skeletonNode(element.template, hints),
      })
    : Object.freeze({
        children: Object.freeze(
          (element.children ?? []).map((child) => skeletonNode(child, hints)),
        ),
        component: element.component,
        kind: 'component',
        ...(element.id ? hints[element.id] : {}),
      });

const resolveLoadingMode = (
  graph: ApplicationGraphV1,
  viewId: string,
): Extract<ApplicationViewModeV1, { readonly kind: 'generated' }> => {
  const seen = new Set<string>();
  let currentId = viewId;
  while (true) {
    if (seen.has(currentId))
      throw new TypeError(
        `Application loading mode inheritance contains a cycle at ${JSON.stringify(currentId)}.`,
      );
    seen.add(currentId);
    const view = graph.views.find((candidate) => candidate.id === currentId);
    if (!view) throw new TypeError(`Application view ${JSON.stringify(currentId)} does not exist.`);
    const mode = view.modes.loading;
    if (mode.kind === 'generated')
      return mode.strategy === undefined
        ? Object.freeze({ ...mode, strategy: 'preserveStaticStructure' })
        : mode;
    if (mode.from === graph.app.id)
      return Object.freeze({ kind: 'generated', strategy: 'preserveStaticStructure' });
    currentId = mode.from;
  }
};

export const projectApplicationLoading = (
  input: ApplicationGraphV1,
  viewId: string,
): ApplicationLoadingProjectionV1 => {
  const graph = validatedGraph(input);
  const view = graph.views.find((candidate) => candidate.id === viewId);
  if (!view) throw new TypeError(`Application view ${JSON.stringify(viewId)} does not exist.`);
  const mode = resolveLoadingMode(graph, view.id);
  if (mode.strategy !== 'preserveStaticStructure')
    throw new TypeError(
      `Application view ${JSON.stringify(viewId)} does not request generated structure-preserving loading UI.`,
    );
  const collections: ApplicationLoadingCollectionV1[] = [];
  const hints = mode.skeleton?.elements ?? {};
  const rows = mode.skeleton?.rows ?? 1;
  const visit = (element: ApplicationViewElementV1, path: string): void => {
    if (element.kind === 'repeat') {
      collections.push({
        elementId: element.id ?? path,
        rows,
        template: skeletonNode(element.template, hints),
      });
      return;
    }
    element.children?.forEach((child, index) => visit(child, `${path}.children[${index}]`));
  };
  visit(view.tree, '$.tree');
  return Object.freeze({
    collections: Object.freeze(collections),
    schemaVersion: 'oxe.application-loading-projection.v1',
    strategy: 'preserveStaticStructure',
    viewId,
  });
};

const typeSource = (schema: ServerValueSchemaV1): string => {
  switch (schema.kind) {
    case 'array':
      return `readonly ${typeSource(schema.items)}[]`;
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'number':
      return 'number';
    case 'string':
      return schema.enum ? schema.enum.map((value) => JSON.stringify(value)).join(' | ') : 'string';
    case 'record':
      return `{ ${schema.fields
        .map((field) => `readonly ${JSON.stringify(field.name)}: ${typeSource(field.schema)};`)
        .join(' ')} }`;
    case 'union':
      return schema.variants.map(typeSource).join(' | ');
  }
};

const safeParameter = (name: string, index: number): string =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name) && name !== 'options' ? name : `argument${index}`;

const clientInterfaceSource = (manifest: ApplicationClientManifestV1): string =>
  manifest.functions
    .map((definition) => {
      const parameters = definition.parameters.map(
        (parameter, index) =>
          `${safeParameter(parameter.name, index)}: ${typeSource(parameter.schema)}`,
      );
      parameters.push(
        `options?: ${definition.mode === 'query' ? 'ApplicationQueryOptionsV1' : 'ApplicationMutationOptionsV1'}`,
      );
      return `  readonly ${JSON.stringify(definition.name)}: (${parameters.join(', ')}) => Promise<${typeSource(definition.returns)}>;`;
    })
    .join('\n');

const implementationSource = (manifest: ApplicationClientManifestV1): string =>
  manifest.functions
    .map((definition) => {
      const arguments_ = definition.parameters.map((parameter, index) =>
        safeParameter(parameter.name, index),
      );
      const parameters = definition.parameters.map(
        (parameter, index) =>
          `${safeParameter(parameter.name, index)}: ${typeSource(parameter.schema)}`,
      );
      const optionsType =
        definition.mode === 'query' ? 'ApplicationQueryOptionsV1' : 'ApplicationMutationOptionsV1';
      const argumentsSource = `[${arguments_.join(', ')}]`;
      const invocation =
        definition.mode === 'query'
          ? `query<${typeSource(definition.returns)}>(${JSON.stringify(definition.id)}, ${argumentsSource}, options)`
          : `mutate<${typeSource(definition.returns)}>(${JSON.stringify(definition.id)}, ${argumentsSource}, options)`;
      return `    ${JSON.stringify(definition.name)}: (${[...parameters, `options?: ${optionsType}`].join(', ')}) => ${invocation},`;
    })
    .join('\n');

const runtimeManifestValue = (manifest: ApplicationClientManifestV1): unknown => {
  const schemas: ServerValueSchemaV1[] = [];
  const schemaIndexes = new Map<string, number>();
  const schemaIndex = (schema: ServerValueSchemaV1): number => {
    const key = JSON.stringify(schema);
    const existing = schemaIndexes.get(key);
    if (existing !== undefined) return existing;
    const index = schemas.length;
    schemas.push(schema);
    schemaIndexes.set(key, index);
    return index;
  };
  return {
    cache: { defaultMaxAgeMs: manifest.cache.defaultMaxAgeMs },
    functions: manifest.functions.map(
      ({ cacheMaxAgeMs, id, invalidates, mode, returns, semanticId }) => ({
        cacheMaxAgeMs,
        id,
        invalidates,
        mode,
        returns: schemaIndex(returns),
        semanticId,
      }),
    ),
    schemas,
  };
};

const sharedRuntimeSource = `/* Generated OXE application browser runtime. Do not edit. */
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
    throw new TypeError(\`Invalid active context at \${path}.\`);
  if (typeof value.contextId !== 'string' || typeof value.entityId !== 'string' || typeof value.recordId !== 'string' || value.recordId.length === 0)
    throw new TypeError(\`Invalid active context identity at \${path}.\`);
  return Object.freeze({ contextId: value.contextId, entityId: value.entityId, recordId: value.recordId });
};
const readApplicationClientContext = (value: unknown): ApplicationClientContextV1 => {
  if (!isRecord(value) || !exactKeys(value, ['activeContexts', 'schemaVersion', 'userId']))
    throw new TypeError('Server returned an invalid application client context.');
  if (value.schemaVersion !== 'oxe.application-client-context.v1' || typeof value.userId !== 'string' || value.userId.length === 0 || !Array.isArray(value.activeContexts))
    throw new TypeError('Server returned an invalid application client context.');
  const activeContexts = value.activeContexts.map((entry, index) => readContextEntry(entry, \`$.activeContexts[\${index}]\`));
  if (new Set(activeContexts.map((entry) => entry.contextId)).size !== activeContexts.length)
    throw new TypeError('Server returned duplicate active context roles.');
  return Object.freeze({ activeContexts: Object.freeze(activeContexts), schemaVersion: value.schemaVersion, userId: value.userId });
};
const readValue = (schema: ApplicationValueSchemaV1, value: unknown, path: string): unknown => {
  if (schema.kind === 'boolean') {
    if (typeof value !== 'boolean') throw new TypeError(\`Invalid boolean at \${path}.\`);
    return value;
  }
  if (schema.kind === 'null') {
    if (value !== null) throw new TypeError(\`Invalid null at \${path}.\`);
    return null;
  }
  if (schema.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(\`Invalid number at \${path}.\`);
    return value;
  }
  if (schema.kind === 'string') {
    if (typeof value !== 'string' || (schema.enum && !schema.enum.includes(value))) throw new TypeError(\`Invalid string at \${path}.\`);
    return value;
  }
  if (schema.kind === 'array') {
    if (!Array.isArray(value)) throw new TypeError(\`Invalid array at \${path}.\`);
    return value.map((item, index) => readValue(schema.items, item, \`\${path}[\${index}]\`));
  }
  if (schema.kind === 'union') {
    for (const variant of schema.variants) {
      try { return readValue(variant, value, path); } catch { /* try the next exact variant */ }
    }
    throw new TypeError(\`Invalid union value at \${path}.\`);
  }
  if (!isRecord(value)) throw new TypeError(\`Invalid record at \${path}.\`);
  if (Object.keys(value).length !== schema.fields.length || schema.fields.some((field) => !Object.hasOwn(value, field.name)))
    throw new TypeError(\`Invalid record fields at \${path}.\`);
  return Object.fromEntries(schema.fields.map((field) => [field.name, readValue(field.schema, value[field.name], \`\${path}.\${field.name}\`)]));
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
  const keyFor = (functionId: string, arguments_: readonly unknown[]): string => \`\${scopeKey}\\u0000\${functionId}\\u0000\${JSON.stringify(arguments_)}\`;
  const invoke = async <Value>(functionId: string, arguments_: readonly unknown[], callOptions?: ApplicationClientCallOptionsV1): Promise<Value> => {
    const definition = byId.get(functionId);
    if (!definition) throw new TypeError(\`Unknown generated application function "\${functionId}".\`);
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
    if (!definition || definition.mode !== 'query') throw new TypeError(\`Generated application function "\${functionId}" is not a query.\`);
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
    if (!definition || definition.mode !== 'mutation') throw new TypeError(\`Generated application function "\${functionId}" is not a mutation.\`);
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
`;

const browserJavaScript = (source: string): string =>
  transpileModule(source, {
    compilerOptions: {
      module: ModuleKind.ESNext,
      removeComments: false,
      target: ScriptTarget.ES2022,
    },
  }).outputText;

/** Emits the single reusable transport, validation, context, and cache runtime used by all facets. */
export const generateApplicationBrowserClientRuntimeModule = (): string => sharedRuntimeSource;

/** Emits executable JavaScript for production artifact hosts while typed sources remain available. */
export const generateApplicationBrowserClientRuntimeJavaScriptModule = (): string =>
  browserJavaScript(sharedRuntimeSource);

const clientFacadeSource = (manifest: ApplicationClientManifestV1): string => `
const manifest = ${JSON.stringify(runtimeManifestValue(manifest))} as const;
export interface ApplicationClientV1 {
${clientInterfaceSource(manifest)}
  clearCache(): void;
  inspectCache(): ApplicationClientCacheSnapshotV1;
}
export const createApplicationClient = (options: ApplicationClientOptionsV1): ApplicationClientV1 => {
  const { clearCache, inspectCache, mutate, query } = createApplicationClientRuntime(manifest, options);
  return Object.freeze({
${implementationSource(manifest)}
    clearCache,
    inspectCache,
  });
};
export const bootstrapApplicationClient = async (options: ApplicationClientBootstrapOptionsV1 = {}): Promise<ApplicationClientV1> =>
  createApplicationClient({ ...options, context: await bootstrapApplicationClientContext(options) });
`;

/** Emits a small typed client facet whose only data is its semantic function manifest. */
export const generateApplicationBrowserClientFacet = (
  graph: ApplicationGraphV1,
  definitions: readonly UiServerFunctionDefinitionV1[],
  runtimeImport = './application-client-runtime.js',
): ApplicationBrowserClientFacetProjectionV1 => {
  const manifest = createApplicationClientManifest(graph, definitions);
  const declarationSource = `/* Generated from the normalized OXE application graph. Do not edit. */
import type {
  ApplicationClientBootstrapOptionsV1,
  ApplicationClientCacheSnapshotV1,
  ApplicationClientOptionsV1,
  ApplicationMutationOptionsV1,
  ApplicationQueryOptionsV1,
} from ${JSON.stringify(runtimeImport)};
export type { ApplicationClientBootstrapOptionsV1, ApplicationClientOptionsV1 } from ${JSON.stringify(runtimeImport)};
export interface ApplicationClientV1 {
${clientInterfaceSource(manifest)}
  clearCache(): void;
  inspectCache(): ApplicationClientCacheSnapshotV1;
}
`;
  const moduleSource = `${declarationSource}
import { bootstrapApplicationClientContext, createApplicationClientRuntime } from ${JSON.stringify(runtimeImport)};
const manifest = ${JSON.stringify(runtimeManifestValue(manifest))} as const;
export const createApplicationClient = (options: ApplicationClientOptionsV1): ApplicationClientV1 => {
  const { clearCache, inspectCache, mutate, query } = createApplicationClientRuntime(manifest, options);
  return Object.freeze({
${implementationSource(manifest)}
    clearCache,
    inspectCache,
  });
};
export const bootstrapApplicationClient = async (options: ApplicationClientBootstrapOptionsV1 = {}): Promise<ApplicationClientV1> =>
  createApplicationClient({ ...options, context: await bootstrapApplicationClientContext(options) });
`;
  return Object.freeze({ declarationSource, manifest, moduleSource, runtimeImport });
};

export const generateApplicationBrowserClientFacetJavaScript = (
  graph: ApplicationGraphV1,
  definitions: readonly UiServerFunctionDefinitionV1[],
  runtimeImport = './application-client-runtime.js',
): string =>
  browserJavaScript(
    generateApplicationBrowserClientFacet(graph, definitions, runtimeImport).moduleSource,
  );

export const generateApplicationBrowserClient = (
  graph: ApplicationGraphV1,
  definitions: readonly UiServerFunctionDefinitionV1[],
): ApplicationBrowserClientProjectionV1 => {
  const manifest = createApplicationClientManifest(graph, definitions);
  const declarationSource = sharedRuntimeSource;
  return Object.freeze({
    declarationSource,
    manifest,
    moduleSource: `${declarationSource}${clientFacadeSource(manifest)}`,
  });
};
