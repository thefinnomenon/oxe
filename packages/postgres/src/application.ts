import { randomUUID } from 'node:crypto';

import { compileApplicationPostgresSchema, type ApplicationPostgresTableV1 } from '@oxe/compiler';
import {
  ApplicationGraphValidationError,
  ApplicationHostError,
  calculateApplicationJobRetryDelay,
  applicationValueMatchesType,
  canonicalizeApplicationGraph,
  createApplicationSpanRecorder,
  resolveApplicationJobRetry,
  validateApplicationGraph,
  type ApplicationExecutionContextV1,
  type ApplicationCapabilityInvocationV1,
  type ApplicationContextSelectionV1,
  type ApplicationContextAuthorizationMethodV1,
  type ApplicationExecutionContextEntryV1,
  type ApplicationFieldV1,
  type ApplicationGraphV1,
  type ApplicationJobListOptionsV1,
  type ApplicationJobReplayOptionsV1,
  type ApplicationJobRunSummaryV1,
  type ApplicationOutboxJobV1,
  type ApplicationOperationV1,
  type ApplicationPolicyPredicateV1,
  type ApplicationRuntimeValueV1,
  type ApplicationTelemetrySinkV1,
  type ApplicationValueExpressionV1,
  type ApplicationValueTypeV1,
} from '@oxe/graph';

import type { ApplicationSqlConnectionV1, ApplicationSqlPoolV1 } from './types.js';

export interface ApplicationPostgresHostOptionsV1 {
  readonly capabilityAdapters?: Readonly<Record<string, ApplicationPostgresCapabilityAdapterV1>>;
  readonly clock?: () => number;
  readonly externalReferenceExists?: (
    reference: Readonly<{
      entityId: string;
      recordId: string;
      relationId: string;
    }>,
    signal?: AbortSignal,
  ) => Promise<boolean>;
  readonly generateId?: () => string;
  readonly generateJobId?: () => string;
  readonly generateSpanId?: () => string;
  readonly jobClock?: () => number;
  readonly now?: () => string;
  readonly random?: () => number;
  readonly telemetry?: ApplicationTelemetrySinkV1;
}

export interface ApplicationPostgresCapabilityAdapterV1 {
  /** Required for queued delivery; the adapter must deduplicate on `delivery.jobId`. */
  readonly idempotency?: 'jobId';
  invoke(
    invocation: ApplicationCapabilityInvocationV1,
    context: ApplicationExecutionContextV1,
    signal?: AbortSignal,
  ): Promise<ApplicationRuntimeValueV1> | ApplicationRuntimeValueV1;
}

export interface ApplicationPostgresHostV1 {
  execute(
    operationId: string,
    input: Readonly<Record<string, ApplicationRuntimeValueV1>>,
    context: ApplicationExecutionContextV1,
    signal?: AbortSignal,
  ): Promise<ApplicationRuntimeValueV1>;
  query(
    queryId: string,
    context: ApplicationExecutionContextV1,
    signal?: AbortSignal,
  ): Promise<readonly Readonly<Record<string, ApplicationRuntimeValueV1>>[]>;
  listJobs(options?: ApplicationJobListOptionsV1): Promise<readonly ApplicationOutboxJobV1[]>;
  replayJob(
    jobId: string,
    options?: ApplicationJobReplayOptionsV1,
  ): Promise<ApplicationOutboxJobV1>;
  runJobs(options?: ApplicationPostgresJobRunOptionsV1): Promise<ApplicationJobRunSummaryV1>;
}

export interface ApplicationPostgresJobRunOptionsV1 {
  readonly leaseMs?: number;
  readonly limit?: number;
  readonly signal?: AbortSignal;
  readonly workerId?: string;
}

export interface ApplicationContextOptionV1 {
  readonly contextId: string;
  readonly entityId: string;
  readonly label: string;
  readonly recordId: string;
}

type Row = Record<string, unknown>;

interface ApplicationOutboxRow extends Row {
  readonly attempts: unknown;
  readonly available_at: unknown;
  readonly capability_id: unknown;
  readonly created_at: unknown;
  readonly id: unknown;
  readonly last_error_kind: unknown;
  readonly max_attempts: unknown;
  readonly method: unknown;
  readonly status: unknown;
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const validation = (message: string): never => {
  throw new ApplicationHostError('OXE3401', 'validation', message);
};

const unauthorized = (): never => {
  throw new ApplicationHostError('OXE3402', 'unauthorized', 'Authentication is required.');
};

const forbidden = (): never => {
  throw new ApplicationHostError('OXE3403', 'forbidden', 'The user cannot access this record.');
};

const notFound = (kind: string, id: string): never => {
  throw new ApplicationHostError('OXE3404', 'not-found', `${kind} "${id}" was not found.`);
};

const checkSignal = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) validation('Application execution was aborted.');
};

const applicationJobTime = (clock: (() => number) | undefined): number => {
  const value = (clock ?? Date.now)();
  if (!Number.isFinite(value) || !Number.isFinite(new Date(value).getTime()))
    validation('The application job clock returned an invalid value.');
  return value;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const userIdFor = (context: ApplicationExecutionContextV1): string => {
  if (!context.userId) return unauthorized();
  const entities = new Set<string>();
  for (const activeContext of context.activeContexts ?? []) {
    if (!activeContext.contextId || !activeContext.entityId || !activeContext.recordId)
      validation('Active contexts require non-empty contextId, entityId, and recordId values.');
    if (entities.has(activeContext.contextId))
      validation(`Active context role "${activeContext.contextId}" is selected more than once.`);
    entities.add(activeContext.contextId);
  }
  return context.userId;
};

const valueMatchesType = applicationValueMatchesType;

const validateFieldValue = (field: ApplicationFieldV1, value: unknown): void => {
  if (!valueMatchesType(value, field.valueType))
    validation(`Field "${field.id}" has an invalid value.`);
  if (field.valueType.kind === 'string' && typeof value === 'string')
    for (const constraint of field.validation ?? []) {
      if (constraint.min !== undefined && value.length < constraint.min)
        validation(`Field "${field.name}" must contain at least ${constraint.min} characters.`);
      if (constraint.max !== undefined && value.length > constraint.max)
        validation(`Field "${field.name}" must contain at most ${constraint.max} characters.`);
    }
};

const decodedTypeValue = (type: ApplicationValueTypeV1, value: unknown): unknown => {
  if (type.kind === 'dateTime' && value instanceof Date) return value.toISOString();
  if (type.kind === 'integer' && typeof value === 'string' && /^-?\d+$/u.test(value)) {
    const decoded = Number(value);
    return Number.isSafeInteger(decoded) ? decoded : value;
  }
  if (type.kind === 'optional') return value === null ? null : decodedTypeValue(type.value, value);
  if (type.kind === 'list' && Array.isArray(value))
    return value.map((item) => decodedTypeValue(type.items, item));
  return value;
};

const decodedValue = (field: ApplicationFieldV1, value: unknown): ApplicationRuntimeValueV1 => {
  const decoded = decodedTypeValue(field.valueType, value);
  validateFieldValue(field, decoded);
  return decoded as ApplicationRuntimeValueV1;
};

const timestampText = (value: unknown, label: string): string => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === 'string' && Number.isFinite(Date.parse(value)))
    return new Date(value).toISOString();
  return validation(`${label} has an invalid timestamp.`);
};

