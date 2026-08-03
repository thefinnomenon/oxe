import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

import * as runtime from '@oxe/runtime';
import * as dom from '@oxe/runtime-dom';
import { describe, expect, it } from 'vitest';

import { analyzeProject, analyzeSource, generateDomFactorySource } from '../src/index.js';

type FakeListener = (event: Event) => void;

class FakeDocument {
  public appendedNodes = 0;
  public dataWrites = 0;
  public removedNodes = 0;

  public createElement(tagName: string): FakeElement {
    return new FakeElement(this, tagName);
  }

  public createTextNode(data: string): FakeText {
    return new FakeText(this, data);
  }
}

class FakeNode {
  public readonly childNodes: FakeNode[] = [];
  public parentNode: FakeNode | null = null;

  public get nextSibling(): FakeNode | null {
    if (!this.parentNode) {
      return null;
    }
    const index = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[index + 1] ?? null;
  }

  public constructor(public readonly ownerDocument: FakeDocument) {}

  public appendChild<Child extends FakeNode>(child: Child): Child {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    this.ownerDocument.appendedNodes += 1;
    return child;
  }

  public removeChild<Child extends FakeNode>(child: Child): Child {
    const index = this.childNodes.indexOf(child);
    if (index < 0) {
      throw new Error('The node is not a child of this parent.');
    }
    this.childNodes.splice(index, 1);
    child.parentNode = null;
    this.ownerDocument.removedNodes += 1;
    return child;
  }

  public insertBefore<Child extends FakeNode>(child: Child, reference: FakeNode | null): Child {
    if (reference === null) {
      return this.appendChild(child);
    }
    if (child === reference) {
      return child;
    }
    if (!this.childNodes.includes(reference)) {
      throw new Error('The reference node is not a child of this parent.');
    }
    child.parentNode?.removeChild(child);
    const index = this.childNodes.indexOf(reference);
    child.parentNode = this;
    this.childNodes.splice(index, 0, child);
    this.ownerDocument.appendedNodes += 1;
    return child;
  }

  public get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join('');
  }
}

class FakeText extends FakeNode {
  #data: string;
  public writes = 0;

  public constructor(document: FakeDocument, data: string) {
    super(document);
    this.#data = data;
  }

  public get data(): string {
    return this.#data;
  }

  public set data(value: string) {
    this.#data = value;
    this.writes += 1;
    this.ownerDocument.dataWrites += 1;
  }

  public override get textContent(): string {
    return this.#data;
  }
}

class FakeElement extends FakeNode {
  readonly #listeners = new Map<string, Set<FakeListener>>();
  readonly #attributes = new Map<string, string>();

  public constructor(
    document: FakeDocument,
    public readonly tagName: string,
  ) {
    super(document);
  }

  public set innerHTML(_value: string) {
    throw new Error('Generated OXE code must never assign innerHTML.');
  }

  public addEventListener(
    type: string,
    listener: FakeListener,
    options?: AddEventListenerOptions | boolean,
  ): void {
    const key = this.#listenerKey(type, options);
    const listeners = this.#listeners.get(key) ?? new Set<FakeListener>();
    listeners.add(listener);
    this.#listeners.set(key, listeners);
  }

  public removeEventListener(
    type: string,
    listener: FakeListener,
    options?: EventListenerOptions | boolean,
  ): void {
    this.#listeners.get(this.#listenerKey(type, options))?.delete(listener);
  }

  public emit(type: string): void {
    for (const capture of [true, false]) {
      for (const listener of this.#listeners.get(`${type}:${capture.toString()}`) ?? []) {
        listener({ type } as Event);
      }
    }
  }

  public getAttribute(name: string): string | null {
    return this.#attributes.get(name) ?? null;
  }

  public setAttribute(name: string, value: string): void {
    this.#attributes.set(name, value);
  }

  public removeAttribute(name: string): void {
    this.#attributes.delete(name);
  }

