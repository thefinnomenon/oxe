import type {
  ApplicationCapabilityInvocationV1,
  ApplicationExecutionContextV1,
  ApplicationRuntimeValueV1,
} from './application-host.js';
import { serializeCompactApplicationJson } from './application-serialize.js';
import type { ApplicationCapabilityV1 } from './application-types.js';
import { applicationValueMatchesType } from './application-value.js';

export interface ApplicationCapabilityIdempotencyAdapterV1 {
  readonly idempotency?: 'jobId';
  invoke(
    invocation: ApplicationCapabilityInvocationV1,
    context: ApplicationExecutionContextV1,
    signal?: AbortSignal,
  ): Promise<ApplicationRuntimeValueV1> | ApplicationRuntimeValueV1;
}

export interface ApplicationCapabilityIdempotencyProbeOptionsV1 {
  readonly adapter: ApplicationCapabilityIdempotencyAdapterV1;
  readonly context: ApplicationExecutionContextV1;
  /** Test-provider observation of committed side effects, not adapter call count. */
  readonly effectCount: () => number;
  readonly invocation: ApplicationCapabilityInvocationV1 & {
    readonly delivery: { readonly attempt: number; readonly jobId: string };
  };
}

export interface ApplicationCapabilityIdempotencyProbeV1 {
  readonly diagnostics: readonly Readonly<{ readonly code: 'OXE3601'; readonly message: string }>[];
  readonly effectCountAfterFirst: number;
  readonly effectCountAfterSecond: number;
  readonly effectCountBefore: number;
  readonly ok: boolean;
  readonly schemaVersion: 'oxe.application-capability-idempotency-probe.v1';
}

export interface ApplicationCapabilityContractProbeOptionsV1 {
  readonly adapter: ApplicationCapabilityIdempotencyAdapterV1;
  readonly capability: ApplicationCapabilityV1;
  readonly context: ApplicationExecutionContextV1;
  readonly input: Readonly<Record<string, ApplicationRuntimeValueV1>>;
  readonly method: string;
  readonly signal?: AbortSignal;
}

export interface ApplicationCapabilityContractProbeV1 {
  readonly diagnostics: readonly Readonly<{ readonly code: 'OXE3602'; readonly message: string }>[];
  readonly ok: boolean;
  readonly output?: ApplicationRuntimeValueV1;
  readonly schemaVersion: 'oxe.application-capability-contract-probe.v1';
}

/** Executes one adapter call while enforcing its semantic method boundary on both sides. */
export const probeApplicationCapabilityAdapterContract = async (
  options: ApplicationCapabilityContractProbeOptionsV1,
): Promise<ApplicationCapabilityContractProbeV1> => {
  const diagnostics: { code: 'OXE3602'; message: string }[] = [];
  const method = options.capability.methods[options.method];
  if (!method)
    diagnostics.push({
      code: 'OXE3602',
      message: `Capability method ${JSON.stringify(options.method)} is not declared.`,
    });
  else if (!applicationValueMatchesType(options.input, method.input))
    diagnostics.push({ code: 'OXE3602', message: 'Capability probe input is invalid.' });
  let output: ApplicationRuntimeValueV1 | undefined;
  let invocationCompleted = false;
  if (method && diagnostics.length === 0) {
    try {
      output = await options.adapter.invoke(
        {
          capabilityId: options.capability.id,
          contract: options.capability.contract,
          input: options.input,
          method: options.method,
          version: options.capability.version,
        },
        options.context,
        options.signal,
      );
      invocationCompleted = true;
    } catch {
      diagnostics.push({ code: 'OXE3602', message: 'Capability probe invocation failed.' });
    }
    if (invocationCompleted && !applicationValueMatchesType(output, method.output))
      diagnostics.push({ code: 'OXE3602', message: 'Capability probe output is invalid.' });
  }
  return Object.freeze({
    diagnostics: Object.freeze(diagnostics.map((diagnostic) => Object.freeze(diagnostic))),
    ok: diagnostics.length === 0,
    ...(output === undefined ? {} : { output }),
    schemaVersion: 'oxe.application-capability-contract-probe.v1',
  });
};

/**
 * Test harness for adapters: delivers one job twice and verifies stable output and no second
 * provider-side effect. It intentionally requires a provider-test effect counter.
 */
export const probeApplicationCapabilityAdapterIdempotency = async (
  options: ApplicationCapabilityIdempotencyProbeOptionsV1,
): Promise<ApplicationCapabilityIdempotencyProbeV1> => {
  const diagnostics: { code: 'OXE3601'; message: string }[] = [];
  if (options.adapter.idempotency !== 'jobId')
    diagnostics.push({
      code: 'OXE3601',
      message: 'Queued capability adapter must declare jobId idempotency.',
    });
  const effectCountBefore = options.effectCount();
  let first: ApplicationRuntimeValueV1 | undefined;
  let second: ApplicationRuntimeValueV1 | undefined;
  try {
    first = await options.adapter.invoke(options.invocation, options.context);
  } catch {
    diagnostics.push({ code: 'OXE3601', message: 'First idempotency probe delivery failed.' });
  }
  const effectCountAfterFirst = options.effectCount();
  try {
    second = await options.adapter.invoke(options.invocation, options.context);
  } catch {
    diagnostics.push({ code: 'OXE3601', message: 'Repeated idempotency probe delivery failed.' });
  }
  const effectCountAfterSecond = options.effectCount();
  if (
    first !== undefined &&
    second !== undefined &&
    serializeCompactApplicationJson(first) !== serializeCompactApplicationJson(second)
  )
    diagnostics.push({
      code: 'OXE3601',
      message: 'Repeated delivery returned a different result for the same jobId.',
    });
  if (effectCountAfterSecond !== effectCountAfterFirst)
    diagnostics.push({
      code: 'OXE3601',
      message: 'Repeated delivery produced an additional provider-side effect.',
    });
  return Object.freeze({
    diagnostics: Object.freeze(diagnostics.map((diagnostic) => Object.freeze(diagnostic))),
    effectCountAfterFirst,
    effectCountAfterSecond,
    effectCountBefore,
    ok: diagnostics.length === 0,
    schemaVersion: 'oxe.application-capability-idempotency-probe.v1',
  });
};
