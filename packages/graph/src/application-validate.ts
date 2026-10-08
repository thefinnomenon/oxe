import type {
  ApplicationGraphV1,
  ApplicationContextAuthorizationMethodV1,
  ApplicationContextV1,
  ApplicationOperationInvocationV1,
  ApplicationPolicyPredicateV1,
  ApplicationRelationV1,
  ApplicationSemanticIdV1,
  ApplicationValueExpressionV1,
  ApplicationValueTypeV1,
  ApplicationViewElementV1,
  ApplicationViewV1,
} from './application-types.js';
import { applicationScalarMatchesType } from './application-value.js';

export type ApplicationGraphDiagnosticCode =
  'OXE3101' | 'OXE3102' | 'OXE3103' | 'OXE3104' | 'OXE3105' | 'OXE3106';

export interface ApplicationGraphDiagnostic {
  readonly code: ApplicationGraphDiagnosticCode;
  readonly message: string;
  /** JSON path into the deterministic application-graph export. */
  readonly path: string;
  /** Stable identity of the containing semantic node, when one is available. */
  readonly semanticId?: ApplicationSemanticIdV1;
}

export interface ApplicationGraphReference {
  readonly path: string;
  readonly sourceId: ApplicationSemanticIdV1;
  readonly targetId: ApplicationSemanticIdV1;
}

type DiagnosticSink = ApplicationGraphDiagnostic[];
type UnknownRecord = Record<string, unknown>;

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const childPath = (path: string, key: string): string =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;

const addDiagnostic = (
  diagnostics: DiagnosticSink,
  code: ApplicationGraphDiagnosticCode,
  path: string,
  message: string,
  semanticId?: string,
): void => {
  diagnostics.push({ code, message, path, ...(semanticId ? { semanticId } : {}) });
};

const expectRecord = (
  value: unknown,
  path: string,
  diagnostics: DiagnosticSink,
  allowed: readonly string[],
  required: readonly string[],
  semanticId?: string,
): UnknownRecord | undefined => {
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, 'OXE3101', path, 'Expected an object.', semanticId);
    return undefined;
  }
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value).sort(compareText)) {
    if (!allowedKeys.has(key)) {
      addDiagnostic(
        diagnostics,
        'OXE3101',
        childPath(path, key),
        `Unknown application graph property "${key}".`,
        semanticId,
      );
    }
  }
  for (const key of required) {
    if (!(key in value)) {
      addDiagnostic(
        diagnostics,
        'OXE3101',
        childPath(path, key),
        `Missing required application graph property "${key}".`,
        semanticId,
      );
    }
  }
  return value;
};

const expectString = (
  value: unknown,
  path: string,
  diagnostics: DiagnosticSink,
  semanticId?: string,
): value is string => {
  if (typeof value === 'string' && value.length > 0) return true;
  addDiagnostic(diagnostics, 'OXE3101', path, 'Expected a non-empty string.', semanticId);
  return false;
};

const expectBoolean = (
  value: unknown,
  path: string,
  diagnostics: DiagnosticSink,
  semanticId?: string,
): value is boolean => {
  if (typeof value === 'boolean') return true;
  addDiagnostic(diagnostics, 'OXE3101', path, 'Expected a boolean.', semanticId);
  return false;
};

const expectNumber = (
  value: unknown,
  path: string,
  diagnostics: DiagnosticSink,
  integer: boolean,
  semanticId?: string,
): value is number => {
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (!integer || Number.isInteger(value))
  ) {
    return true;
  }
  addDiagnostic(
    diagnostics,
    'OXE3101',
    path,
    integer ? 'Expected a finite integer.' : 'Expected a finite number.',
    semanticId,
  );
  return false;
};

const expectEnum = <T extends string>(
  value: unknown,
  options: readonly T[],
  path: string,
  diagnostics: DiagnosticSink,
  semanticId?: string,
): value is T => {
  if (typeof value === 'string' && options.includes(value as T)) return true;
  addDiagnostic(
    diagnostics,
    'OXE3101',
    path,
    `Expected one of: ${options.map((option) => JSON.stringify(option)).join(', ')}.`,
    semanticId,
  );
  return false;
};

const expectArray = (
  value: unknown,
  path: string,
  diagnostics: DiagnosticSink,
  semanticId?: string,
): readonly unknown[] | undefined => {
  if (Array.isArray(value)) return value;
  addDiagnostic(diagnostics, 'OXE3101', path, 'Expected an array.', semanticId);
  return undefined;
};

const validateScalar = (
  value: unknown,
  path: string,
  diagnostics: DiagnosticSink,
  semanticId?: string,
): void => {
  if (
    value !== null &&
    typeof value !== 'boolean' &&
    typeof value !== 'string' &&
    typeof value !== 'number'
  ) {
    addDiagnostic(diagnostics, 'OXE3101', path, 'Expected a scalar JSON value.', semanticId);
  } else if (typeof value === 'number' && !Number.isFinite(value)) {
    addDiagnostic(diagnostics, 'OXE3101', path, 'Expected a finite number.', semanticId);
  }
};

const validateStringMap = (
  value: unknown,
  path: string,
  diagnostics: DiagnosticSink,
  validate: (value: unknown, path: string) => void,
  semanticId?: string,
): void => {
  const record = expectRecord(
    value,
    path,
    diagnostics,
    isRecord(value) ? Object.keys(value) : [],
    [],
    semanticId,
  );
  if (!record) return;
  for (const key of Object.keys(record).sort(compareText))
    validate(record[key], childPath(path, key));
};

const validateValueTypeStructure = (
  value: unknown,
  path: string,
  diagnostics: DiagnosticSink,
  semanticId?: string,
): void => {
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, 'OXE3101', path, 'Expected a value-type object.', semanticId);
    return;
  }
  const kind = value.kind;
  if (
    kind === 'boolean' ||
    kind === 'bytes' ||
    kind === 'date' ||
    kind === 'dateTime' ||
    kind === 'email' ||
    kind === 'number' ||
    kind === 'string' ||
    kind === 'url'
  ) {
    expectRecord(value, path, diagnostics, ['kind'], ['kind'], semanticId);
    return;
  }
  if (kind === 'integer') {
    const record = expectRecord(
      value,
      path,
      diagnostics,
      ['kind', 'maximum', 'minimum'],
      ['kind'],
      semanticId,
    );
    if (!record) return;
    if (record.minimum !== undefined)
      expectNumber(record.minimum, `${path}.minimum`, diagnostics, true, semanticId);
    if (record.maximum !== undefined)
      expectNumber(record.maximum, `${path}.maximum`, diagnostics, true, semanticId);
    if (
      typeof record.minimum === 'number' &&
      typeof record.maximum === 'number' &&
      record.minimum > record.maximum
    )
      addDiagnostic(
        diagnostics,
        'OXE3101',
        `${path}.minimum`,
        'Integer minimum cannot exceed maximum.',
        semanticId,
      );
    return;
  }
  if (kind === 'decimal') {
    const record = expectRecord(
      value,
      path,
      diagnostics,
      ['kind', 'precision', 'scale'],
      ['kind', 'precision', 'scale'],
      semanticId,
    );
    if (!record) return;
    const precisionValid = expectNumber(
      record.precision,
      `${path}.precision`,
      diagnostics,
      true,
      semanticId,
    );
    const scaleValid = expectNumber(record.scale, `${path}.scale`, diagnostics, true, semanticId);
    if (precisionValid && (record.precision as number) < 1)
      addDiagnostic(
        diagnostics,
        'OXE3101',
        `${path}.precision`,
        'Decimal precision must be positive.',
        semanticId,
      );
    if (precisionValid && (record.precision as number) > 1_000)
      addDiagnostic(
        diagnostics,
        'OXE3101',
        `${path}.precision`,
        'Decimal precision cannot exceed 1000.',
        semanticId,
      );
    if (scaleValid && (record.scale as number) < 0)
      addDiagnostic(
        diagnostics,
        'OXE3101',
        `${path}.scale`,
        'Decimal scale cannot be negative.',
        semanticId,
      );
    if (precisionValid && scaleValid && (record.scale as number) > (record.precision as number))
      addDiagnostic(
        diagnostics,
        'OXE3101',
        `${path}.scale`,
        'Decimal scale cannot exceed precision.',
        semanticId,
      );
    return;
  }
  if (kind === 'enum') {
    const record = expectRecord(
      value,
      path,
      diagnostics,
      ['kind', 'values'],
      ['kind', 'values'],
      semanticId,
    );
    expectArray(record?.values, `${path}.values`, diagnostics, semanticId)?.forEach((item, index) =>
      expectString(item, `${path}.values[${index}]`, diagnostics, semanticId),
    );
    return;
  }
  if (kind === 'entity' || kind === 'entityId') {
    const record = expectRecord(
      value,
      path,
      diagnostics,
      ['entity', 'kind'],
      ['entity', 'kind'],
      semanticId,
    );
    if (record) expectString(record.entity, `${path}.entity`, diagnostics, semanticId);
    return;
  }
  if (kind === 'record') {
    const record = expectRecord(
      value,
      path,
      diagnostics,
      ['fields', 'kind'],
      ['fields', 'kind'],
      semanticId,
    );
    if (record) {
      validateStringMap(
        record.fields,
        `${path}.fields`,
        diagnostics,
        (field, fieldPath) => validateValueTypeStructure(field, fieldPath, diagnostics, semanticId),
        semanticId,
      );
    }
    return;
  }
  if (kind === 'list') {
    const record = expectRecord(
      value,
      path,
      diagnostics,
      ['items', 'kind', 'maximumItems', 'minimumItems'],
      ['items', 'kind'],
      semanticId,
    );
    if (!record) return;
    validateValueTypeStructure(record.items, `${path}.items`, diagnostics, semanticId);
    for (const key of ['minimumItems', 'maximumItems'] as const)
      if (record[key] !== undefined) {
        const valid = expectNumber(record[key], `${path}.${key}`, diagnostics, true, semanticId);
        if (valid && (record[key] as number) < 0)
          addDiagnostic(
            diagnostics,
            'OXE3101',
            `${path}.${key}`,
            `${key} cannot be negative.`,
            semanticId,
          );
      }
    if (
      typeof record.minimumItems === 'number' &&
      typeof record.maximumItems === 'number' &&
      record.minimumItems > record.maximumItems
    )
      addDiagnostic(
        diagnostics,
        'OXE3101',
        `${path}.minimumItems`,
        'List minimumItems cannot exceed maximumItems.',
        semanticId,
      );
    return;
  }
  if (kind === 'optional') {
    const record = expectRecord(
      value,
      path,
      diagnostics,
      ['kind', 'value'],
      ['kind', 'value'],
      semanticId,
    );
    if (record) validateValueTypeStructure(record.value, `${path}.value`, diagnostics, semanticId);
    return;
  }
  if (kind === 'result') {
    const record = expectRecord(
      value,
      path,
      diagnostics,
      ['kind', 'outcomes', 'value'],
      ['kind', 'outcomes', 'value'],
      semanticId,
    );
    if (!record) return;
    validateValueTypeStructure(record.value, `${path}.value`, diagnostics, semanticId);
    if (isRecord(record.outcomes) && Object.keys(record.outcomes).length === 0)
      addDiagnostic(
        diagnostics,
        'OXE3101',
        `${path}.outcomes`,
        'Result outcomes cannot be empty.',
        semanticId,
      );
    validateStringMap(
      record.outcomes,
      `${path}.outcomes`,
      diagnostics,
      (outcome, outcomePath) =>
        validateValueTypeStructure(outcome, outcomePath, diagnostics, semanticId),
      semanticId,
    );
    return;
  }
  addDiagnostic(
    diagnostics,
    'OXE3101',
    `${path}.kind`,
    'Unknown application value type.',
    semanticId,
  );
};

const validateExpressionStructure = (
  value: unknown,
  path: string,
  diagnostics: DiagnosticSink,
  semanticId?: string,
): void => {
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, 'OXE3101', path, 'Expected a value-expression object.', semanticId);
    return;
  }
  const kind = value.kind;
  if (kind === 'actor') {
    expectRecord(value, path, diagnostics, ['kind'], ['kind'], semanticId);
  } else if (kind === 'activeContext') {
    const record = expectRecord(
      value,
      path,
      diagnostics,
      ['context', 'kind'],
      ['context', 'kind'],
      semanticId,
    );
    if (record) expectString(record.context, `${path}.context`, diagnostics, semanticId);
  } else if (kind === 'inputField' || kind === 'local' || kind === 'viewData') {
    const record = expectRecord(
      value,
      path,
      diagnostics,
      ['kind', 'name'],
      ['kind', 'name'],
      semanticId,
    );
    if (record) expectString(record.name, `${path}.name`, diagnostics, semanticId);
  } else if (kind === 'formValue') {
    const record = expectRecord(
      value,
      path,
      diagnostics,
      ['kind', 'name', 'valueType'],
      ['kind', 'name'],
      semanticId,
    );
    if (record) {
      expectString(record.name, `${path}.name`, diagnostics, semanticId);
      if (record.valueType !== undefined)
        expectEnum(record.valueType, ['number'], `${path}.valueType`, diagnostics, semanticId);
    }
  } else if (kind === 'literal') {
    const record = expectRecord(
      value,
      path,
      diagnostics,
      ['kind', 'value'],
      ['kind', 'value'],
      semanticId,
    );
    if (record) validateScalar(record.value, `${path}.value`, diagnostics, semanticId);
  } else if (kind === 'not') {
    const record = expectRecord(
      value,
      path,
      diagnostics,
      ['kind', 'value'],
      ['kind', 'value'],
      semanticId,
    );
    if (record) validateExpressionStructure(record.value, `${path}.value`, diagnostics, semanticId);
  } else if (kind === 'recordField') {
    const record = expectRecord(
      value,
      path,
      diagnostics,
      ['field', 'kind', 'record'],
      ['field', 'kind', 'record'],
      semanticId,
    );
    if (record) {
      expectString(record.field, `${path}.field`, diagnostics, semanticId);
      validateExpressionStructure(record.record, `${path}.record`, diagnostics, semanticId);
    }
  } else if (kind === 'semanticReference') {
    const record = expectRecord(
      value,
      path,
      diagnostics,
      ['kind', 'target'],
      ['kind', 'target'],
      semanticId,
    );
    if (record) expectString(record.target, `${path}.target`, diagnostics, semanticId);
  } else {
    addDiagnostic(
      diagnostics,
      'OXE3101',
      `${path}.kind`,
      'Unknown application value expression.',
      semanticId,
    );
  }
};

const validateInvocationStructure = (
  value: unknown,
  path: string,
  diagnostics: DiagnosticSink,
  semanticId?: string,
): void => {
  const record = expectRecord(
    value,
    path,
    diagnostics,
    ['arguments', 'operation'],
    ['arguments', 'operation'],
    semanticId,
  );
  if (!record) return;
  expectString(record.operation, `${path}.operation`, diagnostics, semanticId);
  validateStringMap(
    record.arguments,
    `${path}.arguments`,
    diagnostics,
    (argument, argumentPath) =>
      validateExpressionStructure(argument, argumentPath, diagnostics, semanticId),
    semanticId,
  );
};

