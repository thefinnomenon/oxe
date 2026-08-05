import * as runtimeDom from '@oxe/runtime-dom';
import * as runtime from '@oxe/runtime';
import { createI18n, type LocaleCatalog } from '@oxe/i18n/runtime';

import enCatalog from '../../../examples/localization/locales/en-US.json';
import esCatalog from '../../../examples/localization/locales/es.json';
import frCatalog from '../../../examples/localization/locales/fr.json';
import itCatalog from '../../../examples/localization/locales/it.json';
import ptCatalog from '../../../examples/localization/locales/pt.json';
import {
  createBrowserRouter,
  createDomRouteSegmentArtifact,
  createDomSegmentTransition,
  type DomRouteSegmentBuildContext,
  type DomRouteSegmentContent,
  type OxeRouter,
} from '@oxe/router';

import type { PlaygroundCapabilitySet } from './demo-capabilities.js';

import {
  OXE_PLAYGROUND_PROTOCOL_VERSION,
  isPreviewCommand,
  serializeError,
  type MutationCounts,
  type PreviewCommand,
  type PreviewConsoleEvent,
  type PreviewConsoleLevel,
  type PreviewErrorPhase,
  type PreviewEvent,
  type PreviewMountCommand,
} from './protocol.js';
import './preview.css';

type GeneratedExports = Readonly<Record<string, unknown>>;
type GeneratedFactory = (runtimeApi: typeof runtime, domApi: typeof runtimeDom) => GeneratedExports;

const previewRoot = document.querySelector<HTMLElement>('#oxe-preview-root');
if (!previewRoot) {
  throw new Error('The OXE preview root is missing.');
}

const expectedParentOrigin = new URL(document.referrer || window.location.href).origin;
let activeMount: { unmount(): void } | undefined;
let activeRunId: number | null = null;
let commandSequence = 0;
let mutationObserver: MutationObserver | undefined;
let reactiveTraceSubscription: runtime.Disposable | undefined;
let ownershipSubscription: runtime.Disposable | undefined;
let counts: MutationCounts = emptyMutationCounts();

interface DemoUser {
  readonly active: boolean;
  readonly avatar: string;
  readonly email: string;
  readonly name: string;
  readonly request: number;
  readonly role: string;
  readonly updatedAt: string;
}

let demoRequestSequence = 0;

const demoUsers = [
  {
    color: '#6857d9',
    email: 'ada@example.test',
    initials: 'AL',
    name: 'Ada Lovelace',
    role: 'Compiler engineer',
  },
  {
    color: '#147d64',
    email: 'grace@example.test',
    initials: 'GH',
    name: 'Grace Hopper',
    role: 'Systems pioneer',
  },
  {
    color: '#b45309',
    email: 'margaret@example.test',
    initials: 'MH',
    name: 'Margaret Hamilton',
    role: 'Reliability lead',
  },
  {
    color: '#be3f5f',
    email: 'radia@example.test',
    initials: 'RP',
    name: 'Radia Perlman',
    role: 'Network architect',
  },
] as const;

const avatarDataUrl = (initials: string, color: string): string => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="${color}"/><text x="48" y="57" text-anchor="middle" font-family="system-ui,sans-serif" font-size="30" font-weight="700" fill="white">${initials}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

const loadDemoUser = (id: number, signal?: AbortSignal): Promise<DemoUser> => {
  const request = ++demoRequestSequence;
  const index = Math.abs(Math.trunc(id) - 1) % demoUsers.length;
  const user = demoUsers[index] ?? demoUsers[0];
  const delay = 650 + index * 180;
  console.info(`async request #${request}: user ${id} (${delay}ms)`);
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The async request was cancelled.', 'AbortError'));
      return;
    }
    const timeout = window.setTimeout(() => {
      console.info(`async response #${request}: ${user.name}`);
      resolve({
        active: true,
        avatar: avatarDataUrl(user.initials, user.color),
        email: user.email,
        name: user.name,
        request,
        role: user.role,
        updatedAt: new Date().toLocaleTimeString(),
      });
    }, delay);
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeout);
        console.info(`async cancellation #${request}: user ${id}`);
        reject(new DOMException('The async request was cancelled.', 'AbortError'));
      },
      { once: true },
    );
  });
};

