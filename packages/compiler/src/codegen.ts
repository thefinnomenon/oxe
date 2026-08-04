import {
  validateUiGraph,
  type BinaryOperatorV1,
  type CellNodeV1,
  type ComponentInstanceNodeV1,
  type ComponentNodeV1,
  type ComponentParameterNodeV1,
  type ContentReferenceNodeV1,
  type ContentValueNodeV1,
  type ConditionalRegionNodeV1,
  type ComputedNodeV1,
  type ContextConsumerNodeV1,
  type ContextNodeV1,
  type ContextProviderNodeV1,
  type ConstantValueV1,
  type ConstantNodeV1,
  type EffectNodeV1,
  type ElementNodeV1,
  type GraphSpanV1,
  type KeyedCollectionNodeV1,
  type LiteralValueV1,
  type ProcedureNodeV1,
  type ResourceNodeV1,
  type RefNodeV1,
  type TextNodeV1,
  type UiEdgeV1,
  type UiGraphV1,
  type UiNodeV1,
  type ValueExpressionV1,
} from '@oxe/graph';

export type CodegenErrorCode = 'OXE4001' | 'OXE4002';

export interface DomCodeArtifact {
  readonly componentExport: string;
  readonly factorySource: string;
  readonly factorySourceMap: DomSourceMapV3;
  readonly moduleSource: string;
  readonly moduleSourceMap: DomSourceMapV3;
  readonly mountExport: string;
}

export interface DomSourceMapV3 {
  readonly file: string;
  readonly mappings: string;
  readonly names: readonly string[];
  readonly sources: readonly string[];
  readonly version: 3;
}

export class OxeCodegenError extends Error {
  public readonly code: CodegenErrorCode;

  public constructor(code: CodegenErrorCode, message: string) {
    super(message);
    this.name = 'OxeCodegenError';
    this.code = code;
  }
}

type BindingNodeV1 =
  CellNodeV1 | ComputedNodeV1 | ConstantNodeV1 | ContextConsumerNodeV1 | RefNodeV1;
type ChildEdgeV1 = Extract<UiEdgeV1, { readonly kind: 'child' }>;
type EventEdgeV1 = Extract<UiEdgeV1, { readonly kind: 'event' }>;
type PropEdgeV1 = Extract<UiEdgeV1, { readonly kind: 'prop' }>;
type SpreadPropEdgeV1 = Extract<UiEdgeV1, { readonly kind: 'spread-prop' }>;
type ViewNodeV1 =
  | ComponentInstanceNodeV1
  | ConditionalRegionNodeV1
  | ContextProviderNodeV1
  | ElementNodeV1
  | KeyedCollectionNodeV1;

interface ComponentPlan {
  readonly bindings: readonly BindingNodeV1[];
  readonly component: ComponentNodeV1;
  readonly effects: readonly EffectNodeV1[];
  readonly parameters: readonly ComponentParameterNodeV1[];
  readonly procedures: readonly ProcedureNodeV1[];
  readonly resources: readonly ResourceNodeV1[];
  readonly root: ViewNodeV1;
}

interface GenerationPlan {
  readonly childrenByParent: ReadonlyMap<string, readonly ChildEdgeV1[]>;
  readonly components: readonly ComponentPlan[];
  readonly contexts: readonly ContextNodeV1[];
  readonly entry: ComponentPlan;
  readonly eventsByElement: ReadonlyMap<string, readonly EventEdgeV1[]>;
  readonly nodesById: ReadonlyMap<string, UiNodeV1>;
  readonly propsByInstance: ReadonlyMap<string, readonly PropEdgeV1[]>;
  readonly spreadsByInstance: ReadonlyMap<string, readonly SpreadPropEdgeV1[]>;
}

interface EmittedProgram {
  readonly componentName: string;
  readonly mountName: string;
  readonly mappings: readonly GeneratedMapping[];
  readonly source: string;
}

