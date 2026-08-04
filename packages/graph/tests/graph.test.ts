import { describe, expect, it } from 'vitest';

import {
  serializeUiGraph,
  validateUiGraph,
  type GraphSpanV1,
  type UiEdgeV1,
  type UiGraphV1,
} from '../src/index.js';

const span: GraphSpanV1 = {
  fileName: 'counter.oxe',
  start: { column: 1, line: 1, offset: 0 },
  end: { column: 2, line: 1, offset: 1 },
};

const componentId = 'counter.oxe#component/App';
const countId = `${componentId}/binding/count`;
const doubledId = `${componentId}/binding/doubled`;
const incrementId = `${componentId}/procedure/increment`;
const mainId = `${componentId}/view/element[0]`;
const textId = `${mainId}/text[0]`;
const counterComponentId = 'counter.oxe#component/Counter';
const counterCountParameterId = `${counterComponentId}/parameter/count`;
const counterIncrementParameterId = `${counterComponentId}/parameter/onIncrement`;
const counterInstanceId = `${componentId}/view/component[0]`;
const counterButtonId = `${counterComponentId}/view/element[0]`;
const counterTextId = `${counterButtonId}/text[0]`;
const counterStepParameterId = `${counterComponentId}/parameter/step`;
const counterChildrenParameterId = `${counterComponentId}/parameter/children`;
const counterRestParameterId = `${counterComponentId}/parameter/props`;
const appRestParameterId = `${componentId}/parameter/props`;
const counterContentSlotId = `${counterButtonId}/content-slot[0]`;
const passedContentId = `${counterInstanceId}/text[0]`;

const spanAt = (offset: number): GraphSpanV1 => ({
  fileName: 'counter.oxe',
  start: { column: offset + 1, line: 1, offset },
  end: { column: offset + 2, line: 1, offset: offset + 1 },
});

const graph = (): UiGraphV1 => ({
  schemaVersion: 'oxe.ui-graph.v1',
  moduleId: 'counter.oxe',
  entryComponents: [componentId],
  nodes: [
    {
      id: mainId,
      kind: 'element',
      tag: 'main',
      staticAttributes: [],
      span,
    },
    {
      id: countId,
      kind: 'cell',
      name: 'count',
      type: 'number',
      initial: { kind: 'literal', value: 0, span },
      span,
    },
    {
      id: componentId,
      kind: 'component',
      name: 'App',
      parameters: [],
      span,
    },
  ],
  edges: [{ kind: 'child', from: componentId, to: mainId, index: 0 }],
});

const dataflowGraph = (): UiGraphV1 => {
  const input = graph();
  const computedReadSpan = spanAt(10);
  const procedureReadSpan = spanAt(20);
  const writeSpan = spanAt(30);
  const textReadSpan = spanAt(40);

  return {
    ...input,
    nodes: [
      ...input.nodes,
      {
        id: doubledId,
        kind: 'computed',
        name: 'doubled',
        type: 'number',
        expression: { kind: 'read', targetId: countId, span: computedReadSpan },
        span: spanAt(9),
      },
      {
        id: incrementId,
        kind: 'procedure',
        name: 'increment',
        parameters: [],
        steps: [
          {
            kind: 'write',
            targetId: countId,
            value: { kind: 'read', targetId: countId, span: procedureReadSpan },
            span: writeSpan,
          },
        ],
        span: spanAt(19),
      },
      {
        id: textId,
        kind: 'text',
        parts: [
          {
            kind: 'expression',
            expression: { kind: 'read', targetId: countId, span: textReadSpan },
            span: textReadSpan,
          },
        ],
        span: spanAt(39),
      },
    ],
    edges: [
      ...input.edges,
      { kind: 'child', from: mainId, to: textId, index: 0 },
      {
        kind: 'read',
        from: doubledId,
        to: countId,
        mode: 'reactive',
        sites: [computedReadSpan],
      },
      {
        kind: 'read',
        from: incrementId,
        to: countId,
        mode: 'procedural',
        sites: [procedureReadSpan],
      },
      {
        kind: 'write',
        from: incrementId,
        to: countId,
        mode: 'procedural',
        sites: [writeSpan],
      },
      {
        kind: 'read',
        from: textId,
        to: countId,
        mode: 'reactive',
        sites: [textReadSpan],
      },
    ],
  };
};

