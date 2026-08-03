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

export type PrimitiveTypeV1 = 'array' | 'boolean' | 'number' | 'string' | 'unknown';

export type LiteralValueV1 = boolean | number | string;

export type BinaryOperatorV1 = '!=' | '%' | '*' | '+' | '-' | '/' | '==' | 'and' | 'or';

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
      readonly kind: 'literal';
      readonly span: GraphSpanV1;
      readonly value: boolean | number | string;
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

export interface ConditionalBranchV1 {
  readonly condition?: ValueExpressionV1;
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
  readonly value: LiteralValueV1 | readonly LiteralValueV1[];
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

export interface WriteStepV1 {
  readonly kind: 'write';
  readonly span: GraphSpanV1;
  readonly targetId: NodeIdV1;
  readonly value: ValueExpressionV1;
}

export interface ProcedureNodeV1 extends NodeBaseV1 {
  readonly kind: 'procedure';
  readonly name: string;
  readonly parameters: readonly ParameterV1[];
  readonly steps: readonly WriteStepV1[];
}

export interface StaticAttributeV1 {
  readonly name: string;
  readonly span: GraphSpanV1;
  readonly value: boolean | number | string;
}

export interface DynamicAttributeV1 {
  readonly mode: 'attribute' | 'property';
  readonly name: string;
  readonly span: GraphSpanV1;
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
  readonly kind: 'text';
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
  | CellNodeV1
  | CollectionItemNodeV1
  | ComponentInstanceNodeV1
  | ComponentNodeV1
  | ComponentParameterNodeV1
  | ConditionalRegionNodeV1
  | ComputedNodeV1
  | ConstantNodeV1
  | ContentSlotNodeV1
  | ElementNodeV1
  | KeyedCollectionNodeV1
  | ProcedureNodeV1
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
      readonly from: NodeIdV1;
      readonly kind: 'read';
      readonly mode: 'procedural' | 'reactive';
      readonly sites: readonly GraphSpanV1[];
      readonly to: NodeIdV1;
    }
  | {
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
