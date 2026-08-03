import {
  createCell,
  createDerived,
  createReaction,
  createRoot,
  registerCleanup,
} from '@oxe/runtime';
import { describe, expect, it } from 'vitest';

import {
  appendChild,
  bindText,
  bindDomValue,
  createConditionalRegion,
  createElement,
  createKeyedRegion,
  createText,
  listen,
  mount,
  setDomValue,
  type TextValue,
} from '../src/index.js';

type FakeListener = (event: Event) => void;

class FakeNode {
  public readonly childNodes: FakeNode[] = [];
  public failNextRemoval = false;
  public parentNode: FakeNode | null = null;

  public get nextSibling(): FakeNode | null {
    if (!this.parentNode) {
      return null;
    }
    const index = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[index + 1] ?? null;
  }

  public appendChild<Child extends FakeNode>(child: Child): Child {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  public removeChild<Child extends FakeNode>(child: Child): Child {
    if (this.failNextRemoval) {
      this.failNextRemoval = false;
      throw new Error('Deliberate removal failure.');
    }

    const index = this.childNodes.indexOf(child);
    if (index < 0) {
      throw new Error('The node is not a child of this parent.');
    }

    this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  public insertBefore<Child extends FakeNode>(child: Child, reference: FakeNode | null): Child {
    if (reference === null) {
      return this.appendChild(child);
    }
    const referenceIndex = this.childNodes.indexOf(reference);
    if (referenceIndex < 0) {
      throw new Error('The reference node is not a child of this parent.');
    }
    if (child === reference) {
      return child;
    }
    child.parentNode?.removeChild(child);
    const nextReferenceIndex = this.childNodes.indexOf(reference);
    child.parentNode = this;
    this.childNodes.splice(nextReferenceIndex, 0, child);
    return child;
  }
}

class FakeText extends FakeNode {
  public constructor(public data: string) {
    super();
  }
}

class FakeElement extends FakeNode {
  readonly #listeners = new Map<string, Set<FakeListener>>();
  readonly #attributes = new Map<string, string>();

  public constructor(public readonly tagName: string) {
    super();
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

class FakeDocument {
  public createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }

  public createTextNode(data: string): FakeText {
    return new FakeText(data);
  }
}

const asDocument = (document: FakeDocument): Document => document as unknown as Document;
const asNode = (node: FakeNode): Node => node as unknown as Node;
const asFakeElement = (element: Element): FakeElement => element as unknown as FakeElement;
const asFakeText = (text: Text): FakeText => text as unknown as FakeText;

describe('direct DOM primitives', () => {
  it('creates and appends real node-shaped values without HTML parsing', () => {
    const document = asDocument(new FakeDocument());
    const parent = createElement(document, 'main');
    const child = createElement(document, 'h1');
    const text = createText(document, 'OXE');

    appendChild(child, text);
    appendChild(parent, child);

    expect(asFakeElement(parent).tagName).toBe('main');
    expect(asFakeElement(child).tagName).toBe('h1');
    expect(asFakeText(text).data).toBe('OXE');
    expect(asFakeElement(parent).childNodes).toEqual([asFakeElement(child)]);
    expect(asFakeElement(child).childNodes).toEqual([asFakeText(text)]);
  });

  it('owns reactive text bindings for the lifetime of a mount', () => {
    const document = asDocument(new FakeDocument());
    const container = new FakeElement('container');
    const label = createCell<TextValue>('first', { name: 'label' });
    let text: FakeText | undefined;

    const mounted = mount(asNode(container), () => {
      const output = createElement(document, 'output');
      const textNode = createText(document);
      text = asFakeText(textNode);
      appendChild(output, textNode);
      bindText(textNode, label);
      return output;
    });

    if (!text) {
      throw new Error('The mounted text node was not created.');
    }

    expect(text.data).toBe('first');
    expect(container.childNodes).toHaveLength(1);

    label.write('second');
    expect(text.data).toBe('second');

    label.write(null);
    expect(text.data).toBe('');

    mounted.unmount();
    expect(container.childNodes).toEqual([]);

    label.write('after unmount');
    expect(text.data).toBe('');
  });

  it('sets static DOM values and owns reactive attribute updates', () => {
    const document = asDocument(new FakeDocument());
    const container = new FakeElement('container');
    const title = createCell('First', { name: 'title' });
    let button: FakeElement | undefined;
    const mounted = mount(asNode(container), () => {
      const element = createElement(document, 'button');
      button = asFakeElement(element);
      setDomValue(element, 'class', 'attribute', 'primary');
      setDomValue(element, 'disabled', 'property', false);
      bindDomValue(element, 'title', 'attribute', title);
      return element;
    });
    expect(button?.getAttribute('class')).toBe('primary');
    expect(button?.getAttribute('title')).toBe('First');
    expect((button as unknown as { disabled?: boolean } | undefined)?.disabled).toBe(false);
    title.write('Second');
    expect(button?.getAttribute('title')).toBe('Second');
    mounted.unmount();
    title.write('After');
    expect(button?.getAttribute('title')).toBe('Second');
  });

  it('keeps specialized child DOM stable and disposes its nested component owner', () => {
    const document = asDocument(new FakeDocument());
    const container = new FakeElement('container');
    const count = createCell(1, { name: 'parent count' });
    const subscriptionEvents: string[] = [];
    let child: FakeElement | undefined;
    let childText: FakeText | undefined;
    let button: FakeElement | undefined;

    const mounted = mount(asNode(container), () => {
      const parent = createElement(document, 'main');
      const childScope = createRoot(
        () => {
          subscriptionEvents.push('subscribe');
          registerCleanup(() => subscriptionEvents.push('unsubscribe'));

          const section = createElement(document, 'section');
          const countButton = createElement(document, 'button');
          const text = createText(document);
          const doubled = createDerived([count], () => count.read() * 2, {
            name: 'child doubled',
          });

          child = asFakeElement(section);
          childText = asFakeText(text);
          button = asFakeElement(countButton);
          appendChild(countButton, text);
          appendChild(section, countButton);
          bindText(text, doubled);
          listen(countButton, 'click', () => count.write(count.read() + 1));
          return section;
        },
        { name: 'Counter component' },
      );

      appendChild(parent, childScope.value);
      return parent;
    });

    const mountedParent = container.childNodes[0];
    const mountedChild = child;
    const mountedText = childText;

    expect(subscriptionEvents).toEqual(['subscribe']);
    expect(mountedText?.data).toBe('2');

    button?.emit('click');

    expect(count.read()).toBe(2);
    expect(container.childNodes[0]).toBe(mountedParent);
    expect(mountedParent?.childNodes[0]).toBe(mountedChild);
    expect(child?.childNodes[0]?.childNodes[0]).toBe(mountedText);
    expect(mountedText?.data).toBe('4');

    mounted.unmount();

    expect(subscriptionEvents).toEqual(['subscribe', 'unsubscribe']);
    expect(button?.listenerCount('click')).toBe(0);

    count.write(3);
    expect(mountedText?.data).toBe('4');
  });

  it('removes owned event listeners and supports idempotent unmounting', () => {
    const document = asDocument(new FakeDocument());
    const container = new FakeElement('container');
    let clicks = 0;
    let button: FakeElement | undefined;

    const mounted = mount(asNode(container), () => {
      const element = createElement(document, 'button');
      button = asFakeElement(element);
      listen(element, 'click', () => {
        clicks += 1;
      });
      return element;
    });

    expect(button).toBeDefined();
    expect(button?.listenerCount('click')).toBe(1);
    button?.emit('click');
    expect(clicks).toBe(1);

    mounted.unmount();
    mounted.unmount();

    expect(button?.listenerCount('click')).toBe(0);
    button?.emit('click');
    expect(clicks).toBe(1);
  });

  it('batches every event handler as one transactional procedure', () => {
    const document = asDocument(new FakeDocument());
    const container = new FakeElement('container');
    const count = createCell(0, { name: 'count' });
    const values: number[] = [];
    let button: FakeElement | undefined;

    const mounted = mount(asNode(container), () => {
      const element = createElement(document, 'button');
      button = asFakeElement(element);
      createReaction([count], () => values.push(count.read()), { name: 'count observer' });
      listen(element, 'click', () => {
        count.write(count.read() + 1);
        count.write(count.read() + 1);
      });
      return element;
    });

    button?.emit('click');
    expect(values).toEqual([0, 2]);
    mounted.unmount();
  });

  it('snapshots listener capture so mutable options cannot leak the listener', () => {
    const document = asDocument(new FakeDocument());
    const container = new FakeElement('container');
    const options: AddEventListenerOptions = { capture: true };
    let button: FakeElement | undefined;

    const mounted = mount(asNode(container), () => {
      const element = createElement(document, 'button');
      button = asFakeElement(element);
      listen(element, 'click', () => undefined, options);
      return element;
    });

    options.capture = false;
    mounted.unmount();
    expect(button?.listenerCount('click')).toBe(0);
  });

  it('retries a DOM node removal that failed during an earlier unmount', () => {
    const document = asDocument(new FakeDocument());
    const container = new FakeElement('container');
    const mounted = mount(asNode(container), () => createElement(document, 'main'));

    container.failNextRemoval = true;
    expect(() => mounted.unmount()).toThrow('Deliberate removal failure');
    expect(container.childNodes).toHaveLength(1);

    expect(() => mounted.unmount()).not.toThrow();
    expect(container.childNodes).toEqual([]);
  });

  it('mounts and removes multiple root nodes in source order', () => {
    const document = asDocument(new FakeDocument());
    const container = new FakeElement('container');
    const first = createText(document, 'first');
    const second = createText(document, 'second');

    const mounted = mount(asNode(container), () => [first, second]);

    expect(container.childNodes).toEqual([asFakeText(first), asFakeText(second)]);

    mounted.unmount();
    expect(container.childNodes).toEqual([]);
  });

  it('replaces only a changed conditional branch and disposes the previous branch owner', () => {
    const document = asDocument(new FakeDocument());
    const container = new FakeElement('container');
    const visible = createCell(true, { name: 'visible' });
    const cleanups: string[] = [];
    let firstBranch: FakeElement | undefined;

    const mounted = mount(asNode(container), () => {
      const main = createElement(document, 'main');
      const region = createConditionalRegion(
        document,
        visible,
        (selection) => {
          registerCleanup(() => cleanups.push(selection ? 'visible' : 'hidden'));
          const branch = createElement(document, selection ? 'section' : 'p');
          appendChild(branch, createText(document, selection ? 'Visible' : 'Hidden'));
          if (selection) {
            firstBranch = asFakeElement(branch);
          }
          return branch;
        },
        { name: 'visibility' },
      );
      for (const node of region) {
        appendChild(main, node);
      }
      return main;
    });

    const main = container.childNodes[0];
    expect(main?.childNodes[1]).toBe(firstBranch);
    expect(firstBranch?.childNodes[0]).toMatchObject({ data: 'Visible' });

    visible.write(false);
    expect(cleanups).toEqual(['visible']);
    expect(main?.childNodes).toHaveLength(3);
    expect((main?.childNodes[1] as FakeElement | undefined)?.tagName).toBe('p');
    expect(main?.childNodes[1]?.childNodes[0]).toMatchObject({ data: 'Hidden' });
    expect(firstBranch?.parentNode).toBeNull();

    mounted.unmount();
    expect(cleanups).toEqual(['visible', 'hidden']);
  });

  it('reuses keyed rows while inserting, moving, removing, and disposing by key', () => {
    const document = asDocument(new FakeDocument());
    const container = new FakeElement('container');
    const items = createCell<readonly string[]>(['A', 'B', 'C'], { name: 'items' });
    const rows = new Map<string, FakeElement>();
    const disposed: string[] = [];

    const mounted = mount(asNode(container), () => {
      const list = createElement(document, 'ul');
      const region = createKeyedRegion(document, items, {
        key: (item) => item,
        name: 'letters',
        render: (item) => {
          const initial = item.read();
          registerCleanup(() => disposed.push(initial));
          const row = createElement(document, 'li');
          const label = createText(document);
          bindText(label, item);
          appendChild(row, label);
          rows.set(initial, asFakeElement(row));
          return row;
        },
      });
      for (const node of region) {
        appendChild(list, node);
      }
      return list;
    });

    const list = container.childNodes[0];
    const rowA = rows.get('A');
    const rowB = rows.get('B');
    const rowC = rows.get('C');
    expect(list?.childNodes.slice(1, -1)).toEqual([rowA, rowB, rowC]);

    items.write(['C', 'A', 'D']);
    expect(list?.childNodes.slice(1, -1)).toEqual([rowC, rowA, rows.get('D')]);
    expect(rows.get('A')).toBe(rowA);
    expect(rows.get('C')).toBe(rowC);
    expect(rowB?.parentNode).toBeNull();
    expect(disposed).toEqual(['B']);

    expect(() => items.write(['A', 'A'])).toThrow('duplicate key A');
    mounted.unmount();
    expect(disposed).toEqual(expect.arrayContaining(['A', 'B', 'C', 'D']));
  });
});
