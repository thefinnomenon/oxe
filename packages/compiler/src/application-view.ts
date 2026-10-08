import {
  ApplicationGraphValidationError,
  canonicalizeApplicationGraph,
  validateApplicationGraph,
  type ApplicationAuthenticationV1,
  type ApplicationFieldV1,
  type ApplicationGraphV1,
  type ApplicationOperationV1,
  type ApplicationPolicyPredicateV1,
  type ApplicationViewElementV1,
} from '@oxe/graph';

import {
  projectApplicationLoading,
  type ApplicationLoadingProjectionV1,
  type ApplicationSkeletonNodeV1,
} from './application-client.js';

export type ApplicationStandardViewModeNameV1 =
  'empty' | 'error' | 'forbidden' | 'loading' | 'notFound' | 'unauthorized';

export interface ApplicationStandardViewModeV1 {
  readonly ariaBusy: boolean;
  readonly message: string;
  readonly name: ApplicationStandardViewModeNameV1;
  readonly status: number;
  readonly title: string;
}

export interface ApplicationBrowserViewFunctionV1 {
  readonly clientModule: string;
  readonly contexts: readonly string[];
  readonly id: string;
  readonly mode: 'mutation' | 'query';
  readonly name: string;
  readonly outputEntity?: string;
  readonly parameters: readonly string[];
  readonly refreshContexts: boolean;
  readonly semanticId: string;
}

