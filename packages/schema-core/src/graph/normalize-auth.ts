import {
  AUTH_ACTIONS,
  resolveAuthToken,
  type AuthAction,
  type AuthInput,
  type AuthToken,
  type AuthValue,
} from '../dsl/auth.js';
import type { NormalizedAuth } from './types.js';

const toArray = (value: AuthValue | undefined): string[] => {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((token) => resolveAuthToken(token));
  }

  return [resolveAuthToken(value as AuthToken)];
};

const addTokens = (target: Map<AuthAction, Set<string>>, action: AuthAction, tokens: string[]): void => {
  const current = target.get(action) ?? new Set<string>();
  for (const token of tokens) {
    current.add(token);
  }
  target.set(action, current);
};

export const normalizeAuth = (input?: AuthInput): NormalizedAuth => {
  const actionMap = new Map<AuthAction, Set<string>>();

  for (const action of AUTH_ACTIONS) {
    actionMap.set(action, new Set<string>());
  }

  if (!input) {
    return {
      get: [],
      getMany: [],
      create: [],
      update: [],
      delete: [],
    };
  }

  const readTokens = toArray(input.read);
  addTokens(actionMap, 'get', readTokens);
  addTokens(actionMap, 'getMany', readTokens);

  const writeTokens = toArray(input.write);
  addTokens(actionMap, 'create', writeTokens);
  addTokens(actionMap, 'update', writeTokens);

  for (const action of AUTH_ACTIONS) {
    addTokens(actionMap, action, toArray(input[action]));
  }

  return {
    get: [...(actionMap.get('get') ?? [])],
    getMany: [...(actionMap.get('getMany') ?? [])],
    create: [...(actionMap.get('create') ?? [])],
    update: [...(actionMap.get('update') ?? [])],
    delete: [...(actionMap.get('delete') ?? [])],
  };
};
