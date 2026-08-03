import * as runtimeDom from '@oxe/runtime-dom';
import * as runtime from '@oxe/runtime';

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
} from './protocol.js';
import './preview.css';

type GeneratedExports = Readonly<Record<string, unknown>>;
type GeneratedFactory = (runtimeApi: typeof runtime, domApi: typeof runtimeDom) => GeneratedExports;

const previewRoot = document.querySelector<HTMLElement>('#oxe-preview-root');
if (!previewRoot) {
  throw new Error('The OXE preview root is missing.');
}

const expectedParentOrigin = new URL(document.referrer || window.location.href).origin;
let activeMount: runtimeDom.MountHandle | undefined;
let activeRunId: number | null = null;
let commandSequence = 0;
let mutationObserver: MutationObserver | undefined;
let counts: MutationCounts = emptyMutationCounts();

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
  activeRunId = command.runId;
  mutationObserver?.disconnect();
  mutationObserver = undefined;
  unmountActive(command.runId);
  previewRoot.replaceChildren();
};

const importFactory = async (source: string, runId: number): Promise<GeneratedFactory> => {
  const moduleSource =
    `export default ${source.trim()}\n` +
    `//# sourceURL=oxe-playground-run-${runId.toString()}.generated.js\n`;
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
  activeRunId = command.runId;
  mutationObserver?.disconnect();
  unmountActive(command.runId);
  previewRoot.replaceChildren();

  let createGenerated: GeneratedFactory;
  try {
    createGenerated = await importFactory(command.factorySource, command.runId);
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
  const startedAt = performance.now();
  try {
    const result: unknown = mount(previewRoot);
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
