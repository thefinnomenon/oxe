import {
  validateUiGraph,
  type BinaryOperatorV1,
  type CellNodeV1,
  type ComponentInstanceNodeV1,
  type ComponentNodeV1,
  type ComponentParameterNodeV1,
  type ConditionalRegionNodeV1,
  type ComputedNodeV1,
  type ConstantNodeV1,
  type ElementNodeV1,
  type KeyedCollectionNodeV1,
  type LiteralValueV1,
  type ProcedureNodeV1,
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
  readonly moduleSource: string;
  readonly mountExport: string;
}

export class OxeCodegenError extends Error {
  public readonly code: CodegenErrorCode;

  public constructor(code: CodegenErrorCode, message: string) {
    super(message);
    this.name = 'OxeCodegenError';
    this.code = code;
  }
}

type BindingNodeV1 = CellNodeV1 | ComputedNodeV1 | ConstantNodeV1;
type ChildEdgeV1 = Extract<UiEdgeV1, { readonly kind: 'child' }>;
type EventEdgeV1 = Extract<UiEdgeV1, { readonly kind: 'event' }>;
type PropEdgeV1 = Extract<UiEdgeV1, { readonly kind: 'prop' }>;
type SpreadPropEdgeV1 = Extract<UiEdgeV1, { readonly kind: 'spread-prop' }>;
type ViewNodeV1 =
  ComponentInstanceNodeV1 | ConditionalRegionNodeV1 | ElementNodeV1 | KeyedCollectionNodeV1;

interface ComponentPlan {
  readonly bindings: readonly BindingNodeV1[];
  readonly component: ComponentNodeV1;
  readonly parameters: readonly ComponentParameterNodeV1[];
  readonly procedures: readonly ProcedureNodeV1[];
  readonly root: ViewNodeV1;
}

interface GenerationPlan {
  readonly childrenByParent: ReadonlyMap<string, readonly ChildEdgeV1[]>;
  readonly components: readonly ComponentPlan[];
  readonly entry: ComponentPlan;
  readonly eventsByElement: ReadonlyMap<string, readonly EventEdgeV1[]>;
  readonly nodesById: ReadonlyMap<string, UiNodeV1>;
  readonly propsByInstance: ReadonlyMap<string, readonly PropEdgeV1[]>;
  readonly spreadsByInstance: ReadonlyMap<string, readonly SpreadPropEdgeV1[]>;
}

interface EmittedProgram {
  readonly componentName: string;
  readonly mountName: string;
  readonly source: string;
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
  node.kind === 'cell' || node.kind === 'computed' || node.kind === 'constant';

const isValueParameter = (
  node: UiNodeV1,
): node is ComponentParameterNodeV1 & { readonly parameterKind: 'value' } =>
  node.kind === 'component-parameter' && node.parameterKind === 'value';

const expressionReads = (expression: ValueExpressionV1, result: string[]): void => {
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
    case 'literal':
      return;
    case 'read':
      if (expression.tracked !== false) {
        result.push(expression.targetId);
      }
      return;
  }
};

const uniqueExpressionReads = (expression: ValueExpressionV1): readonly string[] => {
  const reads: string[] = [];
  expressionReads(expression, reads);
  return [...new Set(reads)];
};

