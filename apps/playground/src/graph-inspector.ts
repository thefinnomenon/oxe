import type { NodeIdV1, UiEdgeV1, UiGraphV1, UiNodeV1, ValueExpressionV1 } from '@oxe/graph';

export interface GraphInspectorReference {
  readonly detail?: string;
  readonly label: string;
  readonly nodeId?: NodeIdV1;
}

export interface GraphInspectorModel {
  readonly consumers: readonly GraphInspectorReference[];
  readonly inputs: readonly GraphInspectorReference[];
  readonly node: UiNodeV1;
  readonly ownerAndSource: readonly GraphInspectorReference[];
  readonly relationships: readonly GraphInspectorReference[];
  readonly title: string;
}

const collectExpressionTargets = (expression: ValueExpressionV1, targets: Set<NodeIdV1>): void => {
  switch (expression.kind) {
    case 'array':
      for (const element of expression.elements) {
        collectExpressionTargets(element, targets);
      }
      return;
    case 'binary':
      collectExpressionTargets(expression.left, targets);
      collectExpressionTargets(expression.right, targets);
      return;
    case 'call':
      collectExpressionTargets(expression.callee, targets);
      for (const argument of expression.arguments) {
        collectExpressionTargets(argument, targets);
      }
      return;
    case 'capability-read':
      targets.add(expression.targetId);
      return;
    case 'collection':
      collectExpressionTargets(expression.source, targets);
      collectExpressionTargets(expression.callback.result, targets);
      if (expression.initial) {
        collectExpressionTargets(expression.initial, targets);
      }
      if (expression.options) {
        collectExpressionTargets(expression.options, targets);
      }
      return;
    case 'conditional':
      for (const branch of expression.branches) {
        if (branch.condition) {
          collectExpressionTargets(branch.condition, targets);
        }
        collectExpressionTargets(branch.result, targets);
      }
      return;
    case 'literal':
    case 'local-read':
      return;
    case 'member':
      collectExpressionTargets(expression.object, targets);
      return;
    case 'record':
      for (const entry of expression.entries) {
        collectExpressionTargets(entry.value, targets);
      }
      return;
    case 'read':
      targets.add(expression.targetId);
      return;
  }
};

const expressionTargets = (expression: ValueExpressionV1): readonly NodeIdV1[] => {
  const targets = new Set<NodeIdV1>();
  collectExpressionTargets(expression, targets);
  return [...targets];
};

const expressionLabel = (
  expression: ValueExpressionV1,
  nodes: ReadonlyMap<NodeIdV1, UiNodeV1>,
): string => {
  switch (expression.kind) {
    case 'array':
      return `[${expression.elements.map((element) => expressionLabel(element, nodes)).join(', ')}]`;
    case 'binary':
      return `${expressionLabel(expression.left, nodes)} ${expression.operator} ${expressionLabel(expression.right, nodes)}`;
    case 'call':
      return `${expressionLabel(expression.callee, nodes)}(${expression.arguments.map((argument) => expressionLabel(argument, nodes)).join(', ')})`;
    case 'capability-read': {
      const target = nodes.get(expression.targetId);
      return target ? graphNodeLabel(target, nodes) : expression.targetId;
    }
    case 'collection':
      return `${expressionLabel(expression.source, nodes)}.${expression.operation}(${expression.callback.parameters.map((parameter) => parameter.name).join(', ')} => ${expressionLabel(expression.callback.result, nodes)}${expression.options ? `, ${expressionLabel(expression.options, nodes)}` : ''})`;
    case 'conditional':
      return expression.branches
        .map((branch) =>
          branch.condition
            ? `${expressionLabel(branch.condition, nodes)} ? ${expressionLabel(branch.result, nodes)}`
            : `: ${expressionLabel(branch.result, nodes)}`,
        )
        .join(' | ');
    case 'literal':
      return JSON.stringify(expression.value);
    case 'local-read':
      return expression.targetId.split('/').at(-1) ?? expression.targetId;
    case 'member':
      return `${expressionLabel(expression.object, nodes)}.${expression.property}`;
    case 'record':
      return `{ ${expression.entries.map((entry) => `${entry.name}: ${expressionLabel(entry.value, nodes)}`).join(', ')} }`;
    case 'read': {
      const target = nodes.get(expression.targetId);
      const label = target ? graphNodeLabel(target, nodes) : expression.targetId;
      return expression.tracked === false ? `untrack(${label})` : label;
    }
  }
};