const validateViewElementStructure = (
  value: unknown,
  path: string,
  diagnostics: DiagnosticSink,
  containingId: string,
): void => {
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, 'OXE3101', path, 'Expected a view-element object.', containingId);
    return;
  }
  const semanticId = typeof value.id === 'string' ? value.id : containingId;
  if (value.kind === 'component') {
    const record = expectRecord(
      value,
      path,
      diagnostics,
      ['children', 'component', 'events', 'fields', 'id', 'kind', 'props', 'submit'],
      ['component', 'kind'],
      semanticId,
    );
    if (!record) return;
    expectString(record.component, `${path}.component`, diagnostics, semanticId);
    if (record.id !== undefined) expectString(record.id, `${path}.id`, diagnostics, semanticId);
    if (record.fields !== undefined) {
      expectArray(record.fields, `${path}.fields`, diagnostics, semanticId)?.forEach(
        (field, index) => expectString(field, `${path}.fields[${index}]`, diagnostics, semanticId),
      );
    }
    if (record.children !== undefined) {
      const children = expectArray(record.children, `${path}.children`, diagnostics, semanticId);
      children?.forEach((child, index) =>
        validateViewElementStructure(child, `${path}.children[${index}]`, diagnostics, semanticId),
      );
    }
    if (record.props !== undefined) {
      validateStringMap(
        record.props,
        `${path}.props`,
        diagnostics,
        (prop, propPath) => validateExpressionStructure(prop, propPath, diagnostics, semanticId),
        semanticId,
      );
    }
    if (record.events !== undefined) {
      validateStringMap(
        record.events,
        `${path}.events`,
        diagnostics,
        (event, eventPath) =>
          validateInvocationStructure(event, eventPath, diagnostics, semanticId),
        semanticId,
      );
    }
    if (record.submit !== undefined)
      validateInvocationStructure(record.submit, `${path}.submit`, diagnostics, semanticId);
    return;
  }
  if (value.kind === 'repeat') {
    const record = expectRecord(
      value,
      path,
      diagnostics,
      ['display', 'id', 'identity', 'itemName', 'kind', 'source', 'template'],
      ['identity', 'itemName', 'kind', 'source', 'template'],
      semanticId,
    );
    if (!record) return;
    if (record.id !== undefined) expectString(record.id, `${path}.id`, diagnostics, semanticId);
    if (record.display !== undefined) {
      expectArray(record.display, `${path}.display`, diagnostics, semanticId)?.forEach(
        (field, index) => expectString(field, `${path}.display[${index}]`, diagnostics, semanticId),
      );
    }
    expectString(record.itemName, `${path}.itemName`, diagnostics, semanticId);
    validateExpressionStructure(record.identity, `${path}.identity`, diagnostics, semanticId);
    validateExpressionStructure(record.source, `${path}.source`, diagnostics, semanticId);
    validateViewElementStructure(record.template, `${path}.template`, diagnostics, semanticId);
    return;
  }
  addDiagnostic(
    diagnostics,
    'OXE3101',
    `${path}.kind`,
    'Unknown application view element.',
    semanticId,
  );
};

const validateNodeHeader = (
  value: unknown,
  path: string,
  diagnostics: DiagnosticSink,
  kind: string,
  allowed: readonly string[],
  required: readonly string[],
): UnknownRecord | undefined => {
  const semanticId = isRecord(value) && typeof value.id === 'string' ? value.id : undefined;
  const record = expectRecord(value, path, diagnostics, allowed, required, semanticId);
  if (!record) return undefined;
  expectString(record.id, `${path}.id`, diagnostics, semanticId);
  if (record.kind !== kind) {
    addDiagnostic(
      diagnostics,
      'OXE3101',
      `${path}.kind`,
      `Expected node kind "${kind}".`,
      semanticId,
    );
  }
  return record;
};

const validateNodeArray = (
  value: unknown,
  path: string,
  diagnostics: DiagnosticSink,
  validate: (value: unknown, path: string) => void,
): void => {
  expectArray(value, path, diagnostics)?.forEach((node, index) =>
    validate(node, `${path}[${index}]`),
  );
};

