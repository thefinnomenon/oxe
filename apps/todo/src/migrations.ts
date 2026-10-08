import type { ApplicationGraphV1 } from '@oxe/graph';
import type { ApplicationSqlPoolV1 } from '@oxe/postgres';

/** Assigns pre-Team tasks without changing their owner or losing existing data. */
export const backfillTodoRevision13Teams = async (pool: ApplicationSqlPoolV1): Promise<void> => {
  await pool.transaction(async (connection) => {
    await connection.query(`INSERT INTO "oxe_todo"."team" ("id", "name", "owner_id")
SELECT 'team-personal-' || md5("owner_id"), 'Personal', "owner_id"
FROM "oxe_todo"."task"
WHERE "team_id" IS NULL
GROUP BY "owner_id"
ON CONFLICT ("id") DO NOTHING`);
    await connection.query(`UPDATE "oxe_todo"."task"
SET "team_id" = 'team-personal-' || md5("owner_id")
WHERE "team_id" IS NULL`);
  });
};

/** Reconstructs the deployed r15 graph before declarative browser modes and cache policy. */
export const todoRevision15Graph = (current: ApplicationGraphV1): ApplicationGraphV1 => ({
  ...current,
  queries: current.queries.map((query) => {
    const { cache: _cache, ...withoutCache } = query;
    void _cache;
    if (query.id !== 'query.myTeamInvitations') return withoutCache;
    const { where: _where, ...withoutPolicy } = withoutCache;
    void _where;
    return withoutPolicy;
  }),
  revision: 15,
  views: current.views.map((view) => {
    const { forbidden: _forbidden, ...modes } = view.modes;
    void _forbidden;
    const tree =
      view.tree.kind === 'component' && view.tree.children
        ? {
            ...view.tree,
            children: view.tree.children.map((child) => {
              if (
                child.kind !== 'repeat' ||
                (child.id !== 'element.myInvitationList' &&
                  child.id !== 'element.teamInvitationList')
              )
                return child;
              const { display: _display, ...withoutDisplay } = child;
              void _display;
              return withoutDisplay;
            }),
          }
        : view.tree;
    return { ...view, modes, tree };
  }),
});

/** Reconstructs the deployed r14 immediate-membership contract for the r15 lifecycle migration. */
export const todoRevision14Graph = (latest: ApplicationGraphV1): ApplicationGraphV1 => {
  const current = todoRevision15Graph(latest);
  const { uniques: _uniques, ...withoutUniques } = current;
  void _uniques;
  const contextTeam = current.contexts?.find((context) => context.id === 'context.team');
  const membershipPolicy = current.policies.find((policy) => policy.id === 'policy.membership');
  if (!contextTeam || !membershipPolicy)
    throw new Error('TinyTodo r15 cannot reconstruct revision 14.');
  const views = current.views.map((view) =>
    view.id !== 'view.tasks'
      ? view
      : {
          ...view,
          data: { tasks: { query: 'query.myTasks' } },
          tree:
            view.tree.kind === 'component' && view.tree.children
              ? {
                  ...view.tree,
                  children: view.tree.children.filter(
                    (child) =>
                      child.id !== 'element.myInvitationList' &&
                      child.id !== 'element.teamInvitationList',
                  ),
                }
              : view.tree,
        },
  );
  return {
    ...withoutUniques,
    contexts: (current.contexts ?? []).map((context) =>
      context.id !== 'context.team'
        ? context
        : {
            ...context,
            authorization: {
              kind: 'anyOf',
              anyOf: [
                { kind: 'relationEqualsActor', relation: 'relation.teamOwner' },
                {
                  conditions: [{ equals: 'active', field: 'field.membership.status' }],
                  kind: 'membership',
                  memberRelation: 'relation.membershipMember',
                  membershipEntity: 'entity.teamMembership',
                  resourceRelation: 'relation.membershipTeam',
                },
              ],
            },
          },
    ),
    entities: current.entities.map((entity) =>
      entity.id !== 'entity.teamMembership'
        ? entity
        : {
            ...entity,
            fields: (entity.fields ?? []).filter((field) => field !== 'field.membership.accepted'),
          },
    ),
    fields: current.fields.filter((field) => field.id !== 'field.membership.accepted'),
    operations: current.operations
      .filter(
        (operation) =>
          operation.id !== 'operation.acceptTeamInvitation' &&
          operation.id !== 'operation.revokeTeamInvitation',
      )
      .map((operation) =>
        operation.id === 'operation.inviteTeamMember' && operation.body.kind === 'createEntity'
          ? {
              ...operation,
              body: {
                ...operation.body,
                values: Object.fromEntries(
                  Object.entries(operation.body.values).filter(
                    ([semanticId]) => semanticId !== 'field.membership.accepted',
                  ),
                ),
              },
            }
          : operation,
      ),
    policies: current.policies.map((policy) =>
      policy.id !== 'policy.membership'
        ? policy
        : {
            ...policy,
            rules: {
              create: membershipPolicy.rules.create,
              delete: {
                context: 'context.ownedTeam',
                kind: 'relationEqualsContext',
                relation: 'relation.membershipTeam',
              },
              read: {
                context: 'context.ownedTeam',
                kind: 'relationEqualsContext',
                relation: 'relation.membershipTeam',
              },
              update: {
                context: 'context.ownedTeam',
                kind: 'relationEqualsContext',
                relation: 'relation.membershipTeam',
              },
            },
          },
    ),
    queries: current.queries.filter(
      (query) => query.id !== 'query.myTeamInvitations' && query.id !== 'query.teamInvitations',
    ),
    revision: 14,
    verification: {
      ...current.verification,
      invariants: current.verification.invariants
        .filter((invariant) => invariant.id !== 'invariant.uniqueTeamMembership')
        .map((invariant) =>
          invariant.id === 'invariant.teamInvites'
            ? {
                ...invariant,
                statement: 'Only a Team owner can grant another user active membership',
              }
            : invariant,
        ),
    },
    views,
  };
};