const publicOutboxJob = (row: ApplicationOutboxRow): ApplicationOutboxJobV1 => {
  const status =
    row.status === 'dead_letter'
      ? 'deadLetter'
      : row.status === 'completed' || row.status === 'pending' || row.status === 'running'
        ? row.status
        : validation('Outbox job has an invalid status.');
  return Object.freeze({
    attempts:
      typeof row.attempts === 'number'
        ? row.attempts
        : validation('Outbox job has invalid attempts.'),
    availableAt: timestampText(row.available_at, 'Outbox job availableAt'),
    capabilityId:
      typeof row.capability_id === 'string'
        ? row.capability_id
        : validation('Outbox job has an invalid capability id.'),
    createdAt: timestampText(row.created_at, 'Outbox job createdAt'),
    id: typeof row.id === 'string' ? row.id : validation('Outbox job has an invalid id.'),
    ...(row.last_error_kind === 'delivery' ? { lastErrorKind: 'delivery' as const } : {}),
    maxAttempts:
      typeof row.max_attempts === 'number'
        ? row.max_attempts
        : validation('Outbox job has invalid max attempts.'),
    method:
      typeof row.method === 'string' ? row.method : validation('Outbox job has an invalid method.'),
    status,
  });
};

const operationEntityId = (operation: ApplicationOperationV1): string => {
  if (operation.body.kind === 'createEntity') return operation.body.entity;
  if (operation.output.kind === 'entity') return operation.output.entity;
  return validation(`Operation "${operation.id}" has no entity output for PostgreSQL execution.`);
};

/** Resolves untrusted semantic context-role selections against current PostgreSQL authorization. */
export const resolvePostgresApplicationActiveContexts = async (
  input: ApplicationGraphV1,
  pool: ApplicationSqlPoolV1,
  userId: string,
  requested: readonly ApplicationContextSelectionV1[],
): Promise<readonly ApplicationExecutionContextEntryV1[]> => {
  const diagnostics = validateApplicationGraph(input);
  if (diagnostics.length > 0) throw new ApplicationGraphValidationError(diagnostics);
  if (!userId) return unauthorized();
  const graph = canonicalizeApplicationGraph(input);
  const schema = compileApplicationPostgresSchema(graph);
  const contexts = new Map((graph.contexts ?? []).map((context) => [context.id, context]));
  const requestedByContext = new Map<string, string>();
  for (const selection of requested) {
    if (!contexts.has(selection.contextId) || !graph.app.contexts?.includes(selection.contextId))
      validation(`Context role "${selection.contextId}" is not declared by the application.`);
    if (!selection.recordId) validation(`Context role "${selection.contextId}" needs a record id.`);
    if (requestedByContext.has(selection.contextId))
      validation(`Context role "${selection.contextId}" is selected more than once.`);
    requestedByContext.set(selection.contextId, selection.recordId);
  }
  const tableFor = (entityId: string): ApplicationPostgresTableV1 =>
    schema.tables.find((table) => table.entityId === entityId) ?? notFound('Table', entityId);
  const relationLocation = (relationId: string) => {
    const table = schema.tables.find((candidate) =>
      candidate.columns.some((column) => column.relationId === relationId),
    );
    const column = table?.columns.find((candidate) => candidate.relationId === relationId);
    if (!table || !column) return notFound('Relation column', relationId);
    return { column, table };
  };
  const qualified = (table: ApplicationPostgresTableV1): string =>
    `${quoteIdentifier(schema.schemaName)}.${quoteIdentifier(table.physicalName)}`;
  const primaryKey = (table: ApplicationPostgresTableV1): string =>
    quoteIdentifier(table.primaryKey.columnName);
  const relationColumn = (relationId: string): string =>
    quoteIdentifier(relationLocation(relationId).column.physicalName);
  const exists = async (statement: string, parameters: readonly unknown[]): Promise<boolean> =>
    (await pool.query(statement, parameters)).rowCount > 0;
  const resolved: ApplicationExecutionContextEntryV1[] = [];
  for (const contextId of graph.app.contexts ?? []) {
    const recordId = requestedByContext.get(contextId);
    if (!recordId) continue;
    const context = contexts.get(contextId) ?? notFound('Context role', contextId);
    const authorizationMatches = async (
      authorization: ApplicationContextAuthorizationMethodV1,
    ): Promise<boolean> => {
      if (authorization.kind === 'relationEqualsActor') {
        const table = tableFor(context.entity);
        const location = relationLocation(authorization.relation);
        if (location.table.entityId !== context.entity)
          validation(
            `Context authorization relation "${authorization.relation}" is not stored on "${context.entity}".`,
          );
        return exists(
          `SELECT 1 FROM ${qualified(table)} WHERE ${primaryKey(table)} = $1 AND ${relationColumn(authorization.relation)} = $2`,
          [recordId, userId],
        );
      }
      const membershipTable = tableFor(authorization.membershipEntity);
      const memberLocation = relationLocation(authorization.memberRelation);
      const resourceLocation = relationLocation(authorization.resourceRelation);
      if (
        memberLocation.table.entityId !== membershipTable.entityId ||
        resourceLocation.table.entityId !== membershipTable.entityId
      )
        validation(
          `Context role "${context.id}" membership relations must be stored on its membership entity.`,
        );
      const conditions = authorization.conditions ?? [];
      const conditionColumns = conditions.map((condition) => {
        const column = membershipTable.columns.find(
          (candidate) => candidate.fieldId === condition.field,
        );
        if (!column) return notFound('Membership condition column', condition.field);
        return column.physicalName;
      });
      return exists(
        `SELECT 1 FROM ${qualified(membershipTable)} WHERE ${relationColumn(authorization.memberRelation)} = $1 AND ${relationColumn(authorization.resourceRelation)} = $2${conditionColumns.map((column, index) => ` AND ${quoteIdentifier(column)} = $${index + 3}`).join('')}`,
        [userId, recordId, ...conditions.map((condition) => condition.equals)],
      );
    };
    const authorizationMethods =
      context.authorization.kind === 'anyOf'
        ? context.authorization.anyOf
        : [context.authorization];
    let authorized = false;
    for (const authorization of authorizationMethods)
      if (await authorizationMatches(authorization)) {
        authorized = true;
        break;
      }
    if (!authorized) forbidden();
    for (const parent of context.parents ?? []) {
      const parentRecordId = requestedByContext.get(parent.context);
      if (!parentRecordId)
        throw new ApplicationHostError(
          'OXE3403',
          'forbidden',
          `Context role "${context.id}" requires parent context "${parent.context}".`,
        );
      const location = relationLocation(parent.relation);
      const table = location.table;
      const sourceRecordId = table.entityId === context.entity ? recordId : parentRecordId;
      const targetRecordId = table.entityId === context.entity ? parentRecordId : recordId;
      if (
        !(await exists(
          `SELECT 1 FROM ${qualified(table)} WHERE ${primaryKey(table)} = $1 AND ${quoteIdentifier(location.column.physicalName)} = $2`,
          [sourceRecordId, targetRecordId],
        ))
      )
        forbidden();
    }
    resolved.push(Object.freeze({ contextId, entityId: context.entity, recordId }));
  }
  return Object.freeze(resolved);
};