const validateGraphStructure = (value: unknown): ApplicationGraphDiagnostic[] => {
  const diagnostics: ApplicationGraphDiagnostic[] = [];
  const root = expectRecord(
    value,
    '$',
    diagnostics,
    [
      'app',
      'capabilities',
      'components',
      'contexts',
      'entities',
      'features',
      'fields',
      'format',
      'modules',
      'operations',
      'policies',
      'queries',
      'relations',
      'revision',
      'routes',
      'styles',
      'uniques',
      'verification',
      'version',
      'views',
    ],
    [
      'app',
      'entities',
      'features',
      'fields',
      'format',
      'operations',
      'policies',
      'queries',
      'relations',
      'revision',
      'routes',
      'verification',
      'version',
      'views',
    ],
  );
  if (!root) return diagnostics;
  if (root.format !== 'oxe.application-graph')
    addDiagnostic(diagnostics, 'OXE3101', '$.format', 'Expected "oxe.application-graph".');
  if (root.version !== 1)
    addDiagnostic(
      diagnostics,
      'OXE3101',
      '$.version',
      'Only application graph version 1 is supported.',
    );
  if (
    expectNumber(root.revision, '$.revision', diagnostics, true) &&
    (root.revision as number) < 0
  ) {
    addDiagnostic(diagnostics, 'OXE3101', '$.revision', 'Revision must be nonnegative.');
  }

  const app = validateNodeHeader(
    root.app,
    '$.app',
    diagnostics,
    'app',
    ['actorEntity', 'authentication', 'contexts', 'entryRoute', 'id', 'kind', 'name'],
    ['actorEntity', 'entryRoute', 'id', 'kind', 'name'],
  );
  if (app) {
    expectString(app.name, '$.app.name', diagnostics, app.id as string | undefined);
    expectString(app.entryRoute, '$.app.entryRoute', diagnostics, app.id as string | undefined);
    expectString(app.actorEntity, '$.app.actorEntity', diagnostics, app.id as string | undefined);
    if (app.authentication !== undefined) {
      const authentication = expectRecord(
        app.authentication,
        '$.app.authentication',
        diagnostics,
        ['authenticatedRoute', 'methods', 'provider', 'signInPath', 'signUpPath'],
        ['authenticatedRoute', 'methods', 'provider', 'signInPath', 'signUpPath'],
        app.id as string | undefined,
      );
      if (authentication) {
        expectEnum(
          authentication.provider,
          ['betterAuth'],
          '$.app.authentication.provider',
          diagnostics,
          app.id as string | undefined,
        );
        expectString(
          authentication.authenticatedRoute,
          '$.app.authentication.authenticatedRoute',
          diagnostics,
          app.id as string | undefined,
        );
        for (const key of ['signInPath', 'signUpPath'] as const)
          expectString(
            authentication[key],
            `$.app.authentication.${key}`,
            diagnostics,
            app.id as string | undefined,
          );
        expectArray(
          authentication.methods,
          '$.app.authentication.methods',
          diagnostics,
          app.id as string | undefined,
        )?.forEach((method, index) =>
          expectEnum(
            method,
            ['emailPassword'],
            `$.app.authentication.methods[${index}]`,
            diagnostics,
            app.id as string | undefined,
          ),
        );
      }
    }
    if (app.contexts !== undefined)
      expectArray(
        app.contexts,
        '$.app.contexts',
        diagnostics,
        app.id as string | undefined,
      )?.forEach((entity, index) =>
        expectString(entity, `$.app.contexts[${index}]`, diagnostics, app.id as string | undefined),
      );
  }

  const validateExtensionBinding = (value: unknown, path: string, semanticId?: string): void => {
    const binding = expectRecord(
      value,
      path,
      diagnostics,
      ['export', 'jobIdempotency', 'module'],
      ['export', 'module'],
      semanticId,
    );
    if (!binding) return;
    expectString(binding.export, `${path}.export`, diagnostics, semanticId);
    expectString(binding.module, `${path}.module`, diagnostics, semanticId);
    if (binding.jobIdempotency !== undefined)
      expectEnum(
        binding.jobIdempotency,
        ['jobId'],
        `${path}.jobIdempotency`,
        diagnostics,
        semanticId,
      );
  };

  validateNodeArray(root.modules ?? [], '$.modules', diagnostics, (node, path) => {
    const record = validateNodeHeader(
      node,
      path,
      diagnostics,
      'extensionModule',
      ['format', 'id', 'integrity', 'kind', 'name', 'packages', 'source', 'target'],
      ['format', 'id', 'integrity', 'kind', 'name', 'source', 'target'],
    );
    if (!record) return;
    const id = record.id as string | undefined;
    expectEnum(record.format, ['css', 'javascript'], `${path}.format`, diagnostics, id);
    expectString(record.integrity, `${path}.integrity`, diagnostics, id);
    expectString(record.name, `${path}.name`, diagnostics, id);
    expectString(record.source, `${path}.source`, diagnostics, id);
    expectEnum(
      record.target,
      ['browser', 'server', 'universal'],
      `${path}.target`,
      diagnostics,
      id,
    );
    if (record.packages !== undefined)
      validateStringMap(
        record.packages,
        `${path}.packages`,
        diagnostics,
        (version, versionPath) => expectString(version, versionPath, diagnostics, id),
        id,
      );
  });

  validateNodeArray(root.capabilities ?? [], '$.capabilities', diagnostics, (node, path) => {
    const record = validateNodeHeader(
      node,
      path,
      diagnostics,
      'capability',
      ['adapter', 'contract', 'id', 'kind', 'methods', 'name', 'version'],
      ['contract', 'id', 'kind', 'methods', 'name', 'version'],
    );
    if (!record) return;
    const id = record.id as string | undefined;
    expectString(record.contract, `${path}.contract`, diagnostics, id);
    expectString(record.name, `${path}.name`, diagnostics, id);
    expectString(record.version, `${path}.version`, diagnostics, id);
    if (record.adapter !== undefined)
      validateExtensionBinding(record.adapter, `${path}.adapter`, id);
    validateStringMap(
      record.methods,
      `${path}.methods`,
      diagnostics,
      (method, methodPath) => {
        const item = expectRecord(
          method,
          methodPath,
          diagnostics,
          ['input', 'output'],
          ['input', 'output'],
          id,
        );
        if (item) {
          validateValueTypeStructure(item.input, `${methodPath}.input`, diagnostics, id);
          validateValueTypeStructure(item.output, `${methodPath}.output`, diagnostics, id);
          if (isRecord(item.input) && item.input.kind !== 'record')
            addDiagnostic(
              diagnostics,
              'OXE3101',
              `${methodPath}.input.kind`,
              'Capability method input must be a record type.',
              id,
            );
        }
      },
      id,
    );
  });

  validateNodeArray(root.components ?? [], '$.components', diagnostics, (node, path) => {
    const record = validateNodeHeader(
      node,
      path,
      diagnostics,
      'componentExtension',
      ['children', 'events', 'id', 'implementation', 'kind', 'name', 'props', 'ssr'],
      ['children', 'id', 'implementation', 'kind', 'name', 'props', 'ssr'],
    );
    if (!record) return;
    const id = record.id as string | undefined;
    expectEnum(
      record.children,
      ['none', 'optional', 'required'],
      `${path}.children`,
      diagnostics,
      id,
    );
    expectString(record.name, `${path}.name`, diagnostics, id);
    validateExtensionBinding(record.implementation, `${path}.implementation`, id);
    validateStringMap(
      record.props,
      `${path}.props`,
      diagnostics,
      (prop, propPath) => validateValueTypeStructure(prop, propPath, diagnostics, id),
      id,
    );
    if (record.events !== undefined)
      expectArray(record.events, `${path}.events`, diagnostics, id)?.forEach((event, index) =>
        expectString(event, `${path}.events[${index}]`, diagnostics, id),
      );
    const ssr = expectRecord(record.ssr, `${path}.ssr`, diagnostics, ['tag'], ['tag'], id);
    if (ssr) expectString(ssr.tag, `${path}.ssr.tag`, diagnostics, id);
  });

  validateNodeArray(root.styles ?? [], '$.styles', diagnostics, (node, path) => {
    const record = validateNodeHeader(
      node,
      path,
      diagnostics,
      'style',
      ['id', 'kind', 'name', 'stylesheets', 'themes', 'tokens'],
      ['id', 'kind', 'name', 'tokens'],
    );
    if (!record) return;
    const id = record.id as string | undefined;
    expectString(record.name, `${path}.name`, diagnostics, id);
    validateStringMap(
      record.tokens,
      `${path}.tokens`,
      diagnostics,
      (token, tokenPath) => expectString(token, tokenPath, diagnostics, id),
      id,
    );
    if (record.themes !== undefined)
      validateStringMap(
        record.themes,
        `${path}.themes`,
        diagnostics,
        (theme, themePath) =>
          validateStringMap(
            theme,
            themePath,
            diagnostics,
            (token, tokenPath) => expectString(token, tokenPath, diagnostics, id),
            id,
          ),
        id,
      );
    if (record.stylesheets !== undefined)
      expectArray(record.stylesheets, `${path}.stylesheets`, diagnostics, id)?.forEach(
        (stylesheet, index) =>
          expectString(stylesheet, `${path}.stylesheets[${index}]`, diagnostics, id),
      );
  });

  validateNodeArray(root.contexts ?? [], '$.contexts', diagnostics, (node, path) => {
    const record = validateNodeHeader(
      node,
      path,
      diagnostics,
      'context',
      ['authorization', 'entity', 'id', 'kind', 'labelField', 'name', 'parents'],
      ['authorization', 'entity', 'id', 'kind', 'name'],
    );
    if (!record) return;
    const id = record.id as string | undefined;
    expectString(record.entity, `${path}.entity`, diagnostics, id);
    if (record.labelField !== undefined)
      expectString(record.labelField, `${path}.labelField`, diagnostics, id);
    expectString(record.name, `${path}.name`, diagnostics, id);
    const validateAuthorizationMethod = (value: unknown, methodPath: string): void => {
      const membership = isRecord(value) && value.kind === 'membership';
      const method = expectRecord(
        value,
        methodPath,
        diagnostics,
        membership
          ? ['conditions', 'kind', 'memberRelation', 'membershipEntity', 'resourceRelation']
          : ['kind', 'relation'],
        membership
          ? ['kind', 'memberRelation', 'membershipEntity', 'resourceRelation']
          : ['kind', 'relation'],
        id,
      );
      if (method?.kind === 'membership') {
        for (const key of ['memberRelation', 'membershipEntity', 'resourceRelation'] as const)
          expectString(method[key], `${methodPath}.${key}`, diagnostics, id);
        if (method.conditions !== undefined)
          expectArray(method.conditions, `${methodPath}.conditions`, diagnostics, id)?.forEach(
            (condition, index) => {
              const conditionPath = `${methodPath}.conditions[${index}]`;
              const item = expectRecord(
                condition,
                conditionPath,
                diagnostics,
                ['equals', 'field'],
                ['equals', 'field'],
                id,
              );
              if (item) {
                expectString(item.field, `${conditionPath}.field`, diagnostics, id);
                validateScalar(item.equals, `${conditionPath}.equals`, diagnostics, id);
              }
            },
          );
      } else if (method) {
        expectEnum(method.kind, ['relationEqualsActor'], `${methodPath}.kind`, diagnostics, id);
        expectString(method.relation, `${methodPath}.relation`, diagnostics, id);
      }
    };
    if (isRecord(record.authorization) && record.authorization.kind === 'anyOf') {
      const authorization = expectRecord(
        record.authorization,
        `${path}.authorization`,
        diagnostics,
        ['anyOf', 'kind'],
        ['anyOf', 'kind'],
        id,
      );
      expectEnum(authorization?.kind, ['anyOf'], `${path}.authorization.kind`, diagnostics, id);
      expectArray(authorization?.anyOf, `${path}.authorization.anyOf`, diagnostics, id)?.forEach(
        (method, index) =>
          validateAuthorizationMethod(method, `${path}.authorization.anyOf[${index}]`),
      );
    } else validateAuthorizationMethod(record.authorization, `${path}.authorization`);
    if (record.parents !== undefined)
      expectArray(record.parents, `${path}.parents`, diagnostics, id)?.forEach((parent, index) => {
        const parentPath = `${path}.parents[${index}]`;
        const item = expectRecord(
          parent,
          parentPath,
          diagnostics,
          ['context', 'relation'],
          ['context', 'relation'],
          id,
        );
        if (item) {
          expectString(item.context, `${parentPath}.context`, diagnostics, id);
          expectString(item.relation, `${parentPath}.relation`, diagnostics, id);
        }
      });
  });

  validateNodeArray(root.features, '$.features', diagnostics, (node, path) => {
    const record = validateNodeHeader(
      node,
      path,
      diagnostics,
      'feature',
      ['id', 'kind', 'name'],
      ['id', 'kind', 'name'],
    );
    if (record)
      expectString(record.name, `${path}.name`, diagnostics, record.id as string | undefined);
  });
  validateNodeArray(root.entities, '$.entities', diagnostics, (node, path) => {
    const record = validateNodeHeader(
      node,
      path,
      diagnostics,
      'entity',
      ['feature', 'fields', 'id', 'kind', 'name', 'origin'],
      ['id', 'kind', 'name'],
    );
    if (!record) return;
    const id = record.id as string | undefined;
    expectString(record.name, `${path}.name`, diagnostics, id);
    if (record.feature !== undefined)
      expectString(record.feature, `${path}.feature`, diagnostics, id);
    if (record.origin !== undefined)
      expectEnum(record.origin, ['builtin', 'generated'], `${path}.origin`, diagnostics, id);
    if (record.fields !== undefined)
      expectArray(record.fields, `${path}.fields`, diagnostics, id)?.forEach((field, index) =>
        expectString(field, `${path}.fields[${index}]`, diagnostics, id),
      );
  });
  validateNodeArray(root.fields, '$.fields', diagnostics, (node, path) => {
    const record = validateNodeHeader(
      node,
      path,
      diagnostics,
      'field',
      ['default', 'entity', 'id', 'kind', 'name', 'origin', 'required', 'validation', 'valueType'],
      ['entity', 'id', 'kind', 'name', 'required', 'valueType'],
    );
    if (!record) return;
    const id = record.id as string | undefined;
    expectString(record.entity, `${path}.entity`, diagnostics, id);
    expectString(record.name, `${path}.name`, diagnostics, id);
    expectBoolean(record.required, `${path}.required`, diagnostics, id);
    if (record.origin !== undefined)
      expectEnum(record.origin, ['builtin', 'generated'], `${path}.origin`, diagnostics, id);
    validateValueTypeStructure(record.valueType, `${path}.valueType`, diagnostics, id);
    if (record.default !== undefined)
      validateExpressionStructure(record.default, `${path}.default`, diagnostics, id);
    if (record.validation !== undefined) {
      expectArray(record.validation, `${path}.validation`, diagnostics, id)?.forEach(
        (constraint, index) => {
          const constraintPath = `${path}.validation[${index}]`;
          const item = expectRecord(
            constraint,
            constraintPath,
            diagnostics,
            ['kind', 'max', 'min'],
            ['kind'],
            id,
          );
          if (!item) return;
          if (item.kind !== 'stringLength')
            addDiagnostic(
              diagnostics,
              'OXE3101',
              `${constraintPath}.kind`,
              'Expected "stringLength".',
              id,
            );
          if (item.min !== undefined)
            expectNumber(item.min, `${constraintPath}.min`, diagnostics, true, id);
          if (item.max !== undefined)
            expectNumber(item.max, `${constraintPath}.max`, diagnostics, true, id);
        },
      );
    }
  });
  validateNodeArray(root.uniques ?? [], '$.uniques', diagnostics, (node, path) => {
    const record = validateNodeHeader(
      node,
      path,
      diagnostics,
      'unique',
      ['entity', 'id', 'keys', 'kind'],
      ['entity', 'id', 'keys', 'kind'],
    );
    if (!record) return;
    const id = record.id as string | undefined;
    expectString(record.entity, `${path}.entity`, diagnostics, id);
    expectArray(record.keys, `${path}.keys`, diagnostics, id)?.forEach((key, index) =>
      expectString(key, `${path}.keys[${index}]`, diagnostics, id),
    );
  });
  validateNodeArray(root.relations, '$.relations', diagnostics, (node, path) => {
    const record = validateNodeHeader(
      node,
      path,
      diagnostics,
      'relation',
      ['feature', 'from', 'id', 'kind', 'to'],
      ['from', 'id', 'kind', 'to'],
    );
    if (!record) return;
    const id = record.id as string | undefined;
    if (record.feature !== undefined)
      expectString(record.feature, `${path}.feature`, diagnostics, id);
    for (const side of ['from', 'to'] as const) {
      const endpointPath = `${path}.${side}`;
      const endpoint = expectRecord(
        record[side],
        endpointPath,
        diagnostics,
        ['cardinality', 'createValue', 'entity', 'name', 'required'],
        ['cardinality', 'entity', 'name', 'required'],
        id,
      );
      if (!endpoint) continue;
      expectString(endpoint.entity, `${endpointPath}.entity`, diagnostics, id);
      expectString(endpoint.name, `${endpointPath}.name`, diagnostics, id);
      expectEnum(
        endpoint.cardinality,
        ['many', 'one'],
        `${endpointPath}.cardinality`,
        diagnostics,
        id,
      );
      expectBoolean(endpoint.required, `${endpointPath}.required`, diagnostics, id);
      if (endpoint.createValue !== undefined)
        validateExpressionStructure(
          endpoint.createValue,
          `${endpointPath}.createValue`,
          diagnostics,
          id,
        );
    }
  });
  const validatePredicate = (predicate: unknown, path: string, id?: string): void => {
    if (!isRecord(predicate)) {
      addDiagnostic(diagnostics, 'OXE3101', path, 'Expected a policy predicate.', id);
    } else if (predicate.kind === 'authenticated') {
      expectRecord(predicate, path, diagnostics, ['kind'], ['kind'], id);
    } else if (predicate.kind === 'relationEqualsActor') {
      const item = expectRecord(
        predicate,
        path,
        diagnostics,
        ['kind', 'relation'],
        ['kind', 'relation'],
        id,
      );
      if (item) expectString(item.relation, `${path}.relation`, diagnostics, id);
    } else if (predicate.kind === 'relationEqualsContext') {
      const item = expectRecord(
        predicate,
        path,
        diagnostics,
        ['context', 'kind', 'relation'],
        ['context', 'kind', 'relation'],
        id,
      );
      if (item) {
        expectString(item.context, `${path}.context`, diagnostics, id);
        expectString(item.relation, `${path}.relation`, diagnostics, id);
      }
    } else {
      addDiagnostic(diagnostics, 'OXE3101', `${path}.kind`, 'Unknown policy predicate.', id);
    }
  };
  validateNodeArray(root.policies, '$.policies', diagnostics, (node, path) => {
    const record = validateNodeHeader(
      node,
      path,
      diagnostics,
      'policy',
      ['id', 'kind', 'rules', 'target'],
      ['id', 'kind', 'rules', 'target'],
    );
    if (!record) return;
    const id = record.id as string | undefined;
    expectString(record.target, `${path}.target`, diagnostics, id);
    const rules = expectRecord(
      record.rules,
      `${path}.rules`,
      diagnostics,
      ['create', 'delete', 'read', 'update'],
      ['create', 'delete', 'read', 'update'],
      id,
    );
    if (rules)
      for (const rule of ['create', 'delete', 'read', 'update'])
        validatePredicate(rules[rule], `${path}.rules.${rule}`, id);
  });
  validateNodeArray(root.queries, '$.queries', diagnostics, (node, path) => {
    const record = validateNodeHeader(
      node,
      path,
      diagnostics,
      'query',
      ['cache', 'entity', 'feature', 'filter', 'id', 'kind', 'name', 'order', 'select', 'where'],
      ['entity', 'id', 'kind', 'name', 'select'],
    );
    if (!record) return;
    const id = record.id as string | undefined;
    expectString(record.entity, `${path}.entity`, diagnostics, id);
    expectString(record.name, `${path}.name`, diagnostics, id);
    if (record.feature !== undefined)
      expectString(record.feature, `${path}.feature`, diagnostics, id);
    if (record.filter !== undefined) validatePredicate(record.filter, `${path}.filter`, id);
    if (record.cache !== undefined) {
      const cache = expectRecord(
        record.cache,
        `${path}.cache`,
        diagnostics,
        ['kind', 'maxAgeMs'],
        ['kind'],
        id,
      );
      if (cache) {
        expectEnum(cache.kind, ['memory', 'no-store'], `${path}.cache.kind`, diagnostics, id);
        if (cache.kind === 'memory') {
          if (cache.maxAgeMs === undefined)
            addDiagnostic(
              diagnostics,
              'OXE3101',
              `${path}.cache.maxAgeMs`,
              'Memory cache policy requires maxAgeMs.',
              id,
            );
          else if (
            expectNumber(cache.maxAgeMs, `${path}.cache.maxAgeMs`, diagnostics, true, id) &&
            cache.maxAgeMs < 0
          )
            addDiagnostic(
              diagnostics,
              'OXE3101',
              `${path}.cache.maxAgeMs`,
              'Cache maxAgeMs must be nonnegative.',
              id,
            );
        } else if (cache.kind === 'no-store' && cache.maxAgeMs !== undefined)
          addDiagnostic(
            diagnostics,
            'OXE3101',
            `${path}.cache.maxAgeMs`,
            'No-store cache policy cannot declare maxAgeMs.',
            id,
          );
      }
    }
    expectArray(record.select, `${path}.select`, diagnostics, id)?.forEach((field, index) =>
      expectString(field, `${path}.select[${index}]`, diagnostics, id),
    );
    if (record.order !== undefined)
      expectArray(record.order, `${path}.order`, diagnostics, id)?.forEach((order, index) => {
        const orderPath = `${path}.order[${index}]`;
        const item = expectRecord(
          order,
          orderPath,
          diagnostics,
          ['direction', 'field'],
          ['direction', 'field'],
          id,
        );
        if (item) {
          expectString(item.field, `${orderPath}.field`, diagnostics, id);
          expectEnum(
            item.direction,
            ['ascending', 'descending'],
            `${orderPath}.direction`,
            diagnostics,
            id,
          );
        }
      });
    if (record.where !== undefined)
      expectArray(record.where, `${path}.where`, diagnostics, id)?.forEach((condition, index) => {
        const conditionPath = `${path}.where[${index}]`;
        const item = expectRecord(
          condition,
          conditionPath,
          diagnostics,
          ['equals', 'field'],
          ['equals', 'field'],
          id,
        );
        if (item) {
          expectString(item.field, `${conditionPath}.field`, diagnostics, id);
          validateScalar(item.equals, `${conditionPath}.equals`, diagnostics, id);
        }
      });
  });
  validateNodeArray(root.operations, '$.operations', diagnostics, (node, path) => {
    const record = validateNodeHeader(
      node,
      path,
      diagnostics,
      'operation',
      ['body', 'effects', 'feature', 'id', 'input', 'kind', 'name', 'output'],
      ['body', 'effects', 'id', 'input', 'kind', 'name', 'output'],
    );
    if (!record) return;
    const id = record.id as string | undefined;
    expectString(record.name, `${path}.name`, diagnostics, id);
    if (record.feature !== undefined)
      expectString(record.feature, `${path}.feature`, diagnostics, id);
    validateValueTypeStructure(record.input, `${path}.input`, diagnostics, id);
    validateValueTypeStructure(record.output, `${path}.output`, diagnostics, id);
    expectArray(record.effects, `${path}.effects`, diagnostics, id)?.forEach((effect, index) => {
      const effectPath = `${path}.effects[${index}]`;
      const item = expectRecord(
        effect,
        effectPath,
        diagnostics,
        ['kind', 'target'],
        ['kind', 'target'],
        id,
      );
      if (item) {
        expectEnum(
          item.kind,
          ['databaseWrite', 'externalCall', 'jobEnqueue'],
          `${effectPath}.kind`,
          diagnostics,
          id,
        );
        expectString(item.target, `${effectPath}.target`, diagnostics, id);
      }
    });
    if (!isRecord(record.body)) {
      addDiagnostic(diagnostics, 'OXE3101', `${path}.body`, 'Expected an operation body.', id);
    } else if (record.body.kind === 'createEntity') {
      const body = expectRecord(
        record.body,
        `${path}.body`,
        diagnostics,
        ['entity', 'kind', 'values'],
        ['entity', 'kind', 'values'],
        id,
      );
      if (body) {
        expectString(body.entity, `${path}.body.entity`, diagnostics, id);
        validateStringMap(
          body.values,
          `${path}.body.values`,
          diagnostics,
          (expression, expressionPath) =>
            validateExpressionStructure(expression, expressionPath, diagnostics, id),
          id,
        );
      }
    } else if (record.body.kind === 'updateEntity') {
      const body = expectRecord(
        record.body,
        `${path}.body`,
        diagnostics,
        ['kind', 'record', 'values'],
        ['kind', 'record', 'values'],
        id,
      );
      if (body) {
        validateExpressionStructure(body.record, `${path}.body.record`, diagnostics, id);
        validateStringMap(
          body.values,
          `${path}.body.values`,
          diagnostics,
          (expression, expressionPath) =>
            validateExpressionStructure(expression, expressionPath, diagnostics, id),
          id,
        );
      }
    } else if (record.body.kind === 'deleteEntity') {
      const body = expectRecord(
        record.body,
        `${path}.body`,
        diagnostics,
        ['kind', 'record'],
        ['kind', 'record'],
        id,
      );
      if (body) validateExpressionStructure(body.record, `${path}.body.record`, diagnostics, id);
    } else if (record.body.kind === 'invokeCapability') {
      const body = expectRecord(
        record.body,
        `${path}.body`,
        diagnostics,
        ['arguments', 'capability', 'kind', 'method'],
        ['arguments', 'capability', 'kind', 'method'],
        id,
      );
      if (body) {
        expectString(body.capability, `${path}.body.capability`, diagnostics, id);
        expectString(body.method, `${path}.body.method`, diagnostics, id);
        validateStringMap(
          body.arguments,
          `${path}.body.arguments`,
          diagnostics,
          (expression, expressionPath) =>
            validateExpressionStructure(expression, expressionPath, diagnostics, id),
          id,
        );
      }
    } else if (record.body.kind === 'workflow') {
      const body = expectRecord(
        record.body,
        `${path}.body`,
        diagnostics,
        ['kind', 'result', 'steps'],
        ['kind', 'result', 'steps'],
        id,
      );
      if (body) {
        expectArray(body.steps, `${path}.body.steps`, diagnostics, id)?.forEach((step, index) => {
          const stepPath = `${path}.body.steps[${index}]`;
          if (!isRecord(step)) {
            addDiagnostic(diagnostics, 'OXE3101', stepPath, 'Expected a workflow step.', id);
            return;
          }
          const common = ['as', 'entity', 'kind'];
          if (step.kind === 'createEntity') {
            const item = expectRecord(
              step,
              stepPath,
              diagnostics,
              [...common, 'values'],
              [...common, 'values'],
              id,
            );
            if (item)
              validateStringMap(
                item.values,
                `${stepPath}.values`,
                diagnostics,
                (expression, expressionPath) =>
                  validateExpressionStructure(expression, expressionPath, diagnostics, id),
                id,
              );
          } else if (step.kind === 'updateEntity') {
            const item = expectRecord(
              step,
              stepPath,
              diagnostics,
              [...common, 'record', 'values'],
              [...common, 'record', 'values'],
              id,
            );
            if (item) {
              validateExpressionStructure(item.record, `${stepPath}.record`, diagnostics, id);
              validateStringMap(
                item.values,
                `${stepPath}.values`,
                diagnostics,
                (expression, expressionPath) =>
                  validateExpressionStructure(expression, expressionPath, diagnostics, id),
                id,
              );
            }
          } else if (step.kind === 'deleteEntity') {
            const item = expectRecord(
              step,
              stepPath,
              diagnostics,
              [...common, 'record'],
              [...common, 'record'],
              id,
            );
            if (item)
              validateExpressionStructure(item.record, `${stepPath}.record`, diagnostics, id);
          } else if (step.kind === 'enqueueCapability') {
            const item = expectRecord(
              step,
              stepPath,
              diagnostics,
              ['arguments', 'as', 'capability', 'kind', 'method', 'retry'],
              ['arguments', 'as', 'capability', 'kind', 'method', 'retry'],
              id,
            );
            if (item) {
              expectString(item.capability, `${stepPath}.capability`, diagnostics, id);
              expectString(item.method, `${stepPath}.method`, diagnostics, id);
              validateStringMap(
                item.arguments,
                `${stepPath}.arguments`,
                diagnostics,
                (expression, expressionPath) =>
                  validateExpressionStructure(expression, expressionPath, diagnostics, id),
                id,
              );
              const retry = expectRecord(
                item.retry,
                `${stepPath}.retry`,
                diagnostics,
                ['initialDelayMs', 'jitterRatio', 'maxAttempts', 'maxDelayMs', 'multiplier'],
                ['maxAttempts'],
                id,
              );
              if (retry) {
                if (
                  expectNumber(
                    retry.maxAttempts,
                    `${stepPath}.retry.maxAttempts`,
                    diagnostics,
                    true,
                    id,
                  ) &&
                  (retry.maxAttempts as number) < 1
                )
                  addDiagnostic(
                    diagnostics,
                    'OXE3101',
                    `${stepPath}.retry.maxAttempts`,
                    'maxAttempts must be at least 1.',
                    id,
                  );
                for (const key of ['initialDelayMs', 'maxDelayMs', 'multiplier', 'jitterRatio']) {
                  const value = retry[key];
                  if (value !== undefined)
                    expectNumber(value, `${stepPath}.retry.${key}`, diagnostics, false, id);
                }
                if (typeof retry.initialDelayMs === 'number' && retry.initialDelayMs < 0)
                  addDiagnostic(
                    diagnostics,
                    'OXE3101',
                    `${stepPath}.retry.initialDelayMs`,
                    'initialDelayMs must be nonnegative.',
                    id,
                  );
                if (typeof retry.maxDelayMs === 'number' && retry.maxDelayMs < 0)
                  addDiagnostic(
                    diagnostics,
                    'OXE3101',
                    `${stepPath}.retry.maxDelayMs`,
                    'maxDelayMs must be nonnegative.',
                    id,
                  );
                if (
                  typeof retry.initialDelayMs === 'number' &&
                  typeof retry.maxDelayMs === 'number' &&
                  retry.maxDelayMs < retry.initialDelayMs
                )
                  addDiagnostic(
                    diagnostics,
                    'OXE3101',
                    `${stepPath}.retry.maxDelayMs`,
                    'maxDelayMs must be greater than or equal to initialDelayMs.',
                    id,
                  );
                if (typeof retry.multiplier === 'number' && retry.multiplier < 1)
                  addDiagnostic(
                    diagnostics,
                    'OXE3101',
                    `${stepPath}.retry.multiplier`,
                    'multiplier must be at least 1.',
                    id,
                  );
                if (
                  typeof retry.jitterRatio === 'number' &&
                  (retry.jitterRatio < 0 || retry.jitterRatio > 1)
                )
                  addDiagnostic(
                    diagnostics,
                    'OXE3101',
                    `${stepPath}.retry.jitterRatio`,
                    'jitterRatio must be between 0 and 1.',
                    id,
                  );
              }
            }
          } else {
            addDiagnostic(diagnostics, 'OXE3101', `${stepPath}.kind`, 'Unknown workflow step.', id);
          }
          expectString(step.as, `${stepPath}.as`, diagnostics, id);
          if (step.kind !== 'enqueueCapability')
            expectString(step.entity, `${stepPath}.entity`, diagnostics, id);
        });
        validateExpressionStructure(body.result, `${path}.body.result`, diagnostics, id);
      }
    } else {
      addDiagnostic(diagnostics, 'OXE3101', `${path}.body.kind`, 'Unknown operation body.', id);
    }
  });
  validateNodeArray(root.routes, '$.routes', diagnostics, (node, path) => {
    const record = validateNodeHeader(
      node,
      path,
      diagnostics,
      'route',
      ['authentication', 'feature', 'id', 'kind', 'path', 'view'],
      ['authentication', 'id', 'kind', 'path', 'view'],
    );
    if (!record) return;
    const id = record.id as string | undefined;
    expectString(record.path, `${path}.path`, diagnostics, id);
    expectString(record.view, `${path}.view`, diagnostics, id);
    if (record.feature !== undefined)
      expectString(record.feature, `${path}.feature`, diagnostics, id);
    expectEnum(
      record.authentication,
      ['optional', 'required'],
      `${path}.authentication`,
      diagnostics,
      id,
    );
  });
  validateNodeArray(root.views, '$.views', diagnostics, (node, path) => {
    const record = validateNodeHeader(
      node,
      path,
      diagnostics,
      'view',
      ['data', 'feature', 'id', 'kind', 'modes', 'name', 'tree'],
      ['data', 'id', 'kind', 'modes', 'name', 'tree'],
    );
    if (!record) return;
    const id = record.id as string | undefined;
    expectString(record.name, `${path}.name`, diagnostics, id);
    if (record.feature !== undefined)
      expectString(record.feature, `${path}.feature`, diagnostics, id);
    validateStringMap(
      record.data,
      `${path}.data`,
      diagnostics,
      (binding, bindingPath) => {
        const item = expectRecord(binding, bindingPath, diagnostics, ['query'], ['query'], id);
        if (item) expectString(item.query, `${bindingPath}.query`, diagnostics, id);
      },
      id,
    );
    const modes = expectRecord(
      record.modes,
      `${path}.modes`,
      diagnostics,
      ['empty', 'error', 'forbidden', 'loading', 'notFound', 'unauthorized'],
      ['empty', 'error', 'loading', 'notFound', 'unauthorized'],
      id,
    );
    if (modes)
      for (const modeName of [
        'empty',
        'error',
        'forbidden',
        'loading',
        'notFound',
        'unauthorized',
      ]) {
        if (modeName === 'forbidden' && modes[modeName] === undefined) continue;
        const modePath = `${path}.modes.${modeName}`;
        const mode = modes[modeName];
        if (!isRecord(mode))
          addDiagnostic(diagnostics, 'OXE3101', modePath, 'Expected a view mode.', id);
        else if (mode.kind === 'generated') {
          const item = expectRecord(
            mode,
            modePath,
            diagnostics,
            ['kind', 'skeleton', 'strategy'],
            ['kind'],
            id,
          );
          if (item?.strategy !== undefined)
            expectEnum(
              item.strategy,
              ['preserveStaticStructure'],
              `${modePath}.strategy`,
              diagnostics,
              id,
            );
          if (item?.skeleton !== undefined) {
            const skeleton = expectRecord(
              item.skeleton,
              `${modePath}.skeleton`,
              diagnostics,
              ['elements', 'rows'],
              [],
              id,
            );
            if (
              skeleton?.rows !== undefined &&
              expectNumber(skeleton.rows, `${modePath}.skeleton.rows`, diagnostics, true, id) &&
              (skeleton.rows < 1 || skeleton.rows > 8)
            )
              addDiagnostic(
                diagnostics,
                'OXE3101',
                `${modePath}.skeleton.rows`,
                'Skeleton rows must be between 1 and 8.',
                id,
              );
            if (skeleton?.elements !== undefined)
              validateStringMap(
                skeleton.elements,
                `${modePath}.skeleton.elements`,
                diagnostics,
                (hint, hintPath) => {
                  const record = expectRecord(
                    hint,
                    hintPath,
                    diagnostics,
                    ['shape', 'width'],
                    [],
                    id,
                  );
                  if (record?.shape !== undefined)
                    expectEnum(
                      record.shape,
                      ['block', 'control', 'text'],
                      `${hintPath}.shape`,
                      diagnostics,
                      id,
                    );
                  if (record?.width !== undefined)
                    expectEnum(
                      record.width,
                      ['full', 'medium', 'short'],
                      `${hintPath}.width`,
                      diagnostics,
                      id,
                    );
                },
                id,
              );
          }
        } else if (mode.kind === 'inherited') {
          const item = expectRecord(
            mode,
            modePath,
            diagnostics,
            ['from', 'kind'],
            ['from', 'kind'],
            id,
          );
          if (item) expectString(item.from, `${modePath}.from`, diagnostics, id);
        } else addDiagnostic(diagnostics, 'OXE3101', `${modePath}.kind`, 'Unknown view mode.', id);
      }
    validateViewElementStructure(record.tree, `${path}.tree`, diagnostics, id ?? '<view>');
  });

  const verification = expectRecord(
    root.verification,
    '$.verification',
    diagnostics,
    ['flows', 'invariants'],
    ['flows', 'invariants'],
  );
  if (verification) {
    validateNodeArray(
      verification.invariants,
      '$.verification.invariants',
      diagnostics,
      (node, path) => {
        const record = validateNodeHeader(
          node,
          path,
          diagnostics,
          'invariant',
          ['id', 'kind', 'statement'],
          ['id', 'kind', 'statement'],
        );
        if (record)
          expectString(
            record.statement,
            `${path}.statement`,
            diagnostics,
            record.id as string | undefined,
          );
      },
    );
    validateNodeArray(verification.flows, '$.verification.flows', diagnostics, (node, path) => {
      const record = validateNodeHeader(
        node,
        path,
        diagnostics,
        'verificationFlow',
        ['actor', 'id', 'kind', 'steps'],
        ['actor', 'id', 'kind', 'steps'],
      );
      if (!record) return;
      const id = record.id as string | undefined;
      expectEnum(record.actor, ['authenticatedUser'], `${path}.actor`, diagnostics, id);
      expectArray(record.steps, `${path}.steps`, diagnostics, id)?.forEach((step, index) => {
        const stepPath = `${path}.steps[${index}]`;
        if (!isRecord(step)) {
          addDiagnostic(diagnostics, 'OXE3101', stepPath, 'Expected a verification step.', id);
          return;
        }
        if (step.kind === 'visit') {
          const item = expectRecord(
            step,
            stepPath,
            diagnostics,
            ['kind', 'route'],
            ['kind', 'route'],
            id,
          );
          if (item) expectString(item.route, `${stepPath}.route`, diagnostics, id);
        } else if (step.kind === 'submit') {
          const item = expectRecord(
            step,
            stepPath,
            diagnostics,
            ['element', 'kind', 'values'],
            ['element', 'kind', 'values'],
            id,
          );
          if (item) {
            expectString(item.element, `${stepPath}.element`, diagnostics, id);
            validateStringMap(
              item.values,
              `${stepPath}.values`,
              diagnostics,
              (scalar, scalarPath) => validateScalar(scalar, scalarPath, diagnostics, id),
              id,
            );
          }
        } else if (step.kind === 'expectQueryContains') {
          const item = expectRecord(
            step,
            stepPath,
            diagnostics,
            ['kind', 'query', 'values'],
            ['kind', 'query', 'values'],
            id,
          );
          if (item) {
            expectString(item.query, `${stepPath}.query`, diagnostics, id);
            validateStringMap(
              item.values,
              `${stepPath}.values`,
              diagnostics,
              (scalar, scalarPath) => validateScalar(scalar, scalarPath, diagnostics, id),
              id,
            );
          }
        } else if (step.kind === 'invoke') {
          const item = expectRecord(
            step,
            stepPath,
            diagnostics,
            ['kind', 'operation'],
            ['kind', 'operation'],
            id,
          );
          if (item) expectString(item.operation, `${stepPath}.operation`, diagnostics, id);
        } else if (step.kind === 'expectField') {
          const item = expectRecord(
            step,
            stepPath,
            diagnostics,
            ['field', 'kind', 'value'],
            ['field', 'kind', 'value'],
            id,
          );
          if (item) {
            expectString(item.field, `${stepPath}.field`, diagnostics, id);
            validateScalar(item.value, `${stepPath}.value`, diagnostics, id);
          }
        } else
          addDiagnostic(
            diagnostics,
            'OXE3101',
            `${stepPath}.kind`,
            'Unknown verification step.',
            id,
          );
      });
    });
  }
  return diagnostics;
};

