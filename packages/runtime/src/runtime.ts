import { OxeRuntimeError } from './errors.js';

const MAX_FLUSH_RUNS = 100_000;
const CONTEXT_VALUE: unique symbol = Symbol('OXE_CONTEXT_VALUE');
const REACTIVE_SOURCE: unique symbol = Symbol('OXE_REACTIVE_SOURCE');

type Cleanup = () => void;
type ComputationState = 'clean' | 'disposed' | 'running' | 'stale';
type Equality<T> = (previous: T, next: T) => boolean;

interface OwnerNode {
  readonly name: string;
  readonly parent: OwnerNode | undefined;
  readonly children: Set<OwnerNode>;
  readonly cleanups: Cleanup[];
  contexts: Map<symbol, unknown> | undefined;
  disposed: boolean;
}

interface SourceNode {
  readonly name: string;
  readonly observers: Set<ComputationNode>;
  readonly sourceKind: 'cell' | 'computation' | 'selection';
  readonly traceId: string | undefined;
  version: number;
}

interface CellNode<T> extends SourceNode {
  readonly equals: Equality<T>;
  readonly selections: Map<string, SelectionNode>;
  readonly sourceKind: 'cell';
  value: T;
}

interface SelectionNode extends SourceNode {
  readonly parent: CellNode<unknown> | ComputationNode;
  readonly path: readonly string[];
  readonly sourceKind: 'selection';
  seenVersion: number;
  value: unknown;
}

interface ComputationNode extends OwnerNode, SourceNode {
  readonly equals: Equality<unknown>;
  readonly kind: 'derived' | 'reaction';
  readonly run: () => unknown;
  readonly selections: Map<string, SelectionNode>;
  readonly sourceKind: 'computation';
  readonly seenVersions: Map<SourceNode, number>;
  readonly sources: Set<SourceNode>;
  readonly staleReasons: Map<string, ReactiveTraceSource>;
  initialized: boolean;
  queued: boolean;
  state: ComputationState;
  value: unknown;
}

const isComputation = (source: SourceNode): source is ComputationNode =>
  source.sourceKind === 'computation';

const isSelection = (source: SourceNode): source is SelectionNode =>
  source.sourceKind === 'selection';

export interface Readable<T> {
  read(): T;
}

export interface Cell<T> extends Readable<T> {
  write(next: T): T;
  writePath(path: readonly string[], next: unknown): T;
}

export interface Disposable {
  dispose(): void;
}

export interface Root<T> extends Disposable {
  readonly value: T;
}

/** Opaque ownership capability used by platform runtimes to retain nested work. */
export interface OwnerScope {
  readonly kind: 'oxe-owner-scope';
}

export interface Context<T> {
  readonly id: symbol;
  readonly name: string;
  readonly [CONTEXT_VALUE]?: (value: T) => T;
}

export interface NamedOptions {
  readonly name?: string;
  /** Stable compiler graph id used only by development tracing. */
  readonly traceId?: string;
}

export interface ReactiveTraceSource {
  readonly id?: string;
  readonly name: string;
  readonly path?: readonly string[];
}

export interface ReactiveTraceEvent {
  readonly computation?: ReactiveTraceSource & { readonly kind: 'derived' | 'reaction' };
  readonly kind: 'execute' | 'invalidate' | 'suppress' | 'write';
  readonly reason: string;
  readonly source: ReactiveTraceSource;
  readonly timestamp: number;
}

export type ReactiveTraceListener = (event: ReactiveTraceEvent) => void;

export interface CellOptions<T> extends NamedOptions {
  readonly equals?: Equality<T>;
}

export interface DerivedOptions<T> extends NamedOptions {
  readonly equals?: Equality<T>;
}

let activeOwner: OwnerNode | undefined;
let batchDepth = 0;
let flushing = false;
const pendingReactions: ComputationNode[] = [];
const ownerScopes = new WeakMap<OwnerScope, OwnerNode>();
const reactiveTraceListeners = new Set<ReactiveTraceListener>();

const sourceTrace = (source: SourceNode): ReactiveTraceSource => ({
  ...(source.traceId ? { id: source.traceId } : {}),
  name: isSelection(source) ? source.parent.name : source.name,
  ...(isSelection(source) ? { path: source.path } : {}),
});