const compositionGraph = (): UiGraphV1 => {
  const input = graph();
  const propReadSpan = spanAt(60);
  const textReadSpan = spanAt(70);

  return {
    ...input,
    nodes: [
      ...input.nodes,
      {
        id: counterComponentId,
        kind: 'component',
        name: 'Counter',
        parameters: [counterCountParameterId, counterIncrementParameterId],
        span: spanAt(50),
      },
      {
        id: counterCountParameterId,
        kind: 'component-parameter',
        ownerId: counterComponentId,
        index: 0,
        name: 'count',
        parameterKind: 'value',
        type: 'number',
        span: spanAt(51),
      },
      {
        id: counterIncrementParameterId,
        kind: 'component-parameter',
        ownerId: counterComponentId,
        index: 1,
        name: 'onIncrement',
        parameterKind: 'procedure',
        span: spanAt(52),
      },
      {
        id: counterInstanceId,
        kind: 'component-instance',
        componentId: counterComponentId,
        span: spanAt(53),
      },
      {
        id: incrementId,
        kind: 'procedure',
        name: 'increment',
        parameters: [],
        steps: [],
        span: spanAt(54),
      },
      {
        id: counterButtonId,
        kind: 'element',
        tag: 'button',
        staticAttributes: [],
        span: spanAt(55),
      },
      {
        id: counterTextId,
        kind: 'text',
        parts: [
          {
            kind: 'expression',
            expression: { kind: 'read', targetId: counterCountParameterId, span: textReadSpan },
            span: textReadSpan,
          },
        ],
        span: spanAt(56),
      },
    ],
    edges: [
      ...input.edges,
      { kind: 'child', from: mainId, to: counterInstanceId, index: 0 },
      { kind: 'owner', from: componentId, to: counterInstanceId },
      {
        kind: 'prop',
        mode: 'reactive',
        from: counterInstanceId,
        to: counterCountParameterId,
        value: { kind: 'read', targetId: countId, span: propReadSpan },
        span: propReadSpan,
      },
      {
        kind: 'read',
        from: counterInstanceId,
        to: countId,
        mode: 'reactive',
        sites: [propReadSpan],
      },
      {
        kind: 'prop',
        mode: 'procedure',
        from: counterInstanceId,
        to: counterIncrementParameterId,
        targetId: incrementId,
        span: spanAt(61),
      },
      { kind: 'child', from: counterComponentId, to: counterButtonId, index: 0 },
      { kind: 'child', from: counterButtonId, to: counterTextId, index: 0 },
      {
        kind: 'event',
        from: counterButtonId,
        to: counterIncrementParameterId,
        authoredName: 'onClick',
        event: 'click',
        span: spanAt(62),
      },
      {
        kind: 'read',
        from: counterTextId,
        to: counterCountParameterId,
        mode: 'reactive',
        sites: [textReadSpan],
      },
    ],
  };
};

