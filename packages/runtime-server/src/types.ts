import type { BinaryOperatorV1, ConstantValueV1, PrimitiveTypeV1 } from '@oxe/graph';

import type { ServerStreamPatch } from './stream-protocol.js';

export type ServerLiteralV1 = boolean | number | string;

export interface ServerCollectionCallbackV1 {
  readonly parameters: readonly { readonly id: string; readonly name: string }[];
  readonly result: ServerExpressionV1;
}

export type ServerExpressionV1 =
  | {
      readonly elements: readonly ServerExpressionV1[];
      readonly kind: 'array';
    }
  | {
      readonly kind: 'binary';
      readonly left: ServerExpressionV1;
      readonly operator: BinaryOperatorV1;
      readonly right: ServerExpressionV1;
    }
  | {
      readonly arguments: readonly ServerExpressionV1[];
      readonly callee: ServerExpressionV1;
      readonly kind: 'call';
    }
  | {
      readonly kind: 'capability';
      readonly targetId: string;
    }
  | {
      readonly callback: ServerCollectionCallbackV1;
      readonly initial?: ServerExpressionV1;
      readonly kind: 'collection';
      readonly operation: 'filter' | 'flatMap' | 'map' | 'reduce' | 'sort';
      readonly options?: ServerExpressionV1;
      readonly source: ServerExpressionV1;
    }
  | {
      readonly branches: readonly {
        readonly condition?: ServerExpressionV1;
        readonly result: ServerExpressionV1;
      }[];
      readonly kind: 'conditional';
    }
  | {
      readonly kind: 'literal';
      readonly value: ServerLiteralV1;
    }
  | {
      readonly kind: 'local';
      readonly targetId: string;
    }
  | {
      readonly kind: 'member';
      readonly object: ServerExpressionV1;
      readonly property: string;
    }
  | {
      readonly entries: readonly { readonly name: string; readonly value: ServerExpressionV1 }[];
      readonly kind: 'record';
    }
  | {
      readonly kind: 'read';
      readonly targetId: string;
    };

export type ServerBindingV1 =
  | {
      readonly expression: ServerExpressionV1;
      readonly id: string;
      readonly kind: 'async-resource';
      readonly name: string;
    }
  | {
      readonly id: string;
      readonly kind: 'constant';
      readonly name: string;
      readonly value: ConstantValueV1;
    }
  | {
      readonly id: string;
      readonly initial: ServerExpressionV1;
      readonly kind: 'state';
      readonly name: string;
    }
  | {
      readonly expression: ServerExpressionV1;
      readonly id: string;
      readonly kind: 'computed';
      readonly name: string;
    }
  | {
      readonly contextId: string;
      readonly id: string;
      readonly kind: 'context';
      readonly name: string;
    }
  | {
      readonly id: string;
      readonly kind: 'ref';
      readonly name: string;
    };

export type ServerParameterV1 =
  | {
      readonly id: string;
      readonly index: number;
      readonly kind: 'children' | 'procedure' | 'rest';
      readonly name: string;
    }
  | {
      readonly default?: ServerExpressionV1;
      readonly id: string;
      readonly index: number;
      readonly kind: 'value';
      readonly name: string;
      readonly type: PrimitiveTypeV1;
    };

export type ServerComponentPropV1 =
  | {
      readonly authoredName?: string;
      readonly index?: number;
      readonly kind: 'procedure';
      readonly parameterId: string;
      readonly targetId: string;
    }
  | {
      readonly authoredName?: string;
      readonly index?: number;
      readonly kind: 'value';
      readonly parameterId: string;
      readonly value: ServerExpressionV1;
    }
  | {
      readonly index: number;
      readonly kind: 'spread';
      readonly parameterId: string;
      readonly source:
        | { readonly kind: 'rest'; readonly targetId: string }
        | { readonly kind: 'value'; readonly value: ServerExpressionV1 };
    };