export const graphNodeLabel = (node: UiNodeV1, nodes: ReadonlyMap<NodeIdV1, UiNodeV1>): string => {
  switch (node.kind) {
    case 'cell':
    case 'collection-item':
    case 'component':
    case 'component-parameter':
    case 'computed':
    case 'constant':
    case 'context':
    case 'context-consumer':
    case 'content-value':
    case 'procedure':
    case 'resource':
    case 'ref':
      return node.name;
    case 'component-instance': {
      const definition = nodes.get(node.componentId);
      return definition?.kind === 'component'
        ? `${definition.name} instance`
        : 'Component instance';
    }
    case 'content-slot': {
      const parameter = nodes.get(node.parameterId);
      return parameter?.kind === 'component-parameter' ? `${parameter.name} slot` : 'Children slot';
    }
    case 'content-reference': {
      const content = nodes.get(node.contentId);
      return content?.kind === 'content-value' ? `${content.name} placement` : 'Content placement';
    }
    case 'conditional-region':
      return 'Conditional region';
    case 'context-provider': {
      const context = nodes.get(node.contextId);
      return context?.kind === 'context' ? `${context.name} provider` : 'Context provider';
    }
    case 'effect':
      return 'Reactive call';
    case 'element':
      return `<${node.tag}>`;
    case 'keyed-collection':
      return 'Keyed map';
    case 'platform-capability':
      return node.path.join('.');
    case 'text':
      return 'Text';
  }
};

const reference = (
  nodes: ReadonlyMap<NodeIdV1, UiNodeV1>,
  label: string,
  nodeId?: NodeIdV1,
  detail?: string,
): GraphInspectorReference => {
  const target = nodeId === undefined ? undefined : nodes.get(nodeId);
  const targetDetail = target ? `${target.kind} · ${graphNodeLabel(target, nodes)}` : undefined;
  const combinedDetail =
    targetDetail && detail ? `${targetDetail} · ${detail}` : (targetDetail ?? detail);
  return {
    label,
    ...(nodeId === undefined ? {} : { nodeId }),
    ...(combinedDetail === undefined ? {} : { detail: combinedDetail }),
  };
};

