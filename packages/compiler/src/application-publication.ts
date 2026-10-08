import type { ApplicationGraphV1 } from '@oxe/graph';

import type { ApplicationArtifactCompilationV1 } from './application-artifact-cache.js';

export type ApplicationPublicationFailureStageV1 = 'activation' | 'build' | 'migration' | 'runtime';

export interface ApplicationPublicationAttemptV1 {
  readonly completedAt: string;
  readonly message?: string;
  readonly revision: number;
  readonly stage?: ApplicationPublicationFailureStageV1;
  readonly startedAt: string;
  readonly status: 'failed' | 'published';
}

export interface ApplicationPublicationStateV1 {
  readonly activeRevision: number;
  readonly candidateRevision?: number;
  readonly lastAttempt?: ApplicationPublicationAttemptV1;
  readonly schemaVersion: 'oxe.application-publication-state.v1';
  readonly status: 'active' | 'failed' | 'publishing';
}

export interface PreparedApplicationRuntimeV1 {
  /** Atomically makes the prepared runtime/database target externally visible. */
  activate(): PromiseLike<void> | void;
  /** Releases an inactive candidate or a superseded active runtime. */
  dispose(): PromiseLike<void> | void;
  /** Stops owned processes for host shutdown while retaining restartable state. */
  shutdown?(): PromiseLike<void> | void;
}

export interface ApplicationPublicationPreparationV1 {
  readonly compilation: ApplicationArtifactCompilationV1;
  readonly graph: ApplicationGraphV1;
  readonly previous: ApplicationArtifactCompilationV1;
}

export interface ApplicationPublicationAdapterV1 {
  /** Applies migrations and starts the candidate only inside an isolated target. */
  prepare(
    input: ApplicationPublicationPreparationV1,
  ): PromiseLike<PreparedApplicationRuntimeV1> | PreparedApplicationRuntimeV1;
}

export interface ApplicationPublicationManagerOptionsV1 {
  readonly adapter?: ApplicationPublicationAdapterV1;
  readonly clock?: () => string;
  readonly compile: (graph: ApplicationGraphV1) => ApplicationArtifactCompilationV1;
  /** A recovered last-good runtime that is already active when the manager starts. */
  readonly initialRuntime?: PreparedApplicationRuntimeV1;
  /** Persists the active pointer before the previous runtime is released. Must be synchronous. */
  readonly onActivate?: (compilation: ApplicationArtifactCompilationV1) => void;
}

export class ApplicationPublicationError extends Error {
  public constructor(
    public readonly stage: ApplicationPublicationFailureStageV1,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ApplicationPublicationError';
  }
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const frozenState = (state: ApplicationPublicationStateV1): ApplicationPublicationStateV1 =>
  Object.freeze({
    ...state,
    ...(state.lastAttempt ? { lastAttempt: Object.freeze({ ...state.lastAttempt }) } : {}),
  });

/**
 * Serializes staged development publications and owns the active last-good artifact snapshot.
 * The adapter must keep migration and runtime preparation isolated until `activate` succeeds.
 */
export class ApplicationPublicationManager {
  readonly #adapter: ApplicationPublicationAdapterV1 | undefined;
  readonly #clock: () => string;
  readonly #compile: (graph: ApplicationGraphV1) => ApplicationArtifactCompilationV1;
  readonly #onActivate: ((compilation: ApplicationArtifactCompilationV1) => void) | undefined;
  #active: ApplicationArtifactCompilationV1;
  #activeRuntime: PreparedApplicationRuntimeV1 | undefined;
  #queue: Promise<void> = Promise.resolve();
  #state: ApplicationPublicationStateV1;

