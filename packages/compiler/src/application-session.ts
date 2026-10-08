import {
  APPLICATION_AGENT_REQUEST_SCHEMA,
  executeApplicationAgentRequest,
  type ApplicationAgentArtifactPublicationV1,
  type ApplicationAgentRequestV1,
  type ApplicationAgentResponseV1,
  type ApplicationGraphV1,
} from '@oxe/graph';
import type { ApplicationRevisionStore } from '@oxe/graph/store';

import {
  ApplicationArtifactCache,
  type ApplicationArtifactCompilationV1,
} from './application-artifact-cache.js';
import { planApplicationArtifactInvalidation } from './application-incremental.js';
import {
  ApplicationPublicationError,
  ApplicationPublicationManager,
  type ApplicationPublicationAdapterV1,
  type ApplicationPublicationStateV1,
  type PreparedApplicationRuntimeV1,
} from './application-publication.js';

const agentPublication = (
  compilation: ApplicationArtifactCompilationV1,
): ApplicationAgentArtifactPublicationV1 => ({
  artifacts: compilation.artifacts.map(({ bytes, fingerprint, id, status }) => ({
    bytes,
    fingerprint,
    id,
    status,
  })),
  stats: compilation.stats,
});

/**
 * Owns a revision store and its disposable compiler projections for one local development session.
 * Closing the session closes the supplied revision store.
 */
export class ApplicationDevelopmentSession {
  readonly #requiresAsyncPublication: boolean;
  readonly publication: ApplicationPublicationManager;

  public constructor(
    readonly store: ApplicationRevisionStore,
    initialGraph: ApplicationGraphV1,
    readonly artifactCache = new ApplicationArtifactCache(),
    publicationAdapter?: ApplicationPublicationAdapterV1,
    initialRuntime?: PreparedApplicationRuntimeV1,
  ) {
    this.#requiresAsyncPublication = publicationAdapter !== undefined;
    const existing = store.current(initialGraph.app.id);
    if (!existing) store.initialize(initialGraph);
    const current = existing ?? store.current(initialGraph.app.id);
    if (!current) throw new Error(`Application "${initialGraph.app.id}" failed to initialize.`);
    const activeRevision =
      store.activePublication(initialGraph.app.id)?.revision ?? current.revision;
    const activeGraph = store.load(initialGraph.app.id, activeRevision);
    if (!activeGraph)
      throw new Error(
        `Application "${initialGraph.app.id}" active revision r${activeRevision} could not be loaded.`,
      );
    artifactCache.compile(initialGraph);
    const initialCompilation = artifactCache.compile(activeGraph);
    this.publication = new ApplicationPublicationManager(initialCompilation, {
      ...(publicationAdapter ? { adapter: publicationAdapter } : {}),
      compile: (graph) => artifactCache.compile(graph),
      ...(initialRuntime ? { initialRuntime } : {}),
      onActivate: (compilation) => {
        store.activate(compilation.appId, compilation.revision);
      },
    });
  }

  public artifacts(appId: string): ApplicationArtifactCompilationV1 | undefined {
    const active = this.publication.active();
    return active.appId === appId ? active : undefined;
  }

  public publicationState(): ApplicationPublicationStateV1 {
    return this.publication.state();
  }

  public handle(value: unknown): ApplicationAgentResponseV1 {
    if (
      this.#requiresAsyncPublication &&
      typeof value === 'object' &&
      value !== null &&
      'operation' in value &&
      typeof value.operation === 'object' &&
      value.operation !== null &&
      'kind' in value.operation &&
      value.operation.kind === 'commit'
    )
      throw new TypeError('Configured publication adapters require handleAndPublish for commits.');
    return executeApplicationAgentRequest(
      {
        commit: (appId, batch) => this.store.commit(appId, batch),
        current: (appId) => this.store.current(appId),
        history: (appId) => this.store.history(appId),
        load: (appId, revision) => this.store.load(appId, revision),
        undo: (appId, baseRevision, targetRevision) =>
          this.store.undo(appId, baseRevision, targetRevision),
        planArtifacts: planApplicationArtifactInvalidation,
        publishArtifacts: (_before, after) =>
          agentPublication(this.publication.publishImmediately(after)),
      },
      value,
    );
  }

  /** Commits through the strict protocol, then stages and activates async runtime adapters. */
  public async handleAndPublish(value: unknown): Promise<ApplicationAgentResponseV1> {
    const response = executeApplicationAgentRequest(
      {
        commit: (appId, batch) => this.store.commit(appId, batch),
        current: (appId) => this.store.current(appId),
        history: (appId) => this.store.history(appId),
        load: (appId, revision) => this.store.load(appId, revision),
        undo: (appId, baseRevision, targetRevision) =>
          this.store.undo(appId, baseRevision, targetRevision),
        planArtifacts: planApplicationArtifactInvalidation,
      },
      value,
    );
    if (!response.ok || (response.result.kind !== 'commit' && response.result.kind !== 'revert'))
      return response;
    const graph = this.store.load(response.appId, response.revision);
    if (!graph)
      return {
        appId: response.appId,
        diagnostics: [
          {
            code: 'OXE3404',
            message: `Committed revision r${response.revision} could not be loaded for publication.`,
            path: '$.operation',
          },
        ],
        ok: false,
        requestId: response.requestId,
        schemaVersion: response.schemaVersion,
      };
    try {
      const compilation = await this.publication.publish(graph);
      return {
        ...response,
        result: { ...response.result, publication: agentPublication(compilation) },
      };
    } catch (error) {
      const stage = error instanceof ApplicationPublicationError ? ` during ${error.stage}` : '';
      return {
        appId: response.appId,
        diagnostics: [
          {
            code: 'OXE3404',
            message: `Revision r${response.revision} committed but publication failed${stage}; the application remains on r${this.publication.state().activeRevision}: ${error instanceof Error ? error.message : String(error)}`,
            path: '$.operation',
          },
        ],
        ok: false,
        requestId: response.requestId,
        schemaVersion: response.schemaVersion,
      };
    }
  }

  /** Retries publication of the current semantic head without creating another revision. */
  public async retryPublication(appId: string): Promise<ApplicationArtifactCompilationV1> {
    const graph = this.store.current(appId);
    if (!graph) throw new Error(`Application "${appId}" is not initialized.`);
    return this.publication.publish(graph);
  }

  public request(
    appId: string,
    requestId: string,
    operation: ApplicationAgentRequestV1['operation'],
  ): ApplicationAgentResponseV1 {
    return this.handle({
      appId,
      operation,
      requestId,
      schemaVersion: APPLICATION_AGENT_REQUEST_SCHEMA,
    });
  }

  public requestAndPublish(
    appId: string,
    requestId: string,
    operation: ApplicationAgentRequestV1['operation'],
  ): Promise<ApplicationAgentResponseV1> {
    return this.handleAndPublish({
      appId,
      operation,
      requestId,
      schemaVersion: APPLICATION_AGENT_REQUEST_SCHEMA,
    });
  }

  public async close(): Promise<void> {
    await this.publication.close();
    this.store.close();
  }
}
