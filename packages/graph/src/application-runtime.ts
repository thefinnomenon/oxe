import { canonicalizeApplicationGraph } from './application-serialize.js';
import type { ApplicationGraphV1 } from './application-types.js';
import {
  ApplicationGraphValidationError,
  validateApplicationGraph,
} from './application-validate.js';

export interface ApplicationRuntimeRequirementsV1 {
  readonly appId: string;
  readonly authentication?: Readonly<{
    methods: readonly string[];
    provider: 'betterAuth';
  }>;
  readonly capabilities: readonly Readonly<{
    contract: string;
    generated: boolean;
    id: string;
    jobIdempotent: boolean;
    methods: readonly string[];
    queued: boolean;
    version: string;
  }>[];
  readonly contexts: readonly Readonly<{ entityId: string; id: string }>[];
  readonly extensions: readonly Readonly<{
    format: 'css' | 'javascript';
    id: string;
    packages: Readonly<Record<string, string>>;
    target: 'browser' | 'server' | 'universal';
  }>[];
  readonly persistence: Readonly<{ engine: 'postgresql' }>;
  readonly routes: readonly Readonly<{
    authentication: 'optional' | 'required';
    id: string;
    path: string;
  }>[];
  readonly schemaVersion: 'oxe.application-runtime-requirements.v1';
}

export interface ApplicationRuntimeBindingsV1 {
  readonly authentication?: 'betterAuth';
  readonly capabilities?: readonly string[];
  /** Capability adapters proven to deduplicate queued delivery by jobId. */
  readonly jobIdempotentCapabilities?: readonly string[];
  readonly persistence?: 'postgresql';
}

export interface ApplicationRuntimeBindingDiagnosticV1 {
  readonly code: 'OXE3501';
  readonly message: string;
  readonly requirement: string;
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/** Deterministic, provider-neutral deployment requirements projected from semantic state. */
export const projectApplicationRuntimeRequirements = (
  input: ApplicationGraphV1,
): ApplicationRuntimeRequirementsV1 => {
  const diagnostics = validateApplicationGraph(input);
  if (diagnostics.length > 0) throw new ApplicationGraphValidationError(diagnostics);
  const graph = canonicalizeApplicationGraph(input);
  const queuedCapabilities = new Set(
    graph.operations.flatMap((operation) =>
      operation.body.kind === 'workflow'
        ? operation.body.steps.flatMap((step) =>
            step.kind === 'enqueueCapability' ? [step.capability] : [],
          )
        : [],
    ),
  );
  return Object.freeze({
    appId: graph.app.id,
    ...(graph.app.authentication
      ? {
          authentication: Object.freeze({
            methods: Object.freeze([...graph.app.authentication.methods].sort(compareText)),
            provider: graph.app.authentication.provider,
          }),
        }
      : {}),
    capabilities: Object.freeze(
      (graph.capabilities ?? []).map((capability) =>
        Object.freeze({
          contract: capability.contract,
          generated: capability.adapter !== undefined,
          id: capability.id,
          jobIdempotent: capability.adapter?.jobIdempotency === 'jobId',
          methods: Object.freeze(Object.keys(capability.methods).sort(compareText)),
          queued: queuedCapabilities.has(capability.id),
          version: capability.version,
        }),
      ),
    ),
    contexts: Object.freeze(
      (graph.contexts ?? [])
        .filter((context) => graph.app.contexts?.includes(context.id))
        .map((context) => Object.freeze({ entityId: context.entity, id: context.id })),
    ),
    extensions: Object.freeze(
      (graph.modules ?? []).map((module) =>
        Object.freeze({
          format: module.format,
          id: module.id,
          packages: Object.freeze({ ...module.packages }),
          target: module.target,
        }),
      ),
    ),
    persistence: Object.freeze({ engine: 'postgresql' as const }),
    routes: Object.freeze(
      graph.routes.map((route) =>
        Object.freeze({
          authentication: route.authentication,
          id: route.id,
          path: route.path,
        }),
      ),
    ),
    schemaVersion: 'oxe.application-runtime-requirements.v1',
  });
};

/** Fails closed before startup when required production adapters are not bound. */
export const validateApplicationRuntimeBindings = (
  requirements: ApplicationRuntimeRequirementsV1,
  bindings: ApplicationRuntimeBindingsV1,
): readonly ApplicationRuntimeBindingDiagnosticV1[] => {
  const diagnostics: ApplicationRuntimeBindingDiagnosticV1[] = [];
  const add = (requirement: string, message: string): void => {
    diagnostics.push({ code: 'OXE3501', message, requirement });
  };
  if (
    requirements.authentication &&
    bindings.authentication !== requirements.authentication.provider
  )
    add(
      `authentication:${requirements.authentication.provider}`,
      `Missing authentication adapter "${requirements.authentication.provider}".`,
    );
  if (bindings.persistence !== requirements.persistence.engine)
    add(
      `persistence:${requirements.persistence.engine}`,
      `Missing persistence adapter "${requirements.persistence.engine}".`,
    );
  const boundCapabilities = new Set(bindings.capabilities ?? []);
  const idempotentCapabilities = new Set(bindings.jobIdempotentCapabilities ?? []);
  for (const capability of requirements.capabilities)
    if (!capability.generated && !boundCapabilities.has(capability.id))
      add(
        `capability:${capability.id}`,
        `Missing capability adapter "${capability.id}" for ${capability.contract}@${capability.version}.`,
      );
    else if (
      capability.queued &&
      !capability.jobIdempotent &&
      !idempotentCapabilities.has(capability.id)
    )
      add(
        `capability-idempotency:${capability.id}`,
        `Queued capability adapter "${capability.id}" must declare jobId idempotency.`,
      );
  return Object.freeze(diagnostics);
};
