import type { ApplicationSemanticIdV1 } from './application-types.js';

export const APPLICATION_DEVELOPMENT_INTERACTION_SCHEMA =
  'oxe.application-development-interaction.v1' as const;

export type ApplicationDevelopmentInteractionKindV1 =
  'change' | 'click' | 'navigation' | 'operation' | 'submit';

export type ApplicationDevelopmentInteractionOutcomeV1 = 'failed' | 'started' | 'succeeded';

export interface ApplicationDevelopmentInteractionTargetV1 {
  readonly control: 'button' | 'form' | 'input' | 'link' | 'other' | 'select';
  readonly elementId?: ApplicationSemanticIdV1;
  readonly fieldId?: ApplicationSemanticIdV1;
  /** Static graph or host-owned label. User-entered and record-derived values are never included. */
  readonly label?: string;
  readonly operationId?: ApplicationSemanticIdV1;
}

/** Bounded, privacy-safe development context emitted by an instrumented application preview. */
export interface ApplicationDevelopmentInteractionV1 {
  readonly at: number;
  readonly kind: ApplicationDevelopmentInteractionKindV1;
  readonly outcome?: ApplicationDevelopmentInteractionOutcomeV1;
  /** Pathname only. Query parameters and fragments are intentionally excluded. */
  readonly route: string;
  readonly schemaVersion: typeof APPLICATION_DEVELOPMENT_INTERACTION_SCHEMA;
  readonly sequence: number;
  readonly target?: ApplicationDevelopmentInteractionTargetV1;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key));

const semanticId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 240 &&
  /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)+$/u.test(value);

const controls = new Set(['button', 'form', 'input', 'link', 'other', 'select']);
const kinds = new Set(['change', 'click', 'navigation', 'operation', 'submit']);
const outcomes = new Set(['failed', 'started', 'succeeded']);

export const parseApplicationDevelopmentInteraction = (
  value: unknown,
): ApplicationDevelopmentInteractionV1 => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'at',
      'kind',
      'outcome',
      'route',
      'schemaVersion',
      'sequence',
      'target',
    ]) ||
    value.schemaVersion !== APPLICATION_DEVELOPMENT_INTERACTION_SCHEMA
  )
    throw new TypeError('Development interaction has an invalid schema or fields.');
  if (!Number.isSafeInteger(value.at) || (value.at as number) < 0)
    throw new TypeError('Development interaction at must be a non-negative safe integer.');
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1)
    throw new TypeError('Development interaction sequence must be a positive safe integer.');
  if (typeof value.kind !== 'string' || !kinds.has(value.kind))
    throw new TypeError('Development interaction kind is invalid.');
  if (
    typeof value.route !== 'string' ||
    !value.route.startsWith('/') ||
    value.route.length > 1_024 ||
    value.route.includes('?') ||
    value.route.includes('#')
  )
    throw new TypeError('Development interaction route must be a pathname without query or hash.');
  if (
    value.outcome !== undefined &&
    (typeof value.outcome !== 'string' || !outcomes.has(value.outcome))
  )
    throw new TypeError('Development interaction outcome is invalid.');
  if ((value.kind === 'operation') !== (value.outcome !== undefined))
    throw new TypeError('Only operation interactions require an outcome.');

  let target: ApplicationDevelopmentInteractionTargetV1 | undefined;
  if (value.target !== undefined) {
    if (
      !isRecord(value.target) ||
      !hasOnlyKeys(value.target, ['control', 'elementId', 'fieldId', 'label', 'operationId']) ||
      typeof value.target.control !== 'string' ||
      !controls.has(value.target.control)
    )
      throw new TypeError('Development interaction target is invalid.');
    for (const key of ['elementId', 'fieldId', 'operationId'] as const)
      if (value.target[key] !== undefined && !semanticId(value.target[key]))
        throw new TypeError(`Development interaction target ${key} is not a semantic ID.`);
    if (
      value.target.label !== undefined &&
      (typeof value.target.label !== 'string' ||
        value.target.label.trim().length === 0 ||
        value.target.label.length > 160)
    )
      throw new TypeError('Development interaction target label is invalid.');
    target = Object.freeze({
      control: value.target.control as ApplicationDevelopmentInteractionTargetV1['control'],
      ...(semanticId(value.target.elementId) ? { elementId: value.target.elementId } : {}),
      ...(semanticId(value.target.fieldId) ? { fieldId: value.target.fieldId } : {}),
      ...(typeof value.target.label === 'string' ? { label: value.target.label.trim() } : {}),
      ...(semanticId(value.target.operationId) ? { operationId: value.target.operationId } : {}),
    });
  }
  if (value.kind !== 'navigation' && !target)
    throw new TypeError('Non-navigation development interactions require a target.');
  if (value.kind === 'operation' && !target?.operationId)
    throw new TypeError('Operation development interactions require an operationId.');
  return Object.freeze({
    at: value.at as number,
    kind: value.kind as ApplicationDevelopmentInteractionKindV1,
    ...(value.outcome === undefined
      ? {}
      : { outcome: value.outcome as ApplicationDevelopmentInteractionOutcomeV1 }),
    route: value.route,
    schemaVersion: APPLICATION_DEVELOPMENT_INTERACTION_SCHEMA,
    sequence: value.sequence as number,
    ...(target ? { target } : {}),
  });
};