const traceReasonKey = (source: ReactiveTraceSource): string =>
  `${source.id ?? source.name}\0${source.path?.join('\0') ?? ''}`;

const emitReactiveTrace = (event: Omit<ReactiveTraceEvent, 'timestamp'>): void => {
  if (reactiveTraceListeners.size === 0) {
    return;
  }
  const traced = Object.freeze({ ...event, timestamp: Date.now() });
  for (const listener of reactiveTraceListeners) {
    listener(traced);
  }
};

/** Subscribes to development-only invalidation and execution explanations. */
export const subscribeReactiveTrace = (listener: ReactiveTraceListener): Disposable => {
  reactiveTraceListeners.add(listener);
  return { dispose: () => reactiveTraceListeners.delete(listener) };
};

const createOwnerNode = (name: string, parent: OwnerNode | undefined): OwnerNode => ({
  name,
  parent,
  children: new Set(),
  cleanups: [],
  contexts: undefined,
  disposed: false,
});

const throwCollectedErrors = (errors: unknown[], message: string): void => {
  if (errors.length === 0) {
    return;
  }

  if (errors.length === 1) {
    throw errors[0];
  }

  throw new AggregateError(errors, message);
};

const requireOwner = (operation: string): OwnerNode => {
  if (activeOwner) {
    return activeOwner;
  }

  throw new OxeRuntimeError(
    'OXE_RUNTIME_MISSING_OWNER',
    `${operation} requires an active OXE owner. Create it inside createRoot().`,
  );
};

const detachFromParent = (owner: OwnerNode): void => {
  owner.parent?.children.delete(owner);
};

const runOwnerCleanups = (owner: OwnerNode): void => {
  const children = [...owner.children];
  owner.children.clear();
  const cleanups = owner.cleanups.splice(0);
  const errors: unknown[] = [];

  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (child) {
      try {
        disposeOwner(child);
      } catch (error) {
        errors.push(error);
      }
    }
  }

  for (let index = cleanups.length - 1; index >= 0; index -= 1) {
    try {
      cleanups[index]?.();
    } catch (error) {
      errors.push(error);
    }
  }

  throwCollectedErrors(errors, `Multiple cleanups failed while disposing "${owner.name}".`);
};

const detachSources = (computation: ComputationNode): void => {
  for (const source of computation.sources) {
    source.observers.delete(computation);
  }
  computation.sources.clear();
};

const disposeOwner = (owner: OwnerNode): void => {
  if (owner.disposed) {
    return;
  }

  owner.disposed = true;
  detachFromParent(owner);

  if ('sources' in owner) {
    const computation = owner as ComputationNode;
    computation.state = 'disposed';
    computation.queued = false;
    detachSources(computation);
    computation.staleReasons.clear();
    computation.observers.clear();
    for (const selection of computation.selections.values()) {
      selection.observers.clear();
    }
    computation.selections.clear();
  }

  try {
    runOwnerCleanups(owner);
  } finally {
    owner.contexts?.clear();
  }
};

const disposeAfterFailure = (owner: OwnerNode, failure: unknown): never => {
  try {
    disposeOwner(owner);
  } catch (cleanupFailure) {
    throw new AggregateError(
      [failure, cleanupFailure],
      `Execution and cleanup both failed inside "${owner.name}".`,
    );
  }

  throw failure;
};

const cleanupFailedComputation = (
  computation: ComputationNode,
  executionFailure: unknown,
): never => {
  try {
    runOwnerCleanups(computation);
  } catch (cleanupFailure) {
    computation.state = 'stale';
    throw new AggregateError(
      [executionFailure, cleanupFailure],
      `Execution and cleanup both failed inside ${computationLabel(computation)}.`,
    );
  }

  computation.state = 'stale';
  throw executionFailure;
};

const computationLabel = (computation: ComputationNode): string =>
  `${computation.kind} "${computation.name}"`;

