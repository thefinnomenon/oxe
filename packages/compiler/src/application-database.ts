import {
  ApplicationGraphValidationError,
  canonicalizeApplicationGraph,
  indexApplicationGraph,
  validateApplicationGraph,
  type ApplicationFieldV1,
  type ApplicationGraphV1,
  type ApplicationRelationEndpointV1,
  type ApplicationScalarValueV1,
} from '@oxe/graph';

export type ApplicationDatabaseDiagnosticCode = 'OXE2301' | 'OXE2302' | 'OXE2303' | 'OXE2304';

export interface ApplicationDatabaseDiagnostic {
  readonly code: ApplicationDatabaseDiagnosticCode;
  readonly message: string;
  readonly path: string;
  readonly semanticId?: string;
}

export class ApplicationDatabaseProjectionError extends Error {
  public constructor(public readonly diagnostics: readonly ApplicationDatabaseDiagnostic[]) {
    super(
      diagnostics
        .map((diagnostic) => `${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`)
        .join('\n'),
    );
    this.name = 'ApplicationDatabaseProjectionError';
  }
}

export type ApplicationDatabaseColumnTypeV1 =
  | { readonly kind: 'boolean' }
  | { readonly kind: 'bytes' }
  | { readonly kind: 'date' }
  | { readonly kind: 'dateTime' }
  | { readonly kind: 'decimal'; readonly precision: number; readonly scale: number }
  | { readonly kind: 'email' }
  | { readonly entityId: string; readonly kind: 'entityId' }
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'integer'; readonly maximum?: number; readonly minimum?: number }
  | { readonly kind: 'json' }
  | { readonly kind: 'number' }
  | { readonly kind: 'string' }
  | { readonly kind: 'url' };

export interface ApplicationDatabaseStringLengthConstraintV1 {
  readonly kind: 'stringLength';
  readonly maximum?: number;
  readonly minimum?: number;
}

export interface ApplicationDatabaseColumnV1 {
  readonly default?: ApplicationScalarValueV1;
  readonly fieldId: string;
  readonly generation?: 'current-date-time' | 'entity-id';
  readonly name: string;
  readonly nullable: boolean;
  readonly sourcePath: string;
  readonly type: ApplicationDatabaseColumnTypeV1;
  readonly validation?: readonly ApplicationDatabaseStringLengthConstraintV1[];
}

export interface ApplicationDatabaseTableV1 {
  readonly columns: readonly ApplicationDatabaseColumnV1[];
  readonly entityId: string;
  readonly name: string;
  readonly primaryKeyFieldId: string;
  readonly sourcePath: string;
}

export interface ApplicationDatabaseExternalEntityV1 {
  readonly entityId: string;
  readonly name: string;
  readonly sourcePath: string;
}

export interface ApplicationDatabaseRelationEndpointV1 {
  readonly cardinality: 'many' | 'one';
  readonly createValue?:
    { readonly contextId: string; readonly kind: 'activeContext' } | { readonly kind: 'actor' };
  readonly entityId: string;
  readonly name: string;
  readonly required: boolean;
}

export interface ApplicationDatabaseRelationV1 {
  readonly from: ApplicationDatabaseRelationEndpointV1;
  readonly relationId: string;
  readonly sourcePath: string;
  readonly to: ApplicationDatabaseRelationEndpointV1;
}

export interface ApplicationDatabaseUniqueConstraintV1 {
  readonly constraintId: string;
  readonly entityId: string;
  readonly keys: readonly string[];
  readonly sourcePath: string;
}

/** Storage-neutral database compiler IR. It is derived from, but is not, the semantic graph. */
export interface ApplicationDatabaseSchemaProjectionV1 {
  readonly appId: string;
  readonly externalEntities: readonly ApplicationDatabaseExternalEntityV1[];
  readonly relations: readonly ApplicationDatabaseRelationV1[];
  readonly revision: number;
  readonly schemaVersion: 'oxe.application-database-schema.v1';
  readonly tables: readonly ApplicationDatabaseTableV1[];
  readonly uniques: readonly ApplicationDatabaseUniqueConstraintV1[];
}

export type ApplicationDatabaseMigrationOperationV1 =
  | {
      readonly operationId: string;
      readonly table: ApplicationDatabaseTableV1;
      readonly type: 'table.add';
    }
  | {
      readonly column: ApplicationDatabaseColumnV1;
      readonly entityId: string;
      readonly operationId: string;
      readonly type: 'column.add';
    }
  | {
      readonly operationId: string;
      readonly relation: ApplicationDatabaseRelationV1;
      readonly type: 'relation.add';
    }
  | {
      readonly operationId: string;
      readonly unique: ApplicationDatabaseUniqueConstraintV1;
      readonly type: 'unique.add';
    };