const installDemoCapabilities = (set: PlaygroundCapabilitySet | undefined): void => {
  demoRequestSequence = 0;
  if (set !== 'async-users') {
    Reflect.deleteProperty(globalThis, 'playground');
    return;
  }
  Object.defineProperty(globalThis, 'playground', {
    configurable: true,
    value: Object.freeze({
      listUserIds: (signal?: AbortSignal) =>
        new Promise<readonly number[]>((resolve, reject) => {
          const timeout = window.setTimeout(() => resolve([1, 2, 3]), 900);
          signal?.addEventListener(
            'abort',
            () => {
              window.clearTimeout(timeout);
              reject(new DOMException('The async request was cancelled.', 'AbortError'));
            },
            { once: true },
          );
        }),
      loadUser: (id: number, signal?: AbortSignal) =>
        id === 404
          ? Promise.reject(new runtime.OxeAsyncFailure('not-found', 'Demo user 404 was not found.'))
          : loadDemoUser(id, signal),
    }),
  });
};

function emptyMutationCounts(): MutationCounts {
  return { addedNodes: 0, attributes: 0, characterData: 0, childList: 0, removedNodes: 0 };
}

const postToParent = (message: PreviewEvent): void => {
  window.parent.postMessage(message, expectedParentOrigin);
};

const postError = (phase: PreviewErrorPhase, error: unknown, runId = activeRunId): void => {
  postToParent({
    type: 'preview:error',
    version: OXE_PLAYGROUND_PROTOCOL_VERSION,
    runId,
    phase,
    error: serializeError(error),
  });
};

const truncate = (value: string): string =>
  value.length <= 10_000 ? value : `${value.slice(0, 10_000)}…`;

const formatConsoleArgument = (value: unknown): string => {
  if (typeof value === 'string') {
    return truncate(value);
  }
  if (value instanceof Error) {
    return truncate(value.stack ?? `${value.name}: ${value.message}`);
  }
  if (value instanceof Node) {
    return `<${value.nodeName.toLowerCase()}>`;
  }

  const seen = new WeakSet<object>();
  try {
    const serialized = JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === 'bigint') {
        return `${item.toString()}n`;
      }
      if (typeof item === 'function') {
        return `[Function ${item.name || 'anonymous'}]`;
      }
      if (typeof item === 'symbol') {
        return item.toString();
      }
      if (typeof item === 'object' && item !== null) {
        if (seen.has(item)) {
          return '[Circular]';
        }
        seen.add(item);
      }
      return item;
    });
    return truncate(serialized ?? String(value));
  } catch {
    return truncate(String(value));
  }
};

const emitConsole = (level: PreviewConsoleLevel, values: readonly unknown[]): void => {
  const message: PreviewConsoleEvent = {
    type: 'preview:console',
    version: OXE_PLAYGROUND_PROTOCOL_VERSION,
    runId: activeRunId,
    level,
    arguments: values.map(formatConsoleArgument),
    timestamp: Date.now(),
  };
  postToParent(message);
};

const originalConsole = {
  debug: console.debug.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
  log: console.log.bind(console),
  warn: console.warn.bind(console),
};

console.debug = (...values: unknown[]): void => {
  originalConsole.debug(...values);
  emitConsole('debug', values);
};
console.error = (...values: unknown[]): void => {
  originalConsole.error(...values);
  emitConsole('error', values);
};
console.info = (...values: unknown[]): void => {
  originalConsole.info(...values);
  emitConsole('info', values);
};
console.log = (...values: unknown[]): void => {
  originalConsole.log(...values);
  emitConsole('log', values);
};
console.warn = (...values: unknown[]): void => {
  originalConsole.warn(...values);
  emitConsole('warn', values);
};

const postMutations = (runId: number): void => {
  postToParent({
    type: 'preview:mutations',
    version: OXE_PLAYGROUND_PROTOCOL_VERSION,
    runId,
    counts,
  });
};

const stopReactivity = (): void => {
  reactiveTraceSubscription?.dispose();
  reactiveTraceSubscription = undefined;
};

const stopOwnership = (): void => {
  ownershipSubscription?.dispose();
  ownershipSubscription = undefined;
};

const observeReactivity = (runId: number): void => {
  stopReactivity();
  reactiveTraceSubscription = runtime.subscribeReactiveTrace((event) => {
    if (activeRunId !== runId) {
      return;
    }
    postToParent({
      type: 'preview:reactivity',
      version: OXE_PLAYGROUND_PROTOCOL_VERSION,
      runId,
      event,
    });
  });
};

const observeOwnership = (runId: number): void => {
  stopOwnership();
  ownershipSubscription = runtime.subscribeOwnershipSnapshots((snapshot) => {
    if (activeRunId !== runId) {
      return;
    }
    postToParent({
      type: 'preview:ownership',
      version: OXE_PLAYGROUND_PROTOCOL_VERSION,
      runId,
      snapshot,
    });
  });
};

const resetPostMountMutations = (runId: number): void => {
  mutationObserver?.takeRecords();
  counts = emptyMutationCounts();
  postMutations(runId);
};

