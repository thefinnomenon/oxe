import type {
  ApplicationContextV1,
  ApplicationCapabilityV1,
  ApplicationComponentExtensionV1,
  ApplicationDefinitionV1,
  ApplicationEntityV1,
  ApplicationExtensionModuleV1,
  ApplicationFeatureV1,
  ApplicationFieldV1,
  ApplicationGraphV1,
  ApplicationInvariantV1,
  ApplicationOperationV1,
  ApplicationPolicyPredicateV1,
  ApplicationPolicyV1,
  ApplicationQueryV1,
  ApplicationRelationV1,
  ApplicationRouteV1,
  ApplicationSemanticIdV1,
  ApplicationStyleV1,
  ApplicationUniqueConstraintV1,
  ApplicationVerificationFlowV1,
  ApplicationViewV1,
  ApplicationViewElementV1,
} from './application-types.js';
import {
  validateApplicationGraph,
  type ApplicationGraphDiagnostic,
} from './application-validate.js';

export type ApplicationMutationReferenceV1 = ApplicationSemanticIdV1 | `$${string}`;

export type ApplicationMutableSemanticNodeV1 =
  | ApplicationCapabilityV1
  | ApplicationComponentExtensionV1
  | ApplicationContextV1
  | ApplicationEntityV1
  | ApplicationExtensionModuleV1
  | ApplicationFeatureV1
  | ApplicationFieldV1
  | ApplicationInvariantV1
  | ApplicationOperationV1
  | ApplicationPolicyV1
  | ApplicationQueryV1
  | ApplicationRelationV1
  | ApplicationRouteV1
  | ApplicationStyleV1
  | ApplicationUniqueConstraintV1
  | ApplicationVerificationFlowV1
  | ApplicationViewV1;

export type ApplicationMutationOperationV1 =
  | {
      readonly as?: string;
      readonly default?: string;
      readonly entity: ApplicationMutationReferenceV1;
      readonly name: string;
      readonly op: 'field.add';
      readonly type: { readonly enum: readonly string[] };
    }
  | {
      readonly field: ApplicationMutationReferenceV1;
      readonly form: ApplicationMutationReferenceV1;
      readonly op: 'form.field.add';
    }
  | {
      readonly field: ApplicationMutationReferenceV1;
      readonly list: ApplicationMutationReferenceV1;
      readonly op: 'list.display.add';
    }
  | {
      readonly node: ApplicationMutableSemanticNodeV1;
      readonly op: 'semantic.add';
    }
  | {
      readonly node: ApplicationMutableSemanticNodeV1;
      readonly op: 'semantic.replace';
    }
  | {
      readonly app: ApplicationDefinitionV1;
      readonly op: 'app.replace';
    }
  | { readonly node: ApplicationMutationReferenceV1; readonly op: 'semantic.remove' }
  | {
      readonly name: string;
      readonly node: ApplicationMutationReferenceV1;
      readonly op: 'symbol.rename';
    }
  | {
      readonly action: 'create' | 'delete' | 'read' | 'update';
      readonly op: 'policy.rule.set';
      readonly policy: ApplicationMutationReferenceV1;
      readonly predicate: ApplicationPolicyPredicateV1;
    }
  | {
      readonly element: ApplicationMutationReferenceV1;
      readonly index: number;
      readonly op: 'ui.move';
      readonly parent: ApplicationMutationReferenceV1;
    };

export interface ApplicationMutationBatchV1 {
  readonly base: number;
  readonly ops: readonly ApplicationMutationOperationV1[];
}

export type ApplicationSemanticChangeV1 =
  | {
      readonly default?: string;
      readonly entityId: ApplicationSemanticIdV1;
      readonly entityName: string;
      readonly fieldId: ApplicationSemanticIdV1;
      readonly fieldName: string;
      readonly kind: 'field.added';
      readonly valueType: ApplicationFieldV1['valueType'];
    }
  | {
      readonly fieldId: ApplicationSemanticIdV1;
      readonly fieldName: string;
      readonly formId: ApplicationSemanticIdV1;
      readonly kind: 'form.field.added';
      readonly viewId: ApplicationSemanticIdV1;
      readonly viewName: string;
    }
  | {
      readonly fieldId: ApplicationSemanticIdV1;
      readonly fieldName: string;
      readonly kind: 'list.display.added';
      readonly listId: ApplicationSemanticIdV1;
      readonly viewId: ApplicationSemanticIdV1;
      readonly viewName: string;
    }
  | {
      readonly kind: 'semantic.added' | 'semantic.replaced';
      readonly nodeId: ApplicationSemanticIdV1;
      readonly nodeKind: ApplicationMutableSemanticNodeV1['kind'];
    }
  | {
      readonly appId: ApplicationSemanticIdV1;
      readonly kind: 'app.replaced';
    }
  | {
      readonly kind: 'semantic.removed';
      readonly nodeId: ApplicationSemanticIdV1;
      readonly nodeKind: ApplicationMutableSemanticNodeV1['kind'];
    }
  | {
      readonly from: string;
      readonly kind: 'symbol.renamed';
      readonly nodeId: ApplicationSemanticIdV1;
      readonly nodeKind: ApplicationMutableSemanticNodeV1['kind'];
      readonly to: string;
    }
  | {
      readonly action: 'create' | 'delete' | 'read' | 'update';
      readonly kind: 'policy.rule.set';
      readonly policyId: ApplicationSemanticIdV1;
    }
  | {
      readonly elementId: ApplicationSemanticIdV1;
      readonly index: number;
      readonly kind: 'ui.moved';
      readonly parentId: ApplicationSemanticIdV1;
      readonly viewId: ApplicationSemanticIdV1;
    };

