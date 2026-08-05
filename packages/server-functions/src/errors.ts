import type { AsyncFailureKind } from '@oxe/runtime';

import type { ServerFunctionValidationIssue } from './types.js';

export type ServerFunctionErrorCode =
  | 'OXE_SERVER_FUNCTION_ABORTED'
  | 'OXE_SERVER_FUNCTION_DUPLICATE'
  | 'OXE_SERVER_FUNCTION_INVALID_CONTRACT'
  | 'OXE_SERVER_FUNCTION_NOT_FOUND'
  | 'OXE_SERVER_FUNCTION_PROTOCOL'
  | 'OXE_SERVER_FUNCTION_SERIALIZATION';

export class OxeServerFunctionError extends Error {
  public constructor(
    public readonly code: ServerFunctionErrorCode,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = 'OxeServerFunctionError';
  }
}

export class OxeServerFunctionSerializationError extends OxeServerFunctionError {
  public constructor(
    public readonly issue: ServerFunctionValidationIssue,
    message = issue.message,
  ) {
    super('OXE_SERVER_FUNCTION_SERIALIZATION', message);
    this.name = 'OxeServerFunctionSerializationError';
  }
}

/** An intentionally public failure which may safely cross the server boundary. */
export class OxeServerFunctionPublicError extends Error {
  public readonly issues: readonly ServerFunctionValidationIssue[] | undefined;
  public readonly status: number;

  public constructor(
    public readonly kind: AsyncFailureKind,
    message: string,
    options: {
      readonly cause?: unknown;
      readonly issues?: readonly ServerFunctionValidationIssue[];
      readonly status?: number;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'OxeServerFunctionPublicError';
    if (
      kind !== 'not-found' &&
      kind !== 'unauthorized' &&
      kind !== 'forbidden' &&
      kind !== 'validation' &&
      kind !== 'unexpected'
    ) {
      throw new TypeError('A public server-function error has an invalid failure kind.');
    }
    this.status =
      options.status ??
      (kind === 'not-found'
        ? 404
        : kind === 'unauthorized'
          ? 401
          : kind === 'forbidden'
            ? 403
            : kind === 'validation'
              ? 400
              : 500);
    if (!Number.isInteger(this.status) || this.status < 400 || this.status > 599) {
      throw new RangeError('A public server-function status must be an integer from 400 to 599.');
    }
    this.issues = options.issues;
  }
}

export const abortedServerFunction = (): OxeServerFunctionError =>
  new OxeServerFunctionError(
    'OXE_SERVER_FUNCTION_ABORTED',
    'The server-function invocation was aborted.',
  );
