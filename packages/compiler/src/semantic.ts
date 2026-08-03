import {
  validateUiGraph,
  type ComponentInstanceNodeV1,
  type ComponentNodeV1,
  type ComponentParameterNodeV1,
  type ConditionalRegionNodeV1,
  type CollectionItemNodeV1,
  type DynamicAttributeV1,
  type GraphSpanV1,
  type KeyedCollectionNodeV1,
  type LiteralValueV1,
  type PrimitiveTypeV1,
  type ProcedureNodeV1,
  type TextPartV1,
  type UiEdgeV1,
  type UiGraphV1,
  type UiNodeV1,
  type ValueExpressionV1,
  type WriteStepV1,
} from '@oxe/graph';

import type {
  AssignmentStatementNode,
  AttributeNode,
  ComponentDeclarationNode,
  ComponentParameterNode,
  ElementNode,
  ExpressionNode,
  HandlerDeclarationNode,
  IdentifierNode,
  IfRegionNode,
  InterpolationNode,
  MapExpressionNode,
  MarkupChildNode,
  ModuleNode,
  SpreadAttributeNode,
  TextNode,
} from './ast.js';
import type { Diagnostic, DiagnosticCode, RelatedDiagnostic } from './diagnostics.js';
import {
  normalizeProjectModuleId,
  OxeModulePathError,
  resolveImportModuleId,
} from './module-path.js';
import { parseSource } from './parser.js';
import type { SourceSpan } from './source.js';

type LiteralValue = LiteralValueV1 | readonly LiteralValueV1[];
const isLiteralScalar = (value: LiteralValue): value is LiteralValueV1 =>
  typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string';
type SemanticDiagnosticCode = Extract<DiagnosticCode, `OXE2${string}`>;
type ValueClassification = 'cell' | 'computed' | 'constant';

interface BindingInfo {
  readonly declaration: AssignmentStatementNode;
  readonly id: string;
  classification: ValueClassification;
  expression: ValueExpressionV1 | undefined;
  type: PrimitiveTypeV1;
  itemType?: PrimitiveTypeV1;
}

interface ValueSymbol {
  readonly id: string;
  type: PrimitiveTypeV1;
  itemType?: PrimitiveTypeV1;
}

type ParameterKind = 'children' | 'procedure' | 'rest' | 'value';

interface ParameterInfo extends ValueSymbol {
  readonly declaration: IdentifierNode;
  index: number;
  readonly syntax: ComponentParameterNode | undefined;
  defaultExpression: ValueExpressionV1 | undefined;
  parameterKind: ParameterKind | undefined;
}

interface ProcedureInfo {
  readonly declaration: HandlerDeclarationNode;
  readonly id: string;
}

interface ComponentSymbols {
  readonly bindings: Map<string, BindingInfo>;
  readonly component: ComponentDeclarationNode;
  readonly componentId: string;
  readonly parameters: Map<string, ParameterInfo>;
  readonly procedures: Map<string, ProcedureInfo>;
  readonly renderRoots: (ElementNode | IfRegionNode)[];
  readonly values: Map<string, ValueSymbol>;
}

interface ComponentInvocation {
  readonly arguments: ReadonlyMap<string, AttributeNode>;
  readonly element: ElementNode;
  readonly owner: ComponentSymbols;
  readonly spreads: readonly SpreadAttributeNode[];
  readonly target: ComponentSymbols;
}

interface LoweredValueProp {
  readonly attribute: AttributeNode;
  readonly invocation: ComponentInvocation;
  readonly parameter: ParameterInfo;
  readonly value: ValueExpressionV1;
}

interface AnalysisState {
  readonly diagnostics: Diagnostic[];
  readonly diagnosticKeys: Set<string>;
}

export interface AnalyzeResult {
  readonly ast: ModuleNode;
  readonly diagnostics: readonly Diagnostic[];
  readonly graph?: UiGraphV1;
}

export type LoadOxeModule = (normalizedModuleId: string) => Promise<string | undefined>;

export interface AnalyzeProjectOptions {
  readonly entryModuleId: string;
  readonly entryExport: string;
  readonly loadModule: LoadOxeModule;
}

export interface AnalyzedProjectModule {
  readonly moduleId: string;
  readonly ast: ModuleNode;
}

