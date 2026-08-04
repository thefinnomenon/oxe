import batchedSource from '../../../examples/batched/App.oxe?raw';
import componentCompositionSource from '../../../examples/component-composition/App.oxe?raw';
import compositionFeaturesSource from '../../../examples/composition-features/App.oxe?raw';
import componentModulesAppSource from '../../../examples/component-modules/App.oxe?raw';
import componentModulesCardSource from '../../../examples/component-modules/Card.oxe?raw';
import conditionalRegionSource from '../../../examples/conditional-region/App.oxe?raw';
import conditionalValuesSource from '../../../examples/conditional-values/App.oxe?raw';
import contentValuesSource from '../../../examples/content-values/App.oxe?raw';
import contextSource from '../../../examples/context/App.oxe?raw';
import counterSource from '../../../examples/counter/App.oxe?raw';
import cycleSource from '../../../examples/diagnostics-cycle/App.oxe?raw';
import missingContextProviderSource from '../../../examples/diagnostics-missing-context-provider/App.oxe?raw';
import typeErrorSource from '../../../examples/diagnostics-type-error/App.oxe?raw';
import unknownNameSource from '../../../examples/diagnostics-unknown-name/App.oxe?raw';
import derivedSource from '../../../examples/derived/App.oxe?raw';
import domAttributesSource from '../../../examples/dom-attributes/App.oxe?raw';
import expressionValuesSource from '../../../examples/expression-values/App.oxe?raw';
import keyedCollectionSource from '../../../examples/keyed-collection/App.oxe?raw';
import staticSource from '../../../examples/static/App.oxe?raw';
import untrackSnapshotSource from '../../../examples/untrack-snapshot/App.oxe?raw';
import asyncDedupeSource from '../../../examples/async-dedupe/App.oxe?raw';
import asyncGranularSource from '../../../examples/async-granular/App.oxe?raw';
import asyncIdentityRefreshSource from '../../../examples/async-identity-refresh/App.oxe?raw';
import asyncPropsSource from '../../../examples/async-props/App.oxe?raw';
import asyncStructuralSource from '../../../examples/async-structural/App.oxe?raw';
import asyncCollectionSource from '../../../examples/async-collection/App.oxe?raw';
import asyncErrorSource from '../../../examples/async-error/App.oxe?raw';

import type { PlaygroundCapabilitySet } from './demo-capabilities.js';

export const exampleGroups = [
  'Basics',
  'Async data',
  'Components',
  'Reactivity',
  'Diagnostics',
] as const;

export type ExampleGroup = (typeof exampleGroups)[number];

export interface PlaygroundFile {
  readonly moduleId: string;
  readonly source: string;
}

export interface PlaygroundExample {
  readonly capabilitySet?: PlaygroundCapabilitySet;
  readonly description: string;
  readonly entryExport: string;
  readonly entryModuleId: string;
  readonly files: readonly PlaygroundFile[];
  readonly group: ExampleGroup;
  readonly id: string;
  readonly intentionallyInvalid?: boolean;
  readonly label: string;
}

const singleFileExample = (
  example: Omit<PlaygroundExample, 'entryExport' | 'entryModuleId' | 'files'> & PlaygroundFile,
): PlaygroundExample => ({
  id: example.id,
  label: example.label,
  group: example.group,
  description: example.description,
  ...(example.capabilitySet ? { capabilitySet: example.capabilitySet } : {}),
  ...(example.intentionallyInvalid === undefined
    ? {}
    : { intentionallyInvalid: example.intentionallyInvalid }),
  entryExport: 'App',
  entryModuleId: example.moduleId,
  files: [{ moduleId: example.moduleId, source: example.source }],
});

