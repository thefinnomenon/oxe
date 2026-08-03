import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import {
  analyzeSource,
  generateDomArtifact,
  generateDomFactorySource,
  generateDomModuleSource,
  type OxeCodegenError,
} from '../src/index.js';

const counterSource = `App():
  count = 0
  doubled = count * 2
  unchanged = "Static"

  increment():
    count = count + 1

  <main>
    <button onClick={increment}>Count: {count}
    <p>Doubled: {doubled}
    <p>{unchanged}
`;

const counterGraph = () => {
  const result = analyzeSource(counterSource, 'counter.oxe', 'counter.oxe');
  if (!result.graph) {
    throw new Error(`Expected a graph, received: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.graph;
};

describe('DOM code generation', () => {
  it('emits a deterministic injectable factory using direct DOM and reactive primitives', () => {
    const graph = counterGraph();
    const source = generateDomFactorySource(graph);

    expect(source).toBe(
      generateDomFactorySource({
        ...graph,
        edges: [...graph.edges].reverse(),
        nodes: [...graph.nodes].reverse(),
      }),
    );
    expect(source).toContain(
      'const { batch, createCell, createDerived, createRoot, untrack } = runtime;',
    );
    expect(source).toContain(
      'const { appendChild, bindDomValue, bindText, createConditionalRegion, createElement, createKeyedRegion, createText, listen, mount, setDomValue } = dom;',
    );
    expect(source).toContain('const countCell = createCell(0, { name: "App.count" });');
    expect(source).toContain(
      'const doubledDerived = createDerived([countCell], () => (countCell.read() * 2)',
    );
    expect(source).toContain('batch(() => {');
    expect(source).toContain('countCell.write((countCell.read() + 1));');
    expect(source).toContain('listen(buttonElement, "click", incrementHandler);');
    expect(source).toContain('bindText(');
    expect(source).not.toContain('innerHTML');
    expect(source).not.toContain('addEventListener');

    const factory = runInNewContext(`(${source})`) as (
      runtime: Record<string, unknown>,
      dom: Record<string, unknown>,
    ) => Record<string, unknown>;
    const generated = factory(
      { batch: () => undefined, createCell: () => undefined, createDerived: () => undefined },
      {
        appendChild: () => undefined,
        bindText: () => undefined,
        createElement: () => undefined,
        createText: () => undefined,
        listen: () => undefined,
        mount: () => undefined,
      },
    );

    expect(Object.keys(generated)).toEqual(['App', 'mountApp']);
    expect(typeof generated.App).toBe('function');
    expect(typeof generated.mountApp).toBe('function');
  });

  it('wraps the same program in ergonomic ES module imports and exports', () => {
    const graph = counterGraph();
    const source = generateDomModuleSource(graph);
    const artifact = generateDomArtifact(graph);

    expect(source).toMatch(
      /^import \{ batch, createCell, createDerived, createRoot, untrack \} from '@oxe\/runtime';/u,
    );
    expect(source).toContain("from '@oxe/runtime-dom';");
    expect(source).toContain('export { App, mountApp };');
    expect(source).not.toContain('(runtime, dom) =>');
    expect(artifact).toEqual({
      componentExport: 'App',
      factorySource: generateDomFactorySource(graph),
      moduleSource: source,
      mountExport: 'mountApp',
    });
  });

  it('emits static DOM attributes through the typed DOM value boundary', () => {
    const graph = counterGraph();
    const main = graph.nodes.find((node) => node.kind === 'element' && node.tag === 'main');
    if (!main || main.kind !== 'element') {
      throw new Error('Counter fixture is missing its main element.');
    }
    const attributed = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === main.id
          ? {
              ...main,
              staticAttributes: [
                {
                  name: 'class',
                  value: 'counter',
                  span: main.span,
                },
              ],
            }
          : node,
      ),
    };

    expect(generateDomFactorySource(attributed)).toContain(
      'setDomValue(mainElement, "class", "attribute", "counter");',
    );
  });

  it('rejects a non-finite literal instead of emitting invalid JavaScript', () => {
    const graph = counterGraph();
    const unsafe = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.kind === 'constant' ? { ...node, value: Number.NaN } : node,
      ),
    };

    expect(() => generateDomFactorySource(unsafe)).toThrowError(
      expect.objectContaining<Partial<OxeCodegenError>>({
        code: 'OXE4001',
        message: expect.stringContaining('non-finite numeric literal'),
      }),
    );
  });
});
