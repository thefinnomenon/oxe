export type NodeIdV1 = string;

export interface GraphPositionV1 {
  /** One-based UTF-16 column. */
  readonly column: number;
  /** One-based line number. */
  readonly line: number;
  /** UTF-16 offset from the start of the source. */
  readonly offset: number;
}

export interface GraphSpanV1 {
  readonly end: GraphPositionV1;
  readonly fileName: string;
  readonly start: GraphPositionV1;
}

export interface GraphAccessV1 {
  /** Empty for a whole-value access; otherwise the selected nested field path. */
  readonly path: readonly string[];
  readonly span: GraphSpanV1;
}

export type PrimitiveTypeV1 = 'array' | 'boolean' | 'number' | 'record' | 'string' | 'unknown';

export type RouteIntrinsicV1 =
  'location' | 'navigate' | 'params' | 'search-params' | 'set-search-params';

export type LiteralValueV1 = boolean | number | string;

export type ConstantValueV1 =
  LiteralValueV1 | readonly ConstantValueV1[] | { readonly [name: string]: ConstantValueV1 };

export type BinaryOperatorV1 = '!=' | '%' | '*' | '+' | '-' | '/' | '==' | 'and' | 'or';

export interface ConditionalValueBranchV1 {
  readonly condition?: ValueExpressionV1;
  readonly result: ValueExpressionV1;
  readonly span: GraphSpanV1;
}

export interface RecordEntryV1 {
  readonly name: string;
  readonly span: GraphSpanV1;
  readonly value: ValueExpressionV1;
}

export interface CollectionCallbackV1 {
  /** Stable local ids referenced by local-read expressions in the callback body. */
  readonly parameters: readonly (ParameterV1 & { readonly id: string })[];
  readonly result: ValueExpressionV1;
  readonly span: GraphSpanV1;
}

export type ValueExpressionV1 =
  | {
      readonly elements: readonly ValueExpressionV1[];
      readonly kind: 'array';
      readonly span: GraphSpanV1;
    }
  | {
      readonly kind: 'binary';
      readonly left: ValueExpressionV1;
      readonly operator: BinaryOperatorV1;
      readonly right: ValueExpressionV1;
      readonly span: GraphSpanV1;
    }
  | {
      readonly arguments: readonly ValueExpressionV1[];
      readonly callee: ValueExpressionV1;
      readonly kind: 'call';
      /** Declared result for a compiler-known external capability. */
      readonly returnType?: PrimitiveTypeV1;
      readonly span: GraphSpanV1;
    }
  | {
      readonly kind: 'capability-read';
      readonly span: GraphSpanV1;
      readonly targetId: NodeIdV1;
    }
  | {
      readonly callback: CollectionCallbackV1;
      readonly initial?: ValueExpressionV1;
      readonly kind: 'collection';
      readonly operation: 'filter' | 'flatMap' | 'map' | 'reduce' | 'sort';
      readonly options?: ValueExpressionV1;
      readonly source: ValueExpressionV1;
      readonly span: GraphSpanV1;
    }
  | {
      readonly branches: readonly ConditionalValueBranchV1[];
      readonly kind: 'conditional';
      readonly span: GraphSpanV1;
    }
  | {
      readonly kind: 'literal';
      readonly span: GraphSpanV1;
      readonly value: boolean | number | string;
    }
  | {
      readonly kind: 'local-read';
      readonly record?: Extract<ValueExpressionV1, { readonly kind: 'record' }>;
      readonly span: GraphSpanV1;
      readonly targetId: string;
      readonly type: PrimitiveTypeV1;
    }
  | {
      readonly kind: 'member';
      readonly object: ValueExpressionV1;
      readonly property: string;
      readonly span: GraphSpanV1;
    }
  | {
      readonly entries: readonly RecordEntryV1[];
      readonly kind: 'record';
      readonly span: GraphSpanV1;
    }
  | {
      readonly kind: 'read';
      readonly span: GraphSpanV1;
      readonly targetId: NodeIdV1;
      /** False when authored inside untrack(...); omitted for ordinary reactive reads. */
      readonly tracked?: false;
    };

export interface ParameterV1 {
  readonly name: string;
  readonly span: GraphSpanV1;
  readonly type: PrimitiveTypeV1;
}

interface NodeBaseV1 {
  readonly id: NodeIdV1;
  readonly span: GraphSpanV1;
}

export interface ComponentNodeV1 extends NodeBaseV1 {
  readonly kind: 'component';
  readonly name: string;
  /** Ordered ids of the component's parameter nodes. */
  readonly parameters: readonly NodeIdV1[];
}

