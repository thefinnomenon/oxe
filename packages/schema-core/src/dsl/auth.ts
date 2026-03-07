import type { CustomExecutionContext } from './custom.js';
import type { AuthCheckReturn } from './custom.js';

/** Canonical auth actions used in normalized metadata. */
export const AUTH_ACTIONS = ['get', 'getMany', 'create', 'update', 'delete'] as const;

/** Auth action sugar keys. `read` => get/getMany, `write` => create/update. */
export const AUTH_SUGAR_ACTIONS = ['read', 'write'] as const;

export type AuthAction = (typeof AUTH_ACTIONS)[number];

export type AuthSugarAction = (typeof AUTH_SUGAR_ACTIONS)[number];

export const AUTH_SUBJECT_SYMBOL = Symbol.for('@oxe/schema-core/auth-subject');
export const AUTH_CHECK_SYMBOL = Symbol.for('@oxe/schema-core/auth-check');

export interface AuthSubjectReference {
  readonly [AUTH_SUBJECT_SYMBOL]: true;
  readonly name: string;
}

export interface RoleSubjectReference {
  readonly declarationKind: 'role';
  readonly name: string;
}

export interface AuthCheckReference {
  readonly [AUTH_CHECK_SYMBOL]: true;
  readonly name: string;
}

export type AuthToken = string | AuthSubjectReference | RoleSubjectReference | AuthCheckReference;

export type AuthValue = AuthToken | readonly AuthToken[];

/** Input shape for auth rules with canonical actions plus sugar keys. */
export interface AuthInput {
  /** Sugar for both `get` and `getMany`. */
  read?: AuthValue;
  /** Sugar for both `create` and `update`. */
  write?: AuthValue;
  /** Permission subjects for reading one record. */
  get?: AuthValue;
  /** Permission subjects for listing many records. */
  getMany?: AuthValue;
  /** Permission subjects for creating records. */
  create?: AuthValue;
  /** Permission subjects for updating records. */
  update?: AuthValue;
  /** Permission subjects for deleting records. */
  delete?: AuthValue;
}

const createAuthSubjectReference = (name: string): AuthSubjectReference => ({
  [AUTH_SUBJECT_SYMBOL]: true,
  name,
});

export const auth = {
  /** Allows unauthenticated/public access for the action. */
  public: createAuthSubjectReference('public'),
  /** Restricts action to authenticated users. */
  private: createAuthSubjectReference('private'),
  /** Refers to record ownership checks. */
  owner: createAuthSubjectReference('owner'),
  /** Creates a custom auth subject token by name. */
  subject: (name: string): AuthSubjectReference => createAuthSubjectReference(name),
  /** Converts a role name/declaration into an auth subject token. */
  role: (role: string | RoleSubjectReference): AuthSubjectReference =>
    createAuthSubjectReference(typeof role === 'string' ? role : role.name),
} as const;

/**
 * Declares a reusable custom auth check token.
 * Return true when authorized, or an error message string when unauthorized.
 * @param name Stable auth-check identifier stored in normalized auth tokens.
 * @param run Auth-check implementation:
 * `run(ctx)` where `ctx` is the execution context (record, user, action, declaration/field names, etc).
 * Return `true` when authorized, or an authorization error message string when unauthorized.
 */
export const defineAuthCheck = <TRecord = unknown, TUser = unknown>(
  name: string,
  run: (
    context: CustomExecutionContext<TRecord, TUser>,
  ) => AuthCheckReturn | Promise<AuthCheckReturn>,
): AuthCheckReference & {
  run: (
    context: CustomExecutionContext<TRecord, TUser>,
  ) => AuthCheckReturn | Promise<AuthCheckReturn>;
} => ({
  [AUTH_CHECK_SYMBOL]: true,
  name,
  run,
});

export const isAuthSubjectReference = (value: unknown): value is AuthSubjectReference => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return (value as Record<PropertyKey, unknown>)[AUTH_SUBJECT_SYMBOL] === true;
};

export const isRoleSubjectReference = (value: unknown): value is RoleSubjectReference => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return candidate.declarationKind === 'role' && typeof candidate.name === 'string';
};

export const isAuthCheckReference = (value: unknown): value is AuthCheckReference => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return (value as Record<PropertyKey, unknown>)[AUTH_CHECK_SYMBOL] === true;
};

export const resolveAuthToken = (token: AuthToken): string => {
  if (typeof token === 'string') {
    return token;
  }

  if (
    isAuthSubjectReference(token) ||
    isRoleSubjectReference(token) ||
    isAuthCheckReference(token)
  ) {
    return token.name;
  }

  return String(token);
};