/** Reconstructs the deployed r13 Team-owner contract so OXE can compile r14 membership storage. */
export const todoRevision13Graph = (current: ApplicationGraphV1): ApplicationGraphV1 => {
  const revision14 = todoRevision14Graph(current);
  const taskView = revision14.views.map((view) =>
    view.id !== 'view.tasks'
      ? view
      : {
          ...view,
          data: {
            tasks: { query: 'query.myTasks' },
            teams: { query: 'query.myTeams' },
          },
          tree:
            view.tree.kind === 'component' && view.tree.children
              ? {
                  ...view.tree,
                  children: view.tree.children.filter(
                    (child) => child.id !== 'element.inviteTeamMemberForm',
                  ),
                }
              : view.tree,
        },
  );
  const teamContext = revision14.contexts?.find((context) => context.id === 'context.team');
  if (!teamContext) throw new Error('TinyTodo r14 cannot reconstruct revision 13.');
  const { labelField: _labelField, ...r13TeamContext } = teamContext;
  void _labelField;
  return {
    ...revision14,
    app: { ...revision14.app, contexts: ['context.team'] },
    contexts: [
      {
        ...r13TeamContext,
        authorization: { kind: 'relationEqualsActor', relation: 'relation.teamOwner' },
      },
    ],
    entities: revision14.entities.filter((entity) => entity.id !== 'entity.teamMembership'),
    fields: revision14.fields.filter((field) => field.entity !== 'entity.teamMembership'),
    operations: revision14.operations.filter(
      (operation) => operation.id !== 'operation.inviteTeamMember',
    ),
    policies: revision14.policies.filter((policy) => policy.id !== 'policy.membership'),
    queries: [
      ...revision14.queries,
      {
        id: 'query.myTeams',
        kind: 'query',
        feature: 'feature.tasks',
        name: 'myTeams',
        entity: 'entity.team',
        filter: { kind: 'relationEqualsActor', relation: 'relation.teamOwner' },
        order: [{ field: 'field.team.name', direction: 'ascending' }],
        select: ['field.team.id', 'field.team.name', 'field.team.createdAt'],
      },
    ],
    relations: revision14.relations.filter(
      (relation) =>
        relation.id !== 'relation.membershipMember' && relation.id !== 'relation.membershipTeam',
    ),
    revision: 13,
    verification: {
      ...revision14.verification,
      invariants: revision14.verification.invariants
        .filter((invariant) => invariant.id !== 'invariant.teamInvites')
        .map((invariant) =>
          invariant.id === 'invariant.teamAccess'
            ? { ...invariant, statement: 'A Team can be selected only by its owner' }
            : invariant,
        ),
    },
    views: taskView,
  };
};

/** Reconstructs the deployed r12 storage contract so OXE can compile the r13 Team migration. */
export const todoRevision12Graph = (current: ApplicationGraphV1): ApplicationGraphV1 => {
  const revision13 = todoRevision13Graph(current);
  const { contexts: _appContexts, ...app } = revision13.app;
  void _appContexts;
  const taskPolicy = revision13.policies.find((policy) => policy.id === 'policy.task');
  const taskQuery = revision13.queries.find((query) => query.id === 'query.myTasks');
  if (!taskPolicy || !taskQuery) throw new Error('TinyTodo r13 cannot reconstruct revision 12.');
  const taskView = revision13.views.map((view) =>
    view.id !== 'view.tasks'
      ? view
      : {
          ...view,
          data: { tasks: { query: 'query.myTasks' } },
          tree:
            view.tree.kind === 'component' && view.tree.children
              ? {
                  ...view.tree,
                  children: view.tree.children.filter(
                    (child) => child.id !== 'element.createTeamForm',
                  ),
                }
              : view.tree,
        },
  );
  return {
    ...revision13,
    app,
    contexts: [],
    entities: revision13.entities.filter((entity) => entity.id !== 'entity.team'),
    fields: revision13.fields.filter((field) => field.entity !== 'entity.team'),
    operations: revision13.operations
      .filter((operation) => operation.id !== 'operation.createTeam')
      .map((operation) =>
        operation.id === 'operation.createTask' && operation.body.kind === 'createEntity'
          ? {
              ...operation,
              body: {
                ...operation.body,
                values: Object.fromEntries(
                  Object.entries(operation.body.values).filter(
                    ([semanticId]) => semanticId !== 'relation.taskTeam',
                  ),
                ),
              },
            }
          : operation,
      ),
    policies: [
      {
        ...taskPolicy,
        rules: {
          create: { kind: 'authenticated' },
          delete: { kind: 'relationEqualsActor', relation: 'relation.taskOwner' },
          read: { kind: 'relationEqualsActor', relation: 'relation.taskOwner' },
          update: { kind: 'relationEqualsActor', relation: 'relation.taskOwner' },
        },
      },
    ],
    queries: [
      {
        ...taskQuery,
        filter: { kind: 'relationEqualsActor', relation: 'relation.taskOwner' },
      },
    ],
    relations: revision13.relations.filter(
      (relation) => relation.id !== 'relation.taskTeam' && relation.id !== 'relation.teamOwner',
    ),
    revision: 12,
    verification: {
      ...revision13.verification,
      invariants: revision13.verification.invariants.filter(
        (invariant) => invariant.id !== 'invariant.teamAccess',
      ),
    },
    views: taskView,
  };
};