export interface AnalyzeProjectResult {
  readonly entryModuleId: string;
  readonly modules: readonly AnalyzedProjectModule[];
  readonly diagnostics: readonly Diagnostic[];
  readonly graph?: UiGraphV1;
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const graphSpan = (value: SourceSpan): GraphSpanV1 => value;

const spanFrom = (first: SourceSpan, last: SourceSpan): GraphSpanV1 => ({
  fileName: first.fileName,
  start: first.start,
  end: last.end,
});

const identifierSegment = (name: string): string => encodeURIComponent(name);

const componentId = (moduleId: string, name: string): string =>
  `${moduleId}#component/${identifierSegment(name)}`;

const bindingId = (ownerId: string, name: string): string =>
  `${ownerId}/binding/${identifierSegment(name)}`;

const parameterId = (ownerId: string, name: string): string =>
  `${ownerId}/parameter/${identifierSegment(name)}`;

const procedureId = (ownerId: string, name: string): string =>
  `${ownerId}/procedure/${identifierSegment(name)}`;

const report = (
  state: AnalysisState,
  code: SemanticDiagnosticCode,
  message: string,
  span: SourceSpan,
  related?: readonly RelatedDiagnostic[],
): void => {
  const key = `${code}\0${span.fileName}\0${span.start.offset}\0${message}`;
  if (state.diagnosticKeys.has(key)) {
    return;
  }
  state.diagnosticKeys.add(key);
  state.diagnostics.push({
    code,
    message,
    severity: 'error',
    span,
    ...(related ? { related } : {}),
  });
};

const markExpressionUntracked = (expression: ValueExpressionV1): ValueExpressionV1 => {
  switch (expression.kind) {
    case 'array':
      return {
        ...expression,
        elements: expression.elements.map(markExpressionUntracked),
      };
    case 'binary':
      return {
        ...expression,
        left: markExpressionUntracked(expression.left),
        right: markExpressionUntracked(expression.right),
      };
    case 'literal':
      return expression;
    case 'read':
      return { ...expression, tracked: false };
  }
};

const lowerExpression = (
  expression: ExpressionNode,
  values: ReadonlyMap<string, ValueSymbol>,
  scopeName: string,
  state: AnalysisState,
): ValueExpressionV1 | undefined => {
  switch (expression.kind) {
    case 'ArrayLiteral': {
      const elements = expression.elements.flatMap((element) => {
        const lowered = lowerExpression(element, values, scopeName, state);
        return lowered ? [lowered] : [];
      });
      return { kind: 'array', elements, span: graphSpan(expression.span) };
    }
    case 'BooleanLiteral':
    case 'StringLiteral':
      return { kind: 'literal', value: expression.value, span: graphSpan(expression.span) };
    case 'NumberLiteral':
      if (!Number.isFinite(expression.value)) {
        report(state, 'OXE2009', 'Numeric literals must produce a finite number.', expression.span);
        return undefined;
      }
      return { kind: 'literal', value: expression.value, span: graphSpan(expression.span) };
    case 'Identifier': {
      const target = values.get(expression.name);
      if (!target) {
        report(
          state,
          'OXE2002',
          `Cannot resolve "${expression.name}" in ${scopeName}.`,
          expression.span,
        );
        return undefined;
      }
      return { kind: 'read', targetId: target.id, span: graphSpan(expression.span) };
    }
    case 'ParenthesizedExpression':
      return lowerExpression(expression.expression, values, scopeName, state);
    case 'BinaryExpression': {
      const left = lowerExpression(expression.left, values, scopeName, state);
      const right = lowerExpression(expression.right, values, scopeName, state);
      if (!left || !right) {
        return undefined;
      }
      return {
        kind: 'binary',
        operator: expression.operator,
        left,
        right,
        span: graphSpan(expression.span),
      };
    }
    case 'MapExpression':
      report(
        state,
        'OXE2008',
        'A markup-producing map expression is only valid as UI content.',
        expression.span,
      );
      return undefined;
    case 'UntrackExpression': {
      const value = lowerExpression(expression.expression, values, scopeName, state);
      return value ? markExpressionUntracked(value) : undefined;
    }
  }
};

interface ReadReference {
  readonly span: GraphSpanV1;
  readonly targetId: string;
}

const collectReads = (expression: ValueExpressionV1, result: ReadReference[]): void => {
  switch (expression.kind) {
    case 'array':
      for (const element of expression.elements) {
        collectReads(element, result);
      }
      return;
    case 'binary':
      collectReads(expression.left, result);
      collectReads(expression.right, result);
      return;
    case 'literal':
      return;
    case 'read':
      if (expression.tracked === false) {
        return;
      }
      result.push({ targetId: expression.targetId, span: expression.span });
      return;
  }
};

const uniqueReadIds = (expression: ValueExpressionV1): readonly string[] => {
  const reads: ReadReference[] = [];
  collectReads(expression, reads);
  return [...new Set(reads.map((read) => read.targetId))].sort(compareText);
};

const classifyBindings = (
  bindings: ReadonlyMap<string, BindingInfo>,
  writtenIds: ReadonlySet<string>,
): void => {
  const byId = new Map([...bindings.values()].map((binding) => [binding.id, binding]));
  const states = new Map<string, 'constant' | 'dynamic' | 'visiting'>();

  const expressionIsConstant = (expression: ValueExpressionV1): boolean => {
    switch (expression.kind) {
      case 'array':
        return expression.elements.every(expressionIsConstant);
      case 'literal':
        return true;
      case 'binary':
        return expressionIsConstant(expression.left) && expressionIsConstant(expression.right);
      case 'read': {
        const dependency = byId.get(expression.targetId);
        return dependency ? bindingIsConstant(dependency) : false;
      }
    }
  };

  const bindingIsConstant = (binding: BindingInfo): boolean => {
    if (writtenIds.has(binding.id) || !binding.expression) {
      return false;
    }
    const state = states.get(binding.id);
    if (state === 'constant') {
      return true;
    }
    if (state === 'dynamic' || state === 'visiting') {
      return false;
    }

    states.set(binding.id, 'visiting');
    const constant = expressionIsConstant(binding.expression);
    states.set(binding.id, constant ? 'constant' : 'dynamic');
    return constant;
  };

  for (const binding of bindings.values()) {
    binding.classification = writtenIds.has(binding.id)
      ? 'cell'
      : bindingIsConstant(binding)
        ? 'constant'
        : 'computed';
  }
};

const canonicalCycle = (ids: readonly string[]): readonly string[] => {
  if (ids.length === 0) {
    return ids;
  }
  const rotations = ids.map((_, index) => [...ids.slice(index), ...ids.slice(0, index)]);
  rotations.sort((left, right) => compareText(left.join('\0'), right.join('\0')));
  return rotations[0] ?? ids;
};

const diagnoseCycles = (bindings: ReadonlyMap<string, BindingInfo>, state: AnalysisState): void => {
  const byId = new Map([...bindings.values()].map((binding) => [binding.id, binding]));
  const visitState = new Map<string, 'done' | 'visiting'>();
  const path: string[] = [];
  const reported = new Set<string>();

  const visit = (id: string): void => {
    if (visitState.get(id) === 'done') {
      return;
    }
    if (visitState.get(id) === 'visiting') {
      const start = path.indexOf(id);
      const rawCycle = start < 0 ? [id] : path.slice(start);
      const cycle = canonicalCycle(rawCycle);
      const key = [...cycle].sort(compareText).join('\0');
      if (!reported.has(key)) {
        reported.add(key);
        const names = cycle.map((cycleId) => byId.get(cycleId)?.declaration.target.name ?? cycleId);
        const first = cycle[0];
        const source = first ? byId.get(first) : undefined;
        if (source) {
          report(
            state,
            'OXE2004',
            `Reactive cycle detected: ${[...names, names[0]].join(' -> ')}.`,
            source.declaration.value.span,
          );
        }
      }
      return;
    }

    const binding = byId.get(id);
    if (!binding || binding.classification === 'cell' || !binding.expression) {
      visitState.set(id, 'done');
      return;
    }

    visitState.set(id, 'visiting');
    path.push(id);
    for (const dependencyId of uniqueReadIds(binding.expression)) {
      visit(dependencyId);
    }
    path.pop();
    visitState.set(id, 'done');
  };

  for (const id of [...byId.keys()].sort(compareText)) {
    visit(id);
  }
};

const inferBinaryType = (
  expression: Extract<ValueExpressionV1, { kind: 'binary' }>,
  left: PrimitiveTypeV1,
  right: PrimitiveTypeV1,
  state: AnalysisState,
): PrimitiveTypeV1 => {
  if (left === 'unknown' || right === 'unknown') {
    return 'unknown';
  }

  if (expression.operator === '+') {
    if (left === right && (left === 'number' || left === 'string')) {
      return left;
    }
    report(
      state,
      'OXE2009',
      `Operator + requires two numbers or two strings, but received ${left} and ${right}.`,
      expression.span,
    );
    return 'unknown';
  }

  if (expression.operator === '==' || expression.operator === '!=') {
    if (left === right) {
      return 'boolean';
    }
    report(
      state,
      'OXE2009',
      `Operator ${expression.operator} requires matching types, but received ${left} and ${right}.`,
      expression.span,
    );
    return 'unknown';
  }

  if (expression.operator === 'and' || expression.operator === 'or') {
    if (left === 'boolean' && right === 'boolean') {
      return 'boolean';
    }
    report(
      state,
      'OXE2009',
      `Operator ${expression.operator} requires Booleans, but received ${left} and ${right}.`,
      expression.span,
    );
    return 'unknown';
  }

  if (left === 'number' && right === 'number') {
    return 'number';
  }
  report(
    state,
    'OXE2009',
    `Operator ${expression.operator} requires numbers, but received ${left} and ${right}.`,
    expression.span,
  );
  return 'unknown';
};

const inferExpressionTypeWithoutDiagnostics = (
  expression: ValueExpressionV1,
  valuesById: ReadonlyMap<string, ValueSymbol>,
): PrimitiveTypeV1 => {
  switch (expression.kind) {
    case 'array':
      return 'array';
    case 'literal':
      return typeof expression.value as 'boolean' | 'number' | 'string';
    case 'read':
      return valuesById.get(expression.targetId)?.type ?? 'unknown';
    case 'binary': {
      const left = inferExpressionTypeWithoutDiagnostics(expression.left, valuesById);
      const right = inferExpressionTypeWithoutDiagnostics(expression.right, valuesById);
      if (left === 'unknown' || right === 'unknown') {
        return 'unknown';
      }
      if (expression.operator === '+') {
        return left === right && (left === 'number' || left === 'string') ? left : 'unknown';
      }
      if (expression.operator === '==' || expression.operator === '!=') {
        return left === right ? 'boolean' : 'unknown';
      }
      if (expression.operator === 'and' || expression.operator === 'or') {
        return left === 'boolean' && right === 'boolean' ? 'boolean' : 'unknown';
      }
      return left === 'number' && right === 'number' ? 'number' : 'unknown';
    }
  }
};

const inferArrayItemTypeWithoutDiagnostics = (
  expression: ValueExpressionV1,
  valuesById: ReadonlyMap<string, ValueSymbol>,
): PrimitiveTypeV1 | undefined => {
  if (expression.kind === 'read') {
    return valuesById.get(expression.targetId)?.itemType;
  }
  if (expression.kind !== 'array') {
    return undefined;
  }
  let itemType: PrimitiveTypeV1 | undefined;
  for (const element of expression.elements) {
    const current = inferExpressionTypeWithoutDiagnostics(element, valuesById);
    if (current === 'unknown' || current === 'array') {
      continue;
    }
    if (itemType && itemType !== current) {
      return undefined;
    }
    itemType = current;
  }
  return itemType;
};

const inferProjectValueTypes = (
  components: readonly ComponentSymbols[],
  valueProps: readonly LoweredValueProp[],
  state: AnalysisState,
): ReadonlyMap<string, ValueSymbol> => {
  const valuesById = new Map<string, ValueSymbol>();
  for (const component of components) {
    for (const value of component.values.values()) {
      valuesById.set(value.id, value);
    }
  }

  const maximumPasses = valuesById.size + valueProps.length + 1;
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    let changed = false;
    for (const component of components) {
      for (const parameter of component.parameters.values()) {
        if (parameter.type === 'unknown' && parameter.defaultExpression) {
          const inferred = inferExpressionTypeWithoutDiagnostics(
            parameter.defaultExpression,
            valuesById,
          );
          if (inferred !== 'unknown') {
            parameter.type = inferred;
            changed = true;
          }
          if (inferred === 'array') {
            const itemType = inferArrayItemTypeWithoutDiagnostics(
              parameter.defaultExpression,
              valuesById,
            );
            if (itemType) {
              parameter.itemType = itemType;
            }
          }
        }
      }
      for (const binding of component.bindings.values()) {
        if (binding.type !== 'unknown' || !binding.expression) {
          continue;
        }
        const inferred = inferExpressionTypeWithoutDiagnostics(binding.expression, valuesById);
        if (inferred !== 'unknown') {
          binding.type = inferred;
          if (inferred === 'array') {
            const itemType = inferArrayItemTypeWithoutDiagnostics(binding.expression, valuesById);
            if (itemType) {
              binding.itemType = itemType;
            }
          }
          changed = true;
        }
      }
    }
    for (const prop of valueProps) {
      if (prop.parameter.parameterKind !== 'value') {
        continue;
      }
      const inferred = inferExpressionTypeWithoutDiagnostics(prop.value, valuesById);
      if (prop.parameter.type === 'unknown' && inferred !== 'unknown') {
        prop.parameter.type = inferred;
        if (inferred === 'array') {
          const itemType = inferArrayItemTypeWithoutDiagnostics(prop.value, valuesById);
          if (itemType) {
            prop.parameter.itemType = itemType;
          }
        }
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }

  for (const component of components) {
    for (const binding of component.bindings.values()) {
      if (binding.expression) {
        const inferred = inferStandaloneExpression(binding.expression, valuesById, state);
        if (binding.type === 'unknown') {
          binding.type = inferred;
        }
      }
    }
    for (const parameter of component.parameters.values()) {
      if (parameter.defaultExpression) {
        const inferred = inferStandaloneExpression(parameter.defaultExpression, valuesById, state);
        if (parameter.type === 'unknown') {
          parameter.type = inferred;
        } else if (inferred !== 'unknown' && inferred !== parameter.type) {
          report(
            state,
            'OXE2013',
            `Default for prop "${parameter.declaration.name}" must be ${parameter.type}, but received ${inferred}.`,
            parameter.defaultExpression.span,
          );
        }
      }
      if (parameter.parameterKind === 'value' && parameter.type === 'unknown') {
        report(
          state,
          'OXE2015',
          `Cannot infer a concrete type for reactive prop "${parameter.declaration.name}".`,
          parameter.declaration.span,
        );
      }
    }
  }
  for (const prop of valueProps) {
    if (prop.parameter.parameterKind !== 'value') {
      continue;
    }
    const inferred = inferStandaloneExpression(prop.value, valuesById, state);
    if (
      inferred !== 'unknown' &&
      prop.parameter.type !== 'unknown' &&
      inferred !== prop.parameter.type
    ) {
      report(
        state,
        'OXE2013',
        `Prop "${prop.parameter.declaration.name}" expects ${prop.parameter.type}, but received ${inferred}.`,
        prop.attribute.value.span,
        [
          {
            message: 'The parameter contract is declared here.',
            span: prop.parameter.declaration.span,
          },
        ],
      );
    }
  }

  return valuesById;
};

const evaluateConstants = (
  bindings: ReadonlyMap<string, BindingInfo>,
  state: AnalysisState,
): ReadonlyMap<string, LiteralValue> => {
  const byId = new Map([...bindings.values()].map((binding) => [binding.id, binding]));
  const values = new Map<string, LiteralValue>();
  const visiting = new Set<string>();

  const evaluateExpression = (expression: ValueExpressionV1): LiteralValue | undefined => {
    switch (expression.kind) {
      case 'array': {
        const result: LiteralValueV1[] = [];
        for (const element of expression.elements) {
          const value = evaluateExpression(element);
          if (value === undefined || !isLiteralScalar(value)) {
            return undefined;
          }
          result.push(value);
        }
        return result;
      }
      case 'literal':
        return expression.value;
      case 'read': {
        const binding = byId.get(expression.targetId);
        return binding ? evaluateBinding(binding) : undefined;
      }
      case 'binary': {
        const left = evaluateExpression(expression.left);
        const right = evaluateExpression(expression.right);
        if (left === undefined || right === undefined) {
          return undefined;
        }
        if (expression.operator === '+' && typeof left === 'string' && typeof right === 'string') {
          return left + right;
        }
        if (expression.operator === '==') {
          return Object.is(left, right);
        }
        if (expression.operator === '!=') {
          return !Object.is(left, right);
        }
        if (
          expression.operator === 'and' &&
          typeof left === 'boolean' &&
          typeof right === 'boolean'
        ) {
          return left && right;
        }
        if (
          expression.operator === 'or' &&
          typeof left === 'boolean' &&
          typeof right === 'boolean'
        ) {
          return left || right;
        }
        if (typeof left !== 'number' || typeof right !== 'number') {
          return undefined;
        }
        const value = (() => {
          switch (expression.operator) {
            case '+':
              return left + right;
            case '-':
              return left - right;
            case '*':
              return left * right;
            case '/':
              return left / right;
            case '%':
              return left % right;
            case 'and':
            case 'or':
              return Number.NaN;
          }
        })();
        if (!Number.isFinite(value)) {
          report(
            state,
            'OXE2009',
            'A compile-time numeric expression must produce a finite number.',
            expression.span,
          );
          return undefined;
        }
        return value;
      }
    }
  };

  const evaluateBinding = (binding: BindingInfo): LiteralValue | undefined => {
    const cached = values.get(binding.id);
    if (cached !== undefined) {
      return cached;
    }
    if (binding.classification !== 'constant' || !binding.expression || visiting.has(binding.id)) {
      return undefined;
    }
    visiting.add(binding.id);
    const value = evaluateExpression(binding.expression);
    visiting.delete(binding.id);
    if (value !== undefined) {
      values.set(binding.id, value);
    }
    return value;
  };

  for (const binding of bindings.values()) {
    evaluateBinding(binding);
  }
  return values;
};

const addReadEdges = (
  edges: UiEdgeV1[],
  from: string,
  expressions: readonly ValueExpressionV1[],
  mode: 'procedural' | 'reactive',
): void => {
  const sitesByTarget = new Map<string, GraphSpanV1[]>();
  for (const expression of expressions) {
    const reads: ReadReference[] = [];
    collectReads(expression, reads);
    for (const read of reads) {
      const sites = sitesByTarget.get(read.targetId) ?? [];
      sites.push(read.span);
      sitesByTarget.set(read.targetId, sites);
    }
  }

  for (const targetId of [...sitesByTarget.keys()].sort(compareText)) {
    edges.push({
      kind: 'read',
      from,
      to: targetId,
      mode,
      sites: sitesByTarget.get(targetId) ?? [],
    });
  }
};

const addWriteEdges = (edges: UiEdgeV1[], procedure: ProcedureNodeV1): void => {
  const sitesByTarget = new Map<string, GraphSpanV1[]>();
  for (const step of procedure.steps) {
    const sites = sitesByTarget.get(step.targetId) ?? [];
    sites.push(step.span);
    sitesByTarget.set(step.targetId, sites);
  }
  for (const targetId of [...sitesByTarget.keys()].sort(compareText)) {
    edges.push({
      kind: 'write',
      from: procedure.id,
      to: targetId,
      mode: 'procedural',
      sites: sitesByTarget.get(targetId) ?? [],
    });
  }
};

const registerComponentSymbols = (
  component: ComponentDeclarationNode,
  moduleId: string,
  state: AnalysisState,
): ComponentSymbols => {
  const ownerId = componentId(moduleId, component.name.name);
  const bindings = new Map<string, BindingInfo>();
  const parameters = new Map<string, ParameterInfo>();
  const procedures = new Map<string, ProcedureInfo>();
  const renderRoots: (ElementNode | IfRegionNode)[] = [];
  const declarations = new Map<string, SourceSpan>();

  const register = (name: string, span: SourceSpan): boolean => {
    if (name === 'true' || name === 'false') {
      report(
        state,
        'OXE2008',
        `Declaration name "${name}" is reserved for a Boolean literal.`,
        span,
      );
      return false;
    }
    const previous = declarations.get(name);
    if (previous) {
      report(state, 'OXE2001', `Duplicate declaration "${name}".`, span, [
        { message: 'The first declaration is here.', span: previous },
      ]);
      return false;
    }
    declarations.set(name, span);
    return true;
  };

  component.parameters.forEach((parameter, index) => {
    if (register(parameter.name.name, parameter.span)) {
      const isChildren = parameter.name.name === 'children';
      if (isChildren) {
        report(
          state,
          'OXE2011',
          'The reserved children binding is implicit; remove it from the parameter list and render `{children}` where content belongs.',
          parameter.span,
        );
      }
      parameters.set(parameter.name.name, {
        declaration: parameter.name,
        id: parameterId(ownerId, parameter.name.name),
        index,
        syntax: parameter,
        defaultExpression: undefined,
        parameterKind:
          parameter.kind === 'RestComponentParameter'
            ? 'rest'
            : parameter.kind === 'DefaultComponentParameter'
              ? 'value'
              : undefined,
        type: 'unknown',
      });
    }
  });

  for (const statement of component.body) {
    switch (statement.kind) {
      case 'AssignmentStatement':
        if (register(statement.target.name, statement.target.span)) {
          bindings.set(statement.target.name, {
            declaration: statement,
            id: bindingId(ownerId, statement.target.name),
            classification: 'computed',
            expression: undefined,
            type: 'unknown',
          });
        }
        break;
      case 'HandlerDeclaration':
        if (register(statement.name.name, statement.name.span)) {
          procedures.set(statement.name.name, {
            declaration: statement,
            id: procedureId(ownerId, statement.name.name),
          });
        }
        break;
      case 'Element':
      case 'IfRegion':
        renderRoots.push(statement);
        break;
    }
  }

  const values = new Map<string, ValueSymbol>();
  for (const [name, parameter] of parameters) {
    values.set(name, parameter);
  }
  for (const [name, binding] of bindings) {
    values.set(name, binding);
  }

  return {
    bindings,
    component,
    componentId: ownerId,
    parameters,
    procedures,
    renderRoots,
    values,
  };
};

const orderedParameters = (component: ComponentSymbols): readonly ParameterInfo[] =>
  [...component.parameters.values()].sort((left, right) => left.index - right.index);

const ensureChildrenParameter = (
  component: ComponentSymbols,
  identifier: IdentifierNode,
  state: AnalysisState,
): ParameterInfo => {
  const existing = component.parameters.get('children');
  if (existing) {
    if (existing.parameterKind === 'children' && existing.declaration !== identifier) {
      report(
        state,
        'OXE2011',
        'A component may render the reserved children slot only once.',
        identifier.span,
        [{ message: 'The first children slot is here.', span: existing.declaration.span }],
      );
    }
    return existing;
  }
  const rest = [...component.parameters.values()].find(
    (parameter) => parameter.parameterKind === 'rest',
  );
  const index = rest?.index ?? component.parameters.size;
  if (rest) {
    rest.index += 1;
  }
  const parameter: ParameterInfo = {
    declaration: identifier,
    defaultExpression: undefined,
    id: parameterId(component.componentId, 'children'),
    index,
    parameterKind: 'children',
    syntax: undefined,
    type: 'unknown',
  };
  component.parameters.set('children', parameter);
  return parameter;
};

const visitExpressionIdentifiers = (
  expression: ExpressionNode,
  visit: (identifier: IdentifierNode) => void,
): void => {
  switch (expression.kind) {
    case 'ArrayLiteral':
      for (const element of expression.elements) {
        visitExpressionIdentifiers(element, visit);
      }
      return;
    case 'Identifier':
      visit(expression);
      return;
    case 'BinaryExpression':
      visitExpressionIdentifiers(expression.left, visit);
      visitExpressionIdentifiers(expression.right, visit);
      return;
    case 'ParenthesizedExpression':
      visitExpressionIdentifiers(expression.expression, visit);
      return;
    case 'MapExpression':
      visitExpressionIdentifiers(expression.collection, visit);
      return;
    case 'UntrackExpression':
      visitExpressionIdentifiers(expression.expression, visit);
      return;
    case 'BooleanLiteral':
    case 'NumberLiteral':
    case 'StringLiteral':
      return;
  }
};

const markParameterKind = (
  parameter: ParameterInfo,
  kind: ParameterKind,
  site: SourceSpan,
  state: AnalysisState,
): boolean => {
  if (!parameter.parameterKind) {
    parameter.parameterKind = kind;
    return true;
  }
  if (parameter.parameterKind !== kind) {
    report(
      state,
      'OXE2012',
      `Parameter "${parameter.declaration.name}" cannot be both a ${parameter.parameterKind} prop and a ${kind} prop.`,
      site,
      [{ message: 'The parameter is declared here.', span: parameter.declaration.span }],
    );
  }
  return false;
};

const markExpressionParametersAsValues = (
  expression: ExpressionNode,
  component: ComponentSymbols,
  state: AnalysisState,
): boolean => {
  let changed = false;
  visitExpressionIdentifiers(expression, (identifier) => {
    const parameter = component.parameters.get(identifier.name);
    if (parameter) {
      changed = markParameterKind(parameter, 'value', identifier.span, state) || changed;
    }
  });
  return changed;
};

const scanDirectParameterUses = (component: ComponentSymbols, state: AnalysisState): void => {
  for (const parameter of component.parameters.values()) {
    if (parameter.syntax?.kind === 'DefaultComponentParameter') {
      markExpressionParametersAsValues(parameter.syntax.defaultValue, component, state);
    }
  }
  for (const binding of component.bindings.values()) {
    markExpressionParametersAsValues(binding.declaration.value, component, state);
  }
  for (const procedure of component.procedures.values()) {
    for (const assignment of procedure.declaration.body) {
      markExpressionParametersAsValues(assignment.value, component, state);
    }
  }

  const scanElement = (element: ElementNode): void => {
    if (/^[a-z]/u.test(element.name.name)) {
      for (const attribute of element.attributes) {
        if (attribute.kind === 'SpreadAttribute') {
          continue;
        }
        if (attribute.name.name === 'onClick' && attribute.value.kind === 'Identifier') {
          const parameter = component.parameters.get(attribute.value.name);
          if (parameter) {
            markParameterKind(parameter, 'procedure', attribute.value.span, state);
          }
        } else {
          markExpressionParametersAsValues(attribute.value, component, state);
        }
      }
    }
    for (const child of element.children) {
      if (child.kind === 'Element') {
        scanElement(child);
      } else if (child.kind === 'IfRegion') {
        scanIfRegion(child);
      } else if (child.kind === 'Interpolation') {
        const isChildrenSlot =
          child.expression.kind === 'Identifier' && child.expression.name === 'children';
        if (isChildrenSlot) {
          ensureChildrenParameter(component, child.expression, state);
        } else if (child.expression.kind === 'MapExpression') {
          markExpressionParametersAsValues(child.expression.collection, component, state);
          scanElement(child.expression.body);
        } else {
          markExpressionParametersAsValues(child.expression, component, state);
        }
      }
    }
  };

  const scanIfRegion = (region: IfRegionNode): void => {
    for (const branch of region.branches) {
      if (branch.condition) {
        markExpressionParametersAsValues(branch.condition, component, state);
      }
      scanElement(branch.result);
    }
  };

  for (const root of component.renderRoots) {
    if (root.kind === 'Element') {
      scanElement(root);
    } else {
      scanIfRegion(root);
    }
  }
};

const collectComponentInvocations = (
  components: ReadonlyMap<string, ComponentSymbols>,
  componentScopes: ReadonlyMap<string, ReadonlyMap<string, ComponentSymbols>>,
  state: AnalysisState,
): readonly ComponentInvocation[] => {
  const invocations: ComponentInvocation[] = [];

  const visitElement = (element: ElementNode, owner: ComponentSymbols): void => {
    if (/^[A-Z]/u.test(element.name.name)) {
      const target = componentScopes.get(owner.componentId)?.get(element.name.name);
      if (!target) {
        report(
          state,
          'OXE2010',
          `Cannot resolve component "${element.name.name}" in component "${owner.component.name.name}".`,
          element.name.span,
        );
        return;
      }

      const argumentsByName = new Map<string, AttributeNode>();
      const spreads: SpreadAttributeNode[] = [];
      const restParameter = [...target.parameters.values()].find(
        (parameter) => parameter.parameterKind === 'rest',
      );
      const childrenParameter = target.parameters.get('children');
      for (const attribute of element.attributes) {
        if (attribute.kind === 'SpreadAttribute') {
          spreads.push(attribute);
          if (!restParameter) {
            report(
              state,
              'OXE2011',
              `Component <${target.component.name.name}> does not declare a rest prop for {...spread}.`,
              attribute.span,
            );
          }
          if (attribute.value.kind !== 'Identifier') {
            report(
              state,
              'OXE2012',
              'A component prop spread must name a rest parameter.',
              attribute.value.span,
            );
          } else {
            const source = owner.parameters.get(attribute.value.name);
            if (source?.parameterKind !== 'rest') {
              report(
                state,
                'OXE2012',
                `Spread source "${attribute.value.name}" is not a rest parameter.`,
                attribute.value.span,
              );
            }
          }
          continue;
        }
        const previous = argumentsByName.get(attribute.name.name);
        if (previous) {
          report(
            state,
            'OXE2001',
            `Duplicate prop "${attribute.name.name}" on <${target.component.name.name}>.`,
            attribute.name.span,
            [{ message: 'The first prop is here.', span: previous.name.span }],
          );
          continue;
        }
        argumentsByName.set(attribute.name.name, attribute);
        const declared = target.parameters.get(attribute.name.name);
        if (attribute.name.name === 'children') {
          report(
            state,
            'OXE2011',
            'Child content must use the indented component body, not a named children prop.',
            attribute.name.span,
          );
        } else if (declared?.parameterKind === 'rest') {
          report(
            state,
            'OXE2011',
            `Rest parameter "${declared.declaration.name}" cannot be supplied as a named prop.`,
            attribute.name.span,
          );
        } else if (!declared && !restParameter) {
          report(
            state,
            'OXE2011',
            `Unknown prop "${attribute.name.name}" on <${target.component.name.name}>.`,
            attribute.name.span,
          );
        }
      }

      for (const parameter of target.parameters.values()) {
        const required =
          parameter.syntax?.kind === 'RequiredComponentParameter' &&
          parameter.parameterKind !== 'children';
        if (required && !argumentsByName.has(parameter.declaration.name)) {
          report(
            state,
            'OXE2011',
            `Missing required prop "${parameter.declaration.name}" on <${target.component.name.name}>.`,
            element.name.span,
            [
              {
                message: 'The required parameter is declared here.',
                span: parameter.declaration.span,
              },
            ],
          );
        }
      }
      if (!childrenParameter && element.children.length > 0) {
        report(
          state,
          'OXE2011',
          `Component <${target.component.name.name}> does not declare a children parameter.`,
          element.children[0]?.span ?? element.span,
        );
      }

      invocations.push({ arguments: argumentsByName, element, owner, spreads, target });
      for (const child of element.children) {
        if (child.kind === 'Element') {
          visitElement(child, owner);
        } else if (child.kind === 'IfRegion') {
          visitIfRegion(child, owner);
        } else if (child.kind === 'Interpolation' && child.expression.kind === 'MapExpression') {
          visitElement(child.expression.body, owner);
        }
      }
      return;
    }

    if (!/^[a-z][A-Za-z0-9]*$/u.test(element.name.name)) {
      report(
        state,
        'OXE2008',
        `Platform element "${element.name.name}" must begin with a lowercase letter, or a local component must begin with uppercase.`,
        element.name.span,
      );
    }
    for (const child of element.children) {
      if (child.kind === 'Element') {
        visitElement(child, owner);
      } else if (child.kind === 'IfRegion') {
        visitIfRegion(child, owner);
      } else if (child.kind === 'Interpolation' && child.expression.kind === 'MapExpression') {
        visitElement(child.expression.body, owner);
      }
    }
  };

  const visitIfRegion = (region: IfRegionNode, owner: ComponentSymbols): void => {
    for (const branch of region.branches) {
      visitElement(branch.result, owner);
    }
  };

  for (const component of components.values()) {
    for (const root of component.renderRoots) {
      if (root.kind === 'Element') {
        visitElement(root, component);
      } else {
        visitIfRegion(root, component);
      }
    }
  }
  return invocations;
};

const inferParameterKinds = (
  components: ReadonlyMap<string, ComponentSymbols>,
  invocations: readonly ComponentInvocation[],
  state: AnalysisState,
): void => {
  const constrainArgument = (
    invocation: ComponentInvocation,
    parameter: ParameterInfo,
    attribute: AttributeNode,
  ): boolean => {
    const expression = attribute.value;
    if (parameter.parameterKind === 'procedure') {
      if (expression.kind !== 'Identifier') {
        report(
          state,
          'OXE2012',
          `Procedure prop "${parameter.declaration.name}" requires a procedure name.`,
          expression.span,
        );
        return false;
      }
      const forwarded = invocation.owner.parameters.get(expression.name);
      if (forwarded) {
        return markParameterKind(forwarded, 'procedure', expression.span, state);
      }
      if (!invocation.owner.procedures.has(expression.name)) {
        report(
          state,
          'OXE2012',
          `Procedure prop "${parameter.declaration.name}" requires a procedure capability, but "${expression.name}" is not one.`,
          expression.span,
        );
      }
      return false;
    }

    if (parameter.parameterKind === 'value') {
      if (expression.kind === 'Identifier' && invocation.owner.procedures.has(expression.name)) {
        report(
          state,
          'OXE2012',
          `Value prop "${parameter.declaration.name}" cannot receive procedure "${expression.name}".`,
          expression.span,
        );
        return false;
      }
      return markExpressionParametersAsValues(expression, invocation.owner, state);
    }

    if (expression.kind === 'Identifier') {
      if (invocation.owner.procedures.has(expression.name)) {
        return markParameterKind(parameter, 'procedure', expression.span, state);
      }
      const forwarded = invocation.owner.parameters.get(expression.name);
      if (forwarded?.parameterKind) {
        const targetChanged = markParameterKind(
          parameter,
          forwarded.parameterKind,
          expression.span,
          state,
        );
        return targetChanged;
      }
    }

    const targetChanged = markParameterKind(parameter, 'value', expression.span, state);
    return markExpressionParametersAsValues(expression, invocation.owner, state) || targetChanged;
  };

  const maximumPasses =
    [...components.values()].reduce((count, component) => count + component.parameters.size, 0) +
    invocations.length +
    1;
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    let changed = false;
    for (const invocation of invocations) {
      for (const parameter of invocation.target.parameters.values()) {
        const attribute = invocation.arguments.get(parameter.declaration.name);
        if (attribute) {
          changed = constrainArgument(invocation, parameter, attribute) || changed;
        }
      }
    }
    if (!changed) {
      break;
    }
  }

  for (const component of components.values()) {
    for (const parameter of component.parameters.values()) {
      if (!parameter.parameterKind) {
        report(
          state,
          'OXE2015',
          `Cannot infer whether parameter "${parameter.declaration.name}" is a reactive value or a procedure capability. Use it or pass a concrete prop so the contract is unambiguous.`,
          parameter.declaration.span,
        );
      }
    }
  }
};

const diagnoseComponentCycles = (
  components: ReadonlyMap<string, ComponentSymbols>,
  invocations: readonly ComponentInvocation[],
  state: AnalysisState,
): void => {
  const targets = new Map<string, Set<string>>();
  for (const invocation of invocations) {
    const outgoing = targets.get(invocation.owner.componentId) ?? new Set<string>();
    outgoing.add(invocation.target.componentId);
    targets.set(invocation.owner.componentId, outgoing);
  }

  const byId = new Map(
    [...components.values()].map((component) => [component.componentId, component]),
  );
  const status = new Map<string, 'done' | 'visiting'>();
  const path: string[] = [];
  const reported = new Set<string>();
  const visit = (id: string): void => {
    if (status.get(id) === 'done') {
      return;
    }
    if (status.get(id) === 'visiting') {
      const start = path.indexOf(id);
      const cycle = start < 0 ? [id] : path.slice(start);
      const key = [...cycle].sort(compareText).join('\0');
      if (!reported.has(key)) {
        reported.add(key);
        const source = byId.get(id);
        const names = cycle.map((item) => byId.get(item)?.component.name.name ?? item);
        if (source) {
          report(
            state,
            'OXE2014',
            `Recursive component composition is not supported: ${[...names, names[0]].join(' -> ')}.`,
            source.component.name.span,
          );
        }
      }
      return;
    }
    status.set(id, 'visiting');
    path.push(id);
    for (const target of [...(targets.get(id) ?? [])].sort(compareText)) {
      visit(target);
    }
    path.pop();
    status.set(id, 'done');
  };

  for (const component of components.values()) {
    visit(component.componentId);
  }
};

const lowerInvocationValueProps = (
  invocations: readonly ComponentInvocation[],
  state: AnalysisState,
): {
  readonly byInvocation: ReadonlyMap<
    ComponentInvocation,
    ReadonlyMap<AttributeNode, LoweredValueProp>
  >;
  readonly values: readonly LoweredValueProp[];
} => {
  const byInvocation = new Map<ComponentInvocation, ReadonlyMap<AttributeNode, LoweredValueProp>>();
  const values: LoweredValueProp[] = [];

  for (const invocation of invocations) {
    const props = new Map<AttributeNode, LoweredValueProp>();
    const rest = [...invocation.target.parameters.values()].find(
      (parameter) => parameter.parameterKind === 'rest',
    );
    for (const attribute of invocation.element.attributes) {
      if (attribute.kind !== 'Attribute') {
        continue;
      }
      const declared = invocation.target.parameters.get(attribute.name.name);
      const parameter =
        declared?.parameterKind === 'value' ? declared : declared ? undefined : rest;
      if (!parameter) {
        continue;
      }
      const isProcedureCapability =
        attribute.value.kind === 'Identifier' &&
        (invocation.owner.procedures.has(attribute.value.name) ||
          invocation.owner.parameters.get(attribute.value.name)?.parameterKind === 'procedure');
      if (parameter.parameterKind === 'rest' && isProcedureCapability) {
        continue;
      }
      const value = lowerExpression(
        attribute.value,
        invocation.owner.values,
        `prop "${parameter.declaration.name}" passed to <${invocation.target.component.name.name}>`,
        state,
      );
      if (!value) {
        continue;
      }
      const prop: LoweredValueProp = { attribute, invocation, parameter, value };
      props.set(attribute, prop);
      values.push(prop);
    }
    byInvocation.set(invocation, props);
  }

  return { byInvocation, values };
};

const retainValueSymbols = (component: ComponentSymbols): void => {
  component.values.clear();
  for (const [name, parameter] of component.parameters) {
    if (parameter.parameterKind === 'value') {
      component.values.set(name, parameter);
    }
  }
  for (const [name, binding] of component.bindings) {
    component.values.set(name, binding);
  }
};

const lowerParameterDefaults = (
  components: readonly ComponentSymbols[],
  state: AnalysisState,
): void => {
  for (const component of components) {
    const earlierValues = new Map<string, ValueSymbol>();
    for (const parameter of component.parameters.values()) {
      if (parameter.syntax?.kind === 'DefaultComponentParameter') {
        parameter.defaultExpression = lowerExpression(
          parameter.syntax.defaultValue,
          earlierValues,
          `default for parameter "${parameter.declaration.name}"`,
          state,
        );
      }
      if (parameter.parameterKind === 'value') {
        earlierValues.set(parameter.declaration.name, parameter);
      }
    }
  }
};

interface RenderContext {
  readonly component: ComponentSymbols;
  readonly constantValues: ReadonlyMap<string, LiteralValue>;
  readonly edges: UiEdgeV1[];
  readonly invocations: ReadonlyMap<ElementNode, ComponentInvocation>;
  readonly nodes: UiNodeV1[];
  readonly props: ReadonlyMap<ComponentInvocation, ReadonlyMap<AttributeNode, LoweredValueProp>>;
  readonly scopeName: string;
  readonly state: AnalysisState;
  readonly values: ReadonlyMap<string, ValueSymbol>;
  readonly valuesById: ReadonlyMap<string, ValueSymbol>;
  readonly collectionKeys: ReadonlySet<AttributeNode>;
}

const lowerTextGroup = (
  children: readonly (InterpolationNode | TextNode)[],
  id: string,
  parentId: string,
  childIndex: number,
  context: RenderContext,
): void => {
  const parts: TextPartV1[] = [];
  const expressions: ValueExpressionV1[] = [];

  for (const child of children) {
    if (child.kind === 'Text') {
      parts.push({ kind: 'static', value: child.value, span: graphSpan(child.span) });
    } else {
      const expression = lowerExpression(
        child.expression,
        context.values,
        context.scopeName,
        context.state,
      );
      if (expression) {
        const type = inferStandaloneExpression(expression, context.valuesById, context.state);
        if (type === 'unknown') {
          continue;
        }
        const resolved = evaluateResolvedConstant(expression, context.constantValues);
        if (typeof resolved === 'number' && !Number.isFinite(resolved)) {
          report(
            context.state,
            'OXE2009',
            'A compile-time numeric expression must produce a finite number.',
            expression.span,
          );
          continue;
        }
        parts.push({ kind: 'expression', expression, span: graphSpan(child.span) });
        expressions.push(expression);
      }
    }
  }

  const first = children[0];
  const last = children.at(-1);
  if (!first || !last) {
    return;
  }
  context.nodes.push({
    id,
    kind: 'text',
    parts,
    span: spanFrom(first.span, last.span),
  });
  context.edges.push({ kind: 'child', from: parentId, to: id, index: childIndex });
  addReadEdges(context.edges, id, expressions, 'reactive');
};

const lowerMarkupChildren = (
  children: readonly MarkupChildNode[],
  parentId: string,
  context: RenderContext,
): void => {
  let semanticChildIndex = 0;
  let elementIndex = 0;
  let conditionalIndex = 0;
  let collectionIndex = 0;
  let slotIndex = 0;
  let textIndex = 0;
  let textGroup: (InterpolationNode | TextNode)[] = [];

  const flushText = (): void => {
    if (textGroup.length === 0) {
      return;
    }
    lowerTextGroup(
      textGroup,
      `${parentId}/text[${textIndex}]`,
      parentId,
      semanticChildIndex,
      context,
    );
    textGroup = [];
    textIndex += 1;
    semanticChildIndex += 1;
  };

  for (const child of children) {
    if (child.kind === 'Element') {
      flushText();
      const childKind = /^[A-Z]/u.test(child.name.name) ? 'instance' : 'element';
      lowerView(
        child,
        `${parentId}/${childKind}[${elementIndex}]`,
        parentId,
        semanticChildIndex,
        context,
      );
      elementIndex += 1;
      semanticChildIndex += 1;
      continue;
    }

    if (child.kind === 'IfRegion') {
      flushText();
      lowerIfRegion(
        child,
        `${parentId}/if[${conditionalIndex}]`,
        parentId,
        semanticChildIndex,
        context,
      );
      conditionalIndex += 1;
      semanticChildIndex += 1;
      continue;
    }

    if (child.kind === 'Interpolation' && child.expression.kind === 'MapExpression') {
      flushText();
      lowerKeyedCollection(
        child.expression,
        `${parentId}/map[${collectionIndex}]`,
        parentId,
        semanticChildIndex,
        context,
      );
      collectionIndex += 1;
      semanticChildIndex += 1;
      continue;
    }

    const isChildrenSlot =
      child.kind === 'Interpolation' &&
      child.expression.kind === 'Identifier' &&
      child.expression.name === 'children';
    if (isChildrenSlot) {
      flushText();
      const parameter = context.component.parameters.get('children');
      if (!parameter || parameter.parameterKind !== 'children') {
        report(
          context.state,
          'OXE2011',
          'The reserved children slot is unavailable in this component.',
          child.span,
        );
        continue;
      }
      const id = `${parentId}/content-slot[${slotIndex}]`;
      context.nodes.push({
        id,
        kind: 'content-slot',
        parameterId: parameter.id,
        span: graphSpan(child.span),
      });
      context.edges.push({ kind: 'child', from: parentId, to: id, index: semanticChildIndex });
      slotIndex += 1;
      semanticChildIndex += 1;
      continue;
    }
    textGroup.push(child);
  }
  flushText();
};

const lowerIfRegion = (
  region: IfRegionNode,
  id: string,
  parentId: string,
  childIndex: number,
  context: RenderContext,
): void => {
  const branches: ConditionalRegionNodeV1['branches'][number][] = [];
  const conditions: ValueExpressionV1[] = [];

  for (const branch of region.branches) {
    if (!branch.condition) {
      branches.push({ span: graphSpan(branch.span) });
      continue;
    }
    const condition = lowerExpression(
      branch.condition,
      context.values,
      `${context.scopeName} if condition`,
      context.state,
    );
    if (!condition) {
      branches.push({ span: graphSpan(branch.span) });
      continue;
    }
    const type = inferStandaloneExpression(condition, context.valuesById, context.state);
    if (type !== 'boolean' && type !== 'unknown') {
      report(
        context.state,
        'OXE2009',
        `An if condition must be boolean, but received ${type}.`,
        branch.condition.span,
      );
    }
    conditions.push(condition);
    branches.push({ condition, span: graphSpan(branch.span) });
  }

  context.nodes.push({
    id,
    kind: 'conditional-region',
    branches,
    span: graphSpan(region.span),
  });
  context.edges.push({ kind: 'child', from: parentId, to: id, index: childIndex });
  addReadEdges(context.edges, id, conditions, 'reactive');

  region.branches.forEach((branch, index) => {
    const viewKind = /^[A-Z]/u.test(branch.result.name.name) ? 'instance' : 'element';
    lowerView(branch.result, `${id}/branch[${index}]/${viewKind}`, id, index, context);
  });
};

const lowerKeyedCollection = (
  map: MapExpressionNode,
  id: string,
  parentId: string,
  childIndex: number,
  context: RenderContext,
): void => {
  const source = lowerExpression(
    map.collection,
    context.values,
    `${context.scopeName} map source`,
    context.state,
  );
  if (!source) {
    return;
  }
  const sourceType = inferStandaloneExpression(source, context.valuesById, context.state);
  if (sourceType !== 'array' && sourceType !== 'unknown') {
    report(
      context.state,
      'OXE2009',
      `map requires an array, but received ${sourceType}.`,
      map.collection.span,
    );
  }
  const itemType = inferArrayItemTypeWithoutDiagnostics(source, context.valuesById) ?? 'unknown';
  if (itemType === 'unknown') {
    report(
      context.state,
      'OXE2015',
      `Cannot infer the item type for map parameter "${map.parameter.name}".`,
      map.parameter.span,
    );
  }

  const itemId = `${id}/item`;
  const item: CollectionItemNodeV1 = {
    id: itemId,
    kind: 'collection-item',
    name: map.parameter.name,
    ownerId: id,
    type: itemType,
    span: graphSpan(map.parameter.span),
  };
  const values = new Map(context.values);
  values.set(map.parameter.name, item);
  const valuesById = new Map(context.valuesById);
  valuesById.set(item.id, item);

  const keyAttribute = map.body.attributes.find(
    (attribute): attribute is AttributeNode =>
      attribute.kind === 'Attribute' && attribute.name.name === 'key',
  );
  const key = keyAttribute
    ? lowerExpression(keyAttribute.value, values, `${context.scopeName} map key`, context.state)
    : ({ kind: 'read', targetId: item.id, span: graphSpan(map.parameter.span) } as const);
  if (!key) {
    return;
  }
  const keyType = inferStandaloneExpression(key, valuesById, context.state);
  if (keyType === 'array') {
    report(context.state, 'OXE2009', 'A keyed map key must be scalar.', key.span);
  }

  const collection: KeyedCollectionNodeV1 = {
    id,
    itemId,
    key,
    kind: 'keyed-collection',
    source,
    span: graphSpan(map.span),
  };
  context.nodes.push(collection, item);
  context.edges.push({ kind: 'child', from: parentId, to: id, index: childIndex });
  addReadEdges(context.edges, id, [source, key], 'reactive');

  const collectionKeys = new Set(context.collectionKeys);
  if (keyAttribute) {
    collectionKeys.add(keyAttribute);
  }
  const nestedContext: RenderContext = {
    ...context,
    collectionKeys,
    values,
    valuesById,
  };
  const viewKind = /^[A-Z]/u.test(map.body.name.name) ? 'instance' : 'element';
  lowerView(map.body, `${id}/row/${viewKind}`, id, 0, nestedContext);
};

const lowerPlatformElement = (
  element: ElementNode,
  id: string,
  parentId: string,
  childIndex: number,
  context: RenderContext,
): void => {
  const staticAttributes: {
    name: string;
    span: GraphSpanV1;
    value: LiteralValueV1;
  }[] = [];
  const dynamicAttributes: DynamicAttributeV1[] = [];
  const attributeNames = new Map<string, SourceSpan>();

  for (const attribute of element.attributes) {
    if (attribute.kind === 'SpreadAttribute') {
      report(
        context.state,
        'OXE2008',
        'Spread attributes are only supported on local components in this language slice.',
        attribute.span,
      );
      continue;
    }
    if (attribute.name.name === 'key') {
      if (context.collectionKeys.has(attribute)) {
        continue;
      }
      report(
        context.state,
        'OXE2008',
        'The key attribute is only valid on the element produced by map.',
        attribute.name.span,
      );
      continue;
    }
    const previous = attributeNames.get(attribute.name.name);
    if (previous) {
      report(
        context.state,
        'OXE2001',
        `Duplicate attribute "${attribute.name.name}".`,
        attribute.name.span,
        [{ message: 'The first attribute is here.', span: previous }],
      );
      continue;
    }
    attributeNames.set(attribute.name.name, attribute.name.span);

    if (attribute.name.name === 'onClick') {
      if (attribute.value.kind !== 'Identifier') {
        report(
          context.state,
          'OXE2006',
          'onClick requires the name of a procedure.',
          attribute.value.span,
        );
        continue;
      }
      const procedure = context.component.procedures.get(attribute.value.name);
      const parameter = context.component.parameters.get(attribute.value.name);
      const targetId =
        procedure?.id ?? (parameter?.parameterKind === 'procedure' ? parameter.id : undefined);
      if (!targetId) {
        report(
          context.state,
          'OXE2006',
          `onClick requires a procedure, but "${attribute.value.name}" is not one.`,
          attribute.value.span,
        );
        continue;
      }
      context.edges.push({
        kind: 'event',
        from: id,
        to: targetId,
        authoredName: attribute.name.name,
        event: 'click',
        span: graphSpan(attribute.span),
      });
      continue;
    }

    if (attribute.name.name.startsWith('on')) {
      report(
        context.state,
        'OXE2008',
        `Event attribute "${attribute.name.name}" is not supported by this compiler slice.`,
        attribute.name.span,
      );
      continue;
    }

    const expression = lowerExpression(
      attribute.value,
      context.values,
      context.scopeName,
      context.state,
    );
    if (!expression) {
      continue;
    }
    if (inferStandaloneExpression(expression, context.valuesById, context.state) === 'unknown') {
      continue;
    }
    const value = evaluateResolvedConstant(expression, context.constantValues);
    if (typeof value === 'number' && !Number.isFinite(value)) {
      report(
        context.state,
        'OXE2009',
        `Attribute "${attribute.name.name}" must produce a finite number.`,
        attribute.value.span,
      );
      continue;
    }
    if (value === undefined) {
      dynamicAttributes.push({
        mode: ['checked', 'disabled', 'selected', 'value'].includes(attribute.name.name)
          ? 'property'
          : 'attribute',
        name: attribute.name.name,
        span: graphSpan(attribute.span),
        value: expression,
      });
      continue;
    }
    if (!isLiteralScalar(value)) {
      report(
        context.state,
        'OXE2008',
        `Attribute "${attribute.name.name}" must produce a scalar value.`,
        attribute.value.span,
      );
      continue;
    }
    staticAttributes.push({
      name: attribute.name.name,
      value,
      span: graphSpan(attribute.span),
    });
  }

  context.nodes.push({
    id,
    kind: 'element',
    tag: element.name.name,
    staticAttributes,
    dynamicAttributes,
    span: graphSpan(element.span),
  });
  context.edges.push({ kind: 'child', from: parentId, to: id, index: childIndex });
  addReadEdges(
    context.edges,
    id,
    dynamicAttributes.map((attribute) => attribute.value),
    'reactive',
  );
  lowerMarkupChildren(element.children, id, context);
};

const lowerComponentInstance = (
  element: ElementNode,
  id: string,
  parentId: string,
  childIndex: number,
  context: RenderContext,
): void => {
  const invocation = context.invocations.get(element);
  if (!invocation) {
    return;
  }

  const instance: ComponentInstanceNodeV1 = {
    id,
    kind: 'component-instance',
    componentId: invocation.target.componentId,
    span: graphSpan(element.span),
  };
  context.nodes.push(instance);
  context.edges.push({ kind: 'child', from: parentId, to: id, index: childIndex });
  context.edges.push({ kind: 'owner', from: context.component.componentId, to: id });

  const valueProps = context.props.get(invocation);
  const rest = [...invocation.target.parameters.values()].find(
    (parameter) => parameter.parameterKind === 'rest',
  );
  for (const [index, attribute] of element.attributes.entries()) {
    if (attribute.kind === 'SpreadAttribute') {
      const source =
        attribute.value.kind === 'Identifier'
          ? context.component.parameters.get(attribute.value.name)
          : undefined;
      if (rest && source?.parameterKind === 'rest') {
        context.edges.push({
          kind: 'spread-prop',
          from: id,
          to: rest.id,
          index,
          source: {
            kind: 'rest',
            targetId: source.id,
            span: graphSpan(attribute.value.span),
          },
          span: graphSpan(attribute.span),
        });
        context.edges.push({
          kind: 'read',
          from: id,
          to: source.id,
          mode: 'reactive',
          sites: [graphSpan(attribute.value.span)],
        });
      }
      continue;
    }

    const declared = invocation.target.parameters.get(attribute.name.name);
    const parameter = declared ?? rest;
    if (!parameter || parameter.parameterKind === 'children') {
      continue;
    }
    const authoredMetadata = { authoredName: attribute.name.name, index };
    if (parameter.parameterKind === 'value' || parameter.parameterKind === 'rest') {
      const prop = valueProps?.get(attribute);
      if (!prop) {
        if (parameter.parameterKind !== 'rest') {
          continue;
        }
      } else {
        context.edges.push({
          ...authoredMetadata,
          kind: 'prop',
          mode: 'reactive',
          from: id,
          to: parameter.id,
          span: graphSpan(attribute.span),
          value: prop.value,
        });
        addReadEdges(context.edges, id, [prop.value], 'reactive');
        continue;
      }
    }
    if (
      (parameter.parameterKind === 'procedure' || parameter.parameterKind === 'rest') &&
      attribute.value.kind === 'Identifier'
    ) {
      const local = context.component.procedures.get(attribute.value.name);
      const forwarded = context.component.parameters.get(attribute.value.name);
      const targetId =
        local?.id ?? (forwarded?.parameterKind === 'procedure' ? forwarded.id : undefined);
      if (targetId) {
        context.edges.push({
          ...authoredMetadata,
          kind: 'prop',
          mode: 'procedure',
          from: id,
          to: parameter.id,
          span: graphSpan(attribute.span),
          targetId,
        });
      }
    }
  }
  lowerMarkupChildren(element.children, id, context);
};

const lowerView = (
  element: ElementNode,
  id: string,
  parentId: string,
  childIndex: number,
  context: RenderContext,
): void => {
  if (/^[A-Z]/u.test(element.name.name)) {
    lowerComponentInstance(element, id, parentId, childIndex, context);
  } else {
    lowerPlatformElement(element, id, parentId, childIndex, context);
  }
};

const evaluateResolvedConstant = (
  expression: ValueExpressionV1,
  values: ReadonlyMap<string, LiteralValue>,
): LiteralValue | undefined => {
  switch (expression.kind) {
    case 'array': {
      const result: LiteralValueV1[] = [];
      for (const element of expression.elements) {
        const value = evaluateResolvedConstant(element, values);
        if (value === undefined || !isLiteralScalar(value)) {
          return undefined;
        }
        result.push(value);
      }
      return result;
    }
    case 'literal':
      return expression.value;
    case 'read':
      return values.get(expression.targetId);
    case 'binary': {
      const left = evaluateResolvedConstant(expression.left, values);
      const right = evaluateResolvedConstant(expression.right, values);
      if (left === undefined || right === undefined) {
        return undefined;
      }
      if (expression.operator === '+' && typeof left === 'string' && typeof right === 'string') {
        return left + right;
      }
      if (expression.operator === '==') {
        return Object.is(left, right);
      }
      if (expression.operator === '!=') {
        return !Object.is(left, right);
      }
      if (
        expression.operator === 'and' &&
        typeof left === 'boolean' &&
        typeof right === 'boolean'
      ) {
        return left && right;
      }
      if (expression.operator === 'or' && typeof left === 'boolean' && typeof right === 'boolean') {
        return left || right;
      }
      if (typeof left !== 'number' || typeof right !== 'number') {
        return undefined;
      }
      switch (expression.operator) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          return left / right;
        case '%':
          return left % right;
        case 'and':
        case 'or':
          return undefined;
      }
    }
  }
};

