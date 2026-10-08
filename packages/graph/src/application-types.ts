/** Stable, application-level identity. These ids survive renames and generated projections. */
export type ApplicationSemanticIdV1 = string;

export type ApplicationNodeOriginV1 = 'builtin' | 'generated';

export type ApplicationScalarValueV1 = boolean | null | number | string;

export type ApplicationValueTypeV1 =
  | { readonly kind: 'boolean' }
  | { readonly kind: 'bytes' }
  | { readonly kind: 'date' }
  | { readonly kind: 'dateTime' }
  | { readonly kind: 'decimal'; readonly precision: number; readonly scale: number }
  | { readonly kind: 'email' }
  | { readonly entity: ApplicationSemanticIdV1; readonly kind: 'entity' }
  | { readonly entity: ApplicationSemanticIdV1; readonly kind: 'entityId' }
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'integer'; readonly maximum?: number; readonly minimum?: number }
  | {
      readonly items: ApplicationValueTypeV1;
      readonly kind: 'list';
      readonly maximumItems?: number;
      readonly minimumItems?: number;
    }
  | { readonly kind: 'number' }
  | { readonly kind: 'optional'; readonly value: ApplicationValueTypeV1 }
  | {
      readonly fields: Readonly<Record<string, ApplicationValueTypeV1>>;
      readonly kind: 'record';
    }
  | {
      readonly kind: 'result';
      readonly outcomes: Readonly<Record<string, ApplicationValueTypeV1>>;
      readonly value: ApplicationValueTypeV1;
    }
  | { readonly kind: 'string' }
  | { readonly kind: 'url' };

export type ApplicationValueExpressionV1 =
  | { readonly context: ApplicationSemanticIdV1; readonly kind: 'activeContext' }
  | { readonly kind: 'actor' }
  | { readonly kind: 'formValue'; readonly name: string; readonly valueType?: 'number' }
  | { readonly kind: 'inputField'; readonly name: string }
  | { readonly kind: 'literal'; readonly value: ApplicationScalarValueV1 }
  | { readonly kind: 'local'; readonly name: string }
  | { readonly kind: 'not'; readonly value: ApplicationValueExpressionV1 }
  | {
      readonly field: ApplicationSemanticIdV1;
      readonly kind: 'recordField';
      readonly record: ApplicationValueExpressionV1;
    }
  | { readonly kind: 'semanticReference'; readonly target: ApplicationSemanticIdV1 }
  | { readonly kind: 'viewData'; readonly name: string };

interface ApplicationNodeBaseV1 {
  readonly id: ApplicationSemanticIdV1;
}

export interface ApplicationAuthenticationV1 {
  readonly authenticatedRoute: ApplicationSemanticIdV1;
  readonly methods: readonly 'emailPassword'[];
  readonly provider: 'betterAuth';
  readonly signInPath: string;
  readonly signUpPath: string;
}

export interface ApplicationDefinitionV1 extends ApplicationNodeBaseV1 {
  readonly actorEntity: ApplicationSemanticIdV1;
  readonly authentication?: ApplicationAuthenticationV1;
  /** Semantic context roles available to this application. */
  readonly contexts?: readonly ApplicationSemanticIdV1[];
  readonly entryRoute: ApplicationSemanticIdV1;
  readonly kind: 'app';
  readonly name: string;
}

export interface ApplicationContextMembershipConditionV1 {
  readonly equals: ApplicationScalarValueV1;
  readonly field: ApplicationSemanticIdV1;
}

export type ApplicationContextAuthorizationMethodV1 =
  | {
      readonly conditions?: readonly ApplicationContextMembershipConditionV1[];
      readonly kind: 'membership';
      readonly membershipEntity: ApplicationSemanticIdV1;
      readonly memberRelation: ApplicationSemanticIdV1;
      readonly resourceRelation: ApplicationSemanticIdV1;
    }
  | { readonly kind: 'relationEqualsActor'; readonly relation: ApplicationSemanticIdV1 };

export type ApplicationContextAuthorizationV1 =
  | ApplicationContextAuthorizationMethodV1
  | {
      readonly anyOf: readonly ApplicationContextAuthorizationMethodV1[];
      readonly kind: 'anyOf';
    };

