import {
  batch,
  captureOwner,
  createCell,
  createReaction,
  createRoot,
  createRootIn,
  registerCleanup,
  parseLocalizationContext,
  type AsyncReadable,
  type AsyncResourceCheckpoint,
  type Cell,
  type Disposable,
  type Readable,
  type Root,
  type LocalizationContextV1,
} from '@oxe/runtime';

export type TextValue = bigint | boolean | number | string | null | undefined;
export type DomValue = boolean | number | string | null | undefined;
export type DomValueMode = 'attribute' | 'property';
export type DomEventHandler<EventType extends Event = Event> = (event: EventType) => void;
export type MountContent = ChildNode | readonly ChildNode[];

export type StructuredContentPart =
  | string
  | {
      readonly children: readonly StructuredContentPart[];
      readonly kind: 'markup';
      readonly name: string;
    };

export type StructuredContentFactory = (children: readonly ChildNode[]) => ChildNode;

export interface DomListenerOptions extends AddEventListenerOptions {
  readonly replayId?: string;
}

export interface MountHandle {
  unmount(): void;
}

export interface DomErrorContext {
  readonly kind: 'async-attribute' | 'async-structural' | 'async-text';
  readonly name: string;
}

export interface MountOptions {
  readonly onError?: (error: unknown, context: DomErrorContext) => void;
}

export interface HydrationOptions extends MountOptions {
  readonly actualBuildFingerprint?: string;
  readonly buildMismatch?: 'reload' | 'throw';
  readonly expectedBuildFingerprint?: string;
  readonly mismatch?: 'recover' | 'replace' | 'throw';
  readonly name?: string;
  readonly onBuildMismatch?: (error: OxeHydrationBuildMismatch) => void;
  readonly onMismatch?: (error: OxeHydrationMismatch) => void;
}

export class OxeHydrationMismatch extends Error {
  public readonly actual: string;
  public boundaryId: string | undefined;
  public boundaryName: string | undefined;
  public boundarySource: string | undefined;
  public readonly expected: string;
  public readonly index: number;

  public constructor(index: number, expected: string, actual: string) {
    super(`Hydration mismatch at node ${index}: expected ${expected}, received ${actual}.`);
    this.name = 'OxeHydrationMismatch';
    this.index = index;
    this.expected = expected;
    this.actual = actual;
  }

  public atBoundary(id: string, name: string, source?: string): this {
    this.boundaryId = id;
    this.boundaryName = name;
    this.boundarySource = source;
    const location = source ? ` at ${source}` : '';
    this.message = `${this.message} Nearest compiler boundary: ${name} (${id})${location}.`;
    return this;
  }
}

export class OxeHydrationBuildMismatch extends Error {
  public constructor(
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(`Hydration build mismatch: client ${expected}, server ${actual}.`);
    this.name = 'OxeHydrationBuildMismatch';
  }
}