const cycleError = (sourceName: string, computation: ComputationNode): OxeRuntimeError =>
  new OxeRuntimeError(
    'OXE_RUNTIME_CYCLE',
    `Reactive cycle detected: ${computationLabel(computation)} wrote to or read from ` +
      `"${sourceName}" while it was already evaluating. Use untrack() for a deliberate ` +
      'snapshot read or remove the self-dependent relationship.',
  );

const assertNoRunningObserver = (source: SourceNode, visited = new Set<SourceNode>()): void => {
  if (visited.has(source)) {
    return;
  }
  visited.add(source);

  for (const observer of source.observers) {
    if (observer.state === 'running') {
      throw cycleError(source.name, observer);
    }
    assertNoRunningObserver(observer, visited);
  }

  if (isComputation(source)) {
    for (const selection of source.selections.values()) {
      assertNoRunningObserver(selection, visited);
    }
  }
};

const enqueueReaction = (reaction: ComputationNode): void => {
  if (reaction.queued || reaction.disposed) {
    return;
  }

  reaction.queued = true;
  pendingReactions.push(reaction);
};

const markStale = (
  computation: ComputationNode,
  visited = new Set<ComputationNode>(),
  reason?: SourceNode,
): void => {
  if (reason) {
    const tracedReason = sourceTrace(reason);
    computation.staleReasons.set(traceReasonKey(tracedReason), tracedReason);
    emitReactiveTrace({
      computation: {
        ...(computation.traceId ? { id: computation.traceId } : {}),
        kind: computation.kind,
        name: computation.name,
      },
      kind: 'invalidate',
      reason: `${tracedReason.name}${tracedReason.path?.length ? `.${tracedReason.path.join('.')}` : ''} changed`,
      source: tracedReason,
    });
  }
  if (computation.state === 'disposed' || visited.has(computation)) {
    return;
  }
  visited.add(computation);

  if (computation.state === 'running') {
    throw cycleError(computation.name, computation);
  }

  computation.state = 'stale';

  for (const selection of computation.selections.values()) {
    for (const observer of selection.observers) {
      markStale(observer, visited, selection);
    }
  }

  for (const observer of computation.observers) {
    markStale(observer, visited, computation);
  }

  if (computation.kind === 'reaction') {
    enqueueReaction(computation);
  }
};

const invalidate = (source: SourceNode): void => {
  const visited = new Set<ComputationNode>();
  for (const observer of source.observers) {
    markStale(observer, visited, source);
  }
};

const executeComputation = (computation: ComputationNode): unknown => {
  if (computation.state === 'disposed') {
    return computation.value;
  }

  if (computation.state === 'running') {
    throw cycleError(computation.name, computation);
  }

  if (computation.kind === 'reaction') {
    for (const source of computation.sources) {
      refreshSource(source);
    }
  }

  runOwnerCleanups(computation);

  const previousOwner = activeOwner;
  const previousValue = computation.value;
  const wasInitialized = computation.initialized;
  activeOwner = computation;
  computation.state = 'running';

  try {
    const reasons = [...computation.staleReasons.values()];
    const tracedComputation = {
      ...(computation.traceId ? { id: computation.traceId } : {}),
      kind: computation.kind,
      name: computation.name,
    } as const;
    emitReactiveTrace({
      computation: tracedComputation,
      kind: 'execute',
      reason: wasInitialized
        ? reasons.length > 0
          ? reasons
              .map((reason) =>
                reason.path?.length ? `${reason.name}.${reason.path.join('.')}` : reason.name,
              )
              .join(', ')
          : 'dependency version changed'
        : 'initial execution',
      source: reasons[0] ?? sourceTrace(computation),
    });
    const nextValue = computation.run();

    if (computation.kind === 'derived') {
      if (!wasInitialized || !computation.equals(previousValue, nextValue)) {
        computation.value = nextValue;
        computation.version += 1;
      } else {
        emitReactiveTrace({
          computation: tracedComputation,
          kind: 'suppress',
          reason: 'derived output remained equal',
          source: reasons[0] ?? sourceTrace(computation),
        });
      }
    } else {
      computation.value = nextValue;
      for (const source of computation.sources) {
        computation.seenVersions.set(source, source.version);
      }
    }

    computation.initialized = true;
    computation.state = 'clean';
    computation.staleReasons.clear();
    return computation.value;
  } catch (error) {
    return cleanupFailedComputation(computation, error);
  } finally {
    activeOwner = previousOwner;
  }
};