const analyzeComponent = (
  symbols: ComponentSymbols,
  nodes: UiNodeV1[],
  edges: UiEdgeV1[],
  invocations: ReadonlyMap<ElementNode, ComponentInvocation>,
  props: ReadonlyMap<ComponentInvocation, ReadonlyMap<AttributeNode, LoweredValueProp>>,
  valuesById: ReadonlyMap<string, ValueSymbol>,
  state: AnalysisState,
): string => {
  const component = symbols.component;
  if (!/^[A-Z]/u.test(component.name.name)) {
    report(
      state,
      'OXE2008',
      `Component name "${component.name.name}" must begin with an uppercase letter.`,
      component.name.span,
    );
  }

  const componentNode: ComponentNodeV1 = {
    id: symbols.componentId,
    kind: 'component',
    name: component.name.name,
    parameters: orderedParameters(symbols).map((parameter) => parameter.id),
    span: graphSpan(component.span),
  };
  nodes.push(componentNode);

  for (const parameter of orderedParameters(symbols)) {
    if (!parameter.parameterKind) {
      continue;
    }
    const base = {
      id: parameter.id,
      kind: 'component-parameter' as const,
      ownerId: symbols.componentId,
      index: parameter.index,
      name: parameter.declaration.name,
      span: graphSpan(parameter.declaration.span),
    };
    const parameterNode: ComponentParameterNodeV1 = (() => {
      switch (parameter.parameterKind) {
        case 'children':
          return { ...base, parameterKind: 'children' };
        case 'procedure':
          return { ...base, parameterKind: 'procedure' };
        case 'rest':
          return { ...base, parameterKind: 'rest' };
        case 'value':
          return {
            ...base,
            parameterKind: 'value',
            type: parameter.type,
            ...(parameter.defaultExpression ? { default: parameter.defaultExpression } : {}),
          };
      }
    })();
    nodes.push(parameterNode);
    if (parameter.defaultExpression) {
      addReadEdges(edges, parameter.id, [parameter.defaultExpression], 'reactive');
    }
  }

  const writtenIds = new Set<string>();
  for (const procedure of symbols.procedures.values()) {
    if (!/^[a-z_]/u.test(procedure.declaration.name.name)) {
      report(
        state,
        'OXE2008',
        `Procedure name "${procedure.declaration.name.name}" must begin with a lowercase letter.`,
        procedure.declaration.name.span,
      );
    }
    for (const statement of procedure.declaration.body) {
      const target = symbols.bindings.get(statement.target.name);
      if (!target) {
        report(
          state,
          'OXE2008',
          `Procedure-local assignment "${statement.target.name}" is not supported by this compiler slice.`,
          statement.target.span,
        );
      } else {
        writtenIds.add(target.id);
      }
    }
  }

  classifyBindings(symbols.bindings, writtenIds);
  diagnoseCycles(symbols.bindings, state);
  const constantValues = evaluateConstants(symbols.bindings, state);
  const bindingsById = new Map(
    [...symbols.bindings.values()].map((binding) => [binding.id, binding]),
  );

  for (const binding of symbols.bindings.values()) {
    if (!binding.expression) {
      continue;
    }

    const resolved = evaluateResolvedConstant(binding.expression, constantValues);
    if (typeof resolved === 'number' && !Number.isFinite(resolved)) {
      report(
        state,
        'OXE2009',
        'A compile-time numeric expression must produce a finite number.',
        binding.expression.span,
      );
      continue;
    }

    if (binding.classification === 'cell') {
      const dynamicDependencies = uniqueReadIds(binding.expression).filter(
        (id) => bindingsById.get(id)?.classification !== 'constant',
      );
      if (dynamicDependencies.length > 0) {
        report(
          state,
          'OXE2007',
          `Mutable value "${binding.declaration.target.name}" cannot yet have a reactive initializer.`,
          binding.declaration.value.span,
        );
      }
      nodes.push({
        id: binding.id,
        kind: 'cell',
        name: binding.declaration.target.name,
        type: binding.type,
        initial: binding.expression,
        span: graphSpan(binding.declaration.span),
      });
    } else if (binding.classification === 'constant') {
      const value = constantValues.get(binding.id);
      if (value !== undefined) {
        nodes.push({
          id: binding.id,
          kind: 'constant',
          name: binding.declaration.target.name,
          type: binding.type,
          value,
          span: graphSpan(binding.declaration.span),
        });
      }
    } else {
      nodes.push({
        id: binding.id,
        kind: 'computed',
        name: binding.declaration.target.name,
        type: binding.type,
        expression: binding.expression,
        span: graphSpan(binding.declaration.span),
      });
      addReadEdges(edges, binding.id, [binding.expression], 'reactive');
    }
  }

  for (const procedure of symbols.procedures.values()) {
    const steps: WriteStepV1[] = [];
    for (const statement of procedure.declaration.body) {
      const target = symbols.bindings.get(statement.target.name);
      const value = lowerExpression(
        statement.value,
        symbols.values,
        `procedure "${procedure.declaration.name.name}"`,
        state,
      );
      if (!target || !value) {
        continue;
      }
      const valueType = inferStandaloneExpression(value, valuesById, state);
      const resolved = evaluateResolvedConstant(value, constantValues);
      if (typeof resolved === 'number' && !Number.isFinite(resolved)) {
        report(
          state,
          'OXE2009',
          'A compile-time numeric expression must produce a finite number.',
          value.span,
        );
        continue;
      }
      if (target.type !== 'unknown' && valueType !== 'unknown' && target.type !== valueType) {
        report(
          state,
          'OXE2009',
          `Cannot assign ${valueType} to ${target.type} cell "${target.declaration.target.name}".`,
          statement.value.span,
        );
      }
      steps.push({
        kind: 'write',
        targetId: target.id,
        value,
        span: graphSpan(statement.span),
      });
    }

    const procedureNode: ProcedureNodeV1 = {
      id: procedure.id,
      kind: 'procedure',
      name: procedure.declaration.name.name,
      parameters: [],
      steps,
      span: graphSpan(procedure.declaration.span),
    };
    nodes.push(procedureNode);
    addReadEdges(
      edges,
      procedure.id,
      steps.map((step) => step.value),
      'procedural',
    );
    addWriteEdges(edges, procedureNode);
  }

  if (symbols.renderRoots.length === 0) {
    report(
      state,
      'OXE2008',
      `Component "${component.name.name}" must contain at least one platform element.`,
      component.span,
    );
  }

  const renderContext: RenderContext = {
    component: symbols,
    constantValues,
    edges,
    invocations,
    nodes,
    props,
    scopeName: `component "${component.name.name}" markup`,
    state,
    valuesById,
    values: symbols.values,
    collectionKeys: new Set(),
  };
  symbols.renderRoots.forEach((element, index) => {
    if (element.kind === 'IfRegion') {
      lowerIfRegion(
        element,
        `${symbols.componentId}/view/if[${index}]`,
        symbols.componentId,
        index,
        renderContext,
      );
    } else {
      const viewKind = /^[A-Z]/u.test(element.name.name) ? 'instance' : 'element';
      lowerView(
        element,
        `${symbols.componentId}/view/${viewKind}[${index}]`,
        symbols.componentId,
        index,
        renderContext,
      );
    }
  });

  return symbols.componentId;
};

