import {
  createAsyncResource,
  createAsyncResourceCoordinator,
  createCell,
  createDerived,
  createReaction,
  createRoot,
  registerCleanup,
} from '@oxe/runtime';
import { describe, expect, it } from 'vitest';

import {
  appendChild,
  bindAsyncDomValue,
  bindAsyncText,
  bindText,
  bindDomValue,
  createConditionalRegion,
  createElement,
  createKeyedRegion,
  createStaticTemplate,
  createText,
  hydrate,
  listen,
  mount,
  OxeHydrationBuildMismatch,
  OxeHydrationMismatch,
  readSerializedAsyncCheckpoints,
  readSerializedLocalizationContext,
  setDomValue,
  type TextValue,
} from '../src/index.js';

type FakeListener = (event: Event) => void;

class FakeNode {
  public readonly nodeType: number = 0;
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

  public cloneNode(deep = false): FakeNode {
    void deep;
    throw new Error('cloneNode must be implemented by concrete fake nodes.');
  }
}

class FakeText extends FakeNode {
  public override readonly nodeType = 3;
  public constructor(public data: string) {
    super();
  }

  public override cloneNode(): FakeText {
    return new FakeText(this.data);
  }
}

class FakeComment extends FakeNode {
  public override readonly nodeType = 8;
  public constructor(public data: string) {
    super();
  }

  public override cloneNode(): FakeComment {
    return new FakeComment(this.data);
  }
}

class FakeElement extends FakeNode {
  public override readonly nodeType = 1;
  readonly #listeners = new Map<string, Set<FakeListener>>();
  readonly #attributes = new Map<string, string>();

  public constructor(public readonly tagName: string) {
    super();
  }

