import { describe, expect, it } from 'vitest';

import {
  batch,
  createCell,
  createContext,
  createDerived,
  createReaction,
  createRoot,
  readContext,
  registerCleanup,
  untrack,
  withContext,
  type OxeRuntimeError,
  type Readable,
} from '../src/index.js';

describe('reactive graph', () => {
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

describe('ownership-scoped context', () => {
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