const isSelectableSource = (source: SourceNode): source is CellNode<unknown> | ComputationNode =>
  source.sourceKind === 'cell' || source.sourceKind === 'computation';

const sourceValue = (source: CellNode<unknown> | ComputationNode): unknown => source.value;

const readPath = (value: unknown, path: readonly string[]): unknown => {
  let current = value;
  for (const property of path) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = (Object(current) as Record<string, unknown>)[property];
  }
  return current;
};

const pathStartsWith = (path: readonly string[], prefix: readonly string[]): boolean =>
  prefix.length <= path.length && prefix.every((property, index) => path[index] === property);

const pathsOverlap = (left: readonly string[], right: readonly string[]): boolean =>
  pathStartsWith(left, right) || pathStartsWith(right, left);

const replacePath = (value: unknown, path: readonly string[], replacement: unknown): unknown => {
  const [property, ...rest] = path;
  if (!property) {
    return replacement;
  }
  if (value === null || typeof value !== 'object') {
    throw new OxeRuntimeError(
      'OXE_RUNTIME_INVALID_WRITE_PATH',
      `Cannot write path "${path.join('.')}" because "${property}" is not inside a record.`,
    );
  }

  const record = value as Record<string, unknown>;
  if (!Object.hasOwn(record, property)) {
    throw new OxeRuntimeError(
      'OXE_RUNTIME_INVALID_WRITE_PATH',
      `Cannot write path "${path.join('.')}" because field "${property}" does not exist.`,
    );
  }
  const current = record[property];
  const next = replacePath(current, rest, replacement);
  if (Object.is(current, next)) {
    return value;
  }
  if (Array.isArray(value)) {
    const copy = [...value];
    copy[Number(property)] = next;
    return copy;
  }
  return { ...record, [property]: next };
};

const ownerIsWithin = (owner: OwnerNode, ancestor: OwnerNode): boolean => {
  let current: OwnerNode | undefined = owner;

  while (current) {
    if (current === ancestor) {
      return true;
    }
    current = current.parent;
  }

  return false;
};

function refreshSource(source: SourceNode): void {
  if (
    isComputation(source) &&
    source.kind === 'derived' &&
    (source.state === 'stale' || !source.initialized)
  ) {
    executeComputation(source);
    return;
  }

  if (isSelection(source)) {
    refreshSource(source.parent);
    if (source.seenVersion !== source.parent.version) {
      const nextValue = readPath(sourceValue(source.parent), source.path);
      if (!Object.is(source.value, nextValue)) {
        source.value = nextValue;
        source.version += 1;
      }
      source.seenVersion = source.parent.version;
    }
  }
}

const reactionDependenciesChanged = (reaction: ComputationNode): boolean => {
  let changed = !reaction.initialized;

  for (const source of reaction.sources) {
    refreshSource(source);
    if (reaction.seenVersions.get(source) !== source.version) {
      changed = true;
    }
  }

  return changed;
};

const flush = (): void => {
  if (batchDepth > 0 || flushing || pendingReactions.length === 0) {
    return;
  }

  flushing = true;
  let cursor = 0;
  const errors: unknown[] = [];

  try {
    while (cursor < pendingReactions.length) {
      if (cursor >= MAX_FLUSH_RUNS) {
        errors.push(
          new OxeRuntimeError(
            'OXE_RUNTIME_FLUSH_LIMIT',
            `Reactive flush exceeded ${MAX_FLUSH_RUNS.toLocaleString()} computations. ` +
              'This usually indicates an indirect reactive cycle.',
          ),
        );
        break;
      }

      const reaction = pendingReactions[cursor];
      cursor += 1;

      if (!reaction) {
        continue;
      }

      reaction.queued = false;
      if (reaction.state === 'stale') {
        try {
          if (reactionDependenciesChanged(reaction)) {
            executeComputation(reaction);
          } else {
            const reasons = [...reaction.staleReasons.values()];
            emitReactiveTrace({
              computation: {
                ...(reaction.traceId ? { id: reaction.traceId } : {}),
                kind: reaction.kind,
                name: reaction.name,
              },
              kind: 'suppress',
              reason: 'selected dependency values remained equal',
              source: reasons[0] ?? sourceTrace(reaction),
            });
            reaction.staleReasons.clear();
            reaction.state = 'clean';
          }
        } catch (error) {
          errors.push(error);
        }
      }
    }
  } finally {
    for (let index = cursor; index < pendingReactions.length; index += 1) {
      const reaction = pendingReactions[index];
      if (reaction) {
        reaction.queued = false;
      }
    }
    pendingReactions.length = 0;
    flushing = false;
  }

  throwCollectedErrors(errors, 'Multiple reactive computations failed during one flush.');
};