export interface KeyedRegionOptions<Item, Key> {
  readonly hydrationId?: string;
  readonly key: (item: Item) => Key;
  readonly name?: string;
  readonly pending?: () => MountContent;
  readonly render: (item: Readable<Item>) => MountContent;
  readonly source?: string;
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

export interface AsyncBindingOptions<Value> {
  readonly name?: string;
  readonly pending: Value;
}

export type StaticTemplateFactory = (document: Document) => ChildNode;

interface HydrationSession {
  index: number;
  readonly mismatch: NonNullable<HydrationOptions['mismatch']>;
  readonly nodes: readonly ChildNode[];
  readonly onMismatch?: HydrationOptions['onMismatch'];
  readonly replayTargets: Map<string, EventTarget[]>;
}

interface EarlyHydrationEvent {
  readonly occurrence?: number;
  readonly target: string;
  readonly type: string;
  readonly value?: unknown;
}

interface EarlyHydrationQueue {
  readonly events: EarlyHydrationEvent[];
}

let activeHydration: HydrationSession | undefined;
let activeDomErrorHandler: MountOptions['onError'];

const withDomErrorHandler = <Value>(handler: MountOptions['onError'], run: () => Value): Value => {
  const previous = activeDomErrorHandler;
  activeDomErrorHandler = handler;
  try {
    return run();
  } finally {
    activeDomErrorHandler = previous;
  }
};

const dedupeDomErrorHandler = (handler: MountOptions['onError']): MountOptions['onError'] => {
  if (!handler) return undefined;
  const reported = new Set<unknown>();
  return (error, context) => {
    if (reported.has(error)) return;
    reported.add(error);
    handler(error, context);
  };
};

const reportDomError = (
  handler: MountOptions['onError'],
  error: unknown,
  context: DomErrorContext,
): void => {
  if (!handler) throw error;
  handler(error, context);
};

const flattenNodes = (node: Node): readonly ChildNode[] => [
  node as ChildNode,
  ...Array.from(node.childNodes).flatMap(flattenNodes),
];

const nodeDescription = (node: ChildNode | undefined): string => {
  if (!node) return 'end of server DOM';
  if (node.nodeType === 1) return `<${(node as Element).localName}>`;
  if (node.nodeType === 3) return `text ${JSON.stringify((node as Text).data)}`;
  if (node.nodeType === 8) return `comment ${JSON.stringify((node as Comment).data)}`;
  return `node type ${node.nodeType}`;
};

const adoptHydrationNode = (expected: string, matches: (node: ChildNode) => boolean): ChildNode => {
  const session = activeHydration;
  if (!session) {
    throw new Error('Internal hydration adoption requires an active session.');
  }
  const node = session.nodes[session.index];
  if (!node || !matches(node)) {
    throw new OxeHydrationMismatch(session.index, expected, nodeDescription(node));
  }
  session.index += 1;
  return node;
};

const renderText = (value: TextValue): string =>
  value === null || value === undefined ? '' : String(value);

export function createElement<TagName extends keyof HTMLElementTagNameMap>(
  document: Document,
  tagName: TagName,
): HTMLElementTagNameMap[TagName];
export function createElement(document: Document, tagName: string): HTMLElement;
export function createElement(document: Document, tagName: string): HTMLElement {
  if (activeHydration) {
    return adoptHydrationNode(
      `<${tagName}>`,
      (node) => node.nodeType === 1 && (node as Element).localName === tagName,
    ) as HTMLElement;
  }
  return document.createElement(tagName);
}

export const createText = (document: Document, value?: TextValue): Text => {
  if (activeHydration) {
    const expected =
      value === undefined ? 'dynamic text' : `text ${JSON.stringify(renderText(value))}`;
    return adoptHydrationNode(
      expected,
      (node) =>
        node.nodeType === 3 && (value === undefined || (node as Text).data === renderText(value)),
    ) as Text;
  }
  return document.createTextNode(renderText(value));
};

export const createStructuredContent = (
  document: Document,
  parts: readonly StructuredContentPart[],
  factories: Readonly<Record<string, StructuredContentFactory>>,
): readonly ChildNode[] =>
  parts.map((part) => {
    if (typeof part === 'string') return createText(document, part);
    const factory = factories[part.name];
    if (!factory) {
      throw new TypeError(`Missing localized markup factory for ${part.name}.`);
    }
    return factory(createStructuredContent(document, part.children, factories));
  });

type RegionEdge = 'end' | 'start';

const regionMarkerData = (hydrationId: string, edge: RegionEdge): string =>
  `oxe:${hydrationId}:${edge}`;

const createRegionAnchor = (
  document: Document,
  hydrationId: string | undefined,
  edge: RegionEdge,
): ChildNode => {
  if (activeHydration) {
    if (!hydrationId) {
      throw new OxeHydrationMismatch(
        activeHydration.index,
        `a compiler-owned ${edge} region marker`,
        nodeDescription(activeHydration.nodes[activeHydration.index]),
      );
    }
    const data = regionMarkerData(hydrationId, edge);
    return adoptHydrationNode(
      `comment ${JSON.stringify(data)}`,
      (node) => node.nodeType === 8 && (node as Comment).data === data,
    );
  }
  return document.createTextNode('');
};

interface RecoveredHydrationBoundary<Value> {
  readonly end: ChildNode;
  readonly value: Value;
}

const recoverHydrationBoundary = <Value>(
  start: ChildNode,
  hydrationId: string,
  name: string,
  source: string | undefined,
  mismatch: OxeHydrationMismatch,
  rebuild: () => Value,
): RecoveredHydrationBoundary<Value> => {
  const session = activeHydration;
  mismatch.atBoundary(hydrationId, name, source);
  session?.onMismatch?.(mismatch);
  if (!session || session.mismatch !== 'recover') throw mismatch;

  const expectedEnd = regionMarkerData(hydrationId, 'end');
  const startIndex = session.nodes.indexOf(start);
  const endIndex = session.nodes.findIndex(
    (node, index) =>
      index > startIndex && node.nodeType === 8 && (node as Comment).data === expectedEnd,
  );
  const end = session.nodes[endIndex];
  if (startIndex < 0 || endIndex < 0 || !end || start.parentNode !== end.parentNode) {
    throw mismatch;
  }

  const parent = start.parentNode;
  if (!parent) throw mismatch;
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const node = session.nodes[index];
    if (node?.parentNode === parent) parent.removeChild(node);
  }
  session.index = endIndex + 1;

