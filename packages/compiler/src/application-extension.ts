import type {
  ApplicationComponentExtensionV1,
  ApplicationExtensionModuleV1,
  ApplicationGraphV1,
} from '@oxe/graph';

export interface ApplicationCompiledExtensionModuleV1 {
  readonly browser?: string;
  readonly server?: string;
}

export type ApplicationCompiledExtensionModulesV1 = Readonly<
  Record<string, ApplicationCompiledExtensionModuleV1>
>;

export interface ApplicationExtensionArtifactV1 {
  readonly contents: string;
  readonly id: string;
  readonly kind: 'browser-extension' | 'server-extension' | 'style';
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const header = '/* Generated from the normalized OXE application graph. Do not edit. */';

const modulePath = (module: ApplicationExtensionModuleV1, target: 'browser' | 'server'): string =>
  `${target}/extensions/${module.id}.${module.format === 'css' ? 'css' : 'js'}`;

const bindingImports = (
  bindings: readonly {
    readonly binding: { readonly export: string; readonly module: string };
    readonly id: string;
  }[],
  prefix: string,
): { readonly imports: string; readonly values: readonly { id: string; local: string }[] } => {
  const values = bindings.map(({ id }, index) => ({ id, local: `${prefix}${index + 1}` }));
  return {
    imports: bindings
      .map(
        ({ binding }, index) =>
          `import { ${binding.export} as ${prefix}${index + 1} } from './extensions/${binding.module}.js';`,
      )
      .join('\n'),
    values,
  };
};

export const generateApplicationServerExtensionRegistry = (graph: ApplicationGraphV1): string => {
  const capabilities = [...(graph.capabilities ?? [])]
    .sort((left, right) => compareText(left.id, right.id))
    .flatMap((capability) =>
      capability.adapter ? [{ binding: capability.adapter, id: capability.id }] : [],
    );
  const projected = bindingImports(capabilities, 'capabilityAdapter');
  return `${header}
${projected.imports}${projected.imports ? '\n\n' : ''}export const applicationCapabilityAdapters = Object.freeze({${projected.values
    .map(({ id, local }) => `${JSON.stringify(id)}: ${local}`)
    .join(',')}});
for (const [id, adapter] of Object.entries(applicationCapabilityAdapters)) {
  if (!adapter || typeof adapter.invoke !== 'function')
    throw new TypeError('Application capability adapter "' + id + '" must export an object with invoke().');
}
${capabilities
  .filter(({ binding }) => binding.jobIdempotency === 'jobId')
  .map(
    ({ id }) =>
      `if (applicationCapabilityAdapters[${JSON.stringify(id)}].idempotency !== 'jobId') throw new TypeError(${JSON.stringify(`Application capability adapter "${id}" must declare jobId idempotency.`)});`,
  )
  .join('\n')}
`;
};

const componentContract = (component: ApplicationComponentExtensionV1): unknown => ({
  children: component.children,
  events: [...(component.events ?? [])].sort(compareText),
  id: component.id,
  name: component.name,
  props: component.props,
  ssr: component.ssr,
});

export const generateApplicationBrowserExtensionRegistry = (graph: ApplicationGraphV1): string => {
  const components = [...(graph.components ?? [])]
    .sort((left, right) => compareText(left.id, right.id))
    .map((component) => ({ binding: component.implementation, id: component.id }));
  const projected = bindingImports(components, 'componentImplementation');
  const contracts = Object.fromEntries(
    [...(graph.components ?? [])]
      .sort((left, right) => compareText(left.id, right.id))
      .map((component) => [component.id, componentContract(component)]),
  );
  return `${header}
${projected.imports}${projected.imports ? '\n\n' : ''}export const applicationComponentContracts = Object.freeze(${JSON.stringify(contracts)});
export const applicationComponentImplementations = Object.freeze({${projected.values
    .map(({ id, local }) => `${JSON.stringify(id)}: ${local}`)
    .join(',')}});
for (const [id, implementation] of Object.entries(applicationComponentImplementations)) {
  if (!implementation || typeof implementation.define !== 'function')
    throw new TypeError('Application component extension "' + id + '" must export an object with define(contract).');
  implementation.define(applicationComponentContracts[id]);
}
`;
};

const cssValue = (value: string): string => value.trim();

/** Generates theme tokens and imports graph-declared scoped/raw CSS extension assets. */
export const generateApplicationStyleSheet = (graph: ApplicationGraphV1): string => {
  const styles = [...(graph.styles ?? [])].sort((left, right) => compareText(left.id, right.id));
  const imports = styles.flatMap((style) =>
    [...(style.stylesheets ?? [])].map(
      (moduleId) => `@import url('./extensions/${moduleId}.css');`,
    ),
  );
  const blocks: string[] = [];
  for (const style of styles) {
    const tokens = Object.entries(style.tokens)
      .sort(([left], [right]) => compareText(left, right))
      .map(([name, value]) => `  --${name}: ${cssValue(value)};`);
    if (tokens.length > 0) blocks.push(`:root {\n${tokens.join('\n')}\n}`);
    for (const [theme, overrides] of Object.entries(style.themes ?? {}).sort(([left], [right]) =>
      compareText(left, right),
    )) {
      const values = Object.entries(overrides)
        .sort(([left], [right]) => compareText(left, right))
        .map(([name, value]) => `  --${name}: ${cssValue(value)};`);
      if (values.length > 0)
        blocks.push(`[data-oxe-theme=${JSON.stringify(theme)}] {\n${values.join('\n')}\n}`);
    }
  }
  return `${imports.join('\n')}${imports.length > 0 && blocks.length > 0 ? '\n\n' : ''}${blocks.join('\n\n')}${imports.length > 0 || blocks.length > 0 ? '\n' : ''}`;
};

export const projectApplicationExtensionArtifacts = (
  graph: ApplicationGraphV1,
  compiled: ApplicationCompiledExtensionModulesV1 = {},
): readonly ApplicationExtensionArtifactV1[] => {
  const artifacts: ApplicationExtensionArtifactV1[] = [];
  for (const module of [...(graph.modules ?? [])].sort((left, right) =>
    compareText(left.id, right.id),
  )) {
    const source = compiled[module.id];
    if (module.target !== 'server') {
      const contents = source?.browser;
      if (contents === undefined)
        throw new TypeError(`Missing compiled browser extension module "${module.id}".`);
      artifacts.push({
        contents,
        id: modulePath(module, 'browser'),
        kind: module.format === 'css' ? 'style' : 'browser-extension',
      });
    }
    if (module.target !== 'browser') {
      const contents = source?.server;
      if (contents === undefined)
        throw new TypeError(`Missing compiled server extension module "${module.id}".`);
      artifacts.push({ contents, id: modulePath(module, 'server'), kind: 'server-extension' });
    }
  }
  if ((graph.capabilities ?? []).some((capability) => capability.adapter))
    artifacts.push({
      contents: generateApplicationServerExtensionRegistry(graph),
      id: 'server/extensions.js',
      kind: 'server-extension',
    });
  if ((graph.components?.length ?? 0) > 0)
    artifacts.push({
      contents: generateApplicationBrowserExtensionRegistry(graph),
      id: 'browser/extensions.js',
      kind: 'browser-extension',
    });
  if ((graph.styles?.length ?? 0) > 0)
    artifacts.push({
      contents: generateApplicationStyleSheet(graph),
      id: 'browser/application.css',
      kind: 'style',
    });
  return artifacts.sort((left, right) => compareText(left.id, right.id));
};
