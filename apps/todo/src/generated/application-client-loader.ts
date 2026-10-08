/* Generated from the normalized OXE application graph. Do not edit. */
export interface ApplicationClientHandleV1 {
  clearCache(): void;
  inspectCache(): { readonly entries: number; readonly hits: number; readonly misses: number; readonly pending: number };
}
export interface ApplicationClientBootstrapOptionsV1 {
  readonly contextEndpoint?: string;
  readonly defaultMaxAgeMs?: number;
  readonly endpoint?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly requestedContexts?: readonly { readonly contextId: string; readonly recordId: string }[];
}
export type ApplicationClientModuleNameV1 = "account-client" | "ownedTeam-client" | "team-client";
export const bootstrapApplicationClientModule = async (
  moduleName: ApplicationClientModuleNameV1,
  options: ApplicationClientBootstrapOptionsV1 = {},
): Promise<ApplicationClientHandleV1> => {
  switch (moduleName) {
    case "account-client": return (await import("./account-client.js")).bootstrapApplicationClient(options);
    case "ownedTeam-client": return (await import("./ownedTeam-client.js")).bootstrapApplicationClient(options);
    case "team-client": return (await import("./team-client.js")).bootstrapApplicationClient(options);
  }
};
