import type { UiGraphV1 } from '@oxe/graph';
import { describe, expect, it } from 'vitest';

import { buildGraphInspectorModel } from '../src/graph-inspector.js';

const span = {
  fileName: 'examples/component-composition/App.oxe',
  start: { column: 1, line: 1, offset: 0 },
  end: { column: 4, line: 1, offset: 3 },
} as const;

const graph: UiGraphV1 = {
  schemaVersion: 'oxe.ui-graph.v1',
  moduleId: 'examples/component-composition/App.oxe',
  entryComponents: ['component:App'],
  nodes: [
    {
      id: 'cell:count',
      kind: 'cell',
      name: 'count',
      type: 'number',
      initial: { kind: 'literal', value: 0, span },
      span,
    },
    { id: 'component:App', kind: 'component', name: 'App', parameters: [], span },
    {
      id: 'component:Counter',
      kind: 'component',
      name: 'Counter',
      parameters: ['parameter:count', 'parameter:onIncrement'],
      span,
    },
    { id: 'instance:Counter', kind: 'component-instance', componentId: 'component:Counter', span },
    {
      id: 'parameter:count',
      kind: 'component-parameter',
      parameterKind: 'value',
      ownerId: 'component:Counter',
      index: 0,
      name: 'count',
      type: 'number',
      span,
    },
    {
      id: 'parameter:onIncrement',
      kind: 'component-parameter',
      parameterKind: 'procedure',
      ownerId: 'component:Counter',
      index: 1,
      name: 'onIncrement',
      span,
    },
    {
      id: 'procedure:increment',
      kind: 'procedure',
      name: 'increment',
      parameters: [],
      steps: [],
      span,
    },
  ],
  edges: [
    { kind: 'child', from: 'component:App', to: 'instance:Counter', index: 0 },
    { kind: 'owner', from: 'component:App', to: 'instance:Counter' },
    {
      kind: 'prop',
      mode: 'reactive',
      from: 'instance:Counter',
      to: 'parameter:count',
      value: { kind: 'read', targetId: 'cell:count', span },
      span,
    },
    {
      kind: 'prop',
      mode: 'procedure',
      from: 'instance:Counter',
      to: 'parameter:onIncrement',
      targetId: 'procedure:increment',
      span,
    },
    { kind: 'read', mode: 'reactive', from: 'instance:Counter', to: 'cell:count', sites: [span] },
  ],
};

const extendedGraph: UiGraphV1 = {
  schemaVersion: 'oxe.ui-graph.v1',
  moduleId: 'examples/composition-features/App.oxe',
  entryComponents: ['component:Wrapper'],
  nodes: [
    {
      id: 'component:Wrapper',
      kind: 'component',
      name: 'Wrapper',
      parameters: ['parameter:wrapperProps'],
      span,
    },
    {
      id: 'parameter:wrapperProps',
      kind: 'component-parameter',
      parameterKind: 'rest',
      ownerId: 'component:Wrapper',
      index: 0,
      name: 'props',
      span,
    },
    {
      id: 'component:Card',
      kind: 'component',
      name: 'Card',
      parameters: [
        'parameter:title',
        'parameter:subtitle',
        'parameter:cardProps',
        'parameter:children',
      ],
      span,
    },
    {
      id: 'parameter:title',
      kind: 'component-parameter',
      parameterKind: 'value',
      ownerId: 'component:Card',
      index: 0,
      name: 'title',
      type: 'string',
      span,
    },
    {
      id: 'parameter:subtitle',
      kind: 'component-parameter',
      parameterKind: 'value',
      ownerId: 'component:Card',
      index: 1,
      name: 'subtitle',
      type: 'string',
      default: { kind: 'read', targetId: 'parameter:title', span },
      span,
    },
    {
      id: 'parameter:cardProps',
      kind: 'component-parameter',
      parameterKind: 'rest',
      ownerId: 'component:Card',
      index: 2,
      name: 'props',
      span,
    },
    {
      id: 'parameter:children',
      kind: 'component-parameter',
      parameterKind: 'children',
      ownerId: 'component:Card',
      index: 3,
      name: 'children',
      span,
    },
    {
      id: 'instance:Card',
      kind: 'component-instance',
      componentId: 'component:Card',
      span,
    },
    {
      id: 'slot:children',
      kind: 'content-slot',
      parameterId: 'parameter:children',
      span,
    },
  ],
  edges: [
    { kind: 'child', from: 'component:Wrapper', to: 'instance:Card', index: 0 },
    { kind: 'child', from: 'component:Card', to: 'slot:children', index: 0 },
    { kind: 'owner', from: 'component:Wrapper', to: 'instance:Card' },
    {
      kind: 'prop',
      mode: 'reactive',
      authoredName: 'tone',
      index: 0,
      from: 'instance:Card',
      to: 'parameter:cardProps',
      value: { kind: 'literal', value: 'quiet', span },
      span,
    },
    {
      kind: 'spread-prop',
      index: 1,
      from: 'instance:Card',
      to: 'parameter:cardProps',
      source: { kind: 'rest', targetId: 'parameter:wrapperProps', span },
      span,
    },
    {
      kind: 'read',
      mode: 'reactive',
      from: 'parameter:subtitle',
      to: 'parameter:title',
      sites: [span],
    },
  ],
};