export interface ApplicationBrowserViewProjectionV1 {
  readonly appId: string;
  readonly appName: string;
  readonly authentication?: ApplicationAuthenticationV1;
  readonly contexts: readonly {
    readonly entityId: string;
    readonly id: string;
    readonly labelField?: string;
    readonly name: string;
  }[];
  readonly fields: readonly ApplicationFieldV1[];
  readonly functions: readonly ApplicationBrowserViewFunctionV1[];
  readonly hydrationKey: string;
  readonly loading: ApplicationLoadingProjectionV1;
  readonly modes: Readonly<
    Record<ApplicationStandardViewModeNameV1, ApplicationStandardViewModeV1>
  >;
  readonly revision: number;
  readonly route: { readonly id: string; readonly path: string };
  readonly schemaVersion: 'oxe.application-browser-view.v1';
  readonly view: {
    readonly data: Readonly<Record<string, { readonly query: string }>>;
    readonly id: string;
    readonly name: string;
    readonly tree: ApplicationViewElementV1;
  };
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const renderSkeletonNodeHtml = (node: ApplicationSkeletonNodeV1): string => {
  if (node.kind === 'collection') return renderSkeletonNodeHtml(node.template);
  const component = node.component.replace('ui.', '').toLowerCase();
  const width = node.width ? ` skeleton-width-${node.width}` : '';
  const body =
    node.shape === 'text'
      ? `<span class="skeleton-line${width}"></span>`
      : node.shape === 'control'
        ? `<span class="skeleton-button${width}"></span>`
        : node.shape === 'block'
          ? `<span class="skeleton-block${width}"></span>`
          : node.component === 'ui.CheckboxRow'
            ? '<span class="skeleton-box"></span><span class="skeleton-line skeleton-line-wide"></span>'
            : node.component === 'ui.TextField'
              ? '<span class="skeleton-line"></span>'
              : node.component === 'ui.Button'
                ? '<span class="skeleton-button"></span>'
                : node.children.map(renderSkeletonNodeHtml).join('');
  return `<div class="skeleton-component skeleton-${escapeHtml(component)}" aria-hidden="true">${body}</div>`;
};

/** Renders an inert, structure-preserving shell that the generic browser host can adopt. */
export const renderApplicationBrowserViewLoadingHtml = (
  projection: ApplicationBrowserViewProjectionV1,
): string => {
  const collections = projection.loading.collections
    .flatMap((collection) =>
      Array.from(
        { length: collection.rows },
        () =>
          `<div class="task skeleton-task" data-oxe-loading-collection="${escapeHtml(collection.elementId)}">${renderSkeletonNodeHtml(collection.template)}</div>`,
      ),
    )
    .join('');
  return `<section class="card stack" data-oxe-browser-view="${escapeHtml(projection.hydrationKey)}"><header class="header" data-oxe-shell-header></header><section class="team-controls" data-oxe-context-controls></section><p class="error" role="alert" data-oxe-view-error></p><div aria-busy="true" data-oxe-view-content>${collections}</div></section>`;
};

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const standardModes = (): ApplicationBrowserViewProjectionV1['modes'] => ({
  empty: {
    ariaBusy: false,
    message: 'There is nothing here yet.',
    name: 'empty',
    status: 200,
    title: 'Nothing here yet',
  },
  error: {
    ariaBusy: false,
    message: 'Try again. If the problem continues, check the server logs.',
    name: 'error',
    status: 500,
    title: 'Something went wrong',
  },
  forbidden: {
    ariaBusy: false,
    message: 'Your account does not have access to this content.',
    name: 'forbidden',
    status: 403,
    title: 'Access denied',
  },
  loading: {
    ariaBusy: true,
    message: 'Loading…',
    name: 'loading',
    status: 200,
    title: 'Loading',
  },
  notFound: {
    ariaBusy: false,
    message: 'The requested content could not be found.',
    name: 'notFound',
    status: 404,
    title: 'Not found',
  },
  unauthorized: {
    ariaBusy: false,
    message: 'Sign in to continue.',
    name: 'unauthorized',
    status: 401,
    title: 'Authentication required',
  },
});

const predicateContexts = (
  predicate: ApplicationPolicyPredicateV1 | undefined,
): readonly string[] => (predicate?.kind === 'relationEqualsContext' ? [predicate.context] : []);

const expressionContexts = (value: unknown, contexts: Set<string>): void => {
  if (Array.isArray(value)) {
    value.forEach((item) => expressionContexts(item, contexts));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const record = value as Readonly<Record<string, unknown>>;
  if (record.kind === 'activeContext' && typeof record.context === 'string')
    contexts.add(record.context);
  Object.values(record).forEach((item) => expressionContexts(item, contexts));
};

const operationEntity = (operation: ApplicationOperationV1): string | undefined =>
  operation.body.kind === 'createEntity'
    ? operation.body.entity
    : operation.output.kind === 'entity'
      ? operation.output.entity
      : undefined;

const operationActions = (
  operation: ApplicationOperationV1,
): readonly {
  readonly action: 'create' | 'delete' | 'update';
  readonly entity: string | undefined;
}[] => {
  const action = (kind: 'createEntity' | 'deleteEntity' | 'updateEntity') =>
    kind === 'createEntity' ? 'create' : kind === 'deleteEntity' ? 'delete' : 'update';
  if (operation.body.kind === 'workflow')
    return operation.body.steps.flatMap((step) =>
      step.kind === 'enqueueCapability' ? [] : [{ action: action(step.kind), entity: step.entity }],
    );
  if (operation.body.kind === 'invokeCapability') return [];
  return [{ action: action(operation.body.kind), entity: operationEntity(operation) }];
};

const functionContexts = (graph: ApplicationGraphV1, semanticId: string): readonly string[] => {
  const contexts = new Set<string>();
  const query = graph.queries.find((candidate) => candidate.id === semanticId);
  if (query) {
    predicateContexts(query.filter).forEach((context) => contexts.add(context));
    const policy = graph.policies.find((candidate) => candidate.target === query.entity);
    predicateContexts(policy?.rules.read).forEach((context) => contexts.add(context));
  }
  const operation = graph.operations.find((candidate) => candidate.id === semanticId);
  if (operation) {
    expressionContexts(operation.body, contexts);
    operationActions(operation).forEach(({ action, entity }) => {
      const policy = graph.policies.find((candidate) => candidate.target === entity);
      predicateContexts(policy?.rules[action]).forEach((context) => contexts.add(context));
    });
  }
  return [...contexts].sort(compareText);
};

const clientModuleName = (contexts: readonly string[]): string =>
  contexts.length === 0
    ? 'account-client'
    : `${contexts
        .map((context) => context.replace(/^context\./u, '').replaceAll(/[^A-Za-z0-9]+/gu, '-'))
        .join('-')}-client`;

const operationRefreshesContexts = (
  graph: ApplicationGraphV1,
  operation: ApplicationOperationV1,
): boolean => {
  const contextEntities = new Set((graph.contexts ?? []).map((context) => context.entity));
  const membershipEntities = new Set(
    (graph.contexts ?? []).flatMap((context) => {
      const methods =
        context.authorization.kind === 'anyOf'
          ? context.authorization.anyOf
          : [context.authorization];
      return methods.flatMap((method) =>
        method.kind === 'membership' ? [method.membershipEntity] : [],
      );
    }),
  );
  return operation.effects.some((effect) => {
    const field = graph.fields.find((candidate) => candidate.id === effect.target);
    const entity = graph.entities.find((candidate) => candidate.id === effect.target);
    const entityId = field?.entity ?? entity?.id;
    return Boolean(entityId && (contextEntities.has(entityId) || membershipEntities.has(entityId)));
  });
};

/** Generates the browser-safe semantic projection consumed by generic application view hosts. */
export const projectApplicationBrowserView = (
  input: ApplicationGraphV1,
  routeId = input.app.entryRoute,
): ApplicationBrowserViewProjectionV1 => {
  const diagnostics = validateApplicationGraph(input);
  if (diagnostics.length > 0) throw new ApplicationGraphValidationError(diagnostics);
  const graph = canonicalizeApplicationGraph(input);
  const route = graph.routes.find((candidate) => candidate.id === routeId);
  if (!route) throw new TypeError(`Application route ${JSON.stringify(routeId)} does not exist.`);
  const view = graph.views.find((candidate) => candidate.id === route.view);
  if (!view) throw new TypeError(`Application view ${JSON.stringify(route.view)} does not exist.`);
  const queryIds = new Set(Object.values(view.data).map((binding) => binding.query));
  const operationIds = new Set<string>();
  const collectOperations = (element: ApplicationViewElementV1): void => {
    if (element.kind === 'repeat') {
      collectOperations(element.template);
      return;
    }
    if (element.submit) operationIds.add(element.submit.operation);
    Object.values(element.events ?? {}).forEach((event) => operationIds.add(event.operation));
    element.children?.forEach(collectOperations);
  };
  collectOperations(view.tree);
  const functions: ApplicationBrowserViewFunctionV1[] = [
    ...graph.queries
      .filter((query) => queryIds.has(query.id))
      .map((query) => {
        const contexts = functionContexts(graph, query.id);
        return {
          clientModule: clientModuleName(contexts),
          contexts,
          id: `${graph.app.id}/${query.id}`,
          mode: 'query' as const,
          name: query.name,
          parameters: [],
          refreshContexts: false,
          semanticId: query.id,
        };
      }),
    ...graph.operations
      .filter((operation) => operationIds.has(operation.id))
      .map((operation) => {
        const outputEntity = operationEntity(operation);
        const contexts = functionContexts(graph, operation.id);
        return {
          clientModule: clientModuleName(contexts),
          contexts,
          id: `${graph.app.id}/${operation.id}`,
          mode: 'mutation' as const,
          name: operation.name,
          ...(outputEntity ? { outputEntity } : {}),
          parameters: Object.keys(operation.input.fields),
          refreshContexts: operationRefreshesContexts(graph, operation),
          semanticId: operation.id,
        };
      }),
  ].sort((left, right) => compareText(left.semanticId, right.semanticId));

  return Object.freeze({
    appId: graph.app.id,
    appName: graph.app.name,
    ...(graph.app.authentication ? { authentication: graph.app.authentication } : {}),
    contexts: (graph.contexts ?? [])
      .filter((context) => graph.app.contexts?.includes(context.id))
      .map((context) => ({
        entityId: context.entity,
        id: context.id,
        ...(context.labelField ? { labelField: context.labelField } : {}),
        name: context.name,
      })),
    fields: graph.fields,
    functions,
    hydrationKey: `${graph.app.id}@r${graph.revision}:${view.id}`,
    loading: projectApplicationLoading(graph, view.id),
    modes: standardModes(),
    revision: graph.revision,
    route: { id: route.id, path: route.path },
    schemaVersion: 'oxe.application-browser-view.v1',
    view: { data: view.data, id: view.id, name: view.name, tree: view.tree },
  });
};

export const generateApplicationBrowserViewModule = (
  graph: ApplicationGraphV1,
  routeId?: string,
): string =>
  `/* Generated from the normalized OXE application graph. Do not edit. */\nexport const applicationView = ${JSON.stringify(projectApplicationBrowserView(graph, routeId))} as const;\n`;
