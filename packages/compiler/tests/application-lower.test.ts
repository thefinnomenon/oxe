import { readFileSync } from 'node:fs';

import {
  fingerprintUiGraph,
  loadApplicationGraph,
  mutateApplicationGraph,
  serializeUiGraph,
  validateUiGraph,
  type ApplicationGraphV1,
  type ApplicationMutationBatchV1,
} from '@oxe/graph';
import { describe, expect, it } from 'vitest';

import {
  ApplicationUiLoweringError,
  generateDomModuleSource,
  lowerApplicationRouteToUiGraph,
} from '../src/index.js';

const fixtureUrl = new URL('../../../examples/application-graph-todo/graph.json', import.meta.url);

const todoGraph = (): ApplicationGraphV1 =>
  loadApplicationGraph(JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown);

const priorityBatch: ApplicationMutationBatchV1 = {
  base: 16,
  ops: [
    {
      as: 'priority',
      default: 'normal',
      entity: 'entity.task',
      name: 'priority',
      op: 'field.add',
      type: { enum: ['low', 'normal', 'high'] },
    },
    { field: '$priority', form: 'element.createTaskForm', op: 'form.field.add' },
    { field: '$priority', list: 'element.taskList', op: 'list.display.add' },
  ],
};

const broadUiGraph = (): ApplicationGraphV1 => {
  const graph = todoGraph();
  const view = graph.views[0]!;
  if (view.tree.kind !== 'component') throw new Error('Expected the Todo page component.');
  return loadApplicationGraph({
    ...graph,
    entities: graph.entities.map((entity) =>
      entity.id === 'entity.task'
        ? { ...entity, fields: [...(entity.fields ?? []), 'field.task.estimate'] }
        : entity,
    ),
    fields: [
      ...graph.fields,
      {
        entity: 'entity.task',
        id: 'field.task.estimate',
        kind: 'field',
        name: 'estimate',
        required: true,
        valueType: { kind: 'number' },
      },
    ],
    operations: graph.operations.map((operation) =>
      operation.id === 'operation.createTask' && operation.body.kind === 'createEntity'
        ? {
            ...operation,
            body: {
              ...operation.body,
              values: {
                ...operation.body.values,
                'field.task.estimate': { kind: 'inputField', name: 'estimate' },
              },
            },
            input: {
              ...operation.input,
              fields: { ...operation.input.fields, estimate: { kind: 'number' } },
            },
          }
        : operation,
    ),
    views: [
      {
        ...view,
        tree: {
          ...view.tree,
          children: [
            ...(view.tree.children ?? []).map((child) =>
              child.kind === 'component' && child.id === 'element.createTaskForm'
                ? {
                    ...child,
                    fields: [...(child.fields ?? []), 'field.task.estimate'],
                    submit: child.submit
                      ? {
                          ...child.submit,
                          arguments: {
                            ...child.submit.arguments,
                            estimate: {
                              kind: 'formValue',
                              name: 'estimate',
                              valueType: 'number',
                            },
                          },
                        }
                      : undefined,
                  }
                : child,
            ),
            {
              children: [
                {
                  children: [
                    {
                      component: 'ui.Text',
                      kind: 'component',
                      props: { text: { kind: 'literal', value: 'Summary' } },
                    },
                    {
                      component: 'ui.Link',
                      kind: 'component',
                      props: {
                        href: { kind: 'literal', value: '/details' },
                        text: { kind: 'literal', value: 'Details' },
                      },
                    },
                  ],
                  component: 'ui.Card',
                  kind: 'component',
                },
              ],
              component: 'ui.Stack',
              id: 'element.summaryStack',
              kind: 'component',
            },
          ],
        },
      },
    ],
  });
};