interface ComponentParameterNodeBaseV1 extends NodeBaseV1 {
  /** Zero-based declaration position in the owning component's contract. */
  readonly index: number;
  readonly kind: 'component-parameter';
  readonly name: string;
  readonly ownerId: NodeIdV1;
}

export type ComponentParameterNodeV1 =
  | (ComponentParameterNodeBaseV1 & {
      readonly parameterKind: 'children';
    })
  | (ComponentParameterNodeBaseV1 & {
      readonly parameterKind: 'procedure';
    })
  | (ComponentParameterNodeBaseV1 & {
      readonly parameterKind: 'rest';
    })
  | (ComponentParameterNodeBaseV1 & {
      readonly default?: ValueExpressionV1;
      readonly parameterKind: 'value';
      readonly type: PrimitiveTypeV1;
    });

export interface ComponentInstanceNodeV1 extends NodeBaseV1 {
  /** The authored component definition instantiated at this view position. */
  readonly componentId: NodeIdV1;
  readonly kind: 'component-instance';
}

export interface ContentSlotNodeV1 extends NodeBaseV1 {
  readonly kind: 'content-slot';
  /** The reserved children parameter placed at this view position. */
  readonly parameterId: NodeIdV1;
}

export interface ContentValueBranchV1 {
  readonly condition?: ValueExpressionV1;
  readonly effectIds: readonly NodeIdV1[];
  readonly resultId: NodeIdV1;
  readonly span: GraphSpanV1;
}

export interface ContentValueNodeV1 extends NodeBaseV1 {
  readonly branches: readonly ContentValueBranchV1[];
  readonly kind: 'content-value';
  readonly name: string;
}

export interface ContentReferenceNodeV1 extends NodeBaseV1 {
  readonly contentId: NodeIdV1;
  readonly kind: 'content-reference';
}

export interface ConditionalBranchV1 {
  readonly condition?: ValueExpressionV1;
  readonly effectIds?: readonly NodeIdV1[];
  readonly span: GraphSpanV1;
}

export interface ConditionalRegionNodeV1 extends NodeBaseV1 {
  readonly branches: readonly ConditionalBranchV1[];
  readonly kind: 'conditional-region';
}

export interface CollectionItemNodeV1 extends NodeBaseV1 {
  readonly kind: 'collection-item';
  readonly name: string;
  readonly ownerId: NodeIdV1;
  readonly type: PrimitiveTypeV1;
}

export interface KeyedCollectionNodeV1 extends NodeBaseV1 {
  readonly itemId: NodeIdV1;
  readonly key: ValueExpressionV1;
  readonly kind: 'keyed-collection';
  readonly source: ValueExpressionV1;
}

export interface ConstantNodeV1 extends NodeBaseV1 {
  readonly kind: 'constant';
  readonly name: string;
  readonly type: PrimitiveTypeV1;
  readonly value: ConstantValueV1;
}

export interface CellNodeV1 extends NodeBaseV1 {
  readonly initial: ValueExpressionV1;
  readonly kind: 'cell';
  readonly name: string;
  readonly type: PrimitiveTypeV1;
}

export interface ComputedNodeV1 extends NodeBaseV1 {
  readonly expression: ValueExpressionV1;
  readonly kind: 'computed';
  readonly name: string;
  readonly type: PrimitiveTypeV1;
}

export interface ContextNodeV1 extends NodeBaseV1 {
  readonly kind: 'context';
  readonly name: string;
}

/** A component-local readable obtained from the nearest matching provider. */
export interface ContextConsumerNodeV1 extends NodeBaseV1 {
  readonly contextId: NodeIdV1;
  readonly kind: 'context-consumer';
  readonly name: string;
  readonly type: PrimitiveTypeV1;
  /** True when a procedure writes through this context value. */
  readonly writable: boolean;
}

/** A view scope that provides the original reactive value to its descendants. */
export interface ContextProviderNodeV1 extends NodeBaseV1 {
  readonly contextId: NodeIdV1;
  readonly kind: 'context-provider';
  readonly value: ValueExpressionV1;
}