export interface ServerStaticAttributeV1 {
  readonly kind: 'static';
  readonly name: string;
  readonly value: ServerLiteralV1;
}

export interface ServerDynamicAttributeV1 {
  readonly kind: 'dynamic';
  readonly mode: 'attribute' | 'property';
  readonly name: string;
  readonly value: ServerExpressionV1;
}

export type ServerViewV1 =
  | {
      readonly attributes: readonly (ServerDynamicAttributeV1 | ServerStaticAttributeV1)[];
      readonly children: readonly ServerViewV1[];
      readonly eventId?: string;
      readonly id: string;
      readonly kind: 'element';
      readonly tag: string;
    }
  | {
      readonly id: string;
      readonly kind: 'text';
      readonly parts: readonly (
        | { readonly kind: 'static'; readonly value: string }
        | { readonly expression: ServerExpressionV1; readonly kind: 'expression' }
      )[];
    }
  | {
      readonly children: readonly ServerViewV1[];
      readonly componentId: string;
      readonly id: string;
      readonly kind: 'component';
      readonly props: readonly ServerComponentPropV1[];
    }
  | {
      readonly branches: readonly {
        readonly condition?: ServerExpressionV1;
        readonly omittedEffectIds: readonly string[];
        readonly view: ServerViewV1;
      }[];
      readonly id: string;
      readonly kind: 'choice';
    }
  | {
      readonly id: string;
      readonly itemId: string;
      readonly key: ServerExpressionV1;
      readonly kind: 'collection';
      readonly row: ServerViewV1;
      readonly source: ServerExpressionV1;
    }
  | {
      readonly children: readonly ServerViewV1[];
      readonly contextId: string;
      readonly id: string;
      readonly kind: 'context-provider';
      readonly value: ServerExpressionV1;
    }
  | {
      readonly id: string;
      readonly kind: 'content-slot';
      readonly parameterId: string;
    }
  | {
      /** Reference-backend-only view used while instantiating deferred values. */
      readonly id: string;
      readonly kind: 'value-capture';
      readonly value: ServerExpressionV1;
    };

export interface ServerComponentPlanV1 {
  readonly bindings: readonly ServerBindingV1[];
  readonly boundary: {
    /** Blocking today; the boundary is explicit so later plans can schedule deferred work. */
    readonly id: string;
    readonly mode: 'blocking';
    readonly root: ServerViewV1;
  };
  readonly id: string;
  readonly name: string;
  readonly parameters: readonly ServerParameterV1[];
}

export interface ServerCapabilityPlanV1 {
  readonly capabilityKind: 'async' | 'effect' | 'pure' | 'resource';
  readonly id: string;
  readonly parameters: readonly PrimitiveTypeV1[];
  readonly path: readonly string[];
  readonly routeIntrinsic?:
    'location' | 'navigate' | 'params' | 'search-params' | 'set-search-params';
  readonly returns?: PrimitiveTypeV1;
  readonly target: 'client' | 'server' | 'universal';
}

export interface ServerRenderPlanV1 {
  readonly capabilities: readonly ServerCapabilityPlanV1[];
  readonly components: readonly ServerComponentPlanV1[];
  readonly contexts: readonly { readonly id: string; readonly name: string }[];
  readonly entry: {
    readonly boundaryId: string;
    readonly componentId: string;
  };
  readonly execution: {
    /** Backends may write ordered chunks even though version 1 contains blocking boundaries only. */
    readonly delivery: 'ordered-chunks';
    readonly mode: 'synchronous';
  };
  readonly nonRenderingWork: readonly {
    readonly id: string;
    readonly kind: 'effect' | 'resource';
  }[];
  readonly schemaVersion: 'oxe.server-render-plan.v1';
  readonly source: {
    readonly buildFingerprint: string;
    readonly graphSchemaVersion: 'oxe.ui-graph.v1';
    readonly moduleId: string;
  };
}

