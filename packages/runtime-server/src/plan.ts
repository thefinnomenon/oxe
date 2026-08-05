import {
  fingerprintUiGraph,
  validateUiGraph,
  type ComponentInstanceNodeV1,
  type ComponentNodeV1,
  type ComponentParameterNodeV1,
  type ContentValueNodeV1,
  type PlatformCapabilityNodeV1,
  type TextNodeV1,
  type UiEdgeV1,
  type UiGraphV1,
  type UiNodeV1,
  type ValueExpressionV1,
} from '@oxe/graph';

import type {
  ServerBindingV1,
  ServerComponentPlanV1,
  ServerComponentPropV1,
  ServerExpressionV1,
  ServerLocalizedMessageV1,
  ServerParameterV1,
  ServerRenderPlanV1,
  ServerRenderPlanV2,
  ServerViewV1,
} from './types.js';

export type ServerPlanErrorCode = 'OXE_SERVER_PLAN_INVALID' | 'OXE_SERVER_PLAN_UNSUPPORTED';

export class OxeServerPlanError extends Error {
  public readonly code: ServerPlanErrorCode;

  public constructor(code: ServerPlanErrorCode, message: string) {
    super(message);
    this.name = 'OxeServerPlanError';
    this.code = code;
  }
}

type ChildEdge = Extract<UiEdgeV1, { readonly kind: 'child' }>;
type EventEdge = Extract<UiEdgeV1, { readonly kind: 'event' }>;
type PropEdge = Extract<UiEdgeV1, { readonly kind: 'prop' }>;
type SpreadEdge = Extract<UiEdgeV1, { readonly kind: 'spread-prop' }>;

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareNodes = (left: UiNodeV1, right: UiNodeV1): number =>
  left.span.start.offset - right.span.start.offset || compareText(left.id, right.id);

const invalid = (message: string): never => {
  throw new OxeServerPlanError('OXE_SERVER_PLAN_INVALID', message);
};

const unsupported = (message: string): never => {
  throw new OxeServerPlanError('OXE_SERVER_PLAN_UNSUPPORTED', message);
};

const lowerExpression = (expression: ValueExpressionV1): ServerExpressionV1 => {
  switch (expression.kind) {
    case 'array':
      return { kind: 'array', elements: expression.elements.map(lowerExpression) };
    case 'binary':
      return {
        kind: 'binary',
        left: lowerExpression(expression.left),
        operator: expression.operator,
        right: lowerExpression(expression.right),
      };
    case 'call':
      return {
        kind: 'call',
        callee: lowerExpression(expression.callee),
        arguments: expression.arguments.map(lowerExpression),
      };
    case 'capability-read':
      return { kind: 'capability', targetId: expression.targetId };
    case 'collection':
      return {
        kind: 'collection',
        operation: expression.operation,
        source: lowerExpression(expression.source),
        callback: {
          parameters: expression.callback.parameters.map((parameter) => ({
            id: parameter.id,
            name: parameter.name,
          })),
          result: lowerExpression(expression.callback.result),
        },
        ...(expression.initial ? { initial: lowerExpression(expression.initial) } : {}),
        ...(expression.options ? { options: lowerExpression(expression.options) } : {}),
      };
    case 'conditional':
      return {
        kind: 'conditional',
        branches: expression.branches.map((branch) => ({
          ...(branch.condition ? { condition: lowerExpression(branch.condition) } : {}),
          result: lowerExpression(branch.result),
        })),
      };
    case 'literal':
      return { kind: 'literal', value: expression.value };
    case 'local-read':
      return { kind: 'local', targetId: expression.targetId };
    case 'member':
      return {
        kind: 'member',
        object: lowerExpression(expression.object),
        property: expression.property,
      };
    case 'record':
      return {
        kind: 'record',
        entries: expression.entries.map((entry) => ({
          name: entry.name,
          value: lowerExpression(entry.value),
        })),
      };
    case 'read':
      return { kind: 'read', targetId: expression.targetId };
  }
};