export interface PlatformCapabilityNodeV1 extends NodeBaseV1 {
  readonly capabilityKind: 'async' | 'effect' | 'pure' | 'resource';
  readonly dispose?: 'dispose';
  readonly kind: 'platform-capability';
  readonly parameters: readonly PrimitiveTypeV1[];
  readonly path: readonly string[];
  /** Compiler-owned application input rather than a host-defined capability. */
  readonly routeIntrinsic?: RouteIntrinsicV1;
  readonly returns?: PrimitiveTypeV1;
  /** Stable RPC contract resolved by the host rather than executed in the browser. */
  readonly serverFunctionId?: string;
  readonly target: 'client' | 'server' | 'universal';
  /** Stable host target used to reject competing persistent writers. */
  readonly writes?: string;
}

/** A compiler-owned asynchronous value loaded through a platform capability. */
export interface AsyncResourceNodeV1 extends NodeBaseV1 {
  readonly expression: Extract<ValueExpressionV1, { readonly kind: 'call' }>;
  readonly kind: 'async-resource';
  readonly name: string;
  readonly type: PrimitiveTypeV1;
}

export interface ResourceNodeV1 extends NodeBaseV1 {
  readonly expression: Extract<ValueExpressionV1, { readonly kind: 'call' }>;
  readonly kind: 'resource';
  readonly name: string;
}

export interface RefNodeV1 extends NodeBaseV1 {
  readonly elementId: NodeIdV1;
  readonly kind: 'ref';
  readonly name: string;
}

export interface WriteStepV1 {
  readonly kind: 'write';
  /** Nested record path for a field write; omitted for whole-value replacement. */
  readonly path?: readonly string[];
  readonly span: GraphSpanV1;
  readonly targetId: NodeIdV1;
  readonly value: ValueExpressionV1;
}

export interface CallStepV1 {
  readonly expression: Extract<ValueExpressionV1, { readonly kind: 'call' }>;
  readonly kind: 'call';
  readonly span: GraphSpanV1;
}

export interface RefreshStepV1 {
  readonly kind: 'refresh';
  readonly span: GraphSpanV1;
  readonly targetId: NodeIdV1;
}

export interface CollectionMutationStepV1 {
  readonly kind: 'collection-mutation';
  readonly limit?: ValueExpressionV1;
  readonly operation: 'add' | 'remove' | 'update';
  readonly predicate?: CollectionCallbackV1;
  readonly span: GraphSpanV1;
  readonly targetId: NodeIdV1;
  readonly updater?: CollectionCallbackV1;
  readonly value?: ValueExpressionV1;
}

export type ProcedureStepV1 = CallStepV1 | CollectionMutationStepV1 | RefreshStepV1 | WriteStepV1;

export interface ProcedureNodeV1 extends NodeBaseV1 {
  readonly kind: 'procedure';
  readonly name: string;
  readonly parameters: readonly ParameterV1[];
  readonly steps: readonly ProcedureStepV1[];
}

export interface EffectNodeV1 extends NodeBaseV1 {
  readonly expression: Extract<ValueExpressionV1, { readonly kind: 'call' }>;
  readonly kind: 'effect';
  readonly ownerId: NodeIdV1;
}

export interface StaticAttributeV1 {
  readonly name: string;
  readonly span: GraphSpanV1;
  readonly value: boolean | number | string;
}

export interface DynamicAttributeV1 {
  readonly localization?: LocalizedMessageV1;
  readonly mode: 'attribute' | 'property';
  readonly name: string;
  readonly span: GraphSpanV1;
  readonly value: ValueExpressionV1;
}

export interface LocalizedMessageValueV1 {
  readonly name: string;
  readonly value: ValueExpressionV1;
}

export interface LocalizedMarkupV1 {
  readonly dynamicAttributes: readonly DynamicAttributeV1[];
  readonly name: string;
  readonly staticAttributes: readonly StaticAttributeV1[];
  readonly tag: string;
}

export interface LocalizedMessageV1 {
  readonly key: string;
  readonly markup: readonly LocalizedMarkupV1[];
  readonly selection?: {
    readonly kind: 'cardinal' | 'ordinal';
    readonly value: ValueExpressionV1;
  };
  readonly source: string;
  readonly values: readonly LocalizedMessageValueV1[];
}

export interface FormattedValueV1 {
  readonly options: readonly {
    readonly name: string;
    readonly value: ValueExpressionV1;
  }[];
  readonly type: 'currency' | 'date' | 'datetime' | 'time';
  readonly value: ValueExpressionV1;
}

export interface ElementNodeV1 extends NodeBaseV1 {
  readonly dynamicAttributes?: readonly DynamicAttributeV1[];
  readonly kind: 'element';
  readonly staticAttributes: readonly StaticAttributeV1[];
  readonly tag: string;
}

