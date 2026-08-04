import {
  batch,
  captureOwner,
  createCell,
  createReaction,
  createRoot,
  createRootIn,
  registerCleanup,
  type Cell,
  type Disposable,
  type Readable,
  type Root,
} from '@oxe/runtime';

export type TextValue = bigint | boolean | number | string | null | undefined;
export type DomValue = boolean | number | string | null | undefined;
export type DomValueMode = 'attribute' | 'property';
export type DomEventHandler<EventType extends Event = Event> = (event: EventType) => void;
export type MountContent = ChildNode | readonly ChildNode[];

export interface MountHandle {
  unmount(): void;
}

export interface KeyedRegionOptions<Item, Key> {
  readonly key: (item: Item) => Key;
  readonly name?: string;
  readonly render: (item: Readable<Item>) => MountContent;
}

export interface StaticTemplateAttribute {
  readonly mode: DomValueMode;
  readonly name: string;
  readonly value: boolean | number | string;
}

export interface StaticTemplateElement {
  readonly attributes?: readonly StaticTemplateAttribute[];
  readonly children?: readonly (StaticTemplateElement | string)[];
  readonly tag: string;
}

export type StaticTemplateFactory = (document: Document) => ChildNode;

const renderText = (value: TextValue): string =>
  value === null || value === undefined ? '' : String(value);

export function createElement<TagName extends keyof HTMLElementTagNameMap>(
  document: Document,
  tagName: TagName,
): HTMLElementTagNameMap[TagName];
export function createElement(document: Document, tagName: string): HTMLElement;
export function createElement(document: Document, tagName: string): HTMLElement {
  return document.createElement(tagName);
}

export const createText = (document: Document, value: TextValue = ''): Text =>
  document.createTextNode(renderText(value));

export const appendChild = <Child extends Node>(parent: Node, child: Child): Child =>
  parent.appendChild(child);

/** Builds one direct-DOM template per Document and clones it for each instance. */
export const createStaticTemplate = (descriptor: StaticTemplateElement): StaticTemplateFactory => {
  const templates = new WeakMap<Document, ChildNode>();
  const build = (document: Document, node: StaticTemplateElement): HTMLElement => {
    const element = createElement(document, node.tag);
    for (const attribute of node.attributes ?? []) {
      setDomValue(element, attribute.name, attribute.mode, attribute.value);
    }
    for (const child of node.children ?? []) {
      appendChild(
        element,
        typeof child === 'string' ? createText(document, child) : build(document, child),
      );
    }
    return element;
  };
  return (document) => {
    let template = templates.get(document);
    if (!template) {
      template = build(document, descriptor);
      templates.set(document, template);
    }
    return template.cloneNode(true) as ChildNode;
  };
};

export const bindText = (node: Text, value: Readable<TextValue>): Disposable =>
  createReaction(
    [value],
    () => {
      node.data = renderText(value.read());
    },
    { name: 'DOM text binding' },
  );

export const setDomValue = (
  element: Element,
  name: string,
  mode: DomValueMode,
  value: DomValue,
): void => {
  if (mode === 'property') {
    (element as unknown as Record<string, unknown>)[name] = value;
    return;
  }
  if (value === false || value === null || value === undefined) {
    element.removeAttribute(name);
  } else {
    element.setAttribute(name, value === true ? '' : String(value));
  }
};

export const bindDomValue = (
  element: Element,
  name: string,
  mode: DomValueMode,
  value: Readable<DomValue>,
): Disposable =>
  createReaction([value], () => setDomValue(element, name, mode, value.read()), {
    name: `DOM ${mode} ${name}`,
  });

type EventFor<Target extends EventTarget, EventName extends string> = Target extends HTMLElement
  ? EventName extends keyof HTMLElementEventMap
    ? HTMLElementEventMap[EventName]
    : Event
  : Event;

export const listen = <Target extends EventTarget, EventName extends string>(
  target: Target,
  type: EventName,
  handler: DomEventHandler<EventFor<Target, EventName>>,
  options?: AddEventListenerOptions | boolean,
): void => {
  const listener: EventListener = (event) =>
    batch(() => handler(event as EventFor<Target, EventName>));
  const capture = typeof options === 'boolean' ? options : (options?.capture ?? false);
  target.addEventListener(type, listener, options);

  try {
    registerCleanup(() => target.removeEventListener(type, listener, capture));
  } catch (error) {
    target.removeEventListener(type, listener, capture);
    throw error;
  }
};

const isNodeList = (content: MountContent): content is readonly ChildNode[] =>
  Array.isArray(content);

const asNodes = (content: MountContent): readonly ChildNode[] =>
  isNodeList(content) ? content : [content];

const removeNodes = (nodes: readonly ChildNode[]): void => {
  for (const node of nodes) {
    node.parentNode?.removeChild(node);
  }
};

const insertNodesBefore = (
  parent: Node,
  nodes: readonly ChildNode[],
  reference: ChildNode,
): void => {
  let next: ChildNode = reference;
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (!node) {
      continue;
    }
    if (node.parentNode !== parent || node.nextSibling !== next) {
      parent.insertBefore(node, next);
    }
    next = node;
  }
};

/**
 * Owns an incrementally replaced DOM range. The selector's equality controls when
 * the branch is rebuilt, so selecting the same branch preserves its DOM identity.
 */
