export const AUTH_ACTIONS = ['get', 'getMany', 'create', 'update', 'delete'] as const;

export const AUTH_SUGAR_ACTIONS = ['read', 'write'] as const;

export type AuthAction = (typeof AUTH_ACTIONS)[number];

export type AuthSugarAction = (typeof AUTH_SUGAR_ACTIONS)[number];

export const AUTH_SUBJECT_SYMBOL = Symbol.for('@oxe/schema-core/auth-subject');

export interface AuthSubjectReference {
  readonly [AUTH_SUBJECT_SYMBOL]: true;
  readonly name: string;
}

export interface RoleSubjectReference {
  readonly declarationKind: 'role';
  readonly name: string;
}

export type AuthToken = string | AuthSubjectReference | RoleSubjectReference;

export type AuthValue = AuthToken | readonly AuthToken[];

export type AuthInput = Partial<Record<AuthAction | AuthSugarAction, AuthValue>>;

const createAuthSubjectReference = (name: string): AuthSubjectReference => ({
  [AUTH_SUBJECT_SYMBOL]: true,
  name,
});

export const auth = {
  public: createAuthSubjectReference('public'),
  private: createAuthSubjectReference('private'),
  owner: createAuthSubjectReference('owner'),
  subject: (name: string): AuthSubjectReference => createAuthSubjectReference(name),
  role: (role: string | RoleSubjectReference): AuthSubjectReference =>
    createAuthSubjectReference(typeof role === 'string' ? role : role.name),
} as const;

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

export const resolveAuthToken = (token: AuthToken): string => {
  if (typeof token === 'string') {
    return token;
  }

  if (isAuthSubjectReference(token) || isRoleSubjectReference(token)) {
    return token.name;
  }

  return String(token);
};