const nodeExpression = (node: BindingNodeV1): ValueExpressionV1 | undefined => {
  switch (node.kind) {
    case 'cell':
      return node.initial;
    case 'computed':
      return node.expression;
    case 'constant':
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
      for (const dependencyId of uniqueExpressionReads(expression)) {
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

  for (const node of graph.nodes) {
    if (!belongsToReachableComponent(node)) {
      continue;
    }
    if ((node.kind === 'cell' || node.kind === 'computed') && node.type === 'unknown') {
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
    if (node.kind === 'procedure' && node.parameters.length > 0) {
      unsupported(`Procedure parameters are not supported yet for "${node.name}".`);
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
        root.kind !== 'keyed-collection')
    ) {
      return invalidGraph(`Component "${component.name}" does not point to a root view.`);
    }
    return { bindings, component, parameters, procedures, root };
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
    entry,
    eventsByElement,
    nodesById,
    propsByInstance,
    spreadsByInstance,
  };
};

const reservedIdentifiers = new Set([
  'appendChild',
  'batch',
  'bindText',
  'container',
  'createCell',
  'createDerived',
  'createElement',
  'createRoot',
  'createText',
  'document',
  'dom',
  'listen',
  'mount',
  'props',
  'runtime',
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
  #indent = 0;

  line(value = ''): void {
    this.#lines.push(value.length === 0 ? '' : `${'  '.repeat(this.#indent)}${value}`);
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

const valueSource = (value: LiteralValueV1 | readonly LiteralValueV1[]): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => literalSource(item)).join(', ')}]`;
  }
  return literalSource(value as LiteralValueV1);
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
  const bindingNames = new Map<string, string>();
  const parameterNames = new Map<string, string>();
  const procedureNames = new Map<string, string>();
  const collectionItemNames = new Map<string, string>();
  const componentName = names.allocate(plan.entry.component.name);
  componentNames.set(plan.entry.component.id, componentName);
  for (const component of plan.components) {
    if (!componentNames.has(component.component.id)) {
      componentNames.set(component.component.id, names.allocate(component.component.name));
    }
  }
  const mountName = names.allocate(`mount${plan.entry.component.name}`);

  for (const component of plan.components) {
    for (const parameter of component.parameters) {
      parameterNames.set(parameter.id, names.allocate(`${parameter.name}Parameter`));
    }
    for (const binding of component.bindings) {
      const suffix =
        binding.kind === 'cell' ? 'Cell' : binding.kind === 'computed' ? 'Derived' : 'Constant';
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
      case 'literal':
        return literalSource(expression.value);
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
    }
  };

  const reactiveDependencies = (expression: ValueExpressionV1): readonly string[] => {
    const dependencies: string[] = [];
    for (const id of uniqueExpressionReads(expression)) {
      const target = plan.nodesById.get(id);
      if (!target) {
        return invalidGraph(`Cannot emit dependency "${id}" because it is missing.`);
      }
      if (isValueParameter(target)) {
        const name =
          parameterNames.get(id) ??
          invalidGraph(`Cannot emit dependency "${id}" because it has no generated name.`);
        dependencies.push(name);
      } else if (target.kind === 'collection-item') {
        const name =
          collectionItemNames.get(id) ??
          invalidGraph(`Cannot emit collection item dependency "${id}".`);
        dependencies.push(name);
      } else if (!isBinding(target)) {
        return invalidGraph(`Cannot emit dependency "${id}" because it is not a value node.`);
      } else if (target.kind !== 'constant') {
        const name =
          bindingNames.get(id) ??
          invalidGraph(`Cannot emit dependency "${id}" because it has no generated name.`);
        dependencies.push(name);
      }
    }
    return dependencies;
  };

  const directReadableSource = (expression: ValueExpressionV1): string | undefined => {
    if (expression.kind !== 'read') {
      return undefined;
    }
    if (expression.tracked === false) {
      return undefined;
    }
    const target = plan.nodesById.get(expression.targetId);
    if (target && (target.kind === 'cell' || target.kind === 'computed')) {
      return bindingNames.get(target.id);
    }
    if (target && isValueParameter(target)) {
      return parameterNames.get(target.id);
    }
    return undefined;
  };

  const emitComponent = (component: ComponentPlan): void => {
    const generatedComponentName =
      componentNames.get(component.component.id) ??
      invalidGraph(`Component "${component.component.id}" has no generated name.`);
    writer.line(
      '/** Builds this component inside an active OXE owner. Prefer the mount helper at an application boundary. */',
    );
    writer.line(
      `const ${generatedComponentName} = (document${component.parameters.length > 0 ? ', props' : ''}) => {`,
    );
    writer.indented(() => {
      for (const parameter of component.parameters) {
        const name =
          parameterNames.get(parameter.id) ??
          invalidGraph(`Parameter "${parameter.id}" has no generated name.`);
        if (parameter.parameterKind === 'value' && parameter.default) {
          const dependencies = reactiveDependencies(parameter.default);
          writer.line(
            `const ${name} = props[${JSON.stringify(parameter.name)}] ?? createDerived([${dependencies.join(', ')}], () => ${expressionSource(parameter.default)}, { name: ${JSON.stringify(`${component.component.name}.${parameter.name} default`)} });`,
          );
        } else {
          writer.line(`const ${name} = props[${JSON.stringify(parameter.name)}];`);
        }
      }
      if (component.parameters.length > 0 && component.bindings.length > 0) {
        writer.line();
      }
      for (const binding of component.bindings) {
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
              `const ${name} = createCell(${expressionSource(binding.initial)}, { name: ${JSON.stringify(`${component.component.name}.${binding.name}`)} });`,
            );
            break;
          case 'computed': {
            const dependencies = reactiveDependencies(binding.expression);
            writer.line(
              `const ${name} = createDerived([${dependencies.join(', ')}], () => ${expressionSource(binding.expression)}, { name: ${JSON.stringify(`${component.component.name}.${binding.name}`)} });`,
            );
            break;
          }
        }
      }

      if (component.bindings.length > 0 && component.procedures.length > 0) {
        writer.line();
      }
      for (const [index, procedure] of component.procedures.entries()) {
        const name = procedureNames.get(procedure.id);
        if (!name) {
          invalidGraph(`Procedure "${procedure.id}" has no generated name.`);
        }
        writer.line(`const ${name} = () =>`);
        writer.indented(() => {
          writer.line('batch(() => {');
          writer.indented(() => {
            for (const step of procedure.steps) {
              const target = plan.nodesById.get(step.targetId);
              const targetName = bindingNames.get(step.targetId);
              if (!target || target.kind !== 'cell' || !targetName) {
                invalidGraph(`Procedure "${procedure.name}" writes an invalid cell.`);
              }
              writer.line(`${targetName}.write(${expressionSource(step.value)});`);
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
          if (part.expression.kind === 'read') {
            const target = plan.nodesById.get(part.expression.targetId);
            const targetName =
              bindingNames.get(part.expression.targetId) ??
              parameterNames.get(part.expression.targetId) ??
              collectionItemNames.get(part.expression.targetId);
            if (!target) {
              return invalidGraph(`Text node "${text.id}" reads a missing value.`);
            }
            if (target.kind === 'constant' || !targetName) {
              return invalidGraph(`Text node "${text.id}" contains an invalid reactive read.`);
            }
            readableName = targetName;
          } else {
            readableName = names.allocate(`${textName}Derived`);
            writer.line(
              `const ${readableName} = createDerived([${dependencies.join(', ')}], () => ${expressionSource(part.expression)}, { name: ${JSON.stringify(`${component.component.name}.text`)} });`,
            );
          }
          writer.line(`const ${textName} = createText(document);`);
          writer.line(`bindText(${textName}, ${readableName});`);
        }
        return emitted;
      };

      const emitInstance = (instance: ComponentInstanceNodeV1): string => {
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
            `const ${source} = createDerived([${dependencies.join(', ')}], () => ${expressionSource(prop.value)}, { name: ${JSON.stringify(`${component.component.name}.${target.component.name}.${authoredName} prop`)} });`,
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
              } else if (child.kind === 'keyed-collection') {
                content.push(`...${emitCollection(child)}`);
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
        const elementName = names.allocate(`${element.tag}Element`);
        writer.line(
          `const ${elementName} = createElement(document, ${JSON.stringify(element.tag)});`,
        );

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
              `const ${readable} = createDerived([${dependencies.join(', ')}], () => ${expressionSource(attribute.value)}, { name: ${JSON.stringify(`${component.component.name}.${attribute.name} attribute`)} });`,
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

      function emitConditional(conditional: ConditionalRegionNodeV1): string {
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
          `const ${selectionName} = createDerived([${dependencies.join(', ')}], () => ${selectionSource}, { name: ${JSON.stringify(`${component.component.name}.if selection`)} });`,
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
                (branchRoot.kind !== 'element' && branchRoot.kind !== 'component-instance')
              ) {
                return invalidGraph(
                  `Conditional branch "${edge.to}" must produce an element or component.`,
                );
              }
              writer.line(`case ${index}: {`);
              writer.indented(() => {
                const result =
                  branchRoot.kind === 'element'
                    ? emitElement(branchRoot)
                    : emitInstance(branchRoot);
                writer.line(`return ${result};`);
              });
              writer.line('}');
            }
            writer.line('default:');
            writer.indented(() => writer.line('return [];'));
          });
          writer.line('}');
        });
        writer.line(`}, { name: ${JSON.stringify(`${component.component.name}.if region`)} });`);
        return regionName;
      }

      function emitCollection(collection: KeyedCollectionNodeV1): string {
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
            `const ${sourceName} = createDerived([${dependencies.join(', ')}], () => ${expressionSource(collection.source)}, { name: ${JSON.stringify(`${component.component.name}.map source`)} });`,
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
              : emitCollection(component.root);
      writer.line();
      writer.line(`return ${rootName};`);
    });
    writer.line('};');
  };

  for (const [index, component] of plan.components.entries()) {
    emitComponent(component);
    if (index < plan.components.length - 1) {
      writer.line();
    }
  }

  if (plan.components.length > 0) {
    writer.line();
  }
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

  return { componentName, mountName, source: writer.toString() };
};

const emitFactorySource = (program: EmittedProgram): string => {
  const writer = new CodeWriter();
  writer.line('(runtime, dom) => {');
  writer.indented(() => {
    writer.line('const { batch, createCell, createDerived, createRoot, untrack } = runtime;');
    writer.line(
      'const { appendChild, bindDomValue, bindText, createConditionalRegion, createElement, createKeyedRegion, createText, listen, mount, setDomValue } = dom;',
    );
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
  writer.line(
    "import { batch, createCell, createDerived, createRoot, untrack } from '@oxe/runtime';",
  );
  writer.line(
    "import { appendChild, bindDomValue, bindText, createConditionalRegion, createElement, createKeyedRegion, createText, listen, mount, setDomValue } from '@oxe/runtime-dom';",
  );
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
    moduleSource: emitModuleSource(program),
    mountExport: program.mountName,
  };
};

export const generateDomFactorySource = (graph: UiGraphV1): string =>
  generateDomArtifact(graph).factorySource;

export const generateDomModuleSource = (graph: UiGraphV1): string =>
  generateDomArtifact(graph).moduleSource;