  const previousHydration = activeHydration;
  activeHydration = undefined;
  let value: Value;
  try {
    value = rebuild();
  } finally {
    activeHydration = previousHydration;
  }
  return { end, value };
};

export const appendChild = <Child extends Node>(parent: Node, child: Child): Child =>
  activeHydration && child.parentNode === parent ? child : parent.appendChild(child);

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
    if (activeHydration) {
      const matches = (node: ChildNode, expected: StaticTemplateElement | string): boolean => {
        if (typeof expected === 'string') {
          return node.nodeType === 3 && (node as Text).data === expected;
        }
        if (node.nodeType !== 1 || (node as Element).localName !== expected.tag) return false;
        const children = Array.from(node.childNodes);
        const expectedChildren = expected.children ?? [];
        return (
          children.length === expectedChildren.length &&
          children.every((child, index) => {
            const expectedChild = expectedChildren[index];
            return expectedChild !== undefined && matches(child, expectedChild);
          })
        );
      };
      const root = adoptHydrationNode(`static <${descriptor.tag}> template`, (node) =>
        matches(node, descriptor),
      );
      const descendantCount = flattenNodes(root).length - 1;
      activeHydration.index += descendantCount;
      return root;
    }
    let template = templates.get(document);
    if (!template) {
      template = build(document, descriptor);
      templates.set(document, template);
    }
    return template.cloneNode(true) as ChildNode;
  };
};

/** Builds a compiler-derived, inert placeholder that preserves the final view's geometry. */
export const createSkeleton = (
  document: Document,
  descriptor: StaticTemplateElement,
): ChildNode => {
  const node = createStaticTemplate(descriptor)(document);
  if (node.nodeType !== 1) return node;
  const root = node as Element;
  root.setAttribute('aria-hidden', 'true');
  root.setAttribute('data-oxe-skeleton', '');
  const interactive = [
    ...(root.matches?.('button,input,select,textarea') ? [root] : []),
    ...Array.from(root.querySelectorAll?.('button,input,select,textarea') ?? []),
  ];
  for (const element of interactive) element.setAttribute('disabled', '');
  return node;
};

export const bindText = (node: Text, value: Readable<TextValue>): Disposable =>
  createReaction(
    [value],
    () => {
      node.data = renderText(value.read());
    },
    { name: 'DOM text binding' },
  );