const reachableComponents = (
  entryId: string,
  components: readonly ComponentNodeV1[],
  graph: UiGraphV1,
  nodesById: ReadonlyMap<string, UiNodeV1>,
): ReadonlySet<string> => {
  const componentById = new Map(components.map((component) => [component.id, component]));
  const instancesByOwner = new Map<string, ComponentInstanceNodeV1[]>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'owner') {
      continue;
    }
    const instance = nodesById.get(edge.to);
    if (instance?.kind === 'component-instance') {
      const owned = instancesByOwner.get(edge.from) ?? [];
      owned.push(instance);
      instancesByOwner.set(edge.from, owned);
    }
  }

  const result = new Set<string>();
  const pending = [entryId];
  while (pending.length > 0) {
    const id = pending.pop();
    if (!id || result.has(id)) {
      continue;
    }
    if (!componentById.has(id)) {
      invalid(`Server entry references missing component "${id}".`);
    }
    result.add(id);
    for (const instance of instancesByOwner.get(id) ?? []) {
      pending.push(instance.componentId);
    }
  }
  return result;
};

/** Lowers the semantic UI graph into a deterministic, JSON-only server backend contract. */
export const createServerRenderPlan = (graph: UiGraphV1): ServerRenderPlanV1 => {
  const diagnostics = validateUiGraph(graph);
  if (diagnostics.length > 0) {
    invalid(
      `Cannot create a server render plan from an invalid UiGraphV1:\n${diagnostics
        .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        .join('\n')}`,
    );
  }
  if (graph.entryComponents.length !== 1) {
    unsupported(
      `Server rendering currently requires exactly one entry component, but received ${graph.entryComponents.length}.`,
    );
  }

  const entryId = graph.entryComponents[0];
  if (!entryId) {
    return invalid('The server render plan has no entry component.');
  }
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const allComponents = graph.nodes
    .filter((node): node is ComponentNodeV1 => node.kind === 'component')
    .sort(compareNodes);
  const reachable = reachableComponents(entryId, allComponents, graph, nodesById);
  const components = allComponents.filter((component) => reachable.has(component.id));
  const componentById = new Map(components.map((component) => [component.id, component]));

  const childrenByParent = new Map<string, ChildEdge[]>();
  const eventsByElement = new Map<string, EventEdge[]>();
  const propsByInstance = new Map<string, PropEdge[]>();
  const spreadsByInstance = new Map<string, SpreadEdge[]>();
  for (const edge of graph.edges) {
    if (edge.kind === 'child') {
      const children = childrenByParent.get(edge.from) ?? [];
      children.push(edge);
      childrenByParent.set(edge.from, children);
    } else if (edge.kind === 'event') {
      const events = eventsByElement.get(edge.from) ?? [];
      events.push(edge);
      eventsByElement.set(edge.from, events);
    } else if (edge.kind === 'prop') {
      const props = propsByInstance.get(edge.from) ?? [];
      props.push(edge);
      propsByInstance.set(edge.from, props);
    } else if (edge.kind === 'spread-prop') {
      const spreads = spreadsByInstance.get(edge.from) ?? [];
      spreads.push(edge);
      spreadsByInstance.set(edge.from, spreads);
    }
  }
  for (const children of childrenByParent.values()) {
    children.sort((left, right) => left.index - right.index || compareText(left.to, right.to));
  }

  const lowerProps = (instanceId: string): readonly ServerComponentPropV1[] =>
    [
      ...(propsByInstance.get(instanceId) ?? []).map((prop): ServerComponentPropV1 =>
        prop.mode === 'procedure'
          ? {
              kind: 'procedure',
              parameterId: prop.to,
              targetId: prop.targetId,
              ...(prop.authoredName ? { authoredName: prop.authoredName } : {}),
              ...(prop.index === undefined ? {} : { index: prop.index }),
            }
          : {
              kind: 'value',
              parameterId: prop.to,
              value: lowerExpression(prop.value),
              ...(prop.authoredName ? { authoredName: prop.authoredName } : {}),
              ...(prop.index === undefined ? {} : { index: prop.index }),
            },
      ),
      ...(spreadsByInstance.get(instanceId) ?? []).map((spread): ServerComponentPropV1 => ({
        kind: 'spread',
        index: spread.index,
        parameterId: spread.to,
        source:
          spread.source.kind === 'rest'
            ? { kind: 'rest', targetId: spread.source.targetId }
            : { kind: 'value', value: lowerExpression(spread.source.value) },
      })),
    ].sort(
      (left, right) =>
        (left.index ?? Number.MAX_SAFE_INTEGER) - (right.index ?? Number.MAX_SAFE_INTEGER) ||
        compareText(left.parameterId, right.parameterId) ||
        compareText(left.kind, right.kind),
    );

  const activeViews = new Set<string>();
  const lowerLocalization = (
    localization: NonNullable<Extract<UiNodeV1, { readonly kind: 'text' }>['localization']>,
  ): ServerLocalizedMessageV1 => ({
    key: localization.key,
    source: localization.source,
    values: localization.values.map((value) => ({
      name: value.name,
      value: lowerExpression(value.value),
    })),
    ...(localization.selection
      ? {
          selection: {
            kind: localization.selection.kind,
            value: lowerExpression(localization.selection.value),
          },
        }
      : {}),
    markup: localization.markup.map((markup) => ({
      name: markup.name,
      tag: markup.tag,
      staticAttributes: markup.staticAttributes.map((attribute) => ({
        kind: 'static',
        name: attribute.name,
        value: attribute.value,
      })),
      dynamicAttributes: markup.dynamicAttributes.map((attribute) => ({
        kind: 'dynamic',
        mode: attribute.mode,
        name: attribute.name,
        value: lowerExpression(attribute.value),
      })),
    })),
  });
  const lowerView = (id: string): ServerViewV1 => {
    if (activeViews.has(id)) {
      return invalid(`Server view hierarchy cycles through "${id}".`);
    }
    const node = nodesById.get(id);
    if (!node) {
      return invalid(`Server view references missing node "${id}".`);
    }
    activeViews.add(id);
    try {
      switch (node.kind) {
        case 'element':
          return {
            kind: 'element',
            id: node.id,
            tag: node.tag,
            ...((eventsByElement.get(node.id)?.length ?? 0) > 0 ? { eventId: node.id } : {}),
            attributes: [
              ...node.staticAttributes.map((attribute) => ({
                kind: 'static' as const,
                name: attribute.name,
                value: attribute.value,
              })),
              ...(node.dynamicAttributes ?? []).map((attribute) => ({
                kind: 'dynamic' as const,
                mode: attribute.mode,
                name: attribute.name,
                value: lowerExpression(attribute.value),
                ...(attribute.localization
                  ? { localization: lowerLocalization(attribute.localization) }
                  : {}),
              })),
            ],
            children: (childrenByParent.get(node.id) ?? []).map((edge) => lowerView(edge.to)),
          };
        case 'text':
          return {
            kind: 'text',
            id: node.id,
            ...(node.format
              ? {
                  format: {
                    options: node.format.options.map((option) => ({
                      name: option.name,
                      value: lowerExpression(option.value),
                    })),
                    type: node.format.type,
                    value: lowerExpression(node.format.value),
                  },
                }
              : {}),
            ...(node.localization ? { localization: lowerLocalization(node.localization) } : {}),
            parts: node.parts.map((part) =>
              part.kind === 'static'
                ? { kind: 'static', value: part.value }
                : { kind: 'expression', expression: lowerExpression(part.expression) },
            ),
          };
        case 'component-instance':
          if (!componentById.has(node.componentId)) {
            return invalid(
              `Component instance "${node.id}" references unreachable component "${node.componentId}".`,
            );
          }
          return {
            kind: 'component',
            id: node.id,
            componentId: node.componentId,
            props: lowerProps(node.id),
            children: (childrenByParent.get(node.id) ?? []).map((edge) => lowerView(edge.to)),
          };
        case 'conditional-region': {
          const branches = childrenByParent.get(node.id) ?? [];
          if (branches.length !== node.branches.length) {
            return invalid(`Conditional view "${node.id}" has mismatched branch metadata.`);
          }
          return {
            kind: 'choice',
            id: node.id,
            branches: node.branches.map((branch, index) => ({
              ...(branch.condition ? { condition: lowerExpression(branch.condition) } : {}),
              omittedEffectIds: branch.effectIds ?? [],
              view: lowerView(branches[index]?.to ?? ''),
            })),
          };
        }
        case 'content-reference': {
          const content = nodesById.get(node.contentId);
          if (content?.kind !== 'content-value') {
            return invalid(`Content reference "${node.id}" has no content value.`);
          }
          return lowerContentValue(node.id, content);
        }
        case 'keyed-collection': {
          const rows = childrenByParent.get(node.id) ?? [];
          if (rows.length !== 1 || !rows[0]) {
            return invalid(`Keyed collection "${node.id}" must have exactly one row view.`);
          }
          return {
            kind: 'collection',
            id: node.id,
            itemId: node.itemId,
            source: lowerExpression(node.source),
            key: lowerExpression(node.key),
            row: lowerView(rows[0].to),
          };
        }
        case 'context-provider':
          return {
            kind: 'context-provider',
            id: node.id,
            contextId: node.contextId,
            value: lowerExpression(node.value),
            children: (childrenByParent.get(node.id) ?? []).map((edge) => lowerView(edge.to)),
          };
        case 'content-slot':
          return { kind: 'content-slot', id: node.id, parameterId: node.parameterId };
        default:
          return unsupported(`Node "${node.id}" (${node.kind}) cannot be used as a server view.`);
      }
    } finally {
      activeViews.delete(id);
    }
  };

  const lowerContentValue = (id: string, content: ContentValueNodeV1): ServerViewV1 => ({
    kind: 'choice',
    id,
    branches: content.branches.map((branch) => ({
      ...(branch.condition ? { condition: lowerExpression(branch.condition) } : {}),
      omittedEffectIds: branch.effectIds,
      view: lowerView(branch.resultId),
    })),
  });

  const lowerParameter = (parameter: ComponentParameterNodeV1): ServerParameterV1 => {
    switch (parameter.parameterKind) {
      case 'children':
      case 'procedure':
      case 'rest':
        return {
          id: parameter.id,
          index: parameter.index,
          kind: parameter.parameterKind,
          name: parameter.name,
        };
      case 'value':
        return {
          id: parameter.id,
          index: parameter.index,
          kind: 'value',
          name: parameter.name,
          type: parameter.type,
          ...(parameter.default ? { default: lowerExpression(parameter.default) } : {}),
        };
    }
  };

  const lowerBinding = (node: UiNodeV1): ServerBindingV1 | undefined => {
    switch (node.kind) {
      case 'async-resource':
        return {
          expression: lowerExpression(node.expression),
          id: node.id,
          kind: 'async-resource',
          name: node.name,
        };
      case 'constant':
        return { kind: 'constant', id: node.id, name: node.name, value: node.value };
      case 'cell':
        return {
          kind: 'state',
          id: node.id,
          name: node.name,
          initial: lowerExpression(node.initial),
        };
      case 'computed':
        return {
          kind: 'computed',
          id: node.id,
          name: node.name,
          expression: lowerExpression(node.expression),
        };
      case 'context-consumer':
        return { kind: 'context', id: node.id, name: node.name, contextId: node.contextId };
      case 'ref':
        return { kind: 'ref', id: node.id, name: node.name };
      default:
        return undefined;
    }
  };

  const componentPlans: ServerComponentPlanV1[] = components.map((component) => {
    const rootEdges = childrenByParent.get(component.id) ?? [];
    if (rootEdges.length !== 1 || !rootEdges[0]) {
      return unsupported(
        `Component "${component.name}" must have exactly one root view for server rendering.`,
      );
    }
    const prefix = `${component.id}/`;
    const parameters = component.parameters.map((id) => {
      const parameter = nodesById.get(id);
      if (parameter?.kind !== 'component-parameter') {
        return invalid(`Component "${component.name}" references missing parameter "${id}".`);
      }
      return lowerParameter(parameter);
    });
    const bindings = graph.nodes
      .filter((node) => node.id.startsWith(prefix))
      .sort(compareNodes)
      .flatMap((node) => {
        const binding = lowerBinding(node);
        return binding ? [binding] : [];
      });
    return {
      id: component.id,
      name: component.name,
      parameters,
      bindings,
      boundary: {
        id: `${component.id}/server-boundary`,
        mode: 'blocking',
        root: lowerView(rootEdges[0].to),
      },
    };
  });

  const contextIds = new Set(
    componentPlans.flatMap((component) =>
      component.bindings.flatMap((binding) =>
        binding.kind === 'context' ? [binding.contextId] : [],
      ),
    ),
  );
  for (const component of components) {
    for (const node of graph.nodes) {
      if (node.kind === 'context-provider' && node.id.startsWith(`${component.id}/`)) {
        contextIds.add(node.contextId);
      }
    }
  }

  const capabilities = graph.nodes
    .filter((node): node is PlatformCapabilityNodeV1 => node.kind === 'platform-capability')
    .sort(compareNodes)
    .map((capability) => ({
      id: capability.id,
      path: capability.path,
      target: capability.target,
      capabilityKind: capability.capabilityKind,
      parameters: capability.parameters,
      ...(capability.routeIntrinsic ? { routeIntrinsic: capability.routeIntrinsic } : {}),
      ...(capability.returns ? { returns: capability.returns } : {}),
    }));

  const belongsToReachableComponent = (node: UiNodeV1): boolean =>
    reachable.has(node.id) ||
    components.some((component) => node.id.startsWith(`${component.id}/`));

  return {
    schemaVersion: 'oxe.server-render-plan.v1',
    source: {
      buildFingerprint: fingerprintUiGraph(graph),
      graphSchemaVersion: graph.schemaVersion,
      moduleId: graph.moduleId,
    },
    execution: { mode: 'synchronous', delivery: 'ordered-chunks' },
    entry: { componentId: entryId, boundaryId: `${entryId}/server-boundary` },
    components: componentPlans,
    contexts: graph.nodes
      .filter((node) => node.kind === 'context' && contextIds.has(node.id))
      .sort(compareNodes)
      .map((node) => ({ id: node.id, name: node.kind === 'context' ? node.name : node.id })),
    capabilities,
    nonRenderingWork: graph.nodes
      .filter(
        (node) =>
          belongsToReachableComponent(node) && (node.kind === 'effect' || node.kind === 'resource'),
      )
      .sort(compareNodes)
      .map((node) => ({ id: node.id, kind: node.kind as 'effect' | 'resource' })),
  };
};

