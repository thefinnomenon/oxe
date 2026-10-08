import {
  ApplicationHostError,
  createInMemoryApplicationHost,
  type ApplicationExecutionContextV1,
  type ApplicationGraphV1,
  type ApplicationMemoryHostOptionsV1,
  type ApplicationMemoryHostV1,
  type ApplicationRuntimeValueV1,
  type UiServerFunctionDefinitionV1,
} from '@oxe/graph';

import { OxeServerFunctionError, OxeServerFunctionPublicError } from './errors.js';
import { createServerFunctionRegistry, implementServerFunction } from './server.js';
import type { ServerFunctionRegistry } from './types.js';

export interface InMemoryApplicationServerFunctionsV1 {
  readonly host: ApplicationMemoryHostV1;
  readonly registry: ServerFunctionRegistry<ApplicationExecutionContextV1>;
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

const executeSafely = <Value>(run: () => Value): Value => {
  try {
    return run();
  } catch (error) {
    if (error instanceof ApplicationHostError)
      throw new OxeServerFunctionPublicError(error.kind, error.message, { cause: error });
    throw error;
  }
};

export const createInMemoryApplicationServerFunctions = (
  graph: ApplicationGraphV1,
  definitions: readonly UiServerFunctionDefinitionV1[],
  options: ApplicationMemoryHostOptionsV1 = {},
): InMemoryApplicationServerFunctionsV1 => {
  const host = createInMemoryApplicationHost(graph, options);
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