describe('application graph browser lowering', () => {
  it('lowers reusable layout, content, navigation, and numeric form primitives', () => {
    const projection = lowerApplicationRouteToUiGraph(broadUiGraph());
    const elements = projection.graph.nodes.filter((node) => node.kind === 'element');

    expect(elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          staticAttributes: expect.arrayContaining([
            expect.objectContaining({ name: 'data-oxe-ui', value: 'stack' }),
          ]),
          tag: 'div',
        }),
        expect.objectContaining({
          staticAttributes: expect.arrayContaining([
            expect.objectContaining({ name: 'data-oxe-ui', value: 'card' }),
          ]),
          tag: 'section',
        }),
        expect.objectContaining({
          staticAttributes: expect.arrayContaining([
            expect.objectContaining({ name: 'href', value: '/details' }),
          ]),
          tag: 'a',
        }),
        expect.objectContaining({
          staticAttributes: expect.arrayContaining([
            expect.objectContaining({ name: 'name', value: 'estimate' }),
            expect.objectContaining({ name: 'type', value: 'number' }),
          ]),
          tag: 'input',
        }),
      ]),
    );
    expect(JSON.stringify(projection.graph)).toContain('valueAsNumber');
    expect(validateUiGraph(projection.graph)).toEqual([]);
  });

  it('lowers the Todo success view into a valid deterministic UiGraphV1 golden', () => {
    const projection = lowerApplicationRouteToUiGraph(todoGraph());

    expect(projection).toMatchObject({
      appId: 'app.todo',
      authentication: 'required',
      revision: 16,
      routeId: 'route.tasks',
      schemaVersion: 'oxe.application-ui-projection.v1',
      viewId: 'view.tasks',
    });
    expect(validateUiGraph(projection.graph)).toEqual([]);
    expect(fingerprintUiGraph(projection.graph)).toBe('oxe-ea3fc827');
    expect(projection.graph.nodes).toHaveLength(76);
    expect(projection.graph.edges).toHaveLength(94);
    expect(projection.provenance.loweredNodes).toHaveLength(projection.graph.nodes.length);
    expect(projection.provenance.semanticNodes).toEqual([
      { handle: 0, semanticId: 'element.createTaskForm' },
      { handle: 1, semanticId: 'element.createTeamForm' },
      { handle: 2, semanticId: 'element.inviteTeamMemberForm' },
      { handle: 3, semanticId: 'element.myInvitationList' },
      { handle: 4, semanticId: 'element.taskEditor' },
      { handle: 5, semanticId: 'element.taskList' },
      { handle: 6, semanticId: 'element.teamInvitationList' },
      { handle: 7, semanticId: 'field.membership.accepted' },
      { handle: 8, semanticId: 'field.membership.createdAt' },
      { handle: 9, semanticId: 'field.membership.id' },
      { handle: 10, semanticId: 'field.membership.userId' },
      { handle: 11, semanticId: 'field.task.done' },
      { handle: 12, semanticId: 'field.task.id' },
      { handle: 13, semanticId: 'field.task.title' },
      { handle: 14, semanticId: 'field.team.name' },
      { handle: 15, semanticId: 'operation.acceptTeamInvitation' },
      { handle: 16, semanticId: 'operation.createTask' },
      { handle: 17, semanticId: 'operation.createTeam' },
      { handle: 18, semanticId: 'operation.deleteTask' },
      { handle: 19, semanticId: 'operation.inviteTeamMember' },
      { handle: 20, semanticId: 'operation.renameTask' },
      { handle: 21, semanticId: 'operation.revokeTeamInvitation' },
      { handle: 22, semanticId: 'operation.toggleTask' },
      { handle: 23, semanticId: 'query.myTasks' },
      { handle: 24, semanticId: 'query.myTeamInvitations' },
      { handle: 25, semanticId: 'query.teamInvitations' },
      { handle: 26, semanticId: 'route.tasks' },
      { handle: 27, semanticId: 'view.tasks' },
    ]);
    expect(projection.deferredInteractions).toEqual([]);

    const capability = projection.graph.nodes.find(
      (node) =>
        node.kind === 'platform-capability' && node.serverFunctionId?.endsWith('query.myTasks'),
    );
    expect(capability).toMatchObject({
      capabilityKind: 'async',
      parameters: [],
      returns: 'array',
      serverFunctionId: 'app.todo/query.myTasks',
    });
    expect(projection.graph.serverFunctions).toHaveLength(11);
    expect(projection.graph.serverFunctions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'app.todo/operation.createTask',
          mode: 'mutation',
          parameters: [
            {
              name: 'title',
              schema: { kind: 'string', maximumLength: 120, minimumLength: 1 },
            },
          ],
        }),
        expect.objectContaining({ id: 'app.todo/operation.deleteTask', mode: 'mutation' }),
        expect.objectContaining({ id: 'app.todo/operation.inviteTeamMember', mode: 'mutation' }),
        expect.objectContaining({ id: 'app.todo/operation.renameTask', mode: 'mutation' }),
        expect.objectContaining({ id: 'app.todo/operation.toggleTask', mode: 'mutation' }),
        expect.objectContaining({ id: 'app.todo/query.myTasks', mode: 'query' }),
      ]),
    );
    expect(projection.graph.nodes.filter((node) => node.kind === 'procedure')).toHaveLength(8);
    expect(projection.graph.edges.filter((edge) => edge.kind === 'event')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ authoredName: 'onChange', event: 'change' }),
        expect.objectContaining({ authoredName: 'onClick', event: 'click' }),
        expect.objectContaining({ authoredName: 'onSubmit', event: 'submit' }),
      ]),
    );
    const collection = projection.graph.nodes.find((node) => node.kind === 'keyed-collection');
    expect(collection).toMatchObject({
      key: { kind: 'member', property: 'id' },
      source: { kind: 'read' },
    });
    const textInput = projection.graph.nodes.find(
      (node) =>
        node.kind === 'element' &&
        node.tag === 'input' &&
        node.staticAttributes.some(
          (attribute) => attribute.name === 'name' && attribute.value === 'title',
        ),
    );
    expect(textInput?.kind === 'element' ? textInput.staticAttributes : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'required', value: true }),
        expect.objectContaining({ name: 'minlength', value: 1 }),
        expect.objectContaining({ name: 'maxlength', value: 120 }),
      ]),
    );
  });

  it('is independent of semantically unordered application collection order', () => {
    const graph = todoGraph();
    const reordered: ApplicationGraphV1 = {
      ...graph,
      entities: [...graph.entities].reverse(),
      features: [...graph.features].reverse(),
      fields: [...graph.fields].reverse(),
      operations: [...graph.operations].reverse(),
      policies: [...graph.policies].reverse(),
      queries: [...graph.queries].reverse(),
      relations: [...graph.relations].reverse(),
      routes: [...graph.routes].reverse(),
      views: [...graph.views].reverse(),
    };

    const canonical = lowerApplicationRouteToUiGraph(graph);
    const projected = lowerApplicationRouteToUiGraph(reordered);
    expect(serializeUiGraph(projected.graph)).toBe(serializeUiGraph(canonical.graph));
    expect(projected.provenance).toEqual(canonical.provenance);
    expect(projected.deferredInteractions).toEqual(canonical.deferredInteractions);
  });

  it('produces JavaScript through the existing direct-DOM code generator', () => {
    const projection = lowerApplicationRouteToUiGraph(todoGraph());
    const source = generateDomModuleSource(projection.graph);

    expect(source).toContain('createAsyncResource');
    expect(source).toContain('createKeyedRegion');
    expect(source).toContain('createElement(document, "main")');
    expect(source).toContain('createServerFunctionCapabilityMap');
    expect(source).toContain('createTaskSubmitevent["preventDefault"]()');
    expect(source).toContain('["namedItem"]("title")["value"]');
    expect(source).toContain(
      'listen(inputElement, "change", (event) => toggleTaskChangeHandler(event, taskItem.read())',
    );
    expect(source.match(/refreshAsyncResource\(tasksAsync\)/gu)).toHaveLength(8);
    expect(source).toContain('bindDomValue');
    expect(source).toContain('app.todo/operation.createTask');
    expect(source).toContain('app.todo/operation.deleteTask');
    expect(source).toContain('app.todo/operation.renameTask');
    expect(source).toContain('app.todo/operation.toggleTask');
  });

  it('projects the priority mutation into generated form and list UI without source edits', () => {
    const baseProjection = lowerApplicationRouteToUiGraph(todoGraph());
    const mutation = mutateApplicationGraph(todoGraph(), priorityBatch);
    expect(mutation.ok).toBe(true);
    if (!mutation.ok) throw new Error(mutation.diagnostics[0]?.message);

    const projection = lowerApplicationRouteToUiGraph(mutation.graph);
    expect(validateUiGraph(projection.graph)).toEqual([]);
    expect(fingerprintUiGraph(projection.graph)).toBe('oxe-f4ccccb2');
    expect(projection.graph.nodes).toHaveLength(89);
    expect(projection.graph.edges).toHaveLength(108);
    for (const baseNode of baseProjection.graph.nodes)
      if (
        !baseNode.id.includes('/procedure/element.createTaskForm') &&
        !baseNode.id.endsWith('/capability/operation.createTask')
      )
        expect(projection.graph.nodes.find((node) => node.id === baseNode.id)).toEqual(baseNode);
    expect(projection.provenance.semanticNodes).toContainEqual({
      handle: 13,
      semanticId: 'field.task.priority',
    });

    const select = projection.graph.nodes.find(
      (node) => node.kind === 'element' && node.tag === 'select',
    );
    expect(select?.kind === 'element' ? select.staticAttributes : []).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'name', value: 'priority' })]),
    );
    const options = projection.graph.nodes.filter(
      (node) => node.kind === 'element' && node.tag === 'option',
    );
    expect(options).toHaveLength(3);
    expect(options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          staticAttributes: expect.arrayContaining([
            expect.objectContaining({ name: 'value', value: 'normal' }),
            expect.objectContaining({ name: 'selected', value: true }),
          ]),
        }),
      ]),
    );
    expect(
      projection.graph.nodes.some(
        (node) =>
          node.kind === 'text' &&
          node.parts.some((part) => part.kind === 'static' && part.value === 'priority: '),
      ),
    ).toBe(true);
    const createDefinition = projection.graph.serverFunctions?.find(
      (definition) => definition.id === 'app.todo/operation.createTask',
    );
    expect(createDefinition?.parameters).toEqual(
      expect.arrayContaining([
        { name: 'priority', schema: { enum: ['high', 'low', 'normal'], kind: 'string' } },
      ]),
    );
    expect(generateDomModuleSource(projection.graph)).toContain(
      '["namedItem"]("priority")["value"]',
    );
  });

  it('reports an unavailable route precisely before lowering', () => {
    expect.assertions(2);
    try {
      lowerApplicationRouteToUiGraph(todoGraph(), { routeId: 'route.missing' });
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationUiLoweringError);
      if (!(error instanceof ApplicationUiLoweringError)) throw error;
      expect(error.diagnostics).toEqual([
        {
          code: 'OXE2201',
          message: 'Application route "route.missing" does not exist.',
          path: '$.routes',
          semanticId: 'route.missing',
        },
      ]);
    }
  });
});