export const bindAsyncText = (
  node: Text,
  value: AsyncReadable<TextValue>,
  options: Partial<AsyncBindingOptions<TextValue>> = {},
): Disposable => {
  const onError = activeDomErrorHandler;
  let reportedError: unknown;
  return createReaction(
    [value],
    () => {
      const snapshot = value.snapshot();
      if (snapshot.status === 'failed') {
        if (snapshot.error !== reportedError) {
          reportedError = snapshot.error;
          reportDomError(onError, snapshot.error, {
            kind: 'async-text',
            name: options.name ?? 'DOM async text binding',
          });
        }
        return;
      }
      reportedError = undefined;
      node.data =
        snapshot.status === 'ready' || snapshot.status === 'refreshing'
          ? renderText(snapshot.value)
          : renderText(options.pending ?? '████████');
    },
    { name: options.name ?? 'DOM async text binding' },
  );
};

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

interface PendingElementState {
  readonly bindings: Set<string>;
  readonly previousAriaBusy: string | null;
}

const pendingElements = new WeakMap<Element, PendingElementState>();

const setElementBindingPending = (element: Element, binding: string, pending: boolean): void => {
  let state = pendingElements.get(element);
  if (pending) {
    if (!state) {
      state = { bindings: new Set(), previousAriaBusy: element.getAttribute('aria-busy') };
      pendingElements.set(element, state);
    }
    state.bindings.add(binding);
    element.setAttribute('data-oxe-pending', '');
    element.setAttribute('aria-busy', 'true');
    return;
  }
  if (!state) return;
  state.bindings.delete(binding);
  if (state.bindings.size > 0) return;
  element.removeAttribute('data-oxe-pending');
  if (state.previousAriaBusy === null) element.removeAttribute('aria-busy');
  else element.setAttribute('aria-busy', state.previousAriaBusy);
  pendingElements.delete(element);
};

export const bindAsyncDomValue = (
  element: Element,
  name: string,
  mode: DomValueMode,
  value: AsyncReadable<DomValue>,
  options: Partial<AsyncBindingOptions<DomValue>> = {},
): Disposable => {
  const onError = activeDomErrorHandler;
  const bindingId = `${mode}:${name}`;
  let reportedError: unknown;
  const reaction = createReaction(
    [value],
    () => {
      const snapshot = value.snapshot();
      if (snapshot.status === 'failed') {
        setElementBindingPending(element, bindingId, false);
        if (snapshot.error !== reportedError) {
          reportedError = snapshot.error;
          reportDomError(onError, snapshot.error, {
            kind: 'async-attribute',
            name: options.name ?? `DOM async ${mode} ${name}`,
          });
        }
        return;
      }
      reportedError = undefined;
      setElementBindingPending(element, bindingId, snapshot.status === 'pending');
      setDomValue(
        element,
        name,
        mode,
        snapshot.status === 'ready' || snapshot.status === 'refreshing'
          ? snapshot.value
          : (options.pending ?? null),
      );
    },
    { name: options.name ?? `DOM async ${mode} ${name}` },
  );
  return {
    dispose: () => {
      reaction.dispose();
      setElementBindingPending(element, bindingId, false);
    },
  };
};

type EventFor<Target extends EventTarget, EventName extends string> = Target extends HTMLElement
  ? EventName extends keyof HTMLElementEventMap
    ? HTMLElementEventMap[EventName]
    : Event
  : Event;

export const listen = <Target extends EventTarget, EventName extends string>(
  target: Target,
  type: EventName,
  handler: DomEventHandler<EventFor<Target, EventName>>,
  options?: DomListenerOptions | boolean,
): void => {
  const listener: EventListener = (event) =>
    batch(() => handler(event as EventFor<Target, EventName>));
  const replayId = typeof options === 'object' ? options.replayId : undefined;
  const listenerOptions =
    typeof options === 'object'
      ? {
          ...(options.capture === undefined ? {} : { capture: options.capture }),
          ...(options.once === undefined ? {} : { once: options.once }),
          ...(options.passive === undefined ? {} : { passive: options.passive }),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        }
      : options;
  const capture =
    typeof listenerOptions === 'boolean' ? listenerOptions : (listenerOptions?.capture ?? false);
  if (replayId) {
    if ('setAttribute' in target && typeof target.setAttribute === 'function') {
      target.setAttribute('data-oxe-event', replayId);
    }
    if (activeHydration) {
      const targets = activeHydration.replayTargets.get(replayId) ?? [];
      targets.push(target);
      activeHydration.replayTargets.set(replayId, targets);
    }
  }
  target.addEventListener(type, listener, listenerOptions);

  try {
    registerCleanup(() => target.removeEventListener(type, listener, capture), {
      kind: 'event-listener',
      name: type,
    });
  } catch (error) {
    target.removeEventListener(type, listener, capture);
    throw error;
  }
};