const observeMutations = (runId: number): void => {
  mutationObserver?.disconnect();
  counts = emptyMutationCounts();
  mutationObserver = new MutationObserver((records) => {
    if (activeRunId !== runId) {
      return;
    }
    for (const record of records) {
      switch (record.type) {
        case 'attributes':
          counts = { ...counts, attributes: counts.attributes + 1 };
          break;
        case 'characterData':
          counts = { ...counts, characterData: counts.characterData + 1 };
          break;
        case 'childList':
          counts = {
            ...counts,
            childList: counts.childList + 1,
            addedNodes: counts.addedNodes + record.addedNodes.length,
            removedNodes: counts.removedNodes + record.removedNodes.length,
          };
          break;
      }
    }
    postMutations(runId);
  });
  mutationObserver.observe(previewRoot, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
  postMutations(runId);
};

const unmountActive = (runId: number | null): boolean => {
  if (!activeMount) {
    return true;
  }
  const mount = activeMount;
  activeMount = undefined;
  try {
    mount.unmount();
    return true;
  } catch (error) {
    postError('unmount', error, runId);
    return false;
  }
};

const clearPreview = (command: PreviewCommand): void => {
  commandSequence += 1;
  const previousRunId = activeRunId;
  mutationObserver?.disconnect();
  mutationObserver = undefined;
  unmountActive(previousRunId);
  stopReactivity();
  stopOwnership();
  activeRunId = command.runId;
  previewRoot.replaceChildren();
  observeOwnership(command.runId);
};

const inlineSourceMap = (
  sourceMap: NonNullable<PreviewMountCommand['factorySourceMap']>,
): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(sourceMap));
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const importFactory = async (
  source: string,
  runId: number,
  sourceMap?: PreviewMountCommand['factorySourceMap'],
  label = 'app',
): Promise<GeneratedFactory> => {
  const moduleSource =
    `export default ${source.trim()}\n` +
    `//# sourceURL=oxe-playground-run-${runId.toString()}-${label}.generated.js\n` +
    (sourceMap
      ? `//# sourceMappingURL=data:application/json;base64,${inlineSourceMap(sourceMap)}\n`
      : '');
  const url = URL.createObjectURL(new Blob([moduleSource], { type: 'text/javascript' }));
  try {
    const generatedModule: unknown = await import(/* @vite-ignore */ url);
    if (
      typeof generatedModule !== 'object' ||
      generatedModule === null ||
      !('default' in generatedModule) ||
      typeof generatedModule.default !== 'function'
    ) {
      throw new TypeError('Generated OXE code did not export a factory function.');
    }
    return generatedModule.default as GeneratedFactory;
  } finally {
    URL.revokeObjectURL(url);
  }
};