const expressionReadIds = (expression: ValueExpressionV1, result: Set<string>): void => {
  switch (expression.kind) {
    case 'array':
      expression.elements.forEach((element) => expressionReadIds(element, result));
      return;
    case 'binary':
      expressionReadIds(expression.left, result);
      expressionReadIds(expression.right, result);
      return;
    case 'call':
      expressionReadIds(expression.callee, result);
      expression.arguments.forEach((argument) => expressionReadIds(argument, result));
      return;
    case 'collection':
      expressionReadIds(expression.source, result);
      expressionReadIds(expression.callback.result, result);
      if (expression.initial) expressionReadIds(expression.initial, result);
      if (expression.options) expressionReadIds(expression.options, result);
      return;
    case 'conditional':
      expression.branches.forEach((branch) => {
        if (branch.condition) expressionReadIds(branch.condition, result);
        expressionReadIds(branch.result, result);
      });
      return;
    case 'member':
      expressionReadIds(expression.object, result);
      return;
    case 'record':
      expression.entries.forEach((entry) => expressionReadIds(entry.value, result));
      return;
    case 'read':
      result.add(expression.targetId);
      return;
    case 'capability-read':
    case 'literal':
    case 'local-read':
      return;
  }
};

/** Lowers stable, smallest-consumer async regions without coupling them to a JS renderer. */
export const createDeferredServerRenderPlan = (graph: UiGraphV1): ServerRenderPlanV2 => {
  const blocking = createServerRenderPlan(graph);
  const resourcesByNode = new Map<string, Set<string>>();
  for (const node of [...graph.nodes].sort(compareNodes)) {
    if (node.kind === 'async-resource') {
      resourcesByNode.set(node.id, new Set([node.id]));
    }
  }

  const addResources = (targetId: string, resourceIds: Iterable<string>): boolean => {
    const current = resourcesByNode.get(targetId) ?? new Set<string>();
    const previousSize = current.size;
    for (const resourceId of resourceIds) current.add(resourceId);
    if (current.size > 0) resourcesByNode.set(targetId, current);
    return current.size !== previousSize;
  };
  const resourcesForExpression = (expression: ValueExpressionV1): Set<string> => {
    const reads = new Set<string>();
    expressionReadIds(expression, reads);
    const resources = new Set<string>();
    for (const id of reads) {
      for (const resourceId of resourcesByNode.get(id) ?? []) resources.add(resourceId);
    }
    return resources;
  };
  const addExpressionResources = (
    resources: Set<string>,
    expressions: readonly ValueExpressionV1[],
  ): void => {
    for (const expression of expressions) {
      for (const resourceId of resourcesForExpression(expression)) resources.add(resourceId);
    }
  };
  const localizationExpressions = (
    localization: NonNullable<TextNodeV1['localization']>,
  ): readonly ValueExpressionV1[] => [
    ...localization.values.map((value) => value.value),
    ...(localization.selection ? [localization.selection.value] : []),
    ...localization.markup.flatMap((markup) =>
      markup.dynamicAttributes.map((attribute) => attribute.value),
    ),
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      if (edge.kind === 'read') {
        changed = addResources(edge.from, resourcesByNode.get(edge.to) ?? []) || changed;
      } else if (edge.kind === 'prop' && edge.mode === 'reactive') {
        changed = addResources(edge.to, resourcesForExpression(edge.value)) || changed;
      }
    }
  }

  const components = graph.nodes
    .filter((node): node is ComponentNodeV1 => node.kind === 'component')
    .sort((left, right) => right.id.length - left.id.length || compareText(left.id, right.id));
  const componentIdFor = (nodeId: string): string =>
    components.find((component) => nodeId.startsWith(`${component.id}/`))?.id ??
    blocking.entry.componentId;
  const componentPlans = new Map(blocking.components.map((component) => [component.id, component]));
  const rootStructuralConsumers = new Set<string>();
  const visitRootStructure = (view: ServerViewV1, active: ReadonlySet<string>): void => {
    if (view.kind === 'choice' || view.kind === 'collection') {
      rootStructuralConsumers.add(view.id);
      return;
    }
    if (view.kind === 'context-provider') {
      rootStructuralConsumers.add(view.id);
      if (view.children.length === 1 && view.children[0]) {
        visitRootStructure(view.children[0], active);
      }
      return;
    }
    if (view.kind === 'component' && !active.has(view.componentId)) {
      const target = componentPlans.get(view.componentId);
      if (target) {
        visitRootStructure(target.boundary.root, new Set([...active, view.componentId]));
      }
    }
  };
  const entryComponent = componentPlans.get(blocking.entry.componentId);
  if (entryComponent) visitRootStructure(entryComponent.boundary.root, new Set());
  const regions: ServerRenderPlanV2['regions'][number][] = [];
  const addRegion = (
    consumerId: string,
    suffix: string,
    kind: ServerRenderPlanV2['regions'][number]['kind'],
    resourceIds: ReadonlySet<string>,
  ): void => {
    if (resourceIds.size === 0) return;
    regions.push({
      componentId: componentIdFor(consumerId),
      consumerId,
      id: `${consumerId}/deferred/${suffix}`,
      kind,
      resourceIds: [...resourceIds].sort(compareText),
      statusGate: kind === 'structural' && rootStructuralConsumers.has(consumerId),
    });
  };

  for (const node of [...graph.nodes].sort(compareNodes)) {
    if (node.kind === 'text') {
      if (node.localization) {
        const resources = new Set<string>();
        addExpressionResources(resources, localizationExpressions(node.localization));
        addRegion(node.id, 'localization', 'text', resources);
      } else if (node.format) {
        const resources = resourcesForExpression(node.format.value);
        addExpressionResources(
          resources,
          node.format.options.map((option) => option.value),
        );
        addRegion(node.id, 'format', 'text', resources);
      } else {
        node.parts.forEach((part, index) => {
          if (part.kind === 'expression') {
            addRegion(node.id, `text[${index}]`, 'text', resourcesForExpression(part.expression));
          }
        });
      }
    } else if (node.kind === 'element') {
      (node.dynamicAttributes ?? []).forEach((attribute, index) => {
        const resources = resourcesForExpression(attribute.value);
        if (attribute.localization) {
          addExpressionResources(resources, localizationExpressions(attribute.localization));
        }
        addRegion(node.id, `attribute[${index}]/${attribute.name}`, 'attribute', resources);
      });
    } else if (node.kind === 'conditional-region' || node.kind === 'content-value') {
      const resources = new Set<string>();
      for (const branch of node.branches) {
        if (!branch.condition) continue;
        for (const id of resourcesForExpression(branch.condition)) resources.add(id);
      }
      addRegion(node.id, 'structure', 'structural', resources);
    } else if (node.kind === 'keyed-collection') {
      const resources = resourcesForExpression(node.source);
      for (const id of resourcesForExpression(node.key)) resources.add(id);
      addRegion(node.id, 'structure', 'structural', resources);
    } else if (node.kind === 'context-provider') {
      addRegion(node.id, 'structure', 'structural', resourcesForExpression(node.value));
    }
  }

  return {
    capabilities: blocking.capabilities,
    components: blocking.components,
    contexts: blocking.contexts,
    entry: blocking.entry,
    execution: {
      batching: 'resource-and-short-window',
      delivery: 'readiness-stream',
      mode: 'asynchronous',
      ordering: 'stable-document-markers',
    },
    nonRenderingWork: blocking.nonRenderingWork,
    regions,
    schemaVersion: 'oxe.server-render-plan.v2',
    source: blocking.source,
  };
};
