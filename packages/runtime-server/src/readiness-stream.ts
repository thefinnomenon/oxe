import type {
  ServerAsyncRenderSink,
  ServerDeferredRegionOutput,
  ServerDeferredResourceV2,
  ServerPreparedRegionV2,
  ServerReadinessAdapter,
  ServerReadinessErrorContext,
  ServerReadinessMetrics,
  ServerReadinessOptions,
  ServerReadinessResult,
  ServerErrorResponse,
  ServerResponseMetadata,
  ServerRenderPlanV2,
} from './types.js';
import {
  OXE_STREAM_BOOTSTRAP_SOURCE,
  serializeAsyncCheckpoints,
  serializeServerStreamPatch,
  type ServerStreamPatch,
} from './stream-protocol.js';

export type ServerReadinessErrorCode =
  | 'OXE_SERVER_STREAM_ABORTED'
  | 'OXE_SERVER_STREAM_INVALID_ADAPTER'
  | 'OXE_SERVER_STREAM_INVALID_PLAN';

export class OxeServerReadinessError extends Error {
  public readonly code: ServerReadinessErrorCode;

  public constructor(code: ServerReadinessErrorCode, message: string) {
    super(message);
    this.name = 'OxeServerReadinessError';
    this.code = code;
  }
}

interface MutableReadinessMetrics {
  batchesWritten: number;
  bootstrapBytes: number;
  bytesWritten: number;
  checkpointBytes: number;
  checkpointsWritten: number;
  patchBytes: number;
  patchesWritten: number;
  regionsCompleted: number;
  requestsDeduplicated: number;
  requestsStarted: number;
  shellBytes: number;
}

interface ResourceRequest {
  readonly identity: string;
  promise: Promise<unknown>;
  value?: unknown;
}

interface ReadyRegion {
  readonly index: number;
  readonly region: ServerPreparedRegionV2;
  readonly resources?: ReadonlyMap<string, unknown>;
  readonly error?: unknown;
  readonly phase?: 'region' | 'resource';
}

type RenderedRegion =
  | {
      readonly regions: readonly ServerPreparedRegionV2[];
      readonly resources: readonly ServerDeferredResourceV2[];
      readonly patches: readonly ServerStreamPatch[];
      readonly region: ServerPreparedRegionV2;
    }
  | {
      readonly error: unknown;
      readonly region: ServerPreparedRegionV2;
    };

interface NormalizedRegionOutput {
  readonly patches: readonly ServerStreamPatch[];
  readonly regions: readonly ServerPreparedRegionV2[];
  readonly resources: readonly ServerDeferredResourceV2[];
}

const invalidPlan = (message: string): never => {
  throw new OxeServerReadinessError('OXE_SERVER_STREAM_INVALID_PLAN', message);
};

const invalidAdapter = (message: string): never => {
  throw new OxeServerReadinessError('OXE_SERVER_STREAM_INVALID_ADAPTER', message);
};

const aborted = (): OxeServerReadinessError =>
  new OxeServerReadinessError('OXE_SERVER_STREAM_ABORTED', 'Server readiness stream was aborted.');

const utf8ByteLength = (value: string): number => {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
};

const normalizeRegionOutput = (output: ServerDeferredRegionOutput): NormalizedRegionOutput => {
  if (output === null || output === undefined) {
    return { patches: [], regions: [], resources: [] };
  }
  if ('kind' in output && output.kind === 'expansion') {
    return {
      patches: output.patches,
      regions: output.regions,
      resources: output.resources,
    };
  }
  return {
    patches: Array.isArray(output) ? output : [output as ServerStreamPatch],
    regions: [],
    resources: [],
  };
};

const validatePreparedPatch = (region: ServerPreparedRegionV2, patch: ServerStreamPatch): void => {
  if (patch.regionId !== region.id) {
    invalidAdapter(
      `Prepared region "${region.id}" rendered a patch for different marker "${patch.regionId}".`,
    );
  }
  if (!Number.isSafeInteger(patch.token) || patch.token < 0) {
    invalidAdapter(`Prepared region "${region.id}" rendered an invalid patch token.`);
  }
  const expectedKind = region.template.kind === 'attribute' ? 'attribute' : 'replace';
  if (patch.kind !== expectedKind) {
    invalidAdapter(
      `Prepared ${region.template.kind} region "${region.id}" must render a ${expectedKind} patch.`,
    );
  }
};