interface GeneratedMapping {
  readonly generatedColumn: number;
  readonly generatedLine: number;
  readonly source: GraphSpanV1;
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareNodes = (left: UiNodeV1, right: UiNodeV1): number =>
  left.span.start.offset - right.span.start.offset || compareText(left.id, right.id);

const invalidGraph = (message: string): never => {
  throw new OxeCodegenError('OXE4001', message);
};

const unsupported = (message: string): never => {
  throw new OxeCodegenError('OXE4002', message);
};

const isBinding = (node: UiNodeV1): node is BindingNodeV1 =>
  node.kind === 'cell' ||
  node.kind === 'computed' ||
  node.kind === 'constant' ||
  node.kind === 'context-consumer' ||
  node.kind === 'ref';

const isValueParameter = (
  node: UiNodeV1,
): node is ComponentParameterNodeV1 & { readonly parameterKind: 'value' } =>
  node.kind === 'component-parameter' && node.parameterKind === 'value';

interface ExpressionRead {
  readonly path: readonly string[];
  readonly targetId: string;
}

const memberRead = (
  expression: Extract<ValueExpressionV1, { readonly kind: 'member' }>,
): ExpressionRead | undefined => {
  const path: string[] = [];
  let current: ValueExpressionV1 = expression;
  while (current.kind === 'member') {
    path.unshift(current.property);
    current = current.object;
  }
  return current.kind === 'read' && current.tracked !== false
    ? { path, targetId: current.targetId }
    : undefined;
};

const expressionReads = (expression: ValueExpressionV1, result: ExpressionRead[]): void => {
  switch (expression.kind) {
    case 'array':
      for (const element of expression.elements) {
        expressionReads(element, result);
      }
      return;
    case 'binary':
      expressionReads(expression.left, result);
      expressionReads(expression.right, result);
      return;
    case 'call':
      expressionReads(expression.callee, result);
      for (const argument of expression.arguments) {
        expressionReads(argument, result);
      }
      return;
    case 'capability-read':
    case 'local-read':
      return;
    case 'collection':
      expressionReads(expression.source, result);
      expressionReads(expression.callback.result, result);
      if (expression.initial) {
        expressionReads(expression.initial, result);
      }
      if (expression.options) {
        expressionReads(expression.options, result);
      }
      return;
    case 'conditional':
      for (const branch of expression.branches) {
        if (branch.condition) {
          expressionReads(branch.condition, result);
        }
        expressionReads(branch.result, result);
      }
      return;
    case 'literal':
      return;
    case 'member': {
      const selected = memberRead(expression);
      if (selected) {
        result.push(selected);
        return;
      }
      expressionReads(expression.object, result);
      return;
    }
    case 'record':
      for (const entry of expression.entries) {
        expressionReads(entry.value, result);
      }
      return;
    case 'read':
      if (expression.tracked !== false) {
        result.push({ path: [], targetId: expression.targetId });
      }
      return;
  }
};

const uniqueExpressionReads = (expression: ValueExpressionV1): readonly ExpressionRead[] => {
  const reads: ExpressionRead[] = [];
  expressionReads(expression, reads);
  const unique = new Map<string, ExpressionRead>();
  for (const read of reads) {
    unique.set(JSON.stringify([read.targetId, read.path]), read);
  }
  return [...unique.values()];
};

const nodeExpression = (node: BindingNodeV1): ValueExpressionV1 | undefined => {
  switch (node.kind) {
    case 'cell':
      return node.initial;
    case 'computed':
      return node.expression;
    case 'constant':
    case 'context-consumer':
    case 'ref':
      return undefined;
  }
};

const orderBindings = (
  bindings: readonly BindingNodeV1[],
  nodesById: ReadonlyMap<string, UiNodeV1>,
): readonly BindingNodeV1[] => {
  const localBindings = new Map(bindings.map((binding) => [binding.id, binding]));
  const ordered: BindingNodeV1[] = [];
  const state = new Map<string, 'done' | 'visiting'>();

  const visit = (binding: BindingNodeV1): void => {
    const current = state.get(binding.id);
    if (current === 'done') {
      return;
    }
    if (current === 'visiting') {
      invalidGraph(
        `Cannot generate DOM code because value dependencies cycle through "${binding.id}".`,
      );
    }

    state.set(binding.id, 'visiting');
    const expression = nodeExpression(binding);
    if (expression) {
      for (const { targetId: dependencyId } of uniqueExpressionReads(expression)) {
        const dependency = nodesById.get(dependencyId);
        if (!dependency) {
          return invalidGraph(`Cannot generate read of "${dependencyId}" because it is missing.`);
        }
        if (isValueParameter(dependency)) {
          continue;
        }
        if (!isBinding(dependency)) {
          return invalidGraph(
            `Cannot generate read of "${dependencyId}" because it is not a value node.`,
          );
        }
        const local = localBindings.get(dependency.id);
        if (!local) {
          return invalidGraph(
            `Cannot generate cross-component value read "${dependencyId}" from this component.`,
          );
        }
        visit(local);
      }
    }
    state.set(binding.id, 'done');
    ordered.push(binding);
  };

  for (const binding of [...bindings].sort(compareNodes)) {
    visit(binding);
  }
  return ordered;
};

const buildPlan = (graph: UiGraphV1): GenerationPlan => {
  const graphDiagnostics = validateUiGraph(graph);
  if (graphDiagnostics.length > 0) {
    invalidGraph(
      `Cannot generate DOM code from an invalid UiGraphV1:\n${graphDiagnostics
        .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        .join('\n')}`,
    );
  }

  if (graph.entryComponents.length !== 1) {
    unsupported(
      `DOM code generation currently requires exactly one entry component, but received ${graph.entryComponents.length}.`,
    );
  }

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const allComponents = graph.nodes
    .filter((node): node is ComponentNodeV1 => node.kind === 'component')
    .sort(compareNodes);
  const allContexts = graph.nodes
    .filter((node): node is ContextNodeV1 => node.kind === 'context')
    .sort(compareNodes);

  const entryId = graph.entryComponents[0];
  const componentById = new Map(allComponents.map((component) => [component.id, component]));
  const instancesByOwner = new Map<string, ComponentInstanceNodeV1[]>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'owner') {
      continue;
    }
    const instance = nodesById.get(edge.to);
    if (instance?.kind !== 'component-instance') {
      continue;
    }
    const instances = instancesByOwner.get(edge.from) ?? [];
    instances.push(instance);
    instancesByOwner.set(edge.from, instances);
  }
  const reachableComponentIds = new Set<string>();
  const pending = entryId ? [entryId] : [];
  while (pending.length > 0) {
    const id = pending.pop();
    if (!id || reachableComponentIds.has(id)) {
      continue;
    }
    if (!componentById.has(id)) {
      return invalidGraph(`The entry component references missing component "${id}".`);
    }
    reachableComponentIds.add(id);
    for (const instance of instancesByOwner.get(id) ?? []) {
      if (!reachableComponentIds.has(instance.componentId)) {
        pending.push(instance.componentId);
      }
    }
  }
  const components = allComponents.filter((component) => reachableComponentIds.has(component.id));

  const belongsToReachableComponent = (node: UiNodeV1): boolean =>
    reachableComponentIds.has(node.id) ||
    components.some((component) => node.id.startsWith(`${component.id}/`));

  const reachableContextIds = new Set(
    graph.nodes
      .filter(
        (node): node is ContextConsumerNodeV1 | ContextProviderNodeV1 =>
          belongsToReachableComponent(node) &&
          (node.kind === 'context-consumer' || node.kind === 'context-provider'),
      )
      .map((node) => node.contextId),
  );
  const contexts = allContexts.filter((context) => reachableContextIds.has(context.id));

  for (const node of graph.nodes) {
    if (!belongsToReachableComponent(node)) {
      continue;
    }
    if (
      (node.kind === 'cell' || node.kind === 'computed' || node.kind === 'context-consumer') &&
      node.type === 'unknown'
    ) {
      unsupported(`Value "${node.name}" has an unknown type and cannot be emitted safely.`);
    }
    if (node.kind === 'element') {
      if (!/^[a-z][a-z0-9]*$/u.test(node.tag)) {
        unsupported(`Only lowercase HTML elements are supported, but received <${node.tag}>.`);
      }
    }
    if (
      node.kind === 'component-parameter' &&
      node.parameterKind === 'value' &&
      node.type === 'unknown'
    ) {
      unsupported(
        `Component prop "${node.name}" has an unknown type and cannot be emitted safely.`,
      );
    }
  }

  const childrenByParent = new Map<string, ChildEdgeV1[]>();
  const eventsByElement = new Map<string, EventEdgeV1[]>();
  const propsByInstance = new Map<string, PropEdgeV1[]>();
  const spreadsByInstance = new Map<string, SpreadPropEdgeV1[]>();
  for (const edge of graph.edges) {
    if (edge.kind === 'child') {
      const children = childrenByParent.get(edge.from) ?? [];
      children.push(edge);
      childrenByParent.set(edge.from, children);
    } else if (edge.kind === 'event') {
      if (edge.event !== 'click' || edge.authoredName !== 'onClick') {
        unsupported(
          `Only onClick DOM events are supported, but received "${edge.authoredName}" (${edge.event}).`,
        );
      }
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
  for (const events of eventsByElement.values()) {
    events.sort(
      (left, right) => compareText(left.event, right.event) || compareText(left.to, right.to),
    );
  }
  for (const props of propsByInstance.values()) {
    props.sort(
      (left, right) =>
        (left.index ?? Number.MAX_SAFE_INTEGER) - (right.index ?? Number.MAX_SAFE_INTEGER) ||
        compareText(left.to, right.to) ||
        compareText(left.mode, right.mode),
    );
  }
  for (const spreads of spreadsByInstance.values()) {
    spreads.sort((left, right) => left.index - right.index);
  }

  const componentPlans = components.map((component): ComponentPlan => {
    const parameters = component.parameters.map((id) => {
      const parameter = nodesById.get(id);
      if (!parameter || parameter.kind !== 'component-parameter') {
        return invalidGraph(`Component "${component.name}" references missing parameter "${id}".`);
      }
      return parameter;
    });
    const prefix = `${component.id}/`;
    const bindings = orderBindings(
      graph.nodes.filter(
        (node): node is BindingNodeV1 => isBinding(node) && node.id.startsWith(prefix),
      ),
      nodesById,
    );
    const procedures = graph.nodes
      .filter(
        (node): node is ProcedureNodeV1 => node.kind === 'procedure' && node.id.startsWith(prefix),
      )
      .sort(compareNodes);
    const resources = graph.nodes
      .filter(
        (node): node is ResourceNodeV1 => node.kind === 'resource' && node.id.startsWith(prefix),
      )
      .sort(compareNodes);
    const effects = graph.nodes
      .filter(
        (node): node is EffectNodeV1 => node.kind === 'effect' && node.ownerId === component.id,
      )
      .sort(compareNodes);
    const componentChildren = childrenByParent.get(component.id) ?? [];
    if (componentChildren.length !== 1) {
      return unsupported(
        `Component "${component.name}" must have exactly one root view for this compiler slice.`,
      );
    }
    const rootId = componentChildren[0]?.to;
    const root = rootId ? nodesById.get(rootId) : undefined;
    if (
      !root ||
      (root.kind !== 'element' &&
        root.kind !== 'component-instance' &&
        root.kind !== 'conditional-region' &&
        root.kind !== 'context-provider' &&
        root.kind !== 'keyed-collection')
    ) {
      return invalidGraph(`Component "${component.name}" does not point to a root view.`);
    }
    return { bindings, component, effects, parameters, procedures, resources, root };
  });

  const entry = componentPlans.find((plan) => plan.component.id === entryId);
  if (!entry) {
    return invalidGraph('The entry component does not match a module component node.');
  }
  if (entry.parameters.length > 0) {
    return unsupported(`Entry component "${entry.component.name}" cannot require props.`);
  }

  return {
    childrenByParent,
    components: componentPlans,
    contexts,
    entry,
    eventsByElement,
    nodesById,
    propsByInstance,
    spreadsByInstance,
  };
};

const reservedIdentifiers = new Set([
  'appendChild',
  'addCollection',
  'batch',
  'bindText',
  'container',
  'createCell',
  'createDerived',
  'createElement',
  'createContext',
  'createRoot',
  'createDisposableReaction',
  'createText',
  'document',
  'dom',
  'listen',
  'mount',
  'readContext',
  'props',
  'removeCollection',
  'runtime',
  'sortCollection',
  'updateCollection',
  'withContext',
]);

const safeIdentifier = (value: string): string => {
  const normalized = value.replaceAll(/[^A-Za-z0-9_$]/gu, '_');
  if (/^[A-Za-z_$]/u.test(normalized)) {
    return normalized;
  }
  return `_${normalized}`;
};

class NameAllocator {
  readonly #used = new Set(reservedIdentifiers);

  allocate(requested: string): string {
    const base = safeIdentifier(requested);
    let candidate = base;
    let suffix = 2;
    while (this.#used.has(candidate)) {
      candidate = `${base}${suffix}`;
      suffix += 1;
    }
    this.#used.add(candidate);
    return candidate;
  }
}

class CodeWriter {
  readonly #lines: string[] = [];
  readonly #mappings: GeneratedMapping[] = [];
  #indent = 0;
  #source: GraphSpanV1 | undefined;

  line(value = ''): void {
    if (value.length > 0 && this.#source) {
      this.#mappings.push({
        generatedColumn: this.#indent * 2,
        generatedLine: this.#lines.length,
        source: this.#source,
      });
    }
    this.#lines.push(value.length === 0 ? '' : `${'  '.repeat(this.#indent)}${value}`);
  }

  source(value: GraphSpanV1): void {
    this.#source = value;
  }

  indented(run: () => void): void {
    this.#indent += 1;
    try {
      run();
    } finally {
      this.#indent -= 1;
    }
  }

  toString(): string {
    return this.#lines.join('\n');
  }

  mappings(): readonly GeneratedMapping[] {
    return this.#mappings;
  }
}

