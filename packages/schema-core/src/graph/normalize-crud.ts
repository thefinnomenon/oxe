import { CRUD_ACTIONS, type CrudAction, type CrudInput } from '../dsl/crud.js';
import type { NormalizedCrud } from './types.js';

const addAction = (target: Set<CrudAction>, action: CrudAction): void => {
  target.add(action);
};

export const normalizeCrud = (input?: CrudInput): NormalizedCrud => {
  if (input === false) {
    return {
      enabled: false,
      actions: [],
    };
  }

  if (!input) {
    return {
      enabled: true,
      actions: [...CRUD_ACTIONS],
    };
  }

  const actions = new Set<CrudAction>();
  for (const entry of input) {
    if (entry === 'read') {
      addAction(actions, 'get');
      addAction(actions, 'getMany');
      continue;
    }
    if (entry === 'write') {
      addAction(actions, 'create');
      addAction(actions, 'update');
      continue;
    }
    addAction(actions, entry);
  }

  return {
    enabled: true,
    actions: CRUD_ACTIONS.filter((action) => actions.has(action)),
  };
};