  public constructor(
    initial: ApplicationArtifactCompilationV1,
    options: ApplicationPublicationManagerOptionsV1,
  ) {
    this.#active = initial;
    this.#adapter = options.adapter;
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#compile = options.compile;
    this.#onActivate = options.onActivate;
    this.#activeRuntime = options.initialRuntime;
    this.#state = frozenState({
      activeRevision: initial.revision,
      schemaVersion: 'oxe.application-publication-state.v1',
      status: 'active',
    });
  }

  public active(): ApplicationArtifactCompilationV1 {
    return this.#active;
  }

  public state(): ApplicationPublicationStateV1 {
    return this.#state;
  }

  /** Synchronous compatibility path used only when no migration/runtime adapter is configured. */
  public publishImmediately(graph: ApplicationGraphV1): ApplicationArtifactCompilationV1 {
    if (this.#adapter)
      throw new ApplicationPublicationError(
        'runtime',
        'Configured publication adapters require asynchronous publication.',
      );
    const startedAt = this.#clock();
    let compilation: ApplicationArtifactCompilationV1;
    try {
      compilation = this.#compile(graph);
    } catch (error) {
      this.#failed(graph.revision, startedAt, 'build', error);
      throw new ApplicationPublicationError('build', message(error), { cause: error });
    }
    try {
      this.#onActivate?.(compilation);
    } catch (error) {
      this.#failed(graph.revision, startedAt, 'activation', error);
      throw new ApplicationPublicationError('activation', message(error), { cause: error });
    }
    this.#active = compilation;
    this.#published(compilation.revision, startedAt);
    return compilation;
  }

  public publish(graph: ApplicationGraphV1): Promise<ApplicationArtifactCompilationV1> {
    const run = this.#queue.then(
      () => this.#publish(graph),
      () => this.#publish(graph),
    );
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  public async close(): Promise<void> {
    await this.#queue;
    const runtime = this.#activeRuntime;
    this.#activeRuntime = undefined;
    if (runtime?.shutdown) await runtime.shutdown();
    else await runtime?.dispose();
  }

  async #publish(graph: ApplicationGraphV1): Promise<ApplicationArtifactCompilationV1> {
    if (graph.revision < this.#active.revision)
      throw new ApplicationPublicationError(
        'activation',
        `Cannot publish stale r${graph.revision}; r${this.#active.revision} is active.`,
      );
    if (graph.revision === this.#active.revision) return this.#active;
    const startedAt = this.#clock();
    this.#state = frozenState({
      activeRevision: this.#active.revision,
      candidateRevision: graph.revision,
      schemaVersion: 'oxe.application-publication-state.v1',
      status: 'publishing',
    });
    let compilation: ApplicationArtifactCompilationV1;
    try {
      compilation = this.#compile(graph);
    } catch (error) {
      this.#failed(graph.revision, startedAt, 'build', error);
      throw new ApplicationPublicationError('build', message(error), { cause: error });
    }
    if (!this.#adapter) {
      try {
        this.#onActivate?.(compilation);
      } catch (error) {
        this.#failed(graph.revision, startedAt, 'activation', error);
        throw new ApplicationPublicationError('activation', message(error), { cause: error });
      }
      this.#active = compilation;
      this.#published(compilation.revision, startedAt);
      return compilation;
    }
    let candidate: PreparedApplicationRuntimeV1;
    try {
      candidate = await this.#adapter.prepare({
        compilation,
        graph,
        previous: this.#active,
      });
    } catch (error) {
      const stage = error instanceof ApplicationPublicationError ? error.stage : 'runtime';
      this.#failed(graph.revision, startedAt, stage, error);
      throw error instanceof ApplicationPublicationError
        ? error
        : new ApplicationPublicationError(stage, message(error), { cause: error });
    }
    try {
      await candidate.activate();
      this.#onActivate?.(compilation);
    } catch (error) {
      try {
        await candidate.dispose();
      } catch {
        // Activation failure remains primary; the inactive candidate is already unreachable.
      }
      this.#failed(graph.revision, startedAt, 'activation', error);
      throw new ApplicationPublicationError('activation', message(error), { cause: error });
    }
    const previousRuntime = this.#activeRuntime;
    this.#active = compilation;
    this.#activeRuntime = candidate;
    this.#published(compilation.revision, startedAt);
    try {
      await previousRuntime?.dispose();
    } catch {
      // Cleanup cannot roll back an already activated candidate.
    }
    return compilation;
  }

  #failed(
    revision: number,
    startedAt: string,
    stage: ApplicationPublicationFailureStageV1,
    error: unknown,
  ): void {
    this.#state = frozenState({
      activeRevision: this.#active.revision,
      candidateRevision: revision,
      lastAttempt: {
        completedAt: this.#clock(),
        message: message(error),
        revision,
        stage,
        startedAt,
        status: 'failed',
      },
      schemaVersion: 'oxe.application-publication-state.v1',
      status: 'failed',
    });
  }

  #published(revision: number, startedAt: string): void {
    this.#state = frozenState({
      activeRevision: revision,
      lastAttempt: {
        completedAt: this.#clock(),
        revision,
        startedAt,
        status: 'published',
      },
      schemaVersion: 'oxe.application-publication-state.v1',
      status: 'active',
    });
  }
}