const createComputation = (
  kind: ComputationNode['kind'],
  dependencies: readonly Readable<unknown>[],
  run: () => unknown,
  options: NamedOptions,
  equals: Equality<unknown> = Object.is,
): ComputationNode => {
  const parent = requireOwner(kind === 'derived' ? 'createDerived()' : 'createReaction()');
  const computation: ComputationNode = {
    kind,
    run,
    name: options.name ?? kind,
    parent,
    children: new Set(),
    cleanups: [],
    contexts: undefined,
    disposed: false,
    equals,
    observers: new Set(),
    sourceKind: 'computation',
    selections: new Map(),
    staleReasons: new Map(),
    traceId: options.traceId,
    version: 0,
    seenVersions: new Map(),
    sources: new Set(),
    initialized: false,
    queued: false,
    state: 'stale',
    value: undefined,
  };

  parent.children.add(computation);

  for (const dependency of dependencies) {
    const source = (dependency as Readable<unknown> & { [REACTIVE_SOURCE]?: SourceNode })[
      REACTIVE_SOURCE
    ];

    if (!source) {
      disposeOwner(computation);
      throw new OxeRuntimeError(
        'OXE_RUNTIME_INVALID_DEPENDENCY',
        `${kind} "${computation.name}" received a value that is not an OXE reactive source.`,
      );
    }

    const lifetimeSource = isSelection(source) ? source.parent : source;
    if (
      isComputation(lifetimeSource) &&
      (lifetimeSource.state === 'disposed' ||
        !lifetimeSource.parent ||
        !ownerIsWithin(parent, lifetimeSource.parent))
    ) {
      disposeOwner(computation);
      throw new OxeRuntimeError(
        'OXE_RUNTIME_OWNER_LIFETIME',
        `${kind} "${computation.name}" cannot depend on ${computationLabel(lifetimeSource)} because ` +
          'that value belongs to a shorter-lived or unrelated owner. Move the value to a ' +
          'shared enclosing scope.',
      );
    }

    computation.sources.add(source);
    source.observers.add(computation);
  }

  return computation;
};

export const createCell = <T>(initialValue: T, options: CellOptions<T> = {}): Cell<T> => {
  const node: CellNode<T> = {
    name: options.name ?? 'cell',
    observers: new Set(),
    sourceKind: 'cell',
    traceId: options.traceId,
    version: 0,
    value: initialValue,
    equals: options.equals ?? Object.is,
    selections: new Map(),
  };

  const commit = (value: T, changedPath?: readonly string[]): T => {
    if (node.equals(node.value, value)) {
      emitReactiveTrace({
        kind: 'suppress',
        reason: changedPath
          ? `field write to ${changedPath.join('.')} remained equal`
          : 'whole-value write remained equal',
        source: sourceTrace(node),
      });
      return node.value;
    }

    const changedSelections: { readonly node: SelectionNode; readonly value: unknown }[] = [];
    for (const selection of node.selections.values()) {
      if (changedPath && !pathsOverlap(selection.path, changedPath)) {
        continue;
      }
      const nextValue = readPath(value, selection.path);
      if (!Object.is(selection.value, nextValue)) {
        assertNoRunningObserver(selection);
        changedSelections.push({ node: selection, value: nextValue });
      }
    }

    node.value = value;
    node.version += 1;
    for (const changed of changedSelections) {
      changed.node.value = changed.value;
      changed.node.seenVersion = node.version;
      changed.node.version += 1;
    }
    for (const selection of node.selections.values()) {
      selection.seenVersion = node.version;
    }
    emitReactiveTrace({
      kind: 'write',
      reason: changedPath
        ? `updated ${changedPath.join('.')}`
        : `updated whole value; ${changedSelections.length} selected path${changedSelections.length === 1 ? '' : 's'} changed`,
      source: {
        ...sourceTrace(node),
        ...(changedPath ? { path: changedPath } : {}),
      },
    });
    invalidate(node);
    for (const changed of changedSelections) {
      invalidate(changed.node);
    }
    flush();
    return value;
  };

  return {
    [REACTIVE_SOURCE]: node,
    read: () => node.value,
    write: (next) => {
      assertNoRunningObserver(node);
      return commit(next);
    },
    writePath: (path, next) => {
      if (path.length === 0) {
        throw new OxeRuntimeError(
          'OXE_RUNTIME_INVALID_WRITE_PATH',
          'A field write requires at least one path segment.',
        );
      }
      assertNoRunningObserver(node);
      return commit(replacePath(node.value, path, next) as T, path);
    },
  } as Cell<T>;
};

