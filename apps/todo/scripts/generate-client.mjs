import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import {
  generateApplicationBrowserClient,
  generateApplicationBrowserClientFacet,
  generateApplicationBrowserClientRuntimeModule,
  generateApplicationBrowserViewModule,
  lowerApplicationRouteToUiGraph,
  projectApplicationBrowserView,
} from '../../../packages/compiler/dist/index.js';
import { loadApplicationGraph } from '../../../packages/graph/dist/index.js';

const graphUrl = new URL('../../../examples/application-graph-todo/graph.json', import.meta.url);
const outputUrl = new URL('../src/generated/application-client.ts', import.meta.url);
const runtimeOutputUrl = new URL('../src/generated/application-client-runtime.ts', import.meta.url);
const viewOutputUrl = new URL('../src/generated/application-view.ts', import.meta.url);
const graph = loadApplicationGraph(JSON.parse(readFileSync(graphUrl, 'utf8')));
const definitions = lowerApplicationRouteToUiGraph(graph).graph.serverFunctions ?? [];
const projection = generateApplicationBrowserClient(graph, definitions);
const writeChanged = (url, source) => {
  const current = (() => {
    try {
      return readFileSync(url, 'utf8');
    } catch {
      return undefined;
    }
  })();
  if (current !== source) {
    mkdirSync(new URL('../src/generated/', import.meta.url), { recursive: true });
    writeFileSync(url, source);
  }
};

writeChanged(outputUrl, projection.moduleSource);
writeChanged(runtimeOutputUrl, generateApplicationBrowserClientRuntimeModule());

const view = projectApplicationBrowserView(graph);
const modules = new Map();
for (const definition of view.functions) {
  const entries = modules.get(definition.clientModule) ?? [];
  entries.push(definition.id);
  modules.set(definition.clientModule, entries);
}
for (const [moduleName, ids] of modules) {
  const moduleDefinitions = definitions.filter((definition) => ids.includes(definition.id));
  const moduleProjection = generateApplicationBrowserClientFacet(graph, moduleDefinitions);
  writeChanged(
    new URL(`../src/generated/${moduleName}.ts`, import.meta.url),
    moduleProjection.moduleSource,
  );
}

const loaderSource = `/* Generated from the normalized OXE application graph. Do not edit. */
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
export type ApplicationClientModuleNameV1 = ${[...modules.keys()].sort().map(JSON.stringify).join(' | ')};
export const bootstrapApplicationClientModule = async (
  moduleName: ApplicationClientModuleNameV1,
  options: ApplicationClientBootstrapOptionsV1 = {},
): Promise<ApplicationClientHandleV1> => {
  switch (moduleName) {
${[...modules.keys()]
  .sort()
  .map(
    (moduleName) =>
      `    case ${JSON.stringify(moduleName)}: return (await import(${JSON.stringify(`./${moduleName}.js`)})).bootstrapApplicationClient(options);`,
  )
  .join('\n')}
  }
};
`;
writeChanged(
  new URL('../src/generated/application-client-loader.ts', import.meta.url),
  loaderSource,
);
writeChanged(viewOutputUrl, generateApplicationBrowserViewModule(graph));
