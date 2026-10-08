import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateAuthoringCandidate } from './candidate-format.mjs';

const fixtureUrl = new URL('../../examples/application-graph-todo/graph.json', import.meta.url);

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const requireAssertion = (condition, message) => {
  if (!condition) throw new Error(message);
};

const elementParent = (element, semanticId, parentId = 'view.tasks') => {
  if (element.id === semanticId) return parentId;
  const children = [
    ...(Array.isArray(element.children) ? element.children : []),
    ...(element.template ? [element.template] : []),
  ];
  for (const child of children) {
    const result = elementParent(child, semanticId, element.id ?? parentId);
    if (result) return result;
  }
  return undefined;
};

const field = (graph, id) => graph.fields.find((candidate) => candidate.id === id);
const operation = (graph, id) => graph.operations.find((candidate) => candidate.id === id);

const assertions = {
  'add-task-priority': ({ graph }) => {
    const priority = field(graph, 'field.task.priority');
    requireAssertion(priority, 'Task priority field is missing.');
    requireAssertion(
      priority.entity === 'entity.task',
      'Task priority belongs to the wrong entity.',
    );
    requireAssertion(priority.required === true, 'Task priority must be required.');
    requireAssertion(
      priority.valueType?.kind === 'enum' &&
        same(priority.valueType.values, ['low', 'normal', 'high']),
      'Task priority must use the exact low, normal, high enum.',
    );
    requireAssertion(priority.default?.value === 'normal', 'Task priority must default to normal.');
    const create = operation(graph, 'operation.createTask');
    requireAssertion(
      create?.input?.fields?.priority?.kind === 'enum',
      'Create Task must accept priority.',
    );
    requireAssertion(
      create?.body?.values?.['field.task.priority']?.kind === 'inputField',
      'Create Task must store priority.',
    );
    const view = JSON.stringify(graph.views);
    requireAssertion(
      view.split('field.task.priority').length >= 3,
      'Task creation and rows must both reference priority.',
    );
  },
  'rename-task-field': ({ base, graph, graphModule }) => {
    requireAssertion(
      field(graph, 'field.task.title')?.name === 'label',
      'Task title was not renamed.',
    );
    requireAssertion(!field(graph, 'field.task.label'), 'The rename changed the stable field ID.');
    const before = graphModule
      .indexApplicationGraph(base)
      .nodes.map(({ id }) => id)
      .sort();
    const after = graphModule
      .indexApplicationGraph(graph)
      .nodes.map(({ id }) => id)
      .sort();
    requireAssertion(same(before, after), 'A pure rename changed semantic identities.');
  },
  'tighten-task-read-policy': ({ base, graph }) => {
    const before = base.policies.find(({ id }) => id === 'policy.task');
    const after = graph.policies.find(({ id }) => id === 'policy.task');
    requireAssertion(after, 'Task policy is missing.');
    requireAssertion(
      same(after.rules.read, { kind: 'relationEqualsActor', relation: 'relation.taskOwner' }),
      'Task read policy does not require direct ownership.',
    );
    for (const action of ['create', 'delete', 'update'])
      requireAssertion(
        same(after.rules[action], before.rules[action]),
        `${action} policy changed.`,
      );
  },
  'move-view-control': ({ graph }) => {
    const view = graph.views.find(({ id }) => id === 'view.tasks');
    requireAssertion(view, 'Tasks view is missing.');
    requireAssertion(
      elementParent(view.tree, 'element.inviteTeamMemberForm') === 'element.createTeamForm',
      'The invitation form was not moved under the requested parent.',
    );
    const parent = (() => {
      const visit = (element) => {
        if (element.id === 'element.createTeamForm') return element;
        for (const child of element.children ?? []) {
          const found = visit(child);
          if (found) return found;
        }
        return element.template ? visit(element.template) : undefined;
      };
      return visit(view.tree);
    })();
    requireAssertion(
      parent?.children?.[1]?.id === 'element.inviteTeamMemberForm',
      'The invitation form is at the wrong child index.',
    );
  },
  'add-optional-task-due-date': ({ compilerModule, graph }) => {
    const dueDate = field(graph, 'field.task.dueDate');
    requireAssertion(dueDate, 'Task due date field is missing.');
    requireAssertion(dueDate.required === false, 'Task due date must not be required.');
    requireAssertion(
      same(dueDate.valueType, { kind: 'optional', value: { kind: 'date' } }),
      'Task due date must preserve Optional<Date> semantics.',
    );
    const sql = compilerModule.generateApplicationPostgresSchemaSql(
      compilerModule.compileApplicationPostgresSchema(graph),
    );
    requireAssertion(/date/iu.test(sql), 'PostgreSQL projection does not contain DATE storage.');
  },
  'add-document-upload-capability': ({ graph }) => {
    const capability = graph.capabilities?.find(
      ({ contract }) => contract === 'oxe.capability.object-storage',
    );
    requireAssertion(capability, 'Object-storage capability is missing.');
    const put = capability.methods.put;
    requireAssertion(put?.input?.fields?.bytes?.kind === 'bytes', 'Storage put input lacks bytes.');
    requireAssertion(
      put?.input?.fields?.contentType?.kind === 'string',
      'Storage put input lacks content type.',
    );
    const invoke = graph.operations.find(
      ({ body }) => body.kind === 'invokeCapability' && body.capability === capability.id,
    );
    requireAssertion(invoke, 'No operation invokes the object-storage capability.');
    requireAssertion(
      invoke.effects.some(
        ({ kind, target }) => kind === 'externalCall' && target === capability.id,
      ),
      'Object-storage operation lacks its external-call effect.',
    );
  },
  'add-project-under-team-context': ({ graph }) => {
    const project = graph.contexts?.find(({ id }) => id === 'context.project');
    requireAssertion(project, 'Project context is missing.');
    requireAssertion(
      project.parents?.some(
        ({ context, relation }) =>
          context === 'context.team' && relation === 'relation.projectTeam',
      ),
      'Project context is not parented by Team through relation.projectTeam.',
    );
    const contexts = graph.app.contexts ?? [];
    requireAssertion(
      contexts.indexOf('context.team') < contexts.indexOf('context.project'),
      'Team must precede Project in the active context chain.',
    );
    const relation = graph.relations.find(({ id }) => id === 'relation.projectTeam');
    requireAssertion(relation, 'Project-to-Team relation is missing.');
  },
  'add-branded-component-extension': ({ graph }) => {
    const module = graph.modules?.find(
      ({ id, target }) => id === 'module.brandedTask' && target === 'browser',
    );
    requireAssertion(module, 'Browser extension module module.brandedTask is missing.');
    requireAssertion(
      /^sha256:[a-f0-9]{64}$/u.test(module.integrity),
      'Module integrity is invalid.',
    );
    requireAssertion(Object.keys(module.packages ?? {}).length > 0, 'Module packages are missing.');
    const component = graph.components?.find(({ id }) => id === 'component.brandedTask');
    requireAssertion(component, 'Branded component contract is missing.');
    requireAssertion(
      component.implementation.module === module.id,
      'Component module binding is wrong.',
    );
    requireAssertion(Object.keys(component.props).length > 0, 'Component props must be typed.');
    requireAssertion((component.events ?? []).length > 0, 'Component events must be declared.');
    requireAssertion(Boolean(component.ssr?.tag), 'Component SSR fallback is missing.');
    const style = graph.styles?.find(({ id }) => id === 'style.brandedTask');
    requireAssertion(style, 'Branded style tokens are missing.');
    requireAssertion(Object.keys(style.tokens).length > 0, 'Branded style tokens are empty.');
  },
};

