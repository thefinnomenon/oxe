import {
  createApplicationTelemetryCollector,
  type ApplicationExecutionContextV1,
  type ApplicationGraphV1,
  type ApplicationOutboxJobV1,
  type ApplicationRuntimeValueV1,
  type ApplicationTelemetryCollectorV1,
  type ApplicationTelemetrySinkV1,
  type ApplicationTelemetrySnapshotV1,
  type UiServerFunctionDefinitionV1,
} from '@oxe/graph';
import {
  createPostgresApplicationJobWorker,
  createPostgresApplicationHost,
  type ApplicationPostgresHostOptionsV1,
  type ApplicationPostgresHostV1,
  type ApplicationPostgresJobWorkerOptionsV1,
  type ApplicationPostgresJobWorkerSnapshotV1,
  type ApplicationPostgresJobWorkerStopResultV1,
  type ApplicationPostgresJobWorkerV1,
  type ApplicationSqlPoolV1,
} from '@oxe/postgres';

import { OxeServerFunctionError, OxeServerFunctionPublicError } from './errors.js';
import { createServerFunctionRegistry, implementServerFunction } from './server.js';
import type { ServerFunctionRegistry } from './types.js';

export interface PostgresApplicationServerFunctionsV1 {
  readonly host: ApplicationPostgresHostV1;
  readonly registry: ServerFunctionRegistry<ApplicationExecutionContextV1>;
}

export interface PostgresApplicationServerRuntimeOptionsV1 {
  readonly host?: Omit<ApplicationPostgresHostOptionsV1, 'telemetry'>;
  /** Optional external sink receives the same privacy-safe spans as the bounded collector. */
  readonly telemetry?: ApplicationTelemetrySinkV1;
  readonly telemetryMaximumSpans?: number;
  readonly worker?: ApplicationPostgresJobWorkerOptionsV1;
}

export interface PostgresApplicationDevelopmentOperationsV1 {
  readonly appId: string;
  readonly capturedAt: string;
  readonly deadLetterJobs: readonly ApplicationOutboxJobV1[];
  readonly graphRevision: number;
  readonly schemaVersion: 'oxe.application-development-operations.v1';
  readonly telemetry: ApplicationTelemetrySnapshotV1;
  readonly worker: ApplicationPostgresJobWorkerSnapshotV1;
}

export interface PostgresApplicationServerRuntimeV1 extends PostgresApplicationServerFunctionsV1 {
  close(): Promise<ApplicationPostgresJobWorkerStopResultV1>;
  developmentOperations(): Promise<PostgresApplicationDevelopmentOperationsV1>;
  readonly telemetry: ApplicationTelemetryCollectorV1;
  readonly worker: ApplicationPostgresJobWorkerV1;
}

const invalidContract = (message: string): never => {
  throw new OxeServerFunctionError('OXE_SERVER_FUNCTION_INVALID_CONTRACT', message);
};

const semanticIdFor = (graph: ApplicationGraphV1, functionId: string): string => {
  const prefix = `${graph.app.id}/`;
  return functionId.startsWith(prefix)
    ? functionId.slice(prefix.length)
    : invalidContract(
        `Application server function ${JSON.stringify(functionId)} must start with ${JSON.stringify(prefix)}.`,
      );
};

const executeSafely = async <Value>(run: () => Promise<Value>): Promise<Value> => {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof Error &&
      'kind' in error &&
      (error.kind === 'forbidden' ||
        error.kind === 'not-found' ||
        error.kind === 'unauthorized' ||
        error.kind === 'validation')
    )
      throw new OxeServerFunctionPublicError(error.kind, error.message, { cause: error });
    throw error;
  }
};