describe('graph inspector model', () => {
  it('explains a component instance across ownership and both prop modes', () => {
    const model = buildGraphInspectorModel(graph, 'instance:Counter');

    expect(model?.title).toBe('Counter instance');
    expect(model?.ownerAndSource.map((item) => item.label)).toEqual([
      'Source span',
      'Component definition',
      'Tree parent',
      'Owner',
    ]);
    expect(model?.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Value count', nodeId: 'cell:count' }),
        expect.objectContaining({ label: 'Capability onIncrement', nodeId: 'procedure:increment' }),
      ]),
    );
    expect(model?.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Prop count', nodeId: 'parameter:count' }),
        expect.objectContaining({ label: 'Prop onIncrement', nodeId: 'parameter:onIncrement' }),
      ]),
    );
  });

  it('shows the consumers of a reactive value and procedure capability', () => {
    expect(buildGraphInspectorModel(graph, 'cell:count')?.consumers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Read by', nodeId: 'instance:Counter' }),
        expect.objectContaining({ label: 'Passed as count', nodeId: 'instance:Counter' }),
      ]),
    );
    expect(buildGraphInspectorModel(graph, 'procedure:increment')?.consumers).toEqual([
      expect.objectContaining({ label: 'Passed as onIncrement', nodeId: 'instance:Counter' }),
    ]);
  });

  it('explains defaults, rest capture, and ordered component prop spreads', () => {
    const defaultModel = buildGraphInspectorModel(extendedGraph, 'parameter:subtitle');
    expect(defaultModel?.ownerAndSource).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Parameter 2',
          detail: 'value · string · default title',
        }),
      ]),
    );
    expect(defaultModel?.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Default input', nodeId: 'parameter:title' }),
      ]),
    );

    const instanceModel = buildGraphInspectorModel(extendedGraph, 'instance:Card');
    expect(instanceModel?.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Prop tone', nodeId: 'parameter:cardProps' }),
        expect.objectContaining({ label: 'Prop spread', nodeId: 'parameter:cardProps' }),
      ]),
    );
    expect(instanceModel?.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Value tone', detail: '"quiet"' }),
        expect.objectContaining({
          label: 'Spread into props',
          nodeId: 'parameter:wrapperProps',
        }),
      ]),
    );
    expect(buildGraphInspectorModel(extendedGraph, 'parameter:wrapperProps')?.consumers).toEqual([
      expect.objectContaining({ label: 'Forwarded into props', nodeId: 'instance:Card' }),
    ]);
  });

  it('connects the implicit children contract to its content slot', () => {
    const slotModel = buildGraphInspectorModel(extendedGraph, 'slot:children');
    expect(slotModel?.title).toBe('children slot');
    expect(slotModel?.ownerAndSource).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Children parameter', nodeId: 'parameter:children' }),
        expect.objectContaining({ label: 'Tree parent', nodeId: 'component:Card' }),
      ]),
    );
    expect(slotModel?.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Renders children', nodeId: 'parameter:children' }),
      ]),
    );
    expect(buildGraphInspectorModel(extendedGraph, 'parameter:children')?.consumers).toEqual([
      expect.objectContaining({ label: 'Rendered by slot', nodeId: 'slot:children' }),
    ]);
  });
});