export type ApplicationMutationDiagnosticCode = 'OXE3201' | 'OXE3202' | 'OXE3203' | 'OXE3204';

export interface ApplicationMutationDiagnostic {
  readonly code: ApplicationMutationDiagnosticCode;
  readonly message: string;
  readonly opIndex?: number;
  readonly path: string;
}

export type ApplicationMutationResultV1 =
  | {
      readonly baseRevision: number;
      readonly changes: readonly ApplicationSemanticChangeV1[];
      readonly graph: ApplicationGraphV1;
      readonly ok: true;
      readonly revision: number;
      readonly summary: string;
    }
  | {
      readonly diagnostics: readonly ApplicationMutationDiagnostic[];
      /** Present when the current or proposed canonical graph failed graph validation. */
      readonly graphDiagnostics?: readonly ApplicationGraphDiagnostic[];
      /** The original graph is returned unchanged on every failure. */
      readonly graph: ApplicationGraphV1;
      readonly ok: false;
      readonly revision: number;
    };

interface ElementLocation {
  readonly element: ApplicationViewElementV1;
  readonly path: string;
  readonly viewId: string;
  readonly viewIndex: number;
  readonly viewName: string;
}

const findElement = (graph: ApplicationGraphV1, id: string): ElementLocation | undefined => {
  const visit = (
    element: ApplicationViewElementV1,
    path: string,
    viewIndex: number,
  ): ElementLocation | undefined => {
    const view = graph.views[viewIndex];
    if (!view) return undefined;
    if (element.id === id)
      return {
        element,
        path,
        viewId: view.id,
        viewIndex,
        viewName: view.name,
      };
    if (element.kind === 'repeat') return visit(element.template, `${path}.template`, viewIndex);
    for (const [index, child] of (element.children ?? []).entries()) {
      const result = visit(child, `${path}.children[${index}]`, viewIndex);
      if (result) return result;
    }
    return undefined;
  };
  for (const [viewIndex, view] of graph.views.entries()) {
    const result = visit(view.tree, `$.views[${viewIndex}].tree`, viewIndex);
    if (result) return result;
  }
  return undefined;
};

const updateElement = (
  element: ApplicationViewElementV1,
  id: string,
  update: (element: ApplicationViewElementV1) => ApplicationViewElementV1,
): ApplicationViewElementV1 => {
  if (element.id === id) return update(element);
  if (element.kind === 'repeat') {
    const template = updateElement(element.template, id, update);
    return template === element.template ? element : { ...element, template };
  }
  if (!element.children) return element;
  const children = element.children.map((child) => updateElement(child, id, update));
  return children.every((child, index) => child === element.children?.[index])
    ? element
    : { ...element, children };
};

const updateViewElement = (
  graph: ApplicationGraphV1,
  location: ElementLocation,
  update: (element: ApplicationViewElementV1) => ApplicationViewElementV1,
): ApplicationGraphV1 => ({
  ...graph,
  views: graph.views.map((view, index) =>
    index === location.viewIndex
      ? { ...view, tree: updateElement(view.tree, location.element.id ?? '', update) }
      : view,
  ),
});

const elementIds = (element: ApplicationViewElementV1, ids = new Set<string>()): Set<string> => {
  if (element.id) ids.add(element.id);
  if (element.kind === 'repeat') elementIds(element.template, ids);
  else element.children?.forEach((child) => elementIds(child, ids));
  return ids;
};

const detachElement = (
  element: ApplicationViewElementV1,
  id: string,
): { readonly element: ApplicationViewElementV1; readonly removed?: ApplicationViewElementV1 } => {
  if (element.kind === 'repeat') {
    const result = detachElement(element.template, id);
    return result.removed
      ? { element: { ...element, template: result.element }, removed: result.removed }
      : { element };
  }
  const children = element.children ?? [];
  const directIndex = children.findIndex((child) => child.id === id);
  if (directIndex >= 0) {
    const removed = children[directIndex];
    if (!removed) return { element };
    return {
      element: { ...element, children: children.filter((_, index) => index !== directIndex) },
      removed,
    };
  }
  for (const [index, child] of children.entries()) {
    const result = detachElement(child, id);
    if (!result.removed) continue;
    return {
      element: {
        ...element,
        children: children.map((candidate, childIndex) =>
          childIndex === index ? result.element : candidate,
        ),
      },
      removed: result.removed,
    };
  }
  return { element };
};

const fieldIdFor = (entityId: string, fieldName: string): string => {
  const entityStem = entityId.startsWith('entity.') ? entityId.slice('entity.'.length) : entityId;
  return `field.${entityStem}.${fieldName}`;
};

const enumText = (values: readonly string[]): string => `enum(${values.join(',')})`;

