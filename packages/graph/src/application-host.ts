import { canonicalizeApplicationGraph } from './application-serialize.js';
import { calculateApplicationJobRetryDelay } from './application-jobs.js';
import {
  createApplicationSpanRecorder,
  type ApplicationTelemetrySinkV1,
} from './application-observability.js';
import type {
  ApplicationEntityV1,
  ApplicationFieldV1,
  ApplicationGraphV1,
  ApplicationJobRetryV1,
  ApplicationOperationV1,
  ApplicationPolicyPredicateV1,
  ApplicationQueryV1,
  ApplicationSemanticIdV1,
  ApplicationValueExpressionV1,
  ApplicationValueTypeV1,
} from './application-types.js';
import {
  ApplicationGraphValidationError,
  validateApplicationGraph,
} from './application-validate.js';
import { applicationValueMatchesType } from './application-value.js';

export type ApplicationRuntimeScalarV1 = boolean | null | number | string;
export interface ApplicationRuntimeRecordV1 {
  readonly [name: string]: ApplicationRuntimeValueV1;
}
export type ApplicationRuntimeValueV1 =
  ApplicationRuntimeScalarV1 | readonly ApplicationRuntimeValueV1[] | ApplicationRuntimeRecordV1;

export interface ApplicationExecutionContextEntryV1 {
  readonly contextId: ApplicationSemanticIdV1;
  readonly entityId: ApplicationSemanticIdV1;
  readonly recordId: string;
}

export interface ApplicationContextSelectionV1 {
  readonly contextId: ApplicationSemanticIdV1;
  readonly recordId: string;
}

export interface ApplicationExecutionContextV1 {
  /** Server-authenticated Better Auth user id. Never accepted from operation input. */
  readonly userId?: string;
  /** Ordered outer-to-inner active scopes, for example organization, team, then project. */
  readonly activeContexts?: readonly ApplicationExecutionContextEntryV1[];
  /** Server-only session identity for auditing and revocation; never exposed to graph expressions. */
  readonly sessionId?: string;
}

export type ApplicationStoredRelationValueV1 = string | readonly string[];

export interface ApplicationStoredRecordV1 {
  readonly entityId: ApplicationSemanticIdV1;
  readonly fields: Readonly<Record<ApplicationSemanticIdV1, ApplicationRuntimeValueV1>>;
  readonly relations?: Readonly<Record<ApplicationSemanticIdV1, ApplicationStoredRelationValueV1>>;
}

export interface ApplicationMemorySnapshotV1 {
  readonly jobs: readonly ApplicationOutboxJobV1[];
  readonly records: readonly ApplicationStoredRecordV1[];
  readonly revision: number;
}

export interface ApplicationMemoryHostOptionsV1 {
  readonly capabilityAdapters?: Readonly<Record<string, ApplicationMemoryCapabilityAdapterV1>>;
  readonly clock?: () => number;
  readonly generateId?: (entity: ApplicationEntityV1, sequence: number) => string;
  readonly generateJobId?: (sequence: number) => string;
  readonly generateSpanId?: () => string;
  readonly jobClock?: () => number;
  readonly now?: () => string;
  readonly random?: () => number;
  readonly records?: readonly ApplicationStoredRecordV1[];
  readonly telemetry?: ApplicationTelemetrySinkV1;
}

export interface ApplicationCapabilityInvocationV1 {
  readonly capabilityId: ApplicationSemanticIdV1;
  readonly contract: string;
  readonly input: Readonly<Record<string, ApplicationRuntimeValueV1>>;
  readonly method: string;
  readonly version: string;
  readonly delivery?: {
    /** Stable idempotency key that adapters should forward to providers. */
    readonly jobId: string;
    readonly attempt: number;
  };
}

export interface ApplicationOutboxJobV1 {
  readonly attempts: number;
  readonly availableAt: string;
  readonly capabilityId: ApplicationSemanticIdV1;
  readonly createdAt: string;
  readonly id: string;
  readonly lastErrorKind?: 'delivery';
  readonly maxAttempts: number;
  readonly method: string;
  readonly status: 'completed' | 'deadLetter' | 'pending' | 'running';
}

export interface ApplicationJobListOptionsV1 {
  readonly limit?: number;
  readonly status?: ApplicationOutboxJobV1['status'];
}

export interface ApplicationJobReplayOptionsV1 {
  readonly maxAttempts?: number;
}

