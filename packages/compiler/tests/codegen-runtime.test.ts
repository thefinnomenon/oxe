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

  public cloneNode(deep = false): FakeNode {
    void deep;
    throw new Error('cloneNode must be implemented by concrete fake nodes.');
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

  public override cloneNode(): FakeText {
    return new FakeText(this.ownerDocument, this.#data);
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

  public override cloneNode(deep = false): FakeElement {
    const clone = new FakeElement(this.ownerDocument, this.tagName);
    for (const [name, value] of this.#attributes) {
      clone.setAttribute(name, value);
    }
    if (deep) {
      for (const child of this.childNodes) {
        clone.appendChild(child.cloneNode(true));
      }
    }
    return clone;
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

const childText = (parent: FakeNode, index: number): FakeText => {
  const child = parent.childNodes[index];
  if (!(child instanceof FakeText)) {
    throw new Error(`Expected child ${index} to be text.`);
  }
  return child;
};

describe('generated counter with the OXE runtime', () => {
  it('switches a conditional region incrementally and disposes the removed branch', () => {
    const source = `export App():
  visible = true
  hide():
    visible = false
  show():
    visible = true
  <main>
    <button onClick={hide}>Hide
    <button onClick={show}>Show
    ?
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

  it('updates inline and first-match =? conditional values through derived bindings', () => {
    const source = `export App():
  primary = true
  secondary = true
  showSecondary():
    primary = false
  showFallback():
    primary = false
    secondary = false
  reset():
    primary = true
    secondary = true
  label =?
    primary ? "Primary"
    secondary ? "Secondary"
    : "Fallback"
  compact = primary ? "Yes" : "No"
  <main>
    <button onClick={showSecondary}>Secondary
    <button onClick={showFallback}>Fallback
    <button onClick={reset}>Reset
    <p>{label}
    <p>{compact}
`;
    const analyzed = analyzeSource(source, 'conditional-value.oxe', 'conditional-value.oxe');
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
    const showSecondary = childElement(main, 0, 'button');
    const showFallback = childElement(main, 1, 'button');
    const reset = childElement(main, 2, 'button');

    expect(main.textContent).toBe('SecondaryFallbackResetPrimaryYes');
    showSecondary.emit('click');
    expect(main.textContent).toBe('SecondaryFallbackResetSecondaryNo');
    showFallback.emit('click');
    expect(main.textContent).toBe('SecondaryFallbackResetFallbackNo');
    reset.emit('click');
    expect(main.textContent).toBe('SecondaryFallbackResetPrimaryYes');

    mounted.unmount();
  });

  it('instantiates captured content per placement and disposes replaced branch ownership', () => {
    const source = `export App():
  visible = true
  hide():
    visible = false
  show():
    visible = true
  view =?
    visible ?
      label = "Visible"
      <button onClick={hide}>{label}
    : <p>Hidden

  <main>
    <button onClick={show}>Show
    {view}
    {view}
`;
    const analyzed = analyzeSource(source, 'content-value.oxe', 'content-value.oxe');
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
    const show = childElement(main, 0, 'button');
    const visibleButtons = collectNodes(main).filter(
      (node): node is FakeElement => node instanceof FakeElement && node.tagName === 'button',
    );

    expect(main.textContent).toBe('ShowVisibleVisible');
    expect(visibleButtons).toHaveLength(3);
    visibleButtons[1]?.emit('click');
    expect(main.textContent).toBe('ShowHiddenHidden');
    expect(visibleButtons[1]?.parentNode).toBeNull();
    expect(visibleButtons[2]?.parentNode).toBeNull();
    expect(visibleButtons[1]?.listenerCount('click')).toBe(0);
    expect(visibleButtons[2]?.listenerCount('click')).toBe(0);

    show.emit('click');
    expect(main.textContent).toBe('ShowVisibleVisible');
    mounted.unmount();
  });

  it('passes arguments through ordinary procedure capability calls', () => {
    const source = `export App():
  count = 0
  update(value):
    count = value
  <main>
    <Child onUpdate={update}>
    <p>{count}

Child(onUpdate):
  send():
    onUpdate(2)
  <button onClick={send}>Send
`;
    const analyzed = analyzeSource(source, 'calls.oxe', 'calls.oxe');
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
    const send = childElement(main, 0, 'button');

    expect(main.textContent).toBe('Send0');
    send.emit('click');
    expect(main.textContent).toBe('Send2');
    mounted.unmount();
  });

  it('executes records, member reads, and value collection operations', () => {
    const source = `export App():
  users = [{ name: "Ada", active: true }, { name: "Lin", active: false }]
  active = users.filter(user => user.active)
  names = active.map(user =>
    name = user.name
    name
  )
  repeated = [1, 2].flatMap(value => [value, value])
  total = [1, 2, 3].reduce((sum, value) => sum + value, 0)
  summary = { meta: { label: "Active" }, count: active.length }
  <main>
    <p>{summary.meta.label}: {summary.count}: {names.length}: {repeated.length}: {total}
    {users.map(user => <p key={user.name}>{user.name})}
`;
    const analyzed = analyzeSource(source, 'expressions.oxe', 'expressions.oxe');
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

    expect(container.textContent).toBe('Active: 1: 1: 4: 6AdaLin');
    mounted.unmount();
  });

  it('executes add, limited update, remove, pure sort, and record writes incrementally', () => {
    const source = `export App():
  users = [{ id: 1, name: "Ada", active: false }, { id: 2, name: "Lin", active: true }]
  profile = { status: "Ready" }
  ordered = users.sort(user => user.name)
  rename():
    users.update(user => user.active == false, user => user.name = "Zoe", 1)
    profile.status = "Renamed"
  add():
    users.add({ id: 3, name: "Bea", active: true })
  remove():
    users.remove(user => user.id == 2, 1)
  <main>
    <button onClick={rename}>Rename
    <button onClick={add}>Add
    <button onClick={remove}>Remove
    <p>{profile.status}
    <ul>
      {ordered.map(user => <li key={user.id}>{user.name})}
`;
    const analyzed = analyzeSource(source, 'mutations.oxe', 'mutations.oxe');
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
    const rename = childElement(main, 0, 'button');
    const add = childElement(main, 1, 'button');
    const remove = childElement(main, 2, 'button');
    const status = childElement(main, 3, 'p');
    const list = childElement(main, 4, 'ul');
    const ada = childElement(list, 1, 'li');
    const lin = childElement(list, 2, 'li');
    const adaText = childText(ada, 0);
    const linText = childText(lin, 0);
    const initialAdaWrites = adaText.writes;
    const initialLinWrites = linText.writes;

    expect(status.textContent).toBe('Ready');
    expect(list.textContent).toBe('AdaLin');
    rename.emit('click');

    expect(status.textContent).toBe('Renamed');
    expect(list.textContent).toBe('LinZoe');
    expect(list.childNodes[1]).toBe(lin);
    expect(list.childNodes[2]).toBe(ada);
    expect(adaText.writes).toBe(initialAdaWrites + 1);
    expect(linText.writes).toBe(initialLinWrites);

    add.emit('click');
    const bea = childElement(list, 1, 'li');
    expect(list.textContent).toBe('BeaLinZoe');
    expect(list.childNodes[2]).toBe(lin);
    expect(list.childNodes[3]).toBe(ada);

    remove.emit('click');
    expect(list.textContent).toBe('BeaZoe');
    expect(list.childNodes[1]).toBe(bea);
    expect(list.childNodes[2]).toBe(ada);
    expect(lin.parentNode).toBeNull();
    mounted.unmount();
  });

  it('updates only DOM consumers of changed standalone record fields', () => {
    const source = `export App():
  profile = { name: "Ada", stats: { score: 1, ignored: 0 }, status: "Ready" }
  score():
    profile.stats.score = profile.stats.score + 1
  ignore():
    profile.stats.ignored = profile.stats.ignored + 1
  rename():
    profile.name = "Grace"
  <main>
    <button onClick={score}>Score
    <button onClick={ignore}>Ignore
    <button onClick={rename}>Rename
    <p>{profile.name}
    <p>{profile.stats.score}
    <p>{profile.status}
`;
    const analyzed = analyzeSource(source, 'record-paths.oxe', 'record-paths.oxe');
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
    const score = childElement(main, 0, 'button');
    const ignore = childElement(main, 1, 'button');
    const rename = childElement(main, 2, 'button');
    const nameText = childText(childElement(main, 3, 'p'), 0);
    const scoreText = childText(childElement(main, 4, 'p'), 0);
    const statusText = childText(childElement(main, 5, 'p'), 0);
    const initialWrites = {
      name: nameText.writes,
      score: scoreText.writes,
      status: statusText.writes,
    };

    score.emit('click');
    expect(main.textContent).toBe('ScoreIgnoreRenameAda2Ready');
    expect(nameText.writes).toBe(initialWrites.name);
    expect(scoreText.writes).toBe(initialWrites.score + 1);
    expect(statusText.writes).toBe(initialWrites.status);

    ignore.emit('click');
    expect(nameText.writes).toBe(initialWrites.name);
    expect(scoreText.writes).toBe(initialWrites.score + 1);
    expect(statusText.writes).toBe(initialWrites.status);

    rename.emit('click');
    expect(main.textContent).toBe('ScoreIgnoreRenameGrace2Ready');
    expect(nameText.writes).toBe(initialWrites.name + 1);
    expect(scoreText.writes).toBe(initialWrites.score + 1);
    expect(statusText.writes).toBe(initialWrites.status);
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

  it('preserves writable context identity across a generated provider boundary', () => {
    const source = `Session = createContext()

App():
  session = { name: "Ada", role: "admin" }
  <Session value={session}>
    <Header>

Header():
  session = Session()
  rename():
    session.name = "Grace"
  <button onClick={rename}>{session.name}
`;
    const analyzed = analyzeSource(source, 'context.oxe', 'context.oxe');
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

    expect(button.textContent).toBe('Ada');
    button.emit('click');
    expect(button.textContent).toBe('Grace');
    mounted.unmount();
  });
});