export const formatApplicationMutationSummary = (
  revision: number,
  changes: readonly ApplicationSemanticChangeV1[],
): string => {
  const lines = [`r${revision} committed`, ''];
  for (const change of changes) {
    if (change.kind === 'field.added') {
      const defaultValue = change.valueType.kind === 'enum' ? change.valueType.values : [];
      lines.push(
        `+ ${change.entityName}.${change.fieldName}: ${change.valueType.kind === 'enum' ? enumText(defaultValue) : change.valueType.kind}${change.default === undefined ? '' : `=${change.default}`}`,
      );
    } else if (change.kind === 'form.field.added') {
      lines.push(`~ ${change.viewName}.${change.formId} added ${change.fieldName}`);
    } else if (change.kind === 'list.display.added') {
      lines.push(`~ ${change.viewName}.${change.listId} displays ${change.fieldName}`);
    } else if (change.kind === 'app.replaced') {
      lines.push(`~ ${change.appId} application definition`);
    } else if (change.kind === 'symbol.renamed') {
      lines.push(`~ ${change.nodeKind} ${change.nodeId} renamed ${change.from} -> ${change.to}`);
    } else if (change.kind === 'semantic.removed') {
      lines.push(`- ${change.nodeKind} ${change.nodeId}`);
    } else if (change.kind === 'policy.rule.set') {
      lines.push(`~ policy ${change.policyId} ${change.action}`);
    } else if (change.kind === 'ui.moved') {
      lines.push(`~ ${change.elementId} moved to ${change.parentId}[${change.index}]`);
    } else {
      lines.push(
        `${change.kind === 'semantic.added' ? '+' : '~'} ${change.nodeKind} ${change.nodeId}`,
      );
    }
  }
  lines.push('', 'checked graph types');
  return `${lines.join('\n')}\n`;
};

const failure = (
  graph: ApplicationGraphV1,
  code: ApplicationMutationDiagnosticCode,
  path: string,
  message: string,
  opIndex?: number,
  graphDiagnostics?: readonly ApplicationGraphDiagnostic[],
): ApplicationMutationResultV1 => ({
  diagnostics: [{ code, message, path, ...(opIndex === undefined ? {} : { opIndex }) }],
  ...(graphDiagnostics ? { graphDiagnostics } : {}),
  graph,
  ok: false,
  revision: graph.revision,
});

const mutationRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const mutableNode = (
  graph: ApplicationGraphV1,
  id: string,
): ApplicationMutableSemanticNodeV1 | undefined =>
  [
    ...(graph.capabilities ?? []),
    ...(graph.components ?? []),
    ...(graph.contexts ?? []),
    ...graph.entities,
    ...graph.features,
    ...graph.fields,
    ...(graph.modules ?? []),
    ...graph.operations,
    ...graph.policies,
    ...graph.queries,
    ...graph.relations,
    ...graph.routes,
    ...(graph.styles ?? []),
    ...(graph.uniques ?? []),
    ...graph.verification.flows,
    ...graph.verification.invariants,
    ...graph.views,
  ].find((node) => node.id === id);

const writeMutableNode = (
  graph: ApplicationGraphV1,
  node: ApplicationMutableSemanticNodeV1,
  replace: boolean,
): ApplicationGraphV1 => {
  const write = <Node extends ApplicationMutableSemanticNodeV1>(
    nodes: readonly Node[],
    value: Node,
  ): readonly Node[] =>
    replace
      ? nodes.map((candidate) => (candidate.id === value.id ? value : candidate))
      : [...nodes, value];
  switch (node.kind) {
    case 'capability':
      return { ...graph, capabilities: write(graph.capabilities ?? [], node) };
    case 'componentExtension':
      return { ...graph, components: write(graph.components ?? [], node) };
    case 'context':
      return { ...graph, contexts: write(graph.contexts ?? [], node) };
    case 'entity':
      return { ...graph, entities: write(graph.entities, node) };
    case 'feature':
      return { ...graph, features: write(graph.features, node) };
    case 'field':
      return { ...graph, fields: write(graph.fields, node) };
    case 'extensionModule':
      return { ...graph, modules: write(graph.modules ?? [], node) };
    case 'operation':
      return { ...graph, operations: write(graph.operations, node) };
    case 'policy':
      return { ...graph, policies: write(graph.policies, node) };
    case 'query':
      return { ...graph, queries: write(graph.queries, node) };
    case 'relation':
      return { ...graph, relations: write(graph.relations, node) };
    case 'route':
      return { ...graph, routes: write(graph.routes, node) };
    case 'style':
      return { ...graph, styles: write(graph.styles ?? [], node) };
    case 'unique':
      return { ...graph, uniques: write(graph.uniques ?? [], node) };
    case 'verificationFlow':
      return {
        ...graph,
        verification: { ...graph.verification, flows: write(graph.verification.flows, node) },
      };
    case 'invariant':
      return {
        ...graph,
        verification: {
          ...graph.verification,
          invariants: write(graph.verification.invariants, node),
        },
      };
    case 'view':
      return { ...graph, views: write(graph.views, node) };
  }
};