const inferStandaloneExpression = (
  expression: ValueExpressionV1,
  valuesById: ReadonlyMap<string, ValueSymbol>,
  state: AnalysisState,
): PrimitiveTypeV1 => {
  switch (expression.kind) {
    case 'array': {
      let itemType: PrimitiveTypeV1 | undefined;
      for (const element of expression.elements) {
        const current = inferStandaloneExpression(element, valuesById, state);
        if (current === 'array') {
          report(state, 'OXE2009', 'Nested arrays are not supported yet.', element.span);
          return 'unknown';
        }
        if (itemType && current !== 'unknown' && itemType !== current) {
          report(
            state,
            'OXE2009',
            `Array elements must share one type, but received ${itemType} and ${current}.`,
            element.span,
          );
          return 'unknown';
        }
        if (current !== 'unknown') {
          itemType = current;
        }
      }
      return 'array';
    }
    case 'literal':
      return typeof expression.value as 'boolean' | 'number' | 'string';
    case 'read':
      return valuesById.get(expression.targetId)?.type ?? 'unknown';
    case 'binary': {
      const left = inferStandaloneExpression(expression.left, valuesById, state);
      const right = inferStandaloneExpression(expression.right, valuesById, state);
      return inferBinaryType(expression, left, right, state);
    }
  }
};

