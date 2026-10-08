import type {
  ApplicationComponentElementV1,
  ApplicationFieldV1,
  ApplicationGraphV1,
  ApplicationOperationV1,
  ApplicationRepeatElementV1,
  ApplicationValueExpressionV1,
  ApplicationValueTypeV1,
  ApplicationViewElementV1,
} from './application-types.js';
import { resolveApplicationJobRetry } from './application-jobs.js';

export interface CompactApplicationProjectionSize {
  readonly characters: number;
  readonly lines: number;
  readonly utf8Bytes: number;
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const handleMap = (ids: readonly string[], prefix: string): ReadonlyMap<string, string> =>
  new Map([...ids].sort(compareText).map((id, index) => [id, `${prefix}${index + 1}`]));

const literalText = (value: boolean | null | number | string): string =>
  value === null ? 'null' : typeof value === 'string' ? JSON.stringify(value) : String(value);

const valueTypeText = (
  type: ApplicationValueTypeV1,
  entityHandles: ReadonlyMap<string, string>,
): string => {
  switch (type.kind) {
    case 'boolean':
      return 'bool';
    case 'bytes':
      return 'bytes';
    case 'date':
      return 'date';
    case 'dateTime':
      return 'datetime';
    case 'decimal':
      return `decimal(${type.precision},${type.scale})`;
    case 'email':
      return 'email';
    case 'entity':
      return entityHandles.get(type.entity) ?? type.entity;
    case 'entityId':
      return `id<${entityHandles.get(type.entity) ?? type.entity}>`;
    case 'enum':
      return `enum(${type.values.join(',')})`;
    case 'number':
      return 'num';
    case 'integer': {
      const bounds =
        type.minimum === undefined && type.maximum === undefined
          ? ''
          : `(${type.minimum ?? ''}..${type.maximum ?? ''})`;
      return `int${bounds}`;
    }
    case 'list': {
      const bounds =
        type.minimumItems === undefined && type.maximumItems === undefined
          ? ''
          : `${type.minimumItems ?? ''}..${type.maximumItems ?? ''}`;
      return `list${bounds ? `[${bounds}]` : ''}<${valueTypeText(type.items, entityHandles)}>`;
    }
    case 'optional':
      return `${valueTypeText(type.value, entityHandles)}?`;
    case 'record':
      return `{${Object.entries(type.fields)
        .sort(([left], [right]) => compareText(left, right))
        .map(([name, field]) => `${name}:${valueTypeText(field, entityHandles)}`)
        .join(',')}}`;
    case 'result':
      return `result<${valueTypeText(type.value, entityHandles)}|${Object.entries(type.outcomes)
        .sort(([left], [right]) => compareText(left, right))
        .map(([name, outcome]) => `${name}:${valueTypeText(outcome, entityHandles)}`)
        .join(',')}>`;
    case 'string':
      return 'str';
    case 'url':
      return 'url';
  }
};

const fieldText = (
  field: ApplicationFieldV1,
  handle: string,
  entityHandles: ReadonlyMap<string, string>,
): string => {
  const fragments = [`${handle} ${field.name}: ${valueTypeText(field.valueType, entityHandles)}`];
  if (field.required && !field.default) fragments.push('required');
  for (const constraint of field.validation ?? []) {
    fragments.push(
      `len ${constraint.min === undefined ? '' : constraint.min}..${constraint.max === undefined ? '' : constraint.max}`,
    );
  }
  if (field.default) fragments.push(`= ${literalText(field.default.value)}`);
  return fragments.join(' ');
};

const relationEndpointForEntity = (
  relation: ApplicationGraphV1['relations'][number],
  entityId: string,
) => {
  if (relation.from.entity === entityId) return { endpoint: relation.from, other: relation.to };
  if (relation.to.entity === entityId) return { endpoint: relation.to, other: relation.from };
  return undefined;
};

const collectElements = (
  element: ApplicationViewElementV1,
  components: ApplicationComponentElementV1[],
  repeats: ApplicationRepeatElementV1[],
): void => {
  if (element.kind === 'repeat') {
    repeats.push(element);
    collectElements(element.template, components, repeats);
    return;
  }
  components.push(element);
  element.children?.forEach((child) => collectElements(child, components, repeats));
};

const referencedField = (
  expression: ApplicationValueExpressionV1 | undefined,
): string | undefined =>
  expression?.kind === 'recordField'
    ? expression.field
    : expression?.kind === 'semanticReference'
      ? expression.target
      : undefined;

const writtenHandles = (
  operation: ApplicationOperationV1,
  capabilityHandles: ReadonlyMap<string, string>,
  entityHandles: ReadonlyMap<string, string>,
  fieldHandles: ReadonlyMap<string, string>,
): string =>
  operation.effects
    .map(
      (effect) =>
        capabilityHandles.get(effect.target) ??
        entityHandles.get(effect.target) ??
        fieldHandles.get(effect.target) ??
        effect.target,
    )
    .filter((handle, index, all) => all.indexOf(handle) === index)
    .join(' ');

/**
 * First revision-scoped AI inspection view. Stable ids stay in the graph; short handles only
 * exist in this deterministic projection and are never accepted as canonical identities.
 */
export const projectCompactApplicationGraph = (graph: ApplicationGraphV1): string => {
  const visibleEntities = graph.entities.filter((entity) => entity.origin !== 'builtin');
  const orderedVisibleEntities = [...visibleEntities].sort((left, right) =>
    compareText(left.id, right.id),
  );
  const entityHandles = handleMap(
    orderedVisibleEntities.map((entity) => entity.id),
    'E',
  );
  const capabilityHandles = handleMap(
    (graph.capabilities ?? []).map((capability) => capability.id),
    'C',
  );
  const visibleFields = orderedVisibleEntities.flatMap((entity) =>
    (entity.fields ?? []).flatMap((fieldId) => {
      const field = graph.fields.find((candidate) => candidate.id === fieldId);
      return field && field.origin !== 'generated' ? [field] : [];
    }),
  );
  const fieldHandles = new Map(
    visibleFields.map((field, index) => [field.id, `F${index + 1}`] as const),
  );
  const relationHandles = handleMap(
    graph.relations.map((relation) => relation.id),
    'R',
  );
  const queryHandles = handleMap(
    graph.queries.map((query) => query.id),
    'Q',
  );
  const operationHandles = handleMap(
    graph.operations.map((operation) => operation.id),
    'O',
  );
  const routeHandles = handleMap(
    graph.routes.map((route) => route.id),
    'V',
  );
  const entitiesById = new Map(graph.entities.map((entity) => [entity.id, entity]));
  const fieldsById = new Map(graph.fields.map((field) => [field.id, field]));
  const operationsById = new Map(graph.operations.map((operation) => [operation.id, operation]));
  const viewsById = new Map(graph.views.map((view) => [view.id, view]));
  const lines: string[] = [`${graph.app.name} r${graph.revision}`];
  if (graph.app.authentication)
    lines.push(
      `auth BetterAuth ${graph.app.authentication.methods.join(',')} signIn=${graph.app.authentication.signInPath} signUp=${graph.app.authentication.signUpPath}`,
    );
  lines.push('');

  for (const module of [...(graph.modules ?? [])].sort((left, right) =>
    compareText(left.id, right.id),
  )) {
    const packages = Object.entries(module.packages ?? {})
      .sort(([left], [right]) => compareText(left, right))
      .map(([name, version]) => `${name}@${version}`)
      .join(',');
    lines.push(
      `module ${module.id} ${module.target}/${module.format} ${module.source} ${module.integrity}${packages ? ` packages=${packages}` : ''}`,
    );
  }
  for (const component of [...(graph.components ?? [])].sort((left, right) =>
    compareText(left.id, right.id),
  ))
    lines.push(
      `component ${component.id} props=[${Object.keys(component.props).sort(compareText).join(',')}] events=[${[...(component.events ?? [])].sort(compareText).join(',')}] children=${component.children} impl=${component.implementation.module}.${component.implementation.export}`,
    );
  for (const style of [...(graph.styles ?? [])].sort((left, right) =>
    compareText(left.id, right.id),
  ))
    lines.push(
      `style ${style.id} tokens=${Object.keys(style.tokens).length} themes=[${Object.keys(
        style.themes ?? {},
      )
        .sort(compareText)
        .join(',')}] sheets=[${[...(style.stylesheets ?? [])].sort(compareText).join(',')}]`,
    );
  if (
    (graph.modules?.length ?? 0) > 0 ||
    (graph.components?.length ?? 0) > 0 ||
    (graph.styles?.length ?? 0) > 0
  )
    lines.push('');

  const contextsById = new Map((graph.contexts ?? []).map((context) => [context.id, context]));
  if ((graph.app.contexts?.length ?? 0) > 0) {
    const contexts = [...(graph.app.contexts ?? [])]
      .sort(compareText)
      .map((contextId) => contextsById.get(contextId)?.name ?? contextId);
    lines.push(`contexts ${contexts.join(', ')}`, '');
  }

  for (const capability of [...(graph.capabilities ?? [])].sort((left, right) =>
    compareText(left.id, right.id),
  )) {
    const methods = Object.entries(capability.methods)
      .sort(([left], [right]) => compareText(left, right))
      .map(
        ([name, method]) =>
          `${name}${valueTypeText(method.input, entityHandles)}->${valueTypeText(method.output, entityHandles)}`,
      )
      .join(',');
    lines.push(
      `${capabilityHandles.get(capability.id)} ${capability.name}: ${capability.contract}@${capability.version} [${methods}]${capability.adapter ? ` adapter=${capability.adapter.module}.${capability.adapter.export}` : ''}`,
    );
  }
  if ((graph.capabilities?.length ?? 0) > 0) lines.push('');

  for (const entity of orderedVisibleEntities) {
    lines.push(`${entityHandles.get(entity.id)} ${entity.name}`);
    for (const fieldId of entity.fields ?? []) {
      const field = fieldsById.get(fieldId);
      const handle = fieldHandles.get(fieldId);
      if (field && handle) lines.push(`  ${fieldText(field, handle, entityHandles)}`);
    }
    for (const relation of [...graph.relations].sort((left, right) =>
      compareText(left.id, right.id),
    )) {
      const endpoints = relationEndpointForEntity(relation, entity.id);
      if (!endpoints) continue;
      const otherName = entitiesById.get(endpoints.other.entity)?.name ?? endpoints.other.entity;
      const qualifiers = [
        endpoints.endpoint.required ? 'required' : '',
        endpoints.endpoint.createValue?.kind === 'actor' ? 'default actor' : '',
        endpoints.endpoint.createValue?.kind === 'activeContext'
          ? `default context(${contextsById.get(endpoints.endpoint.createValue.context)?.name ?? endpoints.endpoint.createValue.context})`
          : '',
      ].filter(Boolean);
      lines.push(
        `  ${relationHandles.get(relation.id)} ${endpoints.endpoint.name} -> ${otherName}${qualifiers.length > 0 ? ` ${qualifiers.join(' ')}` : ''}`,
      );
      const policy = graph.policies.find((candidate) => candidate.target === entity.id);
      if (policy) {
        const access = (['read', 'update', 'delete'] as const).filter((rule) => {
          const predicate = policy.rules[rule];
          return (
            (predicate.kind === 'relationEqualsActor' ||
              predicate.kind === 'relationEqualsContext') &&
            predicate.relation === relation.id
          );
        });
        if (access.length > 0)
          lines.push(`  access ${endpoints.endpoint.name}: ${access.join(' ')}`);
      }
    }
    for (const constraint of [...(graph.uniques ?? [])]
      .filter((candidate) => candidate.entity === entity.id)
      .sort((left, right) => compareText(left.id, right.id))) {
      const keys = constraint.keys.map(
        (key) => fieldHandles.get(key) ?? relationHandles.get(key) ?? key,
      );
      lines.push(`  unique ${keys.join(' ')}`);
    }
  }

  lines.push('');
  for (const query of [...graph.queries].sort((left, right) => compareText(left.id, right.id))) {
    const entity = entitiesById.get(query.entity);
    const queryFilter = query.filter;
    const filterRelation =
      queryFilter?.kind === 'relationEqualsActor' || queryFilter?.kind === 'relationEqualsContext'
        ? graph.relations.find((relation) => relation.id === queryFilter.relation)
        : undefined;
    const filter = filterRelation
      ? relationEndpointForEntity(filterRelation, query.entity)?.endpoint.name
      : undefined;
    const predicates = [
      ...(filter
        ? [
            `${filter}=${queryFilter?.kind === 'relationEqualsContext' ? `context(${contextsById.get(queryFilter.context)?.name ?? queryFilter.context})` : 'actor'}`,
          ]
        : []),
      ...(query.where ?? []).map(
        (condition) =>
          `${fieldHandles.get(condition.field) ?? condition.field}=${literalText(condition.equals)}`,
      ),
    ];
    const cache = query.cache
      ? query.cache.kind === 'no-store'
        ? ' cache=no-store'
        : ` cache=${query.cache.maxAgeMs}ms`
      : '';
    lines.push(
      `${queryHandles.get(query.id)} ${query.name}: ${entity?.name ?? query.entity}[]${predicates.length > 0 ? ` where ${predicates.join(' & ')}` : ''}${cache}`,
    );
  }
  for (const operation of [...graph.operations].sort((left, right) =>
    compareText(left.id, right.id),
  )) {
    const inputs = Object.keys(operation.input.fields).sort(compareText).join(',');
    const output =
      operation.output.kind === 'entity'
        ? (entitiesById.get(operation.output.entity)?.name ?? operation.output.entity)
        : valueTypeText(operation.output, entityHandles);
    const writes = writtenHandles(operation, capabilityHandles, entityHandles, fieldHandles);
    const effectLabel = operation.effects.some(
      (effect) => effect.kind === 'externalCall' || effect.kind === 'jobEnqueue',
    )
      ? 'effects'
      : 'writes';
    const workflow =
      operation.body.kind === 'workflow'
        ? ` steps ${operation.body.steps
            .map((step) => {
              if (step.kind === 'enqueueCapability') {
                const retry = resolveApplicationJobRetry(step.retry);
                return `enqueue:${capabilityHandles.get(step.capability) ?? step.capability}.${step.method}@${step.as} retry=${retry.maxAttempts} backoff=${retry.initialDelayMs}ms*${retry.multiplier}<=${retry.maxDelayMs}ms jitter=${retry.jitterRatio}`;
              }
              const action =
                step.kind === 'createEntity'
                  ? 'create'
                  : step.kind === 'updateEntity'
                    ? 'update'
                    : 'delete';
              return `${action}:${entityHandles.get(step.entity) ?? step.entity}@${step.as}`;
            })
            .join('>')}`
        : '';
    const invocation =
      operation.body.kind === 'invokeCapability'
        ? ` calls ${capabilityHandles.get(operation.body.capability) ?? operation.body.capability}.${operation.body.method}`
        : '';
    lines.push(
      `${operationHandles.get(operation.id)} ${operation.name}(${inputs}) -> ${output}${writes ? ` ${effectLabel} ${writes}` : ''}${workflow}${invocation}`,
    );
  }

  for (const route of [...graph.routes].sort((left, right) => compareText(left.id, right.id))) {
    const view = viewsById.get(route.view);
    if (!view) continue;
    lines.push(
      '',
      `${routeHandles.get(route.id)} ${route.path} ${view.name}${route.authentication === 'required' ? ' auth' : ''}`,
    );
    const components: ApplicationComponentElementV1[] = [];
    const repeats: ApplicationRepeatElementV1[] = [];
    collectElements(view.tree, components, repeats);
    const repeatComponents = new Set<ApplicationComponentElementV1>();
    repeats.forEach((repeat) => {
      const nestedComponents: ApplicationComponentElementV1[] = [];
      const nestedRepeats: ApplicationRepeatElementV1[] = [];
      collectElements(repeat.template, nestedComponents, nestedRepeats);
      nestedComponents.forEach((component) => repeatComponents.add(component));
    });
    const forms = components
      .filter(
        (component) =>
          component.component === 'ui.Form' && component.id && !repeatComponents.has(component),
      )
      .sort((left, right) => compareText(left.id ?? '', right.id ?? ''));
    forms.forEach((form, index) => {
      const operation = form.submit ? operationsById.get(form.submit.operation) : undefined;
      const entityId =
        operation?.body.kind === 'createEntity'
          ? operation.body.entity
          : operation?.output.kind === 'entity'
            ? operation.output.entity
            : undefined;
      const action =
        operation?.body.kind === 'createEntity'
          ? 'create'
          : operation?.body.kind === 'updateEntity'
            ? 'update'
            : operation?.body.kind === 'deleteEntity'
              ? 'delete'
              : operation?.body.kind === 'workflow'
                ? `workflow(${operation.body.steps.length})`
                : '?';
      const fieldIds: string[] = [];
      const formComponents: ApplicationComponentElementV1[] = [];
      const nestedRepeats: ApplicationRepeatElementV1[] = [];
      collectElements(form, formComponents, nestedRepeats);
      for (const component of formComponents) {
        const fieldId = referencedField(component.props?.sourceField);
        if (fieldId && !fieldIds.includes(fieldId)) fieldIds.push(fieldId);
      }
      for (const fieldId of form.fields ?? []) {
        if (!fieldIds.includes(fieldId)) fieldIds.push(fieldId);
      }
      lines.push(
        `  Form${index + 1} ${action} ${entityHandles.get(entityId ?? '') ?? entityId ?? '?'} [${fieldIds.map((fieldId) => fieldHandles.get(fieldId) ?? fieldId).join(' ')}]`,
      );
    });
    [...repeats]
      .filter((repeat) => repeat.id)
      .sort((left, right) => compareText(left.id ?? '', right.id ?? ''))
      .forEach((repeat, index) => {
        const queryId =
          repeat.source.kind === 'viewData' ? view.data[repeat.source.name]?.query : undefined;
        lines.push(`  List${index + 1} ${queryHandles.get(queryId ?? '') ?? queryId ?? '?'}`);
        if (repeat.template.kind === 'component') {
          const appendComponent = (
            component: ApplicationComponentElementV1,
            indentation: string,
          ): void => {
            const componentName = component.component.replace(/^ui\./u, '');
            const preferredPropOrder = ['label', 'checked', 'value', 'text', 'type'];
            const props = Object.entries(component.props ?? {})
              .filter(([name]) => name !== 'name' && name !== 'sourceField')
              .sort(
                ([left], [right]) =>
                  (preferredPropOrder.indexOf(left) < 0
                    ? preferredPropOrder.length
                    : preferredPropOrder.indexOf(left)) -
                    (preferredPropOrder.indexOf(right) < 0
                      ? preferredPropOrder.length
                      : preferredPropOrder.indexOf(right)) || compareText(left, right),
              )
              .map(([name, expression]) => {
                const fieldId = referencedField(expression);
                const value =
                  fieldHandles.get(fieldId ?? '') ??
                  fieldId ??
                  (expression.kind === 'literal' ? String(expression.value) : '?');
                return `${name}=${value}`;
              });
            lines.push(
              `${indentation}${componentName}${props.length > 0 ? ` ${props.join(' ')}` : ''}`,
            );
            if (component.submit)
              lines.push(
                `${indentation}  submit -> ${operationHandles.get(component.submit.operation) ?? component.submit.operation}`,
              );
            for (const [eventName, event] of Object.entries(component.events ?? {}).sort(
              ([left], [right]) => compareText(left, right),
            ))
              lines.push(
                `${indentation}  ${eventName} -> ${operationHandles.get(event.operation) ?? event.operation}`,
              );
            component.children?.forEach((child) => {
              if (child.kind === 'component') appendComponent(child, `${indentation}  `);
            });
          };
          appendComponent(repeat.template, '    ');
          if ((repeat.display ?? []).length > 0) {
            lines.push(
              `    display ${(repeat.display ?? [])
                .map((fieldId) => fieldHandles.get(fieldId) ?? fieldId)
                .join(' ')}`,
            );
          }
        }
      });
  }

  return `${lines.join('\n')}\n`;
};

export const measureCompactApplicationProjection = (
  projection: string,
): CompactApplicationProjectionSize => ({
  characters: [...projection].length,
  lines: projection.length === 0 ? 0 : projection.split('\n').length - 1,
  utf8Bytes: [...projection].reduce((bytes, character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return bytes + (codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4);
  }, 0),
});
