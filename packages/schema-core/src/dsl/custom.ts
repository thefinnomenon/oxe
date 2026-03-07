import type { AuthAction } from './auth.js';

export const CUSTOM_TRANSFORM_SYMBOL = Symbol.for('@oxe/schema-core/custom-transform');
export const CUSTOM_VALIDATOR_SYMBOL = Symbol.for('@oxe/schema-core/custom-validator');

export interface UserContext<TUser = unknown> {
  user?: TUser;
}

export interface CustomExecutionContext<
  TRecord = unknown,
  TUser = unknown,
> extends UserContext<TUser> {
  declarationName: string;
  fieldName: string;
  action?: AuthAction;
  record: TRecord;
  previousRecord?: TRecord;
  now: Date;
}

export interface TransformDefinition<TValue = unknown> {
  readonly [CUSTOM_TRANSFORM_SYMBOL]: true;
  readonly name: string;
  readonly run: (value: TValue, context: CustomExecutionContext) => TValue;
}

export type ValidatorReturn = true | string;
export type AuthCheckReturn = true | string;

export interface ValidatorDefinition<TValue = unknown> {
  readonly [CUSTOM_VALIDATOR_SYMBOL]: true;
  readonly name: string;
  readonly run: (value: TValue, context: CustomExecutionContext) => ValidatorReturn;
}

export interface AuthCheckDefinition<TRecord = unknown, TUser = unknown> {
  readonly name: string;
  readonly run: (
    context: CustomExecutionContext<TRecord, TUser>,
  ) => AuthCheckReturn | Promise<AuthCheckReturn>;
}

/**
 * Declares a reusable custom transform.
 * Return the transformed value from run(...).
 * @param name Stable transform identifier stored in the schema graph.
 * @param run Transform implementation:
 * `run(value, ctx)` where `value` is the current field value and `ctx` is the execution context
 * (record, user, declaration/field names, action, and timestamp metadata).
 */
export const defineTransform = <TValue>(
  name: string,
  run: TransformDefinition<TValue>['run'],
): TransformDefinition<TValue> => ({
  [CUSTOM_TRANSFORM_SYMBOL]: true,
  name,
  run,
});

/**
 * Declares a reusable custom validator.
 * Return true when valid, or an error message string when invalid.
 * @param name Stable validator identifier stored in the schema graph.
 * @param run Validator implementation:
 * `run(value, ctx)` where `value` is the current field value and `ctx` is the execution context.
 * Return `true` when valid, or a human-readable error message string when invalid.
 */
export const defineValidator = <TValue>(
  name: string,
  run: ValidatorDefinition<TValue>['run'],
): ValidatorDefinition<TValue> => ({
  [CUSTOM_VALIDATOR_SYMBOL]: true,
  name,
  run,
});

export const isTransformDefinition = (value: unknown): value is TransformDefinition => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return (value as Record<PropertyKey, unknown>)[CUSTOM_TRANSFORM_SYMBOL] === true;
};

export const isValidatorDefinition = (value: unknown): value is ValidatorDefinition => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return (value as Record<PropertyKey, unknown>)[CUSTOM_VALIDATOR_SYMBOL] === true;
};