export const createConditionalRegion = <Selection>(
  document: Document,
  selection: Readable<Selection>,
  render: (selection: Selection) => MountContent,
  options: { readonly name?: string } = {},
): readonly ChildNode[] => {
  const start = createText(document);
  const end = createText(document);
  let currentNodes: readonly ChildNode[] = [];

  createReaction(
    [selection],
    () => {
      const previousNodes = currentNodes;
      const root = createRoot(() => asNodes(render(selection.read())), {
        name: `${options.name ?? 'conditional region'} branch`,
      });
      currentNodes = root.value;

      const parent = end.parentNode;
      if (parent) {
        removeNodes(previousNodes);
        for (const node of currentNodes) {
          parent.insertBefore(node, end);
        }
      }
    },
    { name: options.name ?? 'conditional region' },
  );

  return [start, ...currentNodes, end];
};

interface KeyedEntry<Item> {
  readonly item: Cell<Item>;
  readonly nodes: readonly ChildNode[];
  readonly root: Root<readonly ChildNode[]>;
}

/**
 * Reconciles a collection by stable key. Existing rows retain their DOM and owner;
 * removed rows are disposed, new rows are created once, and moves reuse nodes.
 */
export const createKeyedRegion = <Item, Key>(
  document: Document,
  items: Readable<readonly Item[]>,
  options: KeyedRegionOptions<Item, Key>,
): readonly ChildNode[] => {
  const owner = captureOwner();
  const start = createText(document);
  const end = createText(document);
  let entries = new Map<Key, KeyedEntry<Item>>();
  let ordered: readonly KeyedEntry<Item>[] = [];

  const disposeEntry = (entry: KeyedEntry<Item>): void => {
    entry.root.dispose();
    removeNodes(entry.nodes);
  };

  createReaction(
    [items],
    () => {
      const nextItems = items.read();
      if (!Array.isArray(nextItems)) {
        throw new TypeError(`${options.name ?? 'keyed region'} expected an array value.`);
      }

      const nextEntries = new Map<Key, KeyedEntry<Item>>();
      const nextOrdered: KeyedEntry<Item>[] = [];
      for (const value of nextItems) {
        const key = options.key(value);
        if (nextEntries.has(key)) {
          throw new Error(
            `${options.name ?? 'keyed region'} received duplicate key ${String(key)}.`,
          );
        }

        const existing = entries.get(key);
        if (existing) {
          existing.item.write(value);
          nextEntries.set(key, existing);
          nextOrdered.push(existing);
          continue;
        }

        const item = createCell(value, { name: `${options.name ?? 'keyed region'} item` });
        const root = createRootIn(owner, () => asNodes(options.render(item)), {
          name: `${options.name ?? 'keyed region'} row`,
        });
        const created: KeyedEntry<Item> = { item, nodes: root.value, root };
        nextEntries.set(key, created);
        nextOrdered.push(created);
      }

      for (const [key, entry] of entries) {
        if (!nextEntries.has(key)) {
          disposeEntry(entry);
        }
      }

      entries = nextEntries;
      ordered = nextOrdered;
      const parent = end.parentNode;
      if (parent) {
        let reference: ChildNode = end;
        for (let index = ordered.length - 1; index >= 0; index -= 1) {
          const entry = ordered[index];
          if (!entry) {
            continue;
          }
          insertNodesBefore(parent, entry.nodes, reference);
          reference = entry.nodes[0] ?? reference;
        }
      }
    },
    { name: options.name ?? 'keyed region' },
  );

  registerCleanup(() => {
    for (const entry of entries.values()) {
      disposeEntry(entry);
    }
    entries.clear();
    ordered = [];
  });

  return [start, ...ordered.flatMap((entry) => entry.nodes), end];
};

const throwFailures = (failures: readonly unknown[], message: string): void => {
  if (failures.length === 1) {
    throw failures[0];
  }

  if (failures.length > 1) {
    throw new AggregateError(failures, message);
  }
};

export const mount = (container: Node, build: () => MountContent): MountHandle => {
  const root = createRoot(() => asNodes(build()), { name: 'DOM mount' });
  const mountedNodes: ChildNode[] = [];

  try {
    for (const node of root.value) {
      container.appendChild(node);
      mountedNodes.push(node);
    }
  } catch (error) {
    const failures: unknown[] = [error];

    try {
      root.dispose();
    } catch (disposeError) {
      failures.push(disposeError);
    }

    for (const node of mountedNodes) {
      if (node.parentNode === container) {
        try {
          container.removeChild(node);
        } catch (removeError) {
          failures.push(removeError);
        }
      }
    }

    throwFailures(failures, 'Mounting failed and cleanup reported additional errors.');
    throw error;
  }

  let disposed = false;
  const remainingNodes = new Set(mountedNodes);

  return {
    unmount: () => {
      if (disposed && remainingNodes.size === 0) {
        return;
      }

      const failures: unknown[] = [];

      if (!disposed) {
        try {
          root.dispose();
        } catch (error) {
          failures.push(error);
        } finally {
          disposed = true;
        }
      }

      for (const node of remainingNodes) {
        if (node.parentNode === container) {
          try {
            container.removeChild(node);
            remainingNodes.delete(node);
          } catch (error) {
            failures.push(error);
          }
        } else {
          remainingNodes.delete(node);
        }
      }

      throwFailures(failures, 'Unmounting reported multiple errors.');
    },
  };
};