  public get localName(): string {
    return this.tagName;
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

  public dispatchEvent(event: Event): boolean {
    this.emit(event.type);
    return true;
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
    const clone = new FakeElement(this.tagName);
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

class FakeDocument {
  public createComment(data: string): FakeComment {
    return new FakeComment(data);
  }

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

  it('builds one static template per document and returns independent deep clones', () => {
    const document = asDocument(new FakeDocument());
    const template = createStaticTemplate({
      tag: 'article',
      attributes: [{ mode: 'attribute', name: 'class', value: 'card' }],
      children: [{ tag: 'h2', children: ['Hello'] }],
    });

    const first = asFakeElement(template(document) as Element);
    const second = asFakeElement(template(document) as Element);
    expect(first).not.toBe(second);
    expect(first.childNodes[0]).not.toBe(second.childNodes[0]);
    expect(first.getAttribute('class')).toBe('card');
  });

  it('hydrates matching DOM by identity and attaches reactive updates without replacement', () => {
    const document = asDocument(new FakeDocument());
    const container = new FakeElement('container');
    const serverMain = new FakeElement('main');
    const serverHeading = new FakeElement('h1');
    const serverLabel = new FakeText('Count: ');
    const serverValue = new FakeText('1');
    serverHeading.appendChild(serverLabel);
    serverHeading.appendChild(serverValue);
    serverMain.appendChild(serverHeading);
    container.appendChild(serverMain);
    let increment: (() => void) | undefined;

    const hydrated = hydrate(asNode(container), () => {
      const count = createCell(1, { name: 'count' });
      increment = () => count.write(count.read() + 1);
      const main = createElement(document, 'main');
      const heading = createElement(document, 'h1');
      appendChild(heading, createText(document, 'Count: '));
      const value = createText(document);
      bindText(value, count);
      appendChild(heading, value);
      appendChild(main, heading);
      return main;
    });

    expect(container.childNodes[0]).toBe(serverMain);
    expect(serverMain.childNodes[0]).toBe(serverHeading);
    expect(serverHeading.childNodes).toEqual([serverLabel, serverValue]);
    increment?.();
    expect(serverValue.data).toBe('2');
    hydrated.unmount();
    expect(container.childNodes).toEqual([]);
  });

  it('reads versioned localization state while retaining legacy async checkpoints', () => {
    const context = {
      calendar: 'gregory',
      locale: 'fr-FR',
      numberingSystem: 'latn',
      schemaVersion: 'oxe.localization-context.v1',
      timeZone: 'UTC',
    };
    const document = {
      querySelector: () => ({
        textContent: JSON.stringify({
          checkpoints: [{ identity: 'user:1', value: { name: 'Ada' } }],
          localization: context,
          schemaVersion: 'oxe.hydration-state.v1',
        }),
      }),
    } as unknown as Document;

    expect(readSerializedAsyncCheckpoints(document)).toEqual([
      { identity: 'user:1', value: { name: 'Ada' } },
    ]);
    expect(readSerializedLocalizationContext(document)).toEqual(context);

    const legacy = {
      querySelector: () => ({ textContent: '[{"identity":"legacy","value":1}]' }),
    } as unknown as Document;
    expect(readSerializedAsyncCheckpoints(legacy)).toEqual([{ identity: 'legacy', value: 1 }]);
    expect(readSerializedLocalizationContext(legacy)).toBeUndefined();
  });

  it('adopts a conditional region between compiler-owned comment markers', () => {
    const document = asDocument(new FakeDocument());
    const container = new FakeElement('container');
    const start = new FakeComment('oxe:profile%2Dchoice:start');
    const serverBranch = new FakeElement('strong');
    serverBranch.appendChild(new FakeText('Active'));
    const end = new FakeComment('oxe:profile%2Dchoice:end');
    container.appendChild(start);
    container.appendChild(serverBranch);
    container.appendChild(end);
    const active = createCell(true, { name: 'active' });

    const hydrated = hydrate(asNode(container), () =>
      createConditionalRegion(
        document,
        active,
        (visible) => {
          const element = createElement(document, visible ? 'strong' : 'em');
          appendChild(element, createText(document, visible ? 'Active' : 'Inactive'));
          return element;
        },
        { hydrationId: 'profile%2Dchoice' },
      ),
    );

    expect(container.childNodes).toEqual([start, serverBranch, end]);
    active.write(false);
    expect(container.childNodes[0]).toBe(start);
    expect((container.childNodes[1] as FakeElement | undefined)?.tagName).toBe('em');
    expect(container.childNodes[2]).toBe(end);
    hydrated.unmount();
  });

  it('adopts keyed rows between markers and preserves them during reordering', () => {
    const document = asDocument(new FakeDocument());
    const container = new FakeElement('container');
    const start = new FakeComment('oxe:users%2Dlist:start');
    const first = new FakeElement('li');
    first.appendChild(new FakeText('Ada'));
    const second = new FakeElement('li');
    second.appendChild(new FakeText('Grace'));
    const end = new FakeComment('oxe:users%2Dlist:end');
    container.appendChild(start);
    container.appendChild(first);
    container.appendChild(second);
    container.appendChild(end);
    const users = createCell(
      [
        { id: 1, name: 'Ada' },
        { id: 2, name: 'Grace' },
      ],
      { name: 'users' },
    );

    const hydrated = hydrate(asNode(container), () =>
      createKeyedRegion(document, users, {
        hydrationId: 'users%2Dlist',
        key: (user) => user.id,
        render: (user) => {
          const item = createElement(document, 'li');
          const text = createText(document);
          bindText(
            text,
            createDerived([user], () => user.read().name, { name: 'user name' }),
          );
          appendChild(item, text);
          return item;
        },
      }),
    );

    expect(container.childNodes).toEqual([start, first, second, end]);
    users.write([
      { id: 2, name: 'Grace Hopper' },
      { id: 1, name: 'Ada Lovelace' },
    ]);
    expect(container.childNodes).toEqual([start, second, first, end]);
    expect((second.childNodes[0] as FakeText | undefined)?.data).toBe('Grace Hopper');
    expect((first.childNodes[0] as FakeText | undefined)?.data).toBe('Ada Lovelace');
    hydrated.unmount();
  });

  it('replays captured early events in order after listeners attach', () => {
    const document = asDocument(new FakeDocument());
    const container = new FakeElement('container');
    const serverButton = new FakeElement('button');
    const serverCount = new FakeText('0');
    serverButton.appendChild(serverCount);
    container.appendChild(serverButton);
    const earlyGlobal = globalThis as typeof globalThis & {
      __oxeEarly?: { events: { target: string; type: string }[] };
    };
    earlyGlobal.__oxeEarly = {
      events: [
        { target: 'counter%2Dbutton', type: 'click' },
        { target: 'counter%2Dbutton', type: 'click' },
      ],
    };

    try {
      const hydrated = hydrate(asNode(container), () => {
        const count = createCell(0, { name: 'count' });
        const button = createElement(document, 'button');
        const text = createText(document);
        bindText(text, count);
        appendChild(button, text);
        listen(button, 'click', () => count.write(count.read() + 1), {
          replayId: 'counter%2Dbutton',
        });
        return button;
      });

      expect(container.childNodes[0]).toBe(serverButton);
      expect(serverCount.data).toBe('2');
      expect(earlyGlobal.__oxeEarly?.events).toEqual([]);
      hydrated.unmount();
    } finally {
      delete earlyGlobal.__oxeEarly;
    }
  });

  it('replays early events to the matching repeated target occurrence', () => {
    const document = asDocument(new FakeDocument());
    const container = new FakeElement('container');
    const serverButtons = [new FakeElement('button'), new FakeElement('button')];
    const serverCounts = [new FakeText('0'), new FakeText('0')];
    serverButtons.forEach((button, index) => {
      const count = serverCounts[index];
      if (!count) throw new Error('Expected a server count node.');
      button.appendChild(count);
      container.appendChild(button);
    });
    const earlyGlobal = globalThis as typeof globalThis & {
      __oxeEarly?: {
        events: { occurrence?: number; target: string; type: string }[];
      };
    };
    earlyGlobal.__oxeEarly = {
      events: [
        { occurrence: 1, target: 'row%2Dbutton', type: 'click' },
        { occurrence: 0, target: 'row%2Dbutton', type: 'click' },
        { occurrence: 1, target: 'row%2Dbutton', type: 'click' },
      ],
    };

    try {
      const hydrated = hydrate(asNode(container), () =>
        [0, 1].map(() => {
          const count = createCell(0, { name: 'row count' });
          const button = createElement(document, 'button');
          const text = createText(document);
          bindText(text, count);
          appendChild(button, text);
          listen(button, 'click', () => count.write(count.read() + 1), {
            replayId: 'row%2Dbutton',
          });
          return button;
        }),
      );

      expect(serverCounts.map((count) => count.data)).toEqual(['1', '2']);
      expect(earlyGlobal.__oxeEarly.events).toEqual([]);
      hydrated.unmount();
    } finally {
      delete earlyGlobal.__oxeEarly;
    }
  });

  it('reports exact hydration mismatches and supports controlled replacement recovery', () => {
    const document = asDocument(new FakeDocument());
    const build = (): Element => {
      const main = createElement(document, 'main');
      appendChild(main, createText(document, 'Client'));
      return main;
    };
    const throwingContainer = new FakeElement('container');
    throwingContainer.appendChild(new FakeElement('p'));
    expect(() => hydrate(asNode(throwingContainer), build)).toThrow(OxeHydrationMismatch);

    const recoveringContainer = new FakeElement('container');
    const stale = new FakeElement('p');
    recoveringContainer.appendChild(stale);
    const recovered = hydrate(asNode(recoveringContainer), build, { mismatch: 'replace' });
    expect(recoveringContainer.childNodes[0]).not.toBe(stale);
    expect((recoveringContainer.childNodes[0] as FakeElement | undefined)?.tagName).toBe('main');
    recovered.unmount();
  });

  it('rejects incompatible server and client build fingerprints before adoption', () => {
    const container = new FakeElement('container');
    container.appendChild(new FakeElement('main'));

    expect(() =>
      hydrate(
        asNode(container),
        () => asNode(container.childNodes[0] as FakeElement) as ChildNode,
        {
          actualBuildFingerprint: 'oxe-server',
          buildMismatch: 'throw',
          expectedBuildFingerprint: 'oxe-client',
        },
      ),
    ).toThrow(OxeHydrationBuildMismatch);
  });

  it('recovers only the nearest compiler-owned structural boundary', () => {
    const document = asDocument(new FakeDocument());
    const container = new FakeElement('container');
    const staticServer = new FakeElement('p');
    staticServer.appendChild(new FakeText('Static'));
    const start = new FakeComment('oxe:profile%2Dchoice:start');
    const staleBranch = new FakeElement('strong');
    staleBranch.appendChild(new FakeText('Stale'));
    const end = new FakeComment('oxe:profile%2Dchoice:end');
    container.appendChild(staticServer);
    container.appendChild(start);
    container.appendChild(staleBranch);
    container.appendChild(end);
    const mismatches: OxeHydrationMismatch[] = [];

    const hydrated = hydrate(
      asNode(container),
      () => {
        const staticClient = createElement(document, 'p');
        appendChild(staticClient, createText(document, 'Static'));
        const region = createConditionalRegion(
          document,
          createCell(true, { name: 'active' }),
          () => {
            const branch = createElement(document, 'strong');
            appendChild(branch, createText(document, 'Fresh'));
            return branch;
          },
          {
            hydrationId: 'profile%2Dchoice',
            name: 'Profile choice',
            source: 'profile.oxe:4:5',
          },
        );
        return [staticClient, ...region];
      },
      { mismatch: 'recover', onMismatch: (error) => mismatches.push(error) },
    );

    expect(container.childNodes[0]).toBe(staticServer);
    expect(container.childNodes[1]).toBe(start);
    expect(container.childNodes[2]).not.toBe(staleBranch);
    expect((container.childNodes[2] as FakeElement | undefined)?.tagName).toBe('strong');
    expect((container.childNodes[2]?.childNodes[0] as FakeText | undefined)?.data).toBe('Fresh');
    expect(container.childNodes[3]).toBe(end);
    expect(mismatches).toEqual([
      expect.objectContaining({
        boundaryId: 'profile%2Dchoice',
        boundaryName: 'Profile choice',
        boundarySource: 'profile.oxe:4:5',
      }),
    ]);
    hydrated.unmount();
  });

  it('recovers a mismatched keyed boundary without replacing static siblings', () => {
    const document = asDocument(new FakeDocument());
    const container = new FakeElement('container');
    const staticServer = new FakeElement('h1');
    staticServer.appendChild(new FakeText('Users'));
    const start = new FakeComment('oxe:users%2Dlist:start');
    const staleRow = new FakeElement('li');
    staleRow.appendChild(new FakeText('Stale'));
    const end = new FakeComment('oxe:users%2Dlist:end');
    container.appendChild(staticServer);
    container.appendChild(start);
    container.appendChild(staleRow);
    container.appendChild(end);

    const hydrated = hydrate(
      asNode(container),
      () => {
        const heading = createElement(document, 'h1');
        appendChild(heading, createText(document, 'Users'));
        const rows = createKeyedRegion(
          document,
          createCell([{ id: 1, name: 'Ada' }], { name: 'users' }),
          {
            hydrationId: 'users%2Dlist',
            key: (user) => user.id,
            render: (user) => {
              const row = createElement(document, 'li');
              appendChild(row, createText(document, user.read().name));
              return row;
            },
          },
        );
        return [heading, ...rows];
      },
      { mismatch: 'recover' },
    );

    expect(container.childNodes[0]).toBe(staticServer);
    expect(container.childNodes[1]).toBe(start);
    expect(container.childNodes[2]).not.toBe(staleRow);
    expect((container.childNodes[2]?.childNodes[0] as FakeText | undefined)?.data).toBe('Ada');
    expect(container.childNodes[3]).toBe(end);
    hydrated.unmount();
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

  it('reports a shared async failure once without rendering error strings', async () => {
    const document = asDocument(new FakeDocument());
    const container = new FakeElement('container');
    const failure = new Error('Private database detail');
    const errors: unknown[] = [];
    let text: FakeText | undefined;
    let image: FakeElement | undefined;

    const mounted = mount(
      asNode(container),
      () => {
        const coordinator = createAsyncResourceCoordinator();
        registerCleanup(() => coordinator.dispose(), { kind: 'resource', name: 'coordinator' });
        const value = createAsyncResource<readonly [], string>(
          [],
          () => [] as const,
          () => Promise.reject(failure),
          { capability: 'test.load', coordinator, name: 'test value' },
        );
        const wrapper = createElement(document, 'section');
        const textNode = createText(document);
        const imageElement = createElement(document, 'img');
        text = asFakeText(textNode);
        image = asFakeElement(imageElement);
        bindAsyncText(textNode, value, { name: 'profile name' });
        bindAsyncDomValue(imageElement, 'src', 'attribute', value, { name: 'profile image' });
        appendChild(wrapper, textNode);
        appendChild(wrapper, imageElement);
        return wrapper;
      },
      { onError: (error, context) => errors.push(error, context) },
    );

    expect(text?.data).toBe('████████');
    expect(image?.getAttribute('aria-busy')).toBe('true');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(text?.data).toBe('████████');
    expect(text?.data).not.toContain('Error');
    expect(image?.getAttribute('aria-busy')).toBeNull();
    expect(errors).toEqual([
      failure,
      expect.objectContaining({ kind: 'async-text', name: 'profile name' }),
    ]);
    mounted.unmount();
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