export interface ApplicationJobRunOptionsV1 {
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export interface ApplicationJobRunSummaryV1 {
  readonly claimed: number;
  readonly completed: number;
  readonly failed: number;
  readonly pendingRetry: number;
}

export interface ApplicationMemoryCapabilityAdapterV1 {
  /** Required for queued delivery; the adapter must deduplicate on `delivery.jobId`. */
  readonly idempotency?: 'jobId';
  invoke(
    invocation: ApplicationCapabilityInvocationV1,
    context: ApplicationExecutionContextV1,
    signal?: AbortSignal,
  ): ApplicationRuntimeValueV1;
}

export type ApplicationHostFailureKindV1 =
  'forbidden' | 'not-found' | 'unauthorized' | 'validation';

export type ApplicationHostErrorCode = 'OXE3401' | 'OXE3402' | 'OXE3403' | 'OXE3404';

export class ApplicationHostError extends Error {
  public constructor(
    public readonly code: ApplicationHostErrorCode,
    public readonly kind: ApplicationHostFailureKindV1,
    message: string,
  ) {
    super(message);
    this.name = 'ApplicationHostError';
  }
}

export interface ApplicationMemoryHostV1 {
  execute(
    operationId: ApplicationSemanticIdV1,
    input: Readonly<Record<string, ApplicationRuntimeValueV1>>,
    context: ApplicationExecutionContextV1,
    signal?: AbortSignal,
  ): ApplicationRuntimeValueV1;
  query(
    queryId: ApplicationSemanticIdV1,
    context: ApplicationExecutionContextV1,
    signal?: AbortSignal,
  ): readonly Readonly<Record<string, ApplicationRuntimeValueV1>>[];
  listJobs(options?: ApplicationJobListOptionsV1): readonly ApplicationOutboxJobV1[];
  replayJob(jobId: string, options?: ApplicationJobReplayOptionsV1): ApplicationOutboxJobV1;
  runJobs(options?: ApplicationJobRunOptionsV1): ApplicationJobRunSummaryV1;
  snapshot(): ApplicationMemorySnapshotV1;
}

interface MutableStoredRecord {
  readonly entityId: string;
  readonly fields: Map<string, ApplicationRuntimeValueV1>;
  readonly relations: Map<string, ApplicationStoredRelationValueV1>;
}

interface EntityReference {
  readonly kind: 'entity-reference';
  readonly record: MutableStoredRecord;
}

interface MutableOutboxJob extends ApplicationOutboxJobV1 {
  availableAt: string;
  availableAtMs: number;
  readonly context: ApplicationExecutionContextV1;
  readonly input: Readonly<Record<string, ApplicationRuntimeValueV1>>;
  lastErrorKind?: 'delivery';
  maxAttempts: number;
  readonly retry: ApplicationJobRetryV1;
  status: ApplicationOutboxJobV1['status'];
  attempts: number;
}

type EvaluatedValue = ApplicationRuntimeValueV1 | EntityReference;

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

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

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isEntityReference = (value: EvaluatedValue): value is EntityReference =>
  isRecord(value) &&
  value.kind === 'entity-reference' &&
  isRecord(value.record) &&
  value.record.fields instanceof Map;

const cloneValue = (value: ApplicationRuntimeValueV1): ApplicationRuntimeValueV1 => {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareText(left, right))
        .map(([name, nested]) => [name, cloneValue(nested as ApplicationRuntimeValueV1)]),
    );
  return value;
};

const authenticatedUserId = (context: ApplicationExecutionContextV1): string => {
  const userId = context.userId;
  if (!userId) return unauthorized();
  const seen = new Set<string>();
  for (const [index, activeContext] of (context.activeContexts ?? []).entries()) {
    if (!activeContext.contextId || !activeContext.entityId || !activeContext.recordId)
      validation(
        `Active context at index ${index} requires non-empty contextId, entityId, and recordId values.`,
      );
    if (seen.has(activeContext.contextId))
      validation(`Active context role "${activeContext.contextId}" is selected more than once.`);
    seen.add(activeContext.contextId);
  }
  return userId;
};

export const applicationExecutionContextId = (
  context: ApplicationExecutionContextV1,
  contextId: ApplicationSemanticIdV1,
): string | undefined =>
  context.activeContexts?.find((activeContext) => activeContext.contextId === contextId)?.recordId;

const valueMatchesType = applicationValueMatchesType;

const fieldValueIsValid = (field: ApplicationFieldV1, value: unknown): boolean => {
  if (!valueMatchesType(value, field.valueType)) return false;
  if (field.valueType.kind !== 'string' || typeof value !== 'string') return true;
  return (field.validation ?? []).every(
    (constraint) =>
      (constraint.min === undefined || value.length >= constraint.min) &&
      (constraint.max === undefined || value.length <= constraint.max),
  );
};

const runtimeIdField = (
  fields: ReadonlyMap<string, ApplicationFieldV1>,
  entity: ApplicationEntityV1,
): ApplicationFieldV1 => {
  const idFields = (entity.fields ?? [])
    .map((id) => fields.get(id))
    .filter(
      (field): field is ApplicationFieldV1 =>
        field?.valueType.kind === 'entityId' && field.valueType.entity === entity.id,
    );
  if (idFields.length !== 1)
    return validation(`Entity "${entity.id}" requires exactly one entityId field at runtime.`);
  return idFields[0]!;
};

const recordKey = (entityId: string, id: string): string => `${entityId}\0${id}`;

const compareRuntimeValues = (
  left: ApplicationRuntimeValueV1 | undefined,
  right: ApplicationRuntimeValueV1 | undefined,
): number => {
  if (left === right) return 0;
  if (left === undefined) return -1;
  if (right === undefined) return 1;
  if (
    (typeof left === 'string' && typeof right === 'string') ||
    (typeof left === 'number' && typeof right === 'number') ||
    (typeof left === 'boolean' && typeof right === 'boolean')
  )
    return left < right ? -1 : 1;
  return compareText(JSON.stringify(left), JSON.stringify(right));
};

