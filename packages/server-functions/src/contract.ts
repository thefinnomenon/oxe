import { OxeServerFunctionError } from './errors.js';
import { enforceEncodedSize, normalizeDefinition, resolveSerializationLimits } from './schema.js';
import {
  SERVER_FUNCTION_MANIFEST_SCHEMA,
  SERVER_FUNCTION_SCHEMA,
  type ServerFunctionDefinitionV1,
  type ServerFunctionManifestV1,
  type ServerFunctionParameterV1,
  type ServerFunctionSerializationLimits,
  type ServerValueSchemaV1,
} from './types.js';

export const defineServerFunction = <
  const Parameters extends readonly ServerFunctionParameterV1[],
  const Returns extends ServerValueSchemaV1,
>(
  definition: Omit<ServerFunctionDefinitionV1<Parameters, Returns>, 'schemaVersion'>,
): ServerFunctionDefinitionV1<Parameters, Returns> => {
  const normalized = normalizeDefinition({
    ...definition,
    schemaVersion: SERVER_FUNCTION_SCHEMA,
  });
  // normalizeDefinition preserves the authored parameter/return contract while making
  // its runtime representation canonical. This cast is isolated at that validation boundary.
  return normalized as ServerFunctionDefinitionV1<Parameters, Returns>;
};

export const createServerFunctionManifest = (
  definitions: readonly ServerFunctionDefinitionV1[],
): ServerFunctionManifestV1 => {
  const ids = new Set<string>();
  const paths = new Set<string>();
  const functions = definitions
    .map(normalizeDefinition)
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const definition of functions) {
    const path = definition.path.join('.');
    if (ids.has(definition.id)) {
      throw new OxeServerFunctionError(
        'OXE_SERVER_FUNCTION_DUPLICATE',
        `Duplicate server-function id ${JSON.stringify(definition.id)}.`,
      );
    }
    if (paths.has(path)) {
      throw new OxeServerFunctionError(
        'OXE_SERVER_FUNCTION_DUPLICATE',
        `Duplicate server-function path ${JSON.stringify(path)}.`,
      );
    }
    ids.add(definition.id);
    paths.add(path);
  }
  return Object.freeze({
    functions: Object.freeze(functions),
    schemaVersion: SERVER_FUNCTION_MANIFEST_SCHEMA,
  });
};

export const serializeServerFunctionManifest = (
  manifest: ServerFunctionManifestV1,
  limits?: ServerFunctionSerializationLimits,
): string => {
  if (manifest.schemaVersion !== SERVER_FUNCTION_MANIFEST_SCHEMA) {
    throw new OxeServerFunctionError(
      'OXE_SERVER_FUNCTION_INVALID_CONTRACT',
      'Expected an oxe.server-function-manifest.v1 manifest.',
    );
  }
  const canonical = createServerFunctionManifest(manifest.functions);
  return enforceEncodedSize(JSON.stringify(canonical), resolveSerializationLimits(limits));
};