/** The first migration IR is deliberately additive-only and therefore safe to plan automatically. */
export interface ApplicationDatabaseMigrationPlanV1 {
  readonly appId: string;
  readonly fromRevision: number;
  readonly operations: readonly ApplicationDatabaseMigrationOperationV1[];
  readonly schemaVersion: 'oxe.application-database-migration.v1';
  readonly toRevision: number;
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const fail = (
  code: ApplicationDatabaseDiagnosticCode,
  path: string,
  message: string,
  semanticId?: string,
): never => {
  throw new ApplicationDatabaseProjectionError([
    { code, message, path, ...(semanticId === undefined ? {} : { semanticId }) },
  ]);
};

const projectFieldType = (
  field: ApplicationFieldV1,
  path: string,
): ApplicationDatabaseColumnTypeV1 => {
  switch (field.valueType.kind) {
    case 'boolean':
    case 'bytes':
    case 'date':
    case 'dateTime':
    case 'email':
    case 'number':
    case 'string':
    case 'url':
      return { kind: field.valueType.kind };
    case 'decimal':
      return {
        kind: 'decimal',
        precision: field.valueType.precision,
        scale: field.valueType.scale,
      };
    case 'integer':
      return {
        kind: 'integer',
        ...(field.valueType.maximum === undefined ? {} : { maximum: field.valueType.maximum }),
        ...(field.valueType.minimum === undefined ? {} : { minimum: field.valueType.minimum }),
      };
    case 'list':
    case 'record':
    case 'result':
      return { kind: 'json' };
    case 'optional':
      return projectFieldType({ ...field, valueType: field.valueType.value }, path);
    case 'entityId':
      return { entityId: field.valueType.entity, kind: 'entityId' };
    case 'enum':
      return { kind: 'enum', values: [...field.valueType.values] };
    case 'entity':
      return fail(
        'OXE2301',
        `${path}.valueType`,
        `Field type "${field.valueType.kind}" cannot be stored as a scalar database column.`,
        field.id,
      );
  }
};

const projectGeneration = (
  field: ApplicationFieldV1,
  path: string,
): ApplicationDatabaseColumnV1['generation'] => {
  if (field.origin !== 'generated') return undefined;
  if (field.valueType.kind === 'entityId') return 'entity-id';
  if (field.valueType.kind === 'dateTime') return 'current-date-time';
  return fail(
    'OXE2301',
    `${path}.origin`,
    `Generated field "${field.id}" has no database generation strategy.`,
    field.id,
  );
};

const projectEndpoint = (
  endpoint: ApplicationRelationEndpointV1,
): ApplicationDatabaseRelationEndpointV1 => ({
  cardinality: endpoint.cardinality,
  ...(endpoint.createValue
    ? {
        createValue:
          endpoint.createValue.kind === 'actor'
            ? { kind: 'actor' as const }
            : { contextId: endpoint.createValue.context, kind: 'activeContext' as const },
      }
    : {}),
  entityId: endpoint.entity,
  name: endpoint.name,
  required: endpoint.required,
});

/** Lowers a validated semantic graph into deterministic, storage-neutral relational schema IR. */
export const lowerApplicationGraphToDatabaseSchema = (
  input: ApplicationGraphV1,
): ApplicationDatabaseSchemaProjectionV1 => {
  const graphDiagnostics = validateApplicationGraph(input);
  if (graphDiagnostics.length > 0) throw new ApplicationGraphValidationError(graphDiagnostics);
  const graph = canonicalizeApplicationGraph(input);
  const paths = new Map(indexApplicationGraph(graph).nodes.map((node) => [node.id, node.path]));
  const fields = new Map(graph.fields.map((field) => [field.id, field]));
  const externalEntities: ApplicationDatabaseExternalEntityV1[] = [];
  const tables: ApplicationDatabaseTableV1[] = [];

  for (const entity of graph.entities) {
    const sourcePath = paths.get(entity.id) ?? '$.entities';
    if (entity.origin === 'builtin') {
      if ((entity.fields?.length ?? 0) > 0)
        fail(
          'OXE2301',
          `${sourcePath}.fields`,
          `Built-in entity "${entity.id}" cannot own application database columns.`,
          entity.id,
        );
      externalEntities.push({ entityId: entity.id, name: entity.name, sourcePath });
      continue;
    }

    const entityFields = (entity.fields ?? []).map((fieldId) => {
      const field = fields.get(fieldId);
      if (!field)
        return fail(
          'OXE2301',
          `${sourcePath}.fields`,
          `Validated field "${fieldId}" is unavailable during database lowering.`,
          entity.id,
        );
      return field;
    });
    const primaryKeys = entityFields.filter(
      (field) => field.valueType.kind === 'entityId' && field.valueType.entity === entity.id,
    );
    if (primaryKeys.length !== 1)
      fail(
        'OXE2301',
        `${sourcePath}.fields`,
        `Stored entity "${entity.id}" requires exactly one self-typed entityId primary key; found ${primaryKeys.length}.`,
        entity.id,
      );

    const columns = entityFields
      .map((field): ApplicationDatabaseColumnV1 => {
        const fieldPath = paths.get(field.id) ?? '$.fields';
        const generation = projectGeneration(field, fieldPath);
        const validation = field.validation?.map((constraint) => ({
          kind: constraint.kind,
          ...(constraint.max === undefined ? {} : { maximum: constraint.max }),
          ...(constraint.min === undefined ? {} : { minimum: constraint.min }),
        }));
        return {
          ...(field.default ? { default: field.default.value } : {}),
          fieldId: field.id,
          ...(generation === undefined ? {} : { generation }),
          name: field.name,
          nullable: !field.required || field.valueType.kind === 'optional',
          sourcePath: fieldPath,
          type: projectFieldType(field, fieldPath),
          ...(validation && validation.length > 0 ? { validation } : {}),
        };
      })
      .sort((left, right) => compareText(left.fieldId, right.fieldId));
    tables.push({
      columns,
      entityId: entity.id,
      name: entity.name,
      primaryKeyFieldId: primaryKeys[0]!.id,
      sourcePath,
    });
  }

  const relations = graph.relations.map((relation): ApplicationDatabaseRelationV1 => ({
    from: projectEndpoint(relation.from),
    relationId: relation.id,
    sourcePath: paths.get(relation.id) ?? '$.relations',
    to: projectEndpoint(relation.to),
  }));
  const uniques = (graph.uniques ?? []).map((unique): ApplicationDatabaseUniqueConstraintV1 => ({
    constraintId: unique.id,
    entityId: unique.entity,
    keys: [...unique.keys],
    sourcePath: paths.get(unique.id) ?? '$.uniques',
  }));

  return {
    appId: graph.app.id,
    externalEntities: externalEntities.sort((left, right) =>
      compareText(left.entityId, right.entityId),
    ),
    relations: relations.sort((left, right) => compareText(left.relationId, right.relationId)),
    revision: graph.revision,
    schemaVersion: 'oxe.application-database-schema.v1',
    tables: tables.sort((left, right) => compareText(left.entityId, right.entityId)),
    uniques: uniques.sort((left, right) => compareText(left.constraintId, right.constraintId)),
  };
};

const storageColumnContract = (column: ApplicationDatabaseColumnV1): string =>
  JSON.stringify({
    default: column.default ?? null,
    generation: column.generation ?? null,
    nullable: column.nullable,
    type: column.type,
    validation: column.validation ?? [],
  });

const storageRelationContract = (relation: ApplicationDatabaseRelationV1): string =>
  JSON.stringify({ from: relation.from, to: relation.to });

const relationStorageEntity = (relation: ApplicationDatabaseRelationV1): string => {
  if (relation.from.cardinality === 'one' && relation.to.cardinality === 'many')
    return relation.from.entityId;
  if (relation.to.cardinality === 'one' && relation.from.cardinality === 'many')
    return relation.to.entityId;
  if (relation.from.createValue) return relation.from.entityId;
  if (relation.to.createValue) return relation.to.entityId;
  return relation.from.entityId;
};

const assertNoRemovedIds = <T extends { readonly sourcePath: string }, Key extends keyof T>(
  before: readonly T[],
  afterIds: ReadonlySet<T[Key]>,
  idKey: Key,
  kind: string,
): void => {
  const removed = before.find((item) => !afterIds.has(item[idKey]));
  if (!removed) return;
  const semanticId = String(removed[idKey]);
  fail(
    'OXE2303',
    removed.sourcePath,
    `Removing database ${kind} "${semanticId}" is destructive and is not supported by the additive migration planner.`,
    semanticId,
  );
};

/** Plans deterministic additive operations between two application graph revisions. */
export const planApplicationDatabaseMigration = (
  fromGraph: ApplicationGraphV1,
  toGraph: ApplicationGraphV1,
): ApplicationDatabaseMigrationPlanV1 => {
  const from = lowerApplicationGraphToDatabaseSchema(fromGraph);
  const to = lowerApplicationGraphToDatabaseSchema(toGraph);
  if (from.appId !== to.appId)
    fail(
      'OXE2302',
      '$.app.id',
      `Cannot migrate application "${from.appId}" to unrelated application "${to.appId}".`,
      to.appId,
    );
  if (to.revision <= from.revision)
    fail(
      'OXE2302',
      '$.revision',
      `Migration target revision r${to.revision} must be newer than r${from.revision}.`,
      to.appId,
    );

  const toExternalIds = new Set(to.externalEntities.map((entity) => entity.entityId));
  const toTableIds = new Set(to.tables.map((table) => table.entityId));
  const toRelationIds = new Set(to.relations.map((relation) => relation.relationId));
  const toUniqueIds = new Set(to.uniques.map((unique) => unique.constraintId));
  assertNoRemovedIds(from.externalEntities, toExternalIds, 'entityId', 'external entity');
  assertNoRemovedIds(from.tables, toTableIds, 'entityId', 'table');
  assertNoRemovedIds(from.relations, toRelationIds, 'relationId', 'relation');
  assertNoRemovedIds(from.uniques, toUniqueIds, 'constraintId', 'unique constraint');

  const operations: ApplicationDatabaseMigrationOperationV1[] = [];
  const fromTables = new Map(from.tables.map((table) => [table.entityId, table]));
  const addedTableIds = new Set<string>();
  for (const table of to.tables) {
    const previous = fromTables.get(table.entityId);
    if (!previous) {
      addedTableIds.add(table.entityId);
      operations.push({ operationId: `table.add:${table.entityId}`, table, type: 'table.add' });
      continue;
    }
    if (previous.primaryKeyFieldId !== table.primaryKeyFieldId)
      fail(
        'OXE2304',
        table.sourcePath,
        `Changing the primary key of "${table.entityId}" is not supported by the additive migration planner.`,
        table.entityId,
      );
    const nextColumnIds = new Set(table.columns.map((column) => column.fieldId));
    assertNoRemovedIds(previous.columns, nextColumnIds, 'fieldId', 'column');
    const previousColumns = new Map(previous.columns.map((column) => [column.fieldId, column]));
    for (const column of table.columns) {
      const previousColumn = previousColumns.get(column.fieldId);
      if (!previousColumn) {
        if (!column.nullable && column.default === undefined && column.generation === undefined)
          fail(
            'OXE2304',
            column.sourcePath,
            `Required column "${column.fieldId}" needs a default or generation strategy before it can be added safely.`,
            column.fieldId,
          );
        operations.push({
          column,
          entityId: table.entityId,
          operationId: `column.add:${column.fieldId}`,
          type: 'column.add',
        });
      } else if (storageColumnContract(previousColumn) !== storageColumnContract(column)) {
        fail(
          'OXE2304',
          column.sourcePath,
          `Changing the stored contract of column "${column.fieldId}" is not supported by the additive migration planner.`,
          column.fieldId,
        );
      }
    }
  }

  const fromRelations = new Map(from.relations.map((relation) => [relation.relationId, relation]));
  for (const relation of to.relations) {
    const previous = fromRelations.get(relation.relationId);
    if (!previous) {
      if (addedTableIds.has(relationStorageEntity(relation))) continue;
      operations.push({
        operationId: `relation.add:${relation.relationId}`,
        relation,
        type: 'relation.add',
      });
    } else if (storageRelationContract(previous) !== storageRelationContract(relation)) {
      fail(
        'OXE2304',
        relation.sourcePath,
        `Changing the stored contract of relation "${relation.relationId}" is not supported by the additive migration planner.`,
        relation.relationId,
      );
    }
  }

  const fromUniques = new Map(from.uniques.map((unique) => [unique.constraintId, unique]));
  for (const unique of to.uniques) {
    const previous = fromUniques.get(unique.constraintId);
    if (!previous) {
      if (addedTableIds.has(unique.entityId)) continue;
      operations.push({
        operationId: `unique.add:${unique.constraintId}`,
        type: 'unique.add',
        unique,
      });
    } else if (
      previous.entityId !== unique.entityId ||
      JSON.stringify(previous.keys) !== JSON.stringify(unique.keys)
    ) {
      fail(
        'OXE2304',
        unique.sourcePath,
        `Changing unique constraint "${unique.constraintId}" is not supported by the additive migration planner.`,
        unique.constraintId,
      );
    }
  }

  operations.sort((left, right) => compareText(left.operationId, right.operationId));
  return {
    appId: to.appId,
    fromRevision: from.revision,
    operations,
    schemaVersion: 'oxe.application-database-migration.v1',
    toRevision: to.revision,
  };
};

/** Deterministic JSON projection for snapshots, diagnostics, and target-specific emitters. */
export const serializeApplicationDatabaseProjection = (
  projection: ApplicationDatabaseSchemaProjectionV1 | ApplicationDatabaseMigrationPlanV1,
): string => `${JSON.stringify(projection, null, 2)}\n`;