/** Lists the records a user may select for one graph-declared context role. */
export const listPostgresApplicationContextOptions = async (
  input: ApplicationGraphV1,
  pool: ApplicationSqlPoolV1,
  userId: string,
  contextId: string,
): Promise<readonly ApplicationContextOptionV1[]> => {
  const diagnostics = validateApplicationGraph(input);
  if (diagnostics.length > 0) throw new ApplicationGraphValidationError(diagnostics);
  if (!userId) return unauthorized();
  const graph = canonicalizeApplicationGraph(input);
  const context =
    graph.contexts?.find((candidate) => candidate.id === contextId) ??
    notFound('Context role', contextId);
  if (!graph.app.contexts?.includes(contextId))
    validation(`Context role "${contextId}" is not declared by the application.`);
  const labelField =
    context.labelField ?? validation(`Context role "${contextId}" does not declare a label field.`);
  const schema = compileApplicationPostgresSchema(graph);
  const tableFor = (entityId: string): ApplicationPostgresTableV1 =>
    schema.tables.find((table) => table.entityId === entityId) ?? notFound('Table', entityId);
  const relationLocation = (relationId: string) => {
    const table = schema.tables.find((candidate) =>
      candidate.columns.some((column) => column.relationId === relationId),
    );
    const column = table?.columns.find((candidate) => candidate.relationId === relationId);
    if (!table || !column) return notFound('Relation column', relationId);
    return { column, table };
  };
  const qualified = (table: ApplicationPostgresTableV1): string =>
    `${quoteIdentifier(schema.schemaName)}.${quoteIdentifier(table.physicalName)}`;
  const resourceTable = tableFor(context.entity);
  const labelColumn =
    resourceTable.columns.find((column) => column.fieldId === labelField) ??
    notFound('Context label column', labelField);
  const methods =
    context.authorization.kind === 'anyOf' ? context.authorization.anyOf : [context.authorization];
  const options = new Map<string, ApplicationContextOptionV1>();
  for (const authorization of methods) {
    let statement: string;
    let parameters: readonly unknown[];
    if (authorization.kind === 'relationEqualsActor') {
      const owner = relationLocation(authorization.relation);
      if (owner.table.entityId !== context.entity)
        validation(
          `Context authorization relation "${authorization.relation}" is not stored on "${context.entity}".`,
        );
      statement = `SELECT ${quoteIdentifier(resourceTable.primaryKey.columnName)} AS "recordId", ${quoteIdentifier(labelColumn.physicalName)} AS "label" FROM ${qualified(resourceTable)} WHERE ${quoteIdentifier(owner.column.physicalName)} = $1`;
      parameters = [userId];
    } else {
      const membershipTable = tableFor(authorization.membershipEntity);
      const member = relationLocation(authorization.memberRelation);
      const resource = relationLocation(authorization.resourceRelation);
      if (
        member.table.entityId !== membershipTable.entityId ||
        resource.table.entityId !== membershipTable.entityId
      )
        validation(
          `Context role "${context.id}" membership relations must be stored on its membership entity.`,
        );
      const conditions = authorization.conditions ?? [];
      const conditionColumns = conditions.map((condition) => {
        const column = membershipTable.columns.find(
          (candidate) => candidate.fieldId === condition.field,
        );
        if (!column) return notFound('Membership condition column', condition.field);
        return column.physicalName;
      });
      statement = `SELECT resource.${quoteIdentifier(resourceTable.primaryKey.columnName)} AS "recordId", resource.${quoteIdentifier(labelColumn.physicalName)} AS "label" FROM ${qualified(membershipTable)} AS membership JOIN ${qualified(resourceTable)} AS resource ON membership.${quoteIdentifier(resource.column.physicalName)} = resource.${quoteIdentifier(resourceTable.primaryKey.columnName)} WHERE membership.${quoteIdentifier(member.column.physicalName)} = $1${conditionColumns.map((column, index) => ` AND membership.${quoteIdentifier(column)} = $${index + 2}`).join('')}`;
      parameters = [userId, ...conditions.map((condition) => condition.equals)];
    }
    const result = await pool.query<{ readonly label: unknown; readonly recordId: unknown }>(
      statement,
      parameters,
    );
    for (const row of result.rows) {
      const recordId =
        typeof row.recordId === 'string'
          ? row.recordId
          : validation(`Context role "${context.id}" returned an invalid option row.`);
      const label =
        typeof row.label === 'string'
          ? row.label
          : validation(`Context role "${context.id}" returned an invalid option row.`);
      options.set(
        recordId,
        Object.freeze({
          contextId,
          entityId: context.entity,
          label,
          recordId,
        }),
      );
    }
  }
  return Object.freeze(
    [...options.values()].sort(
      (left, right) =>
        compareText(left.label, right.label) || compareText(left.recordId, right.recordId),
    ),
  );
};

