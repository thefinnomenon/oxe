import {
  validateUiGraph,
  type ComponentInstanceNodeV1,
  type ComponentNodeV1,
  type ComponentParameterNodeV1,
  type ConstantValueV1,
  type ContentReferenceNodeV1,
  type ContentValueNodeV1,
  type ConditionalRegionNodeV1,
  type CollectionItemNodeV1,
  type CollectionCallbackV1,
  type DynamicAttributeV1,
  type EffectNodeV1,
  type GraphSpanV1,
  type KeyedCollectionNodeV1,
  type LiteralValueV1,
  type PrimitiveTypeV1,
  type RouteIntrinsicV1,
  type ProcedureStepV1,
  type ProcedureNodeV1,
  type TextPartV1,
  type UiEdgeV1,
  type UiGraphV1,
  type UiNodeV1,
  type ValueExpressionV1,
} from '@oxe/graph';

import type {
  AssignmentStatementNode,
  AttributeNode,
  CollectionMutationStatementNode,
  ComponentDeclarationNode,
  ComponentParameterNode,
  ContextDeclarationNode,
  ConditionalRegionNode,
  ConditionalResultNode,
  ElementNode,
  ExpressionNode,
  HandlerDeclarationNode,
  IdentifierNode,
  InterpolationNode,
  ExpressionStatementNode,
  MapExpressionNode,
  MarkupChildNode,
  MemberExpressionNode,
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

type LiteralValue = ConstantValueV1;
const isLiteralScalar = (value: LiteralValue): value is LiteralValueV1 =>
  typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string';
const isConstantRecord = (
  value: ConstantValueV1 | undefined,
): value is { readonly [name: string]: ConstantValueV1 } =>
  typeof value === 'object' && !Array.isArray(value);
type SemanticDiagnosticCode = Extract<DiagnosticCode, `OXE2${string}`>;
type ValueClassification =
  'async-resource' | 'cell' | 'computed' | 'constant' | 'context' | 'resource';

export interface PlatformCapabilityContract {
  readonly dispose?: 'dispose';
  readonly kind: 'async' | 'effect' | 'pure' | 'resource';
  /** Dot-separated host path, for example analytics.identify. */
  readonly name: string;
  readonly parameters: readonly PrimitiveTypeV1[];
  readonly returns?: PrimitiveTypeV1;
  readonly target?: 'client' | 'server' | 'universal';
  /** Stable external target written by a persistent effect relationship. */
  readonly writes?: string;
}

export interface AnalyzeOptions {
  readonly capabilities?: readonly PlatformCapabilityContract[];
  readonly routeSegment?: 'layout' | 'page';
  readonly target?: 'client' | 'server';
}

interface PlatformCapabilityInfo {
  readonly contract: PlatformCapabilityContract;
  readonly id: string;
  readonly path: readonly string[];
  readonly routeIntrinsic?: RouteIntrinsicV1;
  span?: SourceSpan;
  used: boolean;
}

interface ContextInfo {
  readonly declaration: ContextDeclarationNode;
  readonly id: string;
  readonly name: string;
}

interface BindingInfo {
  readonly context?: ContextInfo;
  readonly declaration: AssignmentStatementNode;
  readonly id: string;
  classification: ValueClassification;
  expression: ValueExpressionV1 | undefined;
  forcedCell?: boolean;
  type: PrimitiveTypeV1;
  itemType?: PrimitiveTypeV1;
}

interface ValueSymbol {
  readonly id: string;
  readonly expression?: ValueExpressionV1 | undefined;
  /** Inline expression used for callback-scoped locals that do not become graph nodes. */
  readonly substitution?: ValueExpressionV1;
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

interface RefInfo extends ValueSymbol {
  readonly attribute: AttributeNode;
  readonly declaration: IdentifierNode;
}

interface ContentInfo {
  readonly declaration: AssignmentStatementNode;
  readonly id: string;
}

interface ComponentSymbols {
  readonly bindings: Map<string, BindingInfo>;
  readonly component: ComponentDeclarationNode;
  readonly componentId: string;
  readonly contents: Map<string, ContentInfo>;
  readonly contexts: ReadonlyMap<string, ContextInfo>;
  readonly effects: ExpressionStatementNode[];
  readonly parameters: Map<string, ParameterInfo>;
  readonly procedures: Map<string, ProcedureInfo>;
  readonly refs: Map<string, RefInfo>;
  readonly renderRoots: (ElementNode | ConditionalRegionNode)[];
  readonly values: Map<string, ValueSymbol>;
}

interface ComponentInvocation {
  readonly arguments: ReadonlyMap<string, AttributeNode>;
  /** Value props inside a map body are lowered later with the callback's lexical values. */
  readonly deferredValueProps: boolean;
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

interface LoweredContextProvider {
  readonly context: ContextInfo;
  readonly element: ElementNode;
  readonly owner: ComponentSymbols;
  readonly value: ValueExpressionV1;
}

interface AnalysisState {
  readonly diagnostics: Diagnostic[];
  readonly diagnosticKeys: Set<string>;
  readonly platformCapabilities: ReadonlyMap<string, PlatformCapabilityInfo>;
  readonly target: 'client' | 'server';
}

export interface AnalyzeResult {
  readonly ast: ModuleNode;
  readonly diagnostics: readonly Diagnostic[];
  readonly graph?: UiGraphV1;
}

export type LoadOxeModule = (normalizedModuleId: string) => Promise<string | undefined>;

export interface AnalyzeProjectOptions {
  readonly capabilities?: readonly PlatformCapabilityContract[];
  readonly entryModuleId: string;
  readonly entryExport: string;
  readonly loadModule: LoadOxeModule;
  /** Route layouts may consume only the compiler-reserved children slot. */
  readonly routeSegment?: 'layout' | 'page';
  readonly target?: 'client' | 'server';
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

const contextId = (moduleId: string, name: string): string =>
  `${moduleId}#context/${identifierSegment(name)}`;

const platformCapabilityId = (moduleId: string, name: string): string =>
  `${moduleId}#platform/${identifierSegment(name)}`;

const bindingId = (ownerId: string, name: string): string =>
  `${ownerId}/binding/${identifierSegment(name)}`;

const parameterId = (ownerId: string, name: string): string =>
  `${ownerId}/parameter/${identifierSegment(name)}`;

const procedureId = (ownerId: string, name: string): string =>
  `${ownerId}/procedure/${identifierSegment(name)}`;

const contentId = (ownerId: string, name: string): string =>
  `${ownerId}/content/${identifierSegment(name)}`;

const refId = (ownerId: string, name: string): string =>
  `${ownerId}/ref/${identifierSegment(name)}`;

const contextRead = (
  expression: ExpressionNode,
  contexts: ReadonlyMap<string, ContextInfo>,
): ContextInfo | undefined =>
  expression.kind === 'CallExpression' &&
  expression.arguments.length === 0 &&
  expression.callee.kind === 'Identifier'
    ? contexts.get(expression.callee.name)
    : undefined;

const expressionPath = (expression: ExpressionNode): readonly string[] | undefined => {
  const path: string[] = [];
  let current = expression;
  while (current.kind === 'MemberExpression') {
    path.unshift(current.property.name);
    current = current.object;
  }
  if (current.kind !== 'Identifier') {
    return undefined;
  }
  path.unshift(current.name);
  return path;
};

const routeIntrinsicContracts: readonly {
  readonly contract: PlatformCapabilityContract;
  readonly intrinsic: RouteIntrinsicV1;
}[] = [
  {
    contract: { kind: 'pure', name: 'useLocation', parameters: [], returns: 'record' },
    intrinsic: 'location',
  },
  {
    contract: { kind: 'pure', name: 'useParams', parameters: [], returns: 'record' },
    intrinsic: 'params',
  },
  {
    contract: { kind: 'pure', name: 'useSearchParams', parameters: [], returns: 'record' },
    intrinsic: 'search-params',
  },
  {
    contract: { kind: 'effect', name: 'navigate', parameters: ['string', 'record'] },
    intrinsic: 'navigate',
  },
  {
    contract: { kind: 'effect', name: 'setSearchParams', parameters: ['record', 'record'] },
    intrinsic: 'set-search-params',
  },
];

const createAnalysisState = (
  options: AnalyzeOptions | undefined,
  moduleId: string,
  span: SourceSpan,
): AnalysisState => {
  const state: AnalysisState = {
    diagnostics: [],
    diagnosticKeys: new Set(),
    platformCapabilities: new Map(),
    target: options?.target ?? 'client',
  };
  const capabilities = state.platformCapabilities as Map<string, PlatformCapabilityInfo>;
  for (const route of options?.routeSegment ? routeIntrinsicContracts : []) {
    capabilities.set(route.contract.name, {
      contract: route.contract,
      id: platformCapabilityId(moduleId, route.contract.name),
      path: [route.contract.name],
      routeIntrinsic: route.intrinsic,
      used: false,
    });
  }
  for (const contract of options?.capabilities ?? []) {
    const path = contract.name.split('.');
    if (path.length === 0 || path.some((segment) => !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(segment))) {
      report(state, 'OXE2008', `Invalid platform capability path "${contract.name}".`, span);
      continue;
    }
    if (capabilities.has(contract.name)) {
      report(state, 'OXE2001', `Duplicate platform capability "${contract.name}".`, span);
      continue;
    }
    if (contract.kind === 'resource' && contract.dispose !== 'dispose') {
      report(
        state,
        'OXE2008',
        `Resource capability "${contract.name}" must declare dispose: "dispose".`,
        span,
      );
      continue;
    }
    if (contract.kind === 'async' && !contract.returns) {
      report(
        state,
        'OXE2008',
        `Async capability "${contract.name}" must declare a return type.`,
        span,
      );
      continue;
    }
    capabilities.set(contract.name, {
      contract,
      id: platformCapabilityId(moduleId, contract.name),
      path,
      used: false,
    });
  }
  return state;
};

const conditionalResultElement = (result: ConditionalResultNode): ElementNode | undefined => {
  const final = result.kind === 'ConditionalResultBlock' ? result.result : result;
  return final.kind === 'Element' ? final : undefined;
};

const isContentChoice = (expression: ExpressionNode): boolean =>
  expression.kind === 'ConditionalValueExpression' &&
  expression.branches.some((branch) => conditionalResultElement(branch.result) !== undefined);

const callableValues = (component: ComponentSymbols): Map<string, ValueSymbol> => {
  const values = new Map(component.values);
  for (const [name, procedure] of component.procedures) {
    values.set(name, {
      id: procedure.id,
      substitution: {
        kind: 'capability-read',
        span: graphSpan(procedure.declaration.name.span),
        targetId: procedure.id,
      },
      type: 'unknown',
    });
  }
  for (const [name, parameter] of component.parameters) {
    if (parameter.parameterKind === 'procedure') {
      values.set(name, {
        ...parameter,
        substitution: {
          kind: 'capability-read',
          span: graphSpan(parameter.declaration.span),
          targetId: parameter.id,
        },
      });
    }
  }
  return values;
};

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
    case 'call':
      return {
        ...expression,
        arguments: expression.arguments.map(markExpressionUntracked),
        callee: markExpressionUntracked(expression.callee),
      };
    case 'capability-read':
      return expression;
    case 'collection':
      return {
        ...expression,
        callback: {
          ...expression.callback,
          result: markExpressionUntracked(expression.callback.result),
        },
        ...(expression.initial ? { initial: markExpressionUntracked(expression.initial) } : {}),
        ...(expression.options ? { options: markExpressionUntracked(expression.options) } : {}),
        source: markExpressionUntracked(expression.source),
      };
    case 'conditional':
      return {
        ...expression,
        branches: expression.branches.map((branch) => ({
          ...branch,
          ...(branch.condition ? { condition: markExpressionUntracked(branch.condition) } : {}),
          result: markExpressionUntracked(branch.result),
        })),
      };
    case 'literal':
    case 'local-read':
      return expression;
    case 'member':
      return { ...expression, object: markExpressionUntracked(expression.object) };
    case 'record':
      return {
        ...expression,
        entries: expression.entries.map((entry) => ({
          ...entry,
          value: markExpressionUntracked(entry.value),
        })),
      };
    case 'read':
      return { ...expression, tracked: false };
  }
};

const lowerExpression = (
  expression: ExpressionNode,
  values: ReadonlyMap<string, ValueSymbol>,
  scopeName: string,
  state: AnalysisState,
  locals: ReadonlyMap<string, ValueExpressionV1> = new Map(),
): ValueExpressionV1 | undefined => {
  switch (expression.kind) {
    case 'ArrayLiteral': {
      const elements = expression.elements.flatMap((element) => {
        const lowered = lowerExpression(element, values, scopeName, state, locals);
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
      const local = locals.get(expression.name);
      if (local) {
        return local;
      }
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
      return (
        target.substitution ?? {
          kind: 'read',
          targetId: target.id,
          span: graphSpan(expression.span),
        }
      );
    }
    case 'ParenthesizedExpression':
      return lowerExpression(expression.expression, values, scopeName, state, locals);
    case 'BinaryExpression': {
      const left = lowerExpression(expression.left, values, scopeName, state, locals);
      const right = lowerExpression(expression.right, values, scopeName, state, locals);
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
    case 'RecordLiteral': {
      const entries = expression.entries.flatMap((entry) => {
        const value = lowerExpression(entry.value, values, scopeName, state, locals);
        return value ? [{ name: entry.name.name, span: graphSpan(entry.span), value }] : [];
      });
      return entries.length === expression.entries.length
        ? { entries, kind: 'record', span: graphSpan(expression.span) }
        : undefined;
    }
    case 'MemberExpression': {
      const object = lowerExpression(expression.object, values, scopeName, state, locals);
      return object
        ? {
            kind: 'member',
            object,
            property: expression.property.name,
            span: graphSpan(expression.span),
          }
        : undefined;
    }
    case 'CallExpression': {
      const path = expressionPath(expression.callee);
      const platform = path ? state.platformCapabilities.get(path.join('.')) : undefined;
      if (platform) {
        platform.used = true;
        platform.span ??= expression.callee.span;
        const declaredTarget = platform.contract.target ?? 'universal';
        if (declaredTarget !== 'universal' && declaredTarget !== state.target) {
          report(
            state,
            'OXE2008',
            `Platform capability "${platform.contract.name}" is ${declaredTarget}-only but this compilation targets ${state.target}.`,
            expression.callee.span,
          );
        }
        const arguments_ = expression.arguments.flatMap((argument) => {
          const lowered = lowerExpression(argument, values, scopeName, state, locals);
          return lowered ? [lowered] : [];
        });
        if (arguments_.length !== expression.arguments.length) {
          return undefined;
        }
        const routeOptionalOptions =
          (platform.routeIntrinsic === 'navigate' ||
            platform.routeIntrinsic === 'set-search-params') &&
          arguments_.length === 1;
        if (arguments_.length !== platform.contract.parameters.length && !routeOptionalOptions) {
          report(
            state,
            'OXE2009',
            `Platform capability "${platform.contract.name}" expects ${platform.contract.parameters.length} argument${platform.contract.parameters.length === 1 ? '' : 's'}, but received ${arguments_.length}.`,
            expression.span,
          );
        }
        const valuesById = new Map([...values.values()].map((value) => [value.id, value]));
        arguments_.forEach((argument, index) => {
          const expected = platform.contract.parameters[index];
          const actual = inferExpressionTypeWithoutDiagnostics(argument, valuesById);
          if (expected && actual !== 'unknown' && expected !== actual) {
            report(
              state,
              'OXE2009',
              `Argument ${index + 1} to "${platform.contract.name}" must be ${expected}, but received ${actual}.`,
              argument.span,
            );
          }
        });
        return {
          arguments: arguments_,
          callee: {
            kind: 'capability-read',
            span: graphSpan(expression.callee.span),
            targetId: platform.id,
          },
          kind: 'call',
          ...(platform.contract.returns ? { returnType: platform.contract.returns } : {}),
          span: graphSpan(expression.span),
        };
      }
      const callee = lowerExpression(expression.callee, values, scopeName, state, locals);
      const arguments_ = expression.arguments.flatMap((argument) => {
        const lowered = lowerExpression(argument, values, scopeName, state, locals);
        return lowered ? [lowered] : [];
      });
      return callee && arguments_.length === expression.arguments.length
        ? { arguments: arguments_, callee, kind: 'call', span: graphSpan(expression.span) }
        : undefined;
    }
    case 'CollectionExpression': {
      const source = lowerExpression(expression.collection, values, scopeName, state, locals);
      if (!source || expression.callback.result.kind === 'Element') {
        return undefined;
      }
      const valuesById = new Map([...values.values()].map((value) => [value.id, value]));
      const itemType = inferArrayItemTypeWithoutDiagnostics(source, valuesById) ?? 'unknown';
      const itemRecord = inferArrayItemRecordWithoutDiagnostics(source, valuesById);
      const initial = expression.initial
        ? lowerExpression(expression.initial, values, scopeName, state, locals)
        : undefined;
      const options = expression.options
        ? lowerExpression(expression.options, values, scopeName, state, locals)
        : undefined;
      if (expression.initial && !initial) {
        return undefined;
      }
      if (expression.options && !options) {
        return undefined;
      }
      const initialType = initial
        ? inferExpressionTypeWithoutDiagnostics(initial, valuesById)
        : 'unknown';
      const callbackLocals = new Map(locals);
      const parameters = expression.parameters.map((parameter, index) => {
        const id = `${scopeName}/callback/${expression.span.start.offset}/${identifierSegment(parameter.name)}`;
        const type = expression.operation === 'reduce' && index === 0 ? initialType : itemType;
        callbackLocals.set(parameter.name, {
          kind: 'local-read',
          ...(itemRecord && !(expression.operation === 'reduce' && index === 0)
            ? { record: itemRecord }
            : {}),
          span: graphSpan(parameter.span),
          targetId: id,
          type,
        });
        return {
          id,
          name: parameter.name,
          span: graphSpan(parameter.span),
          type,
        };
      });
      for (const assignment of expression.callback.assignments) {
        const value = lowerExpression(
          assignment.value,
          values,
          `${scopeName} callback`,
          state,
          callbackLocals,
        );
        if (!value) {
          return undefined;
        }
        callbackLocals.set(assignment.target.name, value);
      }
      const result = lowerExpression(
        expression.callback.result,
        values,
        `${scopeName} callback`,
        state,
        callbackLocals,
      );
      if (!result) {
        return undefined;
      }
      return {
        callback: {
          parameters,
          result,
          span: graphSpan(expression.callback.span),
        },
        ...(initial ? { initial } : {}),
        kind: 'collection',
        operation: expression.operation,
        ...(options ? { options } : {}),
        source,
        span: graphSpan(expression.span),
      };
    }
    case 'ConditionalValueExpression': {
      const branches: Extract<ValueExpressionV1, { kind: 'conditional' }>['branches'][number][] =
        [];
      for (const branch of expression.branches) {
        const condition = branch.condition
          ? lowerExpression(branch.condition, values, scopeName, state, locals)
          : undefined;
        const branchLocals = new Map(locals);
        let resultSyntax = branch.result;
        if (resultSyntax.kind === 'ConditionalResultBlock') {
          for (const statement of resultSyntax.statements) {
            if (statement.kind === 'ExpressionStatement') {
              report(
                state,
                'OXE2008',
                'A scalar conditional result block may contain local assignments but not effect calls.',
                statement.span,
              );
              continue;
            }
            const value = lowerExpression(
              statement.value,
              values,
              `${scopeName} conditional result`,
              state,
              branchLocals,
            );
            if (value) {
              branchLocals.set(statement.target.name, value);
            }
          }
          resultSyntax = resultSyntax.result;
        }
        if (resultSyntax.kind === 'Element') {
          report(
            state,
            'OXE2008',
            'Captured markup is a content value and must be rendered from a content placement.',
            resultSyntax.span,
          );
          return undefined;
        }
        const result = lowerExpression(resultSyntax, values, scopeName, state, branchLocals);
        if ((branch.condition && !condition) || !result) {
          return undefined;
        }
        branches.push({
          ...(condition ? { condition } : {}),
          result,
          span: graphSpan(branch.span),
        });
      }
      return { kind: 'conditional', branches, span: graphSpan(expression.span) };
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
      const value = lowerExpression(expression.expression, values, scopeName, state, locals);
      return value ? markExpressionUntracked(value) : undefined;
    }
  }
};

interface ReadReference {
  readonly path: readonly string[];
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
    case 'capability-read':
      return;
    case 'binary':
      collectReads(expression.left, result);
      collectReads(expression.right, result);
      return;
    case 'call':
      collectReads(expression.callee, result);
      for (const argument of expression.arguments) {
        collectReads(argument, result);
      }
      return;
    case 'collection':
      collectReads(expression.source, result);
      collectReads(expression.callback.result, result);
      if (expression.initial) {
        collectReads(expression.initial, result);
      }
      if (expression.options) {
        collectReads(expression.options, result);
      }
      return;
    case 'conditional':
      for (const branch of expression.branches) {
        if (branch.condition) {
          collectReads(branch.condition, result);
        }
        collectReads(branch.result, result);
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
      if (current.kind === 'read' && current.tracked !== false) {
        result.push({ path, targetId: current.targetId, span: expression.span });
        return;
      }
      collectReads(expression.object, result);
      return;
    }
    case 'record':
      for (const entry of expression.entries) {
        collectReads(entry.value, result);
      }
      return;
    case 'read':
      if (expression.tracked === false) {
        return;
      }
      result.push({ path: [], targetId: expression.targetId, span: expression.span });
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
      case 'call':
        return false;
      case 'capability-read':
        return false;
      case 'collection':
        return false;
      case 'literal':
      case 'local-read':
        return true;
      case 'member':
        return expressionIsConstant(expression.object);
      case 'record':
        return expression.entries.every((entry) => expressionIsConstant(entry.value));
      case 'binary':
        return expressionIsConstant(expression.left) && expressionIsConstant(expression.right);
      case 'conditional':
        return expression.branches.every(
          (branch) =>
            (!branch.condition || expressionIsConstant(branch.condition)) &&
            expressionIsConstant(branch.result),
        );
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
    if (
      binding.classification === 'async-resource' ||
      binding.classification === 'context' ||
      binding.classification === 'resource'
    ) {
      continue;
    }
    binding.classification =
      writtenIds.has(binding.id) || binding.forcedCell
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
    if (
      !binding ||
      binding.classification === 'cell' ||
      binding.classification === 'async-resource' ||
      binding.classification === 'context' ||
      binding.classification === 'resource' ||
      !binding.expression
    ) {
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

const resolveRecordExpression = (
  expression: ValueExpressionV1,
  valuesById: ReadonlyMap<string, ValueSymbol>,
  visited: ReadonlySet<string> = new Set(),
): Extract<ValueExpressionV1, { kind: 'record' }> | undefined => {
  if (expression.kind === 'record') {
    return expression;
  }
  if (expression.kind === 'local-read') {
    return expression.record;
  }
  if (expression.kind === 'read') {
    if (visited.has(expression.targetId)) {
      return undefined;
    }
    const target = valuesById.get(expression.targetId)?.expression;
    return target
      ? resolveRecordExpression(target, valuesById, new Set([...visited, expression.targetId]))
      : undefined;
  }
  if (expression.kind === 'member') {
    const parent = resolveRecordExpression(expression.object, valuesById, visited);
    const field = parent?.entries.find((entry) => entry.name === expression.property);
    return field ? resolveRecordExpression(field.value, valuesById, visited) : undefined;
  }
  return undefined;
};

const memberRootAndPath = (
  target: MemberExpressionNode,
): { readonly path: readonly string[]; readonly root: IdentifierNode } | undefined => {
  const path: string[] = [];
  let current: ExpressionNode = target;
  while (current.kind === 'MemberExpression') {
    path.unshift(current.property.name);
    current = current.object;
  }
  return current.kind === 'Identifier' ? { path, root: current } : undefined;
};

const replaceRecordMember = (
  schema: Extract<ValueExpressionV1, { readonly kind: 'record' }>,
  object: ValueExpressionV1,
  path: readonly string[],
  replacement: ValueExpressionV1,
  valuesById: ReadonlyMap<string, ValueSymbol>,
  state: AnalysisState,
  span: SourceSpan,
): Extract<ValueExpressionV1, { readonly kind: 'record' }> | undefined => {
  const [field, ...rest] = path;
  if (!field) {
    return undefined;
  }
  const target = schema.entries.find((entry) => entry.name === field);
  if (!target) {
    report(state, 'OXE2002', `Record has no field "${field}".`, span);
    return undefined;
  }

  let nextValue = replacement;
  if (rest.length > 0) {
    const nestedSchema = resolveRecordExpression(target.value, valuesById);
    if (!nestedSchema) {
      report(state, 'OXE2009', `Record field "${field}" is not a nested record.`, span);
      return undefined;
    }
    const nestedObject: ValueExpressionV1 = {
      kind: 'member',
      object,
      property: field,
      span: graphSpan(span),
    };
    const nested = replaceRecordMember(
      nestedSchema,
      nestedObject,
      rest,
      replacement,
      valuesById,
      state,
      span,
    );
    if (!nested) {
      return undefined;
    }
    nextValue = nested;
  } else {
    const expectedType = inferExpressionTypeWithoutDiagnostics(target.value, valuesById);
    const replacementType = inferExpressionTypeWithoutDiagnostics(replacement, valuesById);
    if (
      expectedType !== 'unknown' &&
      replacementType !== 'unknown' &&
      expectedType !== replacementType
    ) {
      report(
        state,
        'OXE2009',
        `Cannot assign ${replacementType} to ${expectedType} record field "${field}".`,
        span,
      );
    }
  }

  return {
    entries: schema.entries.map((entry) => ({
      ...entry,
      value:
        entry.name === field
          ? nextValue
          : {
              kind: 'member',
              object,
              property: entry.name,
              span: graphSpan(span),
            },
    })),
    kind: 'record',
    span: graphSpan(span),
  };
};

const inferExpressionTypeWithoutDiagnostics = (
  expression: ValueExpressionV1,
  valuesById: ReadonlyMap<string, ValueSymbol>,
): PrimitiveTypeV1 => {
  switch (expression.kind) {
    case 'array':
      return 'array';
    case 'call':
      return expression.returnType ?? 'unknown';
    case 'capability-read':
      return 'unknown';
    case 'collection':
      return expression.operation === 'reduce'
        ? inferExpressionTypeWithoutDiagnostics(
            expression.initial ?? expression.callback.result,
            valuesById,
          )
        : 'array';
    case 'literal':
      return typeof expression.value as 'boolean' | 'number' | 'string';
    case 'read':
      return valuesById.get(expression.targetId)?.type ?? 'unknown';
    case 'local-read':
      return expression.type;
    case 'member': {
      const record = resolveRecordExpression(expression.object, valuesById);
      if (record) {
        const entry = record.entries.find((item) => item.name === expression.property);
        return entry ? inferExpressionTypeWithoutDiagnostics(entry.value, valuesById) : 'unknown';
      }
      const objectType = inferExpressionTypeWithoutDiagnostics(expression.object, valuesById);
      return expression.property === 'length' && (objectType === 'array' || objectType === 'string')
        ? 'number'
        : 'unknown';
    }
    case 'record':
      return 'record';
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
    case 'conditional': {
      let resultType: PrimitiveTypeV1 = 'unknown';
      for (const branch of expression.branches) {
        if (branch.condition) {
          const conditionType = inferExpressionTypeWithoutDiagnostics(branch.condition, valuesById);
          if (conditionType !== 'boolean' && conditionType !== 'unknown') {
            return 'unknown';
          }
        }
        const current = inferExpressionTypeWithoutDiagnostics(branch.result, valuesById);
        if (current === 'unknown') {
          continue;
        }
        if (resultType !== 'unknown' && resultType !== current) {
          return 'unknown';
        }
        resultType = current;
      }
      return resultType;
    }
  }
};

const inferArrayItemTypeWithoutDiagnostics = (
  expression: ValueExpressionV1,
  valuesById: ReadonlyMap<string, ValueSymbol>,
): PrimitiveTypeV1 | undefined => {
  if (expression.kind === 'collection') {
    if (expression.operation === 'filter' || expression.operation === 'sort') {
      return inferArrayItemTypeWithoutDiagnostics(expression.source, valuesById);
    }
    if (expression.operation === 'map') {
      return inferExpressionTypeWithoutDiagnostics(expression.callback.result, valuesById);
    }
    return undefined;
  }
  if (expression.kind === 'read') {
    return valuesById.get(expression.targetId)?.itemType;
  }
  if (expression.kind === 'conditional') {
    let itemType: PrimitiveTypeV1 | undefined;
    for (const branch of expression.branches) {
      const current = inferArrayItemTypeWithoutDiagnostics(branch.result, valuesById);
      if (current && itemType && current !== itemType) {
        return undefined;
      }
      itemType = current ?? itemType;
    }
    return itemType;
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

const recordSchemaKey = (
  record: Extract<ValueExpressionV1, { kind: 'record' }>,
  valuesById: ReadonlyMap<string, ValueSymbol>,
): string =>
  [...record.entries]
    .sort((left, right) => compareText(left.name, right.name))
    .map((entry) => {
      const nested = resolveRecordExpression(entry.value, valuesById);
      return nested
        ? `${entry.name}:{${recordSchemaKey(nested, valuesById)}}`
        : `${entry.name}:${inferExpressionTypeWithoutDiagnostics(entry.value, valuesById)}`;
    })
    .join(',');

const inferArrayItemRecordWithoutDiagnostics = (
  expression: ValueExpressionV1,
  valuesById: ReadonlyMap<string, ValueSymbol>,
  visited: ReadonlySet<string> = new Set(),
): Extract<ValueExpressionV1, { kind: 'record' }> | undefined => {
  if (expression.kind === 'collection') {
    if (expression.operation === 'filter' || expression.operation === 'sort') {
      return inferArrayItemRecordWithoutDiagnostics(expression.source, valuesById, visited);
    }
    if (expression.operation === 'map') {
      return resolveRecordExpression(expression.callback.result, valuesById);
    }
    if (expression.operation === 'flatMap') {
      return inferArrayItemRecordWithoutDiagnostics(
        expression.callback.result,
        valuesById,
        visited,
      );
    }
    return undefined;
  }
  if (expression.kind === 'read') {
    if (visited.has(expression.targetId)) {
      return undefined;
    }
    const target = valuesById.get(expression.targetId)?.expression;
    return target
      ? inferArrayItemRecordWithoutDiagnostics(
          target,
          valuesById,
          new Set([...visited, expression.targetId]),
        )
      : undefined;
  }
  if (expression.kind === 'conditional') {
    let result: Extract<ValueExpressionV1, { kind: 'record' }> | undefined;
    let schema: string | undefined;
    for (const branch of expression.branches) {
      const current = inferArrayItemRecordWithoutDiagnostics(branch.result, valuesById, visited);
      if (!current) {
        return undefined;
      }
      const currentSchema = recordSchemaKey(current, valuesById);
      if (schema && schema !== currentSchema) {
        return undefined;
      }
      result = result ?? current;
      schema = currentSchema;
    }
    return result;
  }
  if (expression.kind !== 'array' || expression.elements.length === 0) {
    return undefined;
  }
  let result: Extract<ValueExpressionV1, { kind: 'record' }> | undefined;
  let schema: string | undefined;
  for (const element of expression.elements) {
    const current = resolveRecordExpression(element, valuesById);
    if (!current) {
      return undefined;
    }
    const currentSchema = recordSchemaKey(current, valuesById);
    if (schema && schema !== currentSchema) {
      return undefined;
    }
    result = result ?? current;
    schema = currentSchema;
  }
  return result;
};

const mutationCallbackParameter = (
  statement: CollectionMutationStatementNode,
  parameter: IdentifierNode,
  role: 'predicate' | 'updater',
  itemType: PrimitiveTypeV1,
): CollectionCallbackV1['parameters'][number] => ({
  id: `${statement.collection.name}/mutation/${statement.span.start.offset}/${role}/${identifierSegment(parameter.name)}`,
  name: parameter.name,
  span: graphSpan(parameter.span),
  type: itemType,
});

const lowerMutationPredicate = (
  statement: CollectionMutationStatementNode,
  source: ValueExpressionV1,
  values: ReadonlyMap<string, ValueSymbol>,
  scopeName: string,
  state: AnalysisState,
): CollectionCallbackV1 | undefined => {
  const predicate = statement.predicate;
  if (!predicate || predicate.callback.result.kind === 'Element') {
    return undefined;
  }
  const valuesById = new Map([...values.values()].map((value) => [value.id, value]));
  const itemType = inferArrayItemTypeWithoutDiagnostics(source, valuesById) ?? 'unknown';
  const itemRecord = inferArrayItemRecordWithoutDiagnostics(source, valuesById);
  const parameter = mutationCallbackParameter(
    statement,
    predicate.parameter,
    'predicate',
    itemType,
  );
  const locals = new Map<string, ValueExpressionV1>();
  locals.set(predicate.parameter.name, {
    kind: 'local-read',
    ...(itemRecord ? { record: itemRecord } : {}),
    span: graphSpan(predicate.parameter.span),
    targetId: parameter.id,
    type: itemType,
  });
  for (const assignment of predicate.callback.assignments) {
    const value = lowerExpression(
      assignment.value,
      values,
      `${scopeName} ${statement.operation} predicate`,
      state,
      locals,
    );
    if (!value) {
      return undefined;
    }
    locals.set(assignment.target.name, value);
  }
  const result = lowerExpression(
    predicate.callback.result,
    values,
    `${scopeName} ${statement.operation} predicate`,
    state,
    locals,
  );
  return result
    ? {
        parameters: [parameter],
        result,
        span: graphSpan(predicate.span),
      }
    : undefined;
};

const lowerMutationUpdater = (
  statement: CollectionMutationStatementNode,
  source: ValueExpressionV1,
  values: ReadonlyMap<string, ValueSymbol>,
  scopeName: string,
  state: AnalysisState,
): CollectionCallbackV1 | undefined => {
  const updater = statement.updater;
  if (!updater) {
    return undefined;
  }
  const valuesById = new Map([...values.values()].map((value) => [value.id, value]));
  const itemType = inferArrayItemTypeWithoutDiagnostics(source, valuesById) ?? 'unknown';
  let itemRecord = inferArrayItemRecordWithoutDiagnostics(source, valuesById);
  const parameter = mutationCallbackParameter(statement, updater.parameter, 'updater', itemType);
  let current: ValueExpressionV1 = {
    kind: 'local-read',
    ...(itemRecord ? { record: itemRecord } : {}),
    span: graphSpan(updater.parameter.span),
    targetId: parameter.id,
    type: itemType,
  };
  const locals = new Map<string, ValueExpressionV1>();
  locals.set(updater.parameter.name, current);

  for (const assignment of updater.assignments) {
    const value = lowerExpression(
      assignment.value,
      values,
      `${scopeName} update callback`,
      state,
      locals,
    );
    if (!value) {
      return undefined;
    }
    if (assignment.target.kind === 'Identifier') {
      if (assignment.target.name !== updater.parameter.name) {
        report(
          state,
          'OXE2008',
          `An update callback may only replace "${updater.parameter.name}" or assign one of its fields.`,
          assignment.target.span,
        );
        return undefined;
      }
      current = value;
      itemRecord = resolveRecordExpression(value, valuesById);
    } else {
      const target = memberRootAndPath(assignment.target);
      if (!target || target.root.name !== updater.parameter.name) {
        report(
          state,
          'OXE2008',
          `An update callback may only assign fields rooted at "${updater.parameter.name}".`,
          assignment.target.span,
        );
        return undefined;
      }
      if (!itemRecord) {
        report(
          state,
          'OXE2009',
          'A field update requires a collection with a known record shape.',
          assignment.target.span,
        );
        return undefined;
      }
      const next = replaceRecordMember(
        itemRecord,
        current,
        target.path,
        value,
        valuesById,
        state,
        assignment.span,
      );
      if (!next) {
        return undefined;
      }
      current = next;
      itemRecord = next;
    }
    locals.set(updater.parameter.name, current);
  }

  return {
    parameters: [parameter],
    result: current,
    span: graphSpan(updater.span),
  };
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
        if (binding.classification === 'resource') {
          continue;
        }
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
      if (binding.classification === 'resource') {
        continue;
      }
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
        const result: ConstantValueV1[] = [];
        for (const element of expression.elements) {
          const value = evaluateExpression(element);
          if (value === undefined) {
            return undefined;
          }
          result.push(value);
        }
        return result;
      }
      case 'literal':
        return expression.value;
      case 'call':
      case 'capability-read':
      case 'collection':
      case 'local-read':
        return undefined;
      case 'member': {
        const object = evaluateExpression(expression.object);
        if (!isConstantRecord(object)) {
          return undefined;
        }
        return object[expression.property];
      }
      case 'record': {
        const result: Record<string, ConstantValueV1> = {};
        for (const entry of expression.entries) {
          const value = evaluateExpression(entry.value);
          if (value === undefined) {
            return undefined;
          }
          result[entry.name] = value;
        }
        return result;
      }
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
      case 'conditional':
        for (const branch of expression.branches) {
          if (!branch.condition) {
            return evaluateExpression(branch.result);
          }
          const condition = evaluateExpression(branch.condition);
          if (condition === true) {
            return evaluateExpression(branch.result);
          }
          if (condition !== false) {
            return undefined;
          }
        }
        return undefined;
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
      accesses: expressions.flatMap((expression) => {
        const reads: ReadReference[] = [];
        collectReads(expression, reads);
        return reads
          .filter((read) => read.targetId === targetId)
          .map((read) => ({ path: read.path, span: read.span }));
      }),
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
  const accessesByTarget = new Map<
    string,
    { readonly path: readonly string[]; readonly span: GraphSpanV1 }[]
  >();
  for (const step of procedure.steps) {
    if (step.kind === 'call' || step.kind === 'refresh') {
      continue;
    }
    const sites = sitesByTarget.get(step.targetId) ?? [];
    sites.push(step.span);
    sitesByTarget.set(step.targetId, sites);
    const accesses = accessesByTarget.get(step.targetId) ?? [];
    accesses.push({ path: step.kind === 'write' ? (step.path ?? []) : [], span: step.span });
    accessesByTarget.set(step.targetId, accesses);
  }
  for (const targetId of [...sitesByTarget.keys()].sort(compareText)) {
    edges.push({
      accesses: accessesByTarget.get(targetId) ?? [],
      kind: 'write',
      from: procedure.id,
      to: targetId,
      mode: 'procedural',
      sites: sitesByTarget.get(targetId) ?? [],
    });
  }
};

const procedureStepExpressions = (step: ProcedureStepV1): readonly ValueExpressionV1[] => {
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

const registerComponentSymbols = (
  component: ComponentDeclarationNode,
  moduleId: string,
  contexts: ReadonlyMap<string, ContextInfo>,
  state: AnalysisState,
): ComponentSymbols => {
  const ownerId = componentId(moduleId, component.name.name);
  const bindings = new Map<string, BindingInfo>();
  const contents = new Map<string, ContentInfo>();
  const parameters = new Map<string, ParameterInfo>();
  const procedures = new Map<string, ProcedureInfo>();
  const refs = new Map<string, RefInfo>();
  const renderRoots: (ElementNode | ConditionalRegionNode)[] = [];
  const effects: ExpressionStatementNode[] = [];
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
          if (isContentChoice(statement.value)) {
            contents.set(statement.target.name, {
              declaration: statement,
              id: contentId(ownerId, statement.target.name),
            });
          } else {
            const context = contextRead(statement.value, contexts);
            bindings.set(statement.target.name, {
              ...(context ? { context } : {}),
              declaration: statement,
              id: bindingId(ownerId, statement.target.name),
              classification: context ? 'context' : 'computed',
              expression: undefined,
              type: 'unknown',
            });
          }
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
      case 'ExpressionStatement':
        effects.push(statement);
        break;
      case 'Element':
      case 'ConditionalRegion':
        renderRoots.push(statement);
        break;
    }
  }

  const scanRefsInConditional = (region: ConditionalRegionNode): void => {
    for (const branch of region.branches) {
      const result =
        branch.result.kind === 'ConditionalResultBlock' ? branch.result.result : branch.result;
      if (result.kind === 'Element') {
        scanRefsInElement(result);
      }
    }
  };
  const scanRefsInElement = (element: ElementNode): void => {
    for (const attribute of element.attributes) {
      if (attribute.kind !== 'Attribute' || attribute.name.name !== 'ref') {
        continue;
      }
      if (!/^[a-z]/u.test(element.name.name)) {
        report(
          state,
          'OXE2008',
          'ref is currently supported only on platform elements.',
          attribute.span,
        );
        continue;
      }
      if (attribute.value.kind !== 'Identifier') {
        report(state, 'OXE2008', 'ref requires a new identifier.', attribute.value.span);
        continue;
      }
      if (register(attribute.value.name, attribute.value.span)) {
        refs.set(attribute.value.name, {
          attribute,
          declaration: attribute.value,
          id: refId(ownerId, attribute.value.name),
          type: 'unknown',
        });
      }
    }
    for (const child of element.children) {
      if (child.kind === 'Element') {
        scanRefsInElement(child);
      } else if (child.kind === 'ConditionalRegion') {
        scanRefsInConditional(child);
      } else if (child.kind === 'Interpolation' && child.expression.kind === 'MapExpression') {
        scanRefsInElement(child.expression.body);
      }
    }
  };
  for (const root of renderRoots) {
    if (root.kind === 'Element') {
      scanRefsInElement(root);
    } else {
      scanRefsInConditional(root);
    }
  }

  const values = new Map<string, ValueSymbol>();
  for (const [name, parameter] of parameters) {
    values.set(name, parameter);
  }
  for (const [name, binding] of bindings) {
    values.set(name, binding);
  }
  for (const [name, ref] of refs) {
    values.set(name, ref);
  }

  return {
    bindings,
    component,
    componentId: ownerId,
    contents,
    contexts,
    effects,
    parameters,
    procedures,
    refs,
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
    case 'CallExpression':
      if (expression.callee.kind === 'MemberExpression') {
        visitExpressionIdentifiers(expression.callee.object, visit);
      }
      for (const argument of expression.arguments) {
        visitExpressionIdentifiers(argument, visit);
      }
      return;
    case 'CollectionExpression':
      visitExpressionIdentifiers(expression.collection, visit);
      for (const assignment of expression.callback.assignments) {
        visitExpressionIdentifiers(assignment.value, visit);
      }
      if (expression.callback.result.kind !== 'Element') {
        visitExpressionIdentifiers(expression.callback.result, visit);
      }
      if (expression.initial) {
        visitExpressionIdentifiers(expression.initial, visit);
      }
      if (expression.options) {
        visitExpressionIdentifiers(expression.options, visit);
      }
      return;
    case 'Identifier':
      visit(expression);
      return;
    case 'BinaryExpression':
      visitExpressionIdentifiers(expression.left, visit);
      visitExpressionIdentifiers(expression.right, visit);
      return;
    case 'ConditionalValueExpression':
      for (const branch of expression.branches) {
        if (branch.condition) {
          visitExpressionIdentifiers(branch.condition, visit);
        }
        if (branch.result.kind === 'ConditionalResultBlock') {
          for (const statement of branch.result.statements) {
            visitExpressionIdentifiers(
              statement.kind === 'AssignmentStatement' ? statement.value : statement.expression,
              visit,
            );
          }
          if (branch.result.result.kind !== 'Element') {
            visitExpressionIdentifiers(branch.result.result, visit);
          }
        } else if (branch.result.kind !== 'Element') {
          visitExpressionIdentifiers(branch.result, visit);
        }
      }
      return;
    case 'ParenthesizedExpression':
      visitExpressionIdentifiers(expression.expression, visit);
      return;
    case 'MapExpression':
      visitExpressionIdentifiers(expression.collection, visit);
      for (const assignment of expression.assignments) {
        visitExpressionIdentifiers(assignment.value, visit);
      }
      return;
    case 'MemberExpression':
      visitExpressionIdentifiers(expression.object, visit);
      return;
    case 'RecordLiteral':
      for (const entry of expression.entries) {
        visitExpressionIdentifiers(entry.value, visit);
      }
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
  for (const content of component.contents.values()) {
    if (content.declaration.value.kind !== 'ConditionalValueExpression') {
      continue;
    }
    for (const branch of content.declaration.value.branches) {
      if (branch.condition) {
        markExpressionParametersAsValues(branch.condition, component, state);
      }
      if (branch.result.kind === 'ConditionalResultBlock') {
        for (const statement of branch.result.statements) {
          markExpressionParametersAsValues(
            statement.kind === 'AssignmentStatement' ? statement.value : statement.expression,
            component,
            state,
          );
        }
      }
    }
  }
  for (const procedure of component.procedures.values()) {
    for (const statement of procedure.declaration.body) {
      const expressions: readonly ExpressionNode[] =
        statement.kind === 'AssignmentStatement' || statement.kind === 'MemberAssignmentStatement'
          ? [statement.value]
          : statement.kind === 'ExpressionStatement'
            ? [statement.expression]
            : [
                ...(statement.value ? [statement.value] : []),
                ...(statement.predicate
                  ? [
                      ...statement.predicate.callback.assignments.map(
                        (assignment) => assignment.value,
                      ),
                      ...(statement.predicate.callback.result.kind === 'Element'
                        ? []
                        : [statement.predicate.callback.result]),
                    ]
                  : []),
                ...(statement.updater
                  ? statement.updater.assignments.map((assignment) => assignment.value)
                  : []),
                ...(statement.limit ? [statement.limit] : []),
              ];
      for (const expression of expressions) {
        if (expression.kind === 'CallExpression' && expression.callee.kind === 'Identifier') {
          const parameter = component.parameters.get(expression.callee.name);
          if (parameter) {
            markParameterKind(parameter, 'procedure', expression.callee.span, state);
          }
        }
        markExpressionParametersAsValues(expression, component, state);
      }
    }
  }
  for (const effect of component.effects) {
    if (
      effect.expression.kind === 'CallExpression' &&
      effect.expression.callee.kind === 'Identifier'
    ) {
      const parameter = component.parameters.get(effect.expression.callee.name);
      if (parameter) {
        markParameterKind(parameter, 'procedure', effect.expression.callee.span, state);
      }
    }
    markExpressionParametersAsValues(effect.expression, component, state);
  }

  const scanElement = (element: ElementNode): void => {
    if (/^[a-z]/u.test(element.name.name) || component.contexts.has(element.name.name)) {
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
      } else if (child.kind === 'ConditionalRegion') {
        scanConditionalRegion(child);
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

  const scanConditionalRegion = (region: ConditionalRegionNode): void => {
    for (const branch of region.branches) {
      if (branch.condition) {
        markExpressionParametersAsValues(branch.condition, component, state);
      }
      const result =
        branch.result.kind === 'ConditionalResultBlock' ? branch.result.result : branch.result;
      if (branch.result.kind === 'ConditionalResultBlock') {
        for (const statement of branch.result.statements) {
          markExpressionParametersAsValues(
            statement.kind === 'AssignmentStatement' ? statement.value : statement.expression,
            component,
            state,
          );
        }
      }
      if (result.kind === 'Element') {
        scanElement(result);
      }
    }
  };

  for (const root of component.renderRoots) {
    if (root.kind === 'Element') {
      scanElement(root);
    } else {
      scanConditionalRegion(root);
    }
  }
  for (const content of component.contents.values()) {
    if (content.declaration.value.kind !== 'ConditionalValueExpression') {
      continue;
    }
    for (const branch of content.declaration.value.branches) {
      const element = conditionalResultElement(branch.result);
      if (element) {
        scanElement(element);
      }
    }
  }
};

const collectComponentInvocations = (
  components: ReadonlyMap<string, ComponentSymbols>,
  componentScopes: ReadonlyMap<string, ReadonlyMap<string, ComponentSymbols>>,
  state: AnalysisState,
): readonly ComponentInvocation[] => {
  const invocations: ComponentInvocation[] = [];

  const visitElement = (
    element: ElementNode,
    owner: ComponentSymbols,
    deferredValueProps = false,
  ): void => {
    if (owner.contexts.has(element.name.name)) {
      const valueAttributes = element.attributes.filter(
        (attribute): attribute is AttributeNode =>
          attribute.kind === 'Attribute' && attribute.name.name === 'value',
      );
      const invalidAttributes = element.attributes.filter(
        (attribute) =>
          attribute.kind === 'SpreadAttribute' ||
          (attribute.kind === 'Attribute' && attribute.name.name !== 'value'),
      );
      if (valueAttributes.length === 0) {
        report(
          state,
          'OXE2011',
          `Context provider <${element.name.name}> requires a value prop.`,
          element.name.span,
        );
      } else if (valueAttributes.length > 1) {
        report(
          state,
          'OXE2001',
          `Context provider <${element.name.name}> declares value more than once.`,
          valueAttributes[1]?.span ?? element.span,
        );
      }
      for (const attribute of invalidAttributes) {
        report(
          state,
          'OXE2011',
          `Context provider <${element.name.name}> only accepts the value prop.`,
          attribute.span,
        );
      }
      for (const child of element.children) {
        if (child.kind === 'Element') {
          visitElement(child, owner, deferredValueProps);
        } else if (child.kind === 'ConditionalRegion') {
          visitConditionalRegion(child, owner, deferredValueProps);
        } else if (child.kind === 'Interpolation' && child.expression.kind === 'MapExpression') {
          visitElement(child.expression.body, owner, true);
        }
      }
      return;
    }
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

      invocations.push({
        arguments: argumentsByName,
        deferredValueProps,
        element,
        owner,
        spreads,
        target,
      });
      for (const child of element.children) {
        if (child.kind === 'Element') {
          visitElement(child, owner, deferredValueProps);
        } else if (child.kind === 'ConditionalRegion') {
          visitConditionalRegion(child, owner, deferredValueProps);
        } else if (child.kind === 'Interpolation' && child.expression.kind === 'MapExpression') {
          visitElement(child.expression.body, owner, true);
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
        visitElement(child, owner, deferredValueProps);
      } else if (child.kind === 'ConditionalRegion') {
        visitConditionalRegion(child, owner, deferredValueProps);
      } else if (child.kind === 'Interpolation' && child.expression.kind === 'MapExpression') {
        visitElement(child.expression.body, owner, true);
      }
    }
  };

  const visitConditionalRegion = (
    region: ConditionalRegionNode,
    owner: ComponentSymbols,
    deferredValueProps = false,
  ): void => {
    for (const branch of region.branches) {
      const result =
        branch.result.kind === 'ConditionalResultBlock' ? branch.result.result : branch.result;
      if (result.kind === 'Element') {
        visitElement(result, owner, deferredValueProps);
      }
    }
  };

  for (const component of components.values()) {
    for (const root of component.renderRoots) {
      if (root.kind === 'Element') {
        visitElement(root, component);
      } else {
        visitConditionalRegion(root, component);
      }
    }
    for (const content of component.contents.values()) {
      if (content.declaration.value.kind !== 'ConditionalValueExpression') {
        continue;
      }
      for (const branch of content.declaration.value.branches) {
        const element = conditionalResultElement(branch.result);
        if (element) {
          visitElement(element, component);
        }
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
      if (invocation.deferredValueProps) {
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
  for (const [name, ref] of component.refs) {
    component.values.set(name, ref);
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

const collectLoweredContextProviders = (
  components: readonly ComponentSymbols[],
  state: AnalysisState,
): ReadonlyMap<ElementNode, LoweredContextProvider> => {
  const providers = new Map<ElementNode, LoweredContextProvider>();

  const visitConditional = (region: ConditionalRegionNode, owner: ComponentSymbols): void => {
    for (const branch of region.branches) {
      const result =
        branch.result.kind === 'ConditionalResultBlock' ? branch.result.result : branch.result;
      if (result.kind === 'Element') {
        visitElement(result, owner);
      }
    }
  };

  const visitElement = (element: ElementNode, owner: ComponentSymbols): void => {
    const context = owner.contexts.get(element.name.name);
    if (context) {
      const attribute = element.attributes.find(
        (candidate): candidate is AttributeNode =>
          candidate.kind === 'Attribute' && candidate.name.name === 'value',
      );
      if (attribute) {
        const value = lowerExpression(
          attribute.value,
          owner.values,
          `context provider <${context.name}>`,
          state,
        );
        if (value) {
          providers.set(element, { context, element, owner, value });
        }
      }
    }
    for (const child of element.children) {
      if (child.kind === 'Element') {
        visitElement(child, owner);
      } else if (child.kind === 'ConditionalRegion') {
        visitConditional(child, owner);
      } else if (child.kind === 'Interpolation' && child.expression.kind === 'MapExpression') {
        visitElement(child.expression.body, owner);
      }
    }
  };

  for (const component of components) {
    for (const root of component.renderRoots) {
      if (root.kind === 'Element') {
        visitElement(root, component);
      } else {
        visitConditional(root, component);
      }
    }
    for (const content of component.contents.values()) {
      const expression = content.declaration.value;
      if (expression.kind !== 'ConditionalValueExpression') {
        continue;
      }
      for (const branch of expression.branches) {
        const element = conditionalResultElement(branch.result);
        if (element) {
          visitElement(element, component);
        }
      }
    }
  }

  const byContext = new Map<string, LoweredContextProvider[]>();
  for (const provider of providers.values()) {
    const current = byContext.get(provider.context.id) ?? [];
    current.push(provider);
    byContext.set(provider.context.id, current);
  }
  for (const component of components) {
    for (const binding of component.bindings.values()) {
      if (binding.classification !== 'context' || !binding.context) {
        continue;
      }
      const candidates = byContext.get(binding.context.id) ?? [];
      binding.expression = candidates[0]?.value;
    }
  }

  const writtenContextIds = new Set<string>();
  for (const component of components) {
    for (const procedure of component.procedures.values()) {
      for (const statement of procedure.declaration.body) {
        if (statement.kind === 'ExpressionStatement') {
          continue;
        }
        const name =
          statement.kind === 'CollectionMutationStatement'
            ? statement.collection.name
            : statement.kind === 'MemberAssignmentStatement'
              ? memberRootAndPath(statement.target)?.root.name
              : statement.target.name;
        const binding = name ? component.bindings.get(name) : undefined;
        if (binding?.classification === 'context' && binding.context) {
          writtenContextIds.add(binding.context.id);
        }
      }
    }
  }
  for (const contextIdValue of writtenContextIds) {
    for (const provider of byContext.get(contextIdValue) ?? []) {
      if (provider.value.kind !== 'read') {
        report(
          state,
          'OXE2007',
          `Writable context ${provider.context.name} must be provided from a direct component value.`,
          provider.value.span,
        );
        continue;
      }
      const providerTargetId = provider.value.targetId;
      const source = [...provider.owner.bindings.values()].find(
        (binding) => binding.id === providerTargetId,
      );
      if (!source || source.classification === 'context') {
        report(
          state,
          'OXE2007',
          `Writable context ${provider.context.name} must be backed by a local component value.`,
          provider.value.span,
        );
      } else {
        source.forcedCell = true;
      }
    }
  }

  return providers;
};

const diagnoseMissingContextProviders = (
  components: readonly ComponentSymbols[],
  invocations: readonly ComponentInvocation[],
  providers: ReadonlyMap<ElementNode, LoweredContextProvider>,
  requestedEntries: readonly ComponentSymbols[] | undefined,
  state: AnalysisState,
): void => {
  const invocationByElement = new Map(
    invocations.map((invocation) => [invocation.element, invocation] as const),
  );
  const invokedIds = new Set(invocations.map((invocation) => invocation.target.componentId));
  const entries =
    requestedEntries ?? components.filter((component) => !invokedIds.has(component.componentId));

  const visitConditional = (
    region: ConditionalRegionNode,
    active: ReadonlySet<string>,
    stack: ReadonlySet<string>,
  ): void => {
    for (const branch of region.branches) {
      const result =
        branch.result.kind === 'ConditionalResultBlock' ? branch.result.result : branch.result;
      if (result.kind === 'Element') {
        visitElement(result, active, stack);
      }
    }
  };

  const visitElement = (
    element: ElementNode,
    active: ReadonlySet<string>,
    stack: ReadonlySet<string>,
  ): void => {
    const provider = providers.get(element);
    const descendants = provider ? new Set([...active, provider.context.id]) : active;
    const invocation = invocationByElement.get(element);
    if (invocation) {
      visitComponent(invocation.target, active, stack);
    }
    for (const child of element.children) {
      if (child.kind === 'Element') {
        visitElement(child, descendants, stack);
      } else if (child.kind === 'ConditionalRegion') {
        visitConditional(child, descendants, stack);
      } else if (child.kind === 'Interpolation' && child.expression.kind === 'MapExpression') {
        visitElement(child.expression.body, descendants, stack);
      }
    }
  };

  const visitComponent = (
    component: ComponentSymbols,
    active: ReadonlySet<string>,
    stack: ReadonlySet<string>,
  ): void => {
    if (stack.has(component.componentId)) {
      return;
    }
    for (const binding of component.bindings.values()) {
      if (
        binding.classification === 'context' &&
        binding.context &&
        !active.has(binding.context.id)
      ) {
        report(
          state,
          'OXE2008',
          `No provider exists for ${binding.context.name}. Wrap this component in <${binding.context.name} value={...}>.`,
          binding.declaration.value.span,
        );
      }
    }
    const nextStack = new Set([...stack, component.componentId]);
    for (const root of component.renderRoots) {
      if (root.kind === 'Element') {
        visitElement(root, active, nextStack);
      } else {
        visitConditional(root, active, nextStack);
      }
    }
  };

  for (const entry of entries) {
    visitComponent(entry, new Set(), new Set());
  }
};

interface RenderContext {
  readonly component: ComponentSymbols;
  readonly constantValues: ReadonlyMap<string, LiteralValue>;
  readonly edges: UiEdgeV1[];
  readonly invocations: ReadonlyMap<ElementNode, ComponentInvocation>;
  readonly contextProviders: ReadonlyMap<ElementNode, LoweredContextProvider>;
  readonly nodes: UiNodeV1[];
  readonly props: ReadonlyMap<ComponentInvocation, ReadonlyMap<AttributeNode, LoweredValueProp>>;
  readonly scopeName: string;
  readonly state: AnalysisState;
  readonly values: ReadonlyMap<string, ValueSymbol>;
  readonly valuesById: ReadonlyMap<string, ValueSymbol>;
  readonly collectionKeys: ReadonlySet<AttributeNode>;
}

const lowerContentValue = (content: ContentInfo, context: RenderContext): void => {
  const choice = content.declaration.value;
  if (choice.kind !== 'ConditionalValueExpression') {
    return;
  }

  const branches: ContentValueNodeV1['branches'][number][] = [];
  const conditions: ValueExpressionV1[] = [];
  const contentNode: ContentValueNodeV1 = {
    branches,
    id: content.id,
    kind: 'content-value',
    name: content.declaration.target.name,
    span: graphSpan(content.declaration.span),
  };
  context.nodes.push(contentNode);

  choice.branches.forEach((branch, index) => {
    const condition = branch.condition
      ? lowerExpression(
          branch.condition,
          context.values,
          `${context.scopeName} content condition`,
          context.state,
        )
      : undefined;
    if (condition) {
      conditions.push(condition);
      const type = inferStandaloneExpression(condition, context.valuesById, context.state);
      if (type !== 'boolean' && type !== 'unknown') {
        report(
          context.state,
          'OXE2009',
          `A content choice condition must be Boolean, but received ${type}.`,
          branch.condition?.span ?? branch.span,
        );
      }
    }

    const result = conditionalResultElement(branch.result);
    if (!result) {
      report(
        context.state,
        'OXE2009',
        'Every branch of a content choice must produce markup.',
        branch.result.span,
      );
      return;
    }

    const values = callableValues(context.component);
    const effectIds: string[] = [];
    if (branch.result.kind === 'ConditionalResultBlock') {
      for (const [statementIndex, statement] of branch.result.statements.entries()) {
        if (statement.kind === 'AssignmentStatement') {
          const expression = lowerExpression(
            statement.value,
            values,
            `${context.scopeName} content branch`,
            context.state,
          );
          if (expression) {
            values.set(statement.target.name, {
              id: `${content.id}/branch[${index}]/local/${identifierSegment(statement.target.name)}`,
              substitution: expression,
              type: inferStandaloneExpression(expression, context.valuesById, context.state),
            });
          }
          continue;
        }
        const expression = lowerExpression(
          statement.expression,
          values,
          `${context.scopeName} content branch effect`,
          context.state,
        );
        if (expression?.kind !== 'call') {
          report(
            context.state,
            'OXE2008',
            'A content branch expression statement must be an ordinary call.',
            statement.span,
          );
          continue;
        }
        const effectId = `${content.id}/branch[${index}]/effect[${statementIndex}]`;
        context.nodes.push({
          expression,
          id: effectId,
          kind: 'effect',
          ownerId: content.id,
          span: graphSpan(statement.span),
        });
        addReadEdges(context.edges, effectId, [expression], 'reactive');
        effectIds.push(effectId);
      }
    }

    const viewKind = /^[A-Z]/u.test(result.name.name) ? 'instance' : 'element';
    const resultId = `${content.id}/branch[${index}]/${viewKind}`;
    branches.push({
      ...(condition ? { condition } : {}),
      effectIds,
      resultId,
      span: graphSpan(branch.span),
    });
    lowerView(result, resultId, content.id, index, { ...context, values });
  });
  addReadEdges(context.edges, content.id, conditions, 'reactive');
};

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
        inferStandaloneExpression(expression, context.valuesById, context.state);
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
  let contentReferenceIndex = 0;
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

    if (child.kind === 'ConditionalRegion') {
      flushText();
      lowerConditionalRegion(
        child,
        `${parentId}/conditional[${conditionalIndex}]`,
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
    const content =
      child.kind === 'Interpolation' && child.expression.kind === 'Identifier'
        ? context.component.contents.get(child.expression.name)
        : undefined;
    if (content) {
      flushText();
      const node: ContentReferenceNodeV1 = {
        contentId: content.id,
        id: `${parentId}/content-reference[${contentReferenceIndex}]`,
        kind: 'content-reference',
        span: graphSpan(child.span),
      };
      context.nodes.push(node);
      context.edges.push({ kind: 'child', from: parentId, to: node.id, index: semanticChildIndex });
      contentReferenceIndex += 1;
      semanticChildIndex += 1;
      continue;
    }
    textGroup.push(child);
  }
  flushText();
};

const lowerConditionalRegion = (
  region: ConditionalRegionNode,
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
      `${context.scopeName} conditional condition`,
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
    const result =
      branch.result.kind === 'ConditionalResultBlock' ? branch.result.result : branch.result;
    if (result.kind !== 'Element') {
      return;
    }
    const values = callableValues(context.component);
    const effectIds: string[] = [];
    if (branch.result.kind === 'ConditionalResultBlock') {
      for (const [statementIndex, statement] of branch.result.statements.entries()) {
        if (statement.kind === 'ExpressionStatement') {
          const expression = lowerExpression(
            statement.expression,
            values,
            `${context.scopeName} conditional branch effect`,
            context.state,
          );
          if (expression?.kind !== 'call') {
            report(
              context.state,
              'OXE2008',
              'A conditional branch expression statement must be an ordinary call.',
              statement.span,
            );
            continue;
          }
          const effectId = `${id}/branch[${index}]/effect[${statementIndex}]`;
          context.nodes.push({
            expression,
            id: effectId,
            kind: 'effect',
            ownerId: id,
            span: graphSpan(statement.span),
          });
          addReadEdges(context.edges, effectId, [expression], 'reactive');
          effectIds.push(effectId);
          continue;
        }
        const expression = lowerExpression(
          statement.value,
          values,
          `${context.scopeName} conditional branch`,
          context.state,
        );
        if (expression) {
          values.set(statement.target.name, {
            id: `${id}/branch[${index}]/local/${identifierSegment(statement.target.name)}`,
            substitution: expression,
            type: inferStandaloneExpression(expression, context.valuesById, context.state),
          });
        }
      }
    }
    if (effectIds.length > 0 && branches[index]) {
      branches[index] = { ...branches[index], effectIds };
    }
    const nestedContext: RenderContext = { ...context, values };
    const viewKind = /^[A-Z]/u.test(result.name.name) ? 'instance' : 'element';
    lowerView(result, `${id}/branch[${index}]/${viewKind}`, id, index, nestedContext);
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
  const inferredItemType = inferArrayItemTypeWithoutDiagnostics(source, context.valuesById);
  const itemType = inferredItemType ?? 'unknown';
  if (!inferredItemType) {
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
  const itemRecord = inferArrayItemRecordWithoutDiagnostics(source, context.valuesById);
  const itemSymbol: ValueSymbol = {
    id: item.id,
    ...(itemRecord ? { expression: itemRecord } : {}),
    type: item.type,
  };
  const values = new Map(context.values);
  values.set(map.parameter.name, itemSymbol);
  const valuesById = new Map(context.valuesById);
  valuesById.set(item.id, itemSymbol);
  for (const assignment of map.assignments) {
    const expression = lowerExpression(
      assignment.value,
      values,
      `${context.scopeName} map callback`,
      context.state,
    );
    if (!expression) {
      continue;
    }
    values.set(assignment.target.name, {
      id: `${id}/local/${identifierSegment(assignment.target.name)}`,
      substitution: expression,
      type: inferStandaloneExpression(expression, valuesById, context.state),
    });
  }

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
  if (keyType === 'array' || keyType === 'record') {
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
    if (attribute.name.name === 'ref') {
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
    inferStandaloneExpression(expression, context.valuesById, context.state);
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
  for (const attribute of element.attributes) {
    if (
      attribute.kind !== 'Attribute' ||
      attribute.name.name !== 'ref' ||
      attribute.value.kind !== 'Identifier'
    ) {
      continue;
    }
    const ref = context.component.refs.get(attribute.value.name);
    if (ref?.attribute === attribute) {
      context.nodes.push({
        elementId: id,
        id: ref.id,
        kind: 'ref',
        name: ref.declaration.name,
        span: graphSpan(attribute.span),
      });
    }
  }
  context.edges.push({ kind: 'child', from: parentId, to: id, index: childIndex });
  addReadEdges(
    context.edges,
    id,
    dynamicAttributes.map((attribute) => attribute.value),
    'reactive',
  );
  lowerMarkupChildren(element.children, id, context);
};

const lowerContextProvider = (
  element: ElementNode,
  id: string,
  parentId: string,
  childIndex: number,
  context: RenderContext,
): void => {
  const provider = context.contextProviders.get(element);
  if (!provider) {
    return;
  }
  context.nodes.push({
    contextId: provider.context.id,
    id,
    kind: 'context-provider',
    span: graphSpan(element.span),
    value: provider.value,
  });
  context.edges.push({ kind: 'child', from: parentId, to: id, index: childIndex });
  addReadEdges(context.edges, id, [provider.value], 'reactive');
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
      const prelowered = valueProps?.get(attribute);
      const value =
        prelowered?.value ??
        (invocation.deferredValueProps
          ? lowerExpression(
              attribute.value,
              context.values,
              `prop "${parameter.declaration.name}" passed to <${invocation.target.component.name.name}> inside ${context.scopeName}`,
              context.state,
            )
          : undefined);
      const prop = value
        ? ({ attribute, invocation, parameter, value } satisfies LoweredValueProp)
        : undefined;
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
  if (context.contextProviders.has(element)) {
    lowerContextProvider(element, id, parentId, childIndex, context);
  } else if (/^[A-Z]/u.test(element.name.name)) {
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
      const result: ConstantValueV1[] = [];
      for (const element of expression.elements) {
        const value = evaluateResolvedConstant(element, values);
        if (value === undefined) {
          return undefined;
        }
        result.push(value);
      }
      return result;
    }
    case 'literal':
      return expression.value;
    case 'call':
    case 'capability-read':
    case 'collection':
    case 'local-read':
      return undefined;
    case 'member': {
      const object = evaluateResolvedConstant(expression.object, values);
      if (!isConstantRecord(object)) {
        return undefined;
      }
      return object[expression.property];
    }
    case 'record': {
      const result: Record<string, ConstantValueV1> = {};
      for (const entry of expression.entries) {
        const value = evaluateResolvedConstant(entry.value, values);
        if (value === undefined) {
          return undefined;
        }
        result[entry.name] = value;
      }
      return result;
    }
    case 'read':
      return values.get(expression.targetId);
    case 'conditional':
      for (const branch of expression.branches) {
        if (!branch.condition) {
          return evaluateResolvedConstant(branch.result, values);
        }
        const condition = evaluateResolvedConstant(branch.condition, values);
        if (condition === true) {
          return evaluateResolvedConstant(branch.result, values);
        }
        if (condition !== false) {
          return undefined;
        }
      }
      return undefined;
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
  contextProviders: ReadonlyMap<ElementNode, LoweredContextProvider>,
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
      if (statement.kind === 'ExpressionStatement') {
        continue;
      }
      const targetName =
        statement.kind === 'CollectionMutationStatement'
          ? statement.collection.name
          : statement.kind === 'MemberAssignmentStatement'
            ? memberRootAndPath(statement.target)?.root.name
            : statement.target.name;
      const target = targetName ? symbols.bindings.get(targetName) : undefined;
      if (!target) {
        report(
          state,
          'OXE2008',
          `Procedure write "${targetName ?? '<unknown>'}" must target a component value.`,
          statement.span,
        );
      } else if (
        target.classification === 'async-resource' ||
        target.classification === 'resource'
      ) {
        report(
          state,
          'OXE2008',
          `Resource "${targetName}" is owned by the compiler and cannot be assigned procedurally.`,
          statement.span,
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

    if (binding.classification === 'async-resource' && binding.expression.kind === 'call') {
      nodes.push({
        expression: binding.expression,
        id: binding.id,
        kind: 'async-resource',
        name: binding.declaration.target.name,
        span: graphSpan(binding.declaration.span),
        type: binding.type,
      });
      addReadEdges(edges, binding.id, [binding.expression], 'reactive');
    } else if (binding.classification === 'resource' && binding.expression.kind === 'call') {
      nodes.push({
        expression: binding.expression,
        id: binding.id,
        kind: 'resource',
        name: binding.declaration.target.name,
        span: graphSpan(binding.declaration.span),
      });
      addReadEdges(edges, binding.id, [binding.expression], 'reactive');
    } else if (binding.classification === 'context' && binding.context) {
      nodes.push({
        contextId: binding.context.id,
        id: binding.id,
        kind: 'context-consumer',
        name: binding.declaration.target.name,
        span: graphSpan(binding.declaration.span),
        type: binding.type,
        writable: writtenIds.has(binding.id),
      });
    } else if (binding.classification === 'cell') {
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
    const steps: ProcedureStepV1[] = [];
    const procedureValues = callableValues(symbols);
    for (const parameter of procedure.declaration.parameters) {
      procedureValues.set(parameter.name, {
        id: parameter.name,
        substitution: {
          kind: 'local-read',
          span: graphSpan(parameter.span),
          targetId: parameter.name,
          type: 'unknown',
        },
        type: 'unknown',
      });
    }
    for (const statement of procedure.declaration.body) {
      if (statement.kind === 'ExpressionStatement') {
        if (
          statement.expression.kind === 'CallExpression' &&
          statement.expression.callee.kind === 'Identifier' &&
          statement.expression.callee.name === 'refresh'
        ) {
          const argument = statement.expression.arguments[0];
          const target =
            argument?.kind === 'Identifier' ? symbols.bindings.get(argument.name) : undefined;
          if (statement.expression.arguments.length !== 1 || !argument) {
            report(state, 'OXE2009', 'refresh() expects exactly one async value.', statement.span);
          } else if (!target || target.classification !== 'async-resource') {
            report(
              state,
              'OXE2008',
              'refresh() must receive the name of a compiler-owned async value.',
              argument.span,
            );
          } else {
            steps.push({
              kind: 'refresh',
              span: graphSpan(statement.span),
              targetId: target.id,
            });
          }
          continue;
        }
        const expression = lowerExpression(
          statement.expression,
          procedureValues,
          `procedure "${procedure.declaration.name.name}"`,
          state,
        );
        if (expression?.kind !== 'call') {
          report(
            state,
            'OXE2008',
            'A procedural expression statement must be an ordinary call.',
            statement.span,
          );
          continue;
        }
        steps.push({ expression, kind: 'call', span: graphSpan(statement.span) });
        continue;
      }

      if (statement.kind === 'CollectionMutationStatement') {
        const target = symbols.bindings.get(statement.collection.name);
        if (!target) {
          continue;
        }
        if (target.type !== 'array' && target.type !== 'unknown') {
          report(
            state,
            'OXE2009',
            `${statement.operation} requires an array cell, but "${statement.collection.name}" is ${target.type}.`,
            statement.collection.span,
          );
          continue;
        }
        const source: ValueExpressionV1 = {
          kind: 'read',
          span: graphSpan(statement.collection.span),
          targetId: target.id,
        };
        const value = statement.value
          ? lowerExpression(
              statement.value,
              procedureValues,
              `procedure "${procedure.declaration.name.name}"`,
              state,
            )
          : undefined;
        const predicate = lowerMutationPredicate(
          statement,
          source,
          procedureValues,
          `procedure "${procedure.declaration.name.name}"`,
          state,
        );
        const updater = lowerMutationUpdater(
          statement,
          source,
          procedureValues,
          `procedure "${procedure.declaration.name.name}"`,
          state,
        );
        const limit = statement.limit
          ? lowerExpression(
              statement.limit,
              procedureValues,
              `procedure "${procedure.declaration.name.name}"`,
              state,
            )
          : undefined;
        if (
          (statement.value && !value) ||
          (statement.predicate && !predicate) ||
          (statement.updater && !updater) ||
          (statement.limit && !limit)
        ) {
          continue;
        }

        const itemType = target.itemType ?? 'unknown';
        if (value) {
          const valueType = inferStandaloneExpression(value, valuesById, state);
          if (itemType !== 'unknown' && valueType !== 'unknown' && itemType !== valueType) {
            report(
              state,
              'OXE2009',
              `Cannot add ${valueType} to a collection of ${itemType} values.`,
              statement.value?.span ?? statement.span,
            );
          }
          const expectedRecord = target.expression
            ? inferArrayItemRecordWithoutDiagnostics(target.expression, valuesById)
            : undefined;
          const addedRecord = resolveRecordExpression(value, valuesById);
          if (
            expectedRecord &&
            addedRecord &&
            recordSchemaKey(expectedRecord, valuesById) !== recordSchemaKey(addedRecord, valuesById)
          ) {
            report(
              state,
              'OXE2009',
              'The added record must have the same fields and field types as the collection items.',
              statement.value?.span ?? statement.span,
            );
          }
        }
        if (predicate) {
          const predicateType = inferStandaloneExpression(predicate.result, valuesById, state);
          if (predicateType !== 'boolean' && predicateType !== 'unknown') {
            report(
              state,
              'OXE2009',
              `${statement.operation} predicates must produce Boolean, but received ${predicateType}.`,
              statement.predicate?.span ?? statement.span,
            );
          }
        }
        if (updater) {
          const updateType = inferStandaloneExpression(updater.result, valuesById, state);
          if (itemType !== 'unknown' && updateType !== 'unknown' && itemType !== updateType) {
            report(
              state,
              'OXE2009',
              `update callbacks must preserve the ${itemType} collection item type, but received ${updateType}.`,
              statement.updater?.span ?? statement.span,
            );
          }
        }
        if (limit) {
          const limitType = inferStandaloneExpression(limit, valuesById, state);
          if (limitType !== 'number' && limitType !== 'unknown') {
            report(
              state,
              'OXE2009',
              `A collection mutation limit must be a number, but received ${limitType}.`,
              statement.limit?.span ?? statement.span,
            );
          }
          const resolvedLimit = evaluateResolvedConstant(limit, constantValues);
          if (
            typeof resolvedLimit === 'number' &&
            (!Number.isInteger(resolvedLimit) || resolvedLimit < 0)
          ) {
            report(
              state,
              'OXE2009',
              'A collection mutation limit must be a nonnegative integer.',
              statement.limit?.span ?? statement.span,
            );
          }
        }
        steps.push({
          kind: 'collection-mutation',
          ...(limit ? { limit } : {}),
          operation: statement.operation,
          ...(predicate ? { predicate } : {}),
          span: graphSpan(statement.span),
          targetId: target.id,
          ...(updater ? { updater } : {}),
          ...(value ? { value } : {}),
        });
        continue;
      }

      if (statement.kind === 'MemberAssignmentStatement') {
        const member = memberRootAndPath(statement.target);
        const target = member ? symbols.bindings.get(member.root.name) : undefined;
        const value = lowerExpression(
          statement.value,
          procedureValues,
          `procedure "${procedure.declaration.name.name}"`,
          state,
        );
        if (!member || !target || !value) {
          continue;
        }
        const schema = target.expression
          ? resolveRecordExpression(target.expression, valuesById)
          : undefined;
        if (!schema) {
          report(
            state,
            'OXE2009',
            'A field assignment requires a value with a known record shape.',
            statement.target.span,
          );
          continue;
        }
        const current: ValueExpressionV1 = {
          kind: 'read',
          span: graphSpan(member.root.span),
          targetId: target.id,
        };
        const next = replaceRecordMember(
          schema,
          current,
          member.path,
          value,
          valuesById,
          state,
          statement.span,
        );
        if (!next) {
          continue;
        }
        steps.push({
          kind: 'write',
          path: member.path,
          span: graphSpan(statement.span),
          targetId: target.id,
          value,
        });
        continue;
      }

      const target = symbols.bindings.get(statement.target.name);
      const value = lowerExpression(
        statement.value,
        procedureValues,
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
      parameters: procedure.declaration.parameters.map((parameter) => ({
        name: parameter.name,
        span: graphSpan(parameter.span),
        type: 'unknown',
      })),
      steps,
      span: graphSpan(procedure.declaration.span),
    };
    nodes.push(procedureNode);
    addReadEdges(edges, procedure.id, steps.flatMap(procedureStepExpressions), 'procedural');
    addWriteEdges(edges, procedureNode);
  }

  const effectValues = callableValues(symbols);
  const declarativeWriters = new Map<string, SourceSpan>();
  for (const [index, effect] of symbols.effects.entries()) {
    const expression = lowerExpression(
      effect.expression,
      effectValues,
      `component "${component.name.name}" effect`,
      state,
    );
    if (expression?.kind !== 'call') {
      report(
        state,
        'OXE2008',
        'A top-level expression statement must be an ordinary call.',
        effect.span,
      );
      continue;
    }
    const platform = [...state.platformCapabilities.values()].find(
      (candidate) =>
        expression.callee.kind === 'capability-read' && candidate.id === expression.callee.targetId,
    );
    if (platform?.contract.kind === 'pure' || platform?.contract.kind === 'async') {
      report(
        state,
        'OXE2008',
        `${platform.contract.kind === 'async' ? 'Async' : 'Pure'} capability "${platform.contract.name}" returns a value and cannot be used as a top-level effect.`,
        effect.span,
      );
      continue;
    }
    if (platform?.contract.writes) {
      const previous = declarativeWriters.get(platform.contract.writes);
      if (previous) {
        report(
          state,
          'OXE2007',
          `Multiple persistent relationships write "${platform.contract.writes}". Combine them into one relationship.`,
          effect.span,
          [{ message: 'The first persistent writer is here.', span: previous }],
        );
        continue;
      }
      declarativeWriters.set(platform.contract.writes, effect.span);
    }
    if (platform?.contract.kind === 'resource') {
      nodes.push({
        expression,
        id: `${symbols.componentId}/resource[${index}]`,
        kind: 'resource',
        name: platform.contract.name,
        span: graphSpan(effect.span),
      });
      addReadEdges(edges, `${symbols.componentId}/resource[${index}]`, [expression], 'reactive');
      continue;
    }
    const node: EffectNodeV1 = {
      expression,
      id: `${symbols.componentId}/effect[${index}]`,
      kind: 'effect',
      ownerId: symbols.componentId,
      span: graphSpan(effect.span),
    };
    nodes.push(node);
    addReadEdges(edges, node.id, [expression], 'reactive');
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
    contextProviders,
    nodes,
    props,
    scopeName: `component "${component.name.name}" markup`,
    state,
    valuesById,
    values: symbols.values,
    collectionKeys: new Set(),
  };
  for (const content of symbols.contents.values()) {
    lowerContentValue(content, renderContext);
  }
  symbols.renderRoots.forEach((element, index) => {
    if (element.kind === 'ConditionalRegion') {
      lowerConditionalRegion(
        element,
        `${symbols.componentId}/view/conditional[${index}]`,
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
    case 'call':
      inferStandaloneExpression(expression.callee, valuesById, state);
      for (const argument of expression.arguments) {
        inferStandaloneExpression(argument, valuesById, state);
      }
      return expression.returnType ?? 'unknown';
    case 'capability-read':
      return 'unknown';
    case 'local-read':
      return expression.type;
    case 'collection': {
      const sourceType = inferStandaloneExpression(expression.source, valuesById, state);
      if (sourceType !== 'array' && sourceType !== 'unknown') {
        report(
          state,
          'OXE2009',
          `${expression.operation} requires an array source, but received ${sourceType}.`,
          expression.source.span,
        );
      }
      const resultType = inferStandaloneExpression(expression.callback.result, valuesById, state);
      if (
        expression.operation === 'filter' &&
        resultType !== 'boolean' &&
        resultType !== 'unknown'
      ) {
        report(
          state,
          'OXE2009',
          `filter callbacks must produce Boolean, but received ${resultType}.`,
          expression.callback.result.span,
        );
      }
      if (
        expression.operation === 'flatMap' &&
        resultType !== 'array' &&
        resultType !== 'unknown'
      ) {
        report(
          state,
          'OXE2009',
          `flatMap callbacks must produce arrays, but received ${resultType}.`,
          expression.callback.result.span,
        );
      }
      if (expression.operation === 'sort') {
        if (
          resultType !== 'boolean' &&
          resultType !== 'number' &&
          resultType !== 'string' &&
          resultType !== 'unknown'
        ) {
          report(
            state,
            'OXE2009',
            `sort callbacks must produce a scalar key, but received ${resultType}.`,
            expression.callback.result.span,
          );
        }
        if (expression.options) {
          const optionsType = inferStandaloneExpression(expression.options, valuesById, state);
          if (optionsType !== 'record' && optionsType !== 'unknown') {
            report(
              state,
              'OXE2009',
              `sort options must be a record, but received ${optionsType}.`,
              expression.options.span,
            );
          }
          const optionsRecord = resolveRecordExpression(expression.options, valuesById);
          if (optionsRecord) {
            for (const entry of optionsRecord.entries) {
              if (entry.name !== 'descending') {
                report(
                  state,
                  'OXE2009',
                  `Unknown sort option "${entry.name}". The supported option is descending.`,
                  entry.span,
                );
              } else {
                const type = inferStandaloneExpression(entry.value, valuesById, state);
                if (type !== 'boolean' && type !== 'unknown') {
                  report(
                    state,
                    'OXE2009',
                    `sort option descending must be Boolean, but received ${type}.`,
                    entry.value.span,
                  );
                }
              }
            }
          }
        }
      }
      if (expression.operation === 'reduce') {
        const initialType = expression.initial
          ? inferStandaloneExpression(expression.initial, valuesById, state)
          : 'unknown';
        if (initialType !== 'unknown' && resultType !== 'unknown' && initialType !== resultType) {
          report(
            state,
            'OXE2009',
            `reduce callback results must match the ${initialType} initial value, but received ${resultType}.`,
            expression.callback.result.span,
          );
        }
        return initialType === 'unknown' ? resultType : initialType;
      }
      return 'array';
    }
    case 'literal':
      return typeof expression.value as 'boolean' | 'number' | 'string';
    case 'read':
      return valuesById.get(expression.targetId)?.type ?? 'unknown';
    case 'member': {
      const record = resolveRecordExpression(expression.object, valuesById);
      if (record) {
        const entry = record.entries.find((item) => item.name === expression.property);
        if (!entry) {
          report(
            state,
            'OXE2002',
            `Record has no field "${expression.property}".`,
            expression.span,
          );
          return 'unknown';
        }
        return inferStandaloneExpression(entry.value, valuesById, state);
      }
      const objectType = inferStandaloneExpression(expression.object, valuesById, state);
      return expression.property === 'length' && (objectType === 'array' || objectType === 'string')
        ? 'number'
        : 'unknown';
    }
    case 'record':
      for (const entry of expression.entries) {
        inferStandaloneExpression(entry.value, valuesById, state);
      }
      return 'record';
    case 'conditional': {
      let resultType: PrimitiveTypeV1 = 'unknown';
      for (const branch of expression.branches) {
        if (branch.condition) {
          const conditionType = inferStandaloneExpression(branch.condition, valuesById, state);
          if (conditionType !== 'boolean' && conditionType !== 'unknown') {
            report(
              state,
              'OXE2009',
              `A conditional value condition must be Boolean, but received ${conditionType}.`,
              branch.condition.span,
            );
          }
        }
        const current = inferStandaloneExpression(branch.result, valuesById, state);
        if (current === 'unknown') {
          continue;
        }
        if (resultType !== 'unknown' && resultType !== current) {
          report(
            state,
            'OXE2009',
            `Conditional value branches must share one type, but received ${resultType} and ${current}.`,
            branch.result.span,
          );
          return 'unknown';
        }
        resultType = current;
      }
      return resultType;
    }
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
  readonly contexts: ReadonlyMap<string, ContextInfo>;
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
  const contexts = new Map<string, ContextInfo>();

  for (const declaration of ast.contexts) {
    const previous = contexts.get(declaration.name.name);
    if (previous) {
      report(state, 'OXE2001', `Duplicate context "${declaration.name.name}".`, declaration.span, [
        { message: 'The first context is here.', span: previous.declaration.span },
      ]);
      continue;
    }
    contexts.set(declaration.name.name, {
      declaration,
      id: contextId(moduleId, declaration.name.name),
      name: declaration.name.name,
    });
  }

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
    components.set(
      component.name.name,
      registerComponentSymbols(component, moduleId, contexts, state),
    );
  }

  return { ast, components, contexts, moduleId };
};

const analyzeComponentSet = (
  modules: readonly SemanticModule[],
  graphModuleId: string,
  componentScopes: ReadonlyMap<string, ReadonlyMap<string, ComponentSymbols>>,
  requestedEntries: readonly ComponentSymbols[] | undefined,
  routeSegment: 'layout' | 'page' | undefined,
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

  for (const module of modules) {
    for (const context of module.contexts.values()) {
      nodes.push({
        id: context.id,
        kind: 'context',
        name: context.name,
        span: graphSpan(context.declaration.span),
      });
    }
  }

  for (const component of components.values()) {
    scanDirectParameterUses(component, state);
  }
  if (requestedEntries) {
    for (const entry of requestedEntries) {
      const unsupportedParameters = [...entry.parameters.values()].filter(
        (parameter) => routeSegment !== 'layout' || parameter.parameterKind !== 'children',
      );
      if (unsupportedParameters.length > 0) {
        report(
          state,
          'OXE2017',
          routeSegment === 'layout'
            ? `Route layout "${entry.component.name.name}" may consume only children.`
            : `Entry component "${entry.component.name.name}" must not declare or consume props.`,
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
      if (binding.classification === 'context') {
        continue;
      }
      binding.expression = lowerExpression(
        binding.declaration.value,
        component.values,
        `component "${component.component.name.name}"`,
        state,
      );
      if (
        binding.expression?.kind === 'call' &&
        binding.expression.callee.kind === 'capability-read'
      ) {
        const capabilityTargetId = binding.expression.callee.targetId;
        const platform = [...state.platformCapabilities.values()].find(
          (candidate) => candidate.id === capabilityTargetId,
        );
        if (platform?.contract.kind === 'async') {
          binding.classification = 'async-resource';
          if (platform.contract.returns === 'array') {
            // Async contracts describe the collection boundary without requiring an
            // application-wide schema for every row. Mark its item shape as opaque.
            binding.itemType = 'unknown';
          }
        } else if (platform?.contract.kind === 'resource') {
          binding.classification = 'resource';
        } else if (platform?.contract.kind === 'effect') {
          report(
            state,
            'OXE2008',
            `Effect capability "${platform.contract.name}" cannot be captured as a value. Call it as a top-level relationship or inside a procedure.`,
            binding.declaration.value.span,
          );
        } else if (platform && !platform.contract.returns) {
          report(
            state,
            'OXE2008',
            `Pure capability "${platform.contract.name}" must declare a return type before its result can be captured.`,
            binding.declaration.value.span,
          );
        }
      }
    }
  }
  const contextProviders = collectLoweredContextProviders(componentList, state);
  diagnoseMissingContextProviders(
    componentList,
    invocations,
    contextProviders,
    requestedEntries,
    state,
  );
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
      contextProviders,
      loweredProps.byInvocation,
      valuesById,
      state,
    );
  }
  for (const platform of state.platformCapabilities.values()) {
    if (!platform.used) {
      continue;
    }
    nodes.push({
      capabilityKind: platform.contract.kind,
      ...(platform.contract.dispose ? { dispose: platform.contract.dispose } : {}),
      id: platform.id,
      kind: 'platform-capability',
      parameters: platform.contract.parameters,
      path: platform.path,
      ...(platform.routeIntrinsic ? { routeIntrinsic: platform.routeIntrinsic } : {}),
      ...(platform.contract.returns ? { returns: platform.contract.returns } : {}),
      span: graphSpan(platform.span ?? modules[0]?.ast.span ?? componentList[0]!.component.span),
      target: platform.contract.target ?? 'universal',
      ...(platform.contract.writes ? { writes: platform.contract.writes } : {}),
    });
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
  options?: AnalyzeOptions,
): AnalyzeResult => {
  const parsed = parseSource(source, fileName);
  if (parsed.diagnostics.length > 0) {
    return { ast: parsed.ast, diagnostics: parsed.diagnostics };
  }

  const moduleId = normalizeProjectModuleId(requestedModuleId);
  const state = createAnalysisState(options, moduleId, parsed.ast.span);
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
  const analyzed = analyzeComponentSet([module], moduleId, scopes, undefined, undefined, state);
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
  let state = createAnalysisState(
    undefined,
    options.entryModuleId,
    projectPointSpan(options.entryModuleId),
  );
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
  state = createAnalysisState(options, entryModuleId, projectPointSpan(entryModuleId));

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

  const analyzed = analyzeComponentSet(
    semanticModules,
    entryModuleId,
    scopes,
    [entry],
    options.routeSegment,
    state,
  );
  return {
    entryModuleId,
    modules: projectModules,
    diagnostics: analyzed.diagnostics,
    ...(analyzed.graph ? { graph: analyzed.graph } : {}),
  };
};