export interface ApplicationContextParentV1 {
  /** Parent context role whose selected entity must be related to this context's record. */
  readonly context: ApplicationSemanticIdV1;
  readonly relation: ApplicationSemanticIdV1;
}

/** A named authorization-relevant role; multiple roles may target the same entity type. */
export interface ApplicationContextV1 extends ApplicationNodeBaseV1 {
  readonly authorization: ApplicationContextAuthorizationV1;
  readonly entity: ApplicationSemanticIdV1;
  readonly kind: 'context';
  /** String field used by generic context pickers. */
  readonly labelField?: ApplicationSemanticIdV1;
  readonly name: string;
  readonly parents?: readonly ApplicationContextParentV1[];
}

export interface ApplicationFeatureV1 extends ApplicationNodeBaseV1 {
  readonly kind: 'feature';
  readonly name: string;
}

export interface ApplicationEntityV1 extends ApplicationNodeBaseV1 {
  readonly feature?: ApplicationSemanticIdV1;
  readonly fields?: readonly ApplicationSemanticIdV1[];
  readonly kind: 'entity';
  readonly name: string;
  readonly origin?: ApplicationNodeOriginV1;
}

export interface ApplicationStringLengthConstraintV1 {
  readonly kind: 'stringLength';
  readonly max?: number;
  readonly min?: number;
}

export interface ApplicationFieldV1 extends ApplicationNodeBaseV1 {
  readonly default?: Extract<ApplicationValueExpressionV1, { readonly kind: 'literal' }>;
  readonly entity: ApplicationSemanticIdV1;
  readonly kind: 'field';
  readonly name: string;
  readonly origin?: ApplicationNodeOriginV1;
  readonly required: boolean;
  readonly validation?: readonly ApplicationStringLengthConstraintV1[];
  readonly valueType: ApplicationValueTypeV1;
}

export interface ApplicationRelationEndpointV1 {
  readonly cardinality: 'many' | 'one';
  readonly createValue?: Extract<
    ApplicationValueExpressionV1,
    { readonly kind: 'activeContext' | 'actor' }
  >;
  readonly entity: ApplicationSemanticIdV1;
  readonly name: string;
  readonly required: boolean;
}

export interface ApplicationRelationV1 extends ApplicationNodeBaseV1 {
  readonly feature?: ApplicationSemanticIdV1;
  readonly from: ApplicationRelationEndpointV1;
  readonly kind: 'relation';
  readonly to: ApplicationRelationEndpointV1;
}

/** Storage-enforced uniqueness over fields and/or relations owned by one entity. */
export interface ApplicationUniqueConstraintV1 extends ApplicationNodeBaseV1 {
  readonly entity: ApplicationSemanticIdV1;
  readonly keys: readonly ApplicationSemanticIdV1[];
  readonly kind: 'unique';
}

export type ApplicationPolicyPredicateV1 =
  | { readonly kind: 'authenticated' }
  | { readonly kind: 'relationEqualsActor'; readonly relation: ApplicationSemanticIdV1 }
  | {
      readonly context: ApplicationSemanticIdV1;
      readonly kind: 'relationEqualsContext';
      readonly relation: ApplicationSemanticIdV1;
    };

export interface ApplicationPolicyV1 extends ApplicationNodeBaseV1 {
  readonly kind: 'policy';
  readonly rules: Readonly<
    Record<'create' | 'delete' | 'read' | 'update', ApplicationPolicyPredicateV1>
  >;
  readonly target: ApplicationSemanticIdV1;
}

export interface ApplicationQueryV1 extends ApplicationNodeBaseV1 {
  readonly cache?:
    { readonly kind: 'memory'; readonly maxAgeMs: number } | { readonly kind: 'no-store' };
  readonly entity: ApplicationSemanticIdV1;
  readonly feature?: ApplicationSemanticIdV1;
  readonly filter?: ApplicationPolicyPredicateV1;
  readonly kind: 'query';
  readonly name: string;
  readonly order?: readonly {
    readonly direction: 'ascending' | 'descending';
    readonly field: ApplicationSemanticIdV1;
  }[];
  readonly select: readonly ApplicationSemanticIdV1[];
  readonly where?: readonly {
    readonly equals: ApplicationScalarValueV1;
    readonly field: ApplicationSemanticIdV1;
  }[];
}

