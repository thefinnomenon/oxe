import { describe, expect, it } from 'vitest';

import {
  addCollection,
  asyncResourceIdentity,
  batch,
  createAsyncDerived,
  createAsyncResource,
  createAsyncResourceCoordinator,
  createCell,
  createContext,
  createDerived,
  createDisposableReaction,
  createReaction,
  createRoot,
  readContext,
  removeCollection,
  registerCleanup,
  selectPath,
  selectAsyncPath,
  sortCollection,
  subscribeOwnershipSnapshots,
  subscribeReactiveTrace,
  untrack,
  updateCollection,
  withContext,
  type OxeRuntimeError,
  type OwnershipSnapshot,
  type ReactiveTraceEvent,
  type Readable,
} from '../src/index.js';

const deferred = <T>(): {
  readonly promise: Promise<T>;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: T) => void;
} => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const settleAsyncResources = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('reactive graph', () => {
  it('updates collections immutably with deterministic limits and stable sorting', () => {
    const source: readonly {
      readonly group: string;
      readonly id: number;
      readonly name: string;
    }[] = [
      { id: 1, group: 'a', name: 'Lin' },
      { id: 2, group: 'a', name: 'Ada' },
      { id: 3, group: 'b', name: 'Ada' },
    ];

    const added = addCollection(source, { id: 4, group: 'b', name: 'Grace' });
    const updated = updateCollection(
      added,
      (user) => user.group === 'a',
      (user) => ({ ...user, name: 'Chris' }),
      1,
    );
    const removed = removeCollection(updated, (user) => user.name === 'Ada', 1);
    const sorted = sortCollection(removed, (user) => user.name);
    const descending = sortCollection(removed, (user) => user.name, { descending: true });

    expect(source.map((user) => user.name)).toEqual(['Lin', 'Ada', 'Ada']);
    expect(updated.map((user) => user.name)).toEqual(['Chris', 'Ada', 'Ada', 'Grace']);
    expect(removed.map((user) => user.id)).toEqual([1, 3, 4]);
    expect(sorted.map((user) => user.id)).toEqual([3, 1, 4]);
    expect(descending.map((user) => user.id)).toEqual([4, 1, 3]);
    expect(
      updateCollection(
        source,
        () => false,
        (user) => user,
      ),
    ).toBe(source);
    expect(
      updateCollection(
        source,
        () => true,
        (user) => ({ ...user }),
      ),
    ).toBe(source);
    expect(removeCollection(source, () => true, 0)).toBe(source);
    expect(sortCollection(sorted, (user) => user.name)).toBe(sorted);
    expect(() => removeCollection(source, () => true, -1)).toThrow(
      'A collection mutation limit must be a nonnegative integer.',
    );
  });

  it('updates explicit dependencies and suppresses equal writes', () => {
    const values: number[] = [];

    const root = createRoot(() => {
      const count = createCell(1, { name: 'count' });
      const doubled = createDerived([count], () => count.read() * 2, { name: 'doubled' });
      createReaction([doubled], () => values.push(doubled.read()), { name: 'render text' });
      return count;
    });

    expect(values).toEqual([2]);
    root.value.write(1);
    expect(values).toEqual([2]);
    root.value.write(2);
    expect(values).toEqual([2, 4]);

    root.dispose();
  });

  it('invalidates only changed paths of a standalone record cell', () => {
    interface Profile {
      readonly identity: { readonly name: string };
      readonly stats: { readonly score: number };
    }

    const names: string[] = [];
    const scores: number[] = [];
    let wholeRecordRuns = 0;
    const initial: Profile = {
      identity: { name: 'Ada' },
      stats: { score: 1 },
    };

    const root = createRoot(() => {
      const profile = createCell(initial, { name: 'profile' });
      const name = selectPath<Profile, string>(profile, ['identity', 'name']);
      const score = selectPath<Profile, number>(profile, ['stats', 'score']);

      createReaction([name], () => names.push(name.read()), { name: 'name consumer' });
      createReaction([score], () => scores.push(score.read()), { name: 'score consumer' });
      createReaction([profile], () => {
        profile.read();
        wholeRecordRuns += 1;
      });

      return profile;
    });

    const identityBeforeScore = root.value.read().identity;
    root.value.writePath(['stats', 'score'], 2);

    expect(names).toEqual(['Ada']);
    expect(scores).toEqual([1, 2]);
    expect(wholeRecordRuns).toBe(2);
    expect(root.value.read().identity).toBe(identityBeforeScore);

    root.value.writePath(['identity', 'name'], 'Grace');

    expect(names).toEqual(['Ada', 'Grace']);
    expect(scores).toEqual([1, 2]);
    expect(wholeRecordRuns).toBe(3);
    root.dispose();
  });

  it('suppresses unchanged paths selected from derived records', () => {
    const stableValues: string[] = [];
    const counts: number[] = [];

    const root = createRoot(() => {
      const count = createCell(1, { name: 'count' });
      const summary = createDerived([count], () => ({ count: count.read(), stable: 'same' }), {
        name: 'summary',
      });
      const stable = selectPath<{ readonly count: number; readonly stable: string }, string>(
        summary,
        ['stable'],
      );
      const selectedCount = selectPath<{ readonly count: number; readonly stable: string }, number>(
        summary,
        ['count'],
      );

      createReaction([stable], () => stableValues.push(stable.read()));
      createReaction([selectedCount], () => counts.push(selectedCount.read()));
      return count;
    });

    root.value.write(2);

    expect(stableValues).toEqual(['same']);
    expect(counts).toEqual([1, 2]);
    root.dispose();
  });

  it('explains writes, invalidations, executions, and equality suppression', () => {
    const events: ReactiveTraceEvent[] = [];
    const trace = subscribeReactiveTrace((event) => events.push(event));
    const root = createRoot(() => {
      const profile = createCell(
        { name: 'Ada', score: 1 },
        { name: 'profile', traceId: 'cell:profile' },
      );
      const name = selectPath<{ readonly name: string; readonly score: number }, string>(
        profile,
        ['name'],
        { traceId: 'cell:profile' },
      );
      createReaction([name], () => name.read(), {
        name: 'name text',
        traceId: 'text:name',
      });
      return profile;
    });

    events.length = 0;
    root.value.writePath(['score'], 2);
    root.value.writePath(['name'], 'Grace');
    root.value.writePath(['name'], 'Grace');

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'write', reason: 'updated score' }),
        expect.objectContaining({ kind: 'invalidate', reason: 'profile.name changed' }),
        expect.objectContaining({
          kind: 'execute',
          computation: expect.objectContaining({ name: 'name text' }),
        }),
        expect.objectContaining({ kind: 'suppress', reason: 'field write to name remained equal' }),
      ]),
    );

    trace.dispose();
    root.dispose();
  });

  it('stores function values without confusing them with updater callbacks', () => {
    let calls = 0;
    const initial = () => undefined;
    const replacement = () => {
      calls += 1;
    };
    const handler = createCell<() => void>(initial, { name: 'handler' });

    handler.write(replacement);

    expect(handler.read()).toBe(replacement);
    expect(calls).toBe(0);
    handler.read()();
    expect(calls).toBe(1);
  });

  it('does not rerun consumers when a derived value remains equal', () => {
    const values: boolean[] = [];
    let derivedRuns = 0;

    const root = createRoot(() => {
      const count = createCell(1, { name: 'count' });
      const positive = createDerived(
        [count],
        () => {
          derivedRuns += 1;
          return count.read() > 0;
        },
        { name: 'positive' },
      );

      createReaction([positive], () => values.push(positive.read()), {
        name: 'positive consumer',
      });

      return count;
    });

    root.value.write(3);

    expect(derivedRuns).toBe(2);
    expect(values).toEqual([true]);
    root.dispose();
  });

  it('batches a diamond graph without exposing intermediate values', () => {
    const totals: number[] = [];
    const runs = { left: 0, right: 0, total: 0, reaction: 0 };

    const root = createRoot(() => {
      const source = createCell(1, { name: 'source' });
      const left = createDerived(
        [source],
        () => {
          runs.left += 1;
          return source.read() * 2;
        },
        { name: 'left' },
      );
      const right = createDerived(
        [source],
        () => {
          runs.right += 1;
          return source.read() * 3;
        },
        { name: 'right' },
      );
      const total = createDerived(
        [left, right],
        () => {
          runs.total += 1;
          return left.read() + right.read();
        },
        { name: 'total' },
      );

      createReaction(
        [total],
        () => {
          runs.reaction += 1;
          totals.push(total.read());
        },
        { name: 'total text' },
      );

      return source;
    });

    batch(() => {
      root.value.write(2);
      root.value.write(3);
    });

    expect(totals).toEqual([5, 15]);
    expect(runs).toEqual({ left: 2, right: 2, total: 2, reaction: 2 });
    root.dispose();
  });

  it('uses untrack as a compiler-visible snapshot boundary', () => {
    const values: string[] = [];

    const root = createRoot(() => {
      const trigger = createCell(0, { name: 'trigger' });
      const snapshot = createCell('initial', { name: 'snapshot' });

      createReaction(
        [trigger],
        () => values.push(`${trigger.read()}:${untrack(() => snapshot.read())}`),
        { name: 'analytics call' },
      );

      return { trigger, snapshot };
    });

    root.value.snapshot.write('later');
    expect(values).toEqual(['0:initial']);

    root.value.trigger.write(1);
    expect(values).toEqual(['0:initial', '1:later']);
    root.dispose();
  });

  it('disposes nested owners before a parent computation reruns', () => {
    const events: string[] = [];

    const root = createRoot(() => {
      const enabled = createCell(true, { name: 'enabled' });
      const message = createCell('first', { name: 'message' });

      createReaction(
        [enabled],
        () => {
          if (!enabled.read()) {
            return;
          }

          registerCleanup(() => events.push('branch disposed'));
          createReaction([message], () => events.push(`message:${message.read()}`), {
            name: 'message region',
          });
        },
        { name: 'conditional region' },
      );

      return { enabled, message };
    });

    root.value.message.write('second');
    root.value.enabled.write(false);
    root.value.message.write('third');

    expect(events).toEqual(['message:first', 'message:second', 'branch disposed']);
    root.dispose();
  });

  it('runs cleanup before rerun and again when the owner is disposed', () => {
    const events: string[] = [];

    const root = createRoot(() => {
      const topic = createCell('news', { name: 'topic' });

      createReaction(
        [topic],
        () => {
          const current = topic.read();
          events.push(`subscribe:${current}`);
          registerCleanup(() => events.push(`unsubscribe:${current}`));
        },
        { name: 'subscription' },
      );

      return topic;
    });

    root.value.write('sports');
    root.dispose();

    expect(events).toEqual([
      'subscribe:news',
      'unsubscribe:news',
      'subscribe:sports',
      'unsubscribe:sports',
    ]);
  });

  it('stops disposed reactions from receiving updates', () => {
    const values: number[] = [];

    const root = createRoot(() => {
      const count = createCell(0);
      const reaction = createReaction([count], () => values.push(count.read()));
      return { count, reaction };
    });

    root.value.reaction.dispose();
    root.value.count.write(1);
    expect(values).toEqual([0]);
    root.dispose();
  });

  it('recovers the scheduler after a reaction throws', () => {
    const values: number[] = [];

    const root = createRoot(() => {
      const count = createCell(0, { name: 'count' });
      createReaction(
        [count],
        () => {
          const value = count.read();
          if (value === 1) {
            throw new Error('deliberate failure');
          }
          values.push(value);
        },
        { name: 'fallible reaction' },
      );
      return count;
    });

    expect(() => root.value.write(1)).toThrow('deliberate failure');
    expect(() => root.value.write(2)).not.toThrow();
    expect(values).toEqual([0, 2]);
    root.dispose();
  });

  it('continues flushing unrelated reactions after one throws', () => {
    const values: number[] = [];

    const root = createRoot(() => {
      const count = createCell(0, { name: 'count' });

      createReaction(
        [count],
        () => {
          if (count.read() === 1) {
            throw new Error('first reaction failed');
          }
        },
        { name: 'fallible reaction' },
      );
      createReaction([count], () => values.push(count.read()), { name: 'healthy reaction' });

      return count;
    });

    expect(() => root.value.write(1)).toThrow('first reaction failed');
    expect(values).toEqual([0, 1]);

    expect(() => root.value.write(2)).not.toThrow();
    expect(values).toEqual([0, 1, 2]);
    root.dispose();
  });

  it('cleans resources created by a failed reaction immediately', () => {
    const events: string[] = [];

    const root = createRoot(() => {
      const count = createCell(0, { name: 'count' });

      createReaction(
        [count],
        () => {
          if (count.read() === 1) {
            registerCleanup(() => events.push('partial resource disposed'));
            throw new Error('reaction failed after acquiring a resource');
          }
        },
        { name: 'resource owner' },
      );

      return count;
    });

    expect(() => root.value.write(1)).toThrow('reaction failed after acquiring a resource');
    expect(events).toEqual(['partial resource disposed']);

    root.dispose();
    expect(events).toEqual(['partial resource disposed']);
  });

  it('preserves both a batch failure and a flush failure', () => {
    const root = createRoot(() => {
      const count = createCell(0, { name: 'count' });
      createReaction(
        [count],
        () => {
          if (count.read() === 1) {
            throw new Error('flush failed');
          }
        },
        { name: 'fallible reaction' },
      );
      return count;
    });

    let failure: unknown;

    try {
      batch(() => {
        root.value.write(1);
        throw new Error('procedure failed');
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      expect.objectContaining({ message: 'procedure failed' }),
      expect.objectContaining({ message: 'flush failed' }),
    ]);
    root.dispose();
  });

  it('removes a reaction whose initial execution fails', () => {
    let runs = 0;

    const root = createRoot(() => {
      const count = createCell(0, { name: 'count' });

      expect(() =>
        createReaction(
          [count],
          () => {
            runs += 1;
            throw new Error('initial reaction failed');
          },
          { name: 'failed reaction' },
        ),
      ).toThrow('initial reaction failed');

      return count;
    });

    expect(runs).toBe(1);
    expect(() => root.value.write(1)).not.toThrow();
    expect(runs).toBe(1);
    root.dispose();
  });

  it('attempts every cleanup even when one fails', () => {
    const events: string[] = [];

    const root = createRoot(() => {
      registerCleanup(() => events.push('first'));
      registerCleanup(() => {
        events.push('throws');
        throw new Error('cleanup failed');
      });
      registerCleanup(() => events.push('last'));
    });

    expect(() => root.dispose()).toThrow('cleanup failed');
    expect(events).toEqual(['last', 'throws', 'first']);
  });

  it('rejects a direct reactive write cycle before mutating the source', () => {
    let count: ReturnType<typeof createCell<number>> | undefined;

    expect(() =>
      createRoot(() => {
        const localCount = createCell(0, { name: 'count' });
        count = localCount;
        createReaction([localCount], () => localCount.write(localCount.read() + 1), {
          name: 'self writer',
        });
      }),
    ).toThrowError(
      expect.objectContaining<Partial<OxeRuntimeError>>({
        code: 'OXE_RUNTIME_CYCLE',
      }),
    );

    expect(count?.read()).toBe(0);
  });

  it('rejects a reactive write cycle routed through a selected derived field', () => {
    let count: ReturnType<typeof createCell<number>> | undefined;

    expect(() =>
      createRoot(() => {
        const localCount = createCell(0, { name: 'count' });
        count = localCount;
        const summary = createDerived([localCount], () => ({ value: localCount.read() }), {
          name: 'summary',
        });
        const value = selectPath<{ readonly value: number }, number>(summary, ['value']);
        createReaction([value], () => localCount.write(value.read() + 1), {
          name: 'selected self writer',
        });
      }),
    ).toThrowError(
      expect.objectContaining<Partial<OxeRuntimeError>>({
        code: 'OXE_RUNTIME_CYCLE',
      }),
    );

    expect(count?.read()).toBe(0);
  });

  it('requires computations to declare real OXE dependencies', () => {
    const fake = { read: () => 1 } as Readable<number>;

    expect(() =>
      createRoot(() => createDerived([fake], () => fake.read() + 1, { name: 'invalid' })),
    ).toThrowError(
      expect.objectContaining<Partial<OxeRuntimeError>>({
        code: 'OXE_RUNTIME_INVALID_DEPENDENCY',
      }),
    );
  });

  it('disposes compiler-known resources before replacement and with their owner', () => {
    const disposed: string[] = [];
    const root = createRoot(() => {
      const room = createCell('general');
      createDisposableReaction(
        [room],
        () => {
          const activeRoom = room.read();
          return { dispose: () => disposed.push(activeRoom) };
        },
        { name: 'message subscription' },
      );
      return room;
    });

    root.value.write('random');
    expect(disposed).toEqual(['general']);
    root.dispose();
    expect(disposed).toEqual(['general', 'random']);
  });

  it('rejects reactive dependencies owned by an unrelated root', () => {
    const sourceRoot = createRoot(() => {
      const source = createCell(1, { name: 'source' });
      return createDerived([source], () => source.read() * 2, { name: 'owned derived' });
    });

    expect(() =>
      createRoot(() =>
        createReaction([sourceRoot.value], () => sourceRoot.value.read(), {
          name: 'cross-root consumer',
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<OxeRuntimeError>>({
        code: 'OXE_RUNTIME_OWNER_LIFETIME',
      }),
    );

    sourceRoot.dispose();
  });

  it('allows a nested owner to consume a derived value from an enclosing owner', () => {
    const ScopeContext = createContext<null>('ScopeContext');
    const values: number[] = [];

    const root = createRoot(() => {
      const source = createCell(1, { name: 'source' });
      const doubled = createDerived([source], () => source.read() * 2, { name: 'doubled' });

      withContext(ScopeContext, null, () => {
        createReaction([doubled], () => values.push(doubled.read()), {
          name: 'nested consumer',
        });
      });

      return source;
    });

    root.value.write(2);
    expect(values).toEqual([2, 4]);
    root.dispose();
  });
});

describe('async resource graph', () => {
  it('deduplicates equal identities and derives individual record fields', async () => {
    const coordinator = createAsyncResourceCoordinator();
    const request = deferred<{ readonly avatar: string; readonly name: string }>();
    let calls = 0;
    const root = createRoot(() => {
      const first = createAsyncResource(
        [],
        () => ['user-1'] as const,
        () => {
          calls += 1;
          return request.promise;
        },
        { capability: 'users.get', coordinator, name: 'first user' },
      );
      const second = createAsyncResource(
        [],
        () => ['user-1'] as const,
        () => {
          calls += 1;
          return request.promise;
        },
        { capability: 'users.get', coordinator, name: 'second user' },
      );
      const name = selectAsyncPath(first, ['name'], { name: 'user name' });
      return { first, name, second };
    });

    await settleAsyncResources();
    expect(calls).toBe(1);
    expect(root.value.first.snapshot().status).toBe('pending');

    request.resolve({ avatar: '/ada.png', name: 'Ada' });
    await settleAsyncResources();
    expect(root.value.first.read()).toEqual({ avatar: '/ada.png', name: 'Ada' });
    expect(root.value.second.read()).toBe(root.value.first.read());
    expect(root.value.name.read()).toBe('Ada');
    expect(coordinator.checkpoints()).toEqual([
      {
        identity: asyncResourceIdentity('users.get', ['user-1']),
        value: { avatar: '/ada.png', name: 'Ada' },
      },
    ]);

    root.dispose();
    coordinator.dispose();
  });

  it('aborts obsolete identities and ignores their late completion', async () => {
    const coordinator = createAsyncResourceCoordinator();
    const requests = new Map<
      string,
      ReturnType<typeof deferred<{ readonly name: string }>> & { readonly signal: AbortSignal }
    >();
    const root = createRoot(() => {
      const id = createCell('user-1');
      const user = createAsyncResource(
        [id],
        () => [id.read()] as const,
        ([nextId], signal) => {
          const request = deferred<{ readonly name: string }>();
          requests.set(nextId, { ...request, signal });
          return request.promise;
        },
        { capability: 'users.get', coordinator },
      );
      return { id, user };
    });

    await settleAsyncResources();
    const obsolete = requests.get('user-1');
    root.value.id.write('user-2');
    await settleAsyncResources();
    expect(obsolete?.signal.aborted).toBe(true);
    obsolete?.resolve({ name: 'Obsolete' });
    requests.get('user-2')?.resolve({ name: 'Grace' });
    await settleAsyncResources();
    expect(root.value.user.read()).toEqual({ name: 'Grace' });

    root.dispose();
    coordinator.dispose();
  });

  it('retains ready data during refresh and hydrates without rerunning the loader', async () => {
    const identity = asyncResourceIdentity('users.get', ['user-1'], 'tenant-a');
    const hydratedCoordinator = createAsyncResourceCoordinator();
    hydratedCoordinator.hydrate([{ identity, value: { name: 'Ada' } }]);
    const refresh = deferred<{ readonly name: string }>();
    let hydratedCalls = 0;
    const hydratedRoot = createRoot(() =>
      createAsyncResource(
        [],
        () => ['user-1'] as const,
        () => {
          hydratedCalls += 1;
          return refresh.promise;
        },
        { capability: 'users.get', coordinator: hydratedCoordinator, scope: 'tenant-a' },
      ),
    );
    expect(hydratedRoot.value.read()).toEqual({ name: 'Ada' });
    expect(hydratedCalls).toBe(0);

    hydratedRoot.value.refresh();
    await settleAsyncResources();
    expect(hydratedCalls).toBe(1);
    expect(hydratedRoot.value.snapshot()).toMatchObject({
      status: 'refreshing',
      value: { name: 'Ada' },
    });

    refresh.resolve({ name: 'Grace' });
    await settleAsyncResources();
    expect(hydratedRoot.value.read()).toEqual({ name: 'Grace' });

    hydratedRoot.dispose();
    hydratedCoordinator.dispose();
  });

  it('propagates pending and failure through async derived values', async () => {
    const coordinator = createAsyncResourceCoordinator();
    const request = deferred<number>();
    const root = createRoot(() => {
      const value = createAsyncResource(
        [],
        () => [] as const,
        () => request.promise,
        {
          capability: 'numbers.get',
          coordinator,
        },
      );
      return createAsyncDerived([value], () => value.read() * 2);
    });

    expect(root.value.snapshot().status).toBe('pending');
    request.reject(new Error('No number'));
    await settleAsyncResources();
    expect(root.value.snapshot()).toMatchObject({ status: 'failed' });
    expect(() => root.value.read()).toThrow('No number');

    root.dispose();
    coordinator.dispose();
  });
});

describe('ownership-scoped context', () => {
  it('reports live owners and named resources only while inspection is subscribed', () => {
    const snapshots: OwnershipSnapshot[] = [];
    const subscription = subscribeOwnershipSnapshots((snapshot) => snapshots.push(snapshot));
    const SessionContext = createContext<string>('SessionContext');

    const root = createRoot(
      () => {
        const count = createCell(1, { name: 'count' });
        const doubled = createDerived([count], () => count.read() * 2, {
          name: 'doubled',
          traceId: 'derived:doubled',
        });
        registerCleanup(() => undefined, { name: 'unsubscribe', kind: 'resource' });
        withContext(SessionContext, 'active', () => {
          createReaction([doubled], () => doubled.read(), { name: 'text binding' });
        });
      },
      { name: 'app root', traceId: 'component:app' },
    );

    const mounted = snapshots.at(-1);
    expect(mounted?.summary).toEqual({
      contexts: 1,
      derived: 1,
      owners: 4,
      reactions: 1,
      resources: 1,
      roots: 1,
    });
    expect(mounted?.owners).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'root', name: 'app root', traceId: 'component:app' }),
        expect.objectContaining({
          kind: 'derived',
          name: 'doubled',
          traceId: 'derived:doubled',
        }),
        expect.objectContaining({ kind: 'context', name: 'SessionContext provider' }),
        expect.objectContaining({ kind: 'reaction', name: 'text binding' }),
      ]),
    );
    expect(mounted?.owners.find((owner) => owner.name === 'app root')?.resources).toEqual([
      { kind: 'resource', name: 'unsubscribe' },
    ]);

    root.dispose();
    expect(snapshots.at(-1)?.summary.owners).toBe(0);
    expect(snapshots.at(-1)?.summary.resources).toBe(0);

    const snapshotCount = snapshots.length;
    subscription.dispose();
    createRoot(() => undefined).dispose();
    expect(snapshots).toHaveLength(snapshotCount);
  });

  it('reads the nearest identity-matched provider', () => {
    const SessionContext = createContext<string>('SessionContext');
    const values: string[] = [];

    const root = createRoot(() =>
      withContext(SessionContext, 'outer', () => {
        values.push(readContext(SessionContext));

        withContext(SessionContext, 'inner', () => {
          values.push(readContext(SessionContext));
          createReaction([], () => values.push(readContext(SessionContext)));
        });

        values.push(readContext(SessionContext));
      }),
    );

    expect(values).toEqual(['outer', 'inner', 'inner', 'outer']);
    root.dispose();
  });

  it('reports a missing provider with the context name', () => {
    const SessionContext = createContext<string>('SessionContext');

    expect(() => createRoot(() => readContext(SessionContext))).toThrowError(
      expect.objectContaining<Partial<OxeRuntimeError>>({
        code: 'OXE_RUNTIME_MISSING_CONTEXT',
        message: expect.stringContaining('SessionContext') as unknown as string,
      }),
    );
  });

  it('rejects ownership-bound operations outside a root', () => {
    expect(() => createReaction([], () => undefined)).toThrowError(
      expect.objectContaining<Partial<OxeRuntimeError>>({
        code: 'OXE_RUNTIME_MISSING_OWNER',
      }),
    );
    expect(() => registerCleanup(() => undefined)).toThrowError(
      expect.objectContaining<Partial<OxeRuntimeError>>({
        code: 'OXE_RUNTIME_MISSING_OWNER',
      }),
    );
  });
});