export const createInMemoryApplicationHost = (
  input: ApplicationGraphV1,
  options: ApplicationMemoryHostOptionsV1 = {},
): ApplicationMemoryHostV1 => {
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
  const entities = new Map(graph.entities.map((entity) => [entity.id, entity]));
  const fields = new Map(graph.fields.map((field) => [field.id, field]));
  const relations = new Map(graph.relations.map((relation) => [relation.id, relation]));
  const policies = new Map(graph.policies.map((policy) => [policy.target, policy]));
  const capabilities = new Map(
    (graph.capabilities ?? []).map((capability) => [capability.id, capability]),
  );
  const records = new Map<string, MutableStoredRecord>();
  const jobs = new Map<string, MutableOutboxJob>();
  let jobSequence = 0;
  const sequences = new Map<string, number>();
  const contextRoles = new Map((graph.contexts ?? []).map((role) => [role.id, role]));
  let revision = 0;
  const jobClock = options.jobClock ?? Date.now;
  const readJobClock = (): number => {
    const value = jobClock();
    if (!Number.isFinite(value) || !Number.isFinite(new Date(value).getTime()))
      validation('The application job clock returned an invalid value.');
    return value;
  };

  const validateExecutionContext = (context: ApplicationExecutionContextV1): string => {
    const userId = authenticatedUserId(context);
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

  const activeContextId = (
    context: ApplicationExecutionContextV1,
    contextId: ApplicationSemanticIdV1,
  ): string => {
    validateExecutionContext(context);
    return (
      applicationExecutionContextId(context, contextId) ??
      (() => {
        throw new ApplicationHostError(
          'OXE3403',
          'forbidden',
          `Active context role "${contextId}" is required.`,
        );
      })()
    );
  };

  const entityFor = (entityId: string): ApplicationEntityV1 =>
    entities.get(entityId) ?? notFound('Entity', entityId);
  const fieldFor = (fieldId: string): ApplicationFieldV1 =>
    fields.get(fieldId) ?? notFound('Field', fieldId);

  const storedId = (record: MutableStoredRecord): string => {
    const field = runtimeIdField(fields, entityFor(record.entityId));
    const id = record.fields.get(field.id);
    return typeof id === 'string'
      ? id
      : validation(`Stored "${record.entityId}" record has no string id.`);
  };

  const publicRecord = (
    record: MutableStoredRecord,
    selected?: readonly string[],
  ): Readonly<Record<string, ApplicationRuntimeValueV1>> => {
    const entity = entityFor(record.entityId);
    const selectedIds = selected ?? entity.fields ?? [];
    return Object.fromEntries(
      selectedIds
        .map(fieldFor)
        .sort((left, right) => compareText(left.name, right.name))
        .map((field) => {
          const value = record.fields.get(field.id);
          if (value === undefined)
            return validation(`Stored record is missing field "${field.id}".`);
          return [field.name, cloneValue(value)];
        }),
    );
  };

  const validateRecordRelations = (record: MutableStoredRecord): void => {
    for (const relation of graph.relations) {
      const endpoint =
        relation.from.entity === record.entityId
          ? relation.from
          : relation.to.entity === record.entityId
            ? relation.to
            : undefined;
      if (!endpoint) continue;
      const value = record.relations.get(relation.id);
      if (endpoint.required && value === undefined)
        validation(`Stored record is missing required relation "${relation.id}".`);
      if (
        value !== undefined &&
        ((endpoint.cardinality === 'one' && typeof value !== 'string') ||
          (endpoint.cardinality === 'many' && !Array.isArray(value)))
      )
        validation(
          `Relation "${relation.id}" requires a ${endpoint.cardinality}-valued runtime reference.`,
        );
    }
  };

  const insert = (inputRecord: ApplicationStoredRecordV1): void => {
    const entity = entityFor(inputRecord.entityId);
    const allowedFields = new Set(entity.fields ?? []);
    const stored: MutableStoredRecord = {
      entityId: entity.id,
      fields: new Map(),
      relations: new Map(),
    };
    for (const [fieldId, value] of Object.entries(inputRecord.fields).sort(([left], [right]) =>
      compareText(left, right),
    )) {
      const field = fieldFor(fieldId);
      if (!allowedFields.has(field.id))
        validation(`Field "${field.id}" does not belong to entity "${entity.id}".`);
      if (!fieldValueIsValid(field, value)) validation(`Field "${field.id}" has an invalid value.`);
      stored.fields.set(field.id, cloneValue(value));
    }
    for (const fieldId of entity.fields ?? []) {
      const field = fieldFor(fieldId);
      if (field.required && !stored.fields.has(field.id))
        validation(`Stored record is missing required field "${field.id}".`);
    }
    for (const [relationId, value] of Object.entries(inputRecord.relations ?? {}).sort(
      ([left], [right]) => compareText(left, right),
    )) {
      const relation = relations.get(relationId);
      if (!relation || (relation.from.entity !== entity.id && relation.to.entity !== entity.id))
        validation(`Relation "${relationId}" does not include entity "${entity.id}".`);
      stored.relations.set(relationId, Array.isArray(value) ? [...value] : value);
    }
    validateRecordRelations(stored);
    const id = storedId(stored);
    const key = recordKey(entity.id, id);
    if (records.has(key)) validation(`Entity "${entity.id}" already contains id "${id}".`);
    records.set(key, stored);
    sequences.set(entity.id, (sequences.get(entity.id) ?? 0) + 1);
  };

  for (const record of options.records ?? []) insert(record);

  const scopedRelationMatches = (
    predicate: Exclude<ApplicationPolicyPredicateV1, { readonly kind: 'authenticated' }>,
    record: MutableStoredRecord,
    context: ApplicationExecutionContextV1,
  ): boolean => {
    const expectedId =
      predicate.kind === 'relationEqualsActor'
        ? validateExecutionContext(context)
        : activeContextId(context, predicate.context);
    const relation = relations.get(predicate.relation) ?? notFound('Relation', predicate.relation);
    if (relation.from.entity !== record.entityId && relation.to.entity !== record.entityId)
      validation(`Relation "${relation.id}" does not include "${record.entityId}".`);
    const value = record.relations.get(relation.id);
    return Array.isArray(value) ? value.includes(expectedId) : value === expectedId;
  };

  const predicateMatches = (
    predicate: ApplicationPolicyPredicateV1,
    record: MutableStoredRecord | undefined,
    context: ApplicationExecutionContextV1,
  ): boolean => {
    if (predicate.kind === 'authenticated') {
      validateExecutionContext(context);
      return true;
    }
    if (!record) return false;
    return scopedRelationMatches(predicate, record, context);
  };

  const enforcePolicy = (
    entityId: string,
    action: 'create' | 'delete' | 'read' | 'update',
    record: MutableStoredRecord | undefined,
    context: ApplicationExecutionContextV1,
  ): void => {
    const policy = policies.get(entityId) ?? forbidden();
    if (!predicateMatches(policy.rules[action], record, context)) forbidden();
  };

  const authoritativeEntity = (
    type: Extract<ApplicationValueTypeV1, { readonly kind: 'entity' }>,
    value: unknown,
  ): EntityReference => {
    const inputRecord = isRecord(value)
      ? value
      : validation(`Entity input for "${type.entity}" must be a record.`);
    const entity = entityFor(type.entity);
    const idField = runtimeIdField(fields, entity);
    const id = inputRecord[idField.name];
    const stringId =
      typeof id === 'string'
        ? id
        : validation(`Entity input requires string field "${idField.name}".`);
    const record = records.get(recordKey(entity.id, stringId)) ?? notFound(entity.name, stringId);
    return { kind: 'entity-reference', record };
  };

  const normalizeInput = (
    type: ApplicationValueTypeV1,
    value: unknown,
    path: string,
  ): EvaluatedValue => {
    if (type.kind === 'entity') return authoritativeEntity(type, value);
    if (type.kind === 'record') {
      const inputRecord = isRecord(value) ? value : validation(`${path} must be a record.`);
      const names = Object.keys(type.fields).sort(compareText);
      if (
        Object.keys(inputRecord).length !== names.length ||
        Object.keys(inputRecord).some((name) => !(name in type.fields))
      )
        validation(`${path} has unexpected record fields.`);
      return Object.fromEntries(
        names.map((name) => [
          name,
          normalizeInput(type.fields[name]!, inputRecord[name], `${path}.${name}`),
        ]),
      ) as Readonly<Record<string, ApplicationRuntimeValueV1>>;
    }
    if (type.kind === 'list') {
      const inputList = Array.isArray(value) ? value : validation(`${path} must be a list.`);
      return inputList.map(
        (item, index) =>
          normalizeInput(type.items, item, `${path}[${index}]`) as ApplicationRuntimeValueV1,
      );
    }
    if (type.kind === 'optional')
      return value === null ? null : normalizeInput(type.value, value, path);
    if (type.kind === 'result') {
      const inputResult = isRecord(value) ? value : validation(`${path} must be a result record.`);
      const outcome =
        typeof inputResult.outcome === 'string'
          ? inputResult.outcome
          : validation(`${path}.outcome must be a string.`);
      const resultType = outcome === 'ok' ? type.value : type.outcomes[outcome];
      const selectedType = resultType ?? validation(`${path}.outcome is unknown.`);
      return {
        outcome,
        value: normalizeInput(
          selectedType,
          inputResult.value,
          `${path}.value`,
        ) as ApplicationRuntimeValueV1,
      };
    }
    if (!valueMatchesType(value, type)) validation(`${path} has an invalid value.`);
    return cloneValue(value as ApplicationRuntimeValueV1);
  };

  const evaluate = (
    expression: ApplicationValueExpressionV1,
    normalizedInput: ReadonlyMap<string, EvaluatedValue>,
    context: ApplicationExecutionContextV1,
    locals: ReadonlyMap<string, EvaluatedValue> = new Map(),
  ): EvaluatedValue => {
    switch (expression.kind) {
      case 'activeContext':
        return activeContextId(context, expression.context);
      case 'actor':
        return validateExecutionContext(context);
      case 'inputField':
        return normalizedInput.has(expression.name)
          ? normalizedInput.get(expression.name)!
          : validation(`Missing input "${expression.name}".`);
      case 'literal':
        return expression.value;
      case 'not': {
        const value = evaluate(expression.value, normalizedInput, context, locals);
        return typeof value === 'boolean'
          ? !value
          : validation('Boolean negation requires a boolean value.');
      }
      case 'recordField': {
        const value = evaluate(expression.record, normalizedInput, context, locals);
        const field = fieldFor(expression.field);
        if (isEntityReference(value)) {
          const nested = value.record.fields.get(field.id);
          return value.record.fields.has(field.id)
            ? nested!
            : validation(`Record is missing field "${field.id}".`);
        }
        const runtimeRecord = isRecord(value)
          ? value
          : validation('Field selection requires a record.');
        return Object.hasOwn(runtimeRecord, field.name)
          ? (runtimeRecord as Readonly<Record<string, ApplicationRuntimeValueV1>>)[field.name]!
          : validation(`Record is missing field "${field.name}".`);
      }
      case 'local':
        return locals.has(expression.name)
          ? locals.get(expression.name)!
          : validation(`Local "${expression.name}" is not set.`);
      case 'formValue':
      case 'semanticReference':
      case 'viewData':
        return validation(
          `Expression "${expression.kind}" cannot execute on the application host.`,
        );
    }
  };

  const normalizedOperationInput = (
    operation: ApplicationOperationV1,
    inputRecord: Readonly<Record<string, ApplicationRuntimeValueV1>>,
  ): ReadonlyMap<string, EvaluatedValue> => {
    const expected = Object.keys(operation.input.fields).sort(compareText);
    if (
      Object.keys(inputRecord).length !== expected.length ||
      Object.keys(inputRecord).some((name) => !(name in operation.input.fields))
    )
      validation(`Operation "${operation.id}" received unexpected input fields.`);
    return new Map(
      expected.map((name) => [
        name,
        normalizeInput(operation.input.fields[name]!, inputRecord[name], `input.${name}`),
      ]),
    );
  };

  const requiredRelationDefaults = (
    entity: ApplicationEntityV1,
    relationValues: Map<string, ApplicationStoredRelationValueV1>,
    context: ApplicationExecutionContextV1,
  ): void => {
    for (const relation of graph.relations) {
      const endpoint = relation.from.entity === entity.id ? relation.from : relation.to;
      if (endpoint.entity !== entity.id) continue;
      if (endpoint.createValue?.kind === 'actor')
        relationValues.set(relation.id, validateExecutionContext(context));
      if (endpoint.createValue?.kind === 'activeContext')
        relationValues.set(relation.id, activeContextId(context, endpoint.createValue.context));
      if (endpoint.required && !relationValues.has(relation.id))
        validation(`Create operation is missing required relation "${relation.id}".`);
    }
  };

  const generatedFieldValue = (
    field: ApplicationFieldV1,
    entity: ApplicationEntityV1,
  ): ApplicationRuntimeValueV1 => {
    if (field.default) return field.default.value;
    if (field.origin !== 'generated')
      return validation(`Create operation is missing required field "${field.id}".`);
    if (field.valueType.kind === 'entityId') {
      const sequence = (sequences.get(entity.id) ?? 0) + 1;
      return (options.generateId ?? ((target, index) => `${target.name.toLowerCase()}-${index}`))(
        entity,
        sequence,
      );
    }
    if (field.valueType.kind === 'dateTime')
      return (options.now ?? (() => new Date().toISOString()))();
    return validation(`Generated field "${field.id}" has no runtime generator.`);
  };

  const executeCreate = (
    operation: ApplicationOperationV1 & { readonly body: { readonly kind: 'createEntity' } },
    normalizedInput: ReadonlyMap<string, EvaluatedValue>,
    context: ApplicationExecutionContextV1,
    locals: ReadonlyMap<string, EvaluatedValue> = new Map(),
    advanceRevision = true,
  ): Readonly<Record<string, ApplicationRuntimeValueV1>> => {
    const entity = entityFor(operation.body.entity);
    const created: MutableStoredRecord = {
      entityId: entity.id,
      fields: new Map(),
      relations: new Map(),
    };
    for (const [targetId, expression] of Object.entries(operation.body.values).sort(
      ([left], [right]) => compareText(left, right),
    )) {
      const value = evaluate(expression, normalizedInput, context, locals);
      const field = fields.get(targetId);
      if (field) {
        if (isEntityReference(value))
          validation(`Field "${field.id}" cannot store an entity reference.`);
        if (!fieldValueIsValid(field, value))
          validation(`Field "${field.id}" has an invalid value.`);
        created.fields.set(field.id, cloneValue(value as ApplicationRuntimeValueV1));
        continue;
      }
      const relation = relations.get(targetId) ?? notFound('Relation', targetId);
      if (relation.from.entity !== entity.id && relation.to.entity !== entity.id)
        validation(`Relation "${relation.id}" does not include "${entity.id}".`);
      const userId =
        typeof value === 'string'
          ? value
          : validation(`Relation "${relation.id}" requires a user id.`);
      created.relations.set(relation.id, userId);
    }
    for (const fieldId of entity.fields ?? []) {
      if (created.fields.has(fieldId)) continue;
      const field = fieldFor(fieldId);
      if (field.default || field.origin === 'generated')
        created.fields.set(field.id, generatedFieldValue(field, entity));
      else if (field.required)
        validation(`Create operation is missing required field "${field.id}".`);
    }
    requiredRelationDefaults(entity, created.relations, context);
    validateRecordRelations(created);
    enforcePolicy(entity.id, 'create', created, context);
    const id = storedId(created);
    const key = recordKey(entity.id, id);
    if (records.has(key)) validation(`Entity "${entity.id}" already contains id "${id}".`);
    records.set(key, created);
    sequences.set(entity.id, (sequences.get(entity.id) ?? 0) + 1);
    if (advanceRevision) revision += 1;
    return publicRecord(created);
  };

  const executeUpdate = (
    operation: ApplicationOperationV1 & { readonly body: { readonly kind: 'updateEntity' } },
    normalizedInput: ReadonlyMap<string, EvaluatedValue>,
    context: ApplicationExecutionContextV1,
    locals: ReadonlyMap<string, EvaluatedValue> = new Map(),
    advanceRevision = true,
    expectedEntityId?: string,
  ): Readonly<Record<string, ApplicationRuntimeValueV1>> => {
    const target = evaluate(operation.body.record, normalizedInput, context, locals);
    const reference = isEntityReference(target)
      ? target
      : expectedEntityId
        ? authoritativeEntity({ entity: expectedEntityId, kind: 'entity' }, target)
        : validation('Update target must resolve to an authoritative entity record.');
    if (expectedEntityId && reference.record.entityId !== expectedEntityId)
      validation(`Update target must belong to entity "${expectedEntityId}".`);
    enforcePolicy(reference.record.entityId, 'update', reference.record, context);
    const nextFields = new Map(reference.record.fields);
    for (const [fieldId, expression] of Object.entries(operation.body.values).sort(
      ([left], [right]) => compareText(left, right),
    )) {
      const field = fieldFor(fieldId);
      const value = evaluate(expression, normalizedInput, context, locals);
      if (isEntityReference(value))
        validation(`Field "${field.id}" cannot store an entity reference.`);
      if (!fieldValueIsValid(field, value)) validation(`Field "${field.id}" has an invalid value.`);
      nextFields.set(field.id, cloneValue(value as ApplicationRuntimeValueV1));
    }
    reference.record.fields.clear();
    nextFields.forEach((value, fieldId) => reference.record.fields.set(fieldId, value));
    if (advanceRevision) revision += 1;
    return publicRecord(reference.record);
  };

  const executeDelete = (
    operation: ApplicationOperationV1 & { readonly body: { readonly kind: 'deleteEntity' } },
    normalizedInput: ReadonlyMap<string, EvaluatedValue>,
    context: ApplicationExecutionContextV1,
    locals: ReadonlyMap<string, EvaluatedValue> = new Map(),
    advanceRevision = true,
    expectedEntityId?: string,
  ): Readonly<Record<string, ApplicationRuntimeValueV1>> => {
    const targetValue = evaluate(operation.body.record, normalizedInput, context, locals);
    const target = isEntityReference(targetValue)
      ? targetValue
      : expectedEntityId
        ? authoritativeEntity({ entity: expectedEntityId, kind: 'entity' }, targetValue)
        : validation('Delete target must resolve to an authoritative entity record.');
    if (expectedEntityId && target.record.entityId !== expectedEntityId)
      validation(`Delete target must belong to entity "${expectedEntityId}".`);
    enforcePolicy(target.record.entityId, 'delete', target.record, context);
    const deleted = publicRecord(target.record);
    records.delete(recordKey(target.record.entityId, storedId(target.record)));
    if (advanceRevision) revision += 1;
    return deleted;
  };

  const executeWorkflow = (
    operation: ApplicationOperationV1 & { readonly body: { readonly kind: 'workflow' } },
    normalizedInput: ReadonlyMap<string, EvaluatedValue>,
    context: ApplicationExecutionContextV1,
  ): Readonly<Record<string, ApplicationRuntimeValueV1>> => {
    const previousRecords = new Map(
      [...records].map(([key, record]) => [
        key,
        {
          entityId: record.entityId,
          fields: new Map(
            [...record.fields].map(([fieldId, value]) => [fieldId, cloneValue(value)]),
          ),
          relations: new Map(
            [...record.relations].map(([relationId, value]) => [
              relationId,
              Array.isArray(value) ? [...value] : value,
            ]),
          ),
        } satisfies MutableStoredRecord,
      ]),
    );
    const previousSequences = new Map(sequences);
    const previousJobs = new Map(
      [...jobs].map(([id, job]) => [
        id,
        {
          ...job,
          input: cloneValue(job.input) as Readonly<Record<string, ApplicationRuntimeValueV1>>,
        },
      ]),
    );
    const previousJobSequence = jobSequence;
    const previousRevision = revision;
    const locals = new Map<string, EvaluatedValue>();
    try {
      for (const step of operation.body.steps) {
        const stepOperation = { ...operation, body: step };
        const result =
          step.kind === 'enqueueCapability'
            ? (() => {
                const capability =
                  capabilities.get(step.capability) ?? notFound('Capability', step.capability);
                const method =
                  capability.methods[step.method] ??
                  notFound(`Capability method on ${capability.name}`, step.method);
                const capabilityInput = Object.fromEntries(
                  Object.entries(step.arguments)
                    .sort(([left], [right]) => compareText(left, right))
                    .map(([name, expression]) => {
                      const value = evaluate(expression, normalizedInput, context, locals);
                      return [
                        name,
                        isEntityReference(value) ? publicRecord(value.record) : cloneValue(value),
                      ];
                    }),
                );
                if (!valueMatchesType(capabilityInput, method.input))
                  validation(`Queued capability "${capability.id}" received invalid input.`);
                jobSequence += 1;
                const jobId = (options.generateJobId ?? ((sequence) => `job-${sequence}`))(
                  jobSequence,
                );
                if (jobs.has(jobId)) validation(`Outbox job id "${jobId}" already exists.`);
                const createdAtMs = readJobClock();
                jobs.set(jobId, {
                  attempts: 0,
                  availableAt: new Date(createdAtMs).toISOString(),
                  availableAtMs: createdAtMs,
                  capabilityId: capability.id,
                  context: {
                    ...(context.userId ? { userId: context.userId } : {}),
                    ...(context.activeContexts
                      ? { activeContexts: context.activeContexts.map((entry) => ({ ...entry })) }
                      : {}),
                    ...(context.sessionId ? { sessionId: context.sessionId } : {}),
                  },
                  createdAt: new Date(createdAtMs).toISOString(),
                  id: jobId,
                  input: cloneValue(capabilityInput) as Readonly<
                    Record<string, ApplicationRuntimeValueV1>
                  >,
                  maxAttempts: step.retry.maxAttempts,
                  method: step.method,
                  retry: step.retry,
                  status: 'pending',
                });
                return { jobId };
              })()
            : step.kind === 'createEntity'
              ? executeCreate(
                  stepOperation as ApplicationOperationV1 & {
                    readonly body: { readonly kind: 'createEntity' };
                  },
                  normalizedInput,
                  context,
                  locals,
                  false,
                )
              : step.kind === 'updateEntity'
                ? executeUpdate(
                    stepOperation as ApplicationOperationV1 & {
                      readonly body: { readonly kind: 'updateEntity' };
                    },
                    normalizedInput,
                    context,
                    locals,
                    false,
                    step.entity,
                  )
                : executeDelete(
                    stepOperation as ApplicationOperationV1 & {
                      readonly body: { readonly kind: 'deleteEntity' };
                    },
                    normalizedInput,
                    context,
                    locals,
                    false,
                    step.entity,
                  );
        locals.set(step.as, result);
      }
      const result = evaluate(operation.body.result, normalizedInput, context, locals);
      if (isEntityReference(result)) {
        revision = previousRevision + 1;
        return publicRecord(result.record);
      }
      if (!isRecord(result)) validation('Workflow result must be an entity record.');
      revision = previousRevision + 1;
      return cloneValue(result as ApplicationRuntimeRecordV1) as ApplicationRuntimeRecordV1;
    } catch (error) {
      records.clear();
      previousRecords.forEach((record, key) => records.set(key, record));
      sequences.clear();
      previousSequences.forEach((sequence, entityId) => sequences.set(entityId, sequence));
      jobs.clear();
      previousJobs.forEach((job, id) => jobs.set(id, job));
      jobSequence = previousJobSequence;
      revision = previousRevision;
      throw error;
    }
  };

  const executeCapability = (
    operation: ApplicationOperationV1 & {
      readonly body: { readonly kind: 'invokeCapability' };
    },
    normalizedInput: ReadonlyMap<string, EvaluatedValue>,
    context: ApplicationExecutionContextV1,
    signal?: AbortSignal,
  ): ApplicationRuntimeValueV1 => {
    const capability =
      capabilities.get(operation.body.capability) ??
      notFound('Capability', operation.body.capability);
    const method =
      capability.methods[operation.body.method] ??
      notFound(`Capability method on ${capability.name}`, operation.body.method);
    const adapter =
      options.capabilityAdapters?.[capability.id] ??
      validation(`Capability "${capability.id}" has no runtime adapter.`);
    const input = Object.fromEntries(
      Object.entries(operation.body.arguments)
        .sort(([left], [right]) => compareText(left, right))
        .map(([name, expression]) => {
          const value = evaluate(expression, normalizedInput, context);
          return [name, isEntityReference(value) ? publicRecord(value.record) : cloneValue(value)];
        }),
    );
    const result = adapter.invoke(
      {
        capabilityId: capability.id,
        contract: capability.contract,
        input,
        method: operation.body.method,
        version: capability.version,
      },
      context,
      signal,
    );
    const normalizedResult = normalizeInput(method.output, result, 'capability result');
    revision += 1;
    if (isEntityReference(normalizedResult)) return publicRecord(normalizedResult.record);
    return cloneValue(normalizedResult);
  };

  const query = (
    queryId: string,
    context: ApplicationExecutionContextV1,
    signal?: AbortSignal,
  ): readonly Readonly<Record<string, ApplicationRuntimeValueV1>>[] => {
    checkSignal(signal);
    validateExecutionContext(context);
    const queryNode: ApplicationQueryV1 =
      graph.queries.find((candidate) => candidate.id === queryId) ?? notFound('Query', queryId);
    const candidates = [...records.values()].filter(
      (record) => record.entityId === queryNode.entity,
    );
    const visible = candidates.filter((record) => {
      const policy = policies.get(queryNode.entity) ?? forbidden();
      if (!predicateMatches(policy.rules.read, record, context)) return false;
      if (queryNode.filter && !predicateMatches(queryNode.filter, record, context)) return false;
      return (queryNode.where ?? []).every(
        (condition) => record.fields.get(condition.field) === condition.equals,
      );
    });
    const idField = runtimeIdField(fields, entityFor(queryNode.entity));
    visible.sort((left, right) => {
      for (const order of queryNode.order ?? []) {
        const compared = compareRuntimeValues(
          left.fields.get(order.field),
          right.fields.get(order.field),
        );
        if (compared !== 0) return order.direction === 'ascending' ? compared : -compared;
      }
      return compareRuntimeValues(left.fields.get(idField.id), right.fields.get(idField.id));
    });
    checkSignal(signal);
    return visible.map((record) => publicRecord(record, queryNode.select));
  };

  const execute = (
    operationId: string,
    inputRecord: Readonly<Record<string, ApplicationRuntimeValueV1>>,
    context: ApplicationExecutionContextV1,
    signal?: AbortSignal,
  ): ApplicationRuntimeValueV1 => {
    checkSignal(signal);
    validateExecutionContext(context);
    const operation =
      graph.operations.find((candidate) => candidate.id === operationId) ??
      notFound('Operation', operationId);
    const normalized = normalizedOperationInput(operation, inputRecord);
    const result = (() => {
      if (operation.body.kind === 'createEntity')
        return executeCreate(
          operation as ApplicationOperationV1 & {
            readonly body: { readonly kind: 'createEntity' };
          },
          normalized,
          context,
        );
      if (operation.body.kind === 'updateEntity')
        return executeUpdate(
          operation as ApplicationOperationV1 & {
            readonly body: { readonly kind: 'updateEntity' };
          },
          normalized,
          context,
        );
      if (operation.body.kind === 'workflow')
        return executeWorkflow(
          operation as ApplicationOperationV1 & {
            readonly body: { readonly kind: 'workflow' };
          },
          normalized,
          context,
        );
      if (operation.body.kind === 'invokeCapability')
        return executeCapability(
          operation as ApplicationOperationV1 & {
            readonly body: { readonly kind: 'invokeCapability' };
          },
          normalized,
          context,
          signal,
        );
      return executeDelete(
        operation as ApplicationOperationV1 & {
          readonly body: { readonly kind: 'deleteEntity' };
        },
        normalized,
        context,
      );
    })();
    checkSignal(signal);
    return result;
  };

  const publicJob = ({
    attempts,
    availableAt,
    capabilityId,
    createdAt,
    id,
    lastErrorKind,
    maxAttempts,
    method,
    status,
  }: MutableOutboxJob): ApplicationOutboxJobV1 => ({
    attempts,
    availableAt,
    capabilityId,
    createdAt,
    id,
    ...(lastErrorKind ? { lastErrorKind } : {}),
    maxAttempts,
    method,
    status,
  });

  const listJobs = (
    listOptions: ApplicationJobListOptionsV1 = {},
  ): readonly ApplicationOutboxJobV1[] => {
    const limit = listOptions.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1)
      validation('Job list limit must be a positive integer.');
    return [...jobs.values()]
      .filter((job) => listOptions.status === undefined || job.status === listOptions.status)
      .sort((left, right) => compareText(left.id, right.id))
      .slice(0, limit)
      .map(publicJob);
  };

  const snapshot = (): ApplicationMemorySnapshotV1 => ({
    jobs: listJobs(),
    records: [...records.values()]
      .sort(
        (left, right) =>
          compareText(left.entityId, right.entityId) ||
          compareText(storedId(left), storedId(right)),
      )
      .map((record) => ({
        entityId: record.entityId,
        fields: Object.fromEntries(
          [...record.fields]
            .sort(([left], [right]) => compareText(left, right))
            .map(([fieldId, value]) => [fieldId, cloneValue(value)]),
        ),
        ...(record.relations.size > 0
          ? {
              relations: Object.fromEntries(
                [...record.relations]
                  .sort(([left], [right]) => compareText(left, right))
                  .map(([relationId, value]) => [
                    relationId,
                    Array.isArray(value) ? [...value] : value,
                  ]),
              ),
            }
          : {}),
      })),
    revision,
  });

  const runJobs = (runOptions: ApplicationJobRunOptionsV1 = {}): ApplicationJobRunSummaryV1 => {
    const limit = runOptions.limit ?? 10;
    if (!Number.isInteger(limit) || limit < 1)
      validation('Job run limit must be a positive integer.');
    const nowMs = readJobClock();
    const claimed = [...jobs.values()]
      .filter((job) => job.status === 'pending' && job.availableAtMs <= nowMs)
      .sort((left, right) => compareText(left.id, right.id))
      .slice(0, limit);
    let completed = 0;
    let failed = 0;
    let pendingRetry = 0;
    for (const job of claimed) {
      checkSignal(runOptions.signal);
      job.status = 'running';
      job.attempts += 1;
      try {
        const capability =
          capabilities.get(job.capabilityId) ?? notFound('Capability', job.capabilityId);
        const method = capability.methods[job.method] ?? notFound('Capability method', job.method);
        const adapter =
          options.capabilityAdapters?.[job.capabilityId] ??
          validation(`Capability "${job.capabilityId}" has no runtime adapter.`);
        if (adapter.idempotency !== 'jobId')
          validation(
            `Queued capability adapter "${job.capabilityId}" must declare jobId idempotency.`,
          );
        const result = adapter.invoke(
          {
            capabilityId: capability.id,
            contract: capability.contract,
            delivery: { attempt: job.attempts, jobId: job.id },
            input: job.input,
            method: job.method,
            version: capability.version,
          },
          job.context,
          runOptions.signal,
        );
        if (!valueMatchesType(result, method.output))
          validation(`Capability "${capability.id}" returned an invalid result.`);
        job.status = 'completed';
        delete job.lastErrorKind;
        completed += 1;
      } catch {
        if (job.attempts < job.maxAttempts) {
          job.status = 'pending';
          job.lastErrorKind = 'delivery';
          job.availableAtMs =
            nowMs + calculateApplicationJobRetryDelay(job.retry, job.attempts, options.random);
          job.availableAt = new Date(job.availableAtMs).toISOString();
          pendingRetry += 1;
        } else {
          job.status = 'deadLetter';
          job.lastErrorKind = 'delivery';
          failed += 1;
        }
      }
      revision += 1;
    }
    return { claimed: claimed.length, completed, failed, pendingRetry };
  };

  const replayJob = (
    jobId: string,
    replayOptions: ApplicationJobReplayOptionsV1 = {},
  ): ApplicationOutboxJobV1 => {
    const job = jobs.get(jobId) ?? notFound('Outbox job', jobId);
    if (job.status !== 'deadLetter')
      validation(`Only a dead-letter job can be replayed; "${jobId}" is ${job.status}.`);
    const maxAttempts = replayOptions.maxAttempts ?? job.maxAttempts;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1)
      validation('Replay maxAttempts must be a positive integer.');
    const availableAtMs = readJobClock();
    job.attempts = 0;
    job.availableAtMs = availableAtMs;
    job.availableAt = new Date(availableAtMs).toISOString();
    delete job.lastErrorKind;
    job.maxAttempts = maxAttempts;
    job.status = 'pending';
    revision += 1;
    return publicJob(job);
  };

  return Object.freeze({
    execute: (
      operationId: string,
      inputRecord: Readonly<Record<string, ApplicationRuntimeValueV1>>,
      context: ApplicationExecutionContextV1,
      signal?: AbortSignal,
    ) =>
      spans.observeSync('operation', operationId, () =>
        execute(operationId, inputRecord, context, signal),
      ),
    query: (queryId: string, context: ApplicationExecutionContextV1, signal?: AbortSignal) =>
      spans.observeSync('query', queryId, () => query(queryId, context, signal)),
    listJobs,
    replayJob,
    runJobs: (runOptions?: ApplicationJobRunOptionsV1) =>
      spans.observeSync('job', 'outbox.run', () => runJobs(runOptions)),
    snapshot,
  });
};
