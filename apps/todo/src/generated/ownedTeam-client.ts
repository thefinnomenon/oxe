/* Generated from the normalized OXE application graph. Do not edit. */
import type {
  ApplicationClientBootstrapOptionsV1,
  ApplicationClientCacheSnapshotV1,
  ApplicationClientOptionsV1,
  ApplicationMutationOptionsV1,
  ApplicationQueryOptionsV1,
} from "./application-client-runtime.js";
export type { ApplicationClientBootstrapOptionsV1, ApplicationClientOptionsV1 } from "./application-client-runtime.js";
export interface ApplicationClientV1 {
  readonly "inviteTeamMember": (userId: string, options?: ApplicationMutationOptionsV1) => Promise<{ readonly "accepted": boolean; readonly "createdAt": string; readonly "id": string; readonly "role": "member"; readonly "status": "active"; readonly "userId": string; }>;
  readonly "revokeTeamInvitation": (invitation: { readonly "accepted": boolean; readonly "createdAt": string; readonly "id": string; readonly "role": "member"; readonly "status": "active"; readonly "userId": string; }, options?: ApplicationMutationOptionsV1) => Promise<{ readonly "accepted": boolean; readonly "createdAt": string; readonly "id": string; readonly "role": "member"; readonly "status": "active"; readonly "userId": string; }>;
  readonly "teamInvitations": (options?: ApplicationQueryOptionsV1) => Promise<readonly { readonly "accepted": boolean; readonly "createdAt": string; readonly "id": string; readonly "role": "member"; readonly "status": "active"; readonly "userId": string; }[]>;
  clearCache(): void;
  inspectCache(): ApplicationClientCacheSnapshotV1;
}

import { bootstrapApplicationClientContext, createApplicationClientRuntime } from "./application-client-runtime.js";
const manifest = {"cache":{"defaultMaxAgeMs":30000},"functions":[{"cacheMaxAgeMs":null,"id":"app.todo/operation.inviteTeamMember","invalidates":["query.myTeamInvitations","query.teamInvitations"],"mode":"mutation","returns":0,"semanticId":"operation.inviteTeamMember"},{"cacheMaxAgeMs":null,"id":"app.todo/operation.revokeTeamInvitation","invalidates":["query.myTeamInvitations","query.teamInvitations"],"mode":"mutation","returns":0,"semanticId":"operation.revokeTeamInvitation"},{"cacheMaxAgeMs":5000,"id":"app.todo/query.teamInvitations","invalidates":[],"mode":"query","returns":1,"semanticId":"query.teamInvitations"}],"schemas":[{"fields":[{"name":"accepted","schema":{"kind":"boolean"}},{"name":"createdAt","schema":{"kind":"string"}},{"name":"id","schema":{"kind":"string"}},{"name":"role","schema":{"enum":["member"],"kind":"string"}},{"name":"status","schema":{"enum":["active"],"kind":"string"}},{"name":"userId","schema":{"kind":"string"}}],"kind":"record"},{"items":{"fields":[{"name":"accepted","schema":{"kind":"boolean"}},{"name":"createdAt","schema":{"kind":"string"}},{"name":"id","schema":{"kind":"string"}},{"name":"role","schema":{"enum":["member"],"kind":"string"}},{"name":"status","schema":{"enum":["active"],"kind":"string"}},{"name":"userId","schema":{"kind":"string"}}],"kind":"record"},"kind":"array"}]} as const;
export const createApplicationClient = (options: ApplicationClientOptionsV1): ApplicationClientV1 => {
  const { clearCache, inspectCache, mutate, query } = createApplicationClientRuntime(manifest, options);
  return Object.freeze({
    "inviteTeamMember": (userId: string, options?: ApplicationMutationOptionsV1) => mutate<{ readonly "accepted": boolean; readonly "createdAt": string; readonly "id": string; readonly "role": "member"; readonly "status": "active"; readonly "userId": string; }>("app.todo/operation.inviteTeamMember", [userId], options),
    "revokeTeamInvitation": (invitation: { readonly "accepted": boolean; readonly "createdAt": string; readonly "id": string; readonly "role": "member"; readonly "status": "active"; readonly "userId": string; }, options?: ApplicationMutationOptionsV1) => mutate<{ readonly "accepted": boolean; readonly "createdAt": string; readonly "id": string; readonly "role": "member"; readonly "status": "active"; readonly "userId": string; }>("app.todo/operation.revokeTeamInvitation", [invitation], options),
    "teamInvitations": (options?: ApplicationQueryOptionsV1) => query<readonly { readonly "accepted": boolean; readonly "createdAt": string; readonly "id": string; readonly "role": "member"; readonly "status": "active"; readonly "userId": string; }[]>("app.todo/query.teamInvitations", [], options),
    clearCache,
    inspectCache,
  });
};
export const bootstrapApplicationClient = async (options: ApplicationClientBootstrapOptionsV1 = {}): Promise<ApplicationClientV1> =>
  createApplicationClient({ ...options, context: await bootstrapApplicationClientContext(options) });