export const examples: readonly PlaygroundExample[] = [
  singleFileExample({
    id: 'async-structural',
    label: 'Localized loading skeleton',
    group: 'Async data',
    description: 'Only the async structural consumer receives a compiler-derived inert skeleton.',
    moduleId: 'examples/async-structural/App.oxe',
    source: asyncStructuralSource,
    capabilitySet: 'async-users',
  }),
  singleFileExample({
    id: 'async-collection',
    label: 'Async collection rows',
    group: 'Async data',
    description:
      'An async keyed collection starts with one skeleton row, then creates row-local requests.',
    moduleId: 'examples/async-collection/App.oxe',
    source: asyncCollectionSource,
    capabilitySet: 'async-users',
  }),
  singleFileExample({
    id: 'async-error',
    label: 'Global async error',
    group: 'Async data',
    description: 'Failures report globally without rendering private Error strings into content.',
    moduleId: 'examples/async-error/App.oxe',
    source: asyncErrorSource,
    capabilitySet: 'async-users',
  }),
  singleFileExample({
    id: 'async-granular',
    label: 'Granular async fields',
    group: 'Async data',
    description:
      'Static UI appears immediately while only async field consumers show placeholders.',
    moduleId: 'examples/async-granular/App.oxe',
    source: asyncGranularSource,
    capabilitySet: 'async-users',
  }),
  singleFileExample({
    id: 'async-dedupe',
    label: 'Shared request dedupe',
    group: 'Async data',
    description: 'Equal capability identities share one request across disconnected consumers.',
    moduleId: 'examples/async-dedupe/App.oxe',
    source: asyncDedupeSource,
    capabilitySet: 'async-users',
  }),
  singleFileExample({
    id: 'async-identity-refresh',
    label: 'Identity and refresh',
    group: 'Async data',
    description: 'Identity changes cancel stale work; refresh retains the previous ready value.',
    moduleId: 'examples/async-identity-refresh/App.oxe',
    source: asyncIdentityRefreshSource,
    capabilitySet: 'async-users',
  }),
  singleFileExample({
    id: 'async-props',
    label: 'Async component props',
    group: 'Async data',
    description: 'Async lineage crosses component props without an authored resource wrapper.',
    moduleId: 'examples/async-props/App.oxe',
    source: asyncPropsSource,
    capabilitySet: 'async-users',
  }),
  singleFileExample({
    id: 'conditional-region',
    label: 'Conditional region',
    group: 'Reactivity',
    description: 'Incremental branch replacement with deterministic owner cleanup.',
    moduleId: 'examples/conditional-region/App.oxe',
    source: conditionalRegionSource,
  }),
  singleFileExample({
    id: 'content-values',
    label: 'Content values',
    group: 'Reactivity',
    description: 'Ownership-safe captured markup instantiated independently at each placement.',
    moduleId: 'examples/content-values/App.oxe',
    source: contentValuesSource,
  }),
  singleFileExample({
    id: 'conditional-values',
    label: 'Conditional values',
    group: 'Reactivity',
    description: 'Inline and multi-arm value choices that update as derived relationships.',
    moduleId: 'examples/conditional-values/App.oxe',
    source: conditionalValuesSource,
  }),
  singleFileExample({
    id: 'expression-values',
    label: 'Records and collections',
    group: 'Basics',
    description: 'Reactive records plus add, update, remove, filter, and pure stable sorting.',
    moduleId: 'examples/expression-values/App.oxe',
    source: expressionValuesSource,
  }),
  singleFileExample({
    id: 'counter',
    label: 'Counter',
    group: 'Basics',
    description: 'Writable state, a derived value, and a click handler.',
    moduleId: 'examples/counter/App.oxe',
    source: counterSource,
  }),
  singleFileExample({
    id: 'static',
    label: 'Static markup',
    group: 'Basics',
    description: 'Compile-time constants rendered into a simple document.',
    moduleId: 'examples/static/App.oxe',
    source: staticSource,
  }),
  singleFileExample({
    id: 'dom-attributes',
    label: 'DOM attributes',
    group: 'Basics',
    description: 'Static attributes, reactive attributes, and typed property assignment.',
    moduleId: 'examples/dom-attributes/App.oxe',
    source: domAttributesSource,
  }),
  singleFileExample({
    id: 'component-composition',
    label: 'Component composition',
    group: 'Components',
    description: 'Reactive value props, a procedure capability, and child ownership.',
    moduleId: 'examples/component-composition/App.oxe',
    source: componentCompositionSource,
  }),
  singleFileExample({
    id: 'composition-features',
    label: 'Composition features',
    group: 'Components',
    description:
      'Defaults, rest props, spread forwarding, implicit children, and reactive updates.',
    moduleId: 'examples/composition-features/App.oxe',
    source: compositionFeaturesSource,
  }),
  singleFileExample({
    id: 'context',
    label: 'Context',
    group: 'Components',
    description: 'Provider-scoped shared state with reactive field updates in a descendant.',
    moduleId: 'examples/context/App.oxe',
    source: contextSource,
  }),
  {
    id: 'component-modules',
    label: 'Component modules',
    group: 'Components',
    description: 'Named imports and direct exports across a fixed two-file project.',
    entryExport: 'App',
    entryModuleId: 'examples/component-modules/App.oxe',
    files: [
      {
        moduleId: 'examples/component-modules/App.oxe',
        source: componentModulesAppSource,
      },
      {
        moduleId: 'examples/component-modules/Card.oxe',
        source: componentModulesCardSource,
      },
    ],
  },
  singleFileExample({
    id: 'derived',
    label: 'Derived values',
    group: 'Reactivity',
    description: 'Two computations update from the same writable value.',
    moduleId: 'examples/derived/App.oxe',
    source: derivedSource,
  }),
  singleFileExample({
    id: 'batched',
    label: 'Batched writes',
    group: 'Reactivity',
    description: 'One event updates two cells before reactive work flushes.',
    moduleId: 'examples/batched/App.oxe',
    source: batchedSource,
  }),
  singleFileExample({
    id: 'keyed-collection',
    label: 'Keyed collection',
    group: 'Reactivity',
    description: 'Keyed insertion, movement, removal, row reuse, and disposal.',
    moduleId: 'examples/keyed-collection/App.oxe',
    source: keyedCollectionSource,
  }),
  singleFileExample({
    id: 'untrack-snapshot',
    label: 'Untrack snapshot',
    group: 'Reactivity',
    description: 'A deliberate snapshot read excluded from reactive dependencies.',
    moduleId: 'examples/untrack-snapshot/App.oxe',
    source: untrackSnapshotSource,
  }),
  singleFileExample({
    id: 'unknown-name',
    label: 'Unknown name',
    group: 'Diagnostics',
    description: 'An unresolved identifier demonstrates exact source spans.',
    moduleId: 'examples/diagnostics-unknown-name/App.oxe',
    source: unknownNameSource,
    intentionallyInvalid: true,
  }),
  singleFileExample({
    id: 'missing-context-provider',
    label: 'Missing context provider',
    group: 'Diagnostics',
    description: 'A context read without an ancestor provider produces a source diagnostic.',
    moduleId: 'examples/diagnostics-missing-context-provider/App.oxe',
    source: missingContextProviderSource,
    intentionallyInvalid: true,
  }),
  singleFileExample({
    id: 'dependency-cycle',
    label: 'Dependency cycle',
    group: 'Diagnostics',
    description: 'A reactive cycle demonstrates related semantic diagnostics.',
    moduleId: 'examples/diagnostics-cycle/App.oxe',
    source: cycleSource,
    intentionallyInvalid: true,
  }),
  singleFileExample({
    id: 'type-error',
    label: 'Type error',
    group: 'Diagnostics',
    description: 'A procedure attempts to write a string into a number cell.',
    moduleId: 'examples/diagnostics-type-error/App.oxe',
    source: typeErrorSource,
    intentionallyInvalid: true,
  }),
] as const;

export const defaultExample = examples[0];

export const findExample = (id: string): PlaygroundExample | undefined =>
  examples.find((example) => example.id === id);
