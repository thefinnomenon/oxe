import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ApplicationGraphValidationError,
  loadApplicationGraph,
  measureCompactApplicationProjection,
  projectApplicationRuntimeRequirements,
  projectCompactApplicationGraph,
  validateApplicationGraph,
  validateApplicationRuntimeBindings,
  type ApplicationGraphV1,
} from '../src/index.js';

const fixtureUrl = new URL('../../../examples/application-graph-todo/graph.json', import.meta.url);

const todoFixture = (): unknown => JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown;

const addWorkflow = (input: unknown): Record<string, unknown> => {
  const root = recordAt(input, []);
  const operation = {
    body: {
      kind: 'workflow',
      result: { kind: 'local', name: 'toggled' },
      steps: [
        {
          as: 'renamed',
          entity: 'entity.task',
          kind: 'updateEntity',
          record: { kind: 'inputField', name: 'task' },
          values: { 'field.task.title': { kind: 'inputField', name: 'title' } },
        },
        {
          as: 'toggled',
          entity: 'entity.task',
          kind: 'updateEntity',
          record: { kind: 'local', name: 'renamed' },
          values: {
            'field.task.done': {
              kind: 'not',
              value: {
                field: 'field.task.done',
                kind: 'recordField',
                record: { kind: 'local', name: 'renamed' },
              },
            },
          },
        },
      ],
    },
    effects: [
      { kind: 'databaseWrite', target: 'field.task.done' },
      { kind: 'databaseWrite', target: 'field.task.title' },
    ],
    id: 'operation.renameAndToggleTask',
    input: {
      fields: {
        task: { entity: 'entity.task', kind: 'entity' },
        title: { kind: 'string' },
      },
      kind: 'record',
    },
    kind: 'operation',
    name: 'Rename and toggle task',
    output: { entity: 'entity.task', kind: 'entity' },
  };
  (root.operations as unknown[]).push(operation);
  return operation;
};

const recordAt = (value: unknown, path: readonly (number | string)[]): Record<string, unknown> => {
  let current = value;
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || current[segment] === undefined) {
        throw new TypeError(`Fixture path segment ${segment} is not an array item.`);
      }
      current = current[segment];
    } else {
      if (typeof current !== 'object' || current === null || Array.isArray(current)) {
        throw new TypeError(`Fixture path segment ${segment} is not an object property.`);
      }
      current = (current as Record<string, unknown>)[segment];
    }
  }
  if (typeof current !== 'object' || current === null || Array.isArray(current)) {
    throw new TypeError('Fixture path does not resolve to an object.');
  }
  return current as Record<string, unknown>;
};

const compactTodo = `TinyTodo r16
auth BetterAuth emailPassword signIn=/sign-in signUp=/sign-up

contexts OwnedTeam, Team

E1 Task
  F1 title: str required len 1..120
  F2 done: bool = false
  R3 owner -> User required default actor
  R4 team -> Team default context(Team)
  access team: read update delete
E2 Team
  F3 name: str required len 1..80
  R2 memberships -> TeamMembership
  R4 tasks -> Task
  R5 owner -> User required default actor
  access owner: read update delete
E3 TeamMembership
  F4 userId: str required
  F5 role: enum(member) required
  F6 status: enum(active) required
  F7 accepted: bool = true
  R1 member -> User required
  access member: update
  R2 team -> Team required default context(OwnedTeam)
  access team: delete
  unique R1 R2

Q1 myTasks: Task[] where team=context(Team) cache=30000ms
Q2 myTeamInvitations: TeamMembership[] where member=actor & F7=false cache=5000ms
Q3 teamInvitations: TeamMembership[] where team=context(OwnedTeam) cache=5000ms
O1 acceptTeamInvitation(invitation) -> TeamMembership writes F7
O2 createTask(title) -> Task writes E1
O3 createTeam(name) -> Team writes E2
O4 deleteTask(task) -> Task writes E1
O5 inviteTeamMember(userId) -> TeamMembership writes E3
O6 renameTask(task,title) -> Task writes F1
O7 revokeTeamInvitation(invitation) -> TeamMembership writes E3
O8 toggleTask(task) -> Task writes F2

V1 /tasks TasksPage auth
  Form1 create E1 [F1]
  Form2 create E2 [F3]
  Form3 create E3 [F4]
  List1 Q2
    Button text=Accept invitation type=button
      click -> O1
    display field.membership.createdAt
  List2 Q1
    Form
      submit -> O6
      CheckboxRow label=F1 checked=F2
        change -> O8
      TextField label=Task title value=F1
      Button text=Save type=submit
      Button text=Delete type=button
        click -> O4
  List3 Q3
    Button text=Revoke member type=button
      click -> O7
    display F4 F7
`;

