import {
  ApplicationGraphValidationError,
  canonicalizeApplicationGraph,
  indexApplicationGraph,
  validateApplicationGraph,
  validateUiGraph,
  type ApplicationComponentElementV1,
  type ApplicationFieldV1,
  type ApplicationGraphV1,
  type ApplicationOperationInvocationV1,
  type ApplicationOperationV1,
  type ApplicationQueryV1,
  type ApplicationRepeatElementV1,
  type ApplicationValueTypeV1,
  type ApplicationValueExpressionV1,
  type ApplicationViewElementV1,
  type ApplicationViewV1,
  type GraphAccessV1,
  type GraphSpanV1,
  type ProcedureStepV1,
  type PrimitiveTypeV1,
  type ServerValueSchemaV1,
  type UiEdgeV1,
  type UiGraphV1,
  type UiNodeV1,
  type UiServerFunctionDefinitionV1,
  type ValueExpressionV1,
} from '@oxe/graph';

export type ApplicationUiLoweringDiagnosticCode = 'OXE2201' | 'OXE2202' | 'OXE2203';

export interface ApplicationUiLoweringDiagnostic {
  readonly code: ApplicationUiLoweringDiagnosticCode;
  readonly message: string;
  readonly path: string;
  readonly semanticId?: string;
}

export class ApplicationUiLoweringError extends Error {
  public constructor(public readonly diagnostics: readonly ApplicationUiLoweringDiagnostic[]) {
    super(
      diagnostics
        .map((diagnostic) => `${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`)
        .join('\n'),
    );
    this.name = 'ApplicationUiLoweringError';
  }
}

export interface ApplicationUiLoweringOptions {
  /** Defaults to the application's semantic entry route. */
  readonly routeId?: string;
}

export interface ApplicationUiSemanticHandleV1 {
  /** Dense, zero-based, and scoped to this application revision projection. */
  readonly handle: number;
  readonly semanticId: string;
}

export interface ApplicationUiLoweredOriginV1 {
  readonly path: string;
  readonly semanticHandle: number;
}

export interface ApplicationUiLoweredNodeProvenanceV1 {
  readonly loweredId: string;
  readonly origins: readonly ApplicationUiLoweredOriginV1[];
}

export interface ApplicationUiDeferredInteractionV1 {
  readonly event: string;
  readonly operationId: string;
  readonly ownerId: string;
  readonly path: string;
  readonly reason: 'server-operation-lowering-required';
}

export interface ApplicationUiProjectionV1 {
  readonly appId: string;
  readonly authentication: 'optional' | 'required';
  readonly deferredInteractions: readonly ApplicationUiDeferredInteractionV1[];
  readonly graph: UiGraphV1;
  readonly provenance: {
    readonly loweredNodes: readonly ApplicationUiLoweredNodeProvenanceV1[];
    readonly semanticNodes: readonly ApplicationUiSemanticHandleV1[];
  };
  readonly revision: number;
  readonly routeId: string;
  readonly schemaVersion: 'oxe.application-ui-projection.v1';
  readonly viewId: string;
}

interface OriginDraft {
  readonly path: string;
  readonly semanticId: string;
}

interface ReadReference {
  readonly path: readonly string[];
  readonly span: GraphSpanV1;
  readonly targetId: string;
}

interface DataBinding {
  readonly queryId: string;
  readonly resourceId: string;
}

interface LoweringContext {
  readonly componentId: string;
  readonly data: ReadonlyMap<string, DataBinding>;
  readonly deferred: ApplicationUiDeferredInteractionV1[];
  readonly edges: UiEdgeV1[];
  readonly fields: ReadonlyMap<string, ApplicationFieldV1>;
  readonly graph: ApplicationGraphV1;
  readonly nodeIds: Set<string>;
  readonly nodes: UiNodeV1[];
  readonly operationCapabilities: Map<string, string>;
  readonly origins: Map<string, OriginDraft[]>;
  readonly paths: ReadonlyMap<string, string>;
  readonly readEdges: Map<
    string,
    {
      readonly accesses: GraphAccessV1[];
      readonly from: string;
      readonly mode: 'procedural' | 'reactive';
      readonly sites: GraphSpanV1[];
      readonly to: string;
    }
  >;
  readonly span: GraphSpanV1;
  readonly serverFunctions: UiServerFunctionDefinitionV1[];
  readonly view: ApplicationViewV1;
}