const edgeKey = (edge: UiEdgeV1): string => {
  switch (edge.kind) {
    case 'child':
      return `${edge.kind}\0${edge.from}\0${edge.to}\0${edge.index.toString().padStart(10, '0')}`;
    case 'event':
      return `${edge.kind}\0${edge.from}\0${edge.to}\0${edge.authoredName}\0${edge.event}`;
    case 'owner':
      return `${edge.kind}\0${edge.from}\0${edge.to}`;
    case 'prop':
      return `${edge.kind}\0${edge.from}\0${edge.to}\0${edge.mode}`;
    case 'spread-prop':
      return `${edge.kind}\0${edge.from}\0${edge.to}\0${edge.index.toString().padStart(10, '0')}`;
    case 'read':
      return `${edge.kind}\0${edge.from}\0${edge.to}\0${edge.mode}`;
    case 'write':
      return `${edge.kind}\0${edge.from}\0${edge.to}\0${edge.mode}`;
  }
};

interface SemanticModule {
  readonly ast: ModuleNode;
  readonly components: ReadonlyMap<string, ComponentSymbols>;
  readonly moduleId: string;
}

interface ComponentSetAnalysis {
  readonly diagnostics: readonly Diagnostic[];
  readonly graph?: UiGraphV1;
}

const sortDiagnostics = (diagnostics: Diagnostic[]): readonly Diagnostic[] =>
  diagnostics.sort(
    (left, right) =>
      compareText(left.span.fileName, right.span.fileName) ||
      left.span.start.offset - right.span.start.offset ||
      compareText(left.code, right.code) ||
      compareText(left.message, right.message),
  );

