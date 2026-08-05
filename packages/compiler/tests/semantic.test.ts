import { readFile } from 'node:fs/promises';

import {
  serializeUiGraph,
  validateUiGraph,
  type ComponentParameterNodeV1,
  type UiEdgeV1,
  type UiGraphV1,
} from '@oxe/graph';
import { describe, expect, it } from 'vitest';

import { analyzeSource, type AnalyzeResult } from '../src/index.js';

const counterModuleId = 'examples/counter/App.oxe';
const appId = `${counterModuleId}#component/App`;
const countId = `${appId}/binding/count`;
const doubledId = `${appId}/binding/doubled`;
const unchangedId = `${appId}/binding/unchanged`;
const incrementId = `${appId}/procedure/increment`;
const mainId = `${appId}/view/element[0]`;
const buttonId = `${mainId}/element[0]`;
const buttonTextId = `${buttonId}/text[0]`;
const doubledParagraphId = `${mainId}/element[1]`;
const doubledTextId = `${doubledParagraphId}/text[0]`;
const unchangedParagraphId = `${mainId}/element[2]`;
const unchangedTextId = `${unchangedParagraphId}/text[0]`;

const expectedCounterNodeIds = [
  appId,
  countId,
  doubledId,
  unchangedId,
  incrementId,
  mainId,
  buttonId,
  buttonTextId,
  doubledParagraphId,
  doubledTextId,
  unchangedParagraphId,
  unchangedTextId,
];

const counterUrl = new URL('../../../examples/counter/App.oxe', import.meta.url);
const compositionFeaturesModuleId = 'examples/composition-features/App.oxe';
const compositionFeaturesUrl = new URL(
  '../../../examples/composition-features/App.oxe',
  import.meta.url,
);

const requireGraph = (result: AnalyzeResult): UiGraphV1 => {
  expect(result.diagnostics).toEqual([]);
  if (!result.graph) {
    throw new Error('Expected semantic analysis to produce a graph.');
  }
  return result.graph;
};

const analyzeCounter = async (): Promise<UiGraphV1> => {
  const source = await readFile(counterUrl, 'utf8');
  return requireGraph(analyzeSource(source, counterModuleId, counterModuleId));
};

const edgeSignature = (edge: UiEdgeV1): string => {
  switch (edge.kind) {
    case 'child':
      return `child:${edge.from}:${edge.index}:${edge.to}`;
    case 'event':
      return `event:${edge.from}:${edge.authoredName}:${edge.event}:${edge.to}`;
    case 'owner':
      return `owner:${edge.from}:${edge.to}`;
    case 'prop':
      return `prop:${edge.mode}:${edge.from}:${edge.to}`;
    case 'spread-prop':
      return `spread-prop:${edge.from}:${edge.index}:${edge.to}`;
    case 'read':
      return `read:${edge.mode}:${edge.from}:${edge.to}`;
    case 'write':
      return `write:${edge.mode}:${edge.from}:${edge.to}`;
  }
};

const expectOnlySemanticDiagnostic = (
  source: string,
  code: AnalyzeResult['diagnostics'][number]['code'],
): AnalyzeResult => {
  const result = analyzeSource(source, 'failure.oxe', 'failure.oxe');
  expect(result.graph).toBeUndefined();
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([code]);
  return result;
};