export interface ServerDeferredRegionV2 {
  readonly componentId: string;
  readonly consumerId: string;
  readonly id: string;
  readonly kind: 'attribute' | 'structural' | 'text';
  readonly resourceIds: readonly string[];
  /** True when this root structural dependency must settle before HTTP headers commit. */
  readonly statusGate: boolean;
}

export interface ServerRenderPlanV2 {
  readonly capabilities: readonly ServerCapabilityPlanV1[];
  readonly components: readonly ServerComponentPlanV1[];
  readonly contexts: readonly { readonly id: string; readonly name: string }[];
  readonly entry: ServerRenderPlanV1['entry'];
  readonly execution: {
    readonly batching: 'resource-and-short-window';
    readonly delivery: 'readiness-stream';
    readonly mode: 'asynchronous';
    readonly ordering: 'stable-document-markers';
  };
  readonly nonRenderingWork: ServerRenderPlanV1['nonRenderingWork'];
  readonly regions: readonly ServerDeferredRegionV2[];
  readonly schemaVersion: 'oxe.server-render-plan.v2';
  readonly source: ServerRenderPlanV1['source'];
}

export interface ServerRenderMetrics {
  readonly bytesWritten: number;
  readonly collectionItems: number;
  readonly components: number;
  readonly elements: number;
  readonly expressions: number;
  readonly maxComponentDepth: number;
  readonly textNodes: number;
  readonly views: number;
}

export interface ServerRenderResult {
  readonly html: string;
  readonly metrics: ServerRenderMetrics;
}

export interface ServerRenderSink {
  write(chunk: string): void;
}

export interface ServerAsyncRenderSink {
  start?(response: ServerResponseMetadata): void | PromiseLike<void>;
  write(chunk: string): void | PromiseLike<void>;
}

export interface ServerResponseMetadata {
  readonly headers?: Readonly<Record<string, string>>;
  readonly status: number;
}

export interface ServerErrorResponse extends ServerResponseMetadata {
  readonly body: string;
}

export interface ServerDeferredResourceRequestV2 {
  /** Capability + canonical arguments + security scope. Equal identities share one request. */
  readonly identity: string;
  load(signal: AbortSignal): unknown | PromiseLike<unknown>;
}

export type ServerDeferredResourceV2 =
  | (ServerDeferredResourceRequestV2 & {
      /** Request-local id. Unlike graph ids, this distinguishes repeated instances. */
      readonly id: string;
      readonly prepare?: never;
      readonly resourceIds?: never;
      readonly statusGate?: boolean;
    })
  | {
      /** Request-local id. Unlike graph ids, this distinguishes repeated component and row instances. */
      readonly id: string;
      /** Other request-local resources required to compute this request's real identity. */
      readonly resourceIds: readonly string[];
      readonly statusGate?: boolean;
      prepare(
        resources: ReadonlyMap<string, unknown>,
        signal: AbortSignal,
      ): ServerDeferredResourceRequestV2 | PromiseLike<ServerDeferredResourceRequestV2>;
    };

export interface ServerDeferredRegionExpansionV2 {
  readonly kind: 'expansion';
  readonly patches: readonly ServerStreamPatch[];
  readonly regions: readonly ServerPreparedRegionV2[];
  readonly resources: readonly ServerDeferredResourceV2[];
}

export type ServerDeferredRegionOutput =
  | ServerDeferredRegionExpansionV2
  | ServerStreamPatch
  | readonly ServerStreamPatch[]
  | null
  | undefined;

export interface ServerReadinessAdapter {
  /** Instantiates template-level graph ids into request-local resources and stable document markers. */
  prepare(
    plan: ServerRenderPlanV2,
    signal: AbortSignal,
  ): ServerReadinessPreparation | PromiseLike<ServerReadinessPreparation>;
}