const freezeMetrics = (metrics: MutableReadinessMetrics): ServerReadinessMetrics =>
  Object.freeze({ ...metrics });

const createMetrics = (): MutableReadinessMetrics => ({
  batchesWritten: 0,
  bootstrapBytes: 0,
  bytesWritten: 0,
  checkpointBytes: 0,
  checkpointsWritten: 0,
  patchBytes: 0,
  patchesWritten: 0,
  regionsCompleted: 0,
  requestsDeduplicated: 0,
  requestsStarted: 0,
  shellBytes: 0,
});

const validatePlan = (plan: ServerRenderPlanV2): void => {
  if (plan.schemaVersion !== 'oxe.server-render-plan.v2') {
    invalidPlan('The readiness executor requires an oxe.server-render-plan.v2 plan.');
  }
  if (plan.execution.mode !== 'asynchronous' || plan.execution.delivery !== 'readiness-stream') {
    invalidPlan('The server plan does not declare readiness-stream execution.');
  }
  const regionIds = new Set<string>();
  for (const region of plan.regions) {
    if (regionIds.has(region.id)) {
      invalidPlan(`The server plan contains duplicate deferred region id "${region.id}".`);
    }
    regionIds.add(region.id);
    if (region.resourceIds.length === 0) {
      invalidPlan(`Deferred region "${region.id}" has no resource dependencies.`);
    }
  }
};

const validatePreparation = (
  plan: ServerRenderPlanV2,
  preparation: Awaited<ReturnType<ServerReadinessAdapter['prepare']>>,
): void => {
  if (!preparation || typeof preparation.shell !== 'string') {
    invalidAdapter('prepare() must return a readiness preparation with a string shell.');
  }
  if (!Array.isArray(preparation.resources) || !Array.isArray(preparation.regions)) {
    invalidAdapter('prepare() must return resource and region arrays.');
  }
  const resourceIds = new Set<string>();
  for (const resource of preparation.resources) {
    if (typeof resource.id !== 'string' || resource.id.length === 0) {
      invalidAdapter('A prepared resource has an invalid request-local id.');
    }
    if (resourceIds.has(resource.id)) {
      invalidAdapter(`The readiness preparation contains duplicate resource id "${resource.id}".`);
    }
    resourceIds.add(resource.id);
  }
  for (const resource of preparation.resources) {
    if ('prepare' in resource && typeof resource.prepare === 'function') {
      if (resource.resourceIds.length === 0) {
        invalidAdapter(`Dependent resource "${resource.id}" has no dependencies.`);
      }
      if (new Set(resource.resourceIds).size !== resource.resourceIds.length) {
        invalidAdapter(`Dependent resource "${resource.id}" repeats a dependency.`);
      }
      for (const dependencyId of resource.resourceIds) {
        if (!resourceIds.has(dependencyId)) {
          invalidAdapter(
            `Dependent resource "${resource.id}" references missing resource "${dependencyId}".`,
          );
        }
      }
    } else {
      if (typeof resource.identity !== 'string' || resource.identity.length === 0) {
        invalidAdapter(`Prepared resource "${resource.id}" has an invalid identity.`);
      }
      if (typeof resource.load !== 'function') {
        invalidAdapter(`Prepared resource "${resource.id}" has no load function.`);
      }
    }
  }

  const templateIds = new Set(plan.regions.map((region) => region.id));
  const regionIds = new Set<string>();
  const referencedResources = new Set(
    preparation.resources.flatMap((resource) =>
      'prepare' in resource && typeof resource.prepare === 'function' ? resource.resourceIds : [],
    ),
  );
  for (const region of preparation.regions) {
    if (typeof region.id !== 'string' || region.id.length === 0) {
      invalidAdapter('A prepared region has an invalid request-local id.');
    }
    if (regionIds.has(region.id)) {
      invalidAdapter(`The readiness preparation contains duplicate region id "${region.id}".`);
    }
    regionIds.add(region.id);
    if (!region.template || !templateIds.has(region.template.id)) {
      invalidAdapter(`Prepared region "${region.id}" references an unknown plan template.`);
    }
    if (typeof region.render !== 'function') {
      invalidAdapter(`Prepared region "${region.id}" has no render function.`);
    }
    if (region.resourceIds.length === 0) {
      invalidAdapter(`Prepared region "${region.id}" has no resource dependencies.`);
    }
    const uniqueDependencies = new Set(region.resourceIds);
    if (uniqueDependencies.size !== region.resourceIds.length) {
      invalidAdapter(`Prepared region "${region.id}" repeats a resource dependency.`);
    }
    for (const resourceId of region.resourceIds) {
      if (!resourceIds.has(resourceId)) {
        invalidAdapter(
          `Prepared region "${region.id}" references missing resource "${resourceId}".`,
        );
      }
      referencedResources.add(resourceId);
    }
  }
  for (const resourceId of resourceIds) {
    if (!referencedResources.has(resourceId)) {
      invalidAdapter(`Prepared resource "${resourceId}" is not consumed by a deferred region.`);
    }
  }
};