export const createDerived = <T>(
  dependencies: readonly Readable<unknown>[],
  run: () => T,
  options: DerivedOptions<T> = {},
): Readable<T> => {
  const computation = createComputation(
    'derived',
    dependencies,
    run,
    options,
    (options.equals ?? Object.is) as Equality<unknown>,
  );

  return {
    [REACTIVE_SOURCE]: computation,
    read: () => {
      if (computation.state === 'running') {
        throw cycleError(computation.name, computation);
      }

      if (computation.state === 'stale' || !computation.initialized) {
        executeComputation(computation);
      }

      return computation.value as T;
    },
  } as Readable<T>;
};

/**
 * Creates a stable reactive view of one nested property path. Cell-backed paths
 * invalidate only when their selected value changes; derived paths retain the
 * same equality suppression after their parent recomputes.
 */
export const selectPath = <T, Selected = unknown>(
  source: Readable<T>,
  path: readonly string[],
  options: NamedOptions = {},
): Readable<Selected> => {
  if (path.length === 0) {
    return source as unknown as Readable<Selected>;
  }

  const initialSource = (source as Readable<T> & { [REACTIVE_SOURCE]?: SourceNode })[
    REACTIVE_SOURCE
  ];
  if (!initialSource) {
    throw new OxeRuntimeError(
      'OXE_RUNTIME_INVALID_DEPENDENCY',
      'selectPath() received a value that is not an OXE reactive source.',
    );
  }

  const parent = isSelection(initialSource) ? initialSource.parent : initialSource;
  const fullPath = Object.freeze([
    ...(isSelection(initialSource) ? initialSource.path : []),
    ...path,
  ]);
  if (!isSelectableSource(parent)) {
    throw new OxeRuntimeError(
      'OXE_RUNTIME_INVALID_DEPENDENCY',
      'selectPath() requires a readable cell or derived value.',
    );
  }

  const key = JSON.stringify(fullPath);
  let selection = parent.selections.get(key);
  if (!selection) {
    refreshSource(parent);
    selection = {
      name: options.name ?? `${parent.name}.${fullPath.join('.')}`,
      observers: new Set(),
      parent,
      path: fullPath,
      seenVersion: parent.version,
      sourceKind: 'selection',
      traceId: options.traceId ?? parent.traceId,
      value: readPath(sourceValue(parent), fullPath),
      version: 0,
    };
    parent.selections.set(key, selection);
  }

  return {
    [REACTIVE_SOURCE]: selection,
    read: () => {
      refreshSource(selection);
      return selection.value as Selected;
    },
  } as Readable<Selected>;
};

export const createReaction = (
  dependencies: readonly Readable<unknown>[],
  run: () => void,
  options: NamedOptions = {},
): Disposable => {
  const computation = createComputation('reaction', dependencies, run, options);

  try {
    executeComputation(computation);
  } catch (error) {
    return disposeAfterFailure(computation, error);
  }

  return {
    dispose: () => disposeOwner(computation),
  };
};