export interface ServerPreparedRegionV2 {
  /** Request-local stable marker id, including component and keyed-row instance paths. */
  readonly id: string;
  readonly resourceIds: readonly string[];
  /** Compiler-level region from the portable render plan. */
  readonly template: ServerDeferredRegionV2;
  render(
    resources: ReadonlyMap<string, unknown>,
    signal: AbortSignal,
  ): ServerDeferredRegionOutput | PromiseLike<ServerDeferredRegionOutput>;
}

export interface ServerReadinessPreparation {
  readonly regions: readonly ServerPreparedRegionV2[];
  readonly resources: readonly ServerDeferredResourceV2[];
  readonly shell: string;
}

export interface ServerReadinessErrorContext {
  readonly headersCommitted: boolean;
  readonly phase: 'checkpoint' | 'region' | 'resource' | 'shell' | 'write';
  readonly region?: ServerPreparedRegionV2;
}

export interface ServerReadinessOptions {
  /** Small coalescing window for regions that become ready together. Defaults to one microtask. */
  readonly batchWindowMilliseconds?: number;
  readonly includeBootstrap?: boolean;
  readonly includeCheckpoints?: boolean;
  readonly onError?: (
    error: unknown,
    context: ServerReadinessErrorContext,
  ) => ServerErrorResponse | void | PromiseLike<ServerErrorResponse | void>;
  readonly signal?: AbortSignal;
}

export interface ServerReadinessMetrics {
  readonly batchesWritten: number;
  readonly bootstrapBytes: number;
  readonly bytesWritten: number;
  readonly checkpointBytes: number;
  readonly checkpointsWritten: number;
  readonly patchBytes: number;
  readonly patchesWritten: number;
  readonly regionsCompleted: number;
  readonly requestsDeduplicated: number;
  readonly requestsStarted: number;
  readonly shellBytes: number;
}

export interface ServerReadinessResult {
  readonly headers: Readonly<Record<string, string>>;
  readonly html: string;
  readonly metrics: ServerReadinessMetrics;
  readonly status: number;
}

/** Reference-backend location for one request-local rendering occurrence. */
export interface ServerRenderLocation {
  readonly componentId: string;
  readonly componentInstancePath: string;
  readonly instancePath: string;
  /** Component view that created this instance; absent only for the entry component. */
  readonly invocationId?: string;
  readonly parentComponentInstancePath?: string;
}

export interface ServerRenderOptions {
  /** Captures request-local async arguments without executing the async capability. */
  readonly captureAsyncResource?: (
    bindingId: string,
    arguments_: readonly unknown[],
    location: ServerRenderLocation,
  ) => void;
  /** Reference-backend hook used by the v2 plan instantiator. */
  readonly captureValue?: (id: string, value: unknown, location: ServerRenderLocation) => void;
  readonly callCapability?: (
    capability: ServerCapabilityPlanV1,
    arguments_: readonly unknown[],
  ) => unknown;
  /** Reports each component occurrence before its boundary renders. */
  readonly onComponentInstance?: (location: ServerRenderLocation) => void;
  /** Resolved async binding values keyed by compiler-level binding id. */
  readonly resourceValues?: ReadonlyMap<string, unknown>;
  /** Resolves a request-local async value without changing the portable plan ids. */
  readonly resolveResourceValue?: (
    bindingId: string,
    location: ServerRenderLocation,
  ) => { readonly found: boolean; readonly value?: unknown };
  /** Allows a selective deferred render to walk unrelated pending consumers. */
  readonly tolerateUnresolvedAsyncResources?: boolean;
  /** Rewrites reference-backend sentinel text for a request-local occurrence. */
  readonly transformStaticText?: (value: string, location: ServerRenderLocation) => string;
  /** Rewrites compiler-owned static attribute sentinels for a request-local occurrence. */
  readonly transformStaticAttribute?: (
    name: string,
    value: ServerLiteralV1,
    location: ServerRenderLocation,
  ) => ServerLiteralV1;
}