type NodeKind =
  | 'app'
  | 'capability'
  | 'componentExtension'
  | 'context'
  | 'element'
  | 'entity'
  | 'feature'
  | 'field'
  | 'invariant'
  | 'extensionModule'
  | 'operation'
  | 'policy'
  | 'query'
  | 'relation'
  | 'route'
  | 'style'
  | 'unique'
  | 'verificationFlow'
  | 'view';

interface IndexedNode {
  readonly kind: NodeKind;
  readonly path: string;
  readonly value: { readonly id: string };
}

type ExpressionType =
  | ApplicationValueTypeV1
  | { readonly entity: string; readonly kind: 'entityList' }
  | { readonly kind: 'fieldReference'; readonly valueType: ApplicationValueTypeV1 }
  | { readonly kind: 'null' }
  | { readonly kind: 'unknown' };

const valueTypesEqual = (left: ApplicationValueTypeV1, right: ApplicationValueTypeV1): boolean => {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'enum') {
    return (
      right.kind === 'enum' &&
      left.values.length === right.values.length &&
      left.values.every((value, index) => value === right.values[index])
    );
  }
  if (left.kind === 'entity' || left.kind === 'entityId')
    return right.kind === left.kind && left.entity === right.entity;
  if (left.kind === 'record') {
    if (right.kind !== 'record') return false;
    const leftKeys = Object.keys(left.fields).sort(compareText);
    const rightKeys = Object.keys(right.fields).sort(compareText);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          key === rightKeys[index] &&
          right.fields[key] !== undefined &&
          valueTypesEqual(
            left.fields[key] as ApplicationValueTypeV1,
            right.fields[key] as ApplicationValueTypeV1,
          ),
      )
    );
  }
  if (left.kind === 'integer')
    return (
      right.kind === 'integer' && left.minimum === right.minimum && left.maximum === right.maximum
    );
  if (left.kind === 'decimal')
    return (
      right.kind === 'decimal' && left.precision === right.precision && left.scale === right.scale
    );
  if (left.kind === 'list')
    return (
      right.kind === 'list' &&
      left.minimumItems === right.minimumItems &&
      left.maximumItems === right.maximumItems &&
      valueTypesEqual(left.items, right.items)
    );
  if (left.kind === 'optional')
    return right.kind === 'optional' && valueTypesEqual(left.value, right.value);
  if (left.kind === 'result') {
    if (right.kind !== 'result' || !valueTypesEqual(left.value, right.value)) return false;
    const leftKeys = Object.keys(left.outcomes).sort(compareText);
    const rightKeys = Object.keys(right.outcomes).sort(compareText);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          key === rightKeys[index] &&
          right.outcomes[key] !== undefined &&
          valueTypesEqual(left.outcomes[key]!, right.outcomes[key]!),
      )
    );
  }
  return true;
};

const literalMatchesType = (
  value: boolean | null | number | string,
  type: ApplicationValueTypeV1,
): boolean => applicationScalarMatchesType(value, type);

const valueTypeIsAssignable = (
  source: ApplicationValueTypeV1 | { readonly kind: 'null' },
  target: ApplicationValueTypeV1,
): boolean => {
  if (source.kind === 'null') return target.kind === 'optional';
  if (target.kind === 'optional')
    return source.kind === 'optional'
      ? valueTypeIsAssignable(source.value, target.value)
      : valueTypeIsAssignable(source, target.value);
  if (source.kind === 'optional') return false;
  return (
    valueTypesEqual(source, target) ||
    (source.kind === 'enum' && target.kind === 'string') ||
    (source.kind === 'string' && target.kind === 'enum') ||
    (source.kind === 'integer' && target.kind === 'number')
  );
};