const registerSemanticModule = (
  ast: ModuleNode,
  moduleId: string,
  state: AnalysisState,
): SemanticModule => {
  const componentNames = new Map<string, SourceSpan>();
  const components = new Map<string, ComponentSymbols>();

  if (ast.declarations.length === 0) {
    report(state, 'OXE2008', 'An OXE UI module must declare at least one component.', ast.span);
  }

  for (const component of ast.declarations) {
    const previous = componentNames.get(component.name.name);
    if (previous) {
      report(
        state,
        'OXE2001',
        `Duplicate component "${component.name.name}".`,
        component.name.span,
        [{ message: 'The first component is here.', span: previous }],
      );
      continue;
    }
    componentNames.set(component.name.name, component.name.span);
    components.set(component.name.name, registerComponentSymbols(component, moduleId, state));
  }

  return { ast, components, moduleId };
};

const analyzeComponentSet = (
  modules: readonly SemanticModule[],
  graphModuleId: string,
  componentScopes: ReadonlyMap<string, ReadonlyMap<string, ComponentSymbols>>,
  requestedEntries: readonly ComponentSymbols[] | undefined,
  state: AnalysisState,
): ComponentSetAnalysis => {
  const nodes: UiNodeV1[] = [];
  const edges: UiEdgeV1[] = [];
  const componentList = modules
    .flatMap((module) => [...module.components.values()])
    .sort((left, right) => compareText(left.componentId, right.componentId));
  const components = new Map(
    componentList.map((component) => [component.componentId, component] as const),
  );

  for (const component of components.values()) {
    scanDirectParameterUses(component, state);
  }
  if (requestedEntries) {
    for (const entry of requestedEntries) {
      if (entry.parameters.size > 0) {
        report(
          state,
          'OXE2017',
          `Entry component "${entry.component.name.name}" must not declare or consume props.`,
          entry.component.name.span,
        );
      }
    }
  }
  const invocations = collectComponentInvocations(components, componentScopes, state);
  inferParameterKinds(components, invocations, state);
  diagnoseComponentCycles(components, invocations, state);
  if (state.diagnostics.length > 0) {
    return { diagnostics: sortDiagnostics(state.diagnostics) };
  }

  for (const component of componentList) {
    retainValueSymbols(component);
  }
  lowerParameterDefaults(componentList, state);
  for (const component of componentList) {
    for (const binding of component.bindings.values()) {
      binding.expression = lowerExpression(
        binding.declaration.value,
        component.values,
        `component "${component.component.name.name}"`,
        state,
      );
    }
  }
  const loweredProps = lowerInvocationValueProps(invocations, state);
  if (state.diagnostics.length > 0) {
    return { diagnostics: sortDiagnostics(state.diagnostics) };
  }

  const valuesById = inferProjectValueTypes(componentList, loweredProps.values, state);
  if (state.diagnostics.length > 0) {
    return { diagnostics: sortDiagnostics(state.diagnostics) };
  }

  const invocationsByElement = new Map(
    invocations.map((invocation) => [invocation.element, invocation]),
  );
  for (const component of componentList) {
    analyzeComponent(
      component,
      nodes,
      edges,
      invocationsByElement,
      loweredProps.byInvocation,
      valuesById,
      state,
    );
  }
  if (state.diagnostics.length > 0) {
    return { diagnostics: sortDiagnostics(state.diagnostics) };
  }

  const entryComponents = requestedEntries
    ? requestedEntries.map((component) => component.componentId)
    : (() => {
        const invokedComponentIds = new Set(
          invocations.map((invocation) => invocation.target.componentId),
        );
        return componentList
          .map((component) => component.componentId)
          .filter((id) => !invokedComponentIds.has(id));
      })();

  const graph: UiGraphV1 = {
    schemaVersion: 'oxe.ui-graph.v1',
    moduleId: graphModuleId,
    entryComponents: entryComponents.sort(compareText),
    nodes: nodes.sort((left, right) => compareText(left.id, right.id)),
    edges: edges.sort((left, right) => compareText(edgeKey(left), edgeKey(right))),
  };
  const graphDiagnostics = validateUiGraph(graph);
  if (graphDiagnostics.length > 0) {
    const details = graphDiagnostics
      .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
      .join('\n');
    throw new Error(`Internal OXE graph validation failed:\n${details}`);
  }

  return { diagnostics: [], graph };
};