describe('application graph v1', () => {
  it('loads and validates the canonical Todo fixture', () => {
    const graph = loadApplicationGraph(todoFixture());

    expect(graph.format).toBe('oxe.application-graph');
    expect(graph.revision).toBe(16);
    expect(graph.app.id).toBe('app.todo');
    expect(graph.app.authentication).toEqual({
      authenticatedRoute: 'route.tasks',
      methods: ['emailPassword'],
      provider: 'betterAuth',
      signInPath: '/sign-in',
      signUpPath: '/sign-up',
    });
    expect(validateApplicationGraph(graph)).toEqual([]);
  });

  it('validates typed workflow locals and projects their deterministic semantic steps', () => {
    const input = todoFixture();
    const operation = addWorkflow(input);
    const graph = loadApplicationGraph(input);

    expect(validateApplicationGraph(graph)).toEqual([]);
    expect(projectCompactApplicationGraph(graph)).toContain(
      'Rename and toggle task(task,title) -> Task writes F2 F1 steps update:E1@renamed>update:E1@toggled',
    );

    recordAt(operation, ['body', 'steps', 1]).as = 'renamed';
    recordAt(operation, ['body', 'steps', 0]).record = { kind: 'local', name: 'future' };
    expect(validateApplicationGraph(input)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OXE3104',
          path: '$.operations[8].body.steps[0].record.name',
          semanticId: 'operation.renameAndToggleTask',
        }),
        expect.objectContaining({
          code: 'OXE3105',
          path: '$.operations[8].body.steps[1].as',
          semanticId: 'operation.renameAndToggleTask',
        }),
      ]),
    );
  });

  it('validates provider-neutral capability contracts and typed invocation operations', () => {
    const input = todoFixture();
    const root = recordAt(input, []);
    root.capabilities = [
      {
        contract: 'oxe.capability.mail',
        id: 'capability.mail',
        kind: 'capability',
        methods: {
          send: {
            input: {
              fields: { subject: { kind: 'string' }, to: { kind: 'string' } },
              kind: 'record',
            },
            output: {
              fields: { deliveryId: { kind: 'string' } },
              kind: 'record',
            },
          },
        },
        name: 'Mail',
        version: '1',
      },
    ];
    (root.operations as unknown[]).push({
      body: {
        arguments: {
          subject: { kind: 'inputField', name: 'subject' },
          to: { kind: 'inputField', name: 'to' },
        },
        capability: 'capability.mail',
        kind: 'invokeCapability',
        method: 'send',
      },
      effects: [{ kind: 'externalCall', target: 'capability.mail' }],
      id: 'operation.sendMail',
      input: {
        fields: { subject: { kind: 'string' }, to: { kind: 'string' } },
        kind: 'record',
      },
      kind: 'operation',
      name: 'Send mail',
      output: { fields: { deliveryId: { kind: 'string' } }, kind: 'record' },
    });

    const graph = loadApplicationGraph(input);
    expect(projectCompactApplicationGraph(graph)).toContain(
      'Send mail(subject,to) -> {deliveryId:str} effects C1 calls C1.send',
    );
    const requirements = projectApplicationRuntimeRequirements(graph);
    expect(requirements.capabilities).toEqual([
      {
        contract: 'oxe.capability.mail',
        generated: false,
        id: 'capability.mail',
        jobIdempotent: false,
        methods: ['send'],
        queued: false,
        version: '1',
      },
    ]);
    expect(validateApplicationRuntimeBindings(requirements, {})).toEqual([
      {
        code: 'OXE3501',
        message: 'Missing authentication adapter "betterAuth".',
        requirement: 'authentication:betterAuth',
      },
      {
        code: 'OXE3501',
        message: 'Missing persistence adapter "postgresql".',
        requirement: 'persistence:postgresql',
      },
      {
        code: 'OXE3501',
        message: 'Missing capability adapter "capability.mail" for oxe.capability.mail@1.',
        requirement: 'capability:capability.mail',
      },
    ]);
    expect(
      validateApplicationRuntimeBindings(requirements, {
        authentication: 'betterAuth',
        capabilities: ['capability.mail'],
        persistence: 'postgresql',
      }),
    ).toEqual([]);
    recordAt(input, ['operations', 8, 'body']).method = 'missing';
    expect(validateApplicationGraph(input)).toContainEqual({
      code: 'OXE3104',
      message: 'Capability "capability.mail" has no method "missing".',
      path: '$.operations[8].body.method',
      semanticId: 'operation.sendMail',
    });
  });

  it('validates revisioned server, browser-component, and style extensions', () => {
    const input = todoFixture();
    const root = recordAt(input, []);
    const integrity = `sha256:${'0'.repeat(64)}`;
    root.modules = [
      {
        format: 'javascript',
        id: 'module.mail',
        integrity,
        kind: 'extensionModule',
        name: 'Mail adapter',
        source: 'extensions/mail.js',
        target: 'server',
      },
      {
        format: 'javascript',
        id: 'module.sparkline',
        integrity,
        kind: 'extensionModule',
        name: 'Sparkline component',
        source: 'extensions/sparkline.js',
        target: 'browser',
      },
      {
        format: 'css',
        id: 'module.theme',
        integrity,
        kind: 'extensionModule',
        name: 'Theme overrides',
        source: 'styles/theme.css',
        target: 'browser',
      },
    ];
    root.capabilities = [
      {
        adapter: { export: 'mailAdapter', module: 'module.mail' },
        contract: 'example.mail',
        id: 'capability.mail',
        kind: 'capability',
        methods: {
          send: {
            input: { fields: { subject: { kind: 'string' } }, kind: 'record' },
            output: { fields: { deliveryId: { kind: 'string' } }, kind: 'record' },
          },
        },
        name: 'Mail',
        version: '1',
      },
    ];
    root.components = [
      {
        children: 'none',
        id: 'component.sparkline',
        implementation: { export: 'sparkline', module: 'module.sparkline' },
        kind: 'componentExtension',
        name: 'Sparkline',
        props: { label: { kind: 'string' } },
        ssr: { tag: 'oxe-sparkline' },
      },
    ];
    root.styles = [
      {
        id: 'style.application',
        kind: 'style',
        name: 'Application theme',
        stylesheets: ['module.theme'],
        themes: { dark: { 'color-surface': '#111' } },
        tokens: { 'color-surface': '#fff' },
      },
    ];
    const tree = recordAt(input, ['views', 0, 'tree']);
    tree.children = [
      ...((tree.children as unknown[]) ?? []),
      {
        component: 'component.sparkline',
        id: 'element.sparkline',
        kind: 'component',
        props: { label: { kind: 'literal', value: 'Weekly tasks' } },
      },
    ];

    const graph = loadApplicationGraph(input);
    const projection = projectCompactApplicationGraph(graph);
    expect(projection).toContain(
      `module module.sparkline browser/javascript extensions/sparkline.js ${integrity}`,
    );
    expect(projection).toContain('component component.sparkline props=[label]');
    expect(projectApplicationRuntimeRequirements(graph).extensions).toEqual([
      {
        format: 'javascript',
        id: 'module.mail',
        packages: {},
        target: 'server',
      },
      {
        format: 'javascript',
        id: 'module.sparkline',
        packages: {},
        target: 'browser',
      },
      { format: 'css', id: 'module.theme', packages: {}, target: 'browser' },
    ]);

    recordAt(input, ['modules', 1]).target = 'server';
    expect(validateApplicationGraph(input)).toContainEqual(
      expect.objectContaining({
        code: 'OXE3106',
        path: '$.components[0].implementation.module',
        semanticId: 'component.sparkline',
      }),
    );
    recordAt(input, ['modules', 0]).integrity = 'sha256:bad';
    expect(validateApplicationGraph(input)).toContainEqual(
      expect.objectContaining({
        code: 'OXE3105',
        path: '$.modules[0].integrity',
        semanticId: 'module.mail',
      }),
    );
    recordAt(input, ['modules', 1]).source = 'extensions/mail.js';
    expect(validateApplicationGraph(input)).toContainEqual({
      code: 'OXE3105',
      message: 'Extension source is already owned by "module.mail".',
      path: '$.modules[1].source',
      semanticId: 'module.sparkline',
    });
  });

  it('validates typed durable capability enqueue steps and their declared effect', () => {
    const input = todoFixture();
    const root = recordAt(input, []);
    root.capabilities = [
      {
        contract: 'oxe.capability.mail',
        id: 'capability.mail',
        kind: 'capability',
        methods: {
          send: {
            input: { fields: { subject: { kind: 'string' } }, kind: 'record' },
            output: { fields: { deliveryId: { kind: 'string' } }, kind: 'record' },
          },
        },
        name: 'Mail',
        version: '1',
      },
    ];
    (root.operations as unknown[]).push({
      body: {
        kind: 'workflow',
        result: { kind: 'local', name: 'renamed' },
        steps: [
          {
            as: 'renamed',
            entity: 'entity.task',
            kind: 'updateEntity',
            record: { kind: 'inputField', name: 'task' },
            values: { 'field.task.title': { kind: 'inputField', name: 'title' } },
          },
          {
            arguments: { subject: { kind: 'inputField', name: 'title' } },
            as: 'notification',
            capability: 'capability.mail',
            kind: 'enqueueCapability',
            method: 'send',
            retry: { maxAttempts: 3 },
          },
        ],
      },
      effects: [
        { kind: 'databaseWrite', target: 'field.task.title' },
        { kind: 'jobEnqueue', target: 'capability.mail' },
      ],
      id: 'operation.renameAndNotify',
      input: {
        fields: {
          task: { entity: 'entity.task', kind: 'entity' },
          title: { kind: 'string' },
        },
        kind: 'record',
      },
      kind: 'operation',
      name: 'Rename and notify',
      output: { entity: 'entity.task', kind: 'entity' },
    });

    expect(validateApplicationGraph(input)).toEqual([]);
    expect(projectCompactApplicationGraph(loadApplicationGraph(input))).toContain(
      'enqueue:C1.send@notification',
    );
    const queuedRequirements = projectApplicationRuntimeRequirements(loadApplicationGraph(input));
    expect(queuedRequirements.capabilities[0]?.queued).toBe(true);
    expect(
      validateApplicationRuntimeBindings(queuedRequirements, {
        authentication: 'betterAuth',
        capabilities: ['capability.mail'],
        persistence: 'postgresql',
      }),
    ).toContainEqual({
      code: 'OXE3501',
      message: 'Queued capability adapter "capability.mail" must declare jobId idempotency.',
      requirement: 'capability-idempotency:capability.mail',
    });
    expect(
      validateApplicationRuntimeBindings(queuedRequirements, {
        authentication: 'betterAuth',
        capabilities: ['capability.mail'],
        jobIdempotentCapabilities: ['capability.mail'],
        persistence: 'postgresql',
      }),
    ).toEqual([]);
    recordAt(input, ['operations', 8, 'body', 'steps', 1, 'retry']).maxAttempts = 0;
    recordAt(input, ['operations', 8, 'body', 'steps', 1, 'retry']).jitterRatio = 2;
    const retryDiagnostics = validateApplicationGraph(input);
    expect(retryDiagnostics).toContainEqual(
      expect.objectContaining({
        code: 'OXE3101',
        path: '$.operations[8].body.steps[1].retry.maxAttempts',
      }),
    );
    expect(retryDiagnostics).toContainEqual(
      expect.objectContaining({
        code: 'OXE3101',
        path: '$.operations[8].body.steps[1].retry.jitterRatio',
      }),
    );
    recordAt(input, ['operations', 8, 'body', 'steps', 1, 'retry']).maxAttempts = 3;
    delete recordAt(input, ['operations', 8, 'body', 'steps', 1, 'retry']).jitterRatio;
    (recordAt(input, ['operations', 8]).effects as unknown[]).pop();
    expect(validateApplicationGraph(input)).toContainEqual(
      expect.objectContaining({
        code: 'OXE3105',
        message:
          'Queued capability delivery must declare a jobEnqueue effect for "capability.mail".',
      }),
    );
  });

  it('rejects malformed graph structure before semantic validation', () => {
    const input = todoFixture();
    recordAt(input, ['fields', 0]).required = 'yes';

    expect(validateApplicationGraph(input)).toEqual([
      {
        code: 'OXE3101',
        message: 'Expected a boolean.',
        path: '$.fields[0].required',
        semanticId: 'field.task.id',
      },
    ]);
  });

  it('validates finite numeric fields, defaults, inputs, and literals', () => {
    const input = todoFixture();
    const root = recordAt(input, []);
    (root.fields as unknown[]).push({
      default: { kind: 'literal', value: 1.5 },
      entity: 'entity.task',
      id: 'field.task.estimate',
      kind: 'field',
      name: 'estimate',
      required: true,
      valueType: { kind: 'number' },
    });
    const task = (root.entities as Record<string, unknown>[]).find(
      (entity) => entity.id === 'entity.task',
    );
    if (!task) throw new Error('Missing Task entity.');
    (task.fields as unknown[]).push('field.task.estimate');

    expect(validateApplicationGraph(input)).toEqual([]);
    recordAt(input, ['fields', (root.fields as unknown[]).length - 1, 'default']).value = '1.5';
    expect(validateApplicationGraph(input)).toContainEqual(
      expect.objectContaining({
        code: 'OXE3105',
        path: `$.fields[${(root.fields as unknown[]).length - 1}].default`,
        semanticId: 'field.task.estimate',
      }),
    );
  });

  it('validates graph-declared cache policies and query predicates precisely', () => {
    const invalidCache = todoFixture();
    recordAt(invalidCache, ['queries', 0]).cache = { kind: 'memory', maxAgeMs: -1 };
    expect(validateApplicationGraph(invalidCache)).toEqual([
      {
        code: 'OXE3101',
        message: 'Cache maxAgeMs must be nonnegative.',
        path: '$.queries[0].cache.maxAgeMs',
        semanticId: 'query.myTasks',
      },
    ]);

    const invalidPredicate = todoFixture();
    recordAt(invalidPredicate, ['queries', 0]).where = [
      { equals: 'not-a-boolean', field: 'field.task.done' },
      { equals: true, field: 'field.membership.accepted' },
    ];
    expect(validateApplicationGraph(invalidPredicate)).toEqual(
      expect.arrayContaining([
        {
          code: 'OXE3106',
          message: 'Query condition value is incompatible with field "field.task.done".',
          path: '$.queries[0].where[0].equals',
          semanticId: 'query.myTasks',
        },
        {
          code: 'OXE3104',
          message:
            'Field "field.membership.accepted" belongs to "entity.teamMembership", not "entity.task".',
          path: '$.queries[0].where[1].field',
          semanticId: 'query.myTasks',
        },
      ]),
    );
  });

  it('rejects unresolved references with their semantic owner and JSON path', () => {
    const input = todoFixture();
    recordAt(input, ['app']).entryRoute = 'route.missing';

    expect(validateApplicationGraph(input)).toContainEqual({
      code: 'OXE3103',
      message: 'Semantic reference "route.missing" does not resolve.',
      path: '$.app.entryRoute',
      semanticId: 'app.todo',
    });
    expect(() => loadApplicationGraph(input)).toThrow(ApplicationGraphValidationError);
  });

  it('rejects duplicate stable semantic ids across node kinds', () => {
    const input = todoFixture();
    recordAt(input, ['features', 0]).id = 'app.todo';

    expect(validateApplicationGraph(input)).toContainEqual({
      code: 'OXE3102',
      message: 'Duplicate semantic id "app.todo"; first declared at $.app.',
      path: '$.features[0].id',
      semanticId: 'app.todo',
    });
  });

  it('rejects field references that do not belong to the referenced entity', () => {
    const input = todoFixture();
    recordAt(input, ['queries', 0]).entity = 'builtin.user';

    expect(validateApplicationGraph(input)).toContainEqual({
      code: 'OXE3104',
      message: 'Field "field.task.id" belongs to "entity.task", not "builtin.user".',
      path: '$.queries[0].select[0]',
      semanticId: 'query.myTasks',
    });
  });

  it('rejects incompatible UI field bindings', () => {
    const input = todoFixture();
    recordAt(input, [
      'views',
      0,
      'tree',
      'children',
      6,
      'template',
      'children',
      0,
      'props',
      'checked',
    ]).field = 'field.task.title';

    expect(validateApplicationGraph(input)).toContainEqual({
      code: 'OXE3106',
      message: 'Binding for ui.CheckboxRow.checked requires boolean, received string.',
      path: '$.views[0].tree.children[6].template.children[0].props.checked',
      semanticId: 'element.taskEditor',
    });
  });

  it('requires delete targets to resolve to authoritative entity records', () => {
    const input = todoFixture();
    recordAt(input, ['operations', 3, 'body']).record = { kind: 'literal', value: 'task-1' };

    expect(validateApplicationGraph(input)).toContainEqual({
      code: 'OXE3106',
      message: 'Delete target must be an entity record.',
      path: '$.operations[3].body.record',
      semanticId: 'operation.deleteTask',
    });
  });

  it('enforces relation endpoint consistency for actor-owned relations', () => {
    const input = todoFixture();
    recordAt(input, ['relations', 0, 'to']).entity = 'entity.task';

    expect(validateApplicationGraph(input)).toContainEqual({
      code: 'OXE3105',
      message: 'Actor defaults require a one-valued endpoint opposite actor entity "builtin.user".',
      path: '$.relations[0].from.createValue',
      semanticId: 'relation.taskOwner',
    });
  });

  it('validates entity uniqueness constraints and their semantic keys', () => {
    const input = todoFixture();
    recordAt(input, ['uniques', 0]).keys = [
      'relation.membershipMember',
      'relation.membershipMember',
      'field.task.title',
    ];

    const diagnostics = validateApplicationGraph(input);
    expect(diagnostics).toContainEqual({
      code: 'OXE3105',
      message: 'Unique constraint key "relation.membershipMember" is declared more than once.',
      path: '$.uniques[0].keys[1]',
      semanticId: 'unique.membershipTeamMember',
    });
    expect(diagnostics).toContainEqual({
      code: 'OXE3105',
      message:
        'Unique constraint key "field.task.title" is stored on "entity.task", not "entity.teamMembership".',
      path: '$.uniques[0].keys[2]',
      semanticId: 'unique.membershipTeamMember',
    });
  });

  it('validates declared context roles for tenant policies and defaults', () => {
    const input = todoFixture();
    recordAt(input, ['app']).contexts = ['context.team', 'context.team'];
    const relation = recordAt(input, ['relations', 1]);
    recordAt(relation, ['from']).createValue = {
      context: 'context.missing',
      kind: 'activeContext',
    };
    const policy = recordAt(input, ['policies', 0]);
    recordAt(policy, ['rules']).read = {
      context: 'context.missing',
      kind: 'relationEqualsContext',
      relation: 'relation.taskTeam',
    };

    const diagnostics = validateApplicationGraph(input);
    expect(diagnostics).toContainEqual({
      code: 'OXE3105',
      message: 'Context role "context.team" is declared more than once.',
      path: '$.app.contexts[1]',
      semanticId: 'app.todo',
    });
    expect(diagnostics).toContainEqual({
      code: 'OXE3105',
      message: 'Context role "context.missing" is not declared in app.contexts.',
      path: '$.policies[0].rules.read.context',
      semanticId: 'policy.task',
    });
    expect(diagnostics).toContainEqual({
      code: 'OXE3105',
      message: 'Context role "context.missing" is not declared in app.contexts.',
      path: '$.relations[1].from.createValue.context',
      semanticId: 'relation.taskTeam',
    });
  });

  it('keeps context roles distinct even when they target the same entity type', () => {
    const input = todoFixture();
    const root = recordAt(input, []);
    const teamContext = structuredClone((root.contexts as unknown[])[0]);
    if (!teamContext || typeof teamContext !== 'object') throw new Error('Missing Team context.');
    (teamContext as Record<string, unknown>).id = 'context.workspace';
    (teamContext as Record<string, unknown>).name = 'Workspace';
    (root.contexts as unknown[]).push(teamContext);
    recordAt(input, ['app']).contexts = ['context.team', 'context.ownedTeam', 'context.workspace'];

    expect(validateApplicationGraph(input)).toEqual([]);
  });

  it('validates membership authorization relation endpoints', () => {
    const input = todoFixture();
    const context = recordAt(input, ['contexts', 0]);
    expect(validateApplicationGraph(input)).toEqual([]);

    recordAt(context, ['authorization', 'anyOf', 1]).resourceRelation = 'relation.taskOwner';
    expect(validateApplicationGraph(input)).toContainEqual({
      code: 'OXE3105',
      message:
        'Relation "relation.taskOwner" must connect "entity.teamMembership" to "entity.team".',
      path: '$.contexts[0].authorization.anyOf[1].resourceRelation',
      semanticId: 'context.team',
    });
  });

  it('validates context labels and membership conditions precisely', () => {
    const input = todoFixture();
    recordAt(input, ['contexts', 0]).labelField = 'field.task.title';
    recordAt(input, ['contexts', 0, 'authorization', 'anyOf', 1, 'conditions', 0]).equals =
      'pending';

    expect(validateApplicationGraph(input)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OXE3104',
          path: '$.contexts[0].labelField',
          semanticId: 'context.team',
        }),
        expect.objectContaining({
          code: 'OXE3106',
          path: '$.contexts[0].authorization.anyOf[1].conditions[0].equals',
          semanticId: 'context.team',
        }),
      ]),
    );
  });

  it('validates parent context order and rejects context hierarchy cycles', () => {
    const input = todoFixture();
    const root = recordAt(input, []);
    (root.contexts as unknown[]).push({
      authorization: { kind: 'relationEqualsActor', relation: 'relation.taskOwner' },
      entity: 'entity.task',
      id: 'context.task',
      kind: 'context',
      name: 'Task',
      parents: [{ context: 'context.team', relation: 'relation.taskTeam' }],
    });
    recordAt(input, ['app']).contexts = ['context.task', 'context.team', 'context.ownedTeam'];
    expect(validateApplicationGraph(input)).toContainEqual({
      code: 'OXE3105',
      message:
        'Parent context role "context.team" must be listed before "context.task" in app.contexts.',
      path: '$.contexts[2].parents[0].context',
      semanticId: 'context.task',
    });

    recordAt(input, ['app']).contexts = ['context.team', 'context.ownedTeam', 'context.task'];
    recordAt(input, ['contexts', 0]).parents = [
      { context: 'context.task', relation: 'relation.taskTeam' },
    ];
    expect(validateApplicationGraph(input)).toContainEqual({
      code: 'OXE3106',
      message: 'Context hierarchy contains a cycle through "context.team".',
      path: '$.contexts[0].parents',
      semanticId: 'context.team',
    });
  });

  it('rejects invalid generated authentication routes and method duplication', () => {
    const input = todoFixture();
    const authentication = recordAt(input, ['app', 'authentication']);
    authentication.methods = ['emailPassword', 'emailPassword'];
    authentication.signInPath = '/tasks';
    authentication.signUpPath = 'sign-up?next=/tasks';

    const diagnostics = validateApplicationGraph(input);
    expect(diagnostics).toContainEqual({
      code: 'OXE3105',
      message: 'Authentication method "emailPassword" is declared more than once.',
      path: '$.app.authentication.methods[1]',
      semanticId: 'app.todo',
    });
    expect(diagnostics).toContainEqual({
      code: 'OXE3105',
      message: 'Authentication paths must use absolute URL-path syntax.',
      path: '$.app.authentication.signUpPath',
      semanticId: 'app.todo',
    });
    expect(diagnostics).toContainEqual({
      code: 'OXE3105',
      message: 'Generated authentication path "/tasks" conflicts with $.routes[0].path.',
      path: '$.app.authentication.signInPath',
      semanticId: 'app.todo',
    });
  });

  it('requires the configured authenticated landing route to enforce authentication', () => {
    const input = todoFixture();
    recordAt(input, ['routes', 0]).authentication = 'optional';

    expect(validateApplicationGraph(input)).toContainEqual({
      code: 'OXE3105',
      message: 'Authenticated landing route "route.tasks" must require authentication.',
      path: '$.app.authentication.authenticatedRoute',
      semanticId: 'app.todo',
    });
  });

  it('validates skeleton hint references, bounds, and inherited mode cycles', () => {
    const input = todoFixture();
    recordAt(input, ['views', 0, 'modes']).loading = {
      kind: 'generated',
      skeleton: {
        elements: { 'element.missing': { shape: 'text', width: 'short' } },
        rows: 9,
      },
      strategy: 'preserveStaticStructure',
    };
    const diagnostics = validateApplicationGraph(input);
    expect(diagnostics).toContainEqual({
      code: 'OXE3101',
      message: 'Skeleton rows must be between 1 and 8.',
      path: '$.views[0].modes.loading.skeleton.rows',
      semanticId: 'view.tasks',
    });

    recordAt(input, ['views', 0, 'modes', 'loading', 'skeleton']).rows = 3;
    expect(validateApplicationGraph(input)).toContainEqual({
      code: 'OXE3103',
      message: 'Semantic reference "element.missing" does not resolve.',
      path: '$.views[0].modes.loading.skeleton.elements["element.missing"]',
      semanticId: 'view.tasks',
    });

    recordAt(input, ['views', 0, 'modes']).loading = {
      from: 'view.tasks',
      kind: 'inherited',
    };
    expect(validateApplicationGraph(input)).toContainEqual({
      code: 'OXE3105',
      message: 'Inherited view mode cycle detected at "view.tasks".',
      path: '$.views[0].modes.loading',
      semanticId: 'view.tasks',
    });
  });

  it('produces the deterministic compact AI inspection projection', () => {
    const graph = loadApplicationGraph(todoFixture());
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

    const projection = projectCompactApplicationGraph(graph);
    expect(projection).toBe(compactTodo);
    expect(projectCompactApplicationGraph(reordered)).toBe(projection);
    expect(measureCompactApplicationProjection(projection)).toEqual({
      characters: compactTodo.length,
      lines: 61,
      utf8Bytes: Buffer.byteLength(compactTodo),
    });
  });
});