/**
 * Owns an external resource whose adapter has a compiler-known dispose method.
 * The previous resource is disposed before a dependency-driven replacement and
 * the current resource is disposed with its owner.
 */
export const createDisposableReaction = (
  dependencies: readonly Readable<unknown>[],
  run: () => Disposable,
  options: NamedOptions = {},
): Disposable => {
  let current: Disposable | undefined;
  const disposeCurrent = (): void => {
    const resource = current;
    current = undefined;
    resource?.dispose();
  };
  registerCleanup(disposeCurrent);
  const reaction = createReaction(
    dependencies,
    () => {
      disposeCurrent();
      const next = run();
      if (!next || typeof next.dispose !== 'function') {
        throw new OxeRuntimeError(
          'OXE_RUNTIME_INVALID_DISPOSABLE',
          `${options.name ?? 'Resource adapter'} must return an object with dispose().`,
        );
      }
      current = next;
    },
    options,
  );
  return {
    dispose: () => {
      reaction.dispose();
      disposeCurrent();
    },
  };
};

export const createRoot = <T>(run: () => T, options: NamedOptions = {}): Root<T> => {
  const parent = activeOwner;
  const root = createOwnerNode(options.name ?? 'root', parent);
  parent?.children.add(root);

  const previousOwner = activeOwner;
  activeOwner = root;

  try {
    const value = run();
    return {
      value,
      dispose: () => disposeOwner(root),
    };
  } catch (error) {
    return disposeAfterFailure(root, error);
  } finally {
    activeOwner = previousOwner;
  }
};

/**
 * Captures the current owner without exposing its mutable runtime representation.
 * This is intended for renderer primitives which must create retained child owners
 * while a reaction is executing.
 */
export const captureOwner = (): OwnerScope => {
  const owner = requireOwner('captureOwner()');
  const scope: OwnerScope = Object.freeze({ kind: 'oxe-owner-scope' });
  ownerScopes.set(scope, owner);
  return scope;
};

/** Creates a child root under a previously captured, still-live owner. */
export const createRootIn = <T>(
  scope: OwnerScope,
  run: () => T,
  options: NamedOptions = {},
): Root<T> => {
  const owner = ownerScopes.get(scope);
  if (!owner || owner.disposed) {
    throw new OxeRuntimeError(
      'OXE_RUNTIME_OWNER_LIFETIME',
      'createRootIn() received an invalid or disposed owner scope.',
    );
  }

  const previousOwner = activeOwner;
  activeOwner = owner;
  try {
    return createRoot(run, options);
  } finally {
    activeOwner = previousOwner;
  }
};

export const batch = <T>(run: () => T): T => {
  batchDepth += 1;

  const outcome:
    { readonly ok: true; readonly value: T } | { readonly error: unknown; readonly ok: false } =
    (() => {
      try {
        return { ok: true, value: run() };
      } catch (error) {
        return { error, ok: false };
      } finally {
        batchDepth -= 1;
      }
    })();

  let flushFailure: { readonly error: unknown } | undefined;
  try {
    flush();
  } catch (error) {
    flushFailure = { error };
  }

  if (!outcome.ok && flushFailure) {
    throw new AggregateError(
      [outcome.error, flushFailure.error],
      'The batched procedure and its reactive flush both failed.',
    );
  }

  if (!outcome.ok) {
    throw outcome.error;
  }

  if (flushFailure) {
    throw flushFailure.error;
  }

  return outcome.value;
};

export const untrack = <T>(run: () => T): T => {
  return run();
};

export const registerCleanup = (cleanup: Cleanup): void => {
  requireOwner('registerCleanup()').cleanups.push(cleanup);
};

export const createContext = <T>(name = 'Context'): Context<T> => ({
  id: Symbol(name),
  name,
});

export const withContext = <T, R>(context: Context<T>, value: T, run: () => R): R => {
  const parent = requireOwner('withContext()');
  const scope = createOwnerNode(`${context.name} provider`, parent);
  scope.contexts = new Map([[context.id, value]]);
  parent.children.add(scope);

  const previousOwner = activeOwner;
  activeOwner = scope;

  try {
    return run();
  } catch (error) {
    return disposeAfterFailure(scope, error);
  } finally {
    activeOwner = previousOwner;
  }
};