export interface ApplicationDatabaseWriteEffectV1 {
  readonly kind: 'databaseWrite';
  readonly target: ApplicationSemanticIdV1;
}

export interface ApplicationExternalCallEffectV1 {
  readonly kind: 'externalCall';
  readonly target: ApplicationSemanticIdV1;
}

/** A durable capability delivery inserted atomically with database writes. */
export interface ApplicationJobEnqueueEffectV1 {
  readonly kind: 'jobEnqueue';
  readonly target: ApplicationSemanticIdV1;
}

export type ApplicationOperationEffectV1 =
  | ApplicationDatabaseWriteEffectV1
  | ApplicationExternalCallEffectV1
  | ApplicationJobEnqueueEffectV1;

export interface ApplicationCapabilityMethodV1 {
  readonly input: Extract<ApplicationValueTypeV1, { readonly kind: 'record' }>;
  readonly output: ApplicationValueTypeV1;
}

export interface ApplicationExtensionBindingV1 {
  /** Named ESM export that implements the semantic contract. */
  readonly export: string;
  /** Required for adapters used by durable at-least-once jobs. */
  readonly jobIdempotency?: 'jobId';
  readonly module: ApplicationSemanticIdV1;
}

/** Provider-neutral external contract. Runtime adapters, credentials, and SDKs are projections. */
export interface ApplicationCapabilityV1 extends ApplicationNodeBaseV1 {
  /** Optional project-owned implementation. Hosts may still inject an adapter explicitly. */
  readonly adapter?: ApplicationExtensionBindingV1;
  readonly contract: string;
  readonly kind: 'capability';
  readonly methods: Readonly<Record<string, ApplicationCapabilityMethodV1>>;
  readonly name: string;
  readonly version: string;
}

export interface ApplicationExtensionModuleV1 extends ApplicationNodeBaseV1 {
  readonly format: 'css' | 'javascript';
  /** SHA-256 of the exact source bytes, encoded as lowercase hexadecimal. */
  readonly integrity: `sha256:${string}`;
  readonly kind: 'extensionModule';
  readonly name: string;
  /** Package names and exact accepted versions/ranges used by this source module. */
  readonly packages?: Readonly<Record<string, string>>;
  /** Project-relative source path. Source is a revisioned asset, not a generated projection. */
  readonly source: string;
  readonly target: 'browser' | 'server' | 'universal';
}

export interface ApplicationComponentExtensionV1 extends ApplicationNodeBaseV1 {
  readonly children: 'none' | 'optional' | 'required';
  readonly events?: readonly string[];
  readonly implementation: ApplicationExtensionBindingV1;
  readonly kind: 'componentExtension';
  readonly name: string;
  readonly props: Readonly<Record<string, ApplicationValueTypeV1>>;
  /** Deterministic inert server fallback adopted or replaced by the browser implementation. */
  readonly ssr: {
    readonly tag: string;
  };
}

export interface ApplicationStyleV1 extends ApplicationNodeBaseV1 {
  readonly kind: 'style';
  readonly name: string;
  /** CSS custom-property names without the leading `--`. */
  readonly themes?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly tokens: Readonly<Record<string, string>>;
  /** CSS extension modules applied after generated tokens. */
  readonly stylesheets?: readonly ApplicationSemanticIdV1[];
}

export interface ApplicationJobRetryV1 {
  /** Initial retry delay after the first failed delivery. Defaults to 1 second. */
  readonly initialDelayMs?: number;
  /** Symmetric randomization range from 0 through 1. Defaults to 0.2. */
  readonly jitterRatio?: number;
  readonly maxAttempts: number;
  /** Maximum retry delay. Defaults to 60 seconds. */
  readonly maxDelayMs?: number;
  /** Exponential multiplier. Defaults to 2. */
  readonly multiplier?: number;
}