export const analyzeSource = (
  source: string,
  fileName = '<source>',
  requestedModuleId = fileName,
): AnalyzeResult => {
  const parsed = parseSource(source, fileName);
  if (parsed.diagnostics.length > 0) {
    return { ast: parsed.ast, diagnostics: parsed.diagnostics };
  }

  const state: AnalysisState = { diagnostics: [], diagnosticKeys: new Set() };
  const moduleId = normalizeProjectModuleId(requestedModuleId);
  for (const declaration of parsed.ast.imports) {
    report(
      state,
      'OXE2016',
      'Imports require analyzeProject so the compiler can load and link the complete module graph.',
      declaration.span,
    );
  }
  const module = registerSemanticModule(parsed.ast, moduleId, state);
  const scopes = new Map<string, ReadonlyMap<string, ComponentSymbols>>();
  for (const component of module.components.values()) {
    scopes.set(component.componentId, module.components);
  }
  const analyzed = analyzeComponentSet([module], moduleId, scopes, undefined, state);
  return {
    ast: parsed.ast,
    diagnostics: analyzed.diagnostics,
    ...(analyzed.graph ? { graph: analyzed.graph } : {}),
  };
};

interface ProjectImportEdge {
  readonly from: string;
  readonly sourceSpan: SourceSpan;
  readonly specifierSpan: SourceSpan;
  readonly to: string;
}