/** Binds generated RPC contracts to OXE's PostgreSQL semantic operation host. */
export const createPostgresApplicationServerFunctions = (
  graph: ApplicationGraphV1,
  definitions: readonly UiServerFunctionDefinitionV1[],
  pool: ApplicationSqlPoolV1,
  options: ApplicationPostgresHostOptionsV1 = {},
): PostgresApplicationServerFunctionsV1 => {
  const host = createPostgresApplicationHost(graph, pool, options);
  const implementations = definitions.map((definition) => {
    const semanticId = semanticIdFor(graph, definition.id);
    const query = graph.queries.find((candidate) => candidate.id === semanticId);
    if (query) {
      if (definition.mode !== 'query' || definition.parameters.length !== 0)
        invalidContract(
          `Application query definition ${JSON.stringify(definition.id)} has an incompatible RPC contract.`,
        );
      return implementServerFunction<UiServerFunctionDefinitionV1, ApplicationExecutionContextV1>(
        definition,
        (_arguments, context, signal) => executeSafely(() => host.query(query.id, context, signal)),
      );
    }
    const operation = graph.operations.find((candidate) => candidate.id === semanticId);
    if (!operation)
      return invalidContract(
        `Application server function ${JSON.stringify(definition.id)} does not resolve to a query or operation.`,
      );
    const inputNames = Object.keys(operation.input.fields).sort();
    if (
      definition.mode !== 'mutation' ||
      definition.parameters.length !== inputNames.length ||
      definition.parameters.some((parameter, index) => parameter.name !== inputNames[index])
    )
      invalidContract(
        `Application operation definition ${JSON.stringify(definition.id)} has an incompatible RPC contract.`,
      );
    return implementServerFunction<UiServerFunctionDefinitionV1, ApplicationExecutionContextV1>(
      definition,
      (arguments_, context, signal) => {
        const input = Object.fromEntries(
          inputNames.map((name, index) => [name, arguments_[index] as ApplicationRuntimeValueV1]),
        );
        return executeSafely(() => host.execute(operation.id, input, context, signal));
      },
    );
  });
  return Object.freeze({
    host,
    registry: createServerFunctionRegistry<ApplicationExecutionContextV1>(implementations),
  });
};

/**
 * Composes generated PostgreSQL functions with bounded telemetry and one scheduled outbox worker.
 * The caller still owns database pools and must await `close()` before closing them.
 */
export const createPostgresApplicationServerRuntime = (
  graph: ApplicationGraphV1,
  definitions: readonly UiServerFunctionDefinitionV1[],
  pool: ApplicationSqlPoolV1,
  options: PostgresApplicationServerRuntimeOptionsV1 = {},
): PostgresApplicationServerRuntimeV1 => {
  const telemetry = createApplicationTelemetryCollector({
    ...(options.telemetryMaximumSpans === undefined
      ? {}
      : { maximumSpans: options.telemetryMaximumSpans }),
  });
  const telemetrySink: ApplicationTelemetrySinkV1 = options.telemetry
    ? {
        emit(span): void {
          telemetry.emit(span);
          try {
            options.telemetry?.emit(span);
          } catch {
            // External observability cannot change application execution.
          }
        },
      }
    : telemetry;
  const functions = createPostgresApplicationServerFunctions(graph, definitions, pool, {
    ...options.host,
    telemetry: telemetrySink,
  });
  const worker = createPostgresApplicationJobWorker(functions.host, options.worker);
  worker.start();
  let closing: Promise<ApplicationPostgresJobWorkerStopResultV1> | undefined;
  const developmentOperations = async (): Promise<PostgresApplicationDevelopmentOperationsV1> => {
    const snapshot = telemetry.snapshot();
    return Object.freeze({
      appId: graph.app.id,
      capturedAt: new Date().toISOString(),
      deadLetterJobs: await functions.host.listJobs({ limit: 100, status: 'deadLetter' }),
      graphRevision: graph.revision,
      schemaVersion: 'oxe.application-development-operations.v1',
      telemetry: Object.freeze({
        metrics: snapshot.metrics,
        spans: Object.freeze(snapshot.spans.slice(-100)),
      }),
      worker: worker.snapshot(),
    });
  };
  return Object.freeze({
    close: () => (closing ??= worker.stop()),
    developmentOperations,
    host: functions.host,
    registry: functions.registry,
    telemetry,
    worker,
  });
};