export type ApplicationWorkflowStepV1 =
  | {
      /** Stable operation-local name available to subsequent steps and the workflow result. */
      readonly as: string;
      readonly entity: ApplicationSemanticIdV1;
      readonly kind: 'createEntity';
      readonly values: Readonly<Record<ApplicationSemanticIdV1, ApplicationValueExpressionV1>>;
    }
  | {
      /** Stable operation-local name available to subsequent steps and the workflow result. */
      readonly as: string;
      readonly entity: ApplicationSemanticIdV1;
      readonly kind: 'deleteEntity';
      readonly record: ApplicationValueExpressionV1;
    }
  | {
      /** Stable operation-local name available to subsequent steps and the workflow result. */
      readonly as: string;
      readonly entity: ApplicationSemanticIdV1;
      readonly kind: 'updateEntity';
      readonly record: ApplicationValueExpressionV1;
      readonly values: Readonly<Record<ApplicationSemanticIdV1, ApplicationValueExpressionV1>>;
    }
  | {
      /** Stable operation-local job receipt: `{ jobId: string }`. */
      readonly as: string;
      readonly arguments: Readonly<Record<string, ApplicationValueExpressionV1>>;
      readonly capability: ApplicationSemanticIdV1;
      readonly kind: 'enqueueCapability';
      readonly method: string;
      readonly retry: ApplicationJobRetryV1;
    };

export type ApplicationOperationBodyV1 =
  | {
      readonly entity: ApplicationSemanticIdV1;
      readonly kind: 'createEntity';
      readonly values: Readonly<Record<ApplicationSemanticIdV1, ApplicationValueExpressionV1>>;
    }
  | {
      readonly kind: 'deleteEntity';
      readonly record: ApplicationValueExpressionV1;
    }
  | {
      readonly kind: 'updateEntity';
      readonly record: ApplicationValueExpressionV1;
      readonly values: Readonly<Record<ApplicationSemanticIdV1, ApplicationValueExpressionV1>>;
    }
  | {
      readonly arguments: Readonly<Record<string, ApplicationValueExpressionV1>>;
      readonly capability: ApplicationSemanticIdV1;
      readonly kind: 'invokeCapability';
      readonly method: string;
    }
  | {
      readonly kind: 'workflow';
      readonly result: ApplicationValueExpressionV1;
      readonly steps: readonly ApplicationWorkflowStepV1[];
    };

export interface ApplicationOperationV1 extends ApplicationNodeBaseV1 {
  readonly body: ApplicationOperationBodyV1;
  readonly effects: readonly ApplicationOperationEffectV1[];
  readonly feature?: ApplicationSemanticIdV1;
  readonly input: Extract<ApplicationValueTypeV1, { readonly kind: 'record' }>;
  readonly kind: 'operation';
  readonly name: string;
  readonly output: ApplicationValueTypeV1;
}

export interface ApplicationRouteV1 extends ApplicationNodeBaseV1 {
  readonly authentication: 'optional' | 'required';
  readonly feature?: ApplicationSemanticIdV1;
  readonly kind: 'route';
  readonly path: string;
  readonly view: ApplicationSemanticIdV1;
}

export interface ApplicationOperationInvocationV1 {
  readonly arguments: Readonly<Record<string, ApplicationValueExpressionV1>>;
  readonly operation: ApplicationSemanticIdV1;
}

export interface ApplicationComponentElementV1 {
  readonly children?: readonly ApplicationViewElementV1[];
  readonly component: string;
  readonly events?: Readonly<Record<string, ApplicationOperationInvocationV1>>;
  /** Semantic fields managed by a form independently of its lowered component tree. */
  readonly fields?: readonly ApplicationSemanticIdV1[];
  readonly id?: ApplicationSemanticIdV1;
  readonly kind: 'component';
  readonly props?: Readonly<Record<string, ApplicationValueExpressionV1>>;
  readonly submit?: ApplicationOperationInvocationV1;
}

export interface ApplicationRepeatElementV1 {
  /** Additional entity fields displayed by this list independently of its row primitive. */
  readonly display?: readonly ApplicationSemanticIdV1[];
  readonly id?: ApplicationSemanticIdV1;
  readonly identity: ApplicationValueExpressionV1;
  readonly itemName: string;
  readonly kind: 'repeat';
  readonly source: ApplicationValueExpressionV1;
  readonly template: ApplicationViewElementV1;
}

