/** Canonical CRUD actions used for route generation metadata. */
export const CRUD_ACTIONS = ['get', 'getMany', 'create', 'update', 'delete'] as const;

/** CRUD sugar keys. `read` => get/getMany, `write` => create/update. */
export const CRUD_SUGAR_ACTIONS = ['read', 'write'] as const;

export type CrudAction = (typeof CRUD_ACTIONS)[number];

export type CrudSugarAction = (typeof CRUD_SUGAR_ACTIONS)[number];

export type CrudActionLike = CrudAction | CrudSugarAction;

/**
 * Resource CRUD config:
 * - `false` disables generated CRUD routes.
 * - array allows explicit canonical and/or sugar actions.
 */
export type CrudInput = false | readonly CrudActionLike[];