/** Builds exact parameterized PostgreSQL operations from one validated application revision. */
export const createPostgresApplicationHost = (
  input: ApplicationGraphV1,
  pool: ApplicationSqlPoolV1,
  options: ApplicationPostgresHostOptionsV1 = {},
): ApplicationPostgresHostV1 => {
  const diagnostics = validateApplicationGraph(input);
  if (diagnostics.length > 0) throw new ApplicationGraphValidationError(diagnostics);
  const graph = canonicalizeApplicationGraph(input);
  const spans = createApplicationSpanRecorder({
    appId: graph.app.id,
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.generateSpanId ? { generateSpanId: options.generateSpanId } : {}),
    graphRevision: graph.revision,
    ...(options.telemetry ? { telemetry: options.telemetry } : {}),
  });
  const schema = compileApplicationPostgresSchema(graph);
  const outboxTable = `${quoteIdentifier(schema.schemaName)}.${quoteIdentifier('__oxe_outbox_jobs')}`;
  const fields = new Map(graph.fields.map((field) => [field.id, field]));
  const entities = new Map(graph.entities.map((entity) => [entity.id, entity]));
  const policies = new Map(graph.policies.map((policy) => [policy.target, policy]));
  const capabilities = new Map(
    (graph.capabilities ?? []).map((capability) => [capability.id, capability]),
  );
  const contextRoles = new Map((graph.contexts ?? []).map((role) => [role.id, role]));

  const validatedUserId = (context: ApplicationExecutionContextV1): string => {
    const userId = userIdFor(context);
    for (const activeContext of context.activeContexts ?? []) {
      const role =
        contextRoles.get(activeContext.contextId) ??
        validation(
          `Active context role "${activeContext.contextId}" is not declared by application "${graph.app.id}".`,
        );
      if (role.entity !== activeContext.entityId)
        validation(
          `Active context role "${role.id}" requires entity "${role.entity}", not "${activeContext.entityId}".`,
        );
    }
    return userId;
  };

  const contextId = (context: ApplicationExecutionContextV1, roleId: string): string => {
    validatedUserId(context);
    const id = context.activeContexts?.find((entry) => entry.contextId === roleId)?.recordId;
    if (!id)
      throw new ApplicationHostError(
        'OXE3403',
        'forbidden',
        `Active context role "${roleId}" is required.`,
      );
    return id;
  };

  const predicateBinding = (
    predicate: ApplicationPolicyPredicateV1,
    context: ApplicationExecutionContextV1,
  ): { readonly relation: string; readonly value: string } | undefined => {
    if (predicate.kind === 'authenticated') {
      validatedUserId(context);
      return undefined;
    }
    return {
      relation: predicate.relation,
      value:
        predicate.kind === 'relationEqualsActor'
          ? validatedUserId(context)
          : contextId(context, predicate.context),
    };
  };

  const tableFor = (entityId: string): ApplicationPostgresTableV1 =>
    schema.tables.find((table) => table.entityId === entityId) ?? notFound('Table', entityId);
  const qualifiedTable = (table: ApplicationPostgresTableV1): string =>
    `${quoteIdentifier(schema.schemaName)}.${quoteIdentifier(table.physicalName)}`;
  const columnForField = (table: ApplicationPostgresTableV1, fieldId: string) =>
    table.columns.find((column) => column.fieldId === fieldId) ?? notFound('Column', fieldId);
  const columnForRelation = (table: ApplicationPostgresTableV1, relationId: string) =>
    table.columns.find((column) => column.relationId === relationId) ??
    notFound('Relation column', relationId);
  const entityFields = (entityId: string): readonly ApplicationFieldV1[] => {
    const entity = entities.get(entityId) ?? notFound('Entity', entityId);
    return (entity.fields ?? []).map(
      (fieldId) => fields.get(fieldId) ?? notFound('Field', fieldId),
    );
  };
  const idField = (entityId: string): ApplicationFieldV1 => {
    const candidates = entityFields(entityId).filter(
      (field) => field.valueType.kind === 'entityId' && field.valueType.entity === entityId,
    );
    return candidates.length === 1
      ? candidates[0]!
      : validation(`Entity "${entityId}" requires exactly one entityId field.`);
  };
  const selectList = (
    table: ApplicationPostgresTableV1,
    selectedFields: readonly ApplicationFieldV1[],
  ): string =>
    selectedFields
      .map(
        (field) =>
          `${quoteIdentifier(columnForField(table, field.id).physicalName)} AS ${quoteIdentifier(field.name)}`,
      )
      .join(', ');
  const publicRow = (
    row: Row,
    selectedFields: readonly ApplicationFieldV1[],
  ): Readonly<Record<string, ApplicationRuntimeValueV1>> =>
    Object.fromEntries(
      [...selectedFields]
        .sort((left, right) => compareText(left.name, right.name))
        .map((field) => [field.name, decodedValue(field, row[field.name])]),
    );
  const policyPredicate = (
    entityId: string,
    action: 'create' | 'delete' | 'read' | 'update',
  ): ApplicationPolicyPredicateV1 => policies.get(entityId)?.rules[action] ?? forbidden();
  const assertExactInput = (
    operation: ApplicationOperationV1,
    operationInput: Readonly<Record<string, ApplicationRuntimeValueV1>>,
  ): void => {
    const expected = Object.keys(operation.input.fields).sort(compareText);
    const actual = Object.keys(operationInput).sort(compareText);
    if (JSON.stringify(expected) !== JSON.stringify(actual))
      validation(`Operation "${operation.id}" received unexpected input fields.`);
    for (const name of expected) {
      const type = operation.input.fields[name]!;
      const value = operationInput[name];
      if (type.kind !== 'entity' && !valueMatchesType(value, type))
        validation(`Input "${name}" has an invalid value.`);
    }
  };
  const evaluateExpression = (
    expression: ApplicationValueExpressionV1,
    operationInput: Readonly<Record<string, ApplicationRuntimeValueV1>>,
    context: ApplicationExecutionContextV1,
    locals: ReadonlyMap<string, ApplicationRuntimeValueV1> = new Map(),
    authoritative?: Readonly<{ entityId: string; row: Row }>,
  ): ApplicationRuntimeValueV1 => {
    if (expression.kind === 'activeContext') return contextId(context, expression.context);
    if (expression.kind === 'actor') return validatedUserId(context);
    if (expression.kind === 'inputField')
      return Object.hasOwn(operationInput, expression.name)
        ? operationInput[expression.name]!
        : validation(`Missing input "${expression.name}".`);
    if (expression.kind === 'literal') return expression.value;
    if (expression.kind === 'local')
      return locals.has(expression.name)
        ? locals.get(expression.name)!
        : validation(`Local "${expression.name}" is not set.`);
    if (expression.kind === 'not') {
      const value = evaluateExpression(
        expression.value,
        operationInput,
        context,
        locals,
        authoritative,
      );
      return typeof value === 'boolean'
        ? !value
        : validation('Boolean negation requires a boolean value.');
    }
    if (expression.kind === 'recordField') {
      const field = fields.get(expression.field) ?? notFound('Field', expression.field);
      const recordValue = evaluateExpression(
        expression.record,
        operationInput,
        context,
        locals,
        authoritative,
      );
      const record = isRecord(recordValue)
        ? recordValue
        : validation('Field selection requires a record.');
      if (authoritative?.entityId === field.entity) {
        const identifier = idField(field.entity);
        if (record[identifier.name] === authoritative.row[identifier.name])
          return decodedValue(field, authoritative.row[field.name]);
      }
      const value = record[field.name];
      if (value === undefined) validation(`Record is missing field "${field.name}".`);
      return value as ApplicationRuntimeValueV1;
    }
    return validation(`Expression "${expression.kind}" cannot execute on the PostgreSQL host.`);
  };

  const assertCreateExternalReferences = async (
    operation: ApplicationOperationV1 & { readonly body: { readonly kind: 'createEntity' } },
    operationInput: Readonly<Record<string, ApplicationRuntimeValueV1>>,
    context: ApplicationExecutionContextV1,
    signal?: AbortSignal,
  ): Promise<void> => {
    if (!options.externalReferenceExists) return;
    const references = schema.externalReferences.filter(
      (reference) => reference.tableEntityId === operation.body.entity,
    );
    for (const reference of references) {
      const relation =
        graph.relations.find((candidate) => candidate.id === reference.relationId) ??
        notFound('Relation', reference.relationId);
      const endpoint = relation.from.entity === operation.body.entity ? relation.from : relation.to;
      const expression = operation.body.values[reference.relationId] ?? endpoint.createValue;
      if (!expression) continue;
      const value = evaluateExpression(expression, operationInput, context);
      const recordId =
        typeof value === 'string'
          ? value
          : validation(`External relation "${reference.relationId}" requires a string record id.`);
      checkSignal(signal);
      if (
        !(await options.externalReferenceExists(
          {
            entityId: reference.entityId,
            recordId,
            relationId: reference.relationId,
          },
          signal,
        ))
      )
        notFound(entities.get(reference.entityId)?.name ?? 'External entity', recordId);
    }
  };

  const query = async (
    queryId: string,
    context: ApplicationExecutionContextV1,
    signal?: AbortSignal,
  ): Promise<readonly Readonly<Record<string, ApplicationRuntimeValueV1>>[]> => {
    checkSignal(signal);
    validatedUserId(context);
    const queryNode =
      graph.queries.find((candidate) => candidate.id === queryId) ?? notFound('Query', queryId);
    const table = tableFor(queryNode.entity);
    const selected = queryNode.select.map(
      (fieldId) => fields.get(fieldId) ?? notFound('Field', fieldId),
    );
    const bindings = [
      predicateBinding(policyPredicate(queryNode.entity, 'read'), context),
      queryNode.filter ? predicateBinding(queryNode.filter, context) : undefined,
    ].filter(
      (binding): binding is { readonly relation: string; readonly value: string } =>
        binding !== undefined,
    );
    const valuesByRelation = new Map<string, string>();
    for (const binding of bindings) {
      const existing = valuesByRelation.get(binding.relation);
      if (existing !== undefined && existing !== binding.value)
        validation(`Relation "${binding.relation}" has conflicting query scope predicates.`);
      valuesByRelation.set(binding.relation, binding.value);
    }
    const uniqueBindings = [...valuesByRelation]
      .sort(([left], [right]) => compareText(left, right))
      .map(([relation, value]) => ({ relation, value }));
    const where = uniqueBindings.map(
      (binding, index) =>
        `${quoteIdentifier(columnForRelation(table, binding.relation).physicalName)} = $${index + 1}`,
    );
    const conditionBindings = [...(queryNode.where ?? [])].sort((left, right) =>
      compareText(left.field, right.field),
    );
    conditionBindings.forEach((condition, index) => {
      const field = fields.get(condition.field) ?? notFound('Field', condition.field);
      validateFieldValue(field, condition.equals);
      where.push(
        `${quoteIdentifier(columnForField(table, condition.field).physicalName)} = $${uniqueBindings.length + index + 1}`,
      );
    });
    const order = (queryNode.order ?? []).map((item) => {
      const column = columnForField(table, item.field);
      return `${quoteIdentifier(column.physicalName)} ${item.direction === 'ascending' ? 'ASC' : 'DESC'}`;
    });
    const primaryKey = columnForField(table, idField(queryNode.entity).id).physicalName;
    if (!order.some((item) => item.startsWith(quoteIdentifier(primaryKey))))
      order.push(`${quoteIdentifier(primaryKey)} ASC`);
    const result = await pool.query(
      `SELECT ${selectList(table, selected)} FROM ${qualifiedTable(table)}${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order.join(', ')}`,
      [
        ...uniqueBindings.map((binding) => binding.value),
        ...conditionBindings.map((condition) => condition.equals),
      ],
    );
    checkSignal(signal);
    return result.rows.map((row) => publicRow(row, selected));
  };

  const executeCreate = async (
    connection: ApplicationSqlConnectionV1,
    operation: ApplicationOperationV1 & { readonly body: { readonly kind: 'createEntity' } },
    operationInput: Readonly<Record<string, ApplicationRuntimeValueV1>>,
    context: ApplicationExecutionContextV1,
    locals: ReadonlyMap<string, ApplicationRuntimeValueV1> = new Map(),
  ): Promise<ApplicationRuntimeValueV1> => {
    const entityId = operation.body.entity;
    const table = tableFor(entityId);
    const values = new Map<string, ApplicationRuntimeValueV1>();
    const relationValues = new Map<string, string>();
    for (const [semanticId, expression] of Object.entries(operation.body.values).sort(
      ([left], [right]) => compareText(left, right),
    )) {
      const value = evaluateExpression(expression, operationInput, context, locals);
      const field = fields.get(semanticId);
      if (field) {
        validateFieldValue(field, value);
        values.set(field.id, value);
      } else if (typeof value === 'string') {
        relationValues.set(semanticId, value);
      } else {
        validation(`Relation "${semanticId}" requires a user or context id.`);
      }
    }
    for (const field of entityFields(entityId)) {
      if (values.has(field.id)) continue;
      const value = field.default
        ? field.default.value
        : field.origin === 'generated' && field.valueType.kind === 'entityId'
          ? (options.generateId ?? randomUUID)()
          : field.origin === 'generated' && field.valueType.kind === 'dateTime'
            ? (options.now ?? (() => new Date().toISOString()))()
            : undefined;
      if (value !== undefined) values.set(field.id, value);
      else if (field.required)
        validation(`Create operation is missing required field "${field.id}".`);
    }
    for (const relation of graph.relations) {
      const endpoint =
        relation.from.entity === entityId
          ? relation.from
          : relation.to.entity === entityId
            ? relation.to
            : undefined;
      if (!endpoint || relationValues.has(relation.id)) continue;
      if (endpoint.createValue?.kind === 'actor')
        relationValues.set(relation.id, validatedUserId(context));
      if (endpoint.createValue?.kind === 'activeContext')
        relationValues.set(relation.id, contextId(context, endpoint.createValue.context));
      if (endpoint.required && !relationValues.has(relation.id))
        validation(`Create operation is missing required relation "${relation.id}".`);
    }
    const createBinding = predicateBinding(policyPredicate(entityId, 'create'), context);
    if (createBinding && relationValues.get(createBinding.relation) !== createBinding.value)
      forbidden();
    const entries = [
      ...[...values].map(([fieldId, value]) => ({
        column: columnForField(table, fieldId).physicalName,
        semanticId: fieldId,
        value,
      })),
      ...[...relationValues].map(([relationId, value]) => ({
        column: columnForRelation(table, relationId).physicalName,
        semanticId: relationId,
        value,
      })),
    ].sort((left, right) => compareText(left.semanticId, right.semanticId));
    const returning = entityFields(entityId);
    const result = await connection.query(
      `INSERT INTO ${qualifiedTable(table)} (${entries.map((entry) => quoteIdentifier(entry.column)).join(', ')}) VALUES (${entries.map((_, index) => `$${index + 1}`).join(', ')}) RETURNING ${selectList(table, returning)}`,
      entries.map((entry) => entry.value),
    );
    const row = result.rows[0] ?? validation(`Create operation "${operation.id}" returned no row.`);
    return publicRow(row, returning);
  };

  const executeUpdate = async (
    connection: ApplicationSqlConnectionV1,
    operation: ApplicationOperationV1 & { readonly body: { readonly kind: 'updateEntity' } },
    operationInput: Readonly<Record<string, ApplicationRuntimeValueV1>>,
    context: ApplicationExecutionContextV1,
    locals: ReadonlyMap<string, ApplicationRuntimeValueV1> = new Map(),
    entityOverride?: string,
  ): Promise<ApplicationRuntimeValueV1> => {
    const entityId = entityOverride ?? operationEntityId(operation);
    const table = tableFor(entityId);
    const recordValue = evaluateExpression(operation.body.record, operationInput, context, locals);
    const inputRecord = isRecord(recordValue)
      ? recordValue
      : validation(`Update operation "${operation.id}" requires an entity record.`);
    const identifierField = idField(entityId);
    const identifierValue = inputRecord[identifierField.name];
    const identifier =
      typeof identifierValue === 'string'
        ? identifierValue
        : validation(`Entity input requires string field "${identifierField.name}".`);
    const ownershipBinding = predicateBinding(policyPredicate(entityId, 'update'), context);
    const allFields = entityFields(entityId);
    const lockColumns = [selectList(table, allFields)];
    if (ownershipBinding)
      lockColumns.push(
        `${quoteIdentifier(columnForRelation(table, ownershipBinding.relation).physicalName)} AS "__scope"`,
      );
    const locked = await connection.query(
      `SELECT ${lockColumns.join(', ')} FROM ${qualifiedTable(table)} WHERE ${quoteIdentifier(columnForField(table, identifierField.id).physicalName)} = $1 FOR UPDATE`,
      [identifier],
    );
    const current =
      locked.rows[0] ?? notFound(entities.get(entityId)?.name ?? 'Entity', identifier);
    if (ownershipBinding && current.__scope !== ownershipBinding.value) forbidden();
    const changes: {
      readonly column: string;
      readonly field: ApplicationFieldV1;
      readonly value: ApplicationRuntimeValueV1;
    }[] = [];
    for (const [fieldId, expression] of Object.entries(operation.body.values).sort(
      ([left], [right]) => compareText(left, right),
    )) {
      const field = fields.get(fieldId) ?? notFound('Field', fieldId);
      const value = evaluateExpression(expression, operationInput, context, locals, {
        entityId,
        row: current,
      });
      validateFieldValue(field, value);
      changes.push({ column: columnForField(table, field.id).physicalName, field, value });
    }
    const result = await connection.query(
      `UPDATE ${qualifiedTable(table)} SET ${changes.map((change, index) => `${quoteIdentifier(change.column)} = $${index + 1}`).join(', ')} WHERE ${quoteIdentifier(columnForField(table, identifierField.id).physicalName)} = $${changes.length + 1} RETURNING ${selectList(table, allFields)}`,
      [...changes.map((change) => change.value), identifier],
    );
    const row = result.rows[0] ?? notFound(entities.get(entityId)?.name ?? 'Entity', identifier);
    return publicRow(row, allFields);
  };

  const executeDelete = async (
    connection: ApplicationSqlConnectionV1,
    operation: ApplicationOperationV1 & { readonly body: { readonly kind: 'deleteEntity' } },
    operationInput: Readonly<Record<string, ApplicationRuntimeValueV1>>,
    context: ApplicationExecutionContextV1,
    locals: ReadonlyMap<string, ApplicationRuntimeValueV1> = new Map(),
    entityOverride?: string,
  ): Promise<Readonly<Record<string, ApplicationRuntimeValueV1>>> => {
    const entityId = entityOverride ?? operationEntityId(operation);
    const table = tableFor(entityId);
    const recordValue = evaluateExpression(operation.body.record, operationInput, context, locals);
    const inputRecord = isRecord(recordValue)
      ? recordValue
      : validation(`Delete operation "${operation.id}" requires an entity record.`);
    const identifierField = idField(entityId);
    const identifierValue = inputRecord[identifierField.name];
    const identifier =
      typeof identifierValue === 'string'
        ? identifierValue
        : validation(`Entity input requires string field "${identifierField.name}".`);
    const ownershipBinding = predicateBinding(policyPredicate(entityId, 'delete'), context);
    const allFields = entityFields(entityId);
    const lockColumns = [selectList(table, allFields)];
    if (ownershipBinding)
      lockColumns.push(
        `${quoteIdentifier(columnForRelation(table, ownershipBinding.relation).physicalName)} AS "__scope"`,
      );
    const locked = await connection.query(
      `SELECT ${lockColumns.join(', ')} FROM ${qualifiedTable(table)} WHERE ${quoteIdentifier(columnForField(table, identifierField.id).physicalName)} = $1 FOR UPDATE`,
      [identifier],
    );
    const current =
      locked.rows[0] ?? notFound(entities.get(entityId)?.name ?? 'Entity', identifier);
    if (ownershipBinding && current.__scope !== ownershipBinding.value) forbidden();
    const result = await connection.query(
      `DELETE FROM ${qualifiedTable(table)} WHERE ${quoteIdentifier(columnForField(table, identifierField.id).physicalName)} = $1 RETURNING ${selectList(table, allFields)}`,
      [identifier],
    );
    const row = result.rows[0] ?? notFound(entities.get(entityId)?.name ?? 'Entity', identifier);
    return publicRow(row, allFields);
  };

  const executeCapability = async (
    operation: ApplicationOperationV1 & {
      readonly body: { readonly kind: 'invokeCapability' };
    },
    operationInput: Readonly<Record<string, ApplicationRuntimeValueV1>>,
    context: ApplicationExecutionContextV1,
    signal?: AbortSignal,
  ): Promise<ApplicationRuntimeValueV1> => {
    const capability =
      capabilities.get(operation.body.capability) ??
      notFound('Capability', operation.body.capability);
    const method =
      capability.methods[operation.body.method] ??
      notFound(`Capability method on ${capability.name}`, operation.body.method);
    const adapter =
      options.capabilityAdapters?.[capability.id] ??
      validation(`Capability "${capability.id}" has no runtime adapter.`);
    const capabilityInput = Object.fromEntries(
      Object.entries(operation.body.arguments)
        .sort(([left], [right]) => compareText(left, right))
        .map(([name, expression]) => [
          name,
          evaluateExpression(expression, operationInput, context),
        ]),
    );
    checkSignal(signal);
    const result = await adapter.invoke(
      {
        capabilityId: capability.id,
        contract: capability.contract,
        input: capabilityInput,
        method: operation.body.method,
        version: capability.version,
      },
      context,
      signal,
    );
    checkSignal(signal);
    if (!valueMatchesType(result, method.output))
      validation(`Capability "${capability.id}" returned an invalid result.`);
    return result;
  };

  const enqueueCapability = async (
    connection: ApplicationSqlConnectionV1,
    step: Extract<
      Extract<ApplicationOperationV1['body'], { readonly kind: 'workflow' }>['steps'][number],
      { readonly kind: 'enqueueCapability' }
    >,
    operationInput: Readonly<Record<string, ApplicationRuntimeValueV1>>,
    context: ApplicationExecutionContextV1,
    locals: ReadonlyMap<string, ApplicationRuntimeValueV1>,
  ): Promise<Readonly<Record<string, ApplicationRuntimeValueV1>>> => {
    const capability = capabilities.get(step.capability) ?? notFound('Capability', step.capability);
    const method =
      capability.methods[step.method] ??
      notFound(`Capability method on ${capability.name}`, step.method);
    const capabilityInput = Object.fromEntries(
      Object.entries(step.arguments)
        .sort(([left], [right]) => compareText(left, right))
        .map(([name, expression]) => [
          name,
          evaluateExpression(expression, operationInput, context, locals),
        ]),
    );
    if (!valueMatchesType(capabilityInput, method.input))
      validation(`Queued capability "${capability.id}" received invalid input.`);
    const jobId = (options.generateJobId ?? randomUUID)();
    const nowMs = applicationJobTime(options.jobClock);
    const now = new Date(nowMs).toISOString();
    const retry = resolveApplicationJobRetry(step.retry);
    await connection.query(
      `INSERT INTO ${quoteIdentifier(schema.schemaName)}.${quoteIdentifier('__oxe_outbox_jobs')} ("id", "capability_id", "method", "input", "execution_context", "max_attempts", "initial_delay_ms", "max_delay_ms", "backoff_multiplier", "jitter_ratio", "available_at", "created_at") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
      [
        jobId,
        capability.id,
        step.method,
        capabilityInput,
        {
          ...(context.userId ? { userId: context.userId } : {}),
          ...(context.activeContexts
            ? { activeContexts: context.activeContexts.map((entry) => ({ ...entry })) }
            : {}),
          ...(context.sessionId ? { sessionId: context.sessionId } : {}),
        },
        retry.maxAttempts,
        retry.initialDelayMs,
        retry.maxDelayMs,
        retry.multiplier,
        retry.jitterRatio,
        now,
      ],
    );
    return { jobId };
  };

  const execute = async (
    operationId: string,
    operationInput: Readonly<Record<string, ApplicationRuntimeValueV1>>,
    context: ApplicationExecutionContextV1,
    signal?: AbortSignal,
  ): Promise<ApplicationRuntimeValueV1> => {
    checkSignal(signal);
    validatedUserId(context);
    const operation =
      graph.operations.find((candidate) => candidate.id === operationId) ??
      notFound('Operation', operationId);
    assertExactInput(operation, operationInput);
    if (operation.body.kind === 'invokeCapability')
      return executeCapability(
        operation as ApplicationOperationV1 & {
          readonly body: { readonly kind: 'invokeCapability' };
        },
        operationInput,
        context,
        signal,
      );
    if (operation.body.kind === 'createEntity')
      await assertCreateExternalReferences(
        operation as ApplicationOperationV1 & {
          readonly body: { readonly kind: 'createEntity' };
        },
        operationInput,
        context,
        signal,
      );
    if (operation.body.kind === 'workflow')
      for (const step of operation.body.steps)
        if (step.kind === 'createEntity')
          await assertCreateExternalReferences(
            { ...operation, body: step } as ApplicationOperationV1 & {
              readonly body: { readonly kind: 'createEntity' };
            },
            operationInput,
            context,
            signal,
          );
    const result = await pool
      .transaction(async (connection) => {
        if (operation.body.kind === 'createEntity')
          return executeCreate(
            connection,
            operation as ApplicationOperationV1 & {
              readonly body: { readonly kind: 'createEntity' };
            },
            operationInput,
            context,
          );
        if (operation.body.kind === 'updateEntity')
          return executeUpdate(
            connection,
            operation as ApplicationOperationV1 & {
              readonly body: { readonly kind: 'updateEntity' };
            },
            operationInput,
            context,
          );
        if (operation.body.kind === 'workflow') {
          const locals = new Map<string, ApplicationRuntimeValueV1>();
          for (const step of operation.body.steps) {
            checkSignal(signal);
            const stepOperation = { ...operation, body: step };
            const stepResult =
              step.kind === 'enqueueCapability'
                ? await enqueueCapability(connection, step, operationInput, context, locals)
                : step.kind === 'createEntity'
                  ? await executeCreate(
                      connection,
                      stepOperation as ApplicationOperationV1 & {
                        readonly body: { readonly kind: 'createEntity' };
                      },
                      operationInput,
                      context,
                      locals,
                    )
                  : step.kind === 'updateEntity'
                    ? await executeUpdate(
                        connection,
                        stepOperation as ApplicationOperationV1 & {
                          readonly body: { readonly kind: 'updateEntity' };
                        },
                        operationInput,
                        context,
                        locals,
                        step.entity,
                      )
                    : await executeDelete(
                        connection,
                        stepOperation as ApplicationOperationV1 & {
                          readonly body: { readonly kind: 'deleteEntity' };
                        },
                        operationInput,
                        context,
                        locals,
                        step.entity,
                      );
            locals.set(step.as, stepResult);
          }
          const workflowResult = evaluateExpression(
            operation.body.result,
            operationInput,
            context,
            locals,
          );
          return isRecord(workflowResult)
            ? (workflowResult as Readonly<Record<string, ApplicationRuntimeValueV1>>)
            : validation('Workflow result must be an entity record.');
        }
        return executeDelete(
          connection,
          operation as ApplicationOperationV1 & {
            readonly body: { readonly kind: 'deleteEntity' };
          },
          operationInput,
          context,
        );
      })
      .catch((error: unknown) => {
        const constraint =
          isRecord(error) && typeof error.constraint === 'string' ? error.constraint : undefined;
        const unique = constraint
          ? schema.tables
              .flatMap((table) => table.uniques)
              .find((candidate) => candidate.constraintName === constraint)
          : undefined;
        if (unique)
          validation(`Unique constraint "${unique.constraintId}" prevents a duplicate record.`);
        throw error;
      });
    checkSignal(signal);
    return result;
  };

  const listJobs = async (
    listOptions: ApplicationJobListOptionsV1 = {},
  ): Promise<readonly ApplicationOutboxJobV1[]> => {
    const limit = listOptions.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1)
      validation('Job list limit must be a positive integer.');
    const databaseStatus = listOptions.status === 'deadLetter' ? 'dead_letter' : listOptions.status;
    const result = await pool.query<ApplicationOutboxRow>(
      `SELECT "id", "capability_id", "method", "status", "attempts", "max_attempts", "available_at", "created_at", "last_error_kind" FROM ${outboxTable}${databaseStatus ? ' WHERE "status" = $1' : ''} ORDER BY "created_at", "id" LIMIT $${databaseStatus ? 2 : 1}`,
      databaseStatus ? [databaseStatus, limit] : [limit],
    );
    return Object.freeze(result.rows.map(publicOutboxJob));
  };

  const replayJob = async (
    jobId: string,
    replayOptions: ApplicationJobReplayOptionsV1 = {},
  ): Promise<ApplicationOutboxJobV1> => {
    const maxAttempts = replayOptions.maxAttempts;
    if (maxAttempts !== undefined && (!Number.isInteger(maxAttempts) || maxAttempts < 1))
      validation('Replay maxAttempts must be a positive integer.');
    const nowMs = applicationJobTime(options.jobClock);
    const now = new Date(nowMs).toISOString();
    const result = await pool.query<ApplicationOutboxRow>(
      `UPDATE ${outboxTable} SET "status" = 'pending', "attempts" = 0, "max_attempts" = COALESCE($1, "max_attempts"), "available_at" = $2, "lease_until" = NULL, "worker_id" = NULL, "last_error_kind" = NULL, "completed_at" = NULL WHERE "id" = $3 AND "status" = 'dead_letter' RETURNING "id", "capability_id", "method", "status", "attempts", "max_attempts", "available_at", "created_at", "last_error_kind"`,
      [maxAttempts ?? null, now, jobId],
    );
    const replayed = result.rows[0];
    if (replayed) return publicOutboxJob(replayed);
    const existing = await pool.query<{ readonly status: unknown }>(
      `SELECT "status" FROM ${outboxTable} WHERE "id" = $1`,
      [jobId],
    );
    if (existing.rows.length === 0) return notFound('Outbox job', jobId);
    const status = existing.rows[0]?.status;
    return validation(
      `Only a dead-letter job can be replayed; "${jobId}" is ${typeof status === 'string' ? status : 'invalid'}.`,
    );
  };

  const runJobs = async (
    runOptions: ApplicationPostgresJobRunOptionsV1 = {},
  ): Promise<ApplicationJobRunSummaryV1> => {
    const limit = runOptions.limit ?? 10;
    const leaseMs = runOptions.leaseMs ?? 30_000;
    if (!Number.isInteger(limit) || limit < 1)
      validation('Job run limit must be a positive integer.');
    if (!Number.isFinite(leaseMs) || leaseMs < 1)
      validation('Job lease must be a positive number of milliseconds.');
    checkSignal(runOptions.signal);
    const workerId = runOptions.workerId ?? randomUUID();
    const nowMs = applicationJobTime(options.jobClock);
    const now = new Date(nowMs).toISOString();
    const leaseUntil = new Date(nowMs + leaseMs).toISOString();
    const claimed = await pool.transaction(async (connection) =>
      connection.query<{
        readonly attempts: unknown;
        readonly backoff_multiplier: unknown;
        readonly capability_id: unknown;
        readonly execution_context: unknown;
        readonly id: unknown;
        readonly initial_delay_ms: unknown;
        readonly input: unknown;
        readonly jitter_ratio: unknown;
        readonly max_attempts: unknown;
        readonly max_delay_ms: unknown;
        readonly method: unknown;
      }>(
        `WITH claimable AS (SELECT "id" FROM ${outboxTable} WHERE ("status" = 'pending' OR ("status" = 'running' AND "lease_until" <= $1)) AND "available_at" <= $1 ORDER BY "created_at", "id" FOR UPDATE SKIP LOCKED LIMIT $2) UPDATE ${outboxTable} AS jobs SET "status" = 'running', "attempts" = jobs."attempts" + 1, "worker_id" = $3, "lease_until" = $4 FROM claimable WHERE jobs."id" = claimable."id" RETURNING jobs."id", jobs."capability_id", jobs."method", jobs."input", jobs."execution_context", jobs."attempts", jobs."max_attempts", jobs."initial_delay_ms", jobs."max_delay_ms", jobs."backoff_multiplier", jobs."jitter_ratio"`,
        [now, limit, workerId, leaseUntil],
      ),
    );
    let completed = 0;
    let failed = 0;
    let pendingRetry = 0;
    for (const row of claimed.rows) {
      checkSignal(runOptions.signal);
      const id = typeof row.id === 'string' ? row.id : validation('Claimed job has an invalid id.');
      const capabilityId =
        typeof row.capability_id === 'string'
          ? row.capability_id
          : validation(`Claimed job "${id}" has an invalid capability id.`);
      const methodName =
        typeof row.method === 'string'
          ? row.method
          : validation(`Claimed job "${id}" has an invalid method.`);
      const attempts =
        typeof row.attempts === 'number'
          ? row.attempts
          : validation(`Claimed job "${id}" has invalid attempts.`);
      const maxAttempts =
        typeof row.max_attempts === 'number'
          ? row.max_attempts
          : validation(`Claimed job "${id}" has invalid max attempts.`);
      const initialDelayMs =
        typeof row.initial_delay_ms === 'number'
          ? row.initial_delay_ms
          : validation(`Claimed job "${id}" has an invalid initial delay.`);
      const maxDelayMs =
        typeof row.max_delay_ms === 'number'
          ? row.max_delay_ms
          : validation(`Claimed job "${id}" has an invalid maximum delay.`);
      const multiplier =
        typeof row.backoff_multiplier === 'number'
          ? row.backoff_multiplier
          : validation(`Claimed job "${id}" has an invalid backoff multiplier.`);
      const jitterRatio =
        typeof row.jitter_ratio === 'number'
          ? row.jitter_ratio
          : validation(`Claimed job "${id}" has an invalid jitter ratio.`);
      const input = isRecord(row.input)
        ? (row.input as Readonly<Record<string, ApplicationRuntimeValueV1>>)
        : validation(`Claimed job "${id}" has invalid input.`);
      const context = isRecord(row.execution_context)
        ? (row.execution_context as ApplicationExecutionContextV1)
        : validation(`Claimed job "${id}" has invalid execution context.`);
      const capability = capabilities.get(capabilityId);
      const method = capability?.methods[methodName];
      const adapter = options.capabilityAdapters?.[capabilityId];
      let succeeded = false;
      try {
        if (!capability || !method || !adapter || adapter.idempotency !== 'jobId')
          throw new Error('capability-binding');
        const result = await adapter.invoke(
          {
            capabilityId,
            contract: capability.contract,
            delivery: { attempt: attempts, jobId: id },
            input,
            method: methodName,
            version: capability.version,
          },
          context,
          runOptions.signal,
        );
        if (!valueMatchesType(result, method.output)) throw new Error('invalid-capability-result');
        succeeded = true;
      } catch {
        succeeded = false;
      }
      checkSignal(runOptions.signal);
      if (succeeded) {
        const updated = await pool.query(
          `UPDATE ${outboxTable} SET "status" = 'completed', "completed_at" = $1, "lease_until" = NULL, "worker_id" = NULL, "last_error_kind" = NULL WHERE "id" = $2 AND "status" = 'running' AND "worker_id" = $3`,
          [now, id, workerId],
        );
        if (updated.rowCount > 0) completed += 1;
      } else if (attempts < maxAttempts) {
        const retryAt = new Date(
          nowMs +
            calculateApplicationJobRetryDelay(
              { initialDelayMs, jitterRatio, maxAttempts, maxDelayMs, multiplier },
              attempts,
              options.random,
            ),
        ).toISOString();
        const updated = await pool.query(
          `UPDATE ${outboxTable} SET "status" = 'pending', "available_at" = $1, "lease_until" = NULL, "worker_id" = NULL, "last_error_kind" = 'delivery' WHERE "id" = $2 AND "status" = 'running' AND "worker_id" = $3`,
          [retryAt, id, workerId],
        );
        if (updated.rowCount > 0) pendingRetry += 1;
      } else {
        const updated = await pool.query(
          `UPDATE ${outboxTable} SET "status" = 'dead_letter', "lease_until" = NULL, "worker_id" = NULL, "last_error_kind" = 'delivery' WHERE "id" = $1 AND "status" = 'running' AND "worker_id" = $2`,
          [id, workerId],
        );
        if (updated.rowCount > 0) failed += 1;
      }
    }
    return { claimed: claimed.rows.length, completed, failed, pendingRetry };
  };

  return Object.freeze({
    execute: (
      operationId: string,
      operationInput: Readonly<Record<string, ApplicationRuntimeValueV1>>,
      context: ApplicationExecutionContextV1,
      signal?: AbortSignal,
    ) =>
      spans.observeAsync('operation', operationId, () =>
        execute(operationId, operationInput, context, signal),
      ),
    query: (queryId: string, context: ApplicationExecutionContextV1, signal?: AbortSignal) =>
      spans.observeAsync('query', queryId, () => query(queryId, context, signal)),
    listJobs,
    replayJob,
    runJobs: (runOptions?: ApplicationPostgresJobRunOptionsV1) =>
      spans.observeAsync('job', 'outbox.run', () => runJobs(runOptions)),
  });
};