const literalSource = (value: LiteralValueV1): string => {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return invalidGraph(`Cannot emit non-finite numeric literal ${String(value)}.`);
  }

  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return invalidGraph(`Cannot emit an unserializable ${typeof value} literal.`);
  }
  return serialized;
};

const valueSource = (value: ConstantValueV1): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => valueSource(item)).join(', ')}]`;
  }
  if (typeof value === 'object') {
    return `{ ${Object.entries(value)
      .map(([name, item]) => `${JSON.stringify(name)}: ${valueSource(item)}`)
      .join(', ')} }`;
  }
  return literalSource(value);
};

const operatorSource = (operator: BinaryOperatorV1): string => {
  switch (operator) {
    case '%':
    case '*':
    case '+':
    case '-':
    case '/':
      return operator;
    case '!=':
      return '!==';
    case '==':
      return '===';
    case 'and':
      return '&&';
    case 'or':
      return '||';
    default:
      return unsupported(`Unknown binary operator "${operator}".`);
  }
};

const emitProgram = (plan: GenerationPlan): EmittedProgram => {
  const writer = new CodeWriter();
  const names = new NameAllocator();
  const componentNames = new Map<string, string>();
  const contextNames = new Map<string, string>();
  const bindingNames = new Map<string, string>();
  const parameterNames = new Map<string, string>();
  const procedureNames = new Map<string, string>();
  const collectionItemNames = new Map<string, string>();
  const staticTemplateNames = new Map<string, string>();
  const componentName = names.allocate(plan.entry.component.name);
  componentNames.set(plan.entry.component.id, componentName);
  for (const component of plan.components) {
    if (!componentNames.has(component.component.id)) {
      componentNames.set(component.component.id, names.allocate(component.component.name));
    }
  }
  const mountName = names.allocate(`mount${plan.entry.component.name}`);

  for (const context of plan.contexts) {
    contextNames.set(context.id, names.allocate(context.name));
  }

  const staticState = new Map<string, boolean>();
  const refsByElement = new Map(
    [...plan.nodesById.values()]
      .filter((node): node is RefNodeV1 => node.kind === 'ref')
      .map((node) => [node.elementId, node] as const),
  );
  const isStaticElement = (element: ElementNodeV1): boolean => {
    const known = staticState.get(element.id);
    if (known !== undefined) {
      return known;
    }
    const staticElement =
      (element.dynamicAttributes?.length ?? 0) === 0 &&
      (plan.eventsByElement.get(element.id)?.length ?? 0) === 0 &&
      !refsByElement.has(element.id) &&
      (plan.childrenByParent.get(element.id) ?? []).every((edge) => {
        const child = plan.nodesById.get(edge.to);
        return (
          (child?.kind === 'text' && child.parts.every((part) => part.kind === 'static')) ||
          (child?.kind === 'element' && isStaticElement(child))
        );
      });
    staticState.set(element.id, staticElement);
    return staticElement;
  };
  const staticDescriptor = (element: ElementNodeV1): unknown => ({
    tag: element.tag,
    ...(element.staticAttributes.length > 0
      ? {
          attributes: element.staticAttributes.map((attribute) => ({
            mode: ['checked', 'disabled', 'selected', 'value'].includes(attribute.name)
              ? 'property'
              : 'attribute',
            name: attribute.name,
            value: attribute.value,
          })),
        }
      : {}),
    ...((plan.childrenByParent.get(element.id)?.length ?? 0) > 0
      ? {
          children: (plan.childrenByParent.get(element.id) ?? []).map((edge) => {
            const child = plan.nodesById.get(edge.to);
            if (child?.kind === 'element') {
              return staticDescriptor(child);
            }
            if (child?.kind === 'text') {
              return child.parts.map((part) => (part.kind === 'static' ? part.value : '')).join('');
            }
            return invalidGraph(`Static template "${element.id}" contains dynamic content.`);
          }),
        }
      : {}),
  });
  const parentByChild = new Map<string, string>();
  for (const [parentId, children] of plan.childrenByParent) {
    for (const child of children) {
      parentByChild.set(child.to, parentId);
    }
  }
  const staticElements = [...plan.nodesById.values()]
    .filter((node): node is ElementNodeV1 => {
      const reachable = plan.components.some((component) =>
        node.id.startsWith(`${component.component.id}/`),
      );
      if (node.kind !== 'element' || !reachable || !isStaticElement(node)) {
        return false;
      }
      const parent = plan.nodesById.get(parentByChild.get(node.id) ?? '');
      return parent?.kind !== 'element' || !isStaticElement(parent);
    })
    .sort(compareNodes);
  for (const element of staticElements) {
    staticTemplateNames.set(element.id, names.allocate(`${element.tag}Template`));
  }

  for (const component of plan.components) {
    for (const parameter of component.parameters) {
      parameterNames.set(parameter.id, names.allocate(`${parameter.name}Parameter`));
    }
    for (const binding of component.bindings) {
      const suffix =
        binding.kind === 'cell'
          ? 'Cell'
          : binding.kind === 'computed'
            ? 'Derived'
            : binding.kind === 'context-consumer'
              ? 'ContextValue'
              : binding.kind === 'ref'
                ? 'Ref'
                : 'Constant';
      bindingNames.set(binding.id, names.allocate(`${binding.name}${suffix}`));
    }
    for (const procedure of component.procedures) {
      procedureNames.set(procedure.id, names.allocate(`${procedure.name}Handler`));
    }
  }

  const expressionSource = (
    expression: ValueExpressionV1,
    overrides: ReadonlyMap<string, string> = new Map(),
  ): string => {
    switch (expression.kind) {
      case 'array':
        return `[${expression.elements.map((element) => expressionSource(element, overrides)).join(', ')}]`;
      case 'call':
        return `${expressionSource(expression.callee, overrides)}(${expression.arguments
          .map((argument) => expressionSource(argument, overrides))
          .join(', ')})`;
      case 'capability-read': {
        const name =
          procedureNames.get(expression.targetId) ?? parameterNames.get(expression.targetId);
        if (name) {
          return name;
        }
        const target = plan.nodesById.get(expression.targetId);
        if (target?.kind === 'platform-capability') {
          return target.path.reduce(
            (source, segment) => `${source}[${JSON.stringify(segment)}]`,
            'globalThis',
          );
        }
        return invalidGraph(`Cannot emit capability "${expression.targetId}".`);
      }
      case 'collection': {
        const callbackOverrides = new Map(overrides);
        const parameterSources = expression.callback.parameters.map((parameter, index) => {
          const name = safeIdentifier(`${parameter.name || 'value'}${index || ''}`);
          callbackOverrides.set(parameter.id, name);
          return name;
        });
        const callback = `(${parameterSources.join(', ')}) => ${expressionSource(expression.callback.result, callbackOverrides)}`;
        if (expression.operation === 'sort') {
          return `sortCollection(${expressionSource(expression.source, overrides)}, ${callback}${expression.options ? `, ${expressionSource(expression.options, overrides)}` : ''})`;
        }
        return `${expressionSource(expression.source, overrides)}.${expression.operation}(${callback}${expression.initial ? `, ${expressionSource(expression.initial, overrides)}` : ''})`;
      }
      case 'literal':
        return literalSource(expression.value);
      case 'local-read': {
        const name = overrides.get(expression.targetId);
        return name ?? invalidGraph(`Cannot emit callback local "${expression.targetId}".`);
      }
      case 'member':
        return `${expressionSource(expression.object, overrides)}[${JSON.stringify(expression.property)}]`;
      case 'record':
        return `({ ${expression.entries
          .map(
            (entry) => `${JSON.stringify(entry.name)}: ${expressionSource(entry.value, overrides)}`,
          )
          .join(', ')} })`;
      case 'read': {
        const overridden = overrides.get(expression.targetId);
        if (overridden) {
          return expression.tracked === false ? `untrack(() => ${overridden})` : overridden;
        }
        const target = plan.nodesById.get(expression.targetId);
        if (!target) {
          return invalidGraph(`Cannot emit unresolved read "${expression.targetId}".`);
        }
        if (isBinding(target)) {
          const name = bindingNames.get(expression.targetId);
          if (!name) {
            return invalidGraph(`Cannot emit unresolved read "${expression.targetId}".`);
          }
          const read = target.kind === 'constant' ? name : `${name}.read()`;
          return expression.tracked === false ? `untrack(() => ${read})` : read;
        }
        if (isValueParameter(target)) {
          const name = parameterNames.get(expression.targetId);
          if (!name) {
            return invalidGraph(`Cannot emit unresolved prop read "${expression.targetId}".`);
          }
          const read = `${name}.read()`;
          return expression.tracked === false ? `untrack(() => ${read})` : read;
        }
        if (target.kind === 'collection-item') {
          const name = collectionItemNames.get(target.id);
          if (!name) {
            return invalidGraph(`Cannot emit collection item read "${target.id}".`);
          }
          const read = `${name}.read()`;
          return expression.tracked === false ? `untrack(() => ${read})` : read;
        }
        return invalidGraph(`Cannot read non-value node "${expression.targetId}".`);
      }
      case 'binary':
        return `(${expressionSource(expression.left, overrides)} ${operatorSource(expression.operator)} ${expressionSource(expression.right, overrides)})`;
      case 'conditional': {
        const fallback = expression.branches.at(-1);
        if (!fallback || fallback.condition) {
          return invalidGraph('A conditional value expression must end with a fallback branch.');
        }
        let source = expressionSource(fallback.result, overrides);
        for (let index = expression.branches.length - 2; index >= 0; index -= 1) {
          const branch = expression.branches[index];
          if (!branch?.condition) {
            return invalidGraph(
              'Only the final conditional value expression branch may omit its condition.',
            );
          }
          source = `(${expressionSource(branch.condition, overrides)} ? ${expressionSource(branch.result, overrides)} : ${source})`;
        }
        return source;
      }
    }
  };

  const dependencySource = (dependency: ExpressionRead): string | undefined => {
    const { path, targetId: id } = dependency;
    const target = plan.nodesById.get(id);
    if (!target) {
      return invalidGraph(`Cannot emit dependency "${id}" because it is missing.`);
    }

    let source: string;
    if (isValueParameter(target)) {
      source =
        parameterNames.get(id) ??
        invalidGraph(`Cannot emit dependency "${id}" because it has no generated name.`);
    } else if (target.kind === 'collection-item') {
      source =
        collectionItemNames.get(id) ??
        invalidGraph(`Cannot emit collection item dependency "${id}".`);
    } else if (!isBinding(target)) {
      return invalidGraph(`Cannot emit dependency "${id}" because it is not a value node.`);
    } else if (target.kind === 'constant') {
      return undefined;
    } else {
      source =
        bindingNames.get(id) ??
        invalidGraph(`Cannot emit dependency "${id}" because it has no generated name.`);
    }

    if (path.length === 0) {
      return source;
    }
    return `selectPath(${source}, ${JSON.stringify(path)}, { name: ${JSON.stringify(`${target.name}.${path.join('.')}`)}, traceId: ${JSON.stringify(target.id)} })`;
  };

  const reactiveDependencies = (expression: ValueExpressionV1): readonly string[] => {
    const dependencies: string[] = [];
    for (const dependency of uniqueExpressionReads(expression)) {
      const source = dependencySource(dependency);
      if (source) {
        dependencies.push(source);
      }
    }
    return dependencies;
  };

  const directReadableSource = (expression: ValueExpressionV1): string | undefined => {
    const dependency: ExpressionRead | undefined =
      expression.kind === 'read' && expression.tracked !== false
        ? { path: [], targetId: expression.targetId }
        : expression.kind === 'member'
          ? memberRead(expression)
          : undefined;
    if (!dependency) {
      return undefined;
    }
    return dependencySource(dependency);
  };

  const emitComponent = (component: ComponentPlan): void => {
    const generatedComponentName =
      componentNames.get(component.component.id) ??
      invalidGraph(`Component "${component.component.id}" has no generated name.`);
    writer.source(component.component.span);
    writer.line(
      '/** Builds this component inside an active OXE owner. Prefer the mount helper at an application boundary. */',
    );
    writer.line(
      `const ${generatedComponentName} = (document${component.parameters.length > 0 ? ', props' : ''}) => {`,
    );
    writer.indented(() => {
      for (const parameter of component.parameters) {
        writer.source(parameter.span);
        const name =
          parameterNames.get(parameter.id) ??
          invalidGraph(`Parameter "${parameter.id}" has no generated name.`);
        if (parameter.parameterKind === 'value' && parameter.default) {
          const dependencies = reactiveDependencies(parameter.default);
          writer.line(
            `const ${name} = props[${JSON.stringify(parameter.name)}] ?? createDerived([${dependencies.join(', ')}], () => ${expressionSource(parameter.default)}, { name: ${JSON.stringify(`${component.component.name}.${parameter.name} default`)}, traceId: ${JSON.stringify(parameter.id)} });`,
          );
        } else {
          writer.line(`const ${name} = props[${JSON.stringify(parameter.name)}];`);
        }
      }
      if (component.parameters.length > 0 && component.bindings.length > 0) {
        writer.line();
      }
      for (const binding of component.bindings) {
        writer.source(binding.span);
        const name = bindingNames.get(binding.id);
        if (!name) {
          invalidGraph(`Value "${binding.id}" has no generated name.`);
        }
        switch (binding.kind) {
          case 'constant':
            writer.line(`const ${name} = ${valueSource(binding.value)};`);
            break;
          case 'cell':
            writer.line(
              `const ${name} = createCell(${expressionSource(binding.initial)}, { name: ${JSON.stringify(`${component.component.name}.${binding.name}`)}, traceId: ${JSON.stringify(binding.id)} });`,
            );
            break;
          case 'computed': {
            const dependencies = reactiveDependencies(binding.expression);
            writer.line(
              `const ${name} = createDerived([${dependencies.join(', ')}], () => ${expressionSource(binding.expression)}, { name: ${JSON.stringify(`${component.component.name}.${binding.name}`)}, traceId: ${JSON.stringify(binding.id)} });`,
            );
            break;
          }
          case 'context-consumer': {
            const contextName =
              contextNames.get(binding.contextId) ??
              invalidGraph(`Context value "${binding.id}" references a missing context.`);
            writer.line(`const ${name} = readContext(${contextName});`);
            break;
          }
          case 'ref':
            writer.line(
              `const ${name} = createCell(undefined, { name: ${JSON.stringify(`${component.component.name}.${binding.name} ref`)}, traceId: ${JSON.stringify(binding.id)} });`,
            );
            break;
        }
      }

      if (component.bindings.length > 0 && component.procedures.length > 0) {
        writer.line();
      }
      for (const [index, procedure] of component.procedures.entries()) {
        writer.source(procedure.span);
        const name = procedureNames.get(procedure.id);
        if (!name) {
          invalidGraph(`Procedure "${procedure.id}" has no generated name.`);
        }
        const procedureOverrides = new Map<string, string>();
        const parameterSources = procedure.parameters.map((parameter, parameterIndex) => {
          const parameterSource = names.allocate(
            `${procedure.name}${parameter.name || `Argument${parameterIndex}`}`,
          );
          procedureOverrides.set(parameter.name, parameterSource);
          return parameterSource;
        });
        writer.line(`const ${name} = (${parameterSources.join(', ')}) =>`);
        writer.indented(() => {
          writer.line('batch(() => {');
          writer.indented(() => {
            for (const step of procedure.steps) {
              writer.source(step.span);
              if (step.kind === 'call') {
                writer.line(`${expressionSource(step.expression, procedureOverrides)};`);
                continue;
              }
              const target = plan.nodesById.get(step.targetId);
              const targetName = bindingNames.get(step.targetId);
              if (
                !target ||
                (target.kind !== 'cell' && target.kind !== 'context-consumer') ||
                !targetName
              ) {
                invalidGraph(`Procedure "${procedure.name}" writes an invalid writable value.`);
              }
              if (step.kind === 'collection-mutation' && target?.kind !== 'cell') {
                invalidGraph(`Collection mutation in "${procedure.name}" requires a local cell.`);
              }
              if (step.kind === 'collection-mutation') {
                const callbackSource = (callback: NonNullable<typeof step.predicate>): string => {
                  const callbackOverrides = new Map(procedureOverrides);
                  const parameterSources = callback.parameters.map((parameter, parameterIndex) => {
                    const parameterSource = safeIdentifier(
                      `${parameter.name || 'value'}${parameterIndex || ''}`,
                    );
                    callbackOverrides.set(parameter.id, parameterSource);
                    return parameterSource;
                  });
                  return `(${parameterSources.join(', ')}) => ${expressionSource(callback.result, callbackOverrides)}`;
                };
                if (step.operation === 'add' && step.value) {
                  writer.line(
                    `${targetName}.write(addCollection(${targetName}.read(), ${expressionSource(step.value, procedureOverrides)}));`,
                  );
                } else if (step.operation === 'remove' && step.predicate) {
                  writer.line(
                    `${targetName}.write(removeCollection(${targetName}.read(), ${callbackSource(step.predicate)}${step.limit ? `, ${expressionSource(step.limit, procedureOverrides)}` : ''}));`,
                  );
                } else if (step.operation === 'update' && step.predicate && step.updater) {
                  writer.line(
                    `${targetName}.write(updateCollection(${targetName}.read(), ${callbackSource(step.predicate)}, ${callbackSource(step.updater)}${step.limit ? `, ${expressionSource(step.limit, procedureOverrides)}` : ''}));`,
                  );
                } else {
                  invalidGraph(`Procedure "${procedure.name}" has an invalid collection mutation.`);
                }
                continue;
              }
              writer.line(
                step.path
                  ? `${targetName}.writePath(${JSON.stringify(step.path)}, ${expressionSource(step.value, procedureOverrides)});`
                  : `${targetName}.write(${expressionSource(step.value, procedureOverrides)});`,
              );
            }
          });
          writer.line('});');
        });
        if (index < component.procedures.length - 1) {
          writer.line();
        }
      }
      if (component.procedures.length > 0) {
        writer.line();
      }

      const emitText = (text: TextNodeV1): readonly string[] => {
        writer.source(text.span);
        if (text.parts.length === 0) {
          return unsupported(`Text node "${text.id}" has no parts.`);
        }

        const emitted: string[] = [];
        for (const part of text.parts) {
          const textName = names.allocate('textNode');
          emitted.push(textName);

          if (part.kind === 'static') {
            writer.line(`const ${textName} = createText(document, ${JSON.stringify(part.value)});`);
            continue;
          }

          const dependencies = reactiveDependencies(part.expression);
          if (dependencies.length === 0) {
            writer.line(
              `const ${textName} = createText(document, ${expressionSource(part.expression)});`,
            );
            continue;
          }

          let readableName: string;
          const direct = directReadableSource(part.expression);
          if (direct) {
            readableName = direct;
          } else {
            readableName = names.allocate(`${textName}Derived`);
            writer.line(
              `const ${readableName} = createDerived([${dependencies.join(', ')}], () => ${expressionSource(part.expression)}, { name: ${JSON.stringify(`${component.component.name}.text`)}, traceId: ${JSON.stringify(text.id)} });`,
            );
          }
          writer.line(`const ${textName} = createText(document);`);
          writer.line(`bindText(${textName}, ${readableName});`);
        }
        return emitted;
      };

      const emitInstance = (instance: ComponentInstanceNodeV1): string => {
        writer.source(instance.span);
        const target = plan.components.find(
          (candidate) => candidate.component.id === instance.componentId,
        );
        if (!target) {
          return invalidGraph(`Component instance "${instance.id}" has no target plan.`);
        }
        const targetName =
          componentNames.get(target.component.id) ??
          invalidGraph(`Component "${target.component.id}" has no generated name.`);
        const props = plan.propsByInstance.get(instance.id) ?? [];
        const spreads = plan.spreadsByInstance.get(instance.id) ?? [];
        const entries: string[] = [];

        const sourceForProp = (prop: PropEdgeV1, authoredName: string): string => {
          if (prop.mode === 'procedure') {
            return (
              procedureNames.get(prop.targetId) ??
              parameterNames.get(prop.targetId) ??
              invalidGraph(`Component instance "${instance.id}" has an unresolved procedure prop.`)
            );
          }
          const direct = directReadableSource(prop.value);
          if (direct) {
            return direct;
          }
          const source = names.allocate(`${target.component.name}${authoredName}Prop`);
          const dependencies = reactiveDependencies(prop.value);
          writer.line(
            `const ${source} = createDerived([${dependencies.join(', ')}], () => ${expressionSource(prop.value)}, { name: ${JSON.stringify(`${component.component.name}.${target.component.name}.${authoredName} prop`)}, traceId: ${JSON.stringify(instance.id)} });`,
          );
          return source;
        };

        for (const parameter of target.parameters) {
          if (parameter.parameterKind === 'children') {
            const content: string[] = [];
            for (const childEdge of plan.childrenByParent.get(instance.id) ?? []) {
              const child = plan.nodesById.get(childEdge.to);
              if (!child) {
                return invalidGraph(
                  `Component content for "${instance.id}" references a missing child.`,
                );
              }
              if (child.kind === 'element') {
                content.push(emitElement(child));
              } else if (child.kind === 'component-instance') {
                content.push(emitInstance(child));
              } else if (child.kind === 'text') {
                content.push(...emitText(child));
              } else if (child.kind === 'content-slot') {
                const source =
                  parameterNames.get(child.parameterId) ??
                  invalidGraph(`Content slot "${child.id}" has no generated parameter.`);
                content.push(`...${source}`);
              } else if (child.kind === 'conditional-region') {
                content.push(`...${emitConditional(child)}`);
              } else if (child.kind === 'content-reference') {
                content.push(`...${emitContentReference(child)}`);
              } else if (child.kind === 'keyed-collection') {
                content.push(`...${emitCollection(child)}`);
              } else if (child.kind === 'context-provider') {
                content.push(`...${emitContextProvider(child)}`);
              } else {
                return unsupported(`Component content cannot contain a ${child.kind} node.`);
              }
            }
            entries.push(`${JSON.stringify(parameter.name)}: [${content.join(', ')}]`);
            continue;
          }

          if (parameter.parameterKind === 'rest') {
            const restEntries: string[] = [];
            const authored = [
              ...props.filter((prop) => prop.to === parameter.id),
              ...spreads.filter((spread) => spread.to === parameter.id),
            ].sort(
              (left, right) =>
                (left.index ?? Number.MAX_SAFE_INTEGER) - (right.index ?? Number.MAX_SAFE_INTEGER),
            );
            for (const item of authored) {
              if (item.kind === 'spread-prop') {
                if (item.source.kind !== 'rest') {
                  return unsupported('Record-valued prop spreads are not supported yet.');
                }
                const restName =
                  parameterNames.get(item.source.targetId) ??
                  invalidGraph(`Prop spread on "${instance.id}" has no rest source.`);
                restEntries.push(`...${restName}`);
              } else {
                const authoredName =
                  item.authoredName ??
                  invalidGraph(`Rest prop on "${instance.id}" has no authored name.`);
                restEntries.push(
                  `${JSON.stringify(authoredName)}: ${sourceForProp(item, authoredName)}`,
                );
              }
            }
            entries.push(`${JSON.stringify(parameter.name)}: { ${restEntries.join(', ')} }`);
            continue;
          }

          const prop = props.find((candidate) => candidate.to === parameter.id);
          if (!prop) {
            if (parameter.parameterKind === 'value' && parameter.default) {
              continue;
            }
            return invalidGraph(
              `Component instance "${instance.id}" is missing prop "${parameter.name}".`,
            );
          }
          entries.push(`${JSON.stringify(parameter.name)}: ${sourceForProp(prop, parameter.name)}`);
        }
        const rootName = names.allocate(`${target.component.name}Root`);
        writer.line(
          `const ${rootName} = createRoot(() => ${targetName}(document, { ${entries.join(', ')} }), { name: ${JSON.stringify(`${target.component.name} component`)} });`,
        );
        return `${rootName}.value`;
      };

      const emitElement = (element: ElementNodeV1): string => {
        writer.source(element.span);
        const elementName = names.allocate(`${element.tag}Element`);
        const staticTemplate = staticTemplateNames.get(element.id);
        if (staticTemplate) {
          writer.line(`const ${elementName} = ${staticTemplate}(document);`);
          const ref = refsByElement.get(element.id);
          if (ref) {
            const refName =
              bindingNames.get(ref.id) ?? invalidGraph(`Ref "${ref.id}" has no generated name.`);
            writer.line(`${refName}.write(${elementName});`);
          }
          return elementName;
        }
        writer.line(
          `const ${elementName} = createElement(document, ${JSON.stringify(element.tag)});`,
        );
        const ref = refsByElement.get(element.id);
        if (ref) {
          const refName =
            bindingNames.get(ref.id) ?? invalidGraph(`Ref "${ref.id}" has no generated name.`);
          writer.line(`${refName}.write(${elementName});`);
        }

        const attributeMode = (name: string): 'attribute' | 'property' =>
          ['checked', 'disabled', 'selected', 'value'].includes(name) ? 'property' : 'attribute';
        for (const attribute of element.staticAttributes) {
          writer.line(
            `setDomValue(${elementName}, ${JSON.stringify(attribute.name)}, ${JSON.stringify(attributeMode(attribute.name))}, ${valueSource(attribute.value)});`,
          );
        }
        for (const attribute of element.dynamicAttributes ?? []) {
          const direct = directReadableSource(attribute.value);
          const readable = direct ?? names.allocate(`${attribute.name}Attribute`);
          if (!direct) {
            const dependencies = reactiveDependencies(attribute.value);
            writer.line(
              `const ${readable} = createDerived([${dependencies.join(', ')}], () => ${expressionSource(attribute.value)}, { name: ${JSON.stringify(`${component.component.name}.${attribute.name} attribute`)}, traceId: ${JSON.stringify(element.id)} });`,
            );
          }
          writer.line(
            `bindDomValue(${elementName}, ${JSON.stringify(attribute.name)}, ${JSON.stringify(attribute.mode)}, ${readable});`,
          );
        }

        for (const event of plan.eventsByElement.get(element.id) ?? []) {
          const procedureName = procedureNames.get(event.to) ?? parameterNames.get(event.to);
          if (!procedureName) {
            invalidGraph(`Element "${element.id}" references an unknown procedure.`);
          }
          writer.line(`listen(${elementName}, ${JSON.stringify(event.event)}, ${procedureName});`);
        }

        for (const childEdge of plan.childrenByParent.get(element.id) ?? []) {
          const child = plan.nodesById.get(childEdge.to);
          if (!child) {
            return invalidGraph(
              `Element "${element.id}" references missing child "${childEdge.to}".`,
            );
          }
          if (child.kind === 'content-slot') {
            const content =
              parameterNames.get(child.parameterId) ??
              invalidGraph(`Content slot "${child.id}" has no generated parameter.`);
            const contentNode = names.allocate('contentNode');
            writer.line(`for (const ${contentNode} of ${content}) {`);
            writer.indented(() => {
              writer.line(`appendChild(${elementName}, ${contentNode});`);
            });
            writer.line('}');
            continue;
          }
          if (child.kind === 'conditional-region') {
            const region = emitConditional(child);
            const regionNode = names.allocate('regionNode');
            writer.line(`for (const ${regionNode} of ${region}) {`);
            writer.indented(() => {
              writer.line(`appendChild(${elementName}, ${regionNode});`);
            });
            writer.line('}');
            continue;
          }
          if (child.kind === 'content-reference') {
            const region = emitContentReference(child);
            const regionNode = names.allocate('contentNode');
            writer.line(`for (const ${regionNode} of ${region}) {`);
            writer.indented(() => {
              writer.line(`appendChild(${elementName}, ${regionNode});`);
            });
            writer.line('}');
            continue;
          }
          if (child.kind === 'keyed-collection') {
            const region = emitCollection(child);
            const regionNode = names.allocate('regionNode');
            writer.line(`for (const ${regionNode} of ${region}) {`);
            writer.indented(() => {
              writer.line(`appendChild(${elementName}, ${regionNode});`);
            });
            writer.line('}');
            continue;
          }
          if (child.kind === 'context-provider') {
            const region = emitContextProvider(child);
            const regionNode = names.allocate('contextNode');
            writer.line(`for (const ${regionNode} of ${region}) {`);
            writer.indented(() => {
              writer.line(`appendChild(${elementName}, ${regionNode});`);
            });
            writer.line('}');
            continue;
          }
          const childNames =
            child.kind === 'element'
              ? [emitElement(child)]
              : child.kind === 'component-instance'
                ? [emitInstance(child)]
                : child.kind === 'text'
                  ? emitText(child)
                  : unsupported(`Element children cannot contain a ${child.kind} node.`);
          for (const childName of childNames) {
            writer.line(`appendChild(${elementName}, ${childName});`);
          }
        }
        return elementName;
      };

      function emitContextProvider(provider: ContextProviderNodeV1): string {
        writer.source(provider.span);
        const contextName =
          contextNames.get(provider.contextId) ??
          invalidGraph(`Context provider "${provider.id}" references a missing context.`);
        const direct = directReadableSource(provider.value);
        const sourceName = direct ?? names.allocate('contextValue');
        if (!direct) {
          const dependencies = reactiveDependencies(provider.value);
          writer.line(
            `const ${sourceName} = createDerived([${dependencies.join(', ')}], () => ${expressionSource(provider.value)}, { name: ${JSON.stringify(`${component.component.name}.context value`)}, traceId: ${JSON.stringify(provider.id)} });`,
          );
        }
        const regionName = names.allocate('contextRegion');
        writer.line(`const ${regionName} = withContext(${contextName}, ${sourceName}, () => {`);
        writer.indented(() => {
          const content: string[] = [];
          for (const childEdge of plan.childrenByParent.get(provider.id) ?? []) {
            const child =
              plan.nodesById.get(childEdge.to) ??
              invalidGraph(`Context provider "${provider.id}" references a missing child.`);
            if (child.kind === 'element') {
              content.push(emitElement(child));
            } else if (child.kind === 'component-instance') {
              content.push(emitInstance(child));
            } else if (child.kind === 'text') {
              content.push(...emitText(child));
            } else if (child.kind === 'conditional-region') {
              content.push(`...${emitConditional(child)}`);
            } else if (child.kind === 'content-reference') {
              content.push(`...${emitContentReference(child)}`);
            } else if (child.kind === 'keyed-collection') {
              content.push(`...${emitCollection(child)}`);
            } else if (child.kind === 'context-provider') {
              content.push(`...${emitContextProvider(child)}`);
            } else if (child.kind === 'content-slot') {
              const slot =
                parameterNames.get(child.parameterId) ??
                invalidGraph(`Content slot "${child.id}" has no generated parameter.`);
              content.push(`...${slot}`);
            } else {
              unsupported(`Context content cannot contain a ${child.kind} node.`);
            }
          }
          writer.line(`return [${content.join(', ')}];`);
        });
        writer.line('});');
        return regionName;
      }

      const emitOwnedEffects = (effectIds: readonly string[]): void => {
        for (const effectId of effectIds) {
          const candidate = plan.nodesById.get(effectId);
          const effect =
            candidate?.kind === 'effect'
              ? candidate
              : invalidGraph(`Owned effect "${effectId}" is missing.`);
          const dependencies = reactiveDependencies(effect.expression);
          writer.line(
            `createReaction([${dependencies.join(', ')}], () => { ${expressionSource(effect.expression)}; }, { name: ${JSON.stringify(`${component.component.name}.branch effect`)}, traceId: ${JSON.stringify(effect.id)} });`,
          );
        }
      };

      function emitConditional(conditional: ConditionalRegionNodeV1): string {
        writer.source(conditional.span);
        const branchEdges = plan.childrenByParent.get(conditional.id) ?? [];
        if (branchEdges.length !== conditional.branches.length) {
          return invalidGraph(
            `Conditional region "${conditional.id}" has mismatched branches and children.`,
          );
        }
        const conditions = conditional.branches.flatMap((branch) =>
          branch.condition ? [branch.condition] : [],
        );
        const dependencies = [
          ...new Set(conditions.flatMap((condition) => reactiveDependencies(condition))),
        ];
        const selectionName = names.allocate('conditionalSelection');
        const selectionSource = conditional.branches.reduceRight(
          (fallback, branch, index) =>
            branch.condition
              ? `(${expressionSource(branch.condition)} ? ${index} : ${fallback})`
              : String(index),
          '-1',
        );
        writer.line(
          `const ${selectionName} = createDerived([${dependencies.join(', ')}], () => ${selectionSource}, { name: ${JSON.stringify(`${component.component.name}.conditional selection`)}, traceId: ${JSON.stringify(conditional.id)} });`,
        );
        const regionName = names.allocate('conditionalRegion');
        const branchName = names.allocate('branch');
        writer.line(
          `const ${regionName} = createConditionalRegion(document, ${selectionName}, (${branchName}) => {`,
        );
        writer.indented(() => {
          writer.line(`switch (${branchName}) {`);
          writer.indented(() => {
            for (const [index, edge] of branchEdges.entries()) {
              const branchRoot = plan.nodesById.get(edge.to);
              if (
                !branchRoot ||
                (branchRoot.kind !== 'element' &&
                  branchRoot.kind !== 'component-instance' &&
                  branchRoot.kind !== 'context-provider')
              ) {
                return invalidGraph(
                  `Conditional branch "${edge.to}" must produce an element or component.`,
                );
              }
              writer.line(`case ${index}: {`);
              writer.indented(() => {
                emitOwnedEffects(conditional.branches[index]?.effectIds ?? []);
                const result =
                  branchRoot.kind === 'element'
                    ? emitElement(branchRoot)
                    : branchRoot.kind === 'component-instance'
                      ? emitInstance(branchRoot)
                      : emitContextProvider(branchRoot);
                writer.line(`return ${result};`);
              });
              writer.line('}');
            }
            writer.line('default:');
            writer.indented(() => writer.line('return [];'));
          });
          writer.line('}');
        });
        writer.line(
          `}, { name: ${JSON.stringify(`${component.component.name}.conditional region`)} });`,
        );
        return regionName;
      }

      function emitContentReference(reference: ContentReferenceNodeV1): string {
        writer.source(reference.span);
        const content = plan.nodesById.get(reference.contentId);
        if (!content || content.kind !== 'content-value') {
          return invalidGraph(`Content reference "${reference.id}" has no content definition.`);
        }
        return emitContentValue(content);
      }

      function emitContentValue(content: ContentValueNodeV1): string {
        writer.source(content.span);
        const conditions = content.branches.flatMap((branch) =>
          branch.condition ? [branch.condition] : [],
        );
        const dependencies = [
          ...new Set(conditions.flatMap((condition) => reactiveDependencies(condition))),
        ];
        const selectionName = names.allocate(`${content.name}Selection`);
        const selectionSource = content.branches.reduceRight(
          (fallback, branch, index) =>
            branch.condition
              ? `(${expressionSource(branch.condition)} ? ${index} : ${fallback})`
              : String(index),
          '-1',
        );
        writer.line(
          `const ${selectionName} = createDerived([${dependencies.join(', ')}], () => ${selectionSource}, { name: ${JSON.stringify(`${component.component.name}.${content.name} selection`)}, traceId: ${JSON.stringify(content.id)} });`,
        );
        const regionName = names.allocate(`${content.name}Content`);
        const branchName = names.allocate('contentBranch');
        writer.line(
          `const ${regionName} = createConditionalRegion(document, ${selectionName}, (${branchName}) => {`,
        );
        writer.indented(() => {
          writer.line(`switch (${branchName}) {`);
          writer.indented(() => {
            content.branches.forEach((branch, index) => {
              const candidate = plan.nodesById.get(branch.resultId);
              const result =
                candidate?.kind === 'element' ||
                candidate?.kind === 'component-instance' ||
                candidate?.kind === 'context-provider'
                  ? candidate
                  : invalidGraph(`Content branch "${branch.resultId}" has no renderable result.`);
              writer.line(`case ${index}: {`);
              writer.indented(() => {
                emitOwnedEffects(branch.effectIds);
                const emitted =
                  result.kind === 'element'
                    ? emitElement(result)
                    : result.kind === 'component-instance'
                      ? emitInstance(result)
                      : emitContextProvider(result);
                writer.line(`return ${emitted};`);
              });
              writer.line('}');
            });
            writer.line('default:');
            writer.indented(() => writer.line('return [];'));
          });
          writer.line('}');
        });
        writer.line(
          `}, { name: ${JSON.stringify(`${component.component.name}.${content.name} content`)} });`,
        );
        return regionName;
      }

      function emitCollection(collection: KeyedCollectionNodeV1): string {
        writer.source(collection.span);
        const rowEdges = plan.childrenByParent.get(collection.id) ?? [];
        if (rowEdges.length !== 1) {
          return invalidGraph(`Keyed collection "${collection.id}" must have one row template.`);
        }
        const row = rowEdges[0] ? plan.nodesById.get(rowEdges[0].to) : undefined;
        if (!row || (row.kind !== 'element' && row.kind !== 'component-instance')) {
          return invalidGraph(`Keyed collection "${collection.id}" has an invalid row template.`);
        }
        const item = plan.nodesById.get(collection.itemId);
        if (!item || item.kind !== 'collection-item') {
          return invalidGraph(`Keyed collection "${collection.id}" has no item value.`);
        }
        const direct = directReadableSource(collection.source);
        const sourceName = direct ?? names.allocate('collectionSource');
        if (!direct) {
          const dependencies = reactiveDependencies(collection.source);
          writer.line(
            `const ${sourceName} = createDerived([${dependencies.join(', ')}], () => ${expressionSource(collection.source)}, { name: ${JSON.stringify(`${component.component.name}.map source`)}, traceId: ${JSON.stringify(collection.id)} });`,
          );
        }

        const itemName = names.allocate(`${item.name}Item`);
        collectionItemNames.set(item.id, itemName);
        const keyValueName = names.allocate(`${item.name}KeyValue`);
        const keySource = expressionSource(collection.key, new Map([[item.id, keyValueName]]));
        const regionName = names.allocate('keyedRegion');
        writer.line(`const ${regionName} = createKeyedRegion(document, ${sourceName}, {`);
        writer.indented(() => {
          writer.line(`key: (${keyValueName}) => ${keySource},`);
          writer.line(`name: ${JSON.stringify(`${component.component.name}.keyed map`)},`);
          writer.line(`render: (${itemName}) => {`);
          writer.indented(() => {
            const result = row.kind === 'element' ? emitElement(row) : emitInstance(row);
            writer.line(`return ${result};`);
          });
          writer.line('},');
        });
        writer.line('});');
        return regionName;
      }

      const rootName =
        component.root.kind === 'element'
          ? emitElement(component.root)
          : component.root.kind === 'component-instance'
            ? emitInstance(component.root)
            : component.root.kind === 'conditional-region'
              ? emitConditional(component.root)
              : component.root.kind === 'context-provider'
                ? emitContextProvider(component.root)
                : emitCollection(component.root);
      for (const resource of component.resources) {
        writer.source(resource.span);
        const dependencies = reactiveDependencies(resource.expression);
        writer.line(
          `createDisposableReaction([${dependencies.join(', ')}], () => ${expressionSource(resource.expression)}, { name: ${JSON.stringify(`${component.component.name}.${resource.name}`)}, traceId: ${JSON.stringify(resource.id)} });`,
        );
      }
      for (const effect of component.effects) {
        writer.source(effect.span);
        const dependencies = reactiveDependencies(effect.expression);
        writer.line(
          `createReaction([${dependencies.join(', ')}], () => { ${expressionSource(effect.expression)}; }, { name: ${JSON.stringify(`${component.component.name}.effect`)}, traceId: ${JSON.stringify(effect.id)} });`,
        );
      }
      writer.line();
      writer.source(component.component.span);
      writer.line(`return ${rootName};`);
    });
    writer.line('};');
  };

  for (const element of staticElements) {
    const name =
      staticTemplateNames.get(element.id) ??
      invalidGraph(`Static element "${element.id}" has no template name.`);
    writer.source(element.span);
    writer.line(
      `const ${name} = createStaticTemplate(${JSON.stringify(staticDescriptor(element))});`,
    );
  }
  if (staticElements.length > 0) {
    writer.line();
  }

  for (const [index, context] of plan.contexts.entries()) {
    const name =
      contextNames.get(context.id) ??
      invalidGraph(`Context "${context.id}" has no generated name.`);
    writer.source(context.span);
    writer.line(`const ${name} = createContext(${JSON.stringify(context.name)});`);
    if (index === plan.contexts.length - 1) {
      writer.line();
    }
  }

  for (const [index, component] of plan.components.entries()) {
    emitComponent(component);
    if (index < plan.components.length - 1) {
      writer.line();
    }
  }

  if (plan.components.length > 0) {
    writer.line();
  }
  writer.source(plan.entry.component.span);
  writer.line(`const ${mountName} = (container) => {`);
  writer.indented(() => {
    writer.line('const document = container.ownerDocument;');
    writer.line('if (!document) {');
    writer.indented(() => {
      writer.line(
        `throw new Error(${JSON.stringify(`Cannot mount ${plan.entry.component.name}: the container has no ownerDocument.`)});`,
      );
    });
    writer.line('}');
    writer.line(`return mount(container, () => ${componentName}(document));`);
  });
  writer.line('};');

  return {
    componentName,
    mappings: writer.mappings(),
    mountName,
    source: writer.toString(),
  };
};

const base64Digits = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const encodeVlq = (value: number): string => {
  let remaining = value < 0 ? (-value << 1) | 1 : value << 1;
  let result = '';
  do {
    let digit = remaining & 31;
    remaining >>>= 5;
    if (remaining > 0) {
      digit |= 32;
    }
    result += base64Digits[digit] ?? '';
  } while (remaining > 0);
  return result;
};

const buildSourceMap = (
  program: EmittedProgram,
  file: string,
  lineOffset: number,
  columnOffset: number,
): DomSourceMapV3 => {
  const sources = [...new Set(program.mappings.map((mapping) => mapping.source.fileName))].sort(
    compareText,
  );
  const sourceIndexes = new Map(sources.map((source, index) => [source, index]));
  const mappings = program.mappings.map((mapping) => ({
    ...mapping,
    generatedColumn: mapping.generatedColumn + columnOffset,
    generatedLine: mapping.generatedLine + lineOffset,
  }));
  const finalLine = mappings.at(-1)?.generatedLine ?? 0;
  const lines: string[] = [];
  let mappingIndex = 0;
  let previousSource = 0;
  let previousOriginalLine = 0;
  let previousOriginalColumn = 0;
  for (let line = 0; line <= finalLine; line += 1) {
    const segments: string[] = [];
    let previousGeneratedColumn = 0;
    while (mappings[mappingIndex]?.generatedLine === line) {
      const mapping = mappings[mappingIndex];
      if (!mapping) {
        break;
      }
      const sourceIndex = sourceIndexes.get(mapping.source.fileName) ?? 0;
      const originalLine = mapping.source.start.line - 1;
      const originalColumn = mapping.source.start.column - 1;
      segments.push(
        encodeVlq(mapping.generatedColumn - previousGeneratedColumn) +
          encodeVlq(sourceIndex - previousSource) +
          encodeVlq(originalLine - previousOriginalLine) +
          encodeVlq(originalColumn - previousOriginalColumn),
      );
      previousGeneratedColumn = mapping.generatedColumn;
      previousSource = sourceIndex;
      previousOriginalLine = originalLine;
      previousOriginalColumn = originalColumn;
      mappingIndex += 1;
    }
    lines.push(segments.join(','));
  }
  return Object.freeze({
    file,
    mappings: lines.join(';'),
    names: Object.freeze([]),
    sources: Object.freeze(sources),
    version: 3,
  });
};

const emitFactorySource = (program: EmittedProgram): string => {
  const writer = new CodeWriter();
  const runtimeBindings = [
    ...(program.source.includes('addCollection(') ? ['addCollection'] : []),
    'batch',
    'createCell',
    ...(program.source.includes('createContext(') ? ['createContext'] : []),
    'createDerived',
    ...(program.source.includes('createDisposableReaction(') ? ['createDisposableReaction'] : []),
    'createReaction',
    'createRoot',
    ...(program.source.includes('removeCollection(') ? ['removeCollection'] : []),
    ...(program.source.includes('readContext(') ? ['readContext'] : []),
    ...(program.source.includes('selectPath(') ? ['selectPath'] : []),
    ...(program.source.includes('sortCollection(') ? ['sortCollection'] : []),
    'untrack',
    ...(program.source.includes('updateCollection(') ? ['updateCollection'] : []),
    ...(program.source.includes('withContext(') ? ['withContext'] : []),
  ].join(', ');
  const domBindings = [
    'appendChild',
    'bindDomValue',
    'bindText',
    'createConditionalRegion',
    'createElement',
    'createKeyedRegion',
    ...(program.source.includes('createStaticTemplate(') ? ['createStaticTemplate'] : []),
    'createText',
    'listen',
    'mount',
    'setDomValue',
  ].join(', ');
  writer.line('(runtime, dom) => {');
  writer.indented(() => {
    writer.line(`const { ${runtimeBindings} } = runtime;`);
    writer.line(`const { ${domBindings} } = dom;`);
    writer.line();
    for (const line of program.source.split('\n')) {
      writer.line(line);
    }
    writer.line();
    writer.line(`return { ${program.componentName}, ${program.mountName} };`);
  });
  writer.line('}');
  return `${writer.toString()}\n`;
};

const emitModuleSource = (program: EmittedProgram): string => {
  const writer = new CodeWriter();
  const runtimeBindings = [
    ...(program.source.includes('addCollection(') ? ['addCollection'] : []),
    'batch',
    'createCell',
    ...(program.source.includes('createContext(') ? ['createContext'] : []),
    'createDerived',
    ...(program.source.includes('createDisposableReaction(') ? ['createDisposableReaction'] : []),
    'createReaction',
    'createRoot',
    ...(program.source.includes('removeCollection(') ? ['removeCollection'] : []),
    ...(program.source.includes('readContext(') ? ['readContext'] : []),
    ...(program.source.includes('selectPath(') ? ['selectPath'] : []),
    ...(program.source.includes('sortCollection(') ? ['sortCollection'] : []),
    'untrack',
    ...(program.source.includes('updateCollection(') ? ['updateCollection'] : []),
    ...(program.source.includes('withContext(') ? ['withContext'] : []),
  ].join(', ');
  const domBindings = [
    'appendChild',
    'bindDomValue',
    'bindText',
    'createConditionalRegion',
    'createElement',
    'createKeyedRegion',
    ...(program.source.includes('createStaticTemplate(') ? ['createStaticTemplate'] : []),
    'createText',
    'listen',
    'mount',
    'setDomValue',
  ].join(', ');
  writer.line(`import { ${runtimeBindings} } from '@oxe/runtime';`);
  writer.line(`import { ${domBindings} } from '@oxe/runtime-dom';`);
  writer.line();
  for (const line of program.source.split('\n')) {
    writer.line(line);
  }
  writer.line();
  writer.line(`export { ${program.componentName}, ${program.mountName} };`);
  return `${writer.toString()}\n`;
};

export const generateDomArtifact = (graph: UiGraphV1): DomCodeArtifact => {
  const program = emitProgram(buildPlan(graph));
  return {
    componentExport: program.componentName,
    factorySource: emitFactorySource(program),
    factorySourceMap: buildSourceMap(program, `${program.componentName}.factory.js`, 4, 2),
    moduleSource: emitModuleSource(program),
    moduleSourceMap: buildSourceMap(program, `${program.componentName}.js`, 3, 0),
    mountExport: program.mountName,
  };
};

export const generateDomFactorySource = (graph: UiGraphV1): string =>
  generateDomArtifact(graph).factorySource;

export const generateDomModuleSource = (graph: UiGraphV1): string =>
  generateDomArtifact(graph).moduleSource;