const uniqueReferences = (
  references: readonly GraphInspectorReference[],
): readonly GraphInspectorReference[] => {
  const seen = new Set<string>();
  return references.filter((item) => {
    const key = `${item.label}\0${item.nodeId ?? ''}\0${item.detail ?? ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const accessDetail = (edge: Extract<UiEdgeV1, { readonly kind: 'read' | 'write' }>): string => {
  const paths = [
    ...new Set(
      (edge.accesses ?? []).map((access) =>
        access.path.length === 0 ? 'whole value' : access.path.join('.'),
      ),
    ),
  ];
  const prefix = edge.kind === 'read' ? `${edge.mode} dependency` : 'procedural write';
  return paths.length === 0 ? prefix : `${prefix} · ${paths.join(', ')}`;
};

const edgeRelationship = (
  edge: UiEdgeV1,
  selectedId: NodeIdV1,
  nodes: ReadonlyMap<NodeIdV1, UiNodeV1>,
): GraphInspectorReference | undefined => {
  if (edge.from !== selectedId && edge.to !== selectedId) {
    return undefined;
  }
  const outgoing = edge.from === selectedId;
  const otherId = outgoing ? edge.to : edge.from;
  switch (edge.kind) {
    case 'child':
      return reference(nodes, outgoing ? `Child ${edge.index + 1}` : 'Tree parent', otherId);
    case 'event':
      return reference(
        nodes,
        outgoing ? `Event ${edge.authoredName}` : `Handles ${edge.authoredName}`,
        otherId,
        `${edge.event} event`,
      );
    case 'owner':
      return reference(nodes, outgoing ? 'Owned instance' : 'Owner', otherId);
    case 'prop': {
      const parameter = nodes.get(edge.to);
      const name =
        edge.authoredName ?? (parameter?.kind === 'component-parameter' ? parameter.name : edge.to);
      const position = edge.index === undefined ? '' : ` · position ${edge.index + 1}`;
      return reference(
        nodes,
        outgoing ? `Prop ${name}` : 'Provided by',
        otherId,
        `${edge.mode} prop${position}`,
      );
    }
    case 'spread-prop':
      return reference(
        nodes,
        outgoing ? 'Prop spread' : 'Receives spread',
        otherId,
        `component props · position ${edge.index + 1}`,
      );
    case 'read':
      return reference(nodes, outgoing ? 'Reads' : 'Read by', otherId, accessDetail(edge));
    case 'write':
      return reference(nodes, outgoing ? 'Writes' : 'Written by', otherId, accessDetail(edge));
  }
};

export const buildGraphInspectorModel = (
  graph: UiGraphV1,
  nodeId: NodeIdV1,
): GraphInspectorModel | undefined => {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const node = nodes.get(nodeId);
  if (!node) {
    return undefined;
  }

  const ownerAndSource: GraphInspectorReference[] = [];
  const inputs: GraphInspectorReference[] = [];
  const consumers: GraphInspectorReference[] = [];
  const relationships: GraphInspectorReference[] = [];

  ownerAndSource.push(
    reference(
      nodes,
      'Source span',
      node.id,
      `${node.span.fileName}:${node.span.start.line}:${node.span.start.column}`,
    ),
  );
  if (graph.entryComponents.includes(node.id)) {
    ownerAndSource.push(reference(nodes, 'Module entry', node.id, graph.moduleId));
  }
  if (node.kind === 'component-instance') {
    ownerAndSource.push(reference(nodes, 'Component definition', node.componentId));
  }
  if (node.kind === 'component-parameter') {
    ownerAndSource.push(reference(nodes, 'Contract owner', node.ownerId));
    const parameterDetail =
      node.parameterKind === 'value'
        ? `${node.parameterKind} · ${node.type}${node.default ? ` · default ${expressionLabel(node.default, nodes)}` : ' · required'}`
        : node.parameterKind;
    ownerAndSource.push(
      reference(nodes, `Parameter ${node.index + 1}`, undefined, parameterDetail),
    );
    if (node.parameterKind === 'value' && node.default) {
      const targets = expressionTargets(node.default);
      if (targets.length === 0) {
        inputs.push(
          reference(nodes, 'Default value', undefined, expressionLabel(node.default, nodes)),
        );
      } else {
        for (const targetId of targets) {
          inputs.push(
            reference(
              nodes,
              'Default input',
              targetId,
              `reactive · ${expressionLabel(node.default, nodes)}`,
            ),
          );
        }
      }
    }
  }
  if (node.kind === 'content-slot') {
    ownerAndSource.push(reference(nodes, 'Children parameter', node.parameterId));
  }
  if (node.kind === 'collection-item') {
    ownerAndSource.push(reference(nodes, 'Keyed collection', node.ownerId, node.type));
  }
  if (node.kind === 'keyed-collection') {
    ownerAndSource.push(reference(nodes, 'Item binding', node.itemId));
  }

  for (const edge of graph.edges) {
    const relationship = edgeRelationship(edge, node.id, nodes);
    if (relationship) {
      relationships.push(relationship);
    }

    if (edge.kind === 'owner' && edge.to === node.id) {
      ownerAndSource.push(reference(nodes, 'Owner', edge.from));
    } else if (edge.kind === 'child' && edge.to === node.id) {
      ownerAndSource.push(reference(nodes, 'Tree parent', edge.from));
    }

    if (edge.kind === 'read') {
      if (edge.from === node.id) {
        inputs.push(reference(nodes, 'Reactive input', edge.to, accessDetail(edge)));
      }
      if (edge.to === node.id) {
        consumers.push(reference(nodes, 'Read by', edge.from, accessDetail(edge)));
      }
      continue;
    }

    if (edge.kind === 'event' && edge.to === node.id) {
      consumers.push(reference(nodes, `Used by ${edge.authoredName}`, edge.from, edge.event));
      continue;
    }

    if (edge.kind === 'spread-prop') {
      const parameter = nodes.get(edge.to);
      const parameterName = parameter?.kind === 'component-parameter' ? parameter.name : edge.to;
      if (edge.from === node.id) {
        if (edge.source.kind === 'rest') {
          inputs.push(
            reference(
              nodes,
              `Spread into ${parameterName}`,
              edge.source.targetId,
              `rest props · position ${edge.index + 1}`,
            ),
          );
        } else {
          const targets = expressionTargets(edge.source.value);
          if (targets.length === 0) {
            inputs.push(
              reference(
                nodes,
                `Spread into ${parameterName}`,
                undefined,
                expressionLabel(edge.source.value, nodes),
              ),
            );
          } else {
            for (const targetId of targets) {
              inputs.push(
                reference(
                  nodes,
                  `Spread into ${parameterName}`,
                  targetId,
                  `reactive · ${expressionLabel(edge.source.value, nodes)}`,
                ),
              );
            }
          }
        }
      }
      if (edge.to === node.id) {
        inputs.push(
          reference(nodes, 'Spread by instance', edge.from, `position ${edge.index + 1}`),
        );
      }
      const consumesSelected =
        (edge.source.kind === 'rest' && edge.source.targetId === node.id) ||
        (edge.source.kind === 'value' && expressionTargets(edge.source.value).includes(node.id));
      if (consumesSelected) {
        consumers.push(
          reference(nodes, `Forwarded into ${parameterName}`, edge.from, 'component prop spread'),
        );
      }
      continue;
    }

    if (edge.kind !== 'prop') {
      continue;
    }

    const parameter = nodes.get(edge.to);
    const propName =
      edge.authoredName ?? (parameter?.kind === 'component-parameter' ? parameter.name : edge.to);
    if (edge.from === node.id) {
      if (edge.mode === 'procedure') {
        inputs.push(reference(nodes, `Capability ${propName}`, edge.targetId, 'procedure prop'));
      } else {
        const targets = expressionTargets(edge.value);
        if (targets.length === 0) {
          inputs.push(
            reference(nodes, `Value ${propName}`, undefined, expressionLabel(edge.value, nodes)),
          );
        } else {
          for (const targetId of targets) {
            inputs.push(
              reference(
                nodes,
                `Value ${propName}`,
                targetId,
                `reactive · ${expressionLabel(edge.value, nodes)}`,
              ),
            );
          }
        }
      }
    }

    const consumesSelected =
      (edge.mode === 'procedure' && edge.targetId === node.id) ||
      (edge.mode === 'reactive' && expressionTargets(edge.value).includes(node.id));
    if (consumesSelected) {
      consumers.push(reference(nodes, `Passed as ${propName}`, edge.from, `${edge.mode} prop`));
    }
    if (edge.to === node.id) {
      inputs.push(reference(nodes, 'Provided by instance', edge.from, `${edge.mode} prop`));
    }
  }

  if (node.kind === 'component') {
    for (const parameterId of node.parameters) {
      const parameter = nodes.get(parameterId);
      const detail =
        parameter?.kind === 'component-parameter'
          ? parameter.parameterKind === 'value'
            ? `${parameter.parameterKind} · ${parameter.type}${parameter.default ? ' · default' : ' · required'}`
            : parameter.parameterKind
          : undefined;
      relationships.push(reference(nodes, 'Contract parameter', parameterId, detail));
    }
    for (const instance of graph.nodes) {
      if (instance.kind === 'component-instance' && instance.componentId === node.id) {
        consumers.push(reference(nodes, 'Instantiated by', instance.id));
      }
    }
  }

  if (node.kind === 'component-parameter' && node.parameterKind === 'children') {
    for (const slot of graph.nodes) {
      if (slot.kind === 'content-slot' && slot.parameterId === node.id) {
        consumers.push(reference(nodes, 'Rendered by slot', slot.id));
      }
    }
  }
  if (node.kind === 'content-slot') {
    relationships.push(reference(nodes, 'Renders children', node.parameterId));
  }
  if (node.kind === 'keyed-collection') {
    relationships.push(reference(nodes, 'Owns item binding', node.itemId));
  }

  return {
    node,
    title: graphNodeLabel(node, nodes),
    ownerAndSource: uniqueReferences(ownerAndSource),
    inputs: uniqueReferences(inputs),
    consumers: uniqueReferences(consumers),
    relationships: uniqueReferences(relationships),
  };
};