const extendedCompositionGraph = (): UiGraphV1 => {
  const input = compositionGraph();
  const defaultReadSpan = spanAt(80);
  const spreadSourceSpan = spanAt(89);
  const spreadSpan = spanAt(90);

  return {
    ...input,
    nodes: [
      ...input.nodes.map((node) => {
        if (node.id === componentId && node.kind === 'component') {
          return { ...node, parameters: [appRestParameterId] };
        }
        if (node.id === counterComponentId && node.kind === 'component') {
          return {
            ...node,
            parameters: [
              counterCountParameterId,
              counterIncrementParameterId,
              counterStepParameterId,
              counterChildrenParameterId,
              counterRestParameterId,
            ],
          };
        }
        return node;
      }),
      {
        id: appRestParameterId,
        kind: 'component-parameter',
        ownerId: componentId,
        index: 0,
        name: 'props',
        parameterKind: 'rest',
        span: spanAt(81),
      },
      {
        id: counterStepParameterId,
        kind: 'component-parameter',
        ownerId: counterComponentId,
        index: 2,
        name: 'step',
        parameterKind: 'value',
        type: 'number',
        default: { kind: 'read', targetId: counterCountParameterId, span: defaultReadSpan },
        span: spanAt(82),
      },
      {
        id: counterChildrenParameterId,
        kind: 'component-parameter',
        ownerId: counterComponentId,
        index: 3,
        name: 'children',
        parameterKind: 'children',
        span: spanAt(83),
      },
      {
        id: counterRestParameterId,
        kind: 'component-parameter',
        ownerId: counterComponentId,
        index: 4,
        name: 'props',
        parameterKind: 'rest',
        span: spanAt(84),
      },
      {
        id: counterContentSlotId,
        kind: 'content-slot',
        parameterId: counterChildrenParameterId,
        span: spanAt(85),
      },
      { id: passedContentId, kind: 'text', parts: [], span: spanAt(86) },
    ],
    edges: [
      ...input.edges.map((edge) => {
        if (edge.kind === 'prop' && edge.to === counterCountParameterId) {
          return { ...edge, authoredName: 'count', index: 0 };
        }
        if (edge.kind === 'prop' && edge.to === counterIncrementParameterId) {
          return { ...edge, authoredName: 'onIncrement', index: 1 };
        }
        return edge;
      }),
      {
        kind: 'read',
        from: counterStepParameterId,
        to: counterCountParameterId,
        mode: 'reactive',
        sites: [defaultReadSpan],
      },
      { kind: 'child', from: counterButtonId, to: counterContentSlotId, index: 1 },
      { kind: 'child', from: counterInstanceId, to: passedContentId, index: 0 },
      {
        kind: 'prop',
        mode: 'reactive',
        from: counterInstanceId,
        to: counterRestParameterId,
        authoredName: 'id',
        index: 2,
        value: { kind: 'literal', value: 'counter', span: spanAt(87) },
        span: spanAt(87),
      },
      {
        kind: 'spread-prop',
        from: counterInstanceId,
        to: counterRestParameterId,
        index: 3,
        source: { kind: 'rest', targetId: appRestParameterId, span: spreadSourceSpan },
        span: spreadSpan,
      },
      {
        kind: 'read',
        from: counterInstanceId,
        to: appRestParameterId,
        mode: 'reactive',
        sites: [spreadSourceSpan],
      },
    ],
  };
};