const evaluateRestore = (candidate, base, graphModule) => {
  requireAssertion(
    candidate.action.kind === 'protocol',
    'Revision recovery requires a protocol action.',
  );
  const historical = JSON.stringify(base);
  const newer = graphModule.loadApplicationGraph({
    ...base,
    app: { ...base.app, name: 'Temporary newer revision' },
    revision: 17,
  });
  let published = false;
  const response = graphModule.executeApplicationAgentRequest(
    {
      commit: () => {
        throw new Error('Commit must not be used for revision recovery.');
      },
      current: () => newer,
      load: (_appId, revision) => (revision === 16 ? base : revision === 17 ? newer : undefined),
      publishArtifacts: (before, after) => {
        requireAssertion(
          before.revision === 17,
          'Publication did not start from the current head.',
        );
        requireAssertion(
          after.revision === 18,
          'Publication did not receive the restored revision.',
        );
        published = true;
        return {
          artifacts: [],
          stats: { built: 0, removed: 0, reused: 0 },
        };
      },
      undo: (_appId, baseRevision, targetRevision) => {
        requireAssertion(baseRevision === 17, 'Restore did not check the current base revision.');
        requireAssertion(targetRevision === 16, 'Restore selected the wrong historical revision.');
        return graphModule.mutateApplicationGraph(newer, {
          base: 17,
          ops: [{ app: base.app, op: 'app.replace' }],
        });
      },
    },
    candidate.action.request,
  );
  requireAssertion(
    response.ok && response.result.kind === 'revert',
    'Typed restore request failed.',
  );
  requireAssertion(response.revision === 18, 'Restore did not create a new revision.');
  requireAssertion(published, 'Restored revision was not published.');
  requireAssertion(JSON.stringify(base) === historical, 'Historical revision was mutated.');
};