export type TextPartV1 =
  | {
      readonly expression: ValueExpressionV1;
      readonly kind: 'expression';
      readonly span: GraphSpanV1;
    }
  | {
      readonly kind: 'static';
      readonly span: GraphSpanV1;
      readonly value: string;
    };

export interface TextNodeV1 extends NodeBaseV1 {
  readonly format?: FormattedValueV1;
  readonly kind: 'text';
  readonly localization?: LocalizedMessageV1;
  readonly parts: readonly TextPartV1[];
}

export type PropSpreadSourceV1 =
  | {
      /** A caller-owned rest parameter forwarded without scalar coercion. */
      readonly kind: 'rest';
      readonly span: GraphSpanV1;
      readonly targetId: NodeIdV1;
    }
  | {
      /** Reserved for record-valued expressions as the value graph grows. */
      readonly kind: 'value';
      readonly value: ValueExpressionV1;
    };

export type UiNodeV1 =
  | AsyncResourceNodeV1
  | CellNodeV1
  | CollectionItemNodeV1
  | ComponentInstanceNodeV1
  | ComponentNodeV1
  | ComponentParameterNodeV1
  | ConditionalRegionNodeV1
  | ComputedNodeV1
  | ContextConsumerNodeV1
  | ContextNodeV1
  | ContextProviderNodeV1
  | ConstantNodeV1
  | ContentSlotNodeV1
  | ContentReferenceNodeV1
  | ContentValueNodeV1
  | ElementNodeV1
  | EffectNodeV1
  | KeyedCollectionNodeV1
  | PlatformCapabilityNodeV1
  | ProcedureNodeV1
  | ResourceNodeV1
  | RefNodeV1
  | TextNodeV1;

export type UiEdgeV1 =
  | {
      readonly from: NodeIdV1;
      readonly index: number;
      readonly kind: 'child';
      readonly to: NodeIdV1;
    }
  | {
      readonly authoredName: string;
      readonly event: string;
      readonly from: NodeIdV1;
      readonly kind: 'event';
      readonly span: GraphSpanV1;
      readonly to: NodeIdV1;
    }
  | {
      /** The containing component definition owns this authored instance. */
      readonly from: NodeIdV1;
      readonly kind: 'owner';
      readonly to: NodeIdV1;
    }
  | {
      readonly authoredName?: string;
      readonly from: NodeIdV1;
      /** Authored attribute position when ordered prop composition is used. */
      readonly index?: number;
      readonly kind: 'prop';
      readonly mode: 'procedure';
      readonly span: GraphSpanV1;
      /** Procedure node or procedure parameter passed as the capability. */
      readonly targetId: NodeIdV1;
      /** Parameter node receiving the capability. */
      readonly to: NodeIdV1;
    }
  | {
      readonly authoredName?: string;
      readonly from: NodeIdV1;
      /** Authored attribute position when ordered prop composition is used. */
      readonly index?: number;
      readonly kind: 'prop';
      readonly mode: 'reactive';
      readonly span: GraphSpanV1;
      /** Parameter node receiving the reactive value. */
      readonly to: NodeIdV1;
      readonly value: ValueExpressionV1;
    }
  | {
      readonly from: NodeIdV1;
      /** Authored attribute position; spreads always participate in ordering. */
      readonly index: number;
      readonly kind: 'spread-prop';
      readonly source: PropSpreadSourceV1;
      readonly span: GraphSpanV1;
      /** The target component's rest parameter. */
      readonly to: NodeIdV1;
    }
  | {
      readonly accesses?: readonly GraphAccessV1[];
      readonly from: NodeIdV1;
      readonly kind: 'read';
      readonly mode: 'procedural' | 'reactive';
      readonly sites: readonly GraphSpanV1[];
      readonly to: NodeIdV1;
    }
  | {
      readonly accesses?: readonly GraphAccessV1[];
      readonly from: NodeIdV1;
      readonly kind: 'write';
      readonly mode: 'procedural';
      readonly sites: readonly GraphSpanV1[];
      readonly to: NodeIdV1;
    };

export interface UiGraphV1 {
  /** Component ids which may be mounted as module entry points. */
  readonly entryComponents: readonly NodeIdV1[];
  /** Sorted by kind, from, to, and kind-specific metadata. */
  readonly edges: readonly UiEdgeV1[];
  /** POSIX module path relative to the project root. */
  readonly moduleId: string;
  /** Sorted lexicographically by semantic id. */
  readonly nodes: readonly UiNodeV1[];
  readonly schemaVersion: 'oxe.ui-graph.v1';
}