const validateBatchWindow = (value: number | undefined): number => {
  if (value === undefined) return 0;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('batchWindowMilliseconds must be a finite non-negative number.');
  }
  return value;
};

const notifyError = async (
  options: ServerReadinessOptions,
  error: unknown,
  context: ServerReadinessErrorContext,
): Promise<ServerErrorResponse | undefined> => {
  if (options.onError) {
    try {
      return (await options.onError(error, context)) ?? undefined;
    } catch (handlerError) {
      throw new AggregateError(
        [error, handlerError],
        'The server stream and its global error handler both failed.',
      );
    }
  }
  return undefined;
};

export const serverErrorStatus = (error: unknown): number => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number' &&
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status <= 599
  ) {
    return error.status;
  }
  return 500;
};

/** Safe default for a global policy; hosts can replace each body or return redirects. */
export const defaultServerErrorResponse = (error: unknown): ServerErrorResponse => {
  const status = serverErrorStatus(error);
  const body =
    status === 404
      ? 'Not found'
      : status === 401
        ? 'Unauthorized'
        : status === 403
          ? 'Forbidden'
          : status === 400 || status === 422
            ? 'Invalid request'
            : 'Internal server error';
  return {
    body,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    status,
  };
};

const delayForBatch = (milliseconds: number, signal: AbortSignal): Promise<void> => {
  if (signal.aborted) return Promise.reject(aborted());
  if (milliseconds === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timeout);
      reject(aborted());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
};

