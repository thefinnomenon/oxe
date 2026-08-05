import type {
  GraphAccessV1,
  GraphSpanV1,
  UiEdgeV1,
  UiGraphV1,
  UiNodeV1,
  ValueExpressionV1,
} from './types.js';

export type GraphDiagnosticCode =
  'OXE3001' | 'OXE3002' | 'OXE3003' | 'OXE3004' | 'OXE3005' | 'OXE3006';

export interface GraphDiagnostic {
  readonly code: GraphDiagnosticCode;
  readonly message: string;
  readonly span: GraphSpanV1;
}

interface ExpressionReference {
  readonly path: readonly string[];
  readonly span: GraphSpanV1;
  readonly targetId: string;
}

const collectCapabilityReferences = (
  expression: ValueExpressionV1,
  references: ExpressionReference[],
): void => {
  switch (expression.kind) {
    case 'array':
      expression.elements.forEach((item) => collectCapabilityReferences(item, references));
      return;
    case 'binary':
      collectCapabilityReferences(expression.left, references);
      collectCapabilityReferences(expression.right, references);
      return;
    case 'call':
      collectCapabilityReferences(expression.callee, references);
      expression.arguments.forEach((item) => collectCapabilityReferences(item, references));
      return;
    case 'capability-read':
      references.push({ path: [], span: expression.span, targetId: expression.targetId });
      return;
    case 'collection':
      collectCapabilityReferences(expression.source, references);
      collectCapabilityReferences(expression.callback.result, references);
      if (expression.initial) {
        collectCapabilityReferences(expression.initial, references);
      }
      if (expression.options) {
        collectCapabilityReferences(expression.options, references);
      }
      return;
    case 'conditional':
      for (const branch of expression.branches) {
        if (branch.condition) {
          collectCapabilityReferences(branch.condition, references);
        }
        collectCapabilityReferences(branch.result, references);
      }
      return;
    case 'member':
      collectCapabilityReferences(expression.object, references);
      return;
    case 'record':
      expression.entries.forEach((entry) => collectCapabilityReferences(entry.value, references));
      return;
    case 'literal':
    case 'local-read':
    case 'read':
      return;
  }
};