interface ElementScope {
  readonly locals: ReadonlyMap<string, string>;
  readonly owner: OriginDraft;
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const childPath = (path: string, key: string): string =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;

const identifierPart = (value: string): string => encodeURIComponent(value);

const semanticPathSegment = (value: string): string =>
  `s${[...value]
    .map((character) => (character.codePointAt(0) ?? 0).toString(16).padStart(6, '0'))
    .join('')}`;

const fail = (
  code: ApplicationUiLoweringDiagnosticCode,
  path: string,
  message: string,
  semanticId?: string,
): never => {
  throw new ApplicationUiLoweringError([
    { code, message, path, ...(semanticId ? { semanticId } : {}) },
  ]);
};

const literalExpression = (
  value: boolean | number | string,
  span: GraphSpanV1,
): ValueExpressionV1 => ({ kind: 'literal', span, value });

const collectReadReferences = (
  expression: ValueExpressionV1,
  references: ReadReference[],
): void => {
  switch (expression.kind) {
    case 'array':
      expression.elements.forEach((item) => collectReadReferences(item, references));
      return;
    case 'binary':
      collectReadReferences(expression.left, references);
      collectReadReferences(expression.right, references);
      return;
    case 'call':
      collectReadReferences(expression.callee, references);
      expression.arguments.forEach((item) => collectReadReferences(item, references));
      return;
    case 'collection':
      collectReadReferences(expression.source, references);
      collectReadReferences(expression.callback.result, references);
      if (expression.initial) collectReadReferences(expression.initial, references);
      if (expression.options) collectReadReferences(expression.options, references);
      return;
    case 'conditional':
      expression.branches.forEach((branch) => {
        if (branch.condition) collectReadReferences(branch.condition, references);
        collectReadReferences(branch.result, references);
      });
      return;
    case 'member': {
      const path: string[] = [];
      let current: ValueExpressionV1 = expression;
      while (current.kind === 'member') {
        path.unshift(current.property);
        current = current.object;
      }
      if (current.kind === 'read' && current.tracked !== false) {
        references.push({ path, span: expression.span, targetId: current.targetId });
        return;
      }
      collectReadReferences(expression.object, references);
      return;
    }
    case 'record':
      expression.entries.forEach((entry) => collectReadReferences(entry.value, references));
      return;
    case 'read':
      if (expression.tracked !== false)
        references.push({ path: [], span: expression.span, targetId: expression.targetId });
      return;
    case 'capability-read':
    case 'literal':
    case 'local-read':
      return;
  }
};

const originFor = (context: LoweringContext, semanticId: string, path?: string): OriginDraft => ({
  path: path ?? context.paths.get(semanticId) ?? '$',
  semanticId,
});

const addNode = (
  context: LoweringContext,
  node: UiNodeV1,
  origins: readonly OriginDraft[],
): void => {
  if (context.nodeIds.has(node.id))
    fail('OXE2203', '$', `Lowered UI node id "${node.id}" was emitted more than once.`);
  context.nodeIds.add(node.id);
  context.nodes.push(node);
  const unique = new Map(origins.map((origin) => [`${origin.semanticId}\0${origin.path}`, origin]));
  context.origins.set(
    node.id,
    [...unique.values()].sort(
      (left, right) =>
        compareText(left.semanticId, right.semanticId) || compareText(left.path, right.path),
    ),
  );
};

const addChild = (context: LoweringContext, from: string, to: string, index: number): void => {
  context.edges.push({ from, index, kind: 'child', to });
};

const addExpressionReads = (
  context: LoweringContext,
  from: string,
  expressions: readonly ValueExpressionV1[],
  mode: 'procedural' | 'reactive' = 'reactive',
): void => {
  const references: ReadReference[] = [];
  expressions.forEach((expression) => collectReadReferences(expression, references));
  for (const reference of references) {
    const key = `${from}\0${reference.targetId}\0${mode}`;
    const existing = context.readEdges.get(key);
    if (existing) {
      existing.accesses.push({ path: reference.path, span: reference.span });
      existing.sites.push(reference.span);
    } else {
      context.readEdges.set(key, {
        accesses: [{ path: reference.path, span: reference.span }],
        from,
        mode,
        sites: [reference.span],
        to: reference.targetId,
      });
    }
  }
};

const nodeId = (context: LoweringContext, role: string, key: string): string =>
  `${context.componentId}/${role}/${identifierPart(key)}`;

const fieldFor = (context: LoweringContext, fieldId: string, path: string): ApplicationFieldV1 =>
  context.fields.get(fieldId) ??
  fail('OXE2203', path, `Validated field "${fieldId}" is unavailable during UI lowering.`, fieldId);

const stringSchemaForField = (field: ApplicationFieldV1): ServerValueSchemaV1 => {
  const lengths =
    field.validation?.filter((constraint) => constraint.kind === 'stringLength') ?? [];
  const minimumLength = lengths.reduce<number | undefined>(
    (result, constraint) =>
      constraint.min === undefined ? result : Math.max(result ?? constraint.min, constraint.min),
    undefined,
  );
  const maximumLength = lengths.reduce<number | undefined>(
    (result, constraint) =>
      constraint.max === undefined ? result : Math.min(result ?? constraint.max, constraint.max),
    undefined,
  );
  return {
    kind: 'string',
    ...(maximumLength === undefined ? {} : { maximumLength }),
    ...(minimumLength === undefined ? {} : { minimumLength }),
  };
};

const serverSchemaForType = (
  context: LoweringContext,
  type: ApplicationValueTypeV1,
  path: string,
  field?: ApplicationFieldV1,
  activeEntities: ReadonlySet<string> = new Set(),
): ServerValueSchemaV1 => {
  switch (type.kind) {
    case 'boolean':
      return { kind: 'boolean' };
    case 'bytes':
    case 'date':
    case 'dateTime':
    case 'decimal':
    case 'email':
    case 'entityId':
    case 'url':
      return { kind: 'string' };
    case 'enum':
      return { enum: [...type.values].sort(compareText), kind: 'string' };
    case 'number':
      return { kind: 'number' };
    case 'integer':
      return {
        integer: true,
        kind: 'number',
        ...(type.maximum === undefined ? {} : { maximum: type.maximum }),
        ...(type.minimum === undefined ? {} : { minimum: type.minimum }),
      };
    case 'list':
      return {
        items: serverSchemaForType(context, type.items, `${path}.items`),
        kind: 'array',
        ...(type.maximumItems === undefined ? {} : { maximumItems: type.maximumItems }),
        ...(type.minimumItems === undefined ? {} : { minimumItems: type.minimumItems }),
      };
    case 'optional':
      return {
        kind: 'union',
        variants: [{ kind: 'null' }, serverSchemaForType(context, type.value, `${path}.value`)],
      };
    case 'string':
      return field ? stringSchemaForField(field) : { kind: 'string' };
    case 'record':
      return {
        fields: Object.entries(type.fields)
          .sort(([left], [right]) => compareText(left, right))
          .map(([name, nested]) => ({
            name,
            schema: serverSchemaForType(context, nested, childPath(`${path}.fields`, name)),
          })),
        kind: 'record',
      };
    case 'result':
      return {
        kind: 'union',
        variants: [
          {
            fields: [
              { name: 'outcome', schema: { enum: ['ok'], kind: 'string' } },
              { name: 'value', schema: serverSchemaForType(context, type.value, `${path}.value`) },
            ],
            kind: 'record',
          },
          ...Object.entries(type.outcomes)
            .sort(([left], [right]) => compareText(left, right))
            .map(([name, outcome]) => ({
              fields: [
                { name: 'outcome', schema: { enum: [name], kind: 'string' } as const },
                {
                  name: 'value',
                  schema: serverSchemaForType(
                    context,
                    outcome,
                    childPath(`${path}.outcomes`, name),
                  ),
                },
              ],
              kind: 'record' as const,
            })),
        ],
      };
    case 'entity': {
      if (activeEntities.has(type.entity))
        return fail(
          'OXE2202',
          path,
          `Recursive entity value "${type.entity}" cannot be represented by a server-function schema.`,
          type.entity,
        );
      const entity = context.graph.entities.find((candidate) => candidate.id === type.entity);
      if (!entity)
        return fail(
          'OXE2203',
          path,
          `Validated entity "${type.entity}" is unavailable during contract lowering.`,
          type.entity,
        );
      const nestedEntities = new Set([...activeEntities, entity.id]);
      const entityFields = (entity.fields ?? [])
        .map((fieldId) => fieldFor(context, fieldId, path))
        .sort((left, right) => compareText(left.name, right.name));
      return {
        fields: entityFields.map((entityField) => ({
          name: entityField.name,
          schema: serverSchemaForType(
            context,
            entityField.valueType,
            `${path}.${entityField.name}`,
            entityField,
            nestedEntities,
          ),
        })),
        kind: 'record',
      };
    }
  }
};

const selectedEntitySchema = (
  context: LoweringContext,
  query: ApplicationQueryV1,
  path: string,
): ServerValueSchemaV1 => ({
  fields: query.select
    .map((fieldId) => fieldFor(context, fieldId, path))
    .sort((left, right) => compareText(left.name, right.name))
    .map((field) => ({
      name: field.name,
      schema: serverSchemaForType(context, field.valueType, `${path}.${field.name}`, field),
    })),
  kind: 'record',
});

const serverFunctionPath = (
  context: LoweringContext,
  kind: 'operation' | 'query',
  semanticId: string,
): readonly string[] => [
  'applicationGraph',
  semanticPathSegment(context.graph.app.id),
  kind,
  semanticPathSegment(semanticId),
];

const serverSchemaPrimitive = (schema: ServerValueSchemaV1): PrimitiveTypeV1 =>
  schema.kind === 'null' || schema.kind === 'union' ? 'unknown' : schema.kind;

const operationInputSchema = (
  context: LoweringContext,
  operation: ApplicationOperationV1,
  name: string,
  type: ApplicationValueTypeV1,
): ServerValueSchemaV1 => {
  if (type.kind !== 'string' || operation.body.kind === 'deleteEntity')
    return serverSchemaForType(context, type, `operation ${operation.id} input ${name}`);
  const values =
    operation.body.kind === 'workflow'
      ? operation.body.steps.flatMap((step) =>
          step.kind === 'createEntity' || step.kind === 'updateEntity'
            ? Object.entries(step.values)
            : [],
        )
      : operation.body.kind === 'invokeCapability'
        ? []
        : Object.entries(operation.body.values);
  const targetFieldId = values.find(
    ([, expression]) => expression.kind === 'inputField' && expression.name === name,
  )?.[0];
  const targetField = targetFieldId ? context.fields.get(targetFieldId) : undefined;
  return serverSchemaForType(context, type, `operation ${operation.id} input ${name}`, targetField);
};

const operationDefinition = (
  context: LoweringContext,
  operation: ApplicationOperationV1,
): UiServerFunctionDefinitionV1 => ({
  id: `${context.graph.app.id}/${operation.id}`,
  mode: 'mutation',
  moduleId: context.componentId.split('#')[0] ?? context.componentId,
  name: operation.name,
  parameters: Object.entries(operation.input.fields)
    .sort(([left], [right]) => compareText(left, right))
    .map(([name, type]) => ({
      name,
      schema: operationInputSchema(context, operation, name, type),
    })),
  path: serverFunctionPath(context, 'operation', operation.id),
  returns: serverSchemaForType(context, operation.output, `operation ${operation.id} output`),
  schemaVersion: 'oxe.server-function.v1',
});

const ensureOperationCapability = (
  context: LoweringContext,
  operation: ApplicationOperationV1,
  path: string,
): string => {
  const existing = context.operationCapabilities.get(operation.id);
  if (existing) return existing;
  const definition = operationDefinition(context, operation);
  context.serverFunctions.push(definition);
  const capabilityId = nodeId(context, 'capability', operation.id);
  context.operationCapabilities.set(operation.id, capabilityId);
  addNode(
    context,
    {
      capabilityKind: 'async',
      id: capabilityId,
      kind: 'platform-capability',
      parameters: definition.parameters.map((parameter) => serverSchemaPrimitive(parameter.schema)),
      path: definition.path,
      returns: serverSchemaPrimitive(definition.returns),
      serverFunctionId: definition.id,
      span: context.span,
      target: 'universal',
    },
    [originFor(context, operation.id, path)],
  );
  return capabilityId;
};

const lowerValue = (
  context: LoweringContext,
  expression: ApplicationValueExpressionV1,
  scope: ElementScope,
  path: string,
): ValueExpressionV1 => {
  switch (expression.kind) {
    case 'literal':
      if (expression.value === null)
        return fail(
          'OXE2202',
          path,
          'Null values cannot be rendered directly by the current UI projection.',
        );
      return literalExpression(expression.value, context.span);
    case 'viewData': {
      const binding = context.data.get(expression.name);
      if (!binding)
        return fail(
          'OXE2203',
          `${path}.name`,
          `Validated view data "${expression.name}" is unavailable during UI lowering.`,
          context.view.id,
        );
      return { kind: 'read', span: context.span, targetId: binding.resourceId };
    }
    case 'local': {
      const localId = scope.locals.get(expression.name);
      if (!localId)
        return fail(
          'OXE2203',
          `${path}.name`,
          `Validated local "${expression.name}" is unavailable during UI lowering.`,
          scope.owner.semanticId,
        );
      return { kind: 'read', span: context.span, targetId: localId };
    }
    case 'recordField': {
      const field = fieldFor(context, expression.field, `${path}.field`);
      return {
        kind: 'member',
        object: lowerValue(context, expression.record, scope, `${path}.record`),
        property: field.name,
        span: context.span,
      };
    }
    case 'not':
      return {
        kind: 'binary',
        left: lowerValue(context, expression.value, scope, `${path}.value`),
        operator: '==',
        right: literalExpression(false, context.span),
        span: context.span,
      };
    case 'semanticReference':
      return fail(
        'OXE2202',
        path,
        'A semanticReference is metadata and cannot be lowered as a runtime value.',
        expression.target,
      );
    case 'activeContext':
    case 'actor':
    case 'formValue':
    case 'inputField':
      return fail(
        'OXE2202',
        path,
        `Application expression "${expression.kind}" requires server-operation lowering.`,
        scope.owner.semanticId,
      );
  }
};

const containsFormValue = (expression: ApplicationValueExpressionV1): boolean => {
  switch (expression.kind) {
    case 'formValue':
      return true;
    case 'not':
      return containsFormValue(expression.value);
    case 'recordField':
      return containsFormValue(expression.record);
    case 'activeContext':
    case 'actor':
    case 'inputField':
    case 'literal':
    case 'local':
    case 'semanticReference':
    case 'viewData':
      return false;
  }
};

const formValueExpression = (
  context: LoweringContext,
  name: string,
  type: ApplicationValueTypeV1,
  path: string,
): ValueExpressionV1 => {
  if (type.kind === 'entity' || type.kind === 'record' || type.kind === 'entityId')
    return fail(
      'OXE2202',
      path,
      `Form value "${name}" cannot supply application type "${type.kind}".`,
    );
  const event: ValueExpressionV1 = {
    kind: 'local-read',
    span: context.span,
    targetId: 'event',
    type: 'record',
  };
  const namedItem: ValueExpressionV1 = {
    arguments: [literalExpression(name, context.span)],
    callee: {
      kind: 'member',
      object: {
        kind: 'member',
        object: { kind: 'member', object: event, property: 'currentTarget', span: context.span },
        property: 'elements',
        span: context.span,
      },
      property: 'namedItem',
      span: context.span,
    },
    kind: 'call',
    returnType: 'record',
    span: context.span,
  };
  return {
    kind: 'member',
    object: namedItem,
    property:
      type.kind === 'boolean' ? 'checked' : type.kind === 'number' ? 'valueAsNumber' : 'value',
    span: context.span,
  };
};

const lowerFormInvocationValue = (
  context: LoweringContext,
  expression: ApplicationValueExpressionV1,
  type: ApplicationValueTypeV1,
  scope: ElementScope,
  path: string,
): ValueExpressionV1 => {
  if (expression.kind === 'formValue')
    return formValueExpression(context, expression.name, type, path);
  if (expression.kind === 'not')
    return {
      kind: 'binary',
      left: lowerFormInvocationValue(context, expression.value, type, scope, `${path}.value`),
      operator: '==',
      right: literalExpression(false, context.span),
      span: context.span,
    };
  return lowerValue(context, expression, scope, path);
};

const lowerInvocation = (
  context: LoweringContext,
  targetElementId: string,
  event: string,
  invocation: ApplicationOperationInvocationV1,
  scope: ElementScope,
  owner: OriginDraft,
  path: string,
  preventDefault: boolean,
): void => {
  const operation = context.graph.operations.find(
    (candidate) => candidate.id === invocation.operation,
  );
  if (!operation)
    return fail(
      'OXE2203',
      `${path}.operation`,
      `Validated operation "${invocation.operation}" is unavailable during interaction lowering.`,
      invocation.operation,
    );
  const operationPath = context.paths.get(operation.id) ?? '$.operations';
  const capabilityId = ensureOperationCapability(context, operation, operationPath);
  const procedureId = nodeId(context, 'procedure', `${owner.semanticId}/${event}/${operation.id}`);
  const parameters: Extract<UiNodeV1, { readonly kind: 'procedure' }>['parameters'][number][] = [
    { name: 'event', span: context.span, type: 'record' },
  ];
  const eventArguments: ValueExpressionV1[] = [];
  const callArguments: ValueExpressionV1[] = [];
  for (const [index, [name, type]] of Object.entries(operation.input.fields)
    .sort(([left], [right]) => compareText(left, right))
    .entries()) {
    const argument = invocation.arguments[name];
    if (!argument)
      return fail(
        'OXE2203',
        `${path}.arguments`,
        `Validated invocation is missing operation input "${name}".`,
        operation.id,
      );
    const argumentPath = childPath(`${path}.arguments`, name);
    if (containsFormValue(argument)) {
      callArguments.push(lowerFormInvocationValue(context, argument, type, scope, argumentPath));
    } else {
      const parameterName = `argument${index}`;
      parameters.push({
        name: parameterName,
        span: context.span,
        type: serverSchemaPrimitive(serverSchemaForType(context, type, argumentPath)),
      });
      eventArguments.push(lowerValue(context, argument, scope, argumentPath));
      callArguments.push({
        kind: 'local-read',
        span: context.span,
        targetId: parameterName,
        type: serverSchemaPrimitive(serverSchemaForType(context, type, argumentPath)),
      });
    }
  }
  const steps: ProcedureStepV1[] = [];
  if (preventDefault)
    steps.push({
      expression: {
        arguments: [],
        callee: {
          kind: 'member',
          object: { kind: 'local-read', span: context.span, targetId: 'event', type: 'record' },
          property: 'preventDefault',
          span: context.span,
        },
        kind: 'call',
        span: context.span,
      },
      kind: 'call',
      span: context.span,
    });
  steps.push({
    expression: {
      arguments: callArguments,
      callee: { kind: 'capability-read', span: context.span, targetId: capabilityId },
      kind: 'call',
      returnType: serverSchemaPrimitive(operationDefinition(context, operation).returns),
      span: context.span,
    },
    kind: 'call',
    span: context.span,
  });
  const resourceIds = [
    ...new Set([...context.data.values()].map((binding) => binding.resourceId)),
  ].sort(compareText);
  resourceIds.forEach((resourceId) =>
    steps.push({ kind: 'refresh', span: context.span, targetId: resourceId }),
  );
  addNode(
    context,
    {
      id: procedureId,
      kind: 'procedure',
      name: `${operation.name}${event[0]?.toUpperCase() ?? ''}${event.slice(1)}`,
      parameters,
      span: context.span,
      steps,
    },
    [owner, originFor(context, operation.id, operationPath)],
  );
  addExpressionReads(
    context,
    procedureId,
    steps.flatMap((step) => (step.kind === 'call' ? [step.expression] : [])),
    'procedural',
  );
  addExpressionReads(
    context,
    procedureId,
    resourceIds.map((resourceId) => ({
      kind: 'read' as const,
      span: context.span,
      targetId: resourceId,
    })),
    'procedural',
  );
  context.edges.push({
    ...(eventArguments.length > 0 ? { arguments: eventArguments } : {}),
    authoredName: `on${event[0]?.toUpperCase() ?? ''}${event.slice(1)}`,
    event,
    from: targetElementId,
    kind: 'event',
    span: context.span,
    to: procedureId,
  });
};

const literalProp = (
  element: ApplicationComponentElementV1,
  name: string,
  path: string,
): boolean | null | number | string | undefined => {
  const value = element.props?.[name];
  if (!value) return undefined;
  if (value.kind !== 'literal')
    return fail(
      'OXE2202',
      childPath(`${path}.props`, name),
      `Property "${name}" requires a literal in the first UI lowering slice.`,
      element.id,
    );
  if (value.value === null)
    return fail(
      'OXE2202',
      childPath(`${path}.props`, name),
      `Property "${name}" cannot use null in the current UI projection.`,
      element.id,
    );
  return value.value;
};

const requireStringProp = (
  element: ApplicationComponentElementV1,
  name: string,
  path: string,
): string => {
  const value = literalProp(element, name, path);
  if (typeof value !== 'string')
    return fail(
      'OXE2203',
      childPath(`${path}.props`, name),
      `Validated ${element.component}.${name} must be a string literal.`,
      element.id,
    );
  return value;
};

const lowerStringProp = (
  context: LoweringContext,
  element: ApplicationComponentElementV1,
  name: string,
  scope: ElementScope,
  path: string,
): ValueExpressionV1 | string => {
  const expression = element.props?.[name];
  if (!expression)
    return fail(
      'OXE2203',
      childPath(`${path}.props`, name),
      `Validated ${element.component}.${name} is required.`,
      element.id,
    );
  if (expression.kind === 'literal' && typeof expression.value === 'string')
    return expression.value;
  return lowerValue(context, expression, scope, childPath(`${path}.props`, name));
};

const elementOwner = (
  context: LoweringContext,
  element: ApplicationViewElementV1,
  scope: ElementScope,
  path: string,
): OriginDraft => (element.id ? originFor(context, element.id, path) : scope.owner);

const elementKey = (element: ApplicationViewElementV1, path: string, suffix = ''): string =>
  `${element.id ?? path}${suffix ? `/${suffix}` : ''}`;

const addTextNode = (
  context: LoweringContext,
  id: string,
  value: ValueExpressionV1 | string,
  origins: readonly OriginDraft[],
): void => {
  const parts =
    typeof value === 'string'
      ? [{ kind: 'static' as const, span: context.span, value }]
      : [{ expression: value, kind: 'expression' as const, span: context.span }];
  addNode(context, { id, kind: 'text', parts, span: context.span }, origins);
  if (typeof value !== 'string') addExpressionReads(context, id, [value]);
};

const lowerGeneratedFormField = (
  context: LoweringContext,
  fieldId: string,
  owner: OriginDraft,
  path: string,
  formKey: string,
): string => {
  const field = fieldFor(context, fieldId, path);
  const fieldOrigin = originFor(context, field.id);
  const origins = [owner, fieldOrigin];
  const key = `${formKey}/generated-form-field/${field.id}`;
  const labelId = nodeId(context, 'element', key);
  addNode(
    context,
    { id: labelId, kind: 'element', span: context.span, staticAttributes: [], tag: 'label' },
    origins,
  );
  const textId = nodeId(context, 'text', `${key}/label`);
  addTextNode(context, textId, field.name, origins);
  addChild(context, labelId, textId, 0);
  if (field.valueType.kind === 'enum') {
    const selectId = nodeId(context, 'element', `${key}/select`);
    addNode(
      context,
      {
        id: selectId,
        kind: 'element',
        span: context.span,
        staticAttributes: [
          { name: 'name', span: context.span, value: field.name },
          ...(field.required ? [{ name: 'required', span: context.span, value: true }] : []),
        ],
        tag: 'select',
      },
      origins,
    );
    addChild(context, labelId, selectId, 1);
    field.valueType.values.forEach((value, index) => {
      const optionId = nodeId(context, 'element', `${key}/option/${value}`);
      const selected = field.default?.value === value;
      addNode(
        context,
        {
          id: optionId,
          kind: 'element',
          span: context.span,
          staticAttributes: [
            { name: 'value', span: context.span, value },
            ...(selected ? [{ name: 'selected', span: context.span, value: true }] : []),
          ],
          tag: 'option',
        },
        origins,
      );
      const optionTextId = nodeId(context, 'text', `${key}/option/${value}/text`);
      addTextNode(context, optionTextId, value, origins);
      addChild(context, optionId, optionTextId, 0);
      addChild(context, selectId, optionId, index);
    });
    return labelId;
  }
  const inputType =
    field.valueType.kind === 'boolean'
      ? 'checkbox'
      : field.valueType.kind === 'dateTime'
        ? 'datetime-local'
        : field.valueType.kind === 'number'
          ? 'number'
          : field.valueType.kind === 'string'
            ? 'text'
            : undefined;
  if (!inputType)
    return fail(
      'OXE2202',
      path,
      `Generated form control lowering does not support ${field.valueType.kind} field "${field.id}".`,
      field.id,
    );
  const inputId = nodeId(context, 'element', `${key}/input`);
  addNode(
    context,
    {
      id: inputId,
      kind: 'element',
      span: context.span,
      staticAttributes: [
        { name: 'name', span: context.span, value: field.name },
        { name: 'type', span: context.span, value: inputType },
        ...(field.required && field.valueType.kind !== 'boolean'
          ? [{ name: 'required', span: context.span, value: true }]
          : []),
      ],
      tag: 'input',
    },
    origins,
  );
  addChild(context, labelId, inputId, 1);
  return labelId;
};

const lowerDisplayedField = (
  context: LoweringContext,
  fieldId: string,
  itemId: string,
  owner: OriginDraft,
  path: string,
): string => {
  const field = fieldFor(context, fieldId, path);
  const origins = [owner, originFor(context, field.id)];
  const key = `generated-display/${owner.semanticId}/${field.id}`;
  const id = nodeId(context, 'element', key);
  addNode(
    context,
    { id, kind: 'element', span: context.span, staticAttributes: [], tag: 'span' },
    origins,
  );
  const labelId = nodeId(context, 'text', `${key}/label`);
  addTextNode(context, labelId, `${field.name}: `, origins);
  addChild(context, id, labelId, 0);
  const value: ValueExpressionV1 = {
    kind: 'member',
    object: { kind: 'read', span: context.span, targetId: itemId },
    property: field.name,
    span: context.span,
  };
  const valueId = nodeId(context, 'text', `${key}/value`);
  addTextNode(context, valueId, value, origins);
  addChild(context, id, valueId, 1);
  return id;
};

const lowerComponent = (
  context: LoweringContext,
  element: ApplicationComponentElementV1,
  scope: ElementScope,
  path: string,
): string => {
  const owner = elementOwner(context, element, scope, path);
  const origins = [owner];
  const key = elementKey(element, path);
  const lowerChildren = (parentId: string): void => {
    (element.children ?? []).forEach((child, index) => {
      const childId = lowerElement(
        context,
        child,
        { ...scope, owner },
        `${path}.children[${index}]`,
      );
      addChild(context, parentId, childId, index);
    });
  };

  switch (element.component) {
    case 'ui.Page': {
      const id = nodeId(context, 'element', key);
      addNode(
        context,
        { id, kind: 'element', span: context.span, staticAttributes: [], tag: 'main' },
        origins,
      );
      lowerChildren(id);
      return id;
    }
    case 'ui.Card':
    case 'ui.Stack': {
      const id = nodeId(context, 'element', key);
      addNode(
        context,
        {
          id,
          kind: 'element',
          span: context.span,
          staticAttributes: [
            {
              name: 'data-oxe-ui',
              span: context.span,
              value: element.component === 'ui.Card' ? 'card' : 'stack',
            },
          ],
          tag: element.component === 'ui.Card' ? 'section' : 'div',
        },
        origins,
      );
      lowerChildren(id);
      return id;
    }
    case 'ui.Heading': {
      const id = nodeId(context, 'element', key);
      addNode(
        context,
        { id, kind: 'element', span: context.span, staticAttributes: [], tag: 'h1' },
        origins,
      );
      const textId = nodeId(context, 'text', `${key}/text`);
      addTextNode(context, textId, lowerStringProp(context, element, 'text', scope, path), origins);
      addChild(context, id, textId, 0);
      return id;
    }
    case 'ui.Text': {
      const id = nodeId(context, 'element', key);
      addNode(
        context,
        { id, kind: 'element', span: context.span, staticAttributes: [], tag: 'p' },
        origins,
      );
      const textId = nodeId(context, 'text', `${key}/text`);
      addTextNode(context, textId, lowerStringProp(context, element, 'text', scope, path), origins);
      addChild(context, id, textId, 0);
      return id;
    }
    case 'ui.Link': {
      const id = nodeId(context, 'element', key);
      addNode(
        context,
        {
          id,
          kind: 'element',
          span: context.span,
          staticAttributes: [
            { name: 'href', span: context.span, value: requireStringProp(element, 'href', path) },
          ],
          tag: 'a',
        },
        origins,
      );
      const textId = nodeId(context, 'text', `${key}/text`);
      addTextNode(context, textId, lowerStringProp(context, element, 'text', scope, path), origins);
      addChild(context, id, textId, 0);
      return id;
    }
    case 'ui.Form': {
      const id = nodeId(context, 'element', key);
      addNode(
        context,
        { id, kind: 'element', span: context.span, staticAttributes: [], tag: 'form' },
        origins,
      );
      lowerChildren(id);
      (element.fields ?? []).forEach((fieldId, index) => {
        const fieldPath = `${path}.fields[${index}]`;
        const fieldControl = lowerGeneratedFormField(context, fieldId, owner, fieldPath, key);
        addChild(context, id, fieldControl, (element.children?.length ?? 0) + index);
      });
      if (element.submit)
        lowerInvocation(
          context,
          id,
          'submit',
          element.submit,
          scope,
          owner,
          `${path}.submit`,
          true,
        );
      return id;
    }
    case 'ui.NumberField':
    case 'ui.TextArea':
    case 'ui.TextField': {
      const label = requireStringProp(element, 'label', path);
      const name = requireStringProp(element, 'name', path);
      const source = element.props?.sourceField;
      if (source?.kind !== 'semanticReference')
        return fail(
          'OXE2203',
          `${path}.props.sourceField`,
          `Validated ${element.component}.sourceField must be a semantic field reference.`,
          owner.semanticId,
        );
      const field = fieldFor(context, source.target, `${path}.props.sourceField.target`);
      const fieldOrigin = originFor(context, field.id);
      const value = element.props?.value
        ? lowerValue(context, element.props.value, scope, `${path}.props.value`)
        : undefined;
      const id = nodeId(context, 'element', key);
      addNode(
        context,
        { id, kind: 'element', span: context.span, staticAttributes: [], tag: 'label' },
        origins,
      );
      const labelId = nodeId(context, 'text', `${key}/label`);
      addTextNode(context, labelId, label, origins);
      addChild(context, id, labelId, 0);
      const inputId = nodeId(context, 'element', `${key}/input`);
      const isNumber = element.component === 'ui.NumberField';
      const isTextArea = element.component === 'ui.TextArea';
      const staticAttributes: Extract<UiNodeV1, { readonly kind: 'element' }>['staticAttributes'] =
        [
          { name: 'name', span: context.span, value: name },
          ...(isTextArea
            ? []
            : [{ name: 'type', span: context.span, value: isNumber ? 'number' : 'text' }]),
          ...(field.required ? [{ name: 'required', span: context.span, value: true }] : []),
          ...(!isNumber ? (field.validation ?? []) : []).flatMap((constraint) => [
            ...(constraint.min === undefined
              ? []
              : [{ name: 'minlength', span: context.span, value: constraint.min }]),
            ...(constraint.max === undefined
              ? []
              : [{ name: 'maxlength', span: context.span, value: constraint.max }]),
          ]),
        ];
      addNode(
        context,
        {
          ...(value
            ? {
                dynamicAttributes: [
                  {
                    mode: 'property' as const,
                    name: 'value',
                    span: context.span,
                    value,
                  },
                ],
              }
            : {}),
          id: inputId,
          kind: 'element',
          span: context.span,
          staticAttributes,
          tag: isTextArea ? 'textarea' : 'input',
        },
        [...origins, fieldOrigin],
      );
      if (value) addExpressionReads(context, inputId, [value]);
      addChild(context, id, inputId, 1);
      return id;
    }
    case 'ui.Button': {
      const id = nodeId(context, 'element', key);
      const type = requireStringProp(element, 'type', path);
      addNode(
        context,
        {
          id,
          kind: 'element',
          span: context.span,
          staticAttributes: [{ name: 'type', span: context.span, value: type }],
          tag: 'button',
        },
        origins,
      );
      const textId = nodeId(context, 'text', `${key}/text`);
      addTextNode(context, textId, requireStringProp(element, 'text', path), origins);
      addChild(context, id, textId, 0);
      for (const [event, invocation] of Object.entries(element.events ?? {}).sort(
        ([left], [right]) => compareText(left, right),
      ))
        lowerInvocation(
          context,
          id,
          event,
          invocation,
          scope,
          owner,
          childPath(`${path}.events`, event),
          false,
        );
      return id;
    }
    case 'ui.CheckboxRow': {
      const id = nodeId(context, 'element', key);
      addNode(
        context,
        { id, kind: 'element', span: context.span, staticAttributes: [], tag: 'label' },
        origins,
      );
      const checked = element.props?.checked;
      const label = element.props?.label;
      if (!checked || !label)
        return fail(
          'OXE2203',
          `${path}.props`,
          'Validated ui.CheckboxRow requires checked and label bindings.',
          owner.semanticId,
        );
      const checkedValue = lowerValue(context, checked, scope, `${path}.props.checked`);
      const checkedField =
        checked.kind === 'recordField'
          ? originFor(context, checked.field)
          : originFor(context, owner.semanticId, owner.path);
      const inputId = nodeId(context, 'element', `${key}/input`);
      addNode(
        context,
        {
          dynamicAttributes: [
            {
              mode: 'property',
              name: 'checked',
              span: context.span,
              value: checkedValue,
            },
          ],
          id: inputId,
          kind: 'element',
          span: context.span,
          staticAttributes: [{ name: 'type', span: context.span, value: 'checkbox' }],
          tag: 'input',
        },
        [...origins, checkedField],
      );
      addExpressionReads(context, inputId, [checkedValue]);
      for (const [event, invocation] of Object.entries(element.events ?? {}).sort(
        ([left], [right]) => compareText(left, right),
      ))
        lowerInvocation(
          context,
          inputId,
          event,
          invocation,
          scope,
          owner,
          childPath(`${path}.events`, event),
          false,
        );
      addChild(context, id, inputId, 0);
      const labelValue = lowerValue(context, label, scope, `${path}.props.label`);
      const labelField =
        label.kind === 'recordField'
          ? originFor(context, label.field)
          : originFor(context, owner.semanticId, owner.path);
      const textId = nodeId(context, 'text', `${key}/text`);
      addTextNode(context, textId, labelValue, [...origins, labelField]);
      addChild(context, id, textId, 1);
      return id;
    }
    default:
      {
        const extension = context.graph.components?.find(
          (component) => component.id === element.component,
        );
        if (extension) {
          const id = nodeId(context, 'element', key);
          const dynamicAttributes = Object.entries(element.props ?? {})
            .sort(([left], [right]) => compareText(left, right))
            .map(([name, expression]) => ({
              mode: 'property' as const,
              name,
              span: context.span,
              value: lowerValue(context, expression, scope, childPath(`${path}.props`, name)),
            }));
          addNode(
            context,
            {
              ...(dynamicAttributes.length > 0 ? { dynamicAttributes } : {}),
              id,
              kind: 'element',
              span: context.span,
              staticAttributes: [
                { name: 'data-oxe-component', span: context.span, value: extension.id },
              ],
              tag: extension.ssr.tag,
            },
            [...origins, originFor(context, extension.id)],
          );
          for (const attribute of dynamicAttributes)
            addExpressionReads(context, id, [attribute.value]);
          lowerChildren(id);
          for (const [event, invocation] of Object.entries(element.events ?? {}).sort(
            ([left], [right]) => compareText(left, right),
          ))
            lowerInvocation(
              context,
              id,
              event,
              invocation,
              scope,
              owner,
              childPath(`${path}.events`, event),
              false,
            );
          return id;
        }
      }
      return fail(
        'OXE2202',
        `${path}.component`,
        `UI registry component "${element.component}" has no browser lowering.`,
        owner.semanticId,
      );
  }
};

const lowerRepeat = (
  context: LoweringContext,
  element: ApplicationRepeatElementV1,
  scope: ElementScope,
  path: string,
): string => {
  const owner = elementOwner(context, element, scope, path);
  const key = elementKey(element, path);
  const collectionId = nodeId(context, 'collection', key);
  const itemId = nodeId(context, 'item', `${key}/${element.itemName}`);
  const nestedScope: ElementScope = {
    locals: new Map([...scope.locals, [element.itemName, itemId]]),
    owner,
  };
  const source = lowerValue(context, element.source, scope, `${path}.source`);
  const identity = lowerValue(context, element.identity, nestedScope, `${path}.identity`);
  const origins = [owner];
  if (element.source.kind === 'viewData') {
    const binding = context.data.get(element.source.name);
    if (binding) origins.push(originFor(context, binding.queryId));
  }
  if (element.identity.kind === 'recordField')
    origins.push(originFor(context, element.identity.field));
  addNode(
    context,
    {
      id: collectionId,
      itemId,
      key: identity,
      kind: 'keyed-collection',
      source,
      span: context.span,
    },
    origins,
  );
  addExpressionReads(context, collectionId, [source, identity]);
  addNode(
    context,
    {
      id: itemId,
      kind: 'collection-item',
      name: element.itemName,
      ownerId: collectionId,
      span: context.span,
      type: 'record',
    },
    [owner],
  );
  const templateId = lowerElement(context, element.template, nestedScope, `${path}.template`);
  if ((element.display?.length ?? 0) === 0) {
    addChild(context, collectionId, templateId, 0);
  } else {
    const rowId = nodeId(context, 'element', `${key}/row`);
    addNode(
      context,
      { id: rowId, kind: 'element', span: context.span, staticAttributes: [], tag: 'div' },
      [owner],
    );
    addChild(context, rowId, templateId, 0);
    element.display?.forEach((fieldId, index) => {
      const fieldPath = `${path}.display[${index}]`;
      const displayId = lowerDisplayedField(context, fieldId, itemId, owner, fieldPath);
      addChild(context, rowId, displayId, index + 1);
    });
    addChild(context, collectionId, rowId, 0);
  }
  return collectionId;
};

const lowerElement = (
  context: LoweringContext,
  element: ApplicationViewElementV1,
  scope: ElementScope,
  path: string,
): string =>
  element.kind === 'repeat'
    ? lowerRepeat(context, element, scope, path)
    : lowerComponent(context, element, scope, path);

const edgeKey = (edge: UiEdgeV1): string => {
  if (edge.kind === 'child')
    return `${edge.kind}\0${edge.from}\0${edge.index.toString().padStart(10, '0')}\0${edge.to}`;
  if (edge.kind === 'read' || edge.kind === 'write')
    return `${edge.kind}\0${edge.from}\0${edge.to}\0${edge.mode}`;
  return `${edge.kind}\0${edge.from}\0${edge.to}`;
};

/**
 * Lowers one validated application route's successful browser view into the existing UiGraphV1.
 * Reachable queries and operations are emitted as typed server-function contracts.
 */
export const lowerApplicationRouteToUiGraph = (
  input: ApplicationGraphV1,
  options: ApplicationUiLoweringOptions = {},
): ApplicationUiProjectionV1 => {
  const graphDiagnostics = validateApplicationGraph(input);
  if (graphDiagnostics.length > 0) throw new ApplicationGraphValidationError(graphDiagnostics);
  const graph = canonicalizeApplicationGraph(input);
  const paths = new Map(
    indexApplicationGraph(graph).nodes.map((node) => [node.id, node.path] as const),
  );
  const routeId = options.routeId ?? graph.app.entryRoute;
  const routeIndex = graph.routes.findIndex((route) => route.id === routeId);
  const route = graph.routes[routeIndex];
  if (!route)
    return fail('OXE2201', '$.routes', `Application route "${routeId}" does not exist.`, routeId);
  const viewIndex = graph.views.findIndex((view) => view.id === route.view);
  const view = graph.views[viewIndex];
  if (!view)
    return fail(
      'OXE2201',
      `$.routes[${routeIndex}].view`,
      `Route "${route.id}" references unavailable view "${route.view}".`,
      route.id,
    );

  const moduleId = `application/${identifierPart(graph.app.id)}/routes/${identifierPart(route.id)}`;
  const componentId = `${moduleId}#component/${identifierPart(view.id)}`;
  const span: GraphSpanV1 = {
    end: { column: 1, line: 1, offset: 0 },
    fileName: `application-graph:${graph.app.id}`,
    start: { column: 1, line: 1, offset: 0 },
  };
  const data = new Map<string, DataBinding>();
  const context: LoweringContext = {
    componentId,
    data,
    deferred: [],
    edges: [],
    fields: new Map(graph.fields.map((field) => [field.id, field])),
    graph,
    nodeIds: new Set(),
    nodes: [],
    operationCapabilities: new Map(),
    origins: new Map(),
    paths,
    readEdges: new Map(),
    serverFunctions: [],
    span,
    view,
  };

  const viewPath = `$.views[${viewIndex}]`;
  const routePath = `$.routes[${routeIndex}]`;
  addNode(context, { id: componentId, kind: 'component', name: view.name, parameters: [], span }, [
    originFor(context, route.id, routePath),
    originFor(context, view.id, viewPath),
  ]);

  const queryCapabilities = new Map<string, string>();
  for (const [name, binding] of Object.entries(view.data).sort(([left], [right]) =>
    compareText(left, right),
  )) {
    const query = graph.queries.find((candidate) => candidate.id === binding.query);
    if (!query)
      return fail(
        'OXE2203',
        childPath(`${viewPath}.data`, name),
        `Validated query "${binding.query}" is unavailable during UI lowering.`,
        view.id,
      );
    const queryPath = paths.get(query.id) ?? '$.queries';
    let capabilityId = queryCapabilities.get(query.id);
    if (!capabilityId) {
      const definition: UiServerFunctionDefinitionV1 = {
        id: `${graph.app.id}/${query.id}`,
        mode: 'query',
        moduleId,
        name: query.name,
        parameters: [],
        path: serverFunctionPath(context, 'query', query.id),
        returns: {
          items: selectedEntitySchema(context, query, `${queryPath}.select`),
          kind: 'array',
        },
        schemaVersion: 'oxe.server-function.v1',
      };
      context.serverFunctions.push(definition);
      capabilityId = nodeId(context, 'capability', query.id);
      queryCapabilities.set(query.id, capabilityId);
      addNode(
        context,
        {
          capabilityKind: 'async',
          id: capabilityId,
          kind: 'platform-capability',
          parameters: [],
          path: definition.path,
          returns: 'array',
          serverFunctionId: definition.id,
          span,
          target: 'universal',
        },
        [originFor(context, query.id, queryPath)],
      );
    }
    const resourceId = nodeId(context, 'binding', `view-data/${name}`);
    addNode(
      context,
      {
        expression: {
          arguments: [],
          callee: { kind: 'capability-read', span, targetId: capabilityId },
          kind: 'call',
          returnType: 'array',
          span,
        },
        id: resourceId,
        kind: 'async-resource',
        name,
        span,
        type: 'array',
      },
      [
        originFor(context, view.id, childPath(`${viewPath}.data`, name)),
        originFor(context, query.id),
      ],
    );
    data.set(name, { queryId: query.id, resourceId });
  }

  const rootId = lowerElement(
    context,
    view.tree,
    { locals: new Map(), owner: originFor(context, view.id, viewPath) },
    `${viewPath}.tree`,
  );
  addChild(context, componentId, rootId, 0);

  for (const edge of context.readEdges.values())
    context.edges.push({
      accesses: edge.accesses,
      from: edge.from,
      kind: 'read',
      mode: edge.mode,
      sites: edge.sites,
      to: edge.to,
    });

  const uiGraph: UiGraphV1 = {
    edges: context.edges.sort((left, right) => compareText(edgeKey(left), edgeKey(right))),
    entryComponents: [componentId],
    moduleId,
    nodes: context.nodes.sort((left, right) => compareText(left.id, right.id)),
    schemaVersion: 'oxe.ui-graph.v1',
    serverFunctions: context.serverFunctions.sort((left, right) => compareText(left.id, right.id)),
  };
  const uiDiagnostics = validateUiGraph(uiGraph);
  if (uiDiagnostics.length > 0)
    return fail(
      'OXE2203',
      viewPath,
      `Internal application UI lowering produced an invalid UiGraphV1: ${uiDiagnostics
        .map((diagnostic) => `${diagnostic.code} ${diagnostic.message}`)
        .join('; ')}`,
      view.id,
    );

  const semanticIds = new Set<string>([route.id, view.id]);
  for (const origins of context.origins.values())
    origins.forEach((origin) => semanticIds.add(origin.semanticId));
  context.deferred.forEach((interaction) => {
    semanticIds.add(interaction.operationId);
    semanticIds.add(interaction.ownerId);
  });
  const semanticNodes = [...semanticIds]
    .sort(compareText)
    .map((semanticId, handle) => ({ handle, semanticId }));
  const handleById = new Map(semanticNodes.map((entry) => [entry.semanticId, entry.handle]));
  const loweredNodes = [...context.origins]
    .sort(([left], [right]) => compareText(left, right))
    .map(([loweredId, origins]) => ({
      loweredId,
      origins: origins
        .map((origin) => ({
          path: origin.path,
          semanticHandle:
            handleById.get(origin.semanticId) ??
            fail(
              'OXE2203',
              origin.path,
              `Semantic provenance handle for "${origin.semanticId}" is unavailable.`,
              origin.semanticId,
            ),
        }))
        .sort(
          (left, right) =>
            left.semanticHandle - right.semanticHandle || compareText(left.path, right.path),
        ),
    }));

  return {
    appId: graph.app.id,
    authentication: route.authentication,
    deferredInteractions: context.deferred.sort(
      (left, right) => compareText(left.path, right.path) || compareText(left.event, right.event),
    ),
    graph: uiGraph,
    provenance: { loweredNodes, semanticNodes },
    revision: graph.revision,
    routeId: route.id,
    schemaVersion: 'oxe.application-ui-projection.v1',
    viewId: view.id,
  };
};