const mountPreview = async (
  command: Extract<PreviewCommand, { readonly type: 'preview:mount' }>,
): Promise<void> => {
  const sequence = ++commandSequence;
  const previousRunId = activeRunId;
  mutationObserver?.disconnect();
  unmountActive(previousRunId);
  stopReactivity();
  stopOwnership();
  activeRunId = command.runId;
  previewRoot.replaceChildren();
  observeOwnership(command.runId);
  installDemoCapabilities(command.capabilitySet);
  const i18n = command.localization
    ? createI18n({
        catalogs: [enCatalog, esCatalog, frCatalog, itCatalog, ptCatalog] as LocaleCatalog[],
        locale: 'es',
      })
    : undefined;

  if (command.routeBundle) {
    const specifications = new Map(
      command.routeBundle.segments.map((segment) => [segment.id, segment]),
    );
    const generated = new Map<string, Promise<GeneratedExports>>();
    let routeRouter: OxeRouter | undefined;
    const requireRouter = (): OxeRouter => {
      if (!routeRouter) throw new Error('The playground route runtime is not ready.');
      return routeRouter;
    };
    const navigation = {
      navigate: (to: string, options?: Parameters<OxeRouter['navigate']>[1]) =>
        requireRouter().navigate(to, options),
      setSearchParams: (
        updates: Parameters<OxeRouter['setSearchParams']>[0],
        options?: Parameters<OxeRouter['setSearchParams']>[1],
      ) => requireRouter().setSearchParams(updates, options),
    };
    const transition = createDomSegmentTransition(
      previewRoot,
      async (definition) => {
        const specification = specifications.get(definition.id);
        if (!specification) throw new Error(`Missing generated route segment ${definition.id}.`);
        let loading = generated.get(definition.id);
        if (!loading) {
          loading = importFactory(
            specification.factorySource,
            command.runId,
            undefined,
            encodeURIComponent(definition.id),
          ).then((factory) => factory(runtime, runtimeDom));
          generated.set(definition.id, loading);
        }
        const exports = await loading;
        const build = exports[specification.routeSegmentExport];
        if (typeof build !== 'function') {
          throw new TypeError(
            `Generated route code did not export ${JSON.stringify(specification.routeSegmentExport)}.`,
          );
        }
        const segmentBuilder = build as (
          context: DomRouteSegmentBuildContext,
        ) => DomRouteSegmentContent;
        return createDomRouteSegmentArtifact({
          build: (context) => segmentBuilder({ ...context, ...(i18n ? { i18n } : {}) }),
          id: definition.id,
          kind: definition.kind,
          navigation,
        });
      },
      { onError: (error) => postError('runtime', error, command.runId) },
    );
    observeMutations(command.runId);
    observeReactivity(command.runId);
    const startedAt = performance.now();
    try {
      window.history.replaceState(null, '', command.routeBundle.initialHref);
      routeRouter = createBrowserRouter(command.routeBundle.manifest, {
        hydrateSnapshot: false,
        onError: (error) => postError('runtime', error, command.runId),
        transition,
        window,
      });
      const initial = routeRouter.snapshot.read();
      const prepared = await transition.prepare(initial, new AbortController().signal);
      if (sequence !== commandSequence) {
        prepared.cancel();
        routeRouter.dispose();
        transition.dispose();
        return;
      }
      prepared.commit(initial);
      activeMount = {
        unmount: () => {
          routeRouter?.dispose();
          transition.dispose();
        },
      };
      resetPostMountMutations(command.runId);
    } catch (error) {
      mutationObserver?.disconnect();
      mutationObserver = undefined;
      stopReactivity();
      routeRouter?.dispose();
      transition.dispose();
      postError('mount', error, command.runId);
      return;
    }
    postToParent({
      type: 'preview:mounted',
      version: OXE_PLAYGROUND_PROTOCOL_VERSION,
      runId: command.runId,
      mountMilliseconds: performance.now() - startedAt,
    });
    return;
  }

  if (!command.factorySource || !command.mountExport) {
    postError('protocol', new TypeError('The preview mount command has no generated entry.'));
    return;
  }

  let createGenerated: GeneratedFactory;
  try {
    createGenerated = await importFactory(
      command.factorySource,
      command.runId,
      command.factorySourceMap,
    );
  } catch (error) {
    if (sequence === commandSequence) {
      postError('import', error, command.runId);
    }
    return;
  }

  if (sequence !== commandSequence) {
    return;
  }

  let generated: GeneratedExports;
  try {
    generated = createGenerated(runtime, runtimeDom);
  } catch (error) {
    postError('factory', error, command.runId);
    return;
  }

  const mount = generated[command.mountExport];
  if (typeof mount !== 'function') {
    postError(
      'factory',
      new TypeError(`Generated OXE code did not export ${JSON.stringify(command.mountExport)}.`),
      command.runId,
    );
    return;
  }

  observeMutations(command.runId);
  observeReactivity(command.runId);
  const startedAt = performance.now();
  try {
    const result: unknown = mount(previewRoot, {
      ...(i18n ? { i18n } : {}),
      onError: (error: unknown) => postError('runtime', error, command.runId),
    });
    if (
      typeof result !== 'object' ||
      result === null ||
      !('unmount' in result) ||
      typeof result.unmount !== 'function'
    ) {
      throw new TypeError('The generated mount function did not return an OXE mount handle.');
    }
    activeMount = result as runtimeDom.MountHandle;
    resetPostMountMutations(command.runId);
  } catch (error) {
    mutationObserver?.disconnect();
    mutationObserver = undefined;
    stopReactivity();
    postError('mount', error, command.runId);
    return;
  }

  postToParent({
    type: 'preview:mounted',
    version: OXE_PLAYGROUND_PROTOCOL_VERSION,
    runId: command.runId,
    mountMilliseconds: performance.now() - startedAt,
  });
};

window.addEventListener('error', (event) => {
  postError('runtime', event.error ?? new Error(event.message));
});

window.addEventListener('unhandledrejection', (event) => {
  postError('runtime', event.reason);
});

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window.parent || event.origin !== expectedParentOrigin) {
    return;
  }
  if (!isPreviewCommand(event.data)) {
    postError('protocol', new TypeError('Received an invalid preview command.'));
    return;
  }
  if (activeRunId !== null && event.data.runId < activeRunId) {
    return;
  }

  if (event.data.type === 'preview:clear') {
    clearPreview(event.data);
  } else {
    void mountPreview(event.data);
  }
});

postToParent({
  type: 'preview:ready',
  version: OXE_PLAYGROUND_PROTOCOL_VERSION,
});