interface ProjectedEdge {
  readonly accesses: GraphAccessV1[];
  readonly from: string;
  readonly kind: 'read' | 'write';
  readonly mode: 'procedural' | 'reactive';
  readonly sites: GraphSpanV1[];
  readonly to: string;
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareSpans = (left: GraphSpanV1, right: GraphSpanV1): number =>
  compareText(left.fileName, right.fileName) ||
  left.start.offset - right.start.offset ||
  left.start.line - right.start.line ||
  left.start.column - right.start.column ||
  left.end.offset - right.end.offset ||
  left.end.line - right.end.line ||
  left.end.column - right.end.column;

const spansEqual = (left: GraphSpanV1, right: GraphSpanV1): boolean =>
  compareSpans(left, right) === 0;

const collectExpressionReferences = (
  expression: ValueExpressionV1,
  references: ExpressionReference[],
  trackedOnly = false,
): void => {
  switch (expression.kind) {
    case 'array':
      for (const element of expression.elements) {
        collectExpressionReferences(element, references, trackedOnly);
      }
      return;
    case 'binary':
      collectExpressionReferences(expression.left, references, trackedOnly);
      collectExpressionReferences(expression.right, references, trackedOnly);
      return;
    case 'call':
      collectExpressionReferences(expression.callee, references, trackedOnly);
      for (const argument of expression.arguments) {
        collectExpressionReferences(argument, references, trackedOnly);
      }
      return;
    case 'capability-read':
      return;
    case 'collection':
      collectExpressionReferences(expression.source, references, trackedOnly);
      collectExpressionReferences(expression.callback.result, references, trackedOnly);
      if (expression.initial) {
        collectExpressionReferences(expression.initial, references, trackedOnly);
      }
      if (expression.options) {
        collectExpressionReferences(expression.options, references, trackedOnly);
      }
      return;
    case 'conditional':
      for (const branch of expression.branches) {
        if (branch.condition) {
          collectExpressionReferences(branch.condition, references, trackedOnly);
        }
        collectExpressionReferences(branch.result, references, trackedOnly);
      }
      return;
    case 'literal':
    case 'local-read':
      return;
    case 'member': {
      const path: string[] = [];
      let current: ValueExpressionV1 = expression;
      while (current.kind === 'member') {
        path.unshift(current.property);
        current = current.object;
      }
      if (current.kind === 'read' && (!trackedOnly || current.tracked !== false)) {
        references.push({ path, targetId: current.targetId, span: expression.span });
        return;
      }
      collectExpressionReferences(expression.object, references, trackedOnly);
      return;
    }
    case 'record':
      for (const entry of expression.entries) {
        collectExpressionReferences(entry.value, references, trackedOnly);
      }
      return;
    case 'read':
      if (!trackedOnly || expression.tracked !== false) {
        references.push({ path: [], targetId: expression.targetId, span: expression.span });
      }
      return;
  }
};

const validateExpressionStructure = (
  expression: ValueExpressionV1,
  diagnostics: GraphDiagnostic[],
  localIds: ReadonlySet<string> = new Set(),
): void => {
  switch (expression.kind) {
    case 'array':
      for (const element of expression.elements) {
        validateExpressionStructure(element, diagnostics, localIds);
      }
      return;
    case 'binary':
      validateExpressionStructure(expression.left, diagnostics, localIds);
      validateExpressionStructure(expression.right, diagnostics, localIds);
      return;
    case 'call':
      validateExpressionStructure(expression.callee, diagnostics, localIds);
      for (const argument of expression.arguments) {
        validateExpressionStructure(argument, diagnostics, localIds);
      }
      return;
    case 'capability-read':
      return;
    case 'collection': {
      validateExpressionStructure(expression.source, diagnostics, localIds);
      const expectedParameters = expression.operation === 'reduce' ? 2 : 1;
      if (expression.callback.parameters.length !== expectedParameters) {
        diagnostics.push({
          code: 'OXE3006',
          message: `${expression.operation} callbacks require exactly ${expectedParameters} parameter${expectedParameters === 1 ? '' : 's'}.`,
          span: expression.callback.span,
        });
      }
      if (expression.operation === 'reduce' && !expression.initial) {
        diagnostics.push({
          code: 'OXE3006',
          message: 'A reduce expression requires an initial value.',
          span: expression.span,
        });
      }
      const callbackLocals = new Set(localIds);
      for (const parameter of expression.callback.parameters) {
        callbackLocals.add(parameter.id);
      }
      validateExpressionStructure(expression.callback.result, diagnostics, callbackLocals);
      if (expression.initial) {
        validateExpressionStructure(expression.initial, diagnostics, localIds);
      }
      if (expression.options) {
        validateExpressionStructure(expression.options, diagnostics, localIds);
      }
      return;
    }
    case 'conditional': {
      if (expression.branches.length === 0) {
        diagnostics.push({
          code: 'OXE3006',
          message: 'A conditional value expression must contain at least one branch.',
          span: expression.span,
        });
        return;
      }
      expression.branches.forEach((branch, index) => {
        const final = index === expression.branches.length - 1;
        if (!branch.condition && !final) {
          diagnostics.push({
            code: 'OXE3006',
            message: 'Only the final conditional value branch may omit its condition.',
            span: branch.span,
          });
        }
        if (branch.condition) {
          validateExpressionStructure(branch.condition, diagnostics, localIds);
        }
        validateExpressionStructure(branch.result, diagnostics, localIds);
      });
      const fallback = expression.branches.at(-1);
      if (fallback?.condition) {
        diagnostics.push({
          code: 'OXE3006',
          message: 'A conditional value expression must end with a fallback branch.',
          span: fallback.span,
        });
      }
      return;
    }
    case 'literal':
      return;
    case 'local-read':
      if (!localIds.has(expression.targetId)) {
        diagnostics.push({
          code: 'OXE3006',
          message: `Local read "${expression.targetId}" is outside its callback or procedure scope.`,
          span: expression.span,
        });
      }
      return;
    case 'member':
      validateExpressionStructure(expression.object, diagnostics, localIds);
      return;
    case 'record':
      for (const entry of expression.entries) {
        validateExpressionStructure(entry.value, diagnostics, localIds);
      }
      return;
    case 'read':
      return;
  }
};

const procedureStepExpressions = (
  step: Extract<UiNodeV1, { readonly kind: 'procedure' }>['steps'][number],
): readonly ValueExpressionV1[] => {
  if (step.kind === 'call') {
    return [step.expression];
  }
  if (step.kind === 'refresh') {
    return [
      {
        kind: 'read',
        span: step.span,
        targetId: step.targetId,
      },
    ];
  }
  if (step.kind === 'write') {
    return [step.value];
  }
  return [
    ...(step.value ? [step.value] : []),
    ...(step.predicate ? [step.predicate.result] : []),
    ...(step.updater ? [step.updater.result] : []),
    ...(step.limit ? [step.limit] : []),
  ];
};

const nodeExpressions = (node: UiNodeV1): readonly ValueExpressionV1[] => {
  const localizedExpressions = (
    localization: Extract<UiNodeV1, { readonly kind: 'text' }>['localization'] | undefined,
  ): readonly ValueExpressionV1[] =>
    localization
      ? [
          ...localization.values.map((value) => value.value),
          ...(localization.selection ? [localization.selection.value] : []),
          ...localization.markup.flatMap((markup) =>
            markup.dynamicAttributes.flatMap((attribute) => [
              attribute.value,
              ...(attribute.localization ? localizedExpressions(attribute.localization) : []),
            ]),
          ),
        ]
      : [];
  switch (node.kind) {
    case 'async-resource':
      return [node.expression];
    case 'cell':
      return [node.initial];
    case 'computed':
      return [node.expression];
    case 'effect':
      return [node.expression];
    case 'procedure':
      return node.steps.flatMap(procedureStepExpressions);
    case 'text':
      return [
        ...(node.format
          ? []
          : node.parts.flatMap((part) => (part.kind === 'expression' ? [part.expression] : []))),
        ...(node.format
          ? [node.format.value, ...node.format.options.map((option) => option.value)]
          : []),
        ...localizedExpressions(node.localization),
      ];
    case 'component-parameter':
      return node.parameterKind === 'value' && node.default ? [node.default] : [];
    case 'conditional-region':
      return node.branches.flatMap((branch) => (branch.condition ? [branch.condition] : []));
    case 'content-value':
      return node.branches.flatMap((branch) => (branch.condition ? [branch.condition] : []));
    case 'keyed-collection':
      return [node.source, node.key];
    case 'element':
      return (node.dynamicAttributes ?? []).flatMap((attribute) => [
        attribute.value,
        ...localizedExpressions(attribute.localization),
      ]);
    case 'context-provider':
      return [node.value];
    case 'resource':
      return [node.expression];
    case 'component':
    case 'component-instance':
    case 'collection-item':
    case 'constant':
    case 'context':
    case 'context-consumer':
    case 'platform-capability':
    case 'ref':
    case 'content-reference':
    case 'content-slot':
      return [];
  }
};

const edgeSpan = (
  edge: UiEdgeV1,
  nodes: ReadonlyMap<string, UiNodeV1>,
  fallback: GraphSpanV1,
): GraphSpanV1 => {
  switch (edge.kind) {
    case 'event':
    case 'prop':
    case 'spread-prop':
      return edge.span;
    case 'read':
    case 'write':
      return edge.sites[0] ?? nodes.get(edge.from)?.span ?? fallback;
    case 'child':
    case 'owner':
      return nodes.get(edge.from)?.span ?? fallback;
  }
};

const edgeKindsAreValid = (edge: UiEdgeV1, nodes: ReadonlyMap<string, UiNodeV1>): boolean => {
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  if (!from || !to) {
    return true;
  }

  switch (edge.kind) {
    case 'child':
      return (
        (from.kind === 'component' ||
          from.kind === 'component-instance' ||
          from.kind === 'conditional-region' ||
          from.kind === 'context-provider' ||
          from.kind === 'content-value' ||
          from.kind === 'keyed-collection' ||
          from.kind === 'element') &&
        (to.kind === 'component-instance' ||
          to.kind === 'conditional-region' ||
          to.kind === 'context-provider' ||
          to.kind === 'content-reference' ||
          to.kind === 'keyed-collection' ||
          to.kind === 'content-slot' ||
          to.kind === 'element' ||
          to.kind === 'text')
      );
    case 'event':
      return (
        from.kind === 'element' &&
        (to.kind === 'procedure' ||
          (to.kind === 'component-parameter' && to.parameterKind === 'procedure'))
      );
    case 'owner':
      return from.kind === 'component' && to.kind === 'component-instance';
    case 'prop':
      return (
        from.kind === 'component-instance' &&
        to.kind === 'component-parameter' &&
        ((edge.mode === 'reactive' && to.parameterKind === 'value') ||
          (edge.mode === 'procedure' && to.parameterKind === 'procedure') ||
          to.parameterKind === 'rest')
      );
    case 'spread-prop':
      return (
        from.kind === 'component-instance' &&
        to.kind === 'component-parameter' &&
        to.parameterKind === 'rest'
      );
    case 'read':
      return (
        (from.kind === 'component-instance' ||
          from.kind === 'conditional-region' ||
          from.kind === 'context-provider' ||
          from.kind === 'content-value' ||
          from.kind === 'keyed-collection' ||
          from.kind === 'element' ||
          from.kind === 'async-resource' ||
          from.kind === 'computed' ||
          from.kind === 'effect' ||
          from.kind === 'procedure' ||
          from.kind === 'resource' ||
          from.kind === 'text' ||
          (from.kind === 'component-parameter' && from.parameterKind === 'value')) &&
        (to.kind === 'async-resource' ||
          to.kind === 'cell' ||
          to.kind === 'collection-item' ||
          to.kind === 'computed' ||
          to.kind === 'constant' ||
          to.kind === 'context-consumer' ||
          to.kind === 'ref' ||
          (to.kind === 'component-parameter' &&
            (to.parameterKind === 'rest' || to.parameterKind === 'value'))) &&
        (from.kind === 'procedure' ? edge.mode === 'procedural' : edge.mode === 'reactive')
      );
    case 'write':
      return (
        from.kind === 'procedure' &&
        (to.kind === 'cell' || (to.kind === 'context-consumer' && to.writable)) &&
        edge.mode === 'procedural'
      );
  }
};

const fallbackSpan = (graph: UiGraphV1): GraphSpanV1 => ({
  fileName: graph.moduleId,
  start: { column: 1, line: 1, offset: 0 },
  end: { column: 1, line: 1, offset: 0 },
});

const projectionKey = (
  kind: ProjectedEdge['kind'],
  from: string,
  to: string,
  mode: ProjectedEdge['mode'],
): string => `${kind}\0${from}\0${to}\0${mode}`;

const addProjectionSite = (
  projection: Map<string, ProjectedEdge>,
  kind: ProjectedEdge['kind'],
  from: string,
  to: string,
  mode: ProjectedEdge['mode'],
  span: GraphSpanV1,
  path: readonly string[] = [],
): void => {
  const key = projectionKey(kind, from, to, mode);
  const existing = projection.get(key);
  if (existing) {
    existing.sites.push(span);
    existing.accesses.push({ path, span });
    return;
  }
  projection.set(key, { accesses: [{ path, span }], kind, from, to, mode, sites: [span] });
};

const expectedProjection = (graph: UiGraphV1): Map<string, ProjectedEdge> => {
  const projection = new Map<string, ProjectedEdge>();

  for (const node of graph.nodes) {
    if (node.kind === 'computed') {
      const references: ExpressionReference[] = [];
      collectExpressionReferences(node.expression, references, true);
      for (const reference of references) {
        addProjectionSite(
          projection,
          'read',
          node.id,
          reference.targetId,
          'reactive',
          reference.span,
          reference.path,
        );
      }
    } else if (node.kind === 'procedure') {
      for (const step of node.steps) {
        if (step.kind === 'write' || step.kind === 'collection-mutation') {
          addProjectionSite(
            projection,
            'write',
            node.id,
            step.targetId,
            'procedural',
            step.span,
            step.kind === 'write' ? (step.path ?? []) : [],
          );
        }
        for (const expression of procedureStepExpressions(step)) {
          const references: ExpressionReference[] = [];
          collectExpressionReferences(expression, references, true);
          for (const reference of references) {
            addProjectionSite(
              projection,
              'read',
              node.id,
              reference.targetId,
              'procedural',
              reference.span,
              reference.path,
            );
          }
        }
      }
    } else if (
      node.kind === 'async-resource' ||
      node.kind === 'effect' ||
      node.kind === 'resource' ||
      node.kind === 'text'
    ) {
      for (const expression of nodeExpressions(node)) {
        const references: ExpressionReference[] = [];
        collectExpressionReferences(expression, references, true);
        for (const reference of references) {
          addProjectionSite(
            projection,
            'read',
            node.id,
            reference.targetId,
            'reactive',
            reference.span,
            reference.path,
          );
        }
      }
    } else if (
      node.kind === 'conditional-region' ||
      node.kind === 'content-value' ||
      node.kind === 'context-provider' ||
      node.kind === 'keyed-collection' ||
      node.kind === 'element'
    ) {
      for (const expression of nodeExpressions(node)) {
        const references: ExpressionReference[] = [];
        collectExpressionReferences(expression, references, true);
        for (const reference of references) {
          addProjectionSite(
            projection,
            'read',
            node.id,
            reference.targetId,
            'reactive',
            reference.span,
            reference.path,
          );
        }
      }
    } else if (node.kind === 'component-parameter' && node.parameterKind === 'value') {
      if (!node.default) {
        continue;
      }
      const references: ExpressionReference[] = [];
      collectExpressionReferences(node.default, references, true);
      for (const reference of references) {
        addProjectionSite(
          projection,
          'read',
          node.id,
          reference.targetId,
          'reactive',
          reference.span,
          reference.path,
        );
      }
    }
  }

  for (const edge of graph.edges) {
    if (edge.kind === 'prop' && edge.mode === 'reactive') {
      const references: ExpressionReference[] = [];
      collectExpressionReferences(edge.value, references, true);
      for (const reference of references) {
        addProjectionSite(
          projection,
          'read',
          edge.from,
          reference.targetId,
          'reactive',
          reference.span,
          reference.path,
        );
      }
    } else if (edge.kind === 'spread-prop' && edge.source.kind === 'rest') {
      addProjectionSite(
        projection,
        'read',
        edge.from,
        edge.source.targetId,
        'reactive',
        edge.source.span,
      );
    } else if (edge.kind === 'spread-prop' && edge.source.kind === 'value') {
      const references: ExpressionReference[] = [];
      collectExpressionReferences(edge.source.value, references, true);
      for (const reference of references) {
        addProjectionSite(
          projection,
          'read',
          edge.from,
          reference.targetId,
          'reactive',
          reference.span,
          reference.path,
        );
      }
    }
  }

  return projection;
};

const validateProjection = (
  graph: UiGraphV1,
  nodes: ReadonlyMap<string, UiNodeV1>,
  diagnostics: GraphDiagnostic[],
  fallback: GraphSpanV1,
): void => {
  const expected = expectedProjection(graph);
  const actual = new Map<string, ProjectedEdge>();

  for (const edge of graph.edges) {
    if (edge.kind !== 'read' && edge.kind !== 'write') {
      continue;
    }

    const key = projectionKey(edge.kind, edge.from, edge.to, edge.mode);
    if (actual.has(key)) {
      diagnostics.push({
        code: 'OXE3004',
        message: `Duplicate ${edge.kind} edge from "${edge.from}" to "${edge.to}".`,
        span: edgeSpan(edge, nodes, fallback),
      });
      continue;
    }
    actual.set(key, {
      ...edge,
      accesses: [
        ...(edge.accesses ?? edge.sites.map((span) => ({ path: [] as readonly string[], span }))),
      ],
      sites: [...edge.sites],
    });
  }

  const keys = new Set([...expected.keys(), ...actual.keys()]);
  for (const key of [...keys].sort(compareText)) {
    const expectedEdge = expected.get(key);
    const actualEdge = actual.get(key);
    const reference = expectedEdge ?? actualEdge;
    if (!reference) {
      continue;
    }
    const span =
      reference.sites[0] ??
      nodes.get(reference.from)?.span ??
      nodes.get(reference.to)?.span ??
      fallback;

    if (!expectedEdge) {
      diagnostics.push({
        code: 'OXE3004',
        message: `Graph contains an extra ${reference.kind} edge from "${reference.from}" to "${reference.to}".`,
        span,
      });
      continue;
    }
    if (!actualEdge) {
      diagnostics.push({
        code: 'OXE3004',
        message: `Graph is missing the ${reference.kind} edge from "${reference.from}" to "${reference.to}".`,
        span,
      });
      continue;
    }

    const expectedSites = [...expectedEdge.sites].sort(compareSpans);
    const actualSites = [...actualEdge.sites].sort(compareSpans);
    if (
      expectedSites.length !== actualSites.length ||
      expectedSites.some((site, index) => !spansEqual(site, actualSites[index] ?? fallback))
    ) {
      diagnostics.push({
        code: 'OXE3004',
        message: `The ${reference.kind} edge from "${reference.from}" to "${reference.to}" has incorrect source sites.`,
        span,
      });
    }

    const compareAccess = (left: GraphAccessV1, right: GraphAccessV1): number =>
      compareText(left.path.join('\0'), right.path.join('\0')) ||
      compareSpans(left.span, right.span);
    const expectedAccesses = [...expectedEdge.accesses].sort(compareAccess);
    const actualAccesses = [...actualEdge.accesses].sort(compareAccess);
    if (
      expectedAccesses.length !== actualAccesses.length ||
      expectedAccesses.some((access, index) => {
        const actualAccess = actualAccesses[index];
        return (
          !actualAccess ||
          access.path.join('\0') !== actualAccess.path.join('\0') ||
          !spansEqual(access.span, actualAccess.span)
        );
      })
    ) {
      diagnostics.push({
        code: 'OXE3004',
        message: `The ${reference.kind} edge from "${reference.from}" to "${reference.to}" has incorrect field paths.`,
        span,
      });
    }
  }
};

const validateChildTopology = (
  graph: UiGraphV1,
  nodes: ReadonlyMap<string, UiNodeV1>,
  diagnostics: GraphDiagnostic[],
  fallback: GraphSpanV1,
): void => {
  const childrenByParent = new Map<string, Map<number, string>>();
  const parentByChild = new Map<string, string>();

  for (const edge of graph.edges) {
    if (edge.kind !== 'child') {
      continue;
    }
    const span = edgeSpan(edge, nodes, fallback);
    if (!Number.isInteger(edge.index) || edge.index < 0) {
      diagnostics.push({
        code: 'OXE3005',
        message: `Child index for "${edge.to}" must be a nonnegative integer.`,
        span,
      });
    }

    const siblings = childrenByParent.get(edge.from) ?? new Map<number, string>();
    const indexedChild = siblings.get(edge.index);
    if (indexedChild) {
      diagnostics.push({
        code: 'OXE3005',
        message: `Parent "${edge.from}" has more than one child at index ${edge.index}.`,
        span,
      });
    } else {
      siblings.set(edge.index, edge.to);
      childrenByParent.set(edge.from, siblings);
    }

    const existingParent = parentByChild.get(edge.to);
    if (existingParent) {
      diagnostics.push({
        code: 'OXE3005',
        message: `View node "${edge.to}" has more than one parent.`,
        span,
      });
    } else {
      parentByChild.set(edge.to, edge.from);
    }
  }

  for (const [parent, children] of [...childrenByParent].sort(([left], [right]) =>
    compareText(left, right),
  )) {
    const indexes = [...children.keys()].sort((left, right) => left - right);
    for (let expected = 0; expected < indexes.length; expected += 1) {
      if (indexes[expected] !== expected) {
        diagnostics.push({
          code: 'OXE3005',
          message: `Child indexes for "${parent}" must be contiguous starting at 0.`,
          span: nodes.get(parent)?.span ?? fallback,
        });
        break;
      }
    }
  }

  for (const node of graph.nodes) {
    if (
      (node.kind === 'component-instance' ||
        node.kind === 'conditional-region' ||
        node.kind === 'context-provider' ||
        node.kind === 'keyed-collection' ||
        node.kind === 'content-slot' ||
        node.kind === 'element' ||
        node.kind === 'text') &&
      !parentByChild.has(node.id)
    ) {
      diagnostics.push({
        code: 'OXE3005',
        message: `View node "${node.id}" is not reachable from a component.`,
        span: node.span,
      });
    }
  }

  const state = new Map<string, 'done' | 'visiting'>();
  const visit = (id: string): void => {
    const current = state.get(id);
    if (current === 'done') {
      return;
    }
    if (current === 'visiting') {
      diagnostics.push({
        code: 'OXE3005',
        message: `Child edges contain a cycle through "${id}".`,
        span: nodes.get(id)?.span ?? fallback,
      });
      return;
    }

    state.set(id, 'visiting');
    const children = childrenByParent.get(id);
    if (children) {
      for (const child of [...children.entries()].sort(([left], [right]) => left - right)) {
        visit(child[1]);
      }
    }
    state.set(id, 'done');
  };

  for (const id of [...childrenByParent.keys()].sort(compareText)) {
    visit(id);
  }
};

const validateComponentComposition = (
  graph: UiGraphV1,
  nodes: ReadonlyMap<string, UiNodeV1>,
  diagnostics: GraphDiagnostic[],
  fallback: GraphSpanV1,
): void => {
  type ChildEdge = Extract<UiEdgeV1, { readonly kind: 'child' }>;
  type OwnerEdge = Extract<UiEdgeV1, { readonly kind: 'owner' }>;
  type PropEdge = Extract<UiEdgeV1, { readonly kind: 'prop' | 'spread-prop' }>;

  const childParent = new Map<string, string>();
  const childrenByParent = new Map<string, ChildEdge[]>();
  const ownersByInstance = new Map<string, OwnerEdge[]>();
  const propsByInstance = new Map<string, PropEdge[]>();

  for (const edge of graph.edges) {
    if (edge.kind === 'child') {
      if (!childParent.has(edge.to)) {
        childParent.set(edge.to, edge.from);
      }
      const children = childrenByParent.get(edge.from) ?? [];
      children.push(edge);
      childrenByParent.set(edge.from, children);
    } else if (edge.kind === 'owner') {
      const owners = ownersByInstance.get(edge.to) ?? [];
      owners.push(edge);
      ownersByInstance.set(edge.to, owners);
    } else if (edge.kind === 'prop' || edge.kind === 'spread-prop') {
      const props = propsByInstance.get(edge.from) ?? [];
      props.push(edge);
      propsByInstance.set(edge.from, props);
    }
  }

  for (const component of graph.nodes) {
    if (component.kind !== 'component') {
      continue;
    }

    const ids = new Set<string>();
    const names = new Set<string>();
    let childrenParameterCount = 0;
    let restParameterCount = 0;
    for (const [index, parameterId] of component.parameters.entries()) {
      const parameter = nodes.get(parameterId);
      if (ids.has(parameterId)) {
        diagnostics.push({
          code: 'OXE3006',
          message: `Component "${component.id}" declares parameter "${parameterId}" more than once.`,
          span: component.span,
        });
        continue;
      }
      ids.add(parameterId);

      if (!parameter || parameter.kind !== 'component-parameter') {
        if (parameter) {
          diagnostics.push({
            code: 'OXE3006',
            message: `Component parameter "${parameterId}" must reference a component-parameter node.`,
            span: parameter.span,
          });
        }
        continue;
      }
      if (parameter.ownerId !== component.id) {
        diagnostics.push({
          code: 'OXE3006',
          message: `Parameter "${parameter.id}" is not owned by component "${component.id}".`,
          span: parameter.span,
        });
      }
      if (parameter.index !== index) {
        diagnostics.push({
          code: 'OXE3006',
          message: `Parameter "${parameter.id}" must have declaration index ${index}.`,
          span: parameter.span,
        });
      }
      if (names.has(parameter.name)) {
        diagnostics.push({
          code: 'OXE3006',
          message: `Component "${component.id}" declares parameter name "${parameter.name}" more than once.`,
          span: parameter.span,
        });
      }
      names.add(parameter.name);

      if (parameter.parameterKind === 'children') {
        childrenParameterCount += 1;
        if (parameter.name !== 'children') {
          diagnostics.push({
            code: 'OXE3006',
            message: `Children parameter "${parameter.id}" must use the reserved name "children".`,
            span: parameter.span,
          });
        }
      } else if (parameter.parameterKind === 'rest') {
        restParameterCount += 1;
        const laterAuthoredParameter = component.parameters.slice(index + 1).some((laterId) => {
          const later = nodes.get(laterId);
          return later?.kind !== 'component-parameter' || later.parameterKind !== 'children';
        });
        if (laterAuthoredParameter) {
          diagnostics.push({
            code: 'OXE3006',
            message: `Rest parameter "${parameter.id}" must be the final component parameter.`,
            span: parameter.span,
          });
        }
      } else if (parameter.parameterKind === 'value' && parameter.default) {
        const references: ExpressionReference[] = [];
        collectExpressionReferences(parameter.default, references);
        for (const reference of references) {
          const target = nodes.get(reference.targetId);
          if (
            target?.kind !== 'component-parameter' ||
            target.parameterKind !== 'value' ||
            target.ownerId !== component.id ||
            target.index >= parameter.index
          ) {
            diagnostics.push({
              code: 'OXE3006',
              message: `Default for "${parameter.id}" may only read earlier value parameters from the same component.`,
              span: reference.span,
            });
          }
        }
      }
    }

    if (childrenParameterCount > 1) {
      diagnostics.push({
        code: 'OXE3006',
        message: `Component "${component.id}" may declare only one children parameter.`,
        span: component.span,
      });
    }
    if (restParameterCount > 1) {
      diagnostics.push({
        code: 'OXE3006',
        message: `Component "${component.id}" may declare only one rest parameter.`,
        span: component.span,
      });
    }
  }

  for (const parameter of graph.nodes) {
    if (parameter.kind !== 'component-parameter') {
      continue;
    }
    if (!Number.isInteger(parameter.index) || parameter.index < 0) {
      diagnostics.push({
        code: 'OXE3006',
        message: `Parameter "${parameter.id}" must have a nonnegative integer index.`,
        span: parameter.span,
      });
    }

    const owner = nodes.get(parameter.ownerId);
    if (owner && owner.kind !== 'component') {
      diagnostics.push({
        code: 'OXE3006',
        message: `Parameter owner "${parameter.ownerId}" must reference a component node.`,
        span: parameter.span,
      });
    } else if (
      owner &&
      owner.parameters.filter((parameterId) => parameterId === parameter.id).length !== 1
    ) {
      diagnostics.push({
        code: 'OXE3006',
        message: `Parameter "${parameter.id}" must appear exactly once in its owner's contract.`,
        span: parameter.span,
      });
    }
  }

  const containingComponent = (nodeId: string): string | undefined => {
    const visited = new Set<string>();
    let current = childParent.get(nodeId);
    while (current && !visited.has(current)) {
      visited.add(current);
      const node = nodes.get(current);
      if (node?.kind === 'component') {
        return node.id;
      }
      current = childParent.get(current);
    }
    return undefined;
  };

  const validateParameterScope = (
    consumerId: string,
    parameterId: string,
    span: GraphSpanV1,
  ): void => {
    const parameter = nodes.get(parameterId);
    if (parameter?.kind !== 'component-parameter') {
      return;
    }
    const consumer = nodes.get(consumerId);
    const ownerId =
      consumer?.kind === 'component-parameter' ? consumer.ownerId : containingComponent(consumerId);
    if (ownerId && ownerId !== parameter.ownerId) {
      diagnostics.push({
        code: 'OXE3006',
        message: `Node "${consumerId}" cannot access parameter "${parameterId}" owned by component "${parameter.ownerId}".`,
        span,
      });
    }
  };

  const slotsByParameter = new Map<string, string[]>();
  for (const slot of graph.nodes) {
    if (slot.kind !== 'content-slot') {
      continue;
    }
    const parameter = nodes.get(slot.parameterId);
    if (parameter?.kind !== 'component-parameter' || parameter.parameterKind !== 'children') {
      diagnostics.push({
        code: 'OXE3006',
        message: `Content slot "${slot.id}" must reference a children parameter.`,
        span: slot.span,
      });
      continue;
    }
    const ownerId = containingComponent(slot.id);
    if (ownerId && ownerId !== parameter.ownerId) {
      diagnostics.push({
        code: 'OXE3006',
        message: `Content slot "${slot.id}" must be placed inside component "${parameter.ownerId}".`,
        span: slot.span,
      });
    }
    const slots = slotsByParameter.get(parameter.id) ?? [];
    slots.push(slot.id);
    slotsByParameter.set(parameter.id, slots);
  }

  for (const parameter of graph.nodes) {
    if (parameter.kind !== 'component-parameter' || parameter.parameterKind !== 'children') {
      continue;
    }
    if ((slotsByParameter.get(parameter.id) ?? []).length !== 1) {
      diagnostics.push({
        code: 'OXE3006',
        message: `Children parameter "${parameter.id}" must have exactly one content slot.`,
        span: parameter.span,
      });
    }
  }

  for (const instance of graph.nodes) {
    if (instance.kind !== 'component-instance') {
      continue;
    }

    const component = nodes.get(instance.componentId);
    const expectedParameters =
      component?.kind === 'component' ? new Set(component.parameters) : new Set<string>();
    const props = propsByInstance.get(instance.id) ?? [];
    const seenParameters = new Set<string>();
    const seenRestNames = new Set<string>();
    const targetParameters =
      component?.kind === 'component'
        ? component.parameters.flatMap((parameterId) => {
            const parameter = nodes.get(parameterId);
            return parameter?.kind === 'component-parameter' ? [parameter] : [];
          })
        : [];
    const targetParameterNames = new Set(
      targetParameters
        .filter((parameter) => parameter.parameterKind !== 'rest')
        .map((parameter) => parameter.name),
    );
    const childrenParameter = targetParameters.find(
      (parameter) => parameter.parameterKind === 'children',
    );

    for (const prop of props) {
      if (prop.kind !== 'prop' && prop.kind !== 'spread-prop') {
        continue;
      }
      if (component?.kind === 'component' && !expectedParameters.has(prop.to)) {
        diagnostics.push({
          code: 'OXE3006',
          message: `Parameter "${prop.to}" does not belong to component "${component.id}".`,
          span: prop.span,
        });
      }

      if (prop.kind === 'spread-prop') {
        continue;
      }

      const parameter = nodes.get(prop.to);
      if (parameter?.kind !== 'component-parameter') {
        continue;
      }
      if (parameter.parameterKind === 'children') {
        diagnostics.push({
          code: 'OXE3006',
          message: `Reserved children parameter "${parameter.id}" cannot be supplied as a named prop.`,
          span: prop.span,
        });
      } else if (parameter.parameterKind === 'rest') {
        if (!prop.authoredName) {
          diagnostics.push({
            code: 'OXE3006',
            message: `Prop captured by rest parameter "${parameter.id}" must preserve its authored name.`,
            span: prop.span,
          });
        } else {
          if (prop.authoredName === 'children' || targetParameterNames.has(prop.authoredName)) {
            diagnostics.push({
              code: 'OXE3006',
              message: `Rest-captured prop name "${prop.authoredName}" conflicts with a declared component parameter.`,
              span: prop.span,
            });
          }
          if (seenRestNames.has(prop.authoredName)) {
            diagnostics.push({
              code: 'OXE3006',
              message: `Component instance "${instance.id}" supplies extra prop "${prop.authoredName}" more than once.`,
              span: prop.span,
            });
          }
          seenRestNames.add(prop.authoredName);
        }
      } else {
        if (seenParameters.has(prop.to)) {
          diagnostics.push({
            code: 'OXE3006',
            message: `Component instance "${instance.id}" supplies parameter "${prop.to}" more than once.`,
            span: prop.span,
          });
        }
        seenParameters.add(prop.to);
        if (prop.authoredName && prop.authoredName !== parameter.name) {
          diagnostics.push({
            code: 'OXE3006',
            message: `Authored prop name "${prop.authoredName}" does not match parameter "${parameter.name}".`,
            span: prop.span,
          });
        }
      }
    }

    const usesOrderedComposition = props.some((prop) => {
      const parameter = nodes.get(prop.to);
      return (
        prop.kind === 'spread-prop' ||
        prop.index !== undefined ||
        (parameter?.kind === 'component-parameter' && parameter.parameterKind === 'rest')
      );
    });
    if (usesOrderedComposition) {
      const indexes = new Set<number>();
      for (const prop of props) {
        const index = prop.index;
        if (index === undefined || !Number.isInteger(index) || index < 0) {
          diagnostics.push({
            code: 'OXE3006',
            message: `Every prop on ordered component instance "${instance.id}" must have a nonnegative integer index.`,
            span: edgeSpan(prop, nodes, fallback),
          });
          continue;
        }
        if (indexes.has(index)) {
          diagnostics.push({
            code: 'OXE3006',
            message: `Component instance "${instance.id}" has more than one prop at authored index ${index}.`,
            span: edgeSpan(prop, nodes, fallback),
          });
        }
        indexes.add(index);
      }
      for (let expected = 0; expected < indexes.size; expected += 1) {
        if (!indexes.has(expected)) {
          diagnostics.push({
            code: 'OXE3006',
            message: `Authored prop indexes for "${instance.id}" must be contiguous starting at 0.`,
            span: instance.span,
          });
          break;
        }
      }
    }

    if (component?.kind === 'component') {
      for (const parameterId of component.parameters) {
        const parameter = nodes.get(parameterId);
        const isRequired =
          parameter?.kind === 'component-parameter' &&
          parameter.parameterKind !== 'children' &&
          parameter.parameterKind !== 'rest' &&
          !(parameter.parameterKind === 'value' && parameter.default);
        if (isRequired && !seenParameters.has(parameterId)) {
          diagnostics.push({
            code: 'OXE3006',
            message: `Component instance "${instance.id}" is missing required parameter "${parameterId}".`,
            span: instance.span,
          });
        }
      }
    }

    const suppliedContent = childrenByParent.get(instance.id) ?? [];
    if (!childrenParameter && suppliedContent.length > 0) {
      const firstContent = suppliedContent[0];
      diagnostics.push({
        code: 'OXE3006',
        message: `Component instance "${instance.id}" cannot receive child content.`,
        span: firstContent ? edgeSpan(firstContent, nodes, fallback) : instance.span,
      });
    }

    const owners = ownersByInstance.get(instance.id) ?? [];
    if (owners.length !== 1) {
      diagnostics.push({
        code: 'OXE3006',
        message: `Component instance "${instance.id}" must have exactly one owner edge.`,
        span: instance.span,
      });
    } else {
      const structuralOwner = containingComponent(instance.id);
      const owner = owners[0];
      if (owner && structuralOwner && owner.from !== structuralOwner) {
        diagnostics.push({
          code: 'OXE3006',
          message: `Component instance "${instance.id}" must be owned by containing component "${structuralOwner}".`,
          span: edgeSpan(owner, nodes, fallback),
        });
      }
    }
  }

  for (const edge of graph.edges) {
    if (edge.kind === 'event' || edge.kind === 'read') {
      validateParameterScope(edge.from, edge.to, edgeSpan(edge, nodes, fallback));
    } else if (edge.kind === 'prop' && edge.mode === 'procedure') {
      validateParameterScope(edge.from, edge.targetId, edge.span);
    } else if (edge.kind === 'prop' && edge.mode === 'reactive') {
      const references: ExpressionReference[] = [];
      collectExpressionReferences(edge.value, references);
      for (const reference of references) {
        validateParameterScope(edge.from, reference.targetId, reference.span);
      }
    } else if (edge.kind === 'spread-prop' && edge.source.kind === 'rest') {
      validateParameterScope(edge.from, edge.source.targetId, edge.source.span);
    } else if (edge.kind === 'spread-prop' && edge.source.kind === 'value') {
      const references: ExpressionReference[] = [];
      collectExpressionReferences(edge.source.value, references);
      for (const reference of references) {
        validateParameterScope(edge.from, reference.targetId, reference.span);
      }
    }
  }

  const composition = new Map<string, Set<string>>();
  for (const [instanceId, owners] of ownersByInstance) {
    if (owners.length !== 1) {
      continue;
    }
    const owner = owners[0];
    const instance = nodes.get(instanceId);
    if (!owner || instance?.kind !== 'component-instance') {
      continue;
    }
    const targets = composition.get(owner.from) ?? new Set<string>();
    targets.add(instance.componentId);
    composition.set(owner.from, targets);
  }

  const state = new Map<string, 'done' | 'visiting'>();
  const visit = (componentId: string): void => {
    const current = state.get(componentId);
    if (current === 'done') {
      return;
    }
    if (current === 'visiting') {
      diagnostics.push({
        code: 'OXE3006',
        message: `Component composition contains a cycle through "${componentId}".`,
        span: nodes.get(componentId)?.span ?? fallback,
      });
      return;
    }
    state.set(componentId, 'visiting');
    for (const target of [...(composition.get(componentId) ?? [])].sort(compareText)) {
      visit(target);
    }
    state.set(componentId, 'done');
  };

  for (const componentId of [...composition.keys()].sort(compareText)) {
    visit(componentId);
  }
};

export const validateUiGraph = (graph: UiGraphV1): GraphDiagnostic[] => {
  const diagnostics: GraphDiagnostic[] = [];
  const nodes = new Map<string, UiNodeV1>();
  const fallback = fallbackSpan(graph);

  for (const node of [...graph.nodes].sort((left, right) => compareText(left.id, right.id))) {
    if (nodes.has(node.id)) {
      diagnostics.push({
        code: 'OXE3001',
        message: `Duplicate semantic graph id "${node.id}".`,
        span: node.span,
      });
    } else {
      nodes.set(node.id, node);
    }
  }

  const requireReference = (targetId: string, span: GraphSpanV1): void => {
    if (!nodes.has(targetId)) {
      diagnostics.push({
        code: 'OXE3002',
        message: `Semantic graph reference "${targetId}" does not exist.`,
        span,
      });
    }
  };

  for (const entry of [...graph.entryComponents].sort(compareText)) {
    requireReference(entry, nodes.get(entry)?.span ?? fallback);
    const node = nodes.get(entry);
    if (node && node.kind !== 'component') {
      diagnostics.push({
        code: 'OXE3003',
        message: `Entry "${entry}" must reference a component node.`,
        span: node.span,
      });
    }
  }

  for (const node of [...graph.nodes].sort((left, right) => compareText(left.id, right.id))) {
    const procedureLocals =
      node.kind === 'procedure'
        ? new Set([
            ...node.parameters.map((parameter) => parameter.name),
            ...node.steps.flatMap((step) =>
              step.kind === 'collection-mutation'
                ? [
                    ...(step.predicate?.parameters.map((parameter) => parameter.id) ?? []),
                    ...(step.updater?.parameters.map((parameter) => parameter.id) ?? []),
                  ]
                : [],
            ),
          ])
        : new Set<string>();
    for (const expression of nodeExpressions(node)) {
      validateExpressionStructure(expression, diagnostics, procedureLocals);
      const references: ExpressionReference[] = [];
      collectExpressionReferences(expression, references);
      for (const reference of references) {
        requireReference(reference.targetId, reference.span);
        const target = nodes.get(reference.targetId);
        if (
          target &&
          target.kind !== 'async-resource' &&
          target.kind !== 'cell' &&
          target.kind !== 'computed' &&
          target.kind !== 'constant' &&
          target.kind !== 'context-consumer' &&
          target.kind !== 'ref' &&
          target.kind !== 'collection-item' &&
          !(target.kind === 'component-parameter' && target.parameterKind === 'value')
        ) {
          diagnostics.push({
            code: 'OXE3003',
            message: `Expression read "${reference.targetId}" must reference a value node.`,
            span: reference.span,
          });
        }
      }
      const capabilities: ExpressionReference[] = [];
      collectCapabilityReferences(expression, capabilities);
      for (const capability of capabilities) {
        requireReference(capability.targetId, capability.span);
        const target = nodes.get(capability.targetId);
        if (
          target &&
          target.kind !== 'procedure' &&
          target.kind !== 'platform-capability' &&
          !(target.kind === 'component-parameter' && target.parameterKind === 'procedure')
        ) {
          diagnostics.push({
            code: 'OXE3003',
            message: `Capability read "${capability.targetId}" must reference a procedure.`,
            span: capability.span,
          });
        }
      }
    }

    if (node.kind === 'procedure') {
      for (const step of node.steps) {
        if (step.kind === 'call') {
          continue;
        }
        requireReference(step.targetId, step.span);
        const target = nodes.get(step.targetId);
        if (step.kind === 'refresh') {
          if (target && target.kind !== 'async-resource') {
            diagnostics.push({
              code: 'OXE3003',
              message: `Procedure refresh "${step.targetId}" must reference an async resource.`,
              span: step.span,
            });
          }
          continue;
        }
        if (
          target &&
          target.kind !== 'async-resource' &&
          target.kind !== 'cell' &&
          !(target.kind === 'context-consumer' && target.writable)
        ) {
          diagnostics.push({
            code: 'OXE3003',
            message: `Procedure write "${step.targetId}" must reference a writable value node.`,
            span: step.span,
          });
        }
        if (step.kind === 'collection-mutation') {
          const validShape =
            (step.operation === 'add' &&
              step.value !== undefined &&
              step.predicate === undefined &&
              step.updater === undefined &&
              step.limit === undefined) ||
            (step.operation === 'remove' &&
              step.value === undefined &&
              step.predicate !== undefined &&
              step.updater === undefined) ||
            (step.operation === 'update' &&
              step.value === undefined &&
              step.predicate !== undefined &&
              step.updater !== undefined);
          if (!validShape) {
            diagnostics.push({
              code: 'OXE3006',
              message: `Collection ${step.operation} step has an invalid payload.`,
              span: step.span,
            });
          }
          for (const callback of [step.predicate, step.updater]) {
            if (callback && callback.parameters.length !== 1) {
              diagnostics.push({
                code: 'OXE3006',
                message: `Collection ${step.operation} callbacks require exactly one parameter.`,
                span: callback.span,
              });
            }
          }
        }
      }
    } else if (node.kind === 'component') {
      for (const parameterId of node.parameters) {
        requireReference(parameterId, node.span);
      }
    } else if (node.kind === 'component-parameter') {
      requireReference(node.ownerId, node.span);
    } else if (node.kind === 'component-instance') {
      requireReference(node.componentId, node.span);
      const component = nodes.get(node.componentId);
      if (component && component.kind !== 'component') {
        diagnostics.push({
          code: 'OXE3003',
          message: `Component instance "${node.id}" must reference a component node.`,
          span: node.span,
        });
      }
    } else if (node.kind === 'context-consumer' || node.kind === 'context-provider') {
      requireReference(node.contextId, node.span);
      const context = nodes.get(node.contextId);
      if (context && context.kind !== 'context') {
        diagnostics.push({
          code: 'OXE3003',
          message: `Context reference "${node.contextId}" must reference a context node.`,
          span: node.span,
        });
      }
    } else if (node.kind === 'content-reference') {
      requireReference(node.contentId, node.span);
      const content = nodes.get(node.contentId);
      if (content && content.kind !== 'content-value') {
        diagnostics.push({
          code: 'OXE3003',
          message: `Content reference "${node.contentId}" must reference a content value node.`,
          span: node.span,
        });
      }
    } else if (node.kind === 'content-value') {
      for (const branch of node.branches) {
        requireReference(branch.resultId, branch.span);
        for (const effectId of branch.effectIds) {
          requireReference(effectId, branch.span);
        }
      }
    } else if (node.kind === 'effect') {
      requireReference(node.ownerId, node.span);
    } else if (node.kind === 'content-slot') {
      requireReference(node.parameterId, node.span);
    } else if (node.kind === 'keyed-collection') {
      requireReference(node.itemId, node.span);
      const item = nodes.get(node.itemId);
      if (item && (item.kind !== 'collection-item' || item.ownerId !== node.id)) {
        diagnostics.push({
          code: 'OXE3003',
          message: `Keyed collection "${node.id}" must reference its owned collection item node.`,
          span: node.span,
        });
      }
    } else if (node.kind === 'collection-item') {
      requireReference(node.ownerId, node.span);
      const owner = nodes.get(node.ownerId);
      if (owner && (owner.kind !== 'keyed-collection' || owner.itemId !== node.id)) {
        diagnostics.push({
          code: 'OXE3003',
          message: `Collection item "${node.id}" must belong to its keyed collection.`,
          span: node.span,
        });
      }
    } else if (node.kind === 'platform-capability') {
      if (node.path.length === 0 || node.path.some((segment) => segment.length === 0)) {
        diagnostics.push({
          code: 'OXE3006',
          message: `Platform capability "${node.id}" must have a non-empty path.`,
          span: node.span,
        });
      }
      if (node.capabilityKind === 'resource' && node.dispose !== 'dispose') {
        diagnostics.push({
          code: 'OXE3006',
          message: `Resource capability "${node.id}" must declare its disposal contract.`,
          span: node.span,
        });
      }
    } else if (node.kind === 'ref') {
      requireReference(node.elementId, node.span);
      const element = nodes.get(node.elementId);
      if (element && element.kind !== 'element') {
        diagnostics.push({
          code: 'OXE3003',
          message: `Ref "${node.id}" must reference a platform element node.`,
          span: node.span,
        });
      }
    }
  }

  for (const edge of graph.edges) {
    const span = edgeSpan(edge, nodes, fallback);
    requireReference(edge.from, span);
    requireReference(edge.to, span);
    if (!edgeKindsAreValid(edge, nodes)) {
      diagnostics.push({
        code: 'OXE3003',
        message: `Invalid ${edge.kind} edge from "${edge.from}" to "${edge.to}".`,
        span,
      });
    }

    if (edge.kind === 'prop' && edge.mode === 'reactive') {
      validateExpressionStructure(edge.value, diagnostics);
      const references: ExpressionReference[] = [];
      collectExpressionReferences(edge.value, references);
      for (const reference of references) {
        requireReference(reference.targetId, reference.span);
        const target = nodes.get(reference.targetId);
        if (
          target &&
          target.kind !== 'async-resource' &&
          target.kind !== 'cell' &&
          target.kind !== 'computed' &&
          target.kind !== 'constant' &&
          target.kind !== 'collection-item' &&
          target.kind !== 'context-consumer' &&
          target.kind !== 'ref' &&
          !(target.kind === 'component-parameter' && target.parameterKind === 'value')
        ) {
          diagnostics.push({
            code: 'OXE3003',
            message: `Reactive prop read "${reference.targetId}" must reference a value node.`,
            span: reference.span,
          });
        }
      }
    } else if (edge.kind === 'prop' && edge.mode === 'procedure') {
      requireReference(edge.targetId, edge.span);
      const target = nodes.get(edge.targetId);
      if (
        target &&
        target.kind !== 'procedure' &&
        !(target.kind === 'component-parameter' && target.parameterKind === 'procedure')
      ) {
        diagnostics.push({
          code: 'OXE3003',
          message: `Procedure prop target "${edge.targetId}" must reference a procedure capability.`,
          span: edge.span,
        });
      }
    } else if (edge.kind === 'spread-prop' && edge.source.kind === 'rest') {
      requireReference(edge.source.targetId, edge.source.span);
      const target = nodes.get(edge.source.targetId);
      if (target && !(target.kind === 'component-parameter' && target.parameterKind === 'rest')) {
        diagnostics.push({
          code: 'OXE3003',
          message: `Rest prop spread source "${edge.source.targetId}" must reference a rest parameter.`,
          span: edge.source.span,
        });
      }
    } else if (edge.kind === 'spread-prop' && edge.source.kind === 'value') {
      validateExpressionStructure(edge.source.value, diagnostics);
      const references: ExpressionReference[] = [];
      collectExpressionReferences(edge.source.value, references);
      for (const reference of references) {
        requireReference(reference.targetId, reference.span);
        const target = nodes.get(reference.targetId);
        if (
          target &&
          target.kind !== 'cell' &&
          target.kind !== 'computed' &&
          target.kind !== 'constant' &&
          target.kind !== 'collection-item' &&
          !(target.kind === 'component-parameter' && target.parameterKind === 'value')
        ) {
          diagnostics.push({
            code: 'OXE3003',
            message: `Prop spread read "${reference.targetId}" must reference a value node.`,
            span: reference.span,
          });
        }
      }
    }
  }

  validateProjection(graph, nodes, diagnostics, fallback);
  validateChildTopology(graph, nodes, diagnostics, fallback);
  validateComponentComposition(graph, nodes, diagnostics, fallback);
  return diagnostics;
};