const removeMutableNode = (
  graph: ApplicationGraphV1,
  node: ApplicationMutableSemanticNodeV1,
): ApplicationGraphV1 => {
  const remove = <Node extends ApplicationMutableSemanticNodeV1>(
    nodes: readonly Node[],
  ): readonly Node[] => nodes.filter((candidate) => candidate.id !== node.id);
  switch (node.kind) {
    case 'capability':
      return { ...graph, capabilities: remove(graph.capabilities ?? []) };
    case 'componentExtension':
      return { ...graph, components: remove(graph.components ?? []) };
    case 'context':
      return { ...graph, contexts: remove(graph.contexts ?? []) };
    case 'entity':
      return { ...graph, entities: remove(graph.entities) };
    case 'feature':
      return { ...graph, features: remove(graph.features) };
    case 'field':
      return { ...graph, fields: remove(graph.fields) };
    case 'extensionModule':
      return { ...graph, modules: remove(graph.modules ?? []) };
    case 'operation':
      return { ...graph, operations: remove(graph.operations) };
    case 'policy':
      return { ...graph, policies: remove(graph.policies) };
    case 'query':
      return { ...graph, queries: remove(graph.queries) };
    case 'relation':
      return { ...graph, relations: remove(graph.relations) };
    case 'route':
      return { ...graph, routes: remove(graph.routes) };
    case 'style':
      return { ...graph, styles: remove(graph.styles ?? []) };
    case 'unique':
      return { ...graph, uniques: remove(graph.uniques ?? []) };
    case 'verificationFlow':
      return {
        ...graph,
        verification: { ...graph.verification, flows: remove(graph.verification.flows) },
      };
    case 'invariant':
      return {
        ...graph,
        verification: {
          ...graph.verification,
          invariants: remove(graph.verification.invariants),
        },
      };
    case 'view':
      return { ...graph, views: remove(graph.views) };
  }
};

/** Validates the agent-facing JSON boundary before any draft graph is created. */
export const validateApplicationMutationBatch = (
  value: unknown,
): ApplicationMutationDiagnostic[] => {
  const diagnostics: ApplicationMutationDiagnostic[] = [];
  const add = (path: string, message: string, opIndex?: number): void => {
    diagnostics.push({
      code: 'OXE3203',
      message,
      ...(opIndex === undefined ? {} : { opIndex }),
      path,
    });
  };
  const root = mutationRecord(value);
  if (!root) {
    add('$', 'A mutation batch must be an object.');
    return diagnostics;
  }
  for (const key of Object.keys(root).sort())
    if (key !== 'base' && key !== 'ops')
      add(`$.${key}`, `Unknown mutation batch property "${key}".`);
  if (typeof root.base !== 'number' || !Number.isInteger(root.base) || root.base < 0)
    add('$.base', 'Mutation base must be a nonnegative integer revision.');
  if (!Array.isArray(root.ops)) {
    add('$.ops', 'Mutation ops must be an array.');
    return diagnostics;
  }
  if (root.ops.length === 0) add('$.ops', 'A mutation batch must contain at least one operation.');
  root.ops.forEach((value, opIndex) => {
    const path = `$.ops[${opIndex}]`;
    const operation = mutationRecord(value);
    if (!operation) {
      add(path, 'A mutation operation must be an object.', opIndex);
      return;
    }
    const op = operation.op;
    const allowed =
      op === 'field.add'
        ? new Set(['as', 'default', 'entity', 'name', 'op', 'type'])
        : op === 'form.field.add'
          ? new Set(['field', 'form', 'op'])
          : op === 'list.display.add'
            ? new Set(['field', 'list', 'op'])
            : op === 'semantic.add' || op === 'semantic.replace'
              ? new Set(['node', 'op'])
              : op === 'semantic.remove'
                ? new Set(['node', 'op'])
                : op === 'symbol.rename'
                  ? new Set(['name', 'node', 'op'])
                  : op === 'policy.rule.set'
                    ? new Set(['action', 'op', 'policy', 'predicate'])
                    : op === 'ui.move'
                      ? new Set(['element', 'index', 'op', 'parent'])
                      : op === 'app.replace'
                        ? new Set(['app', 'op'])
                        : undefined;
    if (!allowed) {
      add(`${path}.op`, 'Unknown semantic mutation operation.', opIndex);
      return;
    }
    for (const key of Object.keys(operation).sort())
      if (!allowed.has(key)) add(`${path}.${key}`, `Unknown ${op} property "${key}".`, opIndex);
    if (op === 'semantic.add' || op === 'semantic.replace') {
      const node = mutationRecord(operation.node);
      if (!node) add(`${path}.node`, `${op} node must be an object.`, opIndex);
      else {
        if (typeof node.id !== 'string' || node.id.length === 0)
          add(`${path}.node.id`, 'Semantic node id must be a non-empty string.', opIndex);
        if (
          typeof node.kind !== 'string' ||
          ![
            'capability',
            'componentExtension',
            'context',
            'entity',
            'feature',
            'field',
            'extensionModule',
            'invariant',
            'operation',
            'policy',
            'query',
            'relation',
            'route',
            'style',
            'unique',
            'verificationFlow',
            'view',
          ].includes(node.kind)
        )
          add(`${path}.node.kind`, 'Unknown mutable semantic node kind.', opIndex);
      }
    } else if (op === 'semantic.remove' || op === 'symbol.rename') {
      if (typeof operation.node !== 'string' || operation.node.length === 0)
        add(`${path}.node`, `${op} node must be a non-empty semantic ID.`, opIndex);
      if (
        op === 'symbol.rename' &&
        (typeof operation.name !== 'string' || operation.name.length === 0)
      )
        add(`${path}.name`, 'symbol.rename name must be a non-empty string.', opIndex);
    } else if (op === 'policy.rule.set') {
      if (typeof operation.policy !== 'string' || operation.policy.length === 0)
        add(`${path}.policy`, 'policy.rule.set policy must be a non-empty semantic ID.', opIndex);
      if (!['create', 'delete', 'read', 'update'].includes(String(operation.action)))
        add(`${path}.action`, 'Unknown policy action.', opIndex);
      const predicate = mutationRecord(operation.predicate);
      if (!predicate) add(`${path}.predicate`, 'Policy predicate must be an object.', opIndex);
      else if (
        !['authenticated', 'relationEqualsActor', 'relationEqualsContext'].includes(
          String(predicate.kind),
        )
      )
        add(`${path}.predicate.kind`, 'Unknown policy predicate kind.', opIndex);
    } else if (op === 'ui.move') {
      for (const key of ['element', 'parent'] as const)
        if (typeof operation[key] !== 'string' || operation[key].length === 0)
          add(`${path}.${key}`, `${key} must be a non-empty semantic ID.`, opIndex);
      if (
        typeof operation.index !== 'number' ||
        !Number.isInteger(operation.index) ||
        operation.index < 0
      )
        add(`${path}.index`, 'ui.move index must be a nonnegative integer.', opIndex);
    } else if (op === 'app.replace') {
      const app = mutationRecord(operation.app);
      if (!app) add(`${path}.app`, 'app.replace app must be an object.', opIndex);
      else {
        if (app.kind !== 'app') add(`${path}.app.kind`, 'Application kind must be "app".', opIndex);
        if (typeof app.id !== 'string' || app.id.length === 0)
          add(`${path}.app.id`, 'Application id must be a non-empty string.', opIndex);
      }
    } else if (op === 'field.add') {
      for (const key of ['entity', 'name'] as const)
        if (typeof operation[key] !== 'string' || operation[key].length === 0)
          add(`${path}.${key}`, `${key} must be a non-empty string.`, opIndex);
      if (operation.as !== undefined && typeof operation.as !== 'string')
        add(`${path}.as`, 'as must be a string.', opIndex);
      if (operation.default !== undefined && typeof operation.default !== 'string')
        add(`${path}.default`, 'default must be a string.', opIndex);
      const type = mutationRecord(operation.type);
      if (!type) {
        add(`${path}.type`, 'field.add type must be an enum descriptor.', opIndex);
      } else {
        for (const key of Object.keys(type).sort())
          if (key !== 'enum')
            add(`${path}.type.${key}`, `Unknown field type property "${key}".`, opIndex);
        if (!Array.isArray(type.enum)) {
          add(`${path}.type.enum`, 'Enum values must be an array.', opIndex);
        } else {
          type.enum.forEach((item, index) => {
            if (typeof item !== 'string')
              add(`${path}.type.enum[${index}]`, 'Enum values must be strings.', opIndex);
          });
        }
      }
    } else {
      const target = op === 'form.field.add' ? 'form' : 'list';
      for (const key of ['field', target])
        if (typeof operation[key] !== 'string' || operation[key].length === 0)
          add(`${path}.${key}`, `${key} must be a non-empty string.`, opIndex);
    }
  });
  return diagnostics;
};