describe('UiGraphV1', () => {
  it('validates a closed graph and serializes nodes deterministically', () => {
    const input = graph();
    const serialized = serializeUiGraph(input);

    expect(validateUiGraph(input)).toEqual([]);
    expect(serialized).toBe(serializeUiGraph({ ...input, nodes: [...input.nodes].reverse() }));
    expect(serialized).toMatch(/^\{\n {2}"edges":/u);
    expect((JSON.parse(serialized) as UiGraphV1).nodes.map((node) => node.id)).toEqual([
      componentId,
      countId,
      mainId,
    ]);
  });

  it('reports duplicate ids, dangling references, and invalid edge kinds', () => {
    const input = graph();
    const count = input.nodes.find((node) => node.id === countId);
    if (!count) {
      throw new Error('fixture count missing');
    }

    const invalid: UiGraphV1 = {
      ...input,
      nodes: [...input.nodes, count],
      edges: [...input.edges, { kind: 'child', from: countId, to: 'ui:missing', index: 0 }],
    };

    expect(validateUiGraph(invalid)).toMatchObject([
      { code: 'OXE3001', message: expect.stringContaining('Duplicate semantic graph id') },
      { code: 'OXE3002', message: expect.stringContaining('ui:missing') },
    ]);
  });

  it('requires conditional value expressions to end in one final fallback', () => {
    const input = graph();
    const invalid: UiGraphV1 = {
      ...input,
      nodes: input.nodes.map((node) =>
        node.kind === 'cell'
          ? {
              ...node,
              initial: {
                kind: 'conditional',
                branches: [
                  {
                    condition: { kind: 'literal', value: true, span },
                    result: { kind: 'literal', value: 1, span },
                    span,
                  },
                ],
                span,
              },
            }
          : node,
      ),
    };

    expect(validateUiGraph(invalid)).toContainEqual(
      expect.objectContaining({
        code: 'OXE3006',
        message: 'A conditional value expression must end with a fallback branch.',
      }),
    );
  });

  it('rejects non-finite or non-JSON values at the serialization boundary', () => {
    const input = graph();
    const unsafe = input as UiGraphV1 & { unsafe?: unknown };
    unsafe.unsafe = Number.NaN;

    expect(() => serializeUiGraph(unsafe)).toThrow('must be finite');
  });

  it('requires read and write edges to exactly project executable expressions', () => {
    const input = dataflowGraph();
    expect(validateUiGraph(input)).toEqual([]);

    const missingRead = {
      ...input,
      edges: input.edges.filter(
        (edge) => !(edge.kind === 'read' && edge.from === doubledId && edge.to === countId),
      ),
    } satisfies UiGraphV1;
    expect(validateUiGraph(missingRead)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OXE3004',
          message: expect.stringContaining('missing the read edge'),
        }),
      ]),
    );

    const extraRead = {
      ...input,
      nodes: input.nodes.map((node) =>
        node.id === doubledId && node.kind === 'computed'
          ? { ...node, expression: { kind: 'literal' as const, value: 2, span: spanAt(10) } }
          : node,
      ),
    } satisfies UiGraphV1;
    expect(validateUiGraph(extraRead)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OXE3004',
          message: expect.stringContaining('extra read edge'),
        }),
      ]),
    );

    const missingWrite = {
      ...input,
      edges: input.edges.filter(
        (edge) => !(edge.kind === 'write' && edge.from === incrementId && edge.to === countId),
      ),
    } satisfies UiGraphV1;
    expect(validateUiGraph(missingWrite)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OXE3004',
          message: expect.stringContaining('missing the write edge'),
        }),
      ]),
    );

    const extraWrite = {
      ...input,
      nodes: input.nodes.map((node) =>
        node.id === incrementId && node.kind === 'procedure' ? { ...node, steps: [] } : node,
      ),
    } satisfies UiGraphV1;
    expect(validateUiGraph(extraWrite)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OXE3004',
          message: expect.stringContaining('extra write edge'),
        }),
      ]),
    );
  });

  it('rejects procedure writes to non-cells and invalid write modes', () => {
    const input = dataflowGraph();
    const constantId = `${componentId}/binding/step`;
    const invalidTarget = {
      ...input,
      nodes: [
        ...input.nodes,
        {
          id: constantId,
          kind: 'constant' as const,
          name: 'step',
          type: 'number' as const,
          value: 1,
          span,
        },
      ].map((node) =>
        node.id === incrementId && node.kind === 'procedure'
          ? {
              ...node,
              steps: node.steps.map((step) => ({ ...step, targetId: constantId })),
            }
          : node,
      ),
      edges: input.edges.map((edge) =>
        edge.kind === 'write' && edge.from === incrementId ? { ...edge, to: constantId } : edge,
      ),
    } satisfies UiGraphV1;

    expect(validateUiGraph(invalidTarget)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OXE3003',
          message: expect.stringContaining('must reference a writable value node'),
        }),
      ]),
    );

    const invalidMode = {
      ...input,
      edges: input.edges.map((edge) =>
        edge.kind === 'write' && edge.from === incrementId
          ? ({ ...edge, mode: 'reactive' } as unknown as UiEdgeV1)
          : edge,
      ),
    };
    expect(validateUiGraph(invalidMode)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OXE3003',
          message: expect.stringContaining('Invalid write edge'),
        }),
      ]),
    );
  });

  it('rejects duplicate and noncontiguous child indexes', () => {
    const input = graph();
    const firstId = `${mainId}/text[0]`;
    const secondId = `${mainId}/text[1]`;
    const nodes = [
      ...input.nodes,
      { id: firstId, kind: 'text' as const, parts: [], span: spanAt(10) },
      { id: secondId, kind: 'text' as const, parts: [], span: spanAt(20) },
    ];

    const duplicate = {
      ...input,
      nodes,
      edges: [
        ...input.edges,
        { kind: 'child' as const, from: mainId, to: firstId, index: 0 },
        { kind: 'child' as const, from: mainId, to: secondId, index: 0 },
      ],
    };
    expect(validateUiGraph(duplicate)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'OXE3005', message: expect.stringContaining('index 0') }),
      ]),
    );

    const noncontiguous = {
      ...input,
      nodes,
      edges: [
        ...input.edges,
        { kind: 'child' as const, from: mainId, to: firstId, index: 0 },
        { kind: 'child' as const, from: mainId, to: secondId, index: 2 },
      ],
    };
    expect(validateUiGraph(noncontiguous)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OXE3005',
          message: expect.stringContaining('contiguous starting at 0'),
        }),
      ]),
    );
  });

  it('rejects multiple parents, child cycles, and unparented view nodes', () => {
    const input = graph();
    const sectionId = `${componentId}/view/element[1]`;
    const sharedId = `${componentId}/view/text[0]`;
    const cycleAId = `${componentId}/view/cycle-a`;
    const cycleBId = `${componentId}/view/cycle-b`;
    const orphanId = `${componentId}/view/orphan`;

    const invalid = {
      ...input,
      nodes: [
        ...input.nodes,
        {
          id: sectionId,
          kind: 'element' as const,
          tag: 'section',
          staticAttributes: [],
          span: spanAt(10),
        },
        { id: sharedId, kind: 'text' as const, parts: [], span: spanAt(20) },
        {
          id: cycleAId,
          kind: 'element' as const,
          tag: 'div',
          staticAttributes: [],
          span: spanAt(30),
        },
        {
          id: cycleBId,
          kind: 'element' as const,
          tag: 'div',
          staticAttributes: [],
          span: spanAt(40),
        },
        { id: orphanId, kind: 'text' as const, parts: [], span: spanAt(50) },
      ],
      edges: [
        ...input.edges,
        { kind: 'child' as const, from: componentId, to: sectionId, index: 1 },
        { kind: 'child' as const, from: mainId, to: sharedId, index: 0 },
        { kind: 'child' as const, from: sectionId, to: sharedId, index: 0 },
        { kind: 'child' as const, from: cycleAId, to: cycleBId, index: 0 },
        { kind: 'child' as const, from: cycleBId, to: cycleAId, index: 0 },
      ],
    };

    expect(validateUiGraph(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OXE3005',
          message: expect.stringContaining('more than one parent'),
        }),
        expect.objectContaining({ code: 'OXE3005', message: expect.stringContaining('cycle') }),
        expect.objectContaining({
          code: 'OXE3005',
          message: expect.stringContaining('not reachable from a component'),
        }),
      ]),
    );
  });

  it('totally orders equal-key edges by their spans and sites', () => {
    const input = dataflowGraph();
    const eventAtTen: UiEdgeV1 = {
      kind: 'event',
      from: mainId,
      to: incrementId,
      authoredName: 'onClick',
      event: 'click',
      span: spanAt(10),
    };
    const eventAtTwenty: UiEdgeV1 = { ...eventAtTen, span: spanAt(20) };
    const computedRead = input.edges.find(
      (edge) => edge.kind === 'read' && edge.from === doubledId,
    );
    if (!computedRead || computedRead.kind !== 'read') {
      throw new Error('Fixture computed read edge missing.');
    }
    const readAtTen: UiEdgeV1 = { ...computedRead, sites: [spanAt(10)] };
    const readAtTwenty: UiEdgeV1 = { ...computedRead, sites: [spanAt(20)] };
    const otherEdges = input.edges.filter(
      (edge) => !(edge.kind === 'read' && edge.from === doubledId),
    );

    expect(
      serializeUiGraph({
        ...input,
        edges: [...otherEdges, eventAtTwenty, readAtTwenty, eventAtTen, readAtTen],
      }),
    ).toBe(
      serializeUiGraph({
        ...input,
        edges: [...otherEdges, readAtTen, eventAtTen, readAtTwenty, eventAtTwenty],
      }),
    );

    expect(
      serializeUiGraph({
        ...input,
        edges: [...otherEdges, { ...computedRead, sites: [spanAt(20), spanAt(10)] }],
      }),
    ).toBe(
      serializeUiGraph({
        ...input,
        edges: [...otherEdges, { ...computedRead, sites: [spanAt(10), spanAt(20)] }],
      }),
    );
  });

  it('validates explicit component contracts, instances, props, and ownership', () => {
    const input = compositionGraph();

    expect(validateUiGraph(input)).toEqual([]);
    expect(serializeUiGraph(input)).toBe(
      serializeUiGraph({
        ...input,
        edges: [...input.edges].reverse(),
        nodes: [...input.nodes].reverse(),
      }),
    );
  });

  it('requires every component prop exactly once and verifies procedure capabilities', () => {
    const input = compositionGraph();
    const missing = {
      ...input,
      edges: input.edges.filter((edge) => !(edge.kind === 'prop' && edge.mode === 'procedure')),
    } satisfies UiGraphV1;
    expect(validateUiGraph(missing)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OXE3006',
          message: expect.stringContaining('missing required parameter'),
        }),
      ]),
    );

    const duplicateProp = input.edges.find(
      (edge) => edge.kind === 'prop' && edge.mode === 'reactive',
    );
    if (!duplicateProp || duplicateProp.kind !== 'prop') {
      throw new Error('Fixture reactive prop edge missing.');
    }
    const duplicate = {
      ...input,
      edges: [...input.edges, duplicateProp],
    } satisfies UiGraphV1;
    expect(validateUiGraph(duplicate)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OXE3006',
          message: expect.stringContaining('supplies parameter'),
        }),
      ]),
    );

    const invalidCapability = {
      ...input,
      edges: input.edges.map((edge) =>
        edge.kind === 'prop' && edge.mode === 'procedure' ? { ...edge, targetId: countId } : edge,
      ),
    } satisfies UiGraphV1;
    expect(validateUiGraph(invalidCapability)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OXE3003',
          message: expect.stringContaining('procedure capability'),
        }),
      ]),
    );
  });

  it('enforces structural ownership, parameter order, and acyclic composition', () => {
    const input = compositionGraph();
    const wrongOwner = {
      ...input,
      edges: input.edges.map((edge) =>
        edge.kind === 'owner' ? { ...edge, from: counterComponentId } : edge,
      ),
    } satisfies UiGraphV1;
    expect(validateUiGraph(wrongOwner)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OXE3006',
          message: expect.stringContaining('containing component'),
        }),
      ]),
    );

    const wrongOrder = {
      ...input,
      nodes: input.nodes.map((node) =>
        node.id === counterCountParameterId && node.kind === 'component-parameter'
          ? { ...node, index: 2 }
          : node,
      ),
    } satisfies UiGraphV1;
    expect(validateUiGraph(wrongOrder)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OXE3006',
          message: expect.stringContaining('declaration index 0'),
        }),
      ]),
    );

    const recursive = {
      ...input,
      nodes: input.nodes.map((node) =>
        node.id === counterInstanceId && node.kind === 'component-instance'
          ? { ...node, componentId }
          : node,
      ),
    } satisfies UiGraphV1;
    expect(validateUiGraph(recursive)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'OXE3006', message: expect.stringContaining('cycle') }),
      ]),
    );
  });

  it('validates defaults, content slots, rest capture, and ordered spreads', () => {
    const input = extendedCompositionGraph();

    expect(validateUiGraph(input)).toEqual([]);
    expect(serializeUiGraph(input)).toBe(
      serializeUiGraph({
        ...input,
        edges: [...input.edges].reverse(),
        nodes: [...input.nodes].reverse(),
      }),
    );
  });

  it('does not let defaults or spreads hide missing explicit required props', () => {
    const input = extendedCompositionGraph();
    const withoutRequiredCount = {
      ...input,
      edges: input.edges.filter(
        (edge) =>
          !(
            (edge.kind === 'prop' && edge.to === counterCountParameterId) ||
            (edge.kind === 'read' && edge.from === counterInstanceId && edge.to === countId)
          ),
      ),
    } satisfies UiGraphV1;

    expect(validateUiGraph(withoutRequiredCount)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OXE3006',
          message: expect.stringContaining('missing required parameter'),
        }),
      ]),
    );
  });

  it('allows empty children while enforcing slot placement and child-content contracts', () => {
    const input = extendedCompositionGraph();
    const withoutContent = {
      ...input,
      nodes: input.nodes.filter((node) => node.id !== passedContentId),
      edges: input.edges.filter((edge) => !(edge.kind === 'child' && edge.to === passedContentId)),
    } satisfies UiGraphV1;
    expect(validateUiGraph(withoutContent)).toEqual([]);

    const duplicateSlotId = `${counterButtonId}/content-slot[1]`;
    const duplicateSlot = {
      ...input,
      nodes: [
        ...input.nodes,
        {
          id: duplicateSlotId,
          kind: 'content-slot' as const,
          parameterId: counterChildrenParameterId,
          span: spanAt(91),
        },
      ],
      edges: [
        ...input.edges,
        { kind: 'child' as const, from: counterButtonId, to: duplicateSlotId, index: 2 },
      ],
    } satisfies UiGraphV1;
    expect(validateUiGraph(duplicateSlot)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OXE3006',
          message: expect.stringContaining('exactly one content slot'),
        }),
      ]),
    );

    const noContract = compositionGraph();
    const unexpectedContentId = `${counterInstanceId}/unexpected-text`;
    const unexpectedContent = {
      ...noContract,
      nodes: [
        ...noContract.nodes,
        { id: unexpectedContentId, kind: 'text' as const, parts: [], span: spanAt(92) },
      ],
      edges: [
        ...noContract.edges,
        { kind: 'child' as const, from: counterInstanceId, to: unexpectedContentId, index: 0 },
      ],
    } satisfies UiGraphV1;
    expect(validateUiGraph(unexpectedContent)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OXE3006',
          message: expect.stringContaining('cannot receive child content'),
        }),
      ]),
    );
  });

  it('enforces earlier-only defaults, one trailing rest parameter, and prop order', () => {
    const input = extendedCompositionGraph();
    const laterDefaultSpan = spanAt(93);
    const invalidDefault = {
      ...input,
      nodes: input.nodes.map((node) =>
        node.id === counterCountParameterId && node.kind === 'component-parameter'
          ? {
              ...node,
              default: {
                kind: 'read' as const,
                targetId: counterStepParameterId,
                span: laterDefaultSpan,
              },
            }
          : node,
      ),
      edges: [
        ...input.edges,
        {
          kind: 'read' as const,
          from: counterCountParameterId,
          to: counterStepParameterId,
          mode: 'reactive' as const,
          sites: [laterDefaultSpan],
        },
      ],
    } satisfies UiGraphV1;
    expect(validateUiGraph(invalidDefault)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OXE3006',
          message: expect.stringContaining('earlier value parameters'),
        }),
      ]),
    );

    const nonTrailingRest = {
      ...input,
      nodes: input.nodes.map((node) => {
        if (node.id === counterComponentId && node.kind === 'component') {
          return {
            ...node,
            parameters: [
              counterCountParameterId,
              counterIncrementParameterId,
              counterRestParameterId,
              counterStepParameterId,
              counterChildrenParameterId,
            ],
          };
        }
        if (node.id === counterRestParameterId && node.kind === 'component-parameter') {
          return { ...node, index: 2 };
        }
        if (node.id === counterStepParameterId && node.kind === 'component-parameter') {
          return { ...node, index: 3 };
        }
        if (node.id === counterChildrenParameterId && node.kind === 'component-parameter') {
          return { ...node, index: 4 };
        }
        return node;
      }),
    } satisfies UiGraphV1;
    expect(validateUiGraph(nonTrailingRest)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OXE3006',
          message: expect.stringContaining('final component parameter'),
        }),
      ]),
    );

    const secondRestId = `${counterComponentId}/parameter/more`;
    const duplicateRest = {
      ...input,
      nodes: [
        ...input.nodes.map((node) =>
          node.id === counterComponentId && node.kind === 'component'
            ? { ...node, parameters: [...node.parameters, secondRestId] }
            : node,
        ),
        {
          id: secondRestId,
          kind: 'component-parameter' as const,
          ownerId: counterComponentId,
          index: 5,
          name: 'more',
          parameterKind: 'rest' as const,
          span: spanAt(94),
        },
      ],
    } satisfies UiGraphV1;
    expect(validateUiGraph(duplicateRest)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OXE3006',
          message: expect.stringContaining('only one rest parameter'),
        }),
      ]),
    );

    const duplicateIndex = {
      ...input,
      edges: input.edges.map((edge) =>
        edge.kind === 'spread-prop' ? { ...edge, index: 2 } : edge,
      ),
    } satisfies UiGraphV1;
    expect(validateUiGraph(duplicateIndex)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OXE3006',
          message: expect.stringContaining('authored index 2'),
        }),
      ]),
    );

    const missingRestIndex = {
      ...input,
      edges: input.edges.map((edge) => {
        if (
          edge.kind !== 'prop' ||
          edge.mode !== 'reactive' ||
          edge.to !== counterRestParameterId
        ) {
          return edge;
        }
        return {
          kind: edge.kind,
          mode: edge.mode,
          from: edge.from,
          to: edge.to,
          authoredName: edge.authoredName ?? 'id',
          span: edge.span,
          value: edge.value,
        };
      }),
    } satisfies UiGraphV1;
    expect(validateUiGraph(missingRestIndex)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OXE3006',
          message: expect.stringContaining('nonnegative integer index'),
        }),
      ]),
    );
  });
});
