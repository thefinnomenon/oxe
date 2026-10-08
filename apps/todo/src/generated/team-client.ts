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
  readonly "createTask": (title: string, options?: ApplicationMutationOptionsV1) => Promise<{ readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }>;
  readonly "deleteTask": (task: { readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }, options?: ApplicationMutationOptionsV1) => Promise<{ readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }>;
  readonly "renameTask": (task: { readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }, title: string, options?: ApplicationMutationOptionsV1) => Promise<{ readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }>;
  readonly "toggleTask": (task: { readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }, options?: ApplicationMutationOptionsV1) => Promise<{ readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }>;
  readonly "myTasks": (options?: ApplicationQueryOptionsV1) => Promise<readonly { readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }[]>;
  clearCache(): void;
  inspectCache(): ApplicationClientCacheSnapshotV1;
}

import { bootstrapApplicationClientContext, createApplicationClientRuntime } from "./application-client-runtime.js";
const manifest = {"cache":{"defaultMaxAgeMs":30000},"functions":[{"cacheMaxAgeMs":null,"id":"app.todo/operation.createTask","invalidates":["query.myTasks"],"mode":"mutation","returns":0,"semanticId":"operation.createTask"},{"cacheMaxAgeMs":null,"id":"app.todo/operation.deleteTask","invalidates":["query.myTasks"],"mode":"mutation","returns":0,"semanticId":"operation.deleteTask"},{"cacheMaxAgeMs":null,"id":"app.todo/operation.renameTask","invalidates":["query.myTasks"],"mode":"mutation","returns":0,"semanticId":"operation.renameTask"},{"cacheMaxAgeMs":null,"id":"app.todo/operation.toggleTask","invalidates":["query.myTasks"],"mode":"mutation","returns":0,"semanticId":"operation.toggleTask"},{"cacheMaxAgeMs":30000,"id":"app.todo/query.myTasks","invalidates":[],"mode":"query","returns":1,"semanticId":"query.myTasks"}],"schemas":[{"fields":[{"name":"createdAt","schema":{"kind":"string"}},{"name":"done","schema":{"kind":"boolean"}},{"name":"id","schema":{"kind":"string"}},{"name":"title","schema":{"kind":"string","maximumLength":120,"minimumLength":1}}],"kind":"record"},{"items":{"fields":[{"name":"createdAt","schema":{"kind":"string"}},{"name":"done","schema":{"kind":"boolean"}},{"name":"id","schema":{"kind":"string"}},{"name":"title","schema":{"kind":"string","maximumLength":120,"minimumLength":1}}],"kind":"record"},"kind":"array"}]} as const;
export const createApplicationClient = (options: ApplicationClientOptionsV1): ApplicationClientV1 => {
  const { clearCache, inspectCache, mutate, query } = createApplicationClientRuntime(manifest, options);
  return Object.freeze({
    "createTask": (title: string, options?: ApplicationMutationOptionsV1) => mutate<{ readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }>("app.todo/operation.createTask", [title], options),
    "deleteTask": (task: { readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }, options?: ApplicationMutationOptionsV1) => mutate<{ readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }>("app.todo/operation.deleteTask", [task], options),
    "renameTask": (task: { readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }, title: string, options?: ApplicationMutationOptionsV1) => mutate<{ readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }>("app.todo/operation.renameTask", [task, title], options),
    "toggleTask": (task: { readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }, options?: ApplicationMutationOptionsV1) => mutate<{ readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }>("app.todo/operation.toggleTask", [task], options),
    "myTasks": (options?: ApplicationQueryOptionsV1) => query<readonly { readonly "createdAt": string; readonly "done": boolean; readonly "id": string; readonly "title": string; }[]>("app.todo/query.myTasks", [], options),
    clearCache,
    inspectCache,
  });
};
export const bootstrapApplicationClient = async (options: ApplicationClientBootstrapOptionsV1 = {}): Promise<ApplicationClientV1> =>
  createApplicationClient({ ...options, context: await bootstrapApplicationClientContext(options) });
