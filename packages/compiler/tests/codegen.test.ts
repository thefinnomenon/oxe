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
  it('awaits server-function calls in event procedures and owns their cancellation signal', () => {
    const result = analyzeSource(
      `export server saveProject(id: string):
  saved = database.save(id)
  saved

export App():
  save():
    saveProject("p1")
  <button onClick={save}>Save
`,
      'mutation.oxe',
      'mutation.oxe',
      {
        capabilities: [
          {
            kind: 'async',
            name: 'database.save',
            parameters: ['string'],
            returns: 'boolean',
            target: 'server',
            writes: 'projects',
          },
        ],
      },
    );
    if (!result.graph) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.graph.serverFunctions?.[0]?.mode).toBe('mutation');

    const source = generateDomFactorySource(result.graph);
    expect(source).toContain('const saveHandler = async () =>');
    expect(source).toContain('new AbortController()');
    expect(source).toContain('await requireServerFunction(serverFunctions');
    expect(source).toContain('.signal);');
    expect(source).toContain('kind: \'async-procedure\', name: "App.save"');
  });

  it('emits async resources, granular bindings, refresh, and eager hydration adoption', () => {
    const result = analyzeSource(
      `export App():
  user = users.load(1)
  reload():
    refresh(user)
  <main>
    <p>Static
    <img src={user.avatar}>
    <h1>{user.name}
    <button onClick={reload}>Reload
`,
      'async.oxe',
      'async.oxe',
      {
        capabilities: [
          { kind: 'async', name: 'users.load', parameters: ['number'], returns: 'record' },
        ],
      },
    );
    if (!result.graph) {
      throw new Error(`Expected a graph, received: ${JSON.stringify(result.diagnostics)}`);
    }
    const artifact = generateDomArtifact(result.graph);

    expect(result.graph.nodes).toContainEqual(
      expect.objectContaining({ kind: 'async-resource', name: 'user' }),
    );
    expect(artifact.hydrateExport).toBe('hydrateApp');
    expect(artifact.factorySource).toContain('createAsyncResource(');
    expect(artifact.factorySource).toContain('bindAsyncDomValue(');
    expect(artifact.factorySource).toContain('bindAsyncText(');
    expect(artifact.factorySource).toContain('refreshAsyncResource(userAsync);');
    expect(artifact.factorySource).toContain('asyncCoordinator.hydrate(');
    expect(artifact.factorySource).toContain('readSerializedAsyncCheckpoints(document)');
    expect(artifact.moduleSource).toContain('hydrateApp');
  });

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
      'const { batch, createCell, createDerived, createReaction, createRoot, untrack } = runtime;',
    );
    expect(source).toContain(
      'const { appendChild, bindDomValue, bindText, createConditionalRegion, createElement, createKeyedRegion, createText, listen, mount, setDomValue } = dom;',
    );
    expect(source).toContain(
      'const countCell = createCell(0, { name: "App.count", traceId: "counter.oxe#component/App/binding/count" });',
    );
    expect(source).toContain(
      'const doubledDerived = createDerived([countCell], () => (countCell.read() * 2)',
    );
    expect(source).toContain('batch(() => {');
    expect(source).toContain('countCell.write((countCell.read() + 1));');
    expect(source).toContain('listen(buttonElement, "click", incrementHandler, { replayId:');
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
      /^import \{ batch, createCell, createDerived, createReaction, createRoot, untrack \} from '@oxe\/runtime';/u,
    );
    expect(source).toContain("from '@oxe/runtime-dom';");
    expect(source).toContain('export { App, mountApp };');
    expect(source).not.toContain('(runtime, dom) =>');
    expect(artifact).toMatchObject({
      componentExport: 'App',
      factorySource: generateDomFactorySource(graph),
      moduleSource: source,
      mountExport: 'mountApp',
      factorySourceMap: {
        file: 'App.factory.js',
        names: [],
        sources: ['counter.oxe'],
        version: 3,
      },
      moduleSourceMap: {
        file: 'App.js',
        names: [],
        sources: ['counter.oxe'],
        version: 3,
      },
    });
    expect(artifact.factorySourceMap.mappings.length).toBeGreaterThan(0);
    expect(artifact.moduleSourceMap.mappings.length).toBeGreaterThan(0);
  });

  it('lowers standalone record member consumers to field-path sources', () => {
    const result = analyzeSource(
      `App():
  profile = { name: "Ada", active: true }
  deactivate():
    profile.active = false
  <main>
    <p>{profile.name}
`,
      'record-path.oxe',
      'record-path.oxe',
    );
    if (!result.graph) {
      throw new Error(`Expected a graph, received: ${JSON.stringify(result.diagnostics)}`);
    }

    const source = generateDomFactorySource(result.graph);

    expect(source).toContain('createRoot, selectPath, untrack } = runtime;');
    expect(source).toContain(
      'selectPath(profileCell, ["name"], { name: "profile.name", traceId: "record-path.oxe#component/App/binding/profile" })',
    );
    expect(source).toContain('profileCell.writePath(["active"], false);');
  });

  it('emits authored context identity, provider scope, and nearest-value reads', () => {
    const result = analyzeSource(
      `SessionContext = createContext()

App():
  session = { name: "Ada" }
  <SessionContext value={session}>
    <Header>

Header():
  session = SessionContext()
  <p>{session.name}
`,
      'context.oxe',
      'context.oxe',
    );
    if (!result.graph) {
      throw new Error(`Expected a graph, received: ${JSON.stringify(result.diagnostics)}`);
    }

    const source = generateDomFactorySource(result.graph);
    expect(source).toContain('const SessionContext = createContext("SessionContext");');
    expect(source).toContain('withContext(SessionContext, contextValue, () => {');
    expect(source).toContain('const sessionContextValue = readContext(SessionContext);');
  });

  it('emits typed host calls and compiler-owned disposable resources', () => {
    const result = analyzeSource(
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
    );
    if (!result.graph) {
      throw new Error(`Expected a graph, received: ${JSON.stringify(result.diagnostics)}`);
    }
    const source = generateDomFactorySource(result.graph);
    expect(source).toContain(
      'createDisposableReaction([], () => globalThis["messages"]["subscribe"]',
    );
  });

  it('hoists static DOM subtrees into cloneable direct-DOM templates', () => {
    const result = analyzeSource(
      `App():
  <main class={"page"}>
    <h1>OXE
    <p>Static content
`,
      'static.oxe',
      'static.oxe',
    );
    if (!result.graph) {
      throw new Error(`Expected a graph, received: ${JSON.stringify(result.diagnostics)}`);
    }
    const source = generateDomFactorySource(result.graph);
    expect(source).toContain('createStaticTemplate({"tag":"main"');
    expect(source.match(/createStaticTemplate\(/gu)).toHaveLength(1);
    expect(source).toContain('"children":[{"tag":"h1"');
    expect(source).toMatch(/const mainElement = mainTemplate\d*\(document\);/u);
  });

  it('binds implicit platform refs before procedures or reactive work can use them', () => {
    const result = analyzeSource(
      `App():
  focus():
    field.focus()
  <main>
    <input ref={field}>
    <button onClick={focus}>Focus
`,
      'ref.oxe',
      'ref.oxe',
    );
    if (!result.graph) {
      throw new Error(`Expected a graph, received: ${JSON.stringify(result.diagnostics)}`);
    }
    const source = generateDomFactorySource(result.graph);
    expect(source).toContain('const fieldRef = createCell(undefined');
    expect(source).toContain('fieldRef.write(inputElement);');
    expect(source).toContain('fieldRef.read()["focus"]();');
    expect(source.indexOf('fieldRef.write(inputElement);')).toBeLessThan(
      source.indexOf('return mainElement;'),
    );
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