const awaitAbortable = <T>(value: T | PromiseLike<T>, signal: AbortSignal): Promise<T> => {
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(aborted());
    signal.addEventListener('abort', onAbort, { once: true });
    void Promise.resolve(value).then(
      (result) => {
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
};

const linkAbortSignal = (
  source: AbortSignal | undefined,
  controller: AbortController,
): (() => void) => {
  if (!source) return () => undefined;
  if (source.aborted) {
    controller.abort();
    return () => undefined;
  }
  const abort = (): void => controller.abort();
  source.addEventListener('abort', abort, { once: true });
  return () => source.removeEventListener('abort', abort);
};

const bootstrapMarkup = (): string => `<script>${OXE_STREAM_BOOTSTRAP_SOURCE}</script>`;

/**
 * Executes backend-prepared V2 regions as soon as their resources are ready.
 * Writes are serialized and awaited, so the sink itself supplies backpressure.
 */
export const streamServerRenderPlan = async (
  plan: ServerRenderPlanV2,
  adapter: ServerReadinessAdapter,
  sink: ServerAsyncRenderSink,
  options: ServerReadinessOptions = {},
): Promise<ServerReadinessMetrics> => {
  validatePlan(plan);
  const batchWindow = validateBatchWindow(options.batchWindowMilliseconds);
  const controller = new AbortController();
  const unlinkAbort = linkAbortSignal(options.signal, controller);
  const metrics = createMetrics();
  let headersCommitted = false;
  let responseStarted = false;
  let activePhase: ServerReadinessErrorContext['phase'] = 'shell';
  let activeRegion: ServerPreparedRegionV2 | undefined;

  const start = async (response: ServerResponseMetadata): Promise<void> => {
    if (responseStarted) return;
    activePhase = 'write';
    await sink.start?.(response);
    responseStarted = true;
    headersCommitted = true;
  };

  const write = async (chunk: string): Promise<void> => {
    if (chunk.length === 0) return;
    if (controller.signal.aborted) throw aborted();
    activePhase = 'write';
    if (!responseStarted) await start({ status: 200 });
    await sink.write(chunk);
    metrics.bytesWritten += utf8ByteLength(chunk);
    headersCommitted = true;
  };

  try {
    if (controller.signal.aborted) throw aborted();
    activePhase = 'shell';
    const preparation = await awaitAbortable(
      adapter.prepare(plan, controller.signal),
      controller.signal,
    );
    validatePreparation(plan, preparation);

    const requestsByIdentity = new Map<string, ResourceRequest>();
    const requestsByResourceId = new Map<string, ResourceRequest>();
    const preparedResourceIds = new Set<string>();
    const statusGateResourceIds = new Set<string>();
    const acquireRequest = (
      identity: string,
      load: (signal: AbortSignal) => unknown | PromiseLike<unknown>,
    ): ResourceRequest => {
      let request = requestsByIdentity.get(identity);
      if (request) {
        metrics.requestsDeduplicated += 1;
        return request;
      }
      request = {
        identity,
        promise: Promise.resolve().then(() => load(controller.signal)),
      };
      const createdRequest = request;
      createdRequest.promise = createdRequest.promise.then((value) => {
        createdRequest.value = value;
        return value;
      });
      void createdRequest.promise.catch(() => undefined);
      requestsByIdentity.set(identity, request);
      metrics.requestsStarted += 1;
      return request;
    };
    const registerResource = (resource: ServerDeferredResourceV2): void => {
      if (typeof resource.id !== 'string' || resource.id.length === 0) {
        invalidAdapter('A dynamically prepared resource has an invalid request-local id.');
      }
      if (preparedResourceIds.has(resource.id)) {
        invalidAdapter(`The readiness stream received duplicate resource id "${resource.id}".`);
      }
      preparedResourceIds.add(resource.id);
      if (resource.statusGate) statusGateResourceIds.add(resource.id);
      if ('prepare' in resource && typeof resource.prepare === 'function') {
        if (resource.resourceIds.length === 0) {
          invalidAdapter(`Dependent resource "${resource.id}" has no dependencies.`);
        }
        const dependencies = resource.resourceIds.map(
          (resourceId) =>
            requestsByResourceId.get(resourceId) ??
            invalidAdapter(
              `Dependent resource "${resource.id}" references unavailable resource "${resourceId}".`,
            ),
        );
        const handle: ResourceRequest = {
          identity: `pending:${resource.id}`,
          promise: Promise.all(dependencies.map((dependency) => dependency.promise)).then(
            async (values) => {
              const request = await resource.prepare(
                new Map(
                  resource.resourceIds.map((resourceId, index) => [resourceId, values[index]]),
                ),
                controller.signal,
              );
              if (typeof request.identity !== 'string' || request.identity.length === 0) {
                return invalidAdapter(
                  `Dependent resource "${resource.id}" prepared an invalid identity.`,
                );
              }
              if (typeof request.load !== 'function') {
                return invalidAdapter(
                  `Dependent resource "${resource.id}" prepared no load function.`,
                );
              }
              return acquireRequest(request.identity, request.load).promise;
            },
          ),
        };
        handle.promise = handle.promise.then((value) => {
          handle.value = value;
          return value;
        });
        void handle.promise.catch(() => undefined);
        requestsByResourceId.set(resource.id, handle);
      } else {
        if (typeof resource.identity !== 'string' || resource.identity.length === 0) {
          invalidAdapter(`Prepared resource "${resource.id}" has an invalid identity.`);
        }
        if (typeof resource.load !== 'function') {
          invalidAdapter(`Prepared resource "${resource.id}" has no load function.`);
        }
        requestsByResourceId.set(resource.id, acquireRequest(resource.identity, resource.load));
      }
    };
    activePhase = 'resource';
    for (const resource of preparation.resources) {
      registerResource(resource);
    }

    if (statusGateResourceIds.size > 0) {
      activePhase = 'resource';
      await awaitAbortable(
        Promise.all(
          [...statusGateResourceIds].map(
            (resourceId) =>
              requestsByResourceId.get(resourceId)?.promise ??
              invalidAdapter(`Status-gated resource "${resourceId}" is unavailable.`),
          ),
        ),
        controller.signal,
      );
    }

    activePhase = 'shell';
    const bootstrap = options.includeBootstrap === false ? '' : bootstrapMarkup();
    metrics.bootstrapBytes = utf8ByteLength(bootstrap);
    metrics.shellBytes = utf8ByteLength(preparation.shell);
    await start({ status: 200 });
    await write(bootstrap + preparation.shell);

    const readyQueue: ReadyRegion[] = [];
    let wake: (() => void) | undefined;
    const enqueue = (ready: ReadyRegion): void => {
      readyQueue.push(ready);
      wake?.();
      wake = undefined;
    };
    const waitForReady = (): Promise<void> => {
      if (readyQueue.length > 0) return Promise.resolve();
      if (controller.signal.aborted) return Promise.reject(aborted());
      return new Promise((resolve, reject) => {
        const onAbort = (): void => {
          wake = undefined;
          reject(aborted());
        };
        wake = () => {
          controller.signal.removeEventListener('abort', onAbort);
          resolve();
        };
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
    };

    const templateIds = new Set(plan.regions.map((region) => region.id));
    const preparedRegionIds = new Set<string>();
    let scheduled = 0;
    const registerRegion = (region: ServerPreparedRegionV2): void => {
      if (typeof region.id !== 'string' || region.id.length === 0) {
        invalidAdapter('A dynamically prepared region has an invalid request-local id.');
      }
      if (preparedRegionIds.has(region.id)) {
        invalidAdapter(`The readiness stream received duplicate region id "${region.id}".`);
      }
      if (!region.template || !templateIds.has(region.template.id)) {
        invalidAdapter(`Prepared region "${region.id}" references an unknown plan template.`);
      }
      if (typeof region.render !== 'function') {
        invalidAdapter(`Prepared region "${region.id}" has no render function.`);
      }
      if (region.resourceIds.length === 0) {
        invalidAdapter(`Prepared region "${region.id}" has no resource dependencies.`);
      }
      if (new Set(region.resourceIds).size !== region.resourceIds.length) {
        invalidAdapter(`Prepared region "${region.id}" repeats a resource dependency.`);
      }
      for (const resourceId of region.resourceIds) {
        if (!requestsByResourceId.has(resourceId)) {
          invalidAdapter(
            `Prepared region "${region.id}" references missing resource "${resourceId}".`,
          );
        }
      }
      preparedRegionIds.add(region.id);
      const index = scheduled;
      scheduled += 1;
      const dependencies = region.resourceIds.map((resourceId) => {
        const request = requestsByResourceId.get(resourceId);
        return request
          ? request.promise
          : Promise.reject(
              new OxeServerReadinessError(
                'OXE_SERVER_STREAM_INVALID_ADAPTER',
                `No prepared resource exists for "${resourceId}".`,
              ),
            );
      });
      void Promise.all(dependencies).then(
        (values) =>
          enqueue({
            index,
            region,
            resources: new Map(
              region.resourceIds.map((resourceId, valueIndex) => [resourceId, values[valueIndex]]),
            ),
          }),
        (error: unknown) => enqueue({ error, index, phase: 'resource', region }),
      );
    };
    preparation.regions.forEach(registerRegion);

    let completed = 0;
    while (completed < scheduled) {
      await waitForReady();
      await delayForBatch(batchWindow, controller.signal);
      const batch = readyQueue.splice(0).sort((left, right) => left.index - right.index);
      const failed = batch.find((item) => item.error !== undefined);
      if (failed) {
        activePhase = failed.phase ?? 'region';
        activeRegion = failed.region;
        throw failed.error;
      }

      activePhase = 'region';
      const rendered: readonly RenderedRegion[] = await Promise.all(
        batch.map(async ({ region, resources }) => {
          try {
            const normalized = normalizeRegionOutput(
              await awaitAbortable(
                region.render(resources ?? new Map<string, unknown>(), controller.signal),
                controller.signal,
              ),
            );
            normalized.patches.forEach((patch) => validatePreparedPatch(region, patch));
            return {
              ...normalized,
              region,
            };
          } catch (error) {
            return { error, region };
          }
        }),
      );
      const renderFailure = rendered.find(
        (item): item is Extract<RenderedRegion, { readonly error: unknown }> => 'error' in item,
      );
      if (renderFailure) {
        activeRegion = renderFailure.region;
        throw renderFailure.error;
      }
      const patches = rendered.flatMap((item) => ('patches' in item ? item.patches : []));
      const patchChunk = patches.map(serializeServerStreamPatch).join('');
      metrics.patchBytes += utf8ByteLength(patchChunk);
      metrics.patchesWritten += patches.length;
      metrics.regionsCompleted += batch.length;
      metrics.batchesWritten += 1;
      await write(patchChunk);
      completed += batch.length;
      for (const item of rendered) {
        if (!('resources' in item)) continue;
        item.resources.forEach(registerResource);
        item.regions.forEach(registerRegion);
      }
      activeRegion = undefined;
    }

    if (options.includeCheckpoints !== false) {
      activePhase = 'checkpoint';
      const checkpoints = [...requestsByIdentity.values()]
        .map((request) => ({ identity: request.identity, value: request.value }))
        .sort((left, right) => left.identity.localeCompare(right.identity));
      const serialized = serializeAsyncCheckpoints(checkpoints, plan.source.buildFingerprint);
      metrics.checkpointBytes = utf8ByteLength(serialized);
      metrics.checkpointsWritten = checkpoints.length;
      await write(serialized);
    }
    return freezeMetrics(metrics);
  } catch (error) {
    if (error instanceof OxeServerReadinessError && error.code === 'OXE_SERVER_STREAM_ABORTED') {
      throw error;
    }
    const resolution = await notifyError(options, error, {
      headersCommitted,
      phase: activePhase,
      ...(activeRegion ? { region: activeRegion } : {}),
    });
    if (!resolution || headersCommitted) throw error;
    if (
      !Number.isInteger(resolution.status) ||
      resolution.status < 300 ||
      resolution.status > 599
    ) {
      invalidAdapter('The global error handler returned an invalid HTTP status.');
    }
    await start({
      status: resolution.status,
      ...(resolution.headers ? { headers: resolution.headers } : {}),
    });
    if (resolution.body.length > 0) {
      await sink.write(resolution.body);
      metrics.bytesWritten += utf8ByteLength(resolution.body);
    }
    return freezeMetrics(metrics);
  } finally {
    controller.abort();
    unlinkAbort();
  }
};

export const renderServerStreamToString = async (
  plan: ServerRenderPlanV2,
  adapter: ServerReadinessAdapter,
  options: ServerReadinessOptions = {},
): Promise<ServerReadinessResult> => {
  const chunks: string[] = [];
  let status = 200;
  let headers: Readonly<Record<string, string>> = {};
  const metrics = await streamServerRenderPlan(
    plan,
    adapter,
    {
      start: (response) => {
        status = response.status;
        headers = response.headers ?? {};
      },
      write: (chunk) => {
        chunks.push(chunk);
      },
    },
    options,
  );
  return { headers, html: chunks.join(''), metrics, status };
};
