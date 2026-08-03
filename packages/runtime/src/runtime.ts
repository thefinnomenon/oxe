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
  version: number;
}

interface CellNode<T> extends SourceNode {
  readonly equals: Equality<T>;
  value: T;
}

interface ComputationNode extends OwnerNode, SourceNode {
  readonly equals: Equality<unknown>;
  readonly kind: 'derived' | 'reaction';
  readonly run: () => unknown;
  readonly seenVersions: Map<SourceNode, number>;
  readonly sources: Set<SourceNode>;
  initialized: boolean;
  queued: boolean;
  state: ComputationState;
  value: unknown;
}

export interface Readable<T> {
  read(): T;
}

export interface Cell<T> extends Readable<T> {
  write(next: T): T;
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
}

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
    computation.observers.clear();
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
};

const enqueueReaction = (reaction: ComputationNode): void => {
  if (reaction.queued || reaction.disposed) {
    return;
  }

  reaction.queued = true;
  pendingReactions.push(reaction);
};

const markStale = (computation: ComputationNode, visited = new Set<ComputationNode>()): void => {
  if (computation.state === 'disposed' || visited.has(computation)) {
    return;
  }
  visited.add(computation);

  if (computation.state === 'running') {
    throw cycleError(computation.name, computation);
  }

  computation.state = 'stale';

  for (const observer of computation.observers) {
    markStale(observer, visited);
  }

  if (computation.kind === 'reaction') {
    enqueueReaction(computation);
  }
};

const invalidate = (source: SourceNode): void => {
  const visited = new Set<ComputationNode>();
  for (const observer of source.observers) {
    markStale(observer, visited);
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
      refreshDerived(source);
    }
  }

  runOwnerCleanups(computation);

  const previousOwner = activeOwner;
  const previousValue = computation.value;
  const wasInitialized = computation.initialized;
  activeOwner = computation;
  computation.state = 'running';

  try {
    const nextValue = computation.run();

    if (computation.kind === 'derived') {
      if (!wasInitialized || !computation.equals(previousValue, nextValue)) {
        computation.value = nextValue;
        computation.version += 1;
      }
    } else {
      computation.value = nextValue;
      for (const source of computation.sources) {
        computation.seenVersions.set(source, source.version);
      }
    }

    computation.initialized = true;
    computation.state = 'clean';
    return computation.value;
  } catch (error) {
    return cleanupFailedComputation(computation, error);
  } finally {
    activeOwner = previousOwner;
  }
};

const isComputation = (source: SourceNode): source is ComputationNode => 'kind' in source;

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

function refreshDerived(source: SourceNode): void {
  if (
    isComputation(source) &&
    source.kind === 'derived' &&
    (source.state === 'stale' || !source.initialized)
  ) {
    executeComputation(source);
  }
}

const reactionDependenciesChanged = (reaction: ComputationNode): boolean => {
  let changed = !reaction.initialized;

  for (const source of reaction.sources) {
    refreshDerived(source);
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

    if (
      isComputation(source) &&
      (source.state === 'disposed' || !source.parent || !ownerIsWithin(parent, source.parent))
    ) {
      disposeOwner(computation);
      throw new OxeRuntimeError(
        'OXE_RUNTIME_OWNER_LIFETIME',
        `${kind} "${computation.name}" cannot depend on ${computationLabel(source)} because ` +
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
    version: 0,
    value: initialValue,
    equals: options.equals ?? Object.is,
  };

  const commit = (value: T): T => {
    if (node.equals(node.value, value)) {
      return node.value;
    }

    node.value = value;
    node.version += 1;
    invalidate(node);
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