  public listenerCount(type: string): number {
    return (
      (this.#listeners.get(`${type}:true`)?.size ?? 0) +
      (this.#listeners.get(`${type}:false`)?.size ?? 0)
    );
  }

  #listenerKey(
    type: string,
    options: AddEventListenerOptions | EventListenerOptions | boolean | undefined,
  ): string {
    const capture = typeof options === 'boolean' ? options : (options?.capture ?? false);
    return `${type}:${capture.toString()}`;
  }
}

const collectNodes = (node: FakeNode): readonly FakeNode[] => [
  node,
  ...node.childNodes.flatMap(collectNodes),
];

const childElement = (parent: FakeNode, index: number, tagName: string): FakeElement => {
  const child = parent.childNodes[index];
  if (!(child instanceof FakeElement) || child.tagName !== tagName) {
    throw new Error(`Expected child ${index} to be <${tagName}>.`);
  }
  return child;
};

describe('generated counter with the OXE runtime', () => {
  it('switches an if region incrementally and disposes the removed branch', () => {
    const source = `export App():
  visible = true
  hide():
    visible = false
  show():
    visible = true
  <main>
    <button onClick={hide}>Hide
    <button onClick={show}>Show
    if
      visible ? <section>Visible
      : <p>Hidden
`;
    const analyzed = analyzeSource(source, 'conditional.oxe', 'conditional.oxe');
    if (!analyzed.graph) {
      throw new Error(`Expected a graph, received ${JSON.stringify(analyzed.diagnostics)}.`);
    }
    const createGenerated = runInNewContext(`(${generateDomFactorySource(analyzed.graph)})`) as (
      runtimeApi: typeof runtime,
      domApi: typeof dom,
    ) => { mountApp(container: Node): dom.MountHandle };
    const document = new FakeDocument();
    const container = new FakeElement(document, 'container');
    const mounted = createGenerated(runtime, dom).mountApp(container as unknown as Node);
    const main = childElement(container, 0, 'main');
    const hide = childElement(main, 0, 'button');
    const show = childElement(main, 1, 'button');
    const visible = childElement(main, 3, 'section');

    expect(main.textContent).toBe('HideShowVisible');
    document.appendedNodes = 0;
    document.removedNodes = 0;
    hide.emit('click');
    expect(main.textContent).toBe('HideShowHidden');
    expect(visible.parentNode).toBeNull();
    expect(document.removedNodes).toBe(1);

    const hidden = childElement(main, 3, 'p');
    show.emit('click');
    expect(main.textContent).toBe('HideShowVisible');
    expect(hidden.parentNode).toBeNull();
    mounted.unmount();
  });

  it('inserts, moves, and removes keyed map rows while preserving surviving DOM identity', () => {
    const source = `export App():
  items = ["Alpha", "Beta", "Gamma"]
  reorder():
    items = ["Gamma", "Alpha", "Delta"]
  <main>
    <button onClick={reorder}>Reorder
    <ul>
      {items.map(item => <li key={item}>{item})}
`;
    const analyzed = analyzeSource(source, 'keyed.oxe', 'keyed.oxe');
    if (!analyzed.graph) {
      throw new Error(`Expected a graph, received ${JSON.stringify(analyzed.diagnostics)}.`);
    }
    const createGenerated = runInNewContext(`(${generateDomFactorySource(analyzed.graph)})`) as (
      runtimeApi: typeof runtime,
      domApi: typeof dom,
    ) => { mountApp(container: Node): dom.MountHandle };
    const document = new FakeDocument();
    const container = new FakeElement(document, 'container');
    const mounted = createGenerated(runtime, dom).mountApp(container as unknown as Node);
    const main = childElement(container, 0, 'main');
    const button = childElement(main, 0, 'button');
    const list = childElement(main, 1, 'ul');
    const alpha = childElement(list, 1, 'li');
    const beta = childElement(list, 2, 'li');
    const gamma = childElement(list, 3, 'li');

    expect(list.textContent).toBe('AlphaBetaGamma');
    document.appendedNodes = 0;
    document.removedNodes = 0;
    button.emit('click');

    expect(list.textContent).toBe('GammaAlphaDelta');
    expect(list.childNodes[1]).toBe(gamma);
    expect(list.childNodes[2]).toBe(alpha);
    expect(beta.parentNode).toBeNull();
    expect(document.removedNodes).toBeGreaterThanOrEqual(1);
    expect(document.appendedNodes).toBeGreaterThanOrEqual(1);
    mounted.unmount();
  });

  it('keeps an authored untrack snapshot stable after its source changes', () => {
    const source = `export App():
  count = 0
  snapshot = untrack(count)
  increment():
    count = count + 1
  <main>
    <button onClick={increment}>{count}
    <p>{snapshot}
`;
    const analyzed = analyzeSource(source, 'snapshot.oxe', 'snapshot.oxe');
    if (!analyzed.graph) {
      throw new Error(`Expected a graph, received ${JSON.stringify(analyzed.diagnostics)}.`);
    }
    const createGenerated = runInNewContext(`(${generateDomFactorySource(analyzed.graph)})`) as (
      runtimeApi: typeof runtime,
      domApi: typeof dom,
    ) => { mountApp(container: Node): dom.MountHandle };
    const document = new FakeDocument();
    const container = new FakeElement(document, 'container');
    const mounted = createGenerated(runtime, dom).mountApp(container as unknown as Node);
    const main = childElement(container, 0, 'main');
    const button = childElement(main, 0, 'button');
    const snapshot = childElement(main, 1, 'p');
    expect(button.textContent).toBe('0');
    expect(snapshot.textContent).toBe('0');
    button.emit('click');
    expect(button.textContent).toBe('1');
    expect(snapshot.textContent).toBe('0');
    mounted.unmount();
  });

  it('sets static attributes and updates only a dynamic attribute value', () => {
    const source = `export App():
  title = "First"
  change():
    title = "Second"
  <button class={"primary"} title={title} disabled={false} onClick={change}>{title}
`;
    const analyzed = analyzeSource(source, 'attributes.oxe', 'attributes.oxe');
    if (!analyzed.graph) {
      throw new Error(`Expected a graph, received ${JSON.stringify(analyzed.diagnostics)}.`);
    }
    const createGenerated = runInNewContext(`(${generateDomFactorySource(analyzed.graph)})`) as (
      runtimeApi: typeof runtime,
      domApi: typeof dom,
    ) => { mountApp(container: Node): dom.MountHandle };
    const document = new FakeDocument();
    const container = new FakeElement(document, 'container');
    const mounted = createGenerated(runtime, dom).mountApp(container as unknown as Node);
    const button = childElement(container, 0, 'button');
    expect(button.getAttribute('class')).toBe('primary');
    expect(button.getAttribute('title')).toBe('First');
    expect((button as unknown as { disabled?: boolean }).disabled).toBe(false);
    button.emit('click');
    expect(button.getAttribute('title')).toBe('Second');
    expect(button.textContent).toBe('Second');
    mounted.unmount();
  });

  it('mounts, updates only reactive text, and cleans up through direct DOM operations', async () => {
    const source = await readFile(
      new URL('../../../examples/counter/App.oxe', import.meta.url),
      'utf8',
    );
    const analyzed = analyzeSource(source, 'examples/counter/App.oxe', 'examples/counter/App.oxe');
    if (!analyzed.graph) {
      throw new Error(`Expected a graph, received ${JSON.stringify(analyzed.diagnostics)}.`);
    }

    const factorySource = generateDomFactorySource(analyzed.graph);
    const createGenerated = runInNewContext(`(${factorySource})`) as (
      runtimeApi: typeof runtime,
      domApi: typeof dom,
    ) => {
      mountApp(container: Node): dom.MountHandle;
    };
    const generated = createGenerated(runtime, dom);
    const document = new FakeDocument();
    const container = new FakeElement(document, 'container');
    const mounted = generated.mountApp(container as unknown as Node);

    const main = childElement(container, 0, 'main');
    const button = childElement(main, 0, 'button');
    const doubled = childElement(main, 1, 'p');
    const unchanged = childElement(main, 2, 'p');
    const nodesBefore = collectNodes(main);
    const texts = nodesBefore.filter((node): node is FakeText => node instanceof FakeText);
    const reactiveTexts = texts.filter((text) => text.data === '0');
    const staticText = texts.find((text) => text.data === 'Static');

    expect(main.textContent).toBe('Count: 0Doubled: 0Static');
    expect(button.textContent).toBe('Count: 0');
    expect(doubled.textContent).toBe('Doubled: 0');
    expect(unchanged.textContent).toBe('Static');
    expect(reactiveTexts).toHaveLength(2);
    expect(staticText).toBeDefined();
    expect(button.listenerCount('click')).toBe(1);

    document.appendedNodes = 0;
    document.dataWrites = 0;
    document.removedNodes = 0;
    for (const text of texts) {
      text.writes = 0;
    }

    button.emit('click');

    expect(button.textContent).toBe('Count: 1');
    expect(doubled.textContent).toBe('Doubled: 2');
    expect(unchanged.textContent).toBe('Static');
    expect(collectNodes(main)).toEqual(nodesBefore);
    expect(document.appendedNodes).toBe(0);
    expect(document.removedNodes).toBe(0);
    expect(document.dataWrites).toBe(2);
    expect(reactiveTexts.map((text) => text.writes)).toEqual([1, 1]);
    expect(staticText?.writes).toBe(0);

    mounted.unmount();
    expect(container.childNodes).toEqual([]);
    expect(button.listenerCount('click')).toBe(0);

    button.emit('click');
    expect(button.textContent).toBe('Count: 1');
    expect(doubled.textContent).toBe('Doubled: 2');
  });

  it('keeps a composed child instance and its DOM stable while reactive props update', async () => {
    const source = await readFile(
      new URL('../../../examples/component-composition/App.oxe', import.meta.url),
      'utf8',
    );
    const analyzed = analyzeSource(
      source,
      'examples/component-composition/App.oxe',
      'examples/component-composition/App.oxe',
    );
    if (!analyzed.graph) {
      throw new Error(`Expected a graph, received ${JSON.stringify(analyzed.diagnostics)}.`);
    }

    const createGenerated = runInNewContext(`(${generateDomFactorySource(analyzed.graph)})`) as (
      runtimeApi: typeof runtime,
      domApi: typeof dom,
    ) => { mountApp(container: Node): dom.MountHandle };
    const generated = createGenerated(runtime, dom);
    const document = new FakeDocument();
    const container = new FakeElement(document, 'container');
    const mounted = generated.mountApp(container as unknown as Node);

    const main = childElement(container, 0, 'main');
    const counter = childElement(main, 1, 'section');
    const button = childElement(counter, 0, 'button');
    const doubled = childElement(counter, 1, 'p');
    const nodesBefore = collectNodes(main);

    expect(button.textContent).toBe('Count: 0');
    expect(doubled.textContent).toBe('Doubled: 0');
    expect(button.listenerCount('click')).toBe(1);

    document.appendedNodes = 0;
    document.dataWrites = 0;
    document.removedNodes = 0;
    button.emit('click');

    expect(button.textContent).toBe('Count: 1');
    expect(doubled.textContent).toBe('Doubled: 2');
    expect(collectNodes(main)).toEqual(nodesBefore);
    expect(document.appendedNodes).toBe(0);
    expect(document.removedNodes).toBe(0);
    expect(document.dataWrites).toBe(2);

    mounted.unmount();
    expect(container.childNodes).toEqual([]);
    expect(button.listenerCount('click')).toBe(0);
  });

  it('keeps forwarded children and defaulted reactive props stable through nested composition', async () => {
    const moduleId = 'examples/composition-features/App.oxe';
    const source = await readFile(
      new URL('../../../examples/composition-features/App.oxe', import.meta.url),
      'utf8',
    );
    const analyzed = analyzeSource(source, moduleId, moduleId);
    if (!analyzed.graph) {
      throw new Error(`Expected a graph, received ${JSON.stringify(analyzed.diagnostics)}.`);
    }

    const createGenerated = runInNewContext(`(${generateDomFactorySource(analyzed.graph)})`) as (
      runtimeApi: typeof runtime,
      domApi: typeof dom,
    ) => { mountApp(container: Node): dom.MountHandle };
    const generated = createGenerated(runtime, dom);
    const document = new FakeDocument();
    const container = new FakeElement(document, 'container');
    const mounted = generated.mountApp(container as unknown as Node);

    const main = childElement(container, 0, 'main');
    const button = childElement(main, 0, 'button');
    const card = childElement(main, 1, 'article');
    const heading = childElement(card, 0, 'h2');
    const subtitle = childElement(card, 1, 'p');
    const forwardedChild = childElement(card, 2, 'p');
    const nodesBefore = collectNodes(main);
    const texts = nodesBefore.filter((node): node is FakeText => node instanceof FakeText);

    expect(main.textContent).toBe('ChangeFirstSubtitle: FirstChild: First');
    expect(heading.textContent).toBe('First');
    expect(subtitle.textContent).toBe('Subtitle: First');
    expect(forwardedChild.textContent).toBe('Child: First');
    expect(button.listenerCount('click')).toBe(1);

    document.appendedNodes = 0;
    document.dataWrites = 0;
    document.removedNodes = 0;
    for (const text of texts) {
      text.writes = 0;
    }
    button.emit('click');

    expect(heading.textContent).toBe('Second');
    expect(subtitle.textContent).toBe('Subtitle: Second');
    expect(forwardedChild.textContent).toBe('Child: Second');
    expect(collectNodes(main)).toEqual(nodesBefore);
    expect(document.appendedNodes).toBe(0);
    expect(document.removedNodes).toBe(0);
    expect(document.dataWrites).toBe(3);
    expect(texts.filter((text) => text.writes > 0).map((text) => text.writes)).toEqual([1, 1, 1]);

    mounted.unmount();
    expect(container.childNodes).toEqual([]);
    expect(button.listenerCount('click')).toBe(0);

    button.emit('click');
    expect(heading.textContent).toBe('Second');
    expect(subtitle.textContent).toBe('Subtitle: Second');
    expect(forwardedChild.textContent).toBe('Child: Second');
  });

  it('mounts and reactively updates an imported component without rebuilding its DOM', async () => {
    const files: Readonly<Record<string, string>> = {
      'src/App.oxe': `import { Counter } from "./Counter.oxe"

export App():
  count = 0

  increment():
    count = count + 1

  <main>
    <h1>Imported counter
    <Counter count={count} onIncrement={increment}>
`,
      'src/Counter.oxe': `export Counter(count, onIncrement):
  doubled = count * 2

  <section>
    <button onClick={onIncrement}>Count: {count}
    <p>Doubled: {doubled}
`,
    };
    const analyzed = await analyzeProject({
      entryExport: 'App',
      entryModuleId: 'src/App.oxe',
      loadModule: async (moduleId) => files[moduleId],
    });
    if (!analyzed.graph) {
      throw new Error(`Expected a graph, received ${JSON.stringify(analyzed.diagnostics)}.`);
    }

    const createGenerated = runInNewContext(`(${generateDomFactorySource(analyzed.graph)})`) as (
      runtimeApi: typeof runtime,
      domApi: typeof dom,
    ) => { mountApp(container: Node): dom.MountHandle };
    const generated = createGenerated(runtime, dom);
    const document = new FakeDocument();
    const container = new FakeElement(document, 'container');
    const mounted = generated.mountApp(container as unknown as Node);

    const main = childElement(container, 0, 'main');
    const counter = childElement(main, 1, 'section');
    const button = childElement(counter, 0, 'button');
    const doubled = childElement(counter, 1, 'p');
    const nodesBefore = collectNodes(main);

    expect(main.textContent).toBe('Imported counterCount: 0Doubled: 0');
    document.appendedNodes = 0;
    document.dataWrites = 0;
    document.removedNodes = 0;
    button.emit('click');

    expect(button.textContent).toBe('Count: 1');
    expect(doubled.textContent).toBe('Doubled: 2');
    expect(collectNodes(main)).toEqual(nodesBefore);
    expect(document.appendedNodes).toBe(0);
    expect(document.removedNodes).toBe(0);
    expect(document.dataWrites).toBe(2);

    mounted.unmount();
    expect(container.childNodes).toEqual([]);
    expect(button.listenerCount('click')).toBe(0);
  });
});