const validateGraphSemantics = (
  graph: ApplicationGraphV1,
  referenceSink?: ApplicationGraphReference[],
): ApplicationGraphDiagnostic[] => {
  const diagnostics: ApplicationGraphDiagnostic[] = [];
  const nodes = new Map<string, IndexedNode>();
  const idPattern = /^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$/u;
  const register = (value: { readonly id: string }, kind: NodeKind, path: string): void => {
    if (!idPattern.test(value.id))
      addDiagnostic(
        diagnostics,
        'OXE3105',
        `${path}.id`,
        `Semantic id "${value.id}" is not stable-id syntax.`,
        value.id,
      );
    const previous = nodes.get(value.id);
    if (previous) {
      addDiagnostic(
        diagnostics,
        'OXE3102',
        `${path}.id`,
        `Duplicate semantic id "${value.id}"; first declared at ${previous.path}.`,
        value.id,
      );
    } else nodes.set(value.id, { kind, path, value });
  };
  register(graph.app, 'app', '$.app');
  const groups = [
    ['capabilities', 'capability', graph.capabilities ?? []],
    ['components', 'componentExtension', graph.components ?? []],
    ['contexts', 'context', graph.contexts ?? []],
    ['features', 'feature', graph.features],
    ['entities', 'entity', graph.entities],
    ['fields', 'field', graph.fields],
    ['modules', 'extensionModule', graph.modules ?? []],
    ['relations', 'relation', graph.relations],
    ['policies', 'policy', graph.policies],
    ['queries', 'query', graph.queries],
    ['operations', 'operation', graph.operations],
    ['routes', 'route', graph.routes],
    ['styles', 'style', graph.styles ?? []],
    ['uniques', 'unique', graph.uniques ?? []],
    ['views', 'view', graph.views],
  ] as const;
  for (const [group, kind, values] of groups)
    values.forEach((value, index) => register(value, kind, `$.${group}[${index}]`));
  const registerElements = (element: ApplicationViewElementV1, path: string): void => {
    if (element.id) register({ id: element.id }, 'element', path);
    if (element.kind === 'component')
      element.children?.forEach((child, index) =>
        registerElements(child, `${path}.children[${index}]`),
      );
    else registerElements(element.template, `${path}.template`);
  };
  graph.views.forEach((view, index) => registerElements(view.tree, `$.views[${index}].tree`));
  graph.verification.invariants.forEach((value, index) =>
    register(value, 'invariant', `$.verification.invariants[${index}]`),
  );
  graph.verification.flows.forEach((value, index) =>
    register(value, 'verificationFlow', `$.verification.flows[${index}]`),
  );

  const reference = (
    id: string,
    kind: NodeKind | readonly NodeKind[],
    path: string,
    owner: string,
  ): IndexedNode | undefined => {
    const node = nodes.get(id);
    if (!node) {
      addDiagnostic(
        diagnostics,
        'OXE3103',
        path,
        `Semantic reference "${id}" does not resolve.`,
        owner,
      );
      return undefined;
    }
    referenceSink?.push({ path, sourceId: owner, targetId: id });
    const kinds: readonly NodeKind[] = typeof kind === 'string' ? [kind] : kind;
    if (!kinds.includes(node.kind)) {
      addDiagnostic(
        diagnostics,
        'OXE3104',
        path,
        `Reference "${id}" resolves to ${node.kind}, expected ${kinds.join(' or ')}.`,
        owner,
      );
      return undefined;
    }
    return node;
  };
  const featureReference = (id: string | undefined, path: string, owner: string): void => {
    if (id) reference(id, 'feature', path, owner);
  };
  const entities = new Map(graph.entities.map((entity) => [entity.id, entity]));
  const contexts = new Map((graph.contexts ?? []).map((context) => [context.id, context]));
  const fields = new Map(graph.fields.map((field) => [field.id, field]));
  const relations = new Map(graph.relations.map((relation) => [relation.id, relation]));
  const queries = new Map(graph.queries.map((query) => [query.id, query]));
  const operations = new Map(graph.operations.map((operation) => [operation.id, operation]));
  const capabilities = new Map(
    (graph.capabilities ?? []).map((capability) => [capability.id, capability]),
  );
  const extensionModules = new Map((graph.modules ?? []).map((module) => [module.id, module]));
  reference(graph.app.entryRoute, 'route', '$.app.entryRoute', graph.app.id);
  reference(graph.app.actorEntity, 'entity', '$.app.actorEntity', graph.app.id);
  if (graph.app.authentication) {
    reference(
      graph.app.authentication.authenticatedRoute,
      'route',
      '$.app.authentication.authenticatedRoute',
      graph.app.id,
    );
    const seenMethods = new Set<string>();
    graph.app.authentication.methods.forEach((method, index) => {
      if (seenMethods.has(method))
        addDiagnostic(
          diagnostics,
          'OXE3105',
          `$.app.authentication.methods[${index}]`,
          `Authentication method "${method}" is declared more than once.`,
          graph.app.id,
        );
      seenMethods.add(method);
    });
    if (graph.app.authentication.methods.length === 0)
      addDiagnostic(
        diagnostics,
        'OXE3105',
        '$.app.authentication.methods',
        'At least one authentication method is required.',
        graph.app.id,
      );
    for (const [name, path] of [
      ['signInPath', graph.app.authentication.signInPath],
      ['signUpPath', graph.app.authentication.signUpPath],
    ] as const)
      if (!/^\/[A-Za-z0-9/_-]*$/u.test(path))
        addDiagnostic(
          diagnostics,
          'OXE3105',
          `$.app.authentication.${name}`,
          'Authentication paths must use absolute URL-path syntax.',
          graph.app.id,
        );
    if (graph.app.authentication.signInPath === graph.app.authentication.signUpPath)
      addDiagnostic(
        diagnostics,
        'OXE3105',
        '$.app.authentication.signUpPath',
        'Sign-in and sign-up paths must be distinct.',
        graph.app.id,
      );
  }
  const appContexts = new Set<string>();
  const appContextIndexes = new Map<string, number>();
  graph.app.contexts?.forEach((contextId, index) => {
    reference(contextId, 'context', `$.app.contexts[${index}]`, graph.app.id);
    if (appContexts.has(contextId))
      addDiagnostic(
        diagnostics,
        'OXE3105',
        `$.app.contexts[${index}]`,
        `Context role "${contextId}" is declared more than once.`,
        graph.app.id,
      );
    appContexts.add(contextId);
    if (!appContextIndexes.has(contextId)) appContextIndexes.set(contextId, index);
  });

  const validateTypeReferences = (
    type: ApplicationValueTypeV1,
    path: string,
    owner: string,
  ): void => {
    if (type.kind === 'entity' || type.kind === 'entityId')
      reference(type.entity, 'entity', `${path}.entity`, owner);
    else if (type.kind === 'record')
      for (const [name, fieldType] of Object.entries(type.fields).sort(([left], [right]) =>
        compareText(left, right),
      ))
        validateTypeReferences(fieldType, childPath(`${path}.fields`, name), owner);
    else if (type.kind === 'list') validateTypeReferences(type.items, `${path}.items`, owner);
    else if (type.kind === 'optional') validateTypeReferences(type.value, `${path}.value`, owner);
    else if (type.kind === 'result') {
      validateTypeReferences(type.value, `${path}.value`, owner);
      for (const [name, outcomeType] of Object.entries(type.outcomes).sort(([left], [right]) =>
        compareText(left, right),
      ))
        validateTypeReferences(outcomeType, childPath(`${path}.outcomes`, name), owner);
    }
  };
  (graph.capabilities ?? []).forEach((capability, capabilityIndex) => {
    const path = `$.capabilities[${capabilityIndex}]`;
    if (Object.keys(capability.methods).length === 0)
      addDiagnostic(
        diagnostics,
        'OXE3105',
        `${path}.methods`,
        `Capability "${capability.id}" requires at least one method.`,
        capability.id,
      );
    for (const [method, contract] of Object.entries(capability.methods).sort(([left], [right]) =>
      compareText(left, right),
    )) {
      const methodPath = childPath(`${path}.methods`, method);
      validateTypeReferences(contract.input, `${methodPath}.input`, capability.id);
      validateTypeReferences(contract.output, `${methodPath}.output`, capability.id);
    }
    if (capability.adapter) {
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(capability.adapter.export))
        addDiagnostic(
          diagnostics,
          'OXE3105',
          `${path}.adapter.export`,
          'Extension exports must be JavaScript identifiers.',
          capability.id,
        );
      const moduleNode = reference(
        capability.adapter.module,
        'extensionModule',
        `${path}.adapter.module`,
        capability.id,
      );
      const module = extensionModules.get(capability.adapter.module);
      if (moduleNode && module && (module.format !== 'javascript' || module.target === 'browser'))
        addDiagnostic(
          diagnostics,
          'OXE3106',
          `${path}.adapter.module`,
          `Capability adapter modules must be server or universal JavaScript.`,
          capability.id,
        );
    }
  });
  const extensionSources = new Map<string, string>();
  (graph.modules ?? []).forEach((module, moduleIndex) => {
    const path = `$.modules[${moduleIndex}]`;
    if (!/^sha256:[a-f0-9]{64}$/u.test(module.integrity))
      addDiagnostic(
        diagnostics,
        'OXE3105',
        `${path}.integrity`,
        'Extension integrity must be sha256 followed by 64 lowercase hexadecimal characters.',
        module.id,
      );
    if (
      module.source.startsWith('/') ||
      module.source.split('/').some((segment) => segment === '..' || segment === '')
    )
      addDiagnostic(
        diagnostics,
        'OXE3105',
        `${path}.source`,
        'Extension source must be a normalized project-relative path.',
        module.id,
      );
    const existingSource = extensionSources.get(module.source);
    if (existingSource)
      addDiagnostic(
        diagnostics,
        'OXE3105',
        `${path}.source`,
        `Extension source is already owned by "${existingSource}".`,
        module.id,
      );
    else extensionSources.set(module.source, module.id);
    if (module.format === 'css' && module.target !== 'browser')
      addDiagnostic(
        diagnostics,
        'OXE3106',
        `${path}.target`,
        'CSS extension modules must target the browser.',
        module.id,
      );
    for (const [packageName, version] of Object.entries(module.packages ?? {})) {
      if (!/^(?:@[^/\s]+\/)?[^/\s]+$/u.test(packageName) || packageName.startsWith('.'))
        addDiagnostic(
          diagnostics,
          'OXE3105',
          childPath(`${path}.packages`, packageName),
          `Invalid package name "${packageName}".`,
          module.id,
        );
      if (version.trim() !== version || version.length === 0)
        addDiagnostic(
          diagnostics,
          'OXE3105',
          childPath(`${path}.packages`, packageName),
          'Package versions must be non-empty and have no surrounding whitespace.',
          module.id,
        );
    }
  });
  (graph.components ?? []).forEach((component, componentIndex) => {
    const path = `$.components[${componentIndex}]`;
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(component.implementation.export))
      addDiagnostic(
        diagnostics,
        'OXE3105',
        `${path}.implementation.export`,
        'Extension exports must be JavaScript identifiers.',
        component.id,
      );
    if (component.implementation.jobIdempotency !== undefined)
      addDiagnostic(
        diagnostics,
        'OXE3105',
        `${path}.implementation.jobIdempotency`,
        'Browser component implementations cannot declare job idempotency.',
        component.id,
      );
    const moduleNode = reference(
      component.implementation.module,
      'extensionModule',
      `${path}.implementation.module`,
      component.id,
    );
    const module = extensionModules.get(component.implementation.module);
    if (moduleNode && module && (module.format !== 'javascript' || module.target === 'server'))
      addDiagnostic(
        diagnostics,
        'OXE3106',
        `${path}.implementation.module`,
        'Component implementations must be browser or universal JavaScript.',
        component.id,
      );
    for (const [name, type] of Object.entries(component.props).sort(([left], [right]) =>
      compareText(left, right),
    ))
      validateTypeReferences(type, childPath(`${path}.props`, name), component.id);
    const events = new Set<string>();
    component.events?.forEach((event, eventIndex) => {
      if (events.has(event))
        addDiagnostic(
          diagnostics,
          'OXE3105',
          `${path}.events[${eventIndex}]`,
          `Component event "${event}" is declared more than once.`,
          component.id,
        );
      events.add(event);
    });
    if (!/^[a-z][a-z0-9-]*$/u.test(component.ssr.tag))
      addDiagnostic(
        diagnostics,
        'OXE3105',
        `${path}.ssr.tag`,
        'Component SSR fallback must be a lowercase HTML tag.',
        component.id,
      );
  });
  (graph.styles ?? []).forEach((style, styleIndex) => {
    const path = `$.styles[${styleIndex}]`;
    const tokenPattern = /^[a-z][a-z0-9-]*$/u;
    const validateCssValue = (value: string, valuePath: string): void => {
      if (/[;{}]/u.test(value) || value.trim() !== value)
        addDiagnostic(
          diagnostics,
          'OXE3105',
          valuePath,
          'Style token values cannot contain rule delimiters or surrounding whitespace.',
          style.id,
        );
    };
    for (const [token, value] of Object.entries(style.tokens)) {
      if (!tokenPattern.test(token))
        addDiagnostic(
          diagnostics,
          'OXE3105',
          childPath(`${path}.tokens`, token),
          'Style token names must use lowercase CSS custom-property syntax.',
          style.id,
        );
      validateCssValue(value, childPath(`${path}.tokens`, token));
    }
    for (const [theme, tokens] of Object.entries(style.themes ?? {})) {
      if (!tokenPattern.test(theme))
        addDiagnostic(
          diagnostics,
          'OXE3105',
          childPath(`${path}.themes`, theme),
          'Theme names must use lowercase kebab-case syntax.',
          style.id,
        );
      for (const token of Object.keys(tokens))
        if (!(token in style.tokens))
          addDiagnostic(
            diagnostics,
            'OXE3105',
            childPath(childPath(`${path}.themes`, theme), token),
            `Theme overrides unknown token "${token}".`,
            style.id,
          );
        else
          validateCssValue(
            tokens[token] ?? '',
            childPath(childPath(`${path}.themes`, theme), token),
          );
    }
    const stylesheets = new Set<string>();
    style.stylesheets?.forEach((moduleId, moduleIndex) => {
      const modulePath = `${path}.stylesheets[${moduleIndex}]`;
      const moduleNode = reference(moduleId, 'extensionModule', modulePath, style.id);
      const module = extensionModules.get(moduleId);
      if (stylesheets.has(moduleId))
        addDiagnostic(
          diagnostics,
          'OXE3105',
          modulePath,
          `Stylesheet module "${moduleId}" is declared more than once.`,
          style.id,
        );
      stylesheets.add(moduleId);
      if (moduleNode && module?.format !== 'css')
        addDiagnostic(
          diagnostics,
          'OXE3106',
          modulePath,
          `Style sheets must reference CSS extension modules.`,
          style.id,
        );
    });
  });
  graph.entities.forEach((entity, entityIndex) => {
    const path = `$.entities[${entityIndex}]`;
    featureReference(entity.feature, `${path}.feature`, entity.id);
    const declared = new Set<string>();
    entity.fields?.forEach((fieldId, fieldIndex) => {
      const fieldNode = reference(fieldId, 'field', `${path}.fields[${fieldIndex}]`, entity.id);
      if (declared.has(fieldId))
        addDiagnostic(
          diagnostics,
          'OXE3105',
          `${path}.fields[${fieldIndex}]`,
          `Entity "${entity.id}" lists field "${fieldId}" more than once.`,
          entity.id,
        );
      declared.add(fieldId);
      const field = fields.get(fieldId);
      if (fieldNode && field?.entity !== entity.id)
        addDiagnostic(
          diagnostics,
          'OXE3105',
          `${path}.fields[${fieldIndex}]`,
          `Field "${fieldId}" belongs to "${field?.entity}", not "${entity.id}".`,
          entity.id,
        );
    });
  });
  graph.fields.forEach((field, fieldIndex) => {
    const path = `$.fields[${fieldIndex}]`;
    reference(field.entity, 'entity', `${path}.entity`, field.id);
    validateTypeReferences(field.valueType, `${path}.valueType`, field.id);
    if (field.valueType.kind === 'enum') {
      const seenValues = new Set<string>();
      field.valueType.values.forEach((value, valueIndex) => {
        if (seenValues.has(value))
          addDiagnostic(
            diagnostics,
            'OXE3105',
            `${path}.valueType.values[${valueIndex}]`,
            `Enum value "${value}" is declared more than once.`,
            field.id,
          );
        seenValues.add(value);
      });
      if (field.valueType.values.length === 0)
        addDiagnostic(
          diagnostics,
          'OXE3105',
          `${path}.valueType.values`,
          'An enum field requires at least one value.',
          field.id,
        );
    }
    const entity = entities.get(field.entity);
    if (entity && !entity.fields?.includes(field.id))
      addDiagnostic(
        diagnostics,
        'OXE3105',
        `${path}.entity`,
        `Field "${field.id}" is not listed by entity "${field.entity}".`,
        field.id,
      );
    if (field.default && !literalMatchesType(field.default.value, field.valueType))
      addDiagnostic(
        diagnostics,
        'OXE3105',
        `${path}.default`,
        `Default value is incompatible with field "${field.id}".`,
        field.id,
      );
    for (const [constraintIndex, constraint] of (field.validation ?? []).entries()) {
      if (field.valueType.kind !== 'string')
        addDiagnostic(
          diagnostics,
          'OXE3105',
          `${path}.validation[${constraintIndex}]`,
          'String-length validation requires a string field.',
          field.id,
        );
      if (constraint.min !== undefined && constraint.min < 0)
        addDiagnostic(
          diagnostics,
          'OXE3105',
          `${path}.validation[${constraintIndex}].min`,
          'String-length minimum must be nonnegative.',
          field.id,
        );
      if (
        constraint.max !== undefined &&
        constraint.min !== undefined &&
        constraint.max < constraint.min
      )
        addDiagnostic(
          diagnostics,
          'OXE3105',
          `${path}.validation[${constraintIndex}].max`,
          'String-length maximum must not be less than its minimum.',
          field.id,
        );
    }
  });
  const relationStorageEntity = (relation: ApplicationRelationV1): string => {
    if (relation.from.cardinality === 'one' && relation.to.cardinality === 'many')
      return relation.from.entity;
    if (relation.to.cardinality === 'one' && relation.from.cardinality === 'many')
      return relation.to.entity;
    if (relation.from.createValue) return relation.from.entity;
    if (relation.to.createValue) return relation.to.entity;
    return relation.from.entity;
  };
  (graph.uniques ?? []).forEach((unique, uniqueIndex) => {
    const path = `$.uniques[${uniqueIndex}]`;
    const entityNode = reference(unique.entity, 'entity', `${path}.entity`, unique.id);
    if (entities.get(unique.entity)?.origin === 'builtin')
      addDiagnostic(
        diagnostics,
        'OXE3105',
        `${path}.entity`,
        `Unique constraint "${unique.id}" requires a stored application entity.`,
        unique.id,
      );
    if (unique.keys.length === 0)
      addDiagnostic(
        diagnostics,
        'OXE3105',
        `${path}.keys`,
        'A unique constraint requires at least one key.',
        unique.id,
      );
    const seen = new Set<string>();
    unique.keys.forEach((key, keyIndex) => {
      const keyPath = `${path}.keys[${keyIndex}]`;
      const keyNode = reference(key, ['field', 'relation'], keyPath, unique.id);
      if (seen.has(key))
        addDiagnostic(
          diagnostics,
          'OXE3105',
          keyPath,
          `Unique constraint key "${key}" is declared more than once.`,
          unique.id,
        );
      seen.add(key);
      if (!entityNode || !keyNode) return;
      const relation = keyNode.kind === 'relation' ? relations.get(key) : undefined;
      const owner =
        keyNode.kind === 'field'
          ? fields.get(key)?.entity
          : relation
            ? relationStorageEntity(relation)
            : undefined;
      if (owner !== unique.entity)
        addDiagnostic(
          diagnostics,
          'OXE3105',
          keyPath,
          `Unique constraint key "${key}" is stored on "${owner}", not "${unique.entity}".`,
          unique.id,
        );
    });
  });

  const relationConnects = (
    relation: ApplicationRelationV1,
    entity: string,
    other: string,
  ): boolean =>
    (relation.from.entity === entity && relation.to.entity === other) ||
    (relation.to.entity === entity && relation.from.entity === other);
  const validateContextRelation = (
    relationId: string,
    entity: string,
    other: string,
    path: string,
    owner: string,
  ): void => {
    reference(relationId, 'relation', path, owner);
    const relation = relations.get(relationId);
    if (relation && !relationConnects(relation, entity, other))
      addDiagnostic(
        diagnostics,
        'OXE3105',
        path,
        `Relation "${relation.id}" must connect "${entity}" to "${other}".`,
        owner,
      );
  };
  (graph.contexts ?? []).forEach((context, contextIndex) => {
    const path = `$.contexts[${contextIndex}]`;
    reference(context.entity, 'entity', `${path}.entity`, context.id);
    if (context.labelField) {
      reference(context.labelField, 'field', `${path}.labelField`, context.id);
      const labelField = fields.get(context.labelField);
      if (labelField && labelField.entity !== context.entity)
        addDiagnostic(
          diagnostics,
          'OXE3104',
          `${path}.labelField`,
          `Context label field "${context.labelField}" does not belong to "${context.entity}".`,
          context.id,
        );
      if (labelField && labelField.valueType.kind !== 'string')
        addDiagnostic(
          diagnostics,
          'OXE3106',
          `${path}.labelField`,
          `Context label field "${context.labelField}" must be a string.`,
          context.id,
        );
    }
    if (!appContexts.has(context.id))
      addDiagnostic(
        diagnostics,
        'OXE3105',
        `${path}.id`,
        `Context role "${context.id}" is not listed by app.contexts.`,
        context.id,
      );
    const validateAuthorizationMethod = (
      authorization: ApplicationContextAuthorizationMethodV1,
      authorizationPath: string,
    ): void => {
      if (authorization.kind === 'relationEqualsActor') {
        validateContextRelation(
          authorization.relation,
          context.entity,
          graph.app.actorEntity,
          `${authorizationPath}.relation`,
          context.id,
        );
        return;
      }
      reference(
        authorization.membershipEntity,
        'entity',
        `${authorizationPath}.membershipEntity`,
        context.id,
      );
      validateContextRelation(
        authorization.memberRelation,
        authorization.membershipEntity,
        graph.app.actorEntity,
        `${authorizationPath}.memberRelation`,
        context.id,
      );
      validateContextRelation(
        authorization.resourceRelation,
        authorization.membershipEntity,
        context.entity,
        `${authorizationPath}.resourceRelation`,
        context.id,
      );
      const seenConditions = new Set<string>();
      authorization.conditions?.forEach((condition, conditionIndex) => {
        const conditionPath = `${authorizationPath}.conditions[${conditionIndex}]`;
        reference(condition.field, 'field', `${conditionPath}.field`, context.id);
        if (seenConditions.has(condition.field))
          addDiagnostic(
            diagnostics,
            'OXE3105',
            `${conditionPath}.field`,
            `Membership condition field "${condition.field}" is declared more than once.`,
            context.id,
          );
        seenConditions.add(condition.field);
        const field = fields.get(condition.field);
        if (field && field.entity !== authorization.membershipEntity)
          addDiagnostic(
            diagnostics,
            'OXE3104',
            `${conditionPath}.field`,
            `Membership condition field "${condition.field}" does not belong to "${authorization.membershipEntity}".`,
            context.id,
          );
        if (field && !literalMatchesType(condition.equals, field.valueType))
          addDiagnostic(
            diagnostics,
            'OXE3106',
            `${conditionPath}.equals`,
            `Membership condition value is incompatible with field "${condition.field}".`,
            context.id,
          );
      });
    };
    if (context.authorization.kind === 'anyOf') {
      if (context.authorization.anyOf.length === 0)
        addDiagnostic(
          diagnostics,
          'OXE3105',
          `${path}.authorization.anyOf`,
          'Context authorization requires at least one method.',
          context.id,
        );
      context.authorization.anyOf.forEach((authorization, index) =>
        validateAuthorizationMethod(authorization, `${path}.authorization.anyOf[${index}]`),
      );
    } else validateAuthorizationMethod(context.authorization, `${path}.authorization`);
    const parents = new Set<string>();
    context.parents?.forEach((parent, parentIndex) => {
      const parentPath = `${path}.parents[${parentIndex}]`;
      reference(parent.context, 'context', `${parentPath}.context`, context.id);
      if (parents.has(parent.context))
        addDiagnostic(
          diagnostics,
          'OXE3105',
          `${parentPath}.context`,
          `Parent context role "${parent.context}" is declared more than once.`,
          context.id,
        );
      parents.add(parent.context);
      const parentContext = contexts.get(parent.context);
      if (parentContext) {
        validateContextRelation(
          parent.relation,
          context.entity,
          parentContext.entity,
          `${parentPath}.relation`,
          context.id,
        );
        const contextOrder = appContextIndexes.get(context.id);
        const parentOrder = appContextIndexes.get(parent.context);
        if (contextOrder !== undefined && parentOrder !== undefined && parentOrder >= contextOrder)
          addDiagnostic(
            diagnostics,
            'OXE3105',
            `${parentPath}.context`,
            `Parent context role "${parent.context}" must be listed before "${context.id}" in app.contexts.`,
            context.id,
          );
      }
    });
  });
  const visitContext = (context: ApplicationContextV1, ancestors: readonly string[]): void => {
    if (ancestors.includes(context.id)) {
      addDiagnostic(
        diagnostics,
        'OXE3106',
        `${nodes.get(context.id)?.path ?? '$.contexts'}.parents`,
        `Context hierarchy contains a cycle through "${context.id}".`,
        context.id,
      );
      return;
    }
    context.parents?.forEach((parent) => {
      const target = contexts.get(parent.context);
      if (target) visitContext(target, [...ancestors, context.id]);
    });
  };
  (graph.contexts ?? []).forEach((context) => visitContext(context, []));
  const validateScopedRelation = (
    predicate: ApplicationPolicyPredicateV1,
    targetEntity: string,
    path: string,
    owner: string,
  ): void => {
    if (predicate.kind === 'authenticated') return;
    reference(predicate.relation, 'relation', `${path}.relation`, owner);
    const relation = relations.get(predicate.relation);
    const context =
      predicate.kind === 'relationEqualsContext' ? contexts.get(predicate.context) : undefined;
    const expectedEntity =
      predicate.kind === 'relationEqualsActor' ? graph.app.actorEntity : context?.entity;
    if (predicate.kind === 'relationEqualsContext') {
      reference(predicate.context, 'context', `${path}.context`, owner);
      if (!appContexts.has(predicate.context))
        addDiagnostic(
          diagnostics,
          'OXE3105',
          `${path}.context`,
          `Context role "${predicate.context}" is not declared in app.contexts.`,
          owner,
        );
    }
    if (relation && expectedEntity && !relationConnects(relation, targetEntity, expectedEntity))
      addDiagnostic(
        diagnostics,
        'OXE3105',
        `${path}.relation`,
        `Relation "${relation.id}" must connect "${targetEntity}" to ${predicate.kind === 'relationEqualsActor' ? 'actor' : 'context'} entity "${expectedEntity}".`,
        owner,
      );
  };
  graph.relations.forEach((relation, relationIndex) => {
    const path = `$.relations[${relationIndex}]`;
    featureReference(relation.feature, `${path}.feature`, relation.id);
    reference(relation.from.entity, 'entity', `${path}.from.entity`, relation.id);
    reference(relation.to.entity, 'entity', `${path}.to.entity`, relation.id);
    for (const side of ['from', 'to'] as const) {
      const endpoint = relation[side];
      const other = relation[side === 'from' ? 'to' : 'from'];
      if (endpoint.cardinality === 'many' && endpoint.required)
        addDiagnostic(
          diagnostics,
          'OXE3105',
          `${path}.${side}.required`,
          'A many-valued relation endpoint cannot be required.',
          relation.id,
        );
      const createContext =
        endpoint.createValue?.kind === 'activeContext'
          ? contexts.get(endpoint.createValue.context)
          : undefined;
      const createEntity =
        endpoint.createValue?.kind === 'actor' ? graph.app.actorEntity : createContext?.entity;
      if (endpoint.createValue?.kind === 'activeContext') {
        reference(
          endpoint.createValue.context,
          'context',
          `${path}.${side}.createValue.context`,
          relation.id,
        );
        if (!appContexts.has(endpoint.createValue.context))
          addDiagnostic(
            diagnostics,
            'OXE3105',
            `${path}.${side}.createValue.context`,
            `Context role "${endpoint.createValue.context}" is not declared in app.contexts.`,
            relation.id,
          );
      }
      if (endpoint.createValue && (endpoint.cardinality !== 'one' || other.entity !== createEntity))
        addDiagnostic(
          diagnostics,
          'OXE3105',
          `${path}.${side}.createValue`,
          endpoint.createValue.kind === 'actor'
            ? `Actor defaults require a one-valued endpoint opposite actor entity "${createEntity}".`
            : `Active-context defaults require a one-valued endpoint opposite context entity "${createEntity}".`,
          relation.id,
        );
    }
    if (relation.from.entity === relation.to.entity && relation.from.name === relation.to.name)
      addDiagnostic(
        diagnostics,
        'OXE3105',
        `${path}.to.name`,
        'Self-relation endpoint names must be distinct.',
        relation.id,
      );
  });
  graph.policies.forEach((policy, policyIndex) => {
    const path = `$.policies[${policyIndex}]`;
    reference(policy.target, 'entity', `${path}.target`, policy.id);
    for (const ruleName of ['create', 'delete', 'read', 'update'] as const)
      validateScopedRelation(
        policy.rules[ruleName],
        policy.target,
        `${path}.rules.${ruleName}`,
        policy.id,
      );
  });
  const validateEntityField = (
    fieldId: string,
    entityId: string,
    path: string,
    owner: string,
  ): void => {
    reference(fieldId, 'field', path, owner);
    const field = fields.get(fieldId);
    if (field && field.entity !== entityId)
      addDiagnostic(
        diagnostics,
        'OXE3104',
        path,
        `Field "${fieldId}" belongs to "${field.entity}", not "${entityId}".`,
        owner,
      );
  };
  graph.queries.forEach((query, queryIndex) => {
    const path = `$.queries[${queryIndex}]`;
    featureReference(query.feature, `${path}.feature`, query.id);
    reference(query.entity, 'entity', `${path}.entity`, query.id);
    if (query.filter)
      validateScopedRelation(query.filter, query.entity, `${path}.filter`, query.id);
    query.select.forEach((field, index) =>
      validateEntityField(field, query.entity, `${path}.select[${index}]`, query.id),
    );
    query.order?.forEach((order, index) =>
      validateEntityField(order.field, query.entity, `${path}.order[${index}].field`, query.id),
    );
    const whereFields = new Set<string>();
    query.where?.forEach((condition, index) => {
      const conditionPath = `${path}.where[${index}]`;
      validateEntityField(condition.field, query.entity, `${conditionPath}.field`, query.id);
      if (whereFields.has(condition.field))
        addDiagnostic(
          diagnostics,
          'OXE3105',
          `${conditionPath}.field`,
          `Query condition field "${condition.field}" is declared more than once.`,
          query.id,
        );
      whereFields.add(condition.field);
      const field = fields.get(condition.field);
      if (field && !literalMatchesType(condition.equals, field.valueType))
        addDiagnostic(
          diagnostics,
          'OXE3106',
          `${conditionPath}.equals`,
          `Query condition value is incompatible with field "${condition.field}".`,
          query.id,
        );
    });
  });

  const inferExpression = (
    expression: ApplicationValueExpressionV1,
    path: string,
    owner: string,
    locals: ReadonlyMap<string, ExpressionType>,
    viewData: ReadonlyMap<string, ExpressionType>,
    input: Readonly<Record<string, ApplicationValueTypeV1>> = {},
  ): ExpressionType => {
    switch (expression.kind) {
      case 'activeContext':
        reference(expression.context, 'context', `${path}.context`, owner);
        if (!appContexts.has(expression.context))
          addDiagnostic(
            diagnostics,
            'OXE3105',
            `${path}.context`,
            `Context role "${expression.context}" is not declared in app.contexts.`,
            owner,
          );
        return {
          kind: 'entity',
          entity: contexts.get(expression.context)?.entity ?? 'unknown.context',
        };
      case 'actor':
        return { kind: 'entity', entity: graph.app.actorEntity };
      case 'formValue':
        return expression.valueType === 'number' ? { kind: 'number' } : { kind: 'string' };
      case 'inputField': {
        const type = input[expression.name];
        if (!type)
          addDiagnostic(
            diagnostics,
            'OXE3104',
            `${path}.name`,
            `Input field "${expression.name}" is not declared.`,
            owner,
          );
        return type ?? { kind: 'unknown' };
      }
      case 'literal':
        return expression.value === null
          ? { kind: 'null' }
          : typeof expression.value === 'boolean'
            ? { kind: 'boolean' }
            : typeof expression.value === 'string'
              ? { kind: 'string' }
              : { kind: 'number' };
      case 'local': {
        const type = locals.get(expression.name);
        if (!type)
          addDiagnostic(
            diagnostics,
            'OXE3104',
            `${path}.name`,
            `Local "${expression.name}" is not in scope.`,
            owner,
          );
        return type ?? { kind: 'unknown' };
      }
      case 'viewData': {
        const type = viewData.get(expression.name);
        if (!type)
          addDiagnostic(
            diagnostics,
            'OXE3104',
            `${path}.name`,
            `View data "${expression.name}" is not declared.`,
            owner,
          );
        return type ?? { kind: 'unknown' };
      }
      case 'not': {
        const type = inferExpression(
          expression.value,
          `${path}.value`,
          owner,
          locals,
          viewData,
          input,
        );
        if (type.kind !== 'boolean' && type.kind !== 'unknown')
          addDiagnostic(
            diagnostics,
            'OXE3106',
            path,
            'Boolean negation requires a boolean value.',
            owner,
          );
        return { kind: 'boolean' };
      }
      case 'semanticReference': {
        reference(expression.target, 'field', `${path}.target`, owner);
        const field = fields.get(expression.target);
        return field ? { kind: 'fieldReference', valueType: field.valueType } : { kind: 'unknown' };
      }
      case 'recordField': {
        const recordType = inferExpression(
          expression.record,
          `${path}.record`,
          owner,
          locals,
          viewData,
          input,
        );
        reference(expression.field, 'field', `${path}.field`, owner);
        const field = fields.get(expression.field);
        if (field && (recordType.kind !== 'entity' || field.entity !== recordType.entity))
          addDiagnostic(
            diagnostics,
            'OXE3104',
            `${path}.field`,
            `Field "${expression.field}" is incompatible with the referenced record.`,
            owner,
          );
        return field?.valueType ?? { kind: 'unknown' };
      }
    }
  };

  graph.operations.forEach((operation, operationIndex) => {
    const path = `$.operations[${operationIndex}]`;
    featureReference(operation.feature, `${path}.feature`, operation.id);
    validateTypeReferences(operation.input, `${path}.input`, operation.id);
    validateTypeReferences(operation.output, `${path}.output`, operation.id);
    const inputFields = operation.input.fields;
    const empty = new Map<string, ExpressionType>();
    operation.effects.forEach((effect, index) =>
      reference(
        effect.target,
        effect.kind === 'externalCall' || effect.kind === 'jobEnqueue'
          ? 'capability'
          : ['entity', 'field'],
        `${path}.effects[${index}].target`,
        operation.id,
      ),
    );
    if (operation.body.kind === 'createEntity') {
      const createdEntity = operation.body.entity;
      reference(operation.body.entity, 'entity', `${path}.body.entity`, operation.id);
      for (const [target, expression] of Object.entries(operation.body.values).sort(
        ([left], [right]) => compareText(left, right),
      )) {
        const targetPath = childPath(`${path}.body.values`, target);
        const node = reference(target, ['field', 'relation'], targetPath, operation.id);
        const expressionType = inferExpression(
          expression,
          targetPath,
          operation.id,
          empty,
          empty,
          inputFields,
        );
        if (node?.kind === 'field') {
          const field = fields.get(target);
          if (field?.entity !== operation.body.entity)
            addDiagnostic(
              diagnostics,
              'OXE3104',
              targetPath,
              `Create value field "${target}" does not belong to "${operation.body.entity}".`,
              operation.id,
            );
          if (
            field &&
            expressionType.kind !== 'unknown' &&
            !('valueType' in expressionType) &&
            expressionType.kind !== 'entityList' &&
            !valueTypeIsAssignable(expressionType, field.valueType)
          )
            addDiagnostic(
              diagnostics,
              'OXE3106',
              targetPath,
              `Create value for "${target}" has an incompatible type.`,
              operation.id,
            );
        } else if (node?.kind === 'relation') {
          const relation = relations.get(target);
          if (
            relation &&
            operation.body.entity !== relation.from.entity &&
            operation.body.entity !== relation.to.entity
          )
            addDiagnostic(
              diagnostics,
              'OXE3104',
              targetPath,
              `Relation "${target}" does not include "${operation.body.entity}".`,
              operation.id,
            );
        }
      }
      for (const field of graph.fields.filter(
        (candidate) =>
          candidate.entity === createdEntity &&
          candidate.required &&
          candidate.default === undefined &&
          candidate.origin !== 'generated',
      )) {
        if (!(field.id in operation.body.values))
          addDiagnostic(
            diagnostics,
            'OXE3105',
            `${path}.body.values`,
            `Create operation "${operation.id}" does not provide required field "${field.id}".`,
            operation.id,
          );
      }
    } else if (operation.body.kind === 'updateEntity') {
      const recordType = inferExpression(
        operation.body.record,
        `${path}.body.record`,
        operation.id,
        empty,
        empty,
        inputFields,
      );
      const entityId = recordType.kind === 'entity' ? recordType.entity : undefined;
      if (!entityId && recordType.kind !== 'unknown')
        addDiagnostic(
          diagnostics,
          'OXE3106',
          `${path}.body.record`,
          'Update target must be an entity record.',
          operation.id,
        );
      for (const [target, expression] of Object.entries(operation.body.values).sort(
        ([left], [right]) => compareText(left, right),
      )) {
        const targetPath = childPath(`${path}.body.values`, target);
        reference(target, 'field', targetPath, operation.id);
        const field = fields.get(target);
        if (field && entityId && field.entity !== entityId)
          addDiagnostic(
            diagnostics,
            'OXE3104',
            targetPath,
            `Update field "${target}" does not belong to "${entityId}".`,
            operation.id,
          );
        const expressionType = inferExpression(
          expression,
          targetPath,
          operation.id,
          empty,
          empty,
          inputFields,
        );
        if (
          field &&
          expressionType.kind !== 'unknown' &&
          !('valueType' in expressionType) &&
          expressionType.kind !== 'entityList' &&
          !valueTypeIsAssignable(expressionType, field.valueType)
        )
          addDiagnostic(
            diagnostics,
            'OXE3106',
            targetPath,
            `Update value for "${target}" has an incompatible type.`,
            operation.id,
          );
      }
    } else if (operation.body.kind === 'invokeCapability') {
      const capabilityId = operation.body.capability;
      reference(capabilityId, 'capability', `${path}.body.capability`, operation.id);
      const capability = capabilities.get(capabilityId);
      const method = capability?.methods[operation.body.method];
      if (capability && !method)
        addDiagnostic(
          diagnostics,
          'OXE3104',
          `${path}.body.method`,
          `Capability "${capability.id}" has no method "${operation.body.method}".`,
          operation.id,
        );
      if (method) {
        for (const [name, expression] of Object.entries(operation.body.arguments).sort(
          ([left], [right]) => compareText(left, right),
        )) {
          const argumentPath = childPath(`${path}.body.arguments`, name);
          const type = inferExpression(
            expression,
            argumentPath,
            operation.id,
            empty,
            empty,
            inputFields,
          );
          const expected = method.input.fields[name];
          if (!expected)
            addDiagnostic(
              diagnostics,
              'OXE3104',
              argumentPath,
              `Capability method "${operation.body.method}" has no input named "${name}".`,
              operation.id,
            );
          else if (
            type.kind !== 'unknown' &&
            !('valueType' in type) &&
            type.kind !== 'entityList' &&
            !valueTypeIsAssignable(type, expected)
          )
            addDiagnostic(
              diagnostics,
              'OXE3106',
              argumentPath,
              `Capability argument "${name}" has an incompatible type.`,
              operation.id,
            );
        }
        for (const name of Object.keys(method.input.fields).sort(compareText))
          if (!(name in operation.body.arguments))
            addDiagnostic(
              diagnostics,
              'OXE3105',
              childPath(`${path}.body.arguments`, name),
              `Missing capability argument "${name}".`,
              operation.id,
            );
        if (!valueTypesEqual(method.output, operation.output))
          addDiagnostic(
            diagnostics,
            'OXE3106',
            `${path}.output`,
            `Operation output must match capability method "${operation.body.method}".`,
            operation.id,
          );
      }
      if (
        !operation.effects.some(
          (effect) => effect.kind === 'externalCall' && effect.target === capabilityId,
        )
      )
        addDiagnostic(
          diagnostics,
          'OXE3105',
          `${path}.effects`,
          `Capability invocation must declare an externalCall effect for "${capabilityId}".`,
          operation.id,
        );
    } else if (operation.body.kind === 'workflow') {
      const locals = new Map<string, ExpressionType>();
      if (operation.body.steps.length === 0)
        addDiagnostic(
          diagnostics,
          'OXE3105',
          `${path}.body.steps`,
          'A workflow requires at least one step.',
          operation.id,
        );
      operation.body.steps.forEach((step, stepIndex) => {
        const stepPath = `${path}.body.steps[${stepIndex}]`;
        if (locals.has(step.as))
          addDiagnostic(
            diagnostics,
            'OXE3105',
            `${stepPath}.as`,
            `Workflow local "${step.as}" is declared more than once.`,
            operation.id,
          );
        if (step.kind !== 'enqueueCapability')
          reference(step.entity, 'entity', `${stepPath}.entity`, operation.id);
        if (step.kind === 'enqueueCapability') {
          reference(step.capability, 'capability', `${stepPath}.capability`, operation.id);
          const capability = capabilities.get(step.capability);
          const method = capability?.methods[step.method];
          if (capability && !method)
            addDiagnostic(
              diagnostics,
              'OXE3104',
              `${stepPath}.method`,
              `Capability "${capability.id}" has no method "${step.method}".`,
              operation.id,
            );
          if (method) {
            for (const [name, expression] of Object.entries(step.arguments).sort(
              ([left], [right]) => compareText(left, right),
            )) {
              const argumentPath = childPath(`${stepPath}.arguments`, name);
              const type = inferExpression(
                expression,
                argumentPath,
                operation.id,
                locals,
                empty,
                inputFields,
              );
              const expected = method.input.fields[name];
              if (!expected)
                addDiagnostic(
                  diagnostics,
                  'OXE3104',
                  argumentPath,
                  `Capability method "${step.method}" has no input named "${name}".`,
                  operation.id,
                );
              else if (
                type.kind !== 'unknown' &&
                !('valueType' in type) &&
                type.kind !== 'entityList' &&
                !valueTypeIsAssignable(type, expected)
              )
                addDiagnostic(
                  diagnostics,
                  'OXE3106',
                  argumentPath,
                  `Capability argument "${name}" has an incompatible type.`,
                  operation.id,
                );
            }
            for (const name of Object.keys(method.input.fields).sort(compareText))
              if (!(name in step.arguments))
                addDiagnostic(
                  diagnostics,
                  'OXE3105',
                  childPath(`${stepPath}.arguments`, name),
                  `Missing capability argument "${name}".`,
                  operation.id,
                );
          }
          if (
            !operation.effects.some(
              (effect) => effect.kind === 'jobEnqueue' && effect.target === step.capability,
            )
          )
            addDiagnostic(
              diagnostics,
              'OXE3105',
              `${path}.effects`,
              `Queued capability delivery must declare a jobEnqueue effect for "${step.capability}".`,
              operation.id,
            );
        } else if (step.kind === 'createEntity') {
          for (const [target, expression] of Object.entries(step.values).sort(([left], [right]) =>
            compareText(left, right),
          )) {
            const targetPath = childPath(`${stepPath}.values`, target);
            const node = reference(target, ['field', 'relation'], targetPath, operation.id);
            const expressionType = inferExpression(
              expression,
              targetPath,
              operation.id,
              locals,
              empty,
              inputFields,
            );
            if (node?.kind === 'field') {
              const field = fields.get(target);
              if (field?.entity !== step.entity)
                addDiagnostic(
                  diagnostics,
                  'OXE3104',
                  targetPath,
                  `Create value field "${target}" does not belong to "${step.entity}".`,
                  operation.id,
                );
              if (
                field &&
                expressionType.kind !== 'unknown' &&
                !('valueType' in expressionType) &&
                expressionType.kind !== 'entityList' &&
                !valueTypeIsAssignable(expressionType, field.valueType)
              )
                addDiagnostic(
                  diagnostics,
                  'OXE3106',
                  targetPath,
                  `Create value for "${target}" has an incompatible type.`,
                  operation.id,
                );
            } else if (node?.kind === 'relation') {
              const relation = relations.get(target);
              if (
                relation &&
                step.entity !== relation.from.entity &&
                step.entity !== relation.to.entity
              )
                addDiagnostic(
                  diagnostics,
                  'OXE3104',
                  targetPath,
                  `Relation "${target}" does not include "${step.entity}".`,
                  operation.id,
                );
            }
          }
          for (const field of graph.fields.filter(
            (candidate) =>
              candidate.entity === step.entity &&
              candidate.required &&
              candidate.default === undefined &&
              candidate.origin !== 'generated',
          ))
            if (!(field.id in step.values))
              addDiagnostic(
                diagnostics,
                'OXE3105',
                `${stepPath}.values`,
                `Workflow step "${step.as}" does not provide required field "${field.id}".`,
                operation.id,
              );
        } else {
          const recordType = inferExpression(
            step.record,
            `${stepPath}.record`,
            operation.id,
            locals,
            empty,
            inputFields,
          );
          if (
            recordType.kind !== 'unknown' &&
            (recordType.kind !== 'entity' || recordType.entity !== step.entity)
          )
            addDiagnostic(
              diagnostics,
              'OXE3106',
              `${stepPath}.record`,
              `Workflow ${step.kind === 'updateEntity' ? 'update' : 'delete'} target must be an entity record for "${step.entity}".`,
              operation.id,
            );
          if (step.kind === 'updateEntity')
            for (const [target, expression] of Object.entries(step.values).sort(([left], [right]) =>
              compareText(left, right),
            )) {
              const targetPath = childPath(`${stepPath}.values`, target);
              reference(target, 'field', targetPath, operation.id);
              const field = fields.get(target);
              if (field && field.entity !== step.entity)
                addDiagnostic(
                  diagnostics,
                  'OXE3104',
                  targetPath,
                  `Update field "${target}" does not belong to "${step.entity}".`,
                  operation.id,
                );
              const expressionType = inferExpression(
                expression,
                targetPath,
                operation.id,
                locals,
                empty,
                inputFields,
              );
              if (
                field &&
                expressionType.kind !== 'unknown' &&
                !('valueType' in expressionType) &&
                expressionType.kind !== 'entityList' &&
                !valueTypeIsAssignable(expressionType, field.valueType)
              )
                addDiagnostic(
                  diagnostics,
                  'OXE3106',
                  targetPath,
                  `Update value for "${target}" has an incompatible type.`,
                  operation.id,
                );
            }
        }
        locals.set(
          step.as,
          step.kind === 'enqueueCapability'
            ? { fields: { jobId: { kind: 'string' } }, kind: 'record' }
            : { entity: step.entity, kind: 'entity' },
        );
      });
      const resultType = inferExpression(
        operation.body.result,
        `${path}.body.result`,
        operation.id,
        locals,
        empty,
        inputFields,
      );
      if (
        resultType.kind !== 'unknown' &&
        (resultType.kind === 'entityList' ||
          'valueType' in resultType ||
          !valueTypeIsAssignable(resultType, operation.output))
      )
        addDiagnostic(
          diagnostics,
          'OXE3106',
          `${path}.body.result`,
          'Workflow result is incompatible with the operation output.',
          operation.id,
        );
      if (operation.output.kind !== 'entity')
        addDiagnostic(
          diagnostics,
          'OXE3106',
          `${path}.output`,
          'Executable workflow operations currently require an entity output.',
          operation.id,
        );
    } else {
      const recordType = inferExpression(
        operation.body.record,
        `${path}.body.record`,
        operation.id,
        empty,
        empty,
        inputFields,
      );
      if (recordType.kind !== 'entity' && recordType.kind !== 'unknown')
        addDiagnostic(
          diagnostics,
          'OXE3106',
          `${path}.body.record`,
          'Delete target must be an entity record.',
          operation.id,
        );
    }
  });

  const validateInvocation = (
    invocation: ApplicationOperationInvocationV1,
    path: string,
    owner: string,
    locals: ReadonlyMap<string, ExpressionType>,
    viewData: ReadonlyMap<string, ExpressionType>,
  ): void => {
    reference(invocation.operation, 'operation', `${path}.operation`, owner);
    const operation = operations.get(invocation.operation);
    if (!operation) return;
    const expected = operation.input.fields;
    for (const name of Object.keys(invocation.arguments).sort(compareText)) {
      const argumentPath = childPath(`${path}.arguments`, name);
      const type = inferExpression(
        invocation.arguments[name] as ApplicationValueExpressionV1,
        argumentPath,
        owner,
        locals,
        viewData,
      );
      const expectedType = expected[name];
      if (!expectedType)
        addDiagnostic(
          diagnostics,
          'OXE3104',
          argumentPath,
          `Operation "${operation.id}" has no input named "${name}".`,
          owner,
        );
      else if (
        type.kind !== 'unknown' &&
        !('valueType' in type) &&
        type.kind !== 'entityList' &&
        !valueTypeIsAssignable(type, expectedType)
      )
        addDiagnostic(
          diagnostics,
          'OXE3106',
          argumentPath,
          `Argument "${name}" is incompatible with operation "${operation.id}".`,
          owner,
        );
    }
    for (const name of Object.keys(expected).sort(compareText))
      if (!(name in invocation.arguments))
        addDiagnostic(
          diagnostics,
          'OXE3105',
          childPath(`${path}.arguments`, name),
          `Missing argument "${name}" for operation "${operation.id}".`,
          owner,
        );
  };
  type PropExpectation = 'boolean' | 'field:number' | 'field:string' | 'number' | 'string';
  const components: Readonly<Record<string, Readonly<Record<string, PropExpectation>>>> = {
    'ui.Button': { text: 'string', type: 'string' },
    'ui.Card': {},
    'ui.CheckboxRow': { checked: 'boolean', label: 'string' },
    'ui.Form': {},
    'ui.Heading': { text: 'string' },
    'ui.Link': { href: 'string', text: 'string' },
    'ui.NumberField': {
      label: 'string',
      name: 'string',
      sourceField: 'field:number',
      value: 'number',
    },
    'ui.Page': {},
    'ui.Stack': {},
    'ui.Text': { text: 'string' },
    'ui.TextField': {
      label: 'string',
      name: 'string',
      sourceField: 'field:string',
      value: 'string',
    },
    'ui.TextArea': {
      label: 'string',
      name: 'string',
      sourceField: 'field:string',
      value: 'string',
    },
  };
  const componentExtensions = new Map(
    (graph.components ?? []).map((component) => [component.id, component]),
  );
  const validateElement = (
    element: ApplicationViewElementV1,
    path: string,
    view: ApplicationViewV1,
    locals: ReadonlyMap<string, ExpressionType>,
    viewData: ReadonlyMap<string, ExpressionType>,
    containingOwner?: string,
  ): void => {
    const owner = element.id ?? containingOwner ?? view.id;
    if (element.kind === 'repeat') {
      const sourceType = inferExpression(element.source, `${path}.source`, owner, locals, viewData);
      if (sourceType.kind !== 'entityList' && sourceType.kind !== 'unknown')
        addDiagnostic(
          diagnostics,
          'OXE3106',
          `${path}.source`,
          'Repeat source must be an entity list.',
          owner,
        );
      const itemType: ExpressionType =
        sourceType.kind === 'entityList'
          ? { kind: 'entity', entity: sourceType.entity }
          : { kind: 'unknown' };
      const nestedLocals = new Map(locals);
      nestedLocals.set(element.itemName, itemType);
      const identityType = inferExpression(
        element.identity,
        `${path}.identity`,
        owner,
        nestedLocals,
        viewData,
      );
      if (
        sourceType.kind === 'entityList' &&
        (identityType.kind !== 'entityId' || identityType.entity !== sourceType.entity)
      )
        addDiagnostic(
          diagnostics,
          'OXE3106',
          `${path}.identity`,
          `Repeat identity must be Id<${sourceType.entity}>.`,
          owner,
        );
      const displayFields = new Set<string>();
      const sourceQuery =
        element.source.kind === 'viewData'
          ? queries.get(view.data[element.source.name]?.query ?? '')
          : undefined;
      (element.display ?? []).forEach((fieldId, index) => {
        const fieldPath = `${path}.display[${index}]`;
        if (displayFields.has(fieldId))
          addDiagnostic(
            diagnostics,
            'OXE3105',
            fieldPath,
            `List displays field "${fieldId}" more than once.`,
            owner,
          );
        displayFields.add(fieldId);
        if (sourceType.kind === 'entityList')
          validateEntityField(fieldId, sourceType.entity, fieldPath, owner);
        else reference(fieldId, 'field', fieldPath, owner);
        if (sourceQuery && !sourceQuery.select.includes(fieldId))
          addDiagnostic(
            diagnostics,
            'OXE3105',
            fieldPath,
            `Displayed field "${fieldId}" is not selected by query "${sourceQuery.id}".`,
            owner,
          );
      });
      validateElement(element.template, `${path}.template`, view, nestedLocals, viewData, owner);
      return;
    }
    const contract = components[element.component];
    const componentExtension = componentExtensions.get(element.component);
    if (componentExtension)
      reference(componentExtension.id, 'componentExtension', `${path}.component`, owner);
    if (!contract && !componentExtension)
      addDiagnostic(
        diagnostics,
        'OXE3104',
        `${path}.component`,
        `Unknown UI registry component "${element.component}".`,
        owner,
      );
    if (element.fields && element.component !== 'ui.Form')
      addDiagnostic(
        diagnostics,
        'OXE3105',
        `${path}.fields`,
        'Only a form component may declare semantic fields.',
        owner,
      );
    const submitOperation = element.submit ? operations.get(element.submit.operation) : undefined;
    const createEntityId =
      submitOperation?.body.kind === 'createEntity' ? submitOperation.body.entity : undefined;
    const formFields = new Set<string>();
    (element.fields ?? []).forEach((fieldId, index) => {
      const fieldPath = `${path}.fields[${index}]`;
      if (formFields.has(fieldId))
        addDiagnostic(
          diagnostics,
          'OXE3105',
          fieldPath,
          `Form includes field "${fieldId}" more than once.`,
          owner,
        );
      formFields.add(fieldId);
      if (!createEntityId) {
        reference(fieldId, 'field', fieldPath, owner);
        addDiagnostic(
          diagnostics,
          'OXE3105',
          fieldPath,
          'A semantic form field requires a create-entity submit operation.',
          owner,
        );
        return;
      }
      validateEntityField(fieldId, createEntityId, fieldPath, owner);
      const field = fields.get(fieldId);
      if (!field || !submitOperation || !element.submit) return;
      const inputType = submitOperation.input.fields[field.name];
      if (!inputType || !valueTypesEqual(inputType, field.valueType))
        addDiagnostic(
          diagnostics,
          'OXE3105',
          fieldPath,
          `Form field "${fieldId}" is not present in operation "${submitOperation.id}" input.`,
          owner,
        );
      const argument = element.submit.arguments[field.name];
      if (argument?.kind !== 'formValue' || argument.name !== field.name)
        addDiagnostic(
          diagnostics,
          'OXE3105',
          fieldPath,
          `Form field "${fieldId}" is not submitted as "${field.name}".`,
          owner,
        );
      const bodyValue =
        submitOperation.body.kind === 'createEntity'
          ? submitOperation.body.values[fieldId]
          : undefined;
      if (bodyValue?.kind !== 'inputField' || bodyValue.name !== field.name)
        addDiagnostic(
          diagnostics,
          'OXE3105',
          fieldPath,
          `Form field "${fieldId}" is not written by operation "${submitOperation.id}".`,
          owner,
        );
    });
    for (const [name, expression] of Object.entries(element.props ?? {}).sort(([left], [right]) =>
      compareText(left, right),
    )) {
      const propPath = childPath(`${path}.props`, name);
      const type = inferExpression(expression, propPath, owner, locals, viewData);
      const expected = contract?.[name];
      const extensionExpected = componentExtension?.props[name];
      if (!expected && !extensionExpected) {
        addDiagnostic(
          diagnostics,
          'OXE3104',
          propPath,
          `Component "${element.component}" has no prop named "${name}".`,
          owner,
        );
        continue;
      }
      const compatible = expected
        ? expected.startsWith('field:')
          ? type.kind === 'fieldReference' && type.valueType.kind === expected.slice(6)
          : type.kind === expected
        : extensionExpected
          ? type.kind === 'fieldReference'
            ? valueTypeIsAssignable(type.valueType, extensionExpected)
            : type.kind !== 'entityList' && type.kind !== 'unknown'
              ? valueTypeIsAssignable(type, extensionExpected)
              : type.kind === 'unknown'
          : false;
      if (!compatible && type.kind !== 'unknown')
        addDiagnostic(
          diagnostics,
          'OXE3106',
          propPath,
          `Binding for ${element.component}.${name} requires ${expected ?? extensionExpected?.kind}, received ${type.kind}.`,
          owner,
        );
    }
    if (componentExtension) {
      for (const name of Object.keys(componentExtension.props).sort(compareText))
        if (!(name in (element.props ?? {})))
          addDiagnostic(
            diagnostics,
            'OXE3105',
            childPath(`${path}.props`, name),
            `Missing prop "${name}" for component "${componentExtension.id}".`,
            owner,
          );
      const childCount = element.children?.length ?? 0;
      if (componentExtension.children === 'none' && childCount > 0)
        addDiagnostic(
          diagnostics,
          'OXE3105',
          `${path}.children`,
          `Component "${componentExtension.id}" does not accept children.`,
          owner,
        );
      if (componentExtension.children === 'required' && childCount === 0)
        addDiagnostic(
          diagnostics,
          'OXE3105',
          `${path}.children`,
          `Component "${componentExtension.id}" requires children.`,
          owner,
        );
      for (const event of Object.keys(element.events ?? {}).sort(compareText))
        if (!(componentExtension.events ?? []).includes(event))
          addDiagnostic(
            diagnostics,
            'OXE3104',
            childPath(`${path}.events`, event),
            `Component "${componentExtension.id}" has no event named "${event}".`,
            owner,
          );
    }
    if (element.submit)
      validateInvocation(element.submit, `${path}.submit`, owner, locals, viewData);
    for (const [event, invocation] of Object.entries(element.events ?? {}).sort(([left], [right]) =>
      compareText(left, right),
    ))
      validateInvocation(invocation, childPath(`${path}.events`, event), owner, locals, viewData);
    element.children?.forEach((child, index) =>
      validateElement(child, `${path}.children[${index}]`, view, locals, viewData, owner),
    );
  };
  graph.routes.forEach((route, routeIndex) => {
    const path = `$.routes[${routeIndex}]`;
    featureReference(route.feature, `${path}.feature`, route.id);
    reference(route.view, 'view', `${path}.view`, route.id);
  });
  if (graph.app.authentication) {
    const authenticatedRoute = graph.routes.find(
      (route) => route.id === graph.app.authentication?.authenticatedRoute,
    );
    if (authenticatedRoute && authenticatedRoute.authentication !== 'required')
      addDiagnostic(
        diagnostics,
        'OXE3105',
        '$.app.authentication.authenticatedRoute',
        `Authenticated landing route "${authenticatedRoute.id}" must require authentication.`,
        graph.app.id,
      );
    for (const [name, authPath] of [
      ['signInPath', graph.app.authentication.signInPath],
      ['signUpPath', graph.app.authentication.signUpPath],
    ] as const) {
      const collisionIndex = graph.routes.findIndex((route) => route.path === authPath);
      if (collisionIndex >= 0)
        addDiagnostic(
          diagnostics,
          'OXE3105',
          `$.app.authentication.${name}`,
          `Generated authentication path "${authPath}" conflicts with $.routes[${collisionIndex}].path.`,
          graph.app.id,
        );
    }
  }
  graph.views.forEach((view, viewIndex) => {
    const path = `$.views[${viewIndex}]`;
    featureReference(view.feature, `${path}.feature`, view.id);
    const viewElementIds = new Set<string>();
    const collectViewElementIds = (element: ApplicationViewElementV1): void => {
      if (element.id) viewElementIds.add(element.id);
      if (element.kind === 'repeat') collectViewElementIds(element.template);
      else element.children?.forEach(collectViewElementIds);
    };
    collectViewElementIds(view.tree);
    const viewData = new Map<string, ExpressionType>();
    for (const [name, binding] of Object.entries(view.data).sort(([left], [right]) =>
      compareText(left, right),
    )) {
      reference(binding.query, 'query', childPath(`${path}.data`, name) + '.query', view.id);
      const query = queries.get(binding.query);
      if (query) viewData.set(name, { kind: 'entityList', entity: query.entity });
    }
    for (const [modeName, mode] of Object.entries(view.modes).sort(([left], [right]) =>
      compareText(left, right),
    )) {
      if (mode.kind === 'inherited')
        reference(mode.from, ['app', 'view'], `${path}.modes.${modeName}.from`, view.id);
      else
        for (const elementId of Object.keys(mode.skeleton?.elements ?? {}).sort(compareText)) {
          const hintPath = childPath(`${path}.modes.${modeName}.skeleton.elements`, elementId);
          reference(elementId, 'element', hintPath, view.id);
          if (!viewElementIds.has(elementId))
            addDiagnostic(
              diagnostics,
              'OXE3105',
              hintPath,
              `Skeleton hint element "${elementId}" does not belong to view "${view.id}".`,
              view.id,
            );
        }
    }
    validateElement(view.tree, `${path}.tree`, view, new Map(), viewData);
  });

  const viewsById = new Map(graph.views.map((view) => [view.id, view]));
  for (const [viewIndex, view] of graph.views.entries())
    for (const modeName of Object.keys(view.modes).sort(compareText)) {
      const visited = new Set<string>();
      let current = view;
      while (true) {
        const key = `${current.id}:${modeName}`;
        if (visited.has(key)) {
          addDiagnostic(
            diagnostics,
            'OXE3105',
            `$.views[${viewIndex}].modes.${modeName}`,
            `Inherited view mode cycle detected at "${current.id}".`,
            view.id,
          );
          break;
        }
        visited.add(key);
        const mode = current.modes[modeName as keyof typeof current.modes];
        if (!mode || mode.kind === 'generated' || mode.from === graph.app.id) break;
        const target = viewsById.get(mode.from);
        if (!target) break;
        current = target;
      }
    }

  graph.verification.flows.forEach((flow, flowIndex) =>
    flow.steps.forEach((step, stepIndex) => {
      const path = `$.verification.flows[${flowIndex}].steps[${stepIndex}]`;
      if (step.kind === 'visit') reference(step.route, 'route', `${path}.route`, flow.id);
      else if (step.kind === 'submit')
        reference(step.element, 'element', `${path}.element`, flow.id);
      else if (step.kind === 'invoke')
        reference(step.operation, 'operation', `${path}.operation`, flow.id);
      else if (step.kind === 'expectField')
        reference(step.field, 'field', `${path}.field`, flow.id);
      else {
        reference(step.query, 'query', `${path}.query`, flow.id);
        const query = queries.get(step.query);
        for (const [fieldId, value] of Object.entries(step.values).sort(([left], [right]) =>
          compareText(left, right),
        )) {
          validateEntityField(
            fieldId,
            query?.entity ?? '',
            childPath(`${path}.values`, fieldId),
            flow.id,
          );
          const field = fields.get(fieldId);
          if (field && !literalMatchesType(value, field.valueType))
            addDiagnostic(
              diagnostics,
              'OXE3106',
              childPath(`${path}.values`, fieldId),
              `Expected value is incompatible with field "${fieldId}".`,
              flow.id,
            );
        }
      }
    }),
  );
  return diagnostics;
};