const projectPointSpan = (fileName: string): SourceSpan => ({
  fileName,
  start: { column: 1, line: 1, offset: 0 },
  end: { column: 1, line: 1, offset: 0 },
});

const diagnoseImportCycles = (
  moduleIds: readonly string[],
  edges: readonly ProjectImportEdge[],
  state: AnalysisState,
): void => {
  const moduleIdSet = new Set(moduleIds);
  const outgoing = new Map<string, ProjectImportEdge[]>();
  for (const edge of edges) {
    if (!moduleIdSet.has(edge.from) || !moduleIdSet.has(edge.to)) {
      continue;
    }
    const entries = outgoing.get(edge.from) ?? [];
    entries.push(edge);
    outgoing.set(edge.from, entries);
  }
  for (const entries of outgoing.values()) {
    entries.sort(
      (left, right) =>
        compareText(left.to, right.to) ||
        left.sourceSpan.start.offset - right.sourceSpan.start.offset,
    );
  }

  const status = new Map<string, 'done' | 'visiting'>();
  const path: string[] = [];
  const reported = new Set<string>();
  const visit = (moduleId: string): void => {
    if (status.get(moduleId) === 'done') {
      return;
    }
    status.set(moduleId, 'visiting');
    path.push(moduleId);
    for (const edge of outgoing.get(moduleId) ?? []) {
      if (status.get(edge.to) === 'visiting') {
        const cycleStart = path.indexOf(edge.to);
        const cycle = cycleStart < 0 ? [edge.to, edge.from] : path.slice(cycleStart);
        const key = [...cycle].sort(compareText).join('\0');
        if (!reported.has(key)) {
          reported.add(key);
          report(
            state,
            'OXE2016',
            `Import cycles are not supported: ${[...cycle, edge.to].join(' -> ')}.`,
            edge.specifierSpan,
          );
        }
        continue;
      }
      if (status.get(edge.to) !== 'done') {
        visit(edge.to);
      }
    }
    path.pop();
    status.set(moduleId, 'done');
  };

  for (const moduleId of [...moduleIds].sort(compareText)) {
    if (!status.has(moduleId)) {
      visit(moduleId);
    }
  }
};

export const analyzeProject = async (
  options: AnalyzeProjectOptions,
): Promise<AnalyzeProjectResult> => {
  const state: AnalysisState = { diagnostics: [], diagnosticKeys: new Set() };
  let entryModuleId: string;
  try {
    entryModuleId = normalizeProjectModuleId(options.entryModuleId);
  } catch (error) {
    if (!(error instanceof OxeModulePathError)) {
      throw error;
    }
    report(state, 'OXE2016', error.message, projectPointSpan(options.entryModuleId || '<entry>'));
    return {
      entryModuleId: options.entryModuleId,
      modules: [],
      diagnostics: sortDiagnostics(state.diagnostics),
    };
  }
  if (!entryModuleId.endsWith('.oxe')) {
    report(
      state,
      'OXE2016',
      'The OXE project entry must be an exact project-relative path ending in .oxe.',
      projectPointSpan(entryModuleId),
    );
    return {
      entryModuleId,
      modules: [],
      diagnostics: sortDiagnostics(state.diagnostics),
    };
  }

  const sourceLoads = new Map<string, Promise<string | undefined>>();
  const parsedModules = new Map<string, ModuleNode>();
  const importEdges: ProjectImportEdge[] = [];
  const resolvedImports = new Map<ModuleNode['imports'][number], string>();

  const loadSource = (moduleId: string): Promise<string | undefined> => {
    const existing = sourceLoads.get(moduleId);
    if (existing) {
      return existing;
    }
    const loading = options.loadModule(moduleId);
    sourceLoads.set(moduleId, loading);
    return loading;
  };

  const loadModule = async (moduleId: string): Promise<boolean> => {
    if (parsedModules.has(moduleId)) {
      return true;
    }
    const source = await loadSource(moduleId);
    if (source === undefined) {
      return false;
    }

    const parsed = parseSource(source, moduleId);
    parsedModules.set(moduleId, parsed.ast);
    state.diagnostics.push(...parsed.diagnostics);
    for (const declaration of parsed.ast.imports) {
      let targetModuleId: string;
      try {
        targetModuleId = resolveImportModuleId(moduleId, declaration.source.value);
      } catch (error) {
        if (!(error instanceof OxeModulePathError)) {
          throw error;
        }
        report(state, 'OXE2016', error.message, declaration.source.span);
        continue;
      }
      resolvedImports.set(declaration, targetModuleId);
      importEdges.push({
        from: moduleId,
        sourceSpan: declaration.span,
        specifierSpan: declaration.source.span,
        to: targetModuleId,
      });
      if (!(await loadModule(targetModuleId))) {
        report(
          state,
          'OXE2016',
          `Cannot load imported module "${targetModuleId}". The path must name an existing .oxe file exactly.`,
          declaration.source.span,
        );
      }
    }
    return true;
  };

  if (!(await loadModule(entryModuleId))) {
    report(
      state,
      'OXE2016',
      `Cannot load entry module "${entryModuleId}".`,
      projectPointSpan(entryModuleId),
    );
  }

  const moduleIds = [...parsedModules.keys()].sort(compareText);
  diagnoseImportCycles(moduleIds, importEdges, state);
  const projectModules = moduleIds.map((moduleId): AnalyzedProjectModule => ({
    ast: parsedModules.get(moduleId) as ModuleNode,
    moduleId,
  }));
  if (state.diagnostics.length > 0) {
    return {
      entryModuleId,
      modules: projectModules,
      diagnostics: sortDiagnostics(state.diagnostics),
    };
  }

  const semanticModules = projectModules.map((module) =>
    registerSemanticModule(module.ast, module.moduleId, state),
  );
  const semanticById = new Map(semanticModules.map((module) => [module.moduleId, module] as const));
  const scopes = new Map<string, ReadonlyMap<string, ComponentSymbols>>();

  for (const module of semanticModules) {
    const scope = new Map(module.components);
    const origins = new Map<string, SourceSpan>(
      [...module.components].map(([name, component]) => [name, component.component.name.span]),
    );
    for (const declaration of module.ast.imports) {
      const importedModuleId = resolvedImports.get(declaration);
      const importedModule = importedModuleId ? semanticById.get(importedModuleId) : undefined;
      if (!importedModule) {
        continue;
      }
      for (const specifier of declaration.specifiers) {
        const name = specifier.name.name;
        const previous = origins.get(name);
        if (previous) {
          report(
            state,
            'OXE2016',
            `Imported component "${name}" collides with another name in module "${module.moduleId}".`,
            specifier.name.span,
            [{ message: 'The existing name is declared or imported here.', span: previous }],
          );
          continue;
        }
        const target = importedModule.components.get(name);
        if (!target || !target.component.exported) {
          report(
            state,
            'OXE2010',
            `Module "${importedModule.moduleId}" does not explicitly export component "${name}".`,
            specifier.name.span,
          );
          continue;
        }
        scope.set(name, target);
        origins.set(name, specifier.name.span);
      }
    }
    for (const component of module.components.values()) {
      scopes.set(component.componentId, scope);
    }
  }

  const entryModule = semanticById.get(entryModuleId);
  const entry = entryModule?.components.get(options.entryExport);
  if (!entry || !entry.component.exported) {
    report(
      state,
      'OXE2017',
      `Entry "${options.entryExport}" must name an explicitly exported component in module "${entryModuleId}".`,
      entry?.component.name.span ?? entryModule?.ast.span ?? projectPointSpan(entryModuleId),
    );
  }
  if (state.diagnostics.length > 0 || !entry) {
    return {
      entryModuleId,
      modules: projectModules,
      diagnostics: sortDiagnostics(state.diagnostics),
    };
  }

  const analyzed = analyzeComponentSet(semanticModules, entryModuleId, scopes, [entry], state);
  return {
    entryModuleId,
    modules: projectModules,
    diagnostics: analyzed.diagnostics,
    ...(analyzed.graph ? { graph: analyzed.graph } : {}),
  };
};