export type ApplicationViewElementV1 = ApplicationComponentElementV1 | ApplicationRepeatElementV1;

export interface ApplicationSkeletonElementHintV1 {
  readonly shape?: 'block' | 'control' | 'text';
  readonly width?: 'full' | 'medium' | 'short';
}

export interface ApplicationSkeletonHintsV1 {
  readonly elements?: Readonly<Record<ApplicationSemanticIdV1, ApplicationSkeletonElementHintV1>>;
  readonly rows?: number;
}

export type ApplicationViewModeV1 =
  | {
      readonly kind: 'generated';
      readonly skeleton?: ApplicationSkeletonHintsV1;
      readonly strategy?: 'preserveStaticStructure';
    }
  | { readonly from: ApplicationSemanticIdV1; readonly kind: 'inherited' };

export interface ApplicationViewV1 extends ApplicationNodeBaseV1 {
  readonly data: Readonly<Record<string, { readonly query: ApplicationSemanticIdV1 }>>;
  readonly feature?: ApplicationSemanticIdV1;
  readonly kind: 'view';
  readonly modes: Readonly<
    Record<'empty' | 'error' | 'loading' | 'notFound' | 'unauthorized', ApplicationViewModeV1> &
      Partial<Record<'forbidden', ApplicationViewModeV1>>
  >;
  readonly name: string;
  readonly tree: ApplicationViewElementV1;
}

export interface ApplicationInvariantV1 extends ApplicationNodeBaseV1 {
  readonly kind: 'invariant';
  readonly statement: string;
}

export type ApplicationVerificationStepV1 =
  | {
      readonly kind: 'expectField';
      readonly field: ApplicationSemanticIdV1;
      readonly value: ApplicationScalarValueV1;
    }
  | {
      readonly kind: 'expectQueryContains';
      readonly query: ApplicationSemanticIdV1;
      readonly values: Readonly<Record<ApplicationSemanticIdV1, ApplicationScalarValueV1>>;
    }
  | { readonly kind: 'invoke'; readonly operation: ApplicationSemanticIdV1 }
  | {
      readonly kind: 'submit';
      readonly element: ApplicationSemanticIdV1;
      readonly values: Readonly<Record<string, ApplicationScalarValueV1>>;
    }
  | { readonly kind: 'visit'; readonly route: ApplicationSemanticIdV1 };

export interface ApplicationVerificationFlowV1 extends ApplicationNodeBaseV1 {
  readonly actor: 'authenticatedUser';
  readonly kind: 'verificationFlow';
  readonly steps: readonly ApplicationVerificationStepV1[];
}

export interface ApplicationVerificationV1 {
  readonly flows: readonly ApplicationVerificationFlowV1[];
  readonly invariants: readonly ApplicationInvariantV1[];
}

/** Canonical semantic application graph. This is intentionally not a lowered UiGraphV1. */
export interface ApplicationGraphV1 {
  readonly app: ApplicationDefinitionV1;
  readonly capabilities?: readonly ApplicationCapabilityV1[];
  readonly components?: readonly ApplicationComponentExtensionV1[];
  readonly contexts?: readonly ApplicationContextV1[];
  readonly entities: readonly ApplicationEntityV1[];
  readonly features: readonly ApplicationFeatureV1[];
  readonly fields: readonly ApplicationFieldV1[];
  readonly format: 'oxe.application-graph';
  readonly modules?: readonly ApplicationExtensionModuleV1[];
  readonly operations: readonly ApplicationOperationV1[];
  readonly policies: readonly ApplicationPolicyV1[];
  readonly queries: readonly ApplicationQueryV1[];
  readonly relations: readonly ApplicationRelationV1[];
  readonly revision: number;
  readonly routes: readonly ApplicationRouteV1[];
  readonly styles?: readonly ApplicationStyleV1[];
  readonly uniques?: readonly ApplicationUniqueConstraintV1[];
  readonly verification: ApplicationVerificationV1;
  readonly version: 1;
  readonly views: readonly ApplicationViewV1[];
}