/** Collects only schema-declared semantic references, excluding coincidental string literals. */
export const collectApplicationGraphReferences = (
  graph: ApplicationGraphV1,
): readonly ApplicationGraphReference[] => {
  const references: ApplicationGraphReference[] = [];
  validateGraphSemantics(graph, references);
  return references;
};

/** Validates unknown JSON structurally before checking application-level references and types. */
export const validateApplicationGraph = (value: unknown): ApplicationGraphDiagnostic[] => {
  const structural = validateGraphStructure(value);
  if (structural.length > 0) return structural;
  return validateGraphSemantics(value as ApplicationGraphV1);
};

export class ApplicationGraphValidationError extends Error {
  public constructor(public readonly diagnostics: readonly ApplicationGraphDiagnostic[]) {
    super(
      diagnostics
        .map((diagnostic) => `${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`)
        .join('\n'),
    );
    this.name = 'ApplicationGraphValidationError';
  }
}

/** Loads an unknown in-memory JSON value only after complete structural and semantic validation. */
export const loadApplicationGraph = (value: unknown): ApplicationGraphV1 => {
  const diagnostics = validateApplicationGraph(value);
  if (diagnostics.length > 0) throw new ApplicationGraphValidationError(diagnostics);
  return value as ApplicationGraphV1;
};