/** Applies one batch to a private immutable draft and publishes it only after full validation. */
export const mutateApplicationGraph = (
  graph: ApplicationGraphV1,
  batch: ApplicationMutationBatchV1,
): ApplicationMutationResultV1 => {
  const currentDiagnostics = validateApplicationGraph(graph);
  if (currentDiagnostics.length > 0)
    return failure(
      graph,
      'OXE3204',
      '$',
      'The current application graph is invalid and cannot be mutated.',
      undefined,
      currentDiagnostics,
    );
  const batchDiagnostics = validateApplicationMutationBatch(batch);
  if (batchDiagnostics.length > 0)
    return {
      diagnostics: batchDiagnostics,
      graph,
      ok: false,
      revision: graph.revision,
    };
  if (batch.base !== graph.revision)
    return failure(
      graph,
      'OXE3201',
      '$.base',
      `Mutation base r${batch.base} does not match current revision r${graph.revision}.`,
    );
  let draft = graph;
  const aliases = new Map<string, string>();
  const changes: ApplicationSemanticChangeV1[] = [];
  const resolve = (
    reference: ApplicationMutationReferenceV1,
    opIndex: number,
    property: string,
  ): string | ApplicationMutationResultV1 => {
    if (!reference.startsWith('$')) return reference;
    const alias = reference.slice(1);
    const resolved = aliases.get(alias);
    return (
      resolved ??
      failure(
        graph,
        'OXE3202',
        `$.ops[${opIndex}].${property}`,
        `Batch alias "${reference}" has not been created by an earlier operation.`,
        opIndex,
      )
    );
  };

  for (const [opIndex, operation] of batch.ops.entries()) {
    if (operation.op === 'app.replace') {
      if (operation.app.id !== graph.app.id)
        return failure(
          graph,
          'OXE3203',
          `$.ops[${opIndex}].app.id`,
          `Application identity must remain "${graph.app.id}".`,
          opIndex,
        );
      draft = { ...draft, app: structuredClone(operation.app) };
      changes.push({ appId: operation.app.id, kind: 'app.replaced' });
      continue;
    }

    if (operation.op === 'semantic.add' || operation.op === 'semantic.replace') {
      const existing = mutableNode(draft, operation.node.id);
      const replacing = operation.op === 'semantic.replace';
      if (!replacing && existing)
        return failure(
          graph,
          'OXE3203',
          `$.ops[${opIndex}].node.id`,
          `Semantic node "${operation.node.id}" already exists as ${existing.kind}.`,
          opIndex,
        );
      if (replacing && !existing)
        return failure(
          graph,
          'OXE3202',
          `$.ops[${opIndex}].node.id`,
          `Semantic node "${operation.node.id}" does not exist.`,
          opIndex,
        );
      if (replacing && existing?.kind !== operation.node.kind)
        return failure(
          graph,
          'OXE3203',
          `$.ops[${opIndex}].node.kind`,
          `Semantic node "${operation.node.id}" is ${existing?.kind}, not ${operation.node.kind}.`,
          opIndex,
        );
      const node = structuredClone(operation.node);
      draft = writeMutableNode(draft, node, replacing);
      changes.push({
        kind: replacing ? 'semantic.replaced' : 'semantic.added',
        nodeId: node.id,
        nodeKind: node.kind,
      });
      continue;
    }

    if (operation.op === 'semantic.remove') {
      const nodeReference = resolve(operation.node, opIndex, 'node');
      if (typeof nodeReference !== 'string') return nodeReference;
      const existing = mutableNode(draft, nodeReference);
      if (!existing)
        return failure(
          graph,
          'OXE3202',
          `$.ops[${opIndex}].node`,
          `Semantic node "${nodeReference}" does not exist.`,
          opIndex,
        );
      draft = removeMutableNode(draft, existing);
      changes.push({ kind: 'semantic.removed', nodeId: existing.id, nodeKind: existing.kind });
      continue;
    }

    if (operation.op === 'symbol.rename') {
      const nodeReference = resolve(operation.node, opIndex, 'node');
      if (typeof nodeReference !== 'string') return nodeReference;
      const existing = mutableNode(draft, nodeReference);
      if (!existing)
        return failure(
          graph,
          'OXE3202',
          `$.ops[${opIndex}].node`,
          `Semantic node "${nodeReference}" does not exist.`,
          opIndex,
        );
      if (!('name' in existing) || typeof existing.name !== 'string')
        return failure(
          graph,
          'OXE3203',
          `$.ops[${opIndex}].node`,
          `Semantic node "${nodeReference}" has no renameable symbol.`,
          opIndex,
        );
      if (!/^[A-Za-z][A-Za-z0-9 ]*$/u.test(operation.name))
        return failure(
          graph,
          'OXE3203',
          `$.ops[${opIndex}].name`,
          'Symbol names must start with a letter and contain letters, digits, or spaces.',
          opIndex,
        );
      const renamed = { ...existing, name: operation.name } as ApplicationMutableSemanticNodeV1;
      draft = writeMutableNode(draft, renamed, true);
      changes.push({
        from: existing.name,
        kind: 'symbol.renamed',
        nodeId: existing.id,
        nodeKind: existing.kind,
        to: operation.name,
      });
      continue;
    }

    if (operation.op === 'policy.rule.set') {
      const policyReference = resolve(operation.policy, opIndex, 'policy');
      if (typeof policyReference !== 'string') return policyReference;
      const policy = draft.policies.find((candidate) => candidate.id === policyReference);
      if (!policy)
        return failure(
          graph,
          'OXE3202',
          `$.ops[${opIndex}].policy`,
          `Policy "${policyReference}" does not exist.`,
          opIndex,
        );
      draft = {
        ...draft,
        policies: draft.policies.map((candidate) =>
          candidate.id === policy.id
            ? {
                ...candidate,
                rules: {
                  ...candidate.rules,
                  [operation.action]: structuredClone(operation.predicate),
                },
              }
            : candidate,
        ),
      };
      changes.push({ action: operation.action, kind: 'policy.rule.set', policyId: policy.id });
      continue;
    }

    if (operation.op === 'ui.move') {
      const elementReference = resolve(operation.element, opIndex, 'element');
      if (typeof elementReference !== 'string') return elementReference;
      const parentReference = resolve(operation.parent, opIndex, 'parent');
      if (typeof parentReference !== 'string') return parentReference;
      const source = findElement(draft, elementReference);
      const parent = findElement(draft, parentReference);
      if (!source)
        return failure(
          graph,
          'OXE3202',
          `$.ops[${opIndex}].element`,
          `UI element "${elementReference}" does not exist.`,
          opIndex,
        );
      if (!parent || parent.element.kind !== 'component')
        return failure(
          graph,
          'OXE3202',
          `$.ops[${opIndex}].parent`,
          `UI component parent "${parentReference}" does not exist.`,
          opIndex,
        );
      if (source.viewIndex !== parent.viewIndex)
        return failure(
          graph,
          'OXE3203',
          `$.ops[${opIndex}].parent`,
          'UI elements can only move within one view.',
          opIndex,
        );
      if (elementIds(source.element).has(parentReference))
        return failure(
          graph,
          'OXE3203',
          `$.ops[${opIndex}].parent`,
          'A UI element cannot move into itself or one of its descendants.',
          opIndex,
        );
      const view = draft.views[source.viewIndex];
      if (!view || view.tree.id === elementReference)
        return failure(
          graph,
          'OXE3203',
          `$.ops[${opIndex}].element`,
          'A view root cannot be moved.',
          opIndex,
        );
      const detached = detachElement(view.tree, elementReference);
      if (!detached.removed)
        return failure(
          graph,
          'OXE3203',
          `$.ops[${opIndex}].element`,
          'Repeat templates cannot be detached from their owning collection.',
          opIndex,
        );
      const movedElement = detached.removed;
      const detachedParent = findElement(
        {
          ...draft,
          views: draft.views.map((candidate, index) =>
            index === source.viewIndex ? { ...candidate, tree: detached.element } : candidate,
          ),
        },
        parentReference,
      );
      if (!detachedParent || detachedParent.element.kind !== 'component')
        return failure(
          graph,
          'OXE3203',
          `$.ops[${opIndex}].parent`,
          'UI move parent became unavailable.',
          opIndex,
        );
      const childCount = detachedParent.element.children?.length ?? 0;
      if (operation.index > childCount)
        return failure(
          graph,
          'OXE3203',
          `$.ops[${opIndex}].index`,
          `UI move index ${operation.index} exceeds parent child count ${childCount}.`,
          opIndex,
        );
      const tree = updateElement(detached.element, parentReference, (element) => {
        if (element.kind !== 'component') return element;
        const children = [...(element.children ?? [])];
        children.splice(operation.index, 0, movedElement);
        return { ...element, children };
      });
      draft = {
        ...draft,
        views: draft.views.map((candidate, index) =>
          index === source.viewIndex ? { ...candidate, tree } : candidate,
        ),
      };
      changes.push({
        elementId: elementReference,
        index: operation.index,
        kind: 'ui.moved',
        parentId: parentReference,
        viewId: view.id,
      });
      continue;
    }

    if (operation.op === 'field.add') {
      const entityReference = resolve(operation.entity, opIndex, 'entity');
      if (typeof entityReference !== 'string') return entityReference;
      const entity = draft.entities.find((candidate) => candidate.id === entityReference);
      if (!entity)
        return failure(
          graph,
          'OXE3202',
          `$.ops[${opIndex}].entity`,
          `Entity "${entityReference}" does not exist.`,
          opIndex,
        );
      if (entity.origin === 'builtin')
        return failure(
          graph,
          'OXE3203',
          `$.ops[${opIndex}].entity`,
          `Built-in entity "${entity.id}" cannot receive application fields.`,
          opIndex,
        );
      if (!/^[a-z][A-Za-z0-9]*$/u.test(operation.name))
        return failure(
          graph,
          'OXE3203',
          `$.ops[${opIndex}].name`,
          'Field names must be lower-camel identifiers.',
          opIndex,
        );
      if (
        operation.type.enum.length === 0 ||
        new Set(operation.type.enum).size !== operation.type.enum.length
      )
        return failure(
          graph,
          'OXE3203',
          `$.ops[${opIndex}].type.enum`,
          'Enum values must be a non-empty unique list.',
          opIndex,
        );
      if (operation.type.enum.some((value) => value.length === 0))
        return failure(
          graph,
          'OXE3203',
          `$.ops[${opIndex}].type.enum`,
          'Enum values must be non-empty strings.',
          opIndex,
        );
      if (operation.default !== undefined && !operation.type.enum.includes(operation.default))
        return failure(
          graph,
          'OXE3203',
          `$.ops[${opIndex}].default`,
          `Default "${operation.default}" is not one of the declared enum values.`,
          opIndex,
        );
      const fieldId = fieldIdFor(entity.id, operation.name);
      if (
        draft.fields.some(
          (field) =>
            field.id === fieldId || (field.entity === entity.id && field.name === operation.name),
        )
      )
        return failure(
          graph,
          'OXE3203',
          `$.ops[${opIndex}].name`,
          `Field "${entity.name}.${operation.name}" already exists.`,
          opIndex,
        );
      if (operation.as !== undefined) {
        if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(operation.as))
          return failure(
            graph,
            'OXE3203',
            `$.ops[${opIndex}].as`,
            'Batch aliases must be identifiers without a leading dollar sign.',
            opIndex,
          );
        if (aliases.has(operation.as))
          return failure(
            graph,
            'OXE3203',
            `$.ops[${opIndex}].as`,
            `Batch alias "${operation.as}" is already defined.`,
            opIndex,
          );
      }
      const field: ApplicationFieldV1 = {
        ...(operation.default === undefined
          ? {}
          : { default: { kind: 'literal' as const, value: operation.default } }),
        entity: entity.id,
        id: fieldId,
        kind: 'field',
        name: operation.name,
        required: true,
        valueType: { kind: 'enum', values: [...operation.type.enum] },
      };
      draft = {
        ...draft,
        entities: draft.entities.map((candidate) =>
          candidate.id === entity.id
            ? { ...candidate, fields: [...(candidate.fields ?? []), field.id] }
            : candidate,
        ),
        fields: [...draft.fields, field],
      };
      if (operation.as) aliases.set(operation.as, field.id);
      changes.push({
        ...(operation.default === undefined ? {} : { default: operation.default }),
        entityId: entity.id,
        entityName: entity.name,
        fieldId: field.id,
        fieldName: field.name,
        kind: 'field.added',
        valueType: field.valueType,
      });
      continue;
    }

    const fieldReference = resolve(operation.field, opIndex, 'field');
    if (typeof fieldReference !== 'string') return fieldReference;
    const field = draft.fields.find((candidate) => candidate.id === fieldReference);
    if (!field)
      return failure(
        graph,
        'OXE3202',
        `$.ops[${opIndex}].field`,
        `Field "${fieldReference}" does not exist.`,
        opIndex,
      );

    if (operation.op === 'form.field.add') {
      const formReference = resolve(operation.form, opIndex, 'form');
      if (typeof formReference !== 'string') return formReference;
      const location = findElement(draft, formReference);
      if (
        !location ||
        location.element.kind !== 'component' ||
        location.element.component !== 'ui.Form'
      )
        return failure(
          graph,
          'OXE3202',
          `$.ops[${opIndex}].form`,
          `Form "${formReference}" does not exist.`,
          opIndex,
        );
      const form = location.element;
      if (!form.submit)
        return failure(
          graph,
          'OXE3203',
          `$.ops[${opIndex}].form`,
          `Form "${formReference}" has no submit operation.`,
          opIndex,
        );
      const submitOperation = draft.operations.find(
        (candidate) => candidate.id === form.submit?.operation,
      );
      if (
        !submitOperation ||
        submitOperation.body.kind !== 'createEntity' ||
        submitOperation.body.entity !== field.entity
      )
        return failure(
          graph,
          'OXE3203',
          `$.ops[${opIndex}].field`,
          `Field "${field.id}" is incompatible with form "${formReference}".`,
          opIndex,
        );
      if ((form.fields ?? []).includes(field.id) || submitOperation.input.fields[field.name])
        return failure(
          graph,
          'OXE3203',
          `$.ops[${opIndex}].field`,
          `Form "${formReference}" already includes field "${field.id}".`,
          opIndex,
        );
      draft = updateViewElement(draft, location, (element) => {
        if (element.kind !== 'component' || !element.submit) return element;
        return {
          ...element,
          fields: [...(element.fields ?? []), field.id],
          submit: {
            ...element.submit,
            arguments: {
              ...element.submit.arguments,
              [field.name]: {
                kind: 'formValue',
                name: field.name,
                ...(field.valueType.kind === 'number' ? { valueType: 'number' as const } : {}),
              },
            },
          },
        };
      });
      draft = {
        ...draft,
        operations: draft.operations.map((candidate) =>
          candidate.id === submitOperation.id && candidate.body.kind === 'createEntity'
            ? {
                ...candidate,
                body: {
                  ...candidate.body,
                  values: {
                    ...candidate.body.values,
                    [field.id]: { kind: 'inputField' as const, name: field.name },
                  },
                },
                input: {
                  ...candidate.input,
                  fields: { ...candidate.input.fields, [field.name]: field.valueType },
                },
              }
            : candidate,
        ),
      };
      changes.push({
        fieldId: field.id,
        fieldName: field.name,
        formId: formReference,
        kind: 'form.field.added',
        viewId: location.viewId,
        viewName: location.viewName,
      });
      continue;
    }

    const listReference = resolve(operation.list, opIndex, 'list');
    if (typeof listReference !== 'string') return listReference;
    const location = findElement(draft, listReference);
    if (!location || location.element.kind !== 'repeat')
      return failure(
        graph,
        'OXE3202',
        `$.ops[${opIndex}].list`,
        `List "${listReference}" does not exist.`,
        opIndex,
      );
    const list = location.element;
    const view = draft.views[location.viewIndex];
    const queryId =
      list.source.kind === 'viewData' ? view?.data[list.source.name]?.query : undefined;
    const query = draft.queries.find((candidate) => candidate.id === queryId);
    if (!query || query.entity !== field.entity)
      return failure(
        graph,
        'OXE3203',
        `$.ops[${opIndex}].field`,
        `Field "${field.id}" is incompatible with list "${listReference}".`,
        opIndex,
      );
    if ((list.display ?? []).includes(field.id))
      return failure(
        graph,
        'OXE3203',
        `$.ops[${opIndex}].field`,
        `List "${listReference}" already displays field "${field.id}".`,
        opIndex,
      );
    draft = updateViewElement(draft, location, (element) => {
      if (element.kind !== 'repeat') return element;
      return { ...element, display: [...(element.display ?? []), field.id] };
    });
    draft = {
      ...draft,
      queries: draft.queries.map((candidate) =>
        candidate.id === query.id && !candidate.select.includes(field.id)
          ? { ...candidate, select: [...candidate.select, field.id] }
          : candidate,
      ),
    };
    changes.push({
      fieldId: field.id,
      fieldName: field.name,
      kind: 'list.display.added',
      listId: listReference,
      viewId: location.viewId,
      viewName: location.viewName,
    });
  }

  const revision = graph.revision + 1;
  const proposed = { ...draft, revision };
  const proposedDiagnostics = validateApplicationGraph(proposed);
  if (proposedDiagnostics.length > 0)
    return failure(
      graph,
      'OXE3204',
      '$.ops',
      'The complete proposed revision failed application graph validation.',
      undefined,
      proposedDiagnostics,
    );
  return {
    baseRevision: graph.revision,
    changes,
    graph: proposed,
    ok: true,
    revision,
    summary: formatApplicationMutationSummary(revision, changes),
  };
};
