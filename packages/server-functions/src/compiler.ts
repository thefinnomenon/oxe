import type { PlatformCapabilityContract } from '@oxe/compiler';

import { normalizeDefinition } from './schema.js';
import type { ServerFunctionDefinitionV1, ServerValueSchemaV1 } from './types.js';

const primitiveType = (
  schema: ServerValueSchemaV1,
): PlatformCapabilityContract['parameters'][number] => schema.kind;

/** Converts the authoritative RPC definition into the compiler's callable capability contract. */
export const serverFunctionCompilerCapability = (
  definition: ServerFunctionDefinitionV1,
): PlatformCapabilityContract => {
  const normalized = normalizeDefinition(definition);
  return {
    kind: 'async',
    name: normalized.path.join('.'),
    parameters: normalized.parameters.map((parameter) => primitiveType(parameter.schema)),
    returns: primitiveType(normalized.returns),
    serverFunctionId: normalized.id,
    target: 'universal',
  };
};