export const evaluateTrial = async ({ candidate: value, task }) => {
  const root = await mkdtemp(join(tmpdir(), 'oxe-ai-authoring-evaluator-'));
  try {
    const candidate = validateAuthoringCandidate(value, task.id);
    await writeFile(join(root, 'candidate.json'), `${JSON.stringify(candidate)}\n`, 'utf8');
    const graphModule = await import('../../packages/graph/dist/index.js');
    const compilerModule = await import('../../packages/compiler/dist/index.js');
    const base = graphModule.loadApplicationGraph(JSON.parse(await readFile(fixtureUrl, 'utf8')));
    if (task.id === 'restore-prior-revision') {
      evaluateRestore(candidate, base, graphModule);
      return { success: true };
    }
    if (task.id === 'preview-remove-task-query') {
      requireAssertion(
        candidate.action.kind === 'mutation',
        'Expected a semantic removal preview.',
      );
      const preview = graphModule.previewApplicationMutation(base, candidate.action.batch);
      requireAssertion(
        !preview.ok,
        'Removing query.myTasks unexpectedly produced a valid revision.',
      );
      const sources = preview.incomingReferences
        .filter(({ targetId }) => targetId === 'query.myTasks')
        .map(({ sourceId }) => sourceId);
      requireAssertion(
        sources.includes('view.tasks') && sources.includes('flow.createTask'),
        'Removal preview does not report the incoming view and verification-flow references.',
      );
      return { success: true };
    }
    let graph;
    if (candidate.action.kind === 'replaceGraph')
      graph = graphModule.loadApplicationGraph(candidate.action.graph);
    else if (candidate.action.kind === 'mutation') {
      const mutation = graphModule.mutateApplicationGraph(base, candidate.action.batch);
      requireAssertion(mutation.ok, 'Submitted semantic mutation is invalid.');
      graph = mutation.graph;
    } else throw new Error('Task requires a graph or mutation candidate.');
    requireAssertion(graph.revision === 17, 'Candidate must produce exactly revision 17.');
    requireAssertion(
      graphModule.validateApplicationGraph(graph).length === 0,
      'Candidate graph is invalid.',
    );
    const taskAssertion = assertions[task.id];
    requireAssertion(taskAssertion, `No held-out evaluator exists for ${task.id}.`);
    taskAssertion({ base, compilerModule, graph, graphModule });
    return { success: true };
  } catch (error) {
    return {
      failureReason: error instanceof Error ? error.message : 'Held-out evaluation failed.',
      success: false,
    };
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};