const replayEarlyHydrationEvents = (session: HydrationSession): void => {
  const early = (globalThis as typeof globalThis & { __oxeEarly?: EarlyHydrationQueue }).__oxeEarly;
  if (!early || !Array.isArray(early.events) || early.events.length === 0) return;
  const remaining: EarlyHydrationEvent[] = [];
  for (const event of early.events) {
    const target = session.replayTargets.get(event.target)?.[event.occurrence ?? 0];
    if (!target) {
      remaining.push(event);
      continue;
    }
    if (event.type === 'input' && 'value' in target) {
      (target as EventTarget & { value: unknown }).value = event.value;
    }
    const ownerWindow = (
      target as EventTarget & {
        readonly ownerDocument?: { readonly defaultView?: { readonly Event?: typeof Event } };
      }
    ).ownerDocument?.defaultView;
    const EventConstructor = ownerWindow?.Event ?? globalThis.Event;
    target.dispatchEvent(new EventConstructor(event.type, { bubbles: true, cancelable: true }));
  }
  early.events.splice(0, early.events.length, ...remaining);
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

type RegionValue<Value> =
  | { readonly status: 'failed'; readonly error: unknown }
  | { readonly status: 'pending' }
  | { readonly status: 'ready'; readonly value: Value };

const readRegionValue = <Value>(value: Readable<Value>): RegionValue<Value> => {
  if (!('snapshot' in value) || typeof value.snapshot !== 'function') {
    return { status: 'ready', value: value.read() };
  }
  const snapshot = (value as AsyncReadable<Value>).snapshot();
  if (snapshot.status === 'ready' || snapshot.status === 'refreshing') {
    return { status: 'ready', value: snapshot.value as Value };
  }
  if (snapshot.status === 'failed') return { error: snapshot.error, status: 'failed' };
  return { status: 'pending' };
};

/**
 * Owns an incrementally replaced DOM range. The selector's equality controls when
 * the branch is rebuilt, so selecting the same branch preserves its DOM identity.
 */
export const createConditionalRegion = <Selection>(
  document: Document,
  selection: Readable<Selection>,
  render: (selection: Selection) => MountContent,
  options: {
    readonly hydrationId?: string;
    readonly name?: string;
    readonly pending?: () => MountContent;
    readonly source?: string;
  } = {},
): readonly ChildNode[] => {
  const onError = activeDomErrorHandler;
  const start = createRegionAnchor(document, options.hydrationId, 'start');
  const anchors: { end?: ChildNode } = {};
  let currentNodes: readonly ChildNode[] = [];
  let currentRoot: Root<readonly ChildNode[]> | undefined;
  let reportedError: unknown;
  let recoveredEnd: ChildNode | undefined;

  createReaction(
    [selection],
    () => {
      const selected = readRegionValue(selection);
      if (selected.status === 'failed') {
        if (selected.error !== reportedError) {
          reportedError = selected.error;
          reportDomError(onError, selected.error, {
            kind: 'async-structural',
            name: options.name ?? 'conditional region',
          });
        }
        return;
      }
      reportedError = undefined;
      const previousNodes = currentNodes;
      const previousRoot = currentRoot;
      const createBranchRoot = (): Root<readonly ChildNode[]> =>
        createRoot(
          () => {
            const content =
              selected.status === 'pending'
                ? (options.pending?.() ?? [])
                : withDomErrorHandler(onError, () => render(selected.value));
            return asNodes(content);
          },
          { name: `${options.name ?? 'conditional region'} branch` },
        );
      let root: Root<readonly ChildNode[]>;
      try {
        root = createBranchRoot();
      } catch (error) {
        if (!(error instanceof OxeHydrationMismatch) || !options.hydrationId) throw error;
        const recovered = recoverHydrationBoundary(
          start,
          options.hydrationId,
          options.name ?? 'conditional region',
          options.source,
          error,
          createBranchRoot,
        );
        recoveredEnd = recovered.end;
        root = recovered.value;
        for (const node of root.value) {
          recovered.end.parentNode?.insertBefore(node, recovered.end);
        }
      }
      currentRoot = root;
      currentNodes = root.value;

      const parent = anchors.end?.parentNode;
      if (parent && anchors.end) {
        removeNodes(previousNodes);
        for (const node of currentNodes) {
          parent.insertBefore(node, anchors.end);
        }
      }
      previousRoot?.dispose();
    },
    { name: options.name ?? 'conditional region' },
  );

  const end = recoveredEnd ?? createRegionAnchor(document, options.hydrationId, 'end');
  anchors.end = end;
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
  const onError = activeDomErrorHandler;
  const start = createRegionAnchor(document, options.hydrationId, 'start');
  const anchors: { end?: ChildNode } = {};
  let entries = new Map<Key, KeyedEntry<Item>>();
  let ordered: readonly KeyedEntry<Item>[] = [];
  let pendingNodes: readonly ChildNode[] = [];
  let pendingRoot: Root<readonly ChildNode[]> | undefined;
  let reportedError: unknown;
  let recoveredEnd: ChildNode | undefined;

  const disposeEntry = (entry: KeyedEntry<Item>): void => {
    entry.root.dispose();
    removeNodes(entry.nodes);
  };

  createReaction(
    [items],
    () => {
      const value = readRegionValue(items);
      if (value.status === 'failed') {
        if (value.error !== reportedError) {
          reportedError = value.error;
          reportDomError(onError, value.error, {
            kind: 'async-structural',
            name: options.name ?? 'keyed region',
          });
        }
        return;
      }
      reportedError = undefined;
      if (value.status === 'pending') {
        for (const entry of entries.values()) disposeEntry(entry);
        entries = new Map();
        ordered = [];
        pendingRoot?.dispose();
        removeNodes(pendingNodes);
        pendingRoot = createRootIn(owner, () => asNodes(options.pending?.() ?? []), {
          name: `${options.name ?? 'keyed region'} pending row`,
        });
        pendingNodes = pendingRoot.value;
        const parent = anchors.end?.parentNode;
        if (parent && anchors.end) {
          insertNodesBefore(parent, pendingNodes, anchors.end);
        }
        return;
      }
      pendingRoot?.dispose();
      removeNodes(pendingNodes);
      pendingRoot = undefined;
      pendingNodes = [];
      const nextItems = value.value;
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
        const createRowRoot = (): Root<readonly ChildNode[]> =>
          createRootIn(
            owner,
            () => asNodes(withDomErrorHandler(onError, () => options.render(item))),
            { name: `${options.name ?? 'keyed region'} row` },
          );
        let root: Root<readonly ChildNode[]>;
        try {
          root = createRowRoot();
        } catch (error) {
          if (!(error instanceof OxeHydrationMismatch) || !options.hydrationId) throw error;
          for (const created of nextOrdered) disposeEntry(created);
          const recovered = recoverHydrationBoundary(
            start,
            options.hydrationId,
            options.name ?? 'keyed region',
            options.source,
            error,
            () => {
              const recoveredEntries = new Map<Key, KeyedEntry<Item>>();
              const recoveredOrdered: KeyedEntry<Item>[] = [];
              for (const recoveredValue of nextItems) {
                const recoveredKey = options.key(recoveredValue);
                if (recoveredEntries.has(recoveredKey)) {
                  throw new Error(
                    `${options.name ?? 'keyed region'} received duplicate key ${String(recoveredKey)}.`,
                  );
                }
                const recoveredItem = createCell(recoveredValue, {
                  name: `${options.name ?? 'keyed region'} item`,
                });
                const recoveredRoot = createRootIn(
                  owner,
                  () => asNodes(withDomErrorHandler(onError, () => options.render(recoveredItem))),
                  { name: `${options.name ?? 'keyed region'} row` },
                );
                const recoveredEntry = {
                  item: recoveredItem,
                  nodes: recoveredRoot.value,
                  root: recoveredRoot,
                } satisfies KeyedEntry<Item>;
                recoveredEntries.set(recoveredKey, recoveredEntry);
                recoveredOrdered.push(recoveredEntry);
              }
              return { entries: recoveredEntries, ordered: recoveredOrdered };
            },
          );
          recoveredEnd = recovered.end;
          entries = recovered.value.entries;
          ordered = recovered.value.ordered;
          for (const recoveredEntry of ordered) {
            insertNodesBefore(
              recovered.end.parentNode as Node,
              recoveredEntry.nodes,
              recovered.end,
            );
          }
          return;
        }
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
      const parent = anchors.end?.parentNode;
      if (parent && anchors.end) {
        let reference: ChildNode = anchors.end;
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

  registerCleanup(
    () => {
      for (const entry of entries.values()) {
        disposeEntry(entry);
      }
      entries.clear();
      ordered = [];
      pendingRoot?.dispose();
      pendingRoot = undefined;
      removeNodes(pendingNodes);
      pendingNodes = [];
    },
    { kind: 'keyed-region', name: options.name ?? 'Keyed region' },
  );

  const end = recoveredEnd ?? createRegionAnchor(document, options.hydrationId, 'end');
  anchors.end = end;
  return [start, ...pendingNodes, ...ordered.flatMap((entry) => entry.nodes), end];
};

const throwFailures = (failures: readonly unknown[], message: string): void => {
  if (failures.length === 1) {
    throw failures[0];
  }

  if (failures.length > 1) {
    throw new AggregateError(failures, message);
  }
};

const createMountHandle = (
  container: Node,
  root: Root<readonly ChildNode[]>,
  mountedNodes: readonly ChildNode[],
): MountHandle => {
  let disposed = false;
  const remainingNodes = new Set(mountedNodes);

  return {
    unmount: () => {
      if (disposed && remainingNodes.size === 0) return;
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

export const mount = (
  container: Node,
  build: () => MountContent,
  options: MountOptions = {},
): MountHandle => {
  const onError = dedupeDomErrorHandler(options.onError);
  const root = createRoot(() => withDomErrorHandler(onError, () => asNodes(build())), {
    name: 'DOM mount',
  });
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

  return createMountHandle(container, root, mountedNodes);
};

/** Adopts matching server DOM and attaches owners/bindings without replacing it. */
export const hydrate = (
  container: Node,
  build: () => MountContent,
  options: HydrationOptions = {},
): MountHandle => {
  if (activeHydration) {
    throw new Error('Nested hydration sessions are not supported.');
  }
  if (
    options.expectedBuildFingerprint &&
    options.actualBuildFingerprint &&
    options.expectedBuildFingerprint !== options.actualBuildFingerprint
  ) {
    const mismatch = new OxeHydrationBuildMismatch(
      options.expectedBuildFingerprint,
      options.actualBuildFingerprint,
    );
    options.onBuildMismatch?.(mismatch);
    if (options.buildMismatch === 'reload') {
      const ownerDocument = (container as Node & { readonly ownerDocument?: Document })
        .ownerDocument;
      ownerDocument?.defaultView?.location.reload();
    }
    throw mismatch;
  }
  const existingRoots = Array.from(container.childNodes);
  const session: HydrationSession = {
    index: 0,
    mismatch: options.mismatch ?? 'throw',
    nodes: existingRoots.flatMap(flattenNodes),
    ...(options.onMismatch ? { onMismatch: options.onMismatch } : {}),
    replayTargets: new Map(),
  };
  const onError = dedupeDomErrorHandler(options.onError);
  activeHydration = session;
  try {
    const root = createRoot(() => withDomErrorHandler(onError, () => asNodes(build())), {
      name: options.name ?? 'DOM hydration',
    });
    if (session.index !== session.nodes.length) {
      root.dispose();
      throw new OxeHydrationMismatch(
        session.index,
        'end of generated DOM',
        nodeDescription(session.nodes[session.index]),
      );
    }
    const hydratedRoots = Array.from(container.childNodes);
    if (
      root.value.length !== hydratedRoots.length ||
      root.value.some((node, index) => node !== hydratedRoots[index])
    ) {
      root.dispose();
      throw new OxeHydrationMismatch(0, 'matching root nodes', 'different generated roots');
    }
    try {
      replayEarlyHydrationEvents(session);
    } catch (error) {
      try {
        root.dispose();
      } catch (disposeError) {
        throw new AggregateError(
          [error, disposeError],
          'Early event replay and hydration cleanup both failed.',
        );
      }
      throw error;
    }
    return createMountHandle(container, root, root.value);
  } catch (error) {
    if (error instanceof OxeHydrationMismatch && !error.boundaryId) {
      options.onMismatch?.(error);
    }
    if (
      !(error instanceof OxeHydrationMismatch) ||
      (options.mismatch !== 'replace' && options.mismatch !== 'recover')
    ) {
      throw error;
    }
  } finally {
    activeHydration = undefined;
  }

  for (const node of Array.from(container.childNodes)) container.removeChild(node);
  return mount(container, build, options);
};

interface SerializedHydrationState {
  readonly checkpoints: readonly AsyncResourceCheckpoint[];
  readonly localization?: LocalizationContextV1;
}

const readSerializedHydrationState = (document: Document): SerializedHydrationState => {
  const element = document.querySelector('script[type="application/json"][data-oxe-state]');
  if (!element?.textContent) return { checkpoints: [] };
  const value: unknown = JSON.parse(element.textContent);
  const objectState =
    !Array.isArray(value) && typeof value === 'object' && value !== null ? value : undefined;
  const checkpoints = Array.isArray(value)
    ? value
    : objectState &&
        'schemaVersion' in objectState &&
        objectState.schemaVersion === 'oxe.hydration-state.v1' &&
        'checkpoints' in objectState &&
        Array.isArray(objectState.checkpoints)
      ? objectState.checkpoints
      : undefined;
  if (!checkpoints) throw new TypeError('Serialized OXE hydration state is invalid.');
  const parsedCheckpoints = checkpoints.map((checkpoint) => {
    if (
      typeof checkpoint !== 'object' ||
      checkpoint === null ||
      !('identity' in checkpoint) ||
      typeof checkpoint.identity !== 'string' ||
      !('value' in checkpoint)
    ) {
      throw new TypeError('Serialized OXE async state contains an invalid checkpoint.');
    }
    return { identity: checkpoint.identity, value: checkpoint.value };
  });
  const localization =
    objectState && 'localization' in objectState && objectState.localization !== undefined
      ? parseLocalizationContext(objectState.localization)
      : undefined;
  return {
    checkpoints: parsedCheckpoints,
    ...(localization ? { localization } : {}),
  };
};

export const readSerializedAsyncCheckpoints = (
  document: Document,
): readonly AsyncResourceCheckpoint[] => readSerializedHydrationState(document).checkpoints;

export const readSerializedLocalizationContext = (
  document: Document,
): LocalizationContextV1 | undefined => readSerializedHydrationState(document).localization;

export const readSerializedBuildFingerprint = (document: Document): string | undefined => {
  const element = document.querySelector('script[type="application/json"][data-oxe-state]');
  const fingerprint = element?.getAttribute('data-oxe-build');
  return fingerprint && fingerprint.length > 0 ? fingerprint : undefined;
};