export const readContext = <T>(context: Context<T>): T => {
  let owner = activeOwner;

  while (owner) {
    if (owner.contexts?.has(context.id)) {
      return owner.contexts.get(context.id) as T;
    }
    owner = owner.parent;
  }

  throw new OxeRuntimeError(
    'OXE_RUNTIME_MISSING_CONTEXT',
    `No provider exists for ${context.name}. Wrap this component in <${context.name} value={...}>.`,
  );
};

export interface CollectionSortOptions {
  readonly descending?: boolean;
}

type CollectionKey = boolean | number | string;

const equalRecordValue = (
  previous: unknown,
  next: unknown,
  seen: WeakMap<object, object> = new WeakMap(),
): boolean => {
  if (Object.is(previous, next)) {
    return true;
  }
  if (
    previous === null ||
    next === null ||
    typeof previous !== 'object' ||
    typeof next !== 'object' ||
    Array.isArray(previous) ||
    Array.isArray(next) ||
    Object.prototype.toString.call(previous) !== '[object Object]' ||
    Object.prototype.toString.call(next) !== '[object Object]'
  ) {
    return false;
  }
  if (seen.get(previous) === next) {
    return true;
  }
  seen.set(previous, next);
  const previousRecord = previous as Record<string, unknown>;
  const nextRecord = next as Record<string, unknown>;
  const previousKeys = Object.keys(previousRecord);
  const nextKeys = Object.keys(nextRecord);
  return (
    previousKeys.length === nextKeys.length &&
    previousKeys.every(
      (key) =>
        Object.hasOwn(nextRecord, key) &&
        equalRecordValue(previousRecord[key], nextRecord[key], seen),
    )
  );
};

const collectionLimit = (limit: number | undefined): number => {
  if (limit === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  if (!Number.isInteger(limit) || limit < 0) {
    throw new RangeError('A collection mutation limit must be a nonnegative integer.');
  }
  return limit;
};

/** Returns a collection with one value appended. The source is never mutated. */
export const addCollection = <T>(source: readonly T[], value: T): readonly T[] => [
  ...source,
  value,
];

/** Removes the first `limit` matching values, or every match when limit is omitted. */
export const removeCollection = <T>(
  source: readonly T[],
  predicate: (value: T, index: number) => boolean,
  limit?: number,
): readonly T[] => {
  const maximum = collectionLimit(limit);
  if (maximum === 0) {
    return source;
  }
  let removed = 0;
  const result = source.filter((value, index) => {
    if (removed >= maximum || !predicate(value, index)) {
      return true;
    }
    removed += 1;
    return false;
  });
  return removed === 0 ? source : result;
};

/** Updates the first `limit` matching values, or every match when limit is omitted. */
export const updateCollection = <T>(
  source: readonly T[],
  predicate: (value: T, index: number) => boolean,
  update: (value: T, index: number) => T,
  limit?: number,
): readonly T[] => {
  const maximum = collectionLimit(limit);
  if (maximum === 0) {
    return source;
  }
  let matched = 0;
  let changed = false;
  const result = source.map((value, index) => {
    if (matched >= maximum || !predicate(value, index)) {
      return value;
    }
    matched += 1;
    const next = update(value, index);
    if (equalRecordValue(value, next)) {
      return value;
    }
    changed = true;
    return next;
  });
  return changed ? result : source;
};

/** Returns a stable key-sorted collection without changing the source. */
export const sortCollection = <T>(
  source: readonly T[],
  key: (value: T, index: number) => CollectionKey,
  options: CollectionSortOptions = {},
): readonly T[] => {
  const direction = options.descending === true ? -1 : 1;
  const sorted = source
    .map((value, index) => ({ index, key: key(value, index), value }))
    .sort((left, right) => {
      if (Object.is(left.key, right.key)) {
        return left.index - right.index;
      }
      return (left.key < right.key ? -1 : 1) * direction;
    })
    .map((entry) => entry.value);
  return sorted.every((value, index) => Object.is(value, source[index])) ? source : sorted;
};