describe('OXE semantic analysis', () => {
  it('turns authored server declarations into exact async RPC contracts', () => {
    const graph = requireGraph(
      analyzeSource(
        `export server readProject(id):
  project = database.projects.read(id)
  project

export App():
  project = readProject("p1")
  <h1>{project.name}
`,
        'projects.oxe',
        'projects.oxe',
        {
          capabilities: [
            {
              kind: 'async',
              name: 'database.projects.read',
              parameters: ['string'],
              parameterSchemas: [{ kind: 'string' }],
              returns: 'record',
              returnSchema: {
                fields: [
                  { name: 'id', schema: { kind: 'string' } },
                  { name: 'name', schema: { kind: 'string' } },
                ],
                kind: 'record',
              },
              target: 'server',
            },
          ],
        },
      ),
    );

    expect(graph.serverFunctions).toEqual([
      expect.objectContaining({
        mode: 'query',
        moduleId: 'projects.oxe',
        name: 'readProject',
        parameters: [{ name: 'id', schema: { kind: 'string' } }],
        returns: {
          fields: [
            { name: 'id', schema: { kind: 'string' } },
            { name: 'name', schema: { kind: 'string' } },
          ],
          kind: 'record',
        },
        schemaVersion: 'oxe.server-function.v1',
      }),
    ]);
    const definition = graph.serverFunctions?.[0];
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'platform-capability',
          serverFunctionId: definition?.id,
          target: 'universal',
        }),
        expect.objectContaining({ kind: 'async-resource', name: 'project', type: 'record' }),
      ]),
    );
  });

  it('keeps server bodies sequential and rejects client-only capability calls', () => {
    const result = analyzeSource(
      `server saveProject(id: string):
  saved = browserStorage.save(id)
  saved

App():
  <p>Static
`,
      'server-errors.oxe',
      'server-errors.oxe',
      {
        capabilities: [
          {
            kind: 'async',
            name: 'browserStorage.save',
            parameters: ['string'],
            returns: 'string',
            target: 'client',
          },
        ],
      },
    );

    expect(result.graph).toBeUndefined();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'OXE2008',
        message: 'Client-only capability "browserStorage.save" cannot run in a server function.',
      }),
    ]);
  });

  it('consumes localization metadata without emitting a DOM attribute', () => {
    const graph = requireGraph(
      analyzeSource(
        `App():
  name = "Ada"
  count = 2
  <main>
    <h1 i18n={{ key: "home.greeting", count: count }}>Hello {name}
    <code i18n={false}>pnpm oxe i18n sync
`,
        'localization.oxe',
        'localization.oxe',
      ),
    );
    const elements = graph.nodes.filter((node) => node.kind === 'element');

    expect(elements.flatMap((element) => element.staticAttributes)).not.toContainEqual(
      expect.objectContaining({ name: 'i18n' }),
    );
    expect(elements.flatMap((element) => element.dynamicAttributes)).not.toContainEqual(
      expect.objectContaining({ name: 'i18n' }),
    );
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        kind: 'text',
        localization: expect.objectContaining({
          key: 'home.greeting',
          selection: expect.objectContaining({ kind: 'cardinal' }),
          source: 'Hello {name}',
          values: [expect.objectContaining({ name: 'name' })],
        }),
      }),
    );
    expect(
      graph.nodes
        .filter((node) => node.kind === 'text')
        .find((node) =>
          node.parts.some((part) => part.kind === 'static' && part.value.includes('pnpm')),
        )?.localization,
    ).toBeUndefined();

    expectOnlySemanticDiagnostic(
      `App():
  <p i18n={true}>Invalid metadata
`,
      'OXE2008',
    );
  });

  it('lowers automatic prose, attributes, and reorderable inline markup', () => {
    const graph = requireGraph(
      analyzeSource(
        `App(name = "Ada"):
  total = 10
  <main>
    <p>Read
      <strong>{name}
    <input placeholder={"Search stories"}>
    <data i18n={{ format: { type: "currency", currency: "USD" } }}>{total}
`,
        'automatic-localization.oxe',
        'automatic-localization.oxe',
        { localization: true },
      ),
    );
    const localizedText = graph.nodes.find(
      (node) => node.kind === 'text' && node.localization?.source.includes('<strong>'),
    );
    const input = graph.nodes.find((node) => node.kind === 'element' && node.tag === 'input');
    const formatted = graph.nodes.find((node) => node.kind === 'text' && node.format);

    expect(localizedText).toMatchObject({
      kind: 'text',
      localization: {
        markup: [expect.objectContaining({ name: 'strong', tag: 'strong' })],
        source: 'Read<strong>{name}</strong>',
        values: [expect.objectContaining({ name: 'name' })],
      },
    });
    expect(input).toMatchObject({
      kind: 'element',
      dynamicAttributes: [
        expect.objectContaining({
          name: 'placeholder',
          localization: expect.objectContaining({ source: 'Search stories' }),
        }),
      ],
    });
    expect(formatted).toMatchObject({
      kind: 'text',
      format: {
        options: [expect.objectContaining({ name: 'currency' })],
        type: 'currency',
        value: expect.objectContaining({ kind: 'read' }),
      },
    });
    expect(validateUiGraph(graph)).toEqual([]);
  });

  it('resolves context providers and consumers while preserving writable record paths', () => {
    const moduleId = 'context.oxe';
    const graph = requireGraph(
      analyzeSource(
        `SessionContext = createContext()

App():
  session = { name: "Ada", role: "admin" }
  <SessionContext value={session}>
    <Header>

Header():
  session = SessionContext()
  rename():
    session.name = "Grace"
  <button onClick={rename}>{session.name}
`,
        moduleId,
        moduleId,
      ),
    );

    expect(validateUiGraph(graph)).toEqual([]);
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'context', name: 'SessionContext' }),
        expect.objectContaining({ kind: 'context-provider' }),
        expect.objectContaining({
          kind: 'context-consumer',
          name: 'session',
          type: 'record',
          writable: true,
        }),
      ]),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: 'write',
        accesses: [expect.objectContaining({ path: ['name'] })],
      }),
    );
  });

  it('diagnoses missing providers without imposing a naming suffix', () => {
    const missing = expectOnlySemanticDiagnostic(
      `SessionContext = createContext()

App():
  session = SessionContext()
  <p>{session.name}
`,
      'OXE2008',
    );
    expect(missing.diagnostics[0]?.message).toContain('No provider exists for SessionContext');

    const graph = requireGraph(
      analyzeSource(
        `Session = createContext()

App():
  value = "ready"
  <Session value={value}>
    <Status>

Status():
  current = Session()
  <p>{current}
`,
        'context-name.oxe',
        'context-name.oxe',
      ),
    );
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({ kind: 'context', name: 'Session' }),
    );
  });

  it('types external platform capabilities and records their target contracts', () => {
    const result = analyzeSource(
      `App():
  userId = "user-1"
  label = formatter.label(userId)
  analytics.identify(userId)
  <p>{label}
`,
      'platform.oxe',
      'platform.oxe',
      {
        target: 'client',
        capabilities: [
          {
            kind: 'pure',
            name: 'formatter.label',
            parameters: ['string'],
            returns: 'string',
            target: 'universal',
          },
          {
            kind: 'effect',
            name: 'analytics.identify',
            parameters: ['string'],
            target: 'client',
          },
        ],
      },
    );
    const graph = requireGraph(result);
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'platform-capability',
          path: ['formatter', 'label'],
          returns: 'string',
        }),
        expect.objectContaining({
          capabilityKind: 'effect',
          kind: 'platform-capability',
          path: ['analytics', 'identify'],
          target: 'client',
        }),
        expect.objectContaining({ kind: 'computed', name: 'label', type: 'string' }),
      ]),
    );
  });

  it('rejects platform type/target mismatches and competing declarative writers', () => {
    const typed = analyzeSource(
      `App():
  analytics.identify(1)
  <main>
`,
      'platform-errors.oxe',
      'platform-errors.oxe',
      {
        target: 'server',
        capabilities: [
          {
            kind: 'effect',
            name: 'analytics.identify',
            parameters: ['string'],
            target: 'client',
          },
        ],
      },
    );
    expect(typed.graph).toBeUndefined();
    expect(typed.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('client-only'),
        expect.stringContaining('must be string'),
      ]),
    );

    const writers = analyzeSource(
      `App():
  first = "A"
  second = "B"
  document.setTitle(first)
  document.setTitle(second)
  <main>
`,
      'writers.oxe',
      'writers.oxe',
      {
        capabilities: [
          {
            kind: 'effect',
            name: 'document.setTitle',
            parameters: ['string'],
            target: 'client',
            writes: 'document.title',
          },
        ],
      },
    );
    expect(writers.graph).toBeUndefined();
    expect(writers.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'OXE2007',
        message: expect.stringContaining('Multiple persistent relationships write'),
      }),
    );
  });

  it('requires explicit disposal metadata for external resources', () => {
    const invalid = analyzeSource(
      `App():
  connection = messages.subscribe("general")
  <main>
`,
      'resource.oxe',
      'resource.oxe',
      {
        capabilities: [{ kind: 'resource', name: 'messages.subscribe', parameters: ['string'] }],
      },
    );
    expect(invalid.graph).toBeUndefined();
    expect(invalid.diagnostics[0]?.message).toContain('must declare dispose');

    const graph = requireGraph(
      analyzeSource(
        `App():
  room = "general"
  connection = messages.subscribe(room)
  <main>
`,
        'resource.oxe',
        'resource.oxe',
        {
          capabilities: [
            {
              dispose: 'dispose',
              kind: 'resource',
              name: 'messages.subscribe',
              parameters: ['string'],
            },
          ],
        },
      ),
    );
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({ kind: 'resource', name: 'connection' }),
    );
  });

  it('introduces platform element refs as compiler-owned reactive values', () => {
    const graph = requireGraph(
      analyzeSource(
        `App():
  focus():
    field.focus()
  <main>
    <input ref={field}>
    <button onClick={focus}>Focus
`,
        'ref.oxe',
        'ref.oxe',
      ),
    );
    expect(graph.nodes).toContainEqual(expect.objectContaining({ kind: 'ref', name: 'field' }));
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({ kind: 'procedure', name: 'focus' }),
    );
  });

  it('records conditional branches, dependencies, and structural children in the graph', () => {
    const graph = requireGraph(
      analyzeSource(
        `App():
  visible = true
  hide():
    visible = false
  <main>
    ?
      visible ? <section>Visible
      : <p>Hidden
`,
        'conditional.oxe',
        'conditional.oxe',
      ),
    );

    const region = graph.nodes.find((node) => node.kind === 'conditional-region');
    expect(region).toMatchObject({
      kind: 'conditional-region',
      branches: [{ condition: { kind: 'read' } }, {}],
    });
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: 'read',
        from: region?.id,
        to: 'conditional.oxe#component/App/binding/visible',
        mode: 'reactive',
      }),
    );
    expect(validateUiGraph(graph)).toEqual([]);
  });

  it('lowers exhaustive conditional values with reactive conditions and typed results', () => {
    const graph = requireGraph(
      analyzeSource(
        `App():
  visible = true
  hide():
    visible = false
  label =?
    visible ? "Visible"
    : "Hidden"
  compact = visible ? "Yes" : "No"
  <main>
    <button onClick={hide}>{label}: {compact}
`,
        'conditional-value.oxe',
        'conditional-value.oxe',
      ),
    );

    const label = graph.nodes.find((node) => node.kind === 'computed' && node.name === 'label');
    const compact = graph.nodes.find((node) => node.kind === 'computed' && node.name === 'compact');
    expect(label).toMatchObject({
      kind: 'computed',
      type: 'string',
      expression: {
        kind: 'conditional',
        branches: [
          { condition: { kind: 'read' }, result: { kind: 'literal', value: 'Visible' } },
          { result: { kind: 'literal', value: 'Hidden' } },
        ],
      },
    });
    expect(compact).toMatchObject({
      kind: 'computed',
      type: 'string',
      expression: { kind: 'conditional' },
    });
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: 'read',
        from: label?.id,
        to: 'conditional-value.oxe#component/App/binding/visible',
        mode: 'reactive',
      }),
    );
    expect(validateUiGraph(graph)).toEqual([]);
  });

  it('requires Boolean conditional value conditions and matching branch result types', () => {
    const condition = expectOnlySemanticDiagnostic(
      `App():
  label = 1 ? "Yes" : "No"
  <p>{label}
`,
      'OXE2009',
    );
    expect(condition.diagnostics[0]?.message).toBe(
      'A conditional value condition must be Boolean, but received number.',
    );

    const branches = expectOnlySemanticDiagnostic(
      `App():
  label = true ? "Yes" : 0
  <p>{label}
`,
      'OXE2009',
    );
    expect(branches.diagnostics[0]?.message).toBe(
      'Conditional value branches must share one type, but received string and number.',
    );
  });

  it('models a keyed map source, item binding, key, and row template explicitly', () => {
    const graph = requireGraph(
      analyzeSource(
        `App():
  items = ["A", "B"]
  reorder():
    items = ["B", "C"]
  <ul>
    {items.map(item => <li key={item}>{item})}
`,
        'keyed.oxe',
        'keyed.oxe',
      ),
    );

    const collection = graph.nodes.find((node) => node.kind === 'keyed-collection');
    const item = graph.nodes.find((node) => node.kind === 'collection-item');
    expect(collection).toMatchObject({
      kind: 'keyed-collection',
      source: { kind: 'read', targetId: 'keyed.oxe#component/App/binding/items' },
      key: { kind: 'read', targetId: item?.id },
      itemId: item?.id,
    });
    expect(item).toMatchObject({ kind: 'collection-item', name: 'item', type: 'string' });
    expect(validateUiGraph(graph)).toEqual([]);
  });

  it('retains untracked reads in expressions while excluding their dependency edge', () => {
    const graph = requireGraph(
      analyzeSource(
        `App():
  count = 0
  snapshot = untrack(count)
  increment():
    count = count + 1
  <p>{snapshot}
`,
        'snapshot.oxe',
        'snapshot.oxe',
      ),
    );
    const snapshot = graph.nodes.find(
      (node) => node.kind === 'computed' && node.name === 'snapshot',
    );
    expect(snapshot).toMatchObject({
      kind: 'computed',
      expression: { kind: 'read', tracked: false },
    });
    expect(graph.edges.some((edge) => edge.kind === 'read' && edge.from === snapshot?.id)).toBe(
      false,
    );
    expect(validateUiGraph(graph)).toEqual([]);
  });

  it('requires at least one component before emitting a UI graph', () => {
    const result = expectOnlySemanticDiagnostic('', 'OXE2008');

    expect(result.diagnostics[0]).toMatchObject({
      message: 'An OXE UI module must declare at least one component.',
      span: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
    });
  });

  it('builds the counter graph with exact stable ids, classifications, and edge modes', async () => {
    const graph = await analyzeCounter();

    expect(graph).toMatchObject({
      schemaVersion: 'oxe.ui-graph.v1',
      moduleId: counterModuleId,
      entryComponents: [appId],
    });
    expect(graph.nodes.map((node) => node.id)).toEqual(expectedCounterNodeIds);
    expect(Object.fromEntries(graph.nodes.map((node) => [node.id, node.kind]))).toEqual({
      [appId]: 'component',
      [countId]: 'cell',
      [doubledId]: 'computed',
      [unchangedId]: 'constant',
      [incrementId]: 'procedure',
      [mainId]: 'element',
      [buttonId]: 'element',
      [buttonTextId]: 'text',
      [doubledParagraphId]: 'element',
      [doubledTextId]: 'text',
      [unchangedParagraphId]: 'element',
      [unchangedTextId]: 'text',
    });

    expect(graph.nodes.find((node) => node.id === countId)).toMatchObject({
      kind: 'cell',
      name: 'count',
      type: 'number',
      initial: { kind: 'literal', value: 0 },
    });
    expect(graph.nodes.find((node) => node.id === doubledId)).toMatchObject({
      kind: 'computed',
      name: 'doubled',
      type: 'number',
      expression: {
        kind: 'binary',
        operator: '*',
        left: { kind: 'read', targetId: countId },
        right: { kind: 'literal', value: 2 },
      },
    });
    expect(graph.nodes.find((node) => node.id === unchangedId)).toMatchObject({
      kind: 'constant',
      name: 'unchanged',
      type: 'string',
      value: 'Static',
    });

    const edgeCounts = graph.edges.reduce<Record<UiEdgeV1['kind'], number>>(
      (counts, edge) => ({ ...counts, [edge.kind]: counts[edge.kind] + 1 }),
      { child: 0, event: 0, owner: 0, prop: 0, read: 0, 'spread-prop': 0, write: 0 },
    );
    expect(edgeCounts).toEqual({
      child: 7,
      event: 1,
      owner: 0,
      prop: 0,
      read: 5,
      'spread-prop': 0,
      write: 1,
    });

    const readModes = graph.edges
      .filter((edge): edge is Extract<UiEdgeV1, { kind: 'read' }> => edge.kind === 'read')
      .reduce<Record<'procedural' | 'reactive', number>>(
        (counts, edge) => ({ ...counts, [edge.mode]: counts[edge.mode] + 1 }),
        { procedural: 0, reactive: 0 },
      );
    expect(readModes).toEqual({ procedural: 1, reactive: 4 });
    expect(graph.edges.filter((edge) => edge.kind === 'write').map((edge) => edge.mode)).toEqual([
      'procedural',
    ]);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: 'event',
        from: buttonId,
        to: incrementId,
        authoredName: 'onClick',
        event: 'click',
      }),
    );
  });

  it('serializes repeated and reordered analysis output deterministically', async () => {
    const first = await analyzeCounter();
    const second = await analyzeCounter();
    const reordered: UiGraphV1 = {
      ...second,
      entryComponents: [...second.entryComponents].reverse(),
      nodes: [...second.nodes].reverse(),
      edges: [...second.edges].reverse(),
    };

    const serialized = serializeUiGraph(first);
    expect(serialized).toBe(serializeUiGraph(second));
    expect(serialized).toBe(serializeUiGraph(reordered));
    expect((JSON.parse(serialized) as UiGraphV1).nodes.map((node) => node.id)).toEqual(
      expectedCounterNodeIds,
    );
  });

  it('models immutable record writes and collection mutations as procedural cell writes', () => {
    const moduleId = 'collections.oxe';
    const componentId = `${moduleId}#component/App`;
    const usersId = `${componentId}/binding/users`;
    const graph = requireGraph(
      analyzeSource(
        `export App():
  users = [{ id: 1, name: "Ada", active: false }, { id: 2, name: "Lin", active: true }]
  profile = { name: "Ada", address: { city: "London" } }
  ordered = users.sort(user => user.name, { descending: true })
  change():
    users.add({ id: 3, name: "Grace", active: true })
    users.update(user => user.active == false, user => user.name = "Chris", 1)
    users.remove(user => user.active == false, 1)
    profile.address.city = "New York"
  <button onClick={change}>{ordered.length}: {profile.address.city}
`,
        moduleId,
        moduleId,
      ),
    );

    expect(validateUiGraph(graph)).toEqual([]);
    expect(graph.nodes.find((node) => node.id === usersId)).toMatchObject({
      kind: 'cell',
      name: 'users',
      type: 'array',
    });
    expect(
      graph.nodes.find((node) => node.kind === 'computed' && node.name === 'ordered'),
    ).toMatchObject({
      expression: { kind: 'collection', operation: 'sort', options: { kind: 'record' } },
    });
    const procedure = graph.nodes.find(
      (node) => node.kind === 'procedure' && node.name === 'change',
    );
    expect(procedure).toMatchObject({
      kind: 'procedure',
      steps: [
        { kind: 'collection-mutation', operation: 'add', targetId: usersId },
        {
          kind: 'collection-mutation',
          operation: 'update',
          targetId: usersId,
          predicate: { parameters: [{ name: 'user' }] },
          updater: { result: { kind: 'record' } },
          limit: { kind: 'literal', value: 1 },
        },
        { kind: 'collection-mutation', operation: 'remove', targetId: usersId },
        {
          kind: 'write',
          path: ['address', 'city'],
          value: { kind: 'literal', value: 'New York' },
        },
      ],
    });
    expect(
      graph.edges.filter(
        (edge) => edge.kind === 'write' && edge.from === `${componentId}/procedure/change`,
      ),
    ).toHaveLength(2);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: 'write',
        from: `${componentId}/procedure/change`,
        to: `${componentId}/binding/profile`,
        accesses: [expect.objectContaining({ path: ['address', 'city'] })],
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: 'read',
        to: `${componentId}/binding/profile`,
        accesses: [expect.objectContaining({ path: ['address', 'city'] })],
      }),
    );
  });

  it('diagnoses invalid collection limits and record field updates', () => {
    const limit = expectOnlySemanticDiagnostic(
      `App():
  users = [{ id: 1 }]
  remove():
    users.remove(user => user.id == 1, 0 - 1)
  <button onClick={remove}>{users.length}
`,
      'OXE2009',
    );
    expect(limit.diagnostics[0]?.message).toBe(
      'A collection mutation limit must be a nonnegative integer.',
    );

    const field = expectOnlySemanticDiagnostic(
      `App():
  profile = { name: "Ada" }
  rename():
    profile.name = 1
  <button onClick={rename}>{profile.name}
`,
      'OXE2009',
    );
    expect(field.diagnostics[0]?.message).toBe(
      'Cannot assign number to string record field "name".',
    );
  });

  it('models defaults, final rest props, component spreads, and implicit children explicitly', async () => {
    const source = await readFile(compositionFeaturesUrl, 'utf8');
    const graph = requireGraph(
      analyzeSource(source, compositionFeaturesModuleId, compositionFeaturesModuleId),
    );
    const componentId = (name: string): string =>
      `${compositionFeaturesModuleId}#component/${name}`;
    const parameterId = (component: string, name: string): string =>
      `${componentId(component)}/parameter/${name}`;
    const parametersFor = (component: string): readonly ComponentParameterNodeV1[] => {
      const ownerId = componentId(component);
      return graph.nodes.filter(
        (node): node is ComponentParameterNodeV1 =>
          node.kind === 'component-parameter' && node.ownerId === ownerId,
      );
    };

    expect(validateUiGraph(graph)).toEqual([]);
    expect(graph.entryComponents).toEqual([componentId('App')]);
    expect(
      graph.nodes
        .filter((node) => node.kind === 'component')
        .map((node) => [node.name, node.parameters]),
    ).toEqual([
      ['App', []],
      [
        'Card',
        [
          parameterId('Card', 'title'),
          parameterId('Card', 'subtitle'),
          parameterId('Card', 'children'),
          parameterId('Card', 'props'),
        ],
      ],
      [
        'Wrapper',
        [
          parameterId('Wrapper', 'title'),
          parameterId('Wrapper', 'children'),
          parameterId('Wrapper', 'props'),
        ],
      ],
    ]);
    expect(
      parametersFor('Wrapper').map(({ name, parameterKind, index }) => ({
        index,
        name,
        parameterKind,
      })),
    ).toEqual([
      { index: 1, name: 'children', parameterKind: 'children' },
      { index: 2, name: 'props', parameterKind: 'rest' },
      { index: 0, name: 'title', parameterKind: 'value' },
    ]);
    expect(
      parametersFor('Card').map(({ name, parameterKind, index }) => ({
        index,
        name,
        parameterKind,
      })),
    ).toEqual([
      { index: 2, name: 'children', parameterKind: 'children' },
      { index: 3, name: 'props', parameterKind: 'rest' },
      { index: 1, name: 'subtitle', parameterKind: 'value' },
      { index: 0, name: 'title', parameterKind: 'value' },
    ]);

    expect(graph.nodes.find((node) => node.id === parameterId('Card', 'subtitle'))).toMatchObject({
      kind: 'component-parameter',
      parameterKind: 'value',
      type: 'string',
      default: { kind: 'read', targetId: parameterId('Card', 'title') },
    });
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: 'read',
        from: parameterId('Card', 'subtitle'),
        to: parameterId('Card', 'title'),
        mode: 'reactive',
      }),
    );

    const wrapperInstanceId = `${componentId('App')}/view/element[0]/instance[1]`;
    const cardInstanceId = `${componentId('Wrapper')}/view/instance[0]`;
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: 'prop',
        from: wrapperInstanceId,
        to: parameterId('Wrapper', 'props'),
        index: 1,
        authoredName: 'tone',
        mode: 'reactive',
        value: expect.objectContaining({ kind: 'literal', value: 'quiet' }),
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: 'spread-prop',
        from: cardInstanceId,
        to: parameterId('Card', 'props'),
        index: 1,
        source: expect.objectContaining({
          kind: 'rest',
          targetId: parameterId('Wrapper', 'props'),
        }),
      }),
    );

    expect(
      graph.nodes.filter((node) => node.kind === 'content-slot').map((node) => node.parameterId),
    ).toEqual([parameterId('Card', 'children'), parameterId('Wrapper', 'children')]);
    expect(
      graph.edges.filter(
        (edge) =>
          edge.kind === 'child' &&
          (edge.from === wrapperInstanceId || edge.from === cardInstanceId),
      ),
    ).toEqual([
      expect.objectContaining({ from: wrapperInstanceId, index: 0 }),
      expect.objectContaining({ from: cardInstanceId, index: 0 }),
    ]);
  });

  it('preserves semantic ids and topology across whitespace and comments', async () => {
    const original = await analyzeCounter();
    const reformatted = requireGraph(
      analyzeSource(
        `App():

  // Writable state
  count    =    0

  doubled = count   *   2
  // This value is folded at compile time.
  unchanged = "Static"

  increment():
    // Handler writes are procedural.
    count = count + 1

  <main>
    <button   onClick={increment}>Count: {count}

    // Comments do not become render children.
    <p>Doubled: {doubled}
    <p>{unchanged}
`,
        counterModuleId,
        counterModuleId,
      ),
    );

    expect(reformatted.nodes.map((node) => node.id)).toEqual(original.nodes.map((node) => node.id));
    expect(reformatted.edges.map(edgeSignature)).toEqual(original.edges.map(edgeSignature));
  });

  it('reports an unresolved identifier with OXE2002 and omits the graph', () => {
    const result = expectOnlySemanticDiagnostic(
      `App():
  value = missing + 1
  <p>{value}
`,
      'OXE2002',
    );

    expect(result.diagnostics[0]).toMatchObject({
      message: 'Cannot resolve "missing" in component "App".',
      span: { start: { line: 2, column: 11 }, end: { line: 2, column: 18 } },
    });
  });

  it('rejects non-finite numeric literals before they enter the graph', () => {
    const hugeNumber = '9'.repeat(400);
    const result = expectOnlySemanticDiagnostic(
      `App():
  value = ${hugeNumber}
  <p>{value}
`,
      'OXE2009',
    );

    expect(result.diagnostics[0]).toMatchObject({
      message: 'Numeric literals must produce a finite number.',
      span: { start: { line: 2, column: 11 } },
    });
  });

  it('reports a reactive dependency cycle with OXE2004 and omits the graph', () => {
    const result = expectOnlySemanticDiagnostic(
      `App():
  first = second + 1
  second = first + 1
  <p>{first}
`,
      'OXE2004',
    );

    expect(result.diagnostics[0]).toMatchObject({
      message: 'Reactive cycle detected: first -> second -> first.',
      span: { start: { line: 2, column: 11 }, end: { line: 2, column: 21 } },
    });
  });

  it('reports a non-procedure event target with OXE2006 and omits the graph', () => {
    const result = expectOnlySemanticDiagnostic(
      `App():
  count = 0
  <button onClick={count}>Count: {count}
`,
      'OXE2006',
    );

    expect(result.diagnostics[0]).toMatchObject({
      message: 'onClick requires a procedure, but "count" is not one.',
      span: { start: { line: 3, column: 20 }, end: { line: 3, column: 25 } },
    });
  });

  it('reports a procedural write type mismatch with OXE2009 and omits the graph', () => {
    const result = expectOnlySemanticDiagnostic(
      `App():
  count = 0
  change():
    count = "wrong"
  <button onClick={change}>{count}
`,
      'OXE2009',
    );

    expect(result.diagnostics[0]).toMatchObject({
      message: 'Cannot assign string to number cell "count".',
      span: { start: { line: 4, column: 13 }, end: { line: 4, column: 20 } },
    });
  });

  it('type-checks operators inside procedural values and markup interpolations', () => {
    const procedure = expectOnlySemanticDiagnostic(
      `App():
  count = 0
  change():
    count = "left" - "right"
  <button onClick={change}>{count}
`,
      'OXE2009',
    );
    expect(procedure.diagnostics[0]?.message).toBe(
      'Operator - requires numbers, but received string and string.',
    );

    const markup = expectOnlySemanticDiagnostic(
      `App():
  <p>{"left" - "right"}
`,
      'OXE2009',
    );
    expect(markup.diagnostics[0]?.message).toBe(
      'Operator - requires numbers, but received string and string.',
    );
  });

  it('rejects statically non-finite arithmetic in cells, procedures, and markup', () => {
    const cell = expectOnlySemanticDiagnostic(
      `App():
  count = 1 / 0
  change():
    count = 2
  <button onClick={change}>{count}
`,
      'OXE2009',
    );
    expect(cell.diagnostics[0]?.message).toBe(
      'A compile-time numeric expression must produce a finite number.',
    );

    const procedure = expectOnlySemanticDiagnostic(
      `App():
  count = 0
  change():
    count = 1 / 0
  <button onClick={change}>{count}
`,
      'OXE2009',
    );
    expect(procedure.diagnostics[0]?.message).toBe(
      'A compile-time numeric expression must produce a finite number.',
    );

    const markup = expectOnlySemanticDiagnostic(
      `App():
  <p>{1 / 0}
`,
      'OXE2009',
    );
    expect(markup.diagnostics[0]?.message).toBe(
      'A compile-time numeric expression must produce a finite number.',
    );
  });

  it('reports a duplicate declaration and points back to the first declaration', () => {
    const result = expectOnlySemanticDiagnostic(
      `App():
  count = 0
  count = 1
  <p>{count}
`,
      'OXE2001',
    );

    expect(result.diagnostics[0]).toMatchObject({
      message: 'Duplicate declaration "count".',
      span: { start: { line: 3, column: 3 }, end: { line: 3, column: 8 } },
      related: [
        {
          message: 'The first declaration is here.',
          span: { start: { line: 2, column: 3 }, end: { line: 2, column: 8 } },
        },
      ],
    });
  });

  it('reserves Boolean literal spellings instead of creating unreachable declarations', () => {
    const result = expectOnlySemanticDiagnostic(
      `App():
  true = 1
  <p>{true}
`,
      'OXE2008',
    );

    expect(result.diagnostics[0]).toMatchObject({
      message: 'Declaration name "true" is reserved for a Boolean literal.',
      span: { start: { line: 2, column: 3 }, end: { line: 2, column: 7 } },
    });
  });

  it('reports a mutable reactive initializer with OXE2007 and omits the graph', () => {
    const result = expectOnlySemanticDiagnostic(
      `App():
  base = 0
  value = base + 1
  change():
    base = base + 1
    value = value + 1
  <button onClick={change}>{value}
`,
      'OXE2007',
    );

    expect(result.diagnostics[0]).toMatchObject({
      message: 'Mutable value "value" cannot yet have a reactive initializer.',
      span: { start: { line: 3, column: 11 }, end: { line: 3, column: 19 } },
    });
  });

  it('rejects a non-finite compile-time attribute before graph serialization', () => {
    const result = expectOnlySemanticDiagnostic(
      `App():
  <progress max={1 / 0}>
`,
      'OXE2009',
    );

    expect(result.diagnostics[0]).toMatchObject({
      message: 'Attribute "max" must produce a finite number.',
      span: { start: { line: 2, column: 18 }, end: { line: 2, column: 23 } },
    });
  });

  it('canonicalizes relative module ids and rejects paths outside the project', () => {
    const source = `App():
  <main>
`;
    const canonical = requireGraph(analyzeSource(source, 'App.oxe', 'counter/App.oxe'));
    const equivalent = requireGraph(
      analyzeSource(source, 'App.oxe', '././counter/../counter/App.oxe'),
    );

    expect(equivalent.moduleId).toBe('counter/App.oxe');
    expect(equivalent.nodes.map((node) => node.id)).toEqual(canonical.nodes.map((node) => node.id));
    expect(() => analyzeSource(source, 'App.oxe', '../counter/App.oxe')).toThrow(
      'cannot escape the project root',
    );
    expect(() => analyzeSource(source, 'App.oxe', '/counter/App.oxe')).toThrow(
      'must be project-relative',
    );
  });
});
