import type { NodeIdV1, UiGraphV1 } from '@oxe/graph';
import type { OwnershipOwnerSnapshot, OwnershipSnapshot, ReactiveTraceEvent } from '@oxe/runtime';

import {
  defaultExample,
  exampleGroups,
  examples,
  findExample,
  type PlaygroundExample,
} from './examples.js';
import {
  buildGraphInspectorModel,
  graphNodeLabel,
  type GraphInspectorReference,
} from './graph-inspector.js';
import {
  OXE_PLAYGROUND_PROTOCOL_VERSION,
  isCompileResult,
  isPreviewEvent,
  type CompileResult,
  type MutationCounts,
  type PreviewConsoleEvent,
  type PreviewErrorEvent,
} from './protocol.js';
import {
  OXE_SIZE_ENDPOINT,
  type OxeSizeFailure,
  type OxeSizeReport,
  type OxeSizeResponse,
} from './size-types.js';
import './styles.css';

type OutputTab =
  | 'preview'
  | 'diagnostics'
  | 'console'
  | 'reactivity'
  | 'ownership'
  | 'generated'
  | 'graph'
  | 'ast'
  | 'tokens'
  | 'size';

type MobilePanel = 'output' | 'source';

interface SizeState {
  readonly exact: boolean;
  readonly message?: string;
  readonly report?: OxeSizeReport;
  readonly sourceBytes?: number;
  readonly sourceGzipBytes?: number;
  readonly status: 'error' | 'idle' | 'loading' | 'ready' | 'stale';
}

const tabs: readonly { readonly id: OutputTab; readonly label: string }[] = [
  { id: 'preview', label: 'Preview' },
  { id: 'diagnostics', label: 'Diagnostics' },
  { id: 'console', label: 'Console' },
  { id: 'reactivity', label: 'Reactivity' },
  { id: 'ownership', label: 'Ownership' },
  { id: 'generated', label: 'Generated JS' },
  { id: 'graph', label: 'Graph' },
  { id: 'ast', label: 'AST' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'size', label: 'Size' },
];

const emptyMutations = (): MutationCounts => ({
  addedNodes: 0,
  attributes: 0,
  characterData: 0,
  childList: 0,
  removedNodes: 0,
});

const applicationRoot = document.querySelector('#app');
if (!(applicationRoot instanceof HTMLElement)) {
  throw new Error('The OXE playground root is missing.');
}

applicationRoot.innerHTML = `
  <main class="playground-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">OXE</div>
        <div class="brand-copy">
          <h1>OXE Playground</h1>
          <p>Compiler, graph, runtime, and payload lab</p>
        </div>
      </div>

      <div class="example-picker">
        <label class="field-label" for="example-select">Example</label>
        <select class="select-control" id="example-select"></select>
        <p class="example-description" id="example-description"></p>
      </div>

      <div class="top-actions">
        <button class="button" id="size-shortcut" type="button" title="Open the payload size report">
          <span id="size-shortcut-label">Size pending</span>
        </button>
        <button class="button" id="reset-button" type="button">Reset file</button>
        <button class="button button-primary" id="run-button" type="button">
          Run <span class="button-label-optional">⌘↵</span>
        </button>
      </div>
    </header>

    <nav class="mobile-switcher" aria-label="Playground panels">
      <button class="mobile-panel-button" data-mobile-target="source" aria-pressed="true" type="button">Source</button>
      <button class="mobile-panel-button" data-mobile-target="output" aria-pressed="false" type="button">Output</button>
    </nav>

    <div class="workspace" id="workspace" data-mobile-panel="source">
      <section class="panel source-panel" aria-labelledby="source-heading">
        <header class="panel-header source-header">
          <h2 class="sr-only" id="source-heading">Project files</h2>
          <div class="file-tab-list" id="file-tab-list" role="tablist" aria-label="Project files"></div>
          <div class="panel-actions">
            <button class="button" id="copy-source-button" type="button">Copy source</button>
          </div>
        </header>
        <div class="editor-shell" id="source-editor-panel" role="tabpanel">
          <pre class="line-gutter" id="line-gutter" aria-hidden="true">1</pre>
          <textarea
            class="source-editor"
            id="source-editor"
            aria-label="OXE source code"
            autocapitalize="off"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
          ></textarea>
        </div>
        <footer class="editor-footer">
          <span>Two-space indentation</span>
          <span><kbd>Esc</kbd> then <kbd>Tab</kbd> leaves the editor</span>
        </footer>
      </section>

      <div
        class="splitter"
        id="splitter"
        role="separator"
        aria-label="Resize source and output panels"
        aria-orientation="vertical"
        aria-valuemin="30"
        aria-valuemax="70"
        aria-valuenow="54"
        tabindex="0"
      ></div>

      <section class="panel output-panel" aria-label="Compiler and runtime output">
        <header class="panel-header output-header">
          <div class="tab-list" role="tablist" aria-label="Output views" id="tab-list"></div>
          <label class="viewport-control">
            <span>Viewport</span>
            <select class="select-control" id="viewport-select">
              <option value="fluid">Fluid</option>
              <option value="390">Phone · 390</option>
              <option value="768">Tablet · 768</option>
            </select>
          </label>
        </header>

        <div class="output-body">
          <section class="output-pane preview-pane" id="pane-preview" role="tabpanel" data-active="true">
            <div class="preview-canvas">
              <div class="preview-frame-shell" id="preview-frame-shell">
                <iframe
                  class="preview-frame"
                  id="preview-frame"
                  src="./preview.html"
                  sandbox="allow-scripts allow-same-origin"
                  title="OXE generated application preview"
                ></iframe>
                <div class="preview-overlay" id="preview-overlay" role="status" aria-live="polite">
                  <div class="preview-overlay-card" id="preview-overlay-message">Compiling the example…</div>
                </div>
              </div>
            </div>
          </section>

          <section class="output-pane" id="pane-diagnostics" role="tabpanel">
            <div class="pane-scroll">
              <div class="pane-toolbar">
                <div>
                  <h2 class="pane-title">Diagnostics</h2>
                  <span class="pane-hint">Select an error to reveal its exact source span.</span>
                </div>
              </div>
              <ol class="diagnostic-list" id="diagnostic-list"></ol>
            </div>
          </section>

          <section class="output-pane" id="pane-console" role="tabpanel">
            <div class="pane-scroll">
              <div class="pane-toolbar">
                <div>
                  <h2 class="pane-title">Preview console</h2>
                  <span class="pane-hint">Forwarded logs, runtime failures, and unhandled rejections.</span>
                </div>
                <button class="button" id="clear-console-button" type="button">Clear</button>
              </div>
              <ol class="console-list" id="console-list"></ol>
            </div>
          </section>

          <section class="output-pane" id="pane-reactivity" role="tabpanel">
            <div class="pane-scroll">
              <div class="pane-toolbar">
                <div>
                  <h2 class="pane-title">Reactivity explanations</h2>
                  <span class="pane-hint">Writes, exact invalidating paths, executed computations, and equality-suppressed work.</span>
                </div>
                <button class="button" id="clear-reactivity-button" type="button">Clear</button>
              </div>
              <ol class="trace-list" id="reactivity-list" aria-live="polite"></ol>
            </div>
          </section>

          <section class="output-pane" id="pane-ownership" role="tabpanel">
            <div class="pane-scroll">
              <div class="pane-toolbar">
                <div>
                  <h2 class="pane-title">Live ownership</h2>
                  <span class="pane-hint">Owners and cleanup-bound resources retained by the current preview. Both counts should return to zero after unmount.</span>
                </div>
              </div>
              <div class="ownership-summary metrics-grid" id="ownership-summary"></div>
              <ol class="ownership-list" id="ownership-list" aria-live="polite"></ol>
            </div>
          </section>

          <section class="output-pane" id="pane-generated" role="tabpanel">
            <pre class="code-output" id="generated-output" tabindex="0"></pre>
          </section>

          <section class="output-pane" id="pane-graph" role="tabpanel">
            <div class="pane-scroll">
              <div class="graph-summary" id="graph-summary"></div>
              <div class="graph-browser">
                <div class="graph-node-column">
                  <h2 class="sr-only">Semantic graph nodes</h2>
                  <ol class="graph-node-list" id="graph-node-list"></ol>
                </div>
                <aside
                  class="graph-inspector"
                  id="graph-inspector"
                  aria-label="Selected graph node"
                  aria-live="polite"
                ></aside>
              </div>
              <details>
                <summary class="pane-hint">Raw semantic graph JSON</summary>
                <pre class="code-output" id="graph-output" tabindex="0"></pre>
              </details>
            </div>
          </section>

          <section class="output-pane" id="pane-ast" role="tabpanel">
            <pre class="code-output" id="ast-output" tabindex="0"></pre>
          </section>

          <section class="output-pane" id="pane-tokens" role="tabpanel">
            <pre class="code-output" id="tokens-output" tabindex="0"></pre>
          </section>

          <section class="output-pane" id="pane-size" role="tabpanel">
            <div class="pane-scroll" id="size-content"></div>
          </section>
        </div>
      </section>
    </div>

    <footer class="statusbar" aria-live="polite">
      <div class="status-cluster">
        <span class="status-pill" id="compile-status" data-tone="working">Compiling</span>
        <span class="status-pill status-hide-mobile" id="compile-time">Compile —</span>
        <span class="status-pill status-hide-mobile" id="mount-time">Mount —</span>
        <span class="status-pill" id="graph-status">Graph —</span>
        <span class="status-pill" id="mutation-status">DOM mutations —</span>
      </div>
      <button class="button" id="copy-debug-button" type="button">Copy debug report</button>
    </footer>
  </main>
  <div class="toast" id="toast" role="status" hidden></div>
`;

type ElementConstructor<T extends Element> = new () => T;

const requireElement = <T extends Element>(
  selector: string,
  constructor: ElementConstructor<T>,
): T => {
  const element = document.querySelector(selector);
  if (!(element instanceof constructor)) {
    throw new Error(`Required playground element ${selector} is missing.`);
  }
  return element;
};

const editor = requireElement('#source-editor', HTMLTextAreaElement);
const lineGutter = requireElement('#line-gutter', HTMLPreElement);
const exampleSelect = requireElement('#example-select', HTMLSelectElement);
const exampleDescription = requireElement('#example-description', HTMLParagraphElement);
const fileTabList = requireElement('#file-tab-list', HTMLDivElement);
const sourceEditorPanel = requireElement('#source-editor-panel', HTMLDivElement);
const runButton = requireElement('#run-button', HTMLButtonElement);
const resetButton = requireElement('#reset-button', HTMLButtonElement);
const copySourceButton = requireElement('#copy-source-button', HTMLButtonElement);
const copyDebugButton = requireElement('#copy-debug-button', HTMLButtonElement);
const sizeShortcut = requireElement('#size-shortcut', HTMLButtonElement);
const sizeShortcutLabel = requireElement('#size-shortcut-label', HTMLSpanElement);
const workspace = requireElement('#workspace', HTMLDivElement);
const splitter = requireElement('#splitter', HTMLDivElement);
const tabList = requireElement('#tab-list', HTMLDivElement);
const viewportSelect = requireElement('#viewport-select', HTMLSelectElement);
const previewFrameShell = requireElement('#preview-frame-shell', HTMLDivElement);
const previewFrame = requireElement('#preview-frame', HTMLIFrameElement);
const previewOverlay = requireElement('#preview-overlay', HTMLDivElement);
const previewOverlayMessage = requireElement('#preview-overlay-message', HTMLDivElement);
const diagnosticList = requireElement('#diagnostic-list', HTMLOListElement);
const consoleList = requireElement('#console-list', HTMLOListElement);
const clearConsoleButton = requireElement('#clear-console-button', HTMLButtonElement);
const reactivityList = requireElement('#reactivity-list', HTMLOListElement);
const clearReactivityButton = requireElement('#clear-reactivity-button', HTMLButtonElement);
const ownershipSummary = requireElement('#ownership-summary', HTMLDivElement);
const ownershipList = requireElement('#ownership-list', HTMLOListElement);
const generatedOutput = requireElement('#generated-output', HTMLPreElement);
const graphSummary = requireElement('#graph-summary', HTMLDivElement);
const graphNodeList = requireElement('#graph-node-list', HTMLOListElement);
const graphInspector = requireElement('#graph-inspector', HTMLElement);
const graphOutput = requireElement('#graph-output', HTMLPreElement);
const astOutput = requireElement('#ast-output', HTMLPreElement);
const tokensOutput = requireElement('#tokens-output', HTMLPreElement);
const sizeContent = requireElement('#size-content', HTMLDivElement);
const compileStatus = requireElement('#compile-status', HTMLSpanElement);
const compileTime = requireElement('#compile-time', HTMLSpanElement);
const mountTime = requireElement('#mount-time', HTMLSpanElement);
const graphStatus = requireElement('#graph-status', HTMLSpanElement);
const mutationStatus = requireElement('#mutation-status', HTMLSpanElement);
const toast = requireElement('#toast', HTMLDivElement);

const compilerWorker = new Worker(new URL('./compiler.worker.ts', import.meta.url), {
  type: 'module',
});

const draftKey = (example: PlaygroundExample, moduleId: string): string =>
  `oxe.playground.draft.${example.id}.${moduleId}`;

const loadDraft = (example: PlaygroundExample, moduleId: string, source: string): string => {
  try {
    return localStorage.getItem(draftKey(example, moduleId)) ?? source;
  } catch {
    return source;
  }
};

const loadProjectDrafts = (example: PlaygroundExample): Map<string, string> =>
  new Map(
    example.files.map((file) => [file.moduleId, loadDraft(example, file.moduleId, file.source)]),
  );

const saveDraft = (example: PlaygroundExample, moduleId: string, source: string): void => {
  try {
    localStorage.setItem(draftKey(example, moduleId), source);
  } catch {
    // The editor still works when storage is unavailable or full.
  }
};

const deleteDraft = (example: PlaygroundExample, moduleId: string): void => {
  try {
    localStorage.removeItem(draftKey(example, moduleId));
  } catch {
    // Reset remains useful even when storage is unavailable.
  }
};

const initialExampleId = new URL(window.location.href).searchParams.get('example');
if (!defaultExample) {
  throw new Error('The OXE playground requires at least one example.');
}
let selectedExample: PlaygroundExample =
  (initialExampleId ? findExample(initialExampleId) : undefined) ?? defaultExample;
let activeModuleId = selectedExample.entryModuleId;
let projectDrafts = loadProjectDrafts(selectedExample);
let activeTab: OutputTab = 'preview';
let runSequence = 0;
let latestRequestedRunId = 0;
let lastSuccessfulResult: CompileResult | undefined;
let currentResult: CompileResult | undefined;
let previewReady = false;
let mountedRunId: number | undefined;
let mountMilliseconds: number | undefined;
let mutations = emptyMutations();
let consoleEvents: PreviewConsoleEvent[] = [];
let reactivityEvents: ReactiveTraceEvent[] = [];
let ownership: OwnershipSnapshot | undefined;
let previewErrors: PreviewErrorEvent[] = [];
let sizeRequestSequence = 0;
let sizeState: SizeState = { exact: false, status: 'idle' };
let compileTimer: number | undefined;
let toastTimer: number | undefined;
let allowTabEscape = false;
let selectedGraphNodeId: NodeIdV1 | undefined;

const showToast = (message: string): void => {
  toast.textContent = message;
  toast.hidden = false;
  if (toastTimer !== undefined) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 2200);
};

const formatMilliseconds = (value: number | undefined): string =>
  value === undefined ? '—' : `${value.toFixed(value < 10 ? 2 : 1)} ms`;

const formatBytes = (value: number): string => {
  if (value < 1024) {
    return `${value.toLocaleString()} B`;
  }
  const kibibytes = value / 1024;
  return `${kibibytes.toFixed(kibibytes < 10 ? 2 : 1)} KiB`;
};

const setPreviewOverlay = (message?: string): void => {
  previewOverlay.hidden = message === undefined;
  previewOverlayMessage.textContent = message ?? '';
};

const setCompileTone = (tone: 'danger' | 'success' | 'working', text: string): void => {
  compileStatus.dataset.tone = tone;
  compileStatus.textContent = text;
};

const updateLineGutter = (): void => {
  const count = Math.max(1, editor.value.split('\n').length);
  lineGutter.textContent = Array.from({ length: count }, (_value, index) => index + 1).join('\n');
};

const fileName = (moduleId: string): string => moduleId.split('/').at(-1) ?? moduleId;

const originalFile = (moduleId: string) =>
  selectedExample.files.find((file) => file.moduleId === moduleId);

const sourceFor = (moduleId: string): string =>
  projectDrafts.get(moduleId) ?? originalFile(moduleId)?.source ?? '';

const currentProjectFiles = (): readonly { readonly moduleId: string; readonly source: string }[] =>
  selectedExample.files.map((file) => ({
    moduleId: file.moduleId,
    source: sourceFor(file.moduleId),
  }));

const isFileDirty = (moduleId: string): boolean =>
  sourceFor(moduleId) !== originalFile(moduleId)?.source;

const isExamplePristine = (): boolean =>
  selectedExample.files.every((file) => !isFileDirty(file.moduleId));

function activateFile(moduleId: string): void {
  if (!selectedExample.files.some((file) => file.moduleId === moduleId)) {
    return;
  }
  activeModuleId = moduleId;
  editor.value = sourceFor(moduleId);
  editor.setAttribute('aria-label', `OXE source code: ${fileName(moduleId)}`);
  editor.scrollTop = 0;
  lineGutter.scrollTop = 0;
  updateLineGutter();
  renderFileTabs();
  updateSyntaxOutputs();
}

const renderFileTabs = (): void => {
  fileTabList.replaceChildren();
  selectedExample.files.forEach((file, index) => {
    const selected = file.moduleId === activeModuleId;
    const dirty = isFileDirty(file.moduleId);
    const button = document.createElement('button');
    button.className = 'file-tab';
    button.type = 'button';
    button.role = 'tab';
    button.id = `source-file-tab-${index}`;
    button.dataset.moduleId = file.moduleId;
    button.dataset.dirty = String(dirty);
    button.setAttribute('aria-controls', 'source-editor-panel');
    button.setAttribute('aria-selected', String(selected));
    button.setAttribute('aria-label', `${fileName(file.moduleId)}${dirty ? ', modified' : ''}`);
    button.tabIndex = selected ? 0 : -1;
    const dot = document.createElement('span');
    dot.className = 'dirty-dot';
    dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = fileName(file.moduleId);
    button.append(dot, label);
    button.addEventListener('click', () => {
      activateFile(file.moduleId);
      fileTabList.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    });
    fileTabList.append(button);
    if (selected) {
      sourceEditorPanel.setAttribute('aria-labelledby', button.id);
    }
  });
};

const updateDirtyState = (): void => {
  for (const button of fileTabList.querySelectorAll<HTMLButtonElement>('.file-tab')) {
    const moduleId = button.dataset.moduleId;
    if (!moduleId) {
      continue;
    }
    const dirty = isFileDirty(moduleId);
    button.dataset.dirty = String(dirty);
    button.setAttribute('aria-label', `${fileName(moduleId)}${dirty ? ', modified' : ''}`);
  }
};

const createMetric = (label: string, value: string): HTMLDivElement => {
  const card = document.createElement('div');
  card.className = 'metric-card';
  const labelElement = document.createElement('span');
  labelElement.className = 'metric-label';
  labelElement.textContent = label;
  const valueElement = document.createElement('strong');
  valueElement.className = 'metric-value';
  valueElement.textContent = value;
  card.append(labelElement, valueElement);
  return card;
};

const diagnosticCount = (): number =>
  (currentResult?.diagnostics.length ?? 0) + (currentResult?.error ? 1 : 0);

const consoleCount = (): number => consoleEvents.length + previewErrors.length;

const updateTabCounts = (): void => {
  const diagnostics = document.querySelector('[data-tab-count="diagnostics"]');
  if (diagnostics) {
    diagnostics.textContent = String(diagnosticCount());
  }
  const consoleCountElement = document.querySelector('[data-tab-count="console"]');
  if (consoleCountElement) {
    consoleCountElement.textContent = String(consoleCount());
  }
  const reactivityCountElement = document.querySelector('[data-tab-count="reactivity"]');
  if (reactivityCountElement) {
    reactivityCountElement.textContent = String(reactivityEvents.length);
  }
  const ownershipCountElement = document.querySelector('[data-tab-count="ownership"]');
  if (ownershipCountElement) {
    ownershipCountElement.textContent = String(ownership?.summary.owners ?? 0);
  }
};

const showTab = (tab: OutputTab, focus = false): void => {
  activeTab = tab;
  for (const { id } of tabs) {
    const button = document.querySelector(`[data-output-tab="${id}"]`);
    const pane = document.querySelector(`#pane-${id}`);
    if (button instanceof HTMLButtonElement) {
      const selected = id === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus) {
        button.focus();
      }
    }
    if (pane instanceof HTMLElement) {
      pane.dataset.active = String(id === tab);
    }
  }
  if (window.innerWidth <= 800) {
    setMobilePanel('output');
  }
};

const setMobilePanel = (panel: MobilePanel): void => {
  workspace.dataset.mobilePanel = panel;
  document.querySelectorAll<HTMLButtonElement>('[data-mobile-target]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.mobileTarget === panel));
  });
};

const revealSpan = (moduleId: string, start: number, end: number): void => {
  if (moduleId !== activeModuleId) {
    activateFile(moduleId);
  }
  setMobilePanel('source');
  const safeStart = Math.max(0, Math.min(start, editor.value.length));
  const safeEnd = Math.max(safeStart, Math.min(end, editor.value.length));
  editor.focus();
  editor.setSelectionRange(safeStart, safeEnd);
  const line = editor.value.slice(0, safeStart).split('\n').length;
  const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight) || 21;
  editor.scrollTop = Math.max(0, (line - 3) * lineHeight);
  lineGutter.scrollTop = editor.scrollTop;
};

const renderDiagnostics = (): void => {
  diagnosticList.replaceChildren();
  const diagnostics = currentResult?.diagnostics ?? [];
  if (diagnostics.length === 0 && !currentResult?.error) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'No compiler diagnostics for this run.';
    diagnosticList.append(empty);
    updateTabCounts();
    return;
  }

  for (const diagnostic of diagnostics) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.className = 'diagnostic-card';
    button.type = 'button';
    button.dataset.severity = diagnostic.severity;

    const heading = document.createElement('div');
    heading.className = 'diagnostic-heading';
    const code = document.createElement('span');
    code.className = 'diagnostic-code';
    code.textContent = diagnostic.code;
    const location = document.createElement('span');
    location.className = 'diagnostic-location';
    location.textContent = `${fileName(diagnostic.span.fileName)}:${diagnostic.span.start.line}:${diagnostic.span.start.column}`;
    location.title = diagnostic.span.fileName;
    heading.append(code, location);

    const message = document.createElement('p');
    message.className = 'diagnostic-message';
    message.textContent = diagnostic.message;
    button.append(heading, message);

    for (const related of diagnostic.related ?? []) {
      const relatedElement = document.createElement('div');
      relatedElement.className = 'related-location';
      relatedElement.textContent = `${related.message} · ${fileName(related.span.fileName)}:${related.span.start.line}:${related.span.start.column}`;
      button.append(relatedElement);
    }
    button.addEventListener('click', () => {
      revealSpan(
        diagnostic.span.fileName,
        diagnostic.span.start.offset,
        diagnostic.span.end.offset,
      );
    });
    item.append(button);
    diagnosticList.append(item);
  }

  if (currentResult?.error) {
    const item = document.createElement('li');
    const card = document.createElement('div');
    card.className = 'diagnostic-card';
    card.dataset.severity = 'error';
    const heading = document.createElement('div');
    heading.className = 'diagnostic-heading';
    const code = document.createElement('span');
    code.className = 'diagnostic-code';
    code.textContent = `Compiler · ${currentResult.stage}`;
    heading.append(code);
    const message = document.createElement('p');
    message.className = 'diagnostic-message';
    message.textContent = currentResult.error.message;
    card.append(heading, message);
    item.append(card);
    diagnosticList.append(item);
  }
  updateTabCounts();
};

const renderConsole = (): void => {
  consoleList.replaceChildren();
  const rows: { readonly level: string; readonly message: string; readonly timestamp?: number }[] =
    [
      ...consoleEvents.map((event) => ({
        level: event.level,
        message: event.arguments.join(' '),
        timestamp: event.timestamp,
      })),
      ...previewErrors.map((event) => ({
        level: 'error',
        message: `${event.phase}: ${event.error.message}`,
      })),
    ];
  if (rows.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'No preview logs or runtime failures.';
    consoleList.append(empty);
    updateTabCounts();
    return;
  }
  for (const row of rows) {
    const item = document.createElement('li');
    item.className = 'console-row';
    item.dataset.level = row.level;
    const heading = document.createElement('div');
    heading.className = 'console-heading';
    const level = document.createElement('span');
    level.className = 'console-level';
    level.textContent = row.level;
    heading.append(level);
    if (row.timestamp !== undefined) {
      const time = document.createElement('time');
      time.className = 'console-time';
      time.dateTime = new Date(row.timestamp).toISOString();
      time.textContent = new Date(row.timestamp).toLocaleTimeString();
      heading.append(time);
    }
    const message = document.createElement('div');
    message.className = 'console-message';
    message.textContent = row.message;
    item.append(heading, message);
    consoleList.append(item);
  }
  updateTabCounts();
};

const renderReactivity = (): void => {
  reactivityList.replaceChildren();
  if (reactivityEvents.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'Interact with the preview to see why reactive work runs or is skipped.';
    reactivityList.append(empty);
    updateTabCounts();
    return;
  }

  const graph = currentResult?.graphJson ? parseGraph(currentResult.graphJson) : undefined;
  for (const event of [...reactivityEvents].reverse()) {
    const item = document.createElement('li');
    item.className = 'trace-row';
    item.dataset.kind = event.kind;
    const targetId = event.computation?.id ?? event.source.id;
    const target = targetId ? graph?.nodes.find((node) => node.id === targetId) : undefined;
    const card: HTMLButtonElement | HTMLDivElement = target
      ? document.createElement('button')
      : document.createElement('div');
    card.className = 'trace-card';
    if (card instanceof HTMLButtonElement && target) {
      card.type = 'button';
      card.title = `Inspect ${target.id}`;
      card.addEventListener('click', () => {
        selectedGraphNodeId = target.id;
        showTab('graph');
        renderGraph();
        revealSpan(target.span.fileName, target.span.start.offset, target.span.end.offset);
      });
    }
    const heading = document.createElement('div');
    heading.className = 'trace-heading';
    const kind = document.createElement('span');
    kind.className = 'trace-kind';
    kind.textContent = event.kind;
    const subject = document.createElement('strong');
    subject.textContent = event.computation?.name ?? event.source.name;
    const time = document.createElement('time');
    time.className = 'console-time';
    time.dateTime = new Date(event.timestamp).toISOString();
    time.textContent = new Date(event.timestamp).toLocaleTimeString();
    heading.append(kind, subject, time);
    const reason = document.createElement('p');
    reason.className = 'trace-message';
    reason.textContent = event.reason;
    const source = document.createElement('code');
    source.textContent = event.source.path?.length
      ? `${event.source.name}.${event.source.path.join('.')}`
      : event.source.name;
    card.append(heading, reason, source);
    item.append(card);
    reactivityList.append(item);
  }
  updateTabCounts();
};

const ownershipDepth = (
  owner: OwnershipOwnerSnapshot,
  ownersById: ReadonlyMap<number, OwnershipOwnerSnapshot>,
): number => {
  let depth = 0;
  let parentId = owner.parentId;
  const visited = new Set<number>();
  while (parentId !== undefined && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = ownersById.get(parentId);
    if (!parent) {
      break;
    }
    depth += 1;
    parentId = parent.parentId;
  }
  return depth;
};

const renderOwnership = (): void => {
  ownershipSummary.replaceChildren();
  ownershipList.replaceChildren();
  const summary = ownership?.summary;
  ownershipSummary.append(
    createMetric('Live owners', String(summary?.owners ?? 0)),
    createMetric('Resources', String(summary?.resources ?? 0)),
    createMetric('Roots', String(summary?.roots ?? 0)),
    createMetric('Reactions', String(summary?.reactions ?? 0)),
  );

  if (!ownership || ownership.owners.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = ownership
      ? 'No live owners or cleanup-bound resources. The previous preview released its ownership tree.'
      : 'The preview has not reported its ownership tree yet.';
    ownershipList.append(empty);
    updateTabCounts();
    return;
  }

  const ownersById = new Map(ownership.owners.map((owner) => [owner.id, owner]));
  const graph = currentResult?.graphJson ? parseGraph(currentResult.graphJson) : undefined;
  for (const owner of ownership.owners) {
    const item = document.createElement('li');
    item.className = 'ownership-row';
    item.style.setProperty('--ownership-depth', String(ownershipDepth(owner, ownersById)));
    const target = owner.traceId
      ? graph?.nodes.find((node) => node.id === owner.traceId)
      : undefined;
    const card: HTMLButtonElement | HTMLDivElement = target
      ? document.createElement('button')
      : document.createElement('div');
    card.className = 'ownership-card';
    if (card instanceof HTMLButtonElement && target) {
      card.type = 'button';
      card.addEventListener('click', () => {
        selectedGraphNodeId = target.id;
        showTab('graph');
        renderGraph();
        revealSpan(target.span.fileName, target.span.start.offset, target.span.end.offset);
      });
    }

    const heading = document.createElement('div');
    heading.className = 'ownership-heading';
    const kind = document.createElement('span');
    kind.className = 'ownership-kind';
    kind.textContent = owner.kind;
    const name = document.createElement('strong');
    name.textContent = owner.name;
    const children = document.createElement('span');
    children.className = 'ownership-count';
    children.textContent = `${owner.childCount} child${owner.childCount === 1 ? '' : 'ren'}`;
    heading.append(kind, name, children);
    card.append(heading);

    if (owner.resources.length > 0) {
      const resources = document.createElement('ul');
      resources.className = 'ownership-resources';
      for (const resource of owner.resources) {
        const resourceItem = document.createElement('li');
        resourceItem.textContent = `${resource.kind} · ${resource.name}`;
        resources.append(resourceItem);
      }
      card.append(resources);
    }
    item.append(card);
    ownershipList.append(item);
  }
  updateTabCounts();
};

const parseGraph = (json: string): UiGraphV1 | undefined => {
  try {
    const value: unknown = JSON.parse(json);
    if (
      typeof value === 'object' &&
      value !== null &&
      'schemaVersion' in value &&
      value.schemaVersion === 'oxe.ui-graph.v1' &&
      'nodes' in value &&
      Array.isArray(value.nodes) &&
      'edges' in value &&
      Array.isArray(value.edges)
    ) {
      return value as UiGraphV1;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const createInspectorReference = (graph: UiGraphV1, item: GraphInspectorReference): HTMLElement => {
  const target = item.nodeId
    ? graph.nodes.find((candidate) => candidate.id === item.nodeId)
    : undefined;
  const element: HTMLButtonElement | HTMLDivElement = target
    ? document.createElement('button')
    : document.createElement('div');
  element.className = 'inspector-reference';
  if (target && element instanceof HTMLButtonElement) {
    element.type = 'button';
    element.title = `Inspect ${item.nodeId}`;
    element.addEventListener('click', () => {
      selectedGraphNodeId = target.id;
      renderGraph();
      revealSpan(target.span.fileName, target.span.start.offset, target.span.end.offset);
    });
  }
  const label = document.createElement('strong');
  label.className = 'inspector-reference-label';
  label.textContent = item.label;
  const detail = document.createElement('span');
  detail.className = 'inspector-reference-detail';
  detail.textContent = item.detail ?? 'No additional detail';
  element.append(label, detail);
  return element;
};

const appendInspectorSection = (
  graph: UiGraphV1,
  title: string,
  items: readonly GraphInspectorReference[],
): void => {
  const section = document.createElement('section');
  section.className = 'inspector-section';
  const heading = document.createElement('h3');
  heading.textContent = title;
  section.append(heading);
  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'inspector-empty';
    empty.textContent = 'None';
    section.append(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'inspector-reference-list';
    list.append(...items.map((item) => createInspectorReference(graph, item)));
    section.append(list);
  }
  graphInspector.append(section);
};

const renderGraphInspector = (graph: UiGraphV1): void => {
  graphInspector.replaceChildren();
  const model = selectedGraphNodeId
    ? buildGraphInspectorModel(graph, selectedGraphNodeId)
    : undefined;
  if (!model) {
    const empty = document.createElement('div');
    empty.className = 'graph-inspector-empty';
    const heading = document.createElement('h2');
    heading.textContent = 'Inspect a graph node';
    const message = document.createElement('p');
    message.textContent =
      'Select a node to reveal its source, owner, inputs, consumers, and graph relationships.';
    empty.append(heading, message);
    graphInspector.append(empty);
    return;
  }

  const header = document.createElement('header');
  header.className = 'graph-inspector-header';
  const headingWrap = document.createElement('div');
  const kind = document.createElement('span');
  kind.className = 'node-kind';
  kind.textContent = model.node.kind;
  const heading = document.createElement('h2');
  heading.textContent = model.title;
  const identifier = document.createElement('code');
  identifier.textContent = model.node.id;
  headingWrap.append(kind, heading, identifier);
  const revealButton = document.createElement('button');
  revealButton.className = 'button';
  revealButton.type = 'button';
  revealButton.textContent = `${fileName(model.node.span.fileName)}:${model.node.span.start.line}:${model.node.span.start.column}`;
  revealButton.title = `Reveal ${model.node.span.fileName}`;
  revealButton.addEventListener('click', () => {
    revealSpan(model.node.span.fileName, model.node.span.start.offset, model.node.span.end.offset);
  });
  header.append(headingWrap, revealButton);
  graphInspector.append(header);

  appendInspectorSection(graph, 'Owner & source', model.ownerAndSource);
  appendInspectorSection(graph, 'Inputs', model.inputs);
  appendInspectorSection(graph, 'Consumers', model.consumers);
  appendInspectorSection(graph, 'Relationships', model.relationships);
};

const renderGraph = (): void => {
  graphSummary.replaceChildren();
  graphNodeList.replaceChildren();
  graphOutput.textContent = currentResult?.graphJson ?? '';
  const graph = currentResult?.graphJson ? parseGraph(currentResult.graphJson) : undefined;
  if (!graph) {
    selectedGraphNodeId = undefined;
    graphSummary.append(createMetric('Nodes', '—'), createMetric('Edges', '—'));
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'The semantic graph is available after a successful compile.';
    graphNodeList.append(empty);
    graphInspector.replaceChildren();
    return;
  }
  if (selectedGraphNodeId && !graph.nodes.some((node) => node.id === selectedGraphNodeId)) {
    selectedGraphNodeId = undefined;
  }
  graphSummary.append(
    createMetric('Nodes', String(graph.nodes.length)),
    createMetric('Edges', String(graph.edges.length)),
    createMetric('Entries', String(graph.entryComponents.length)),
  );
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const node of graph.nodes) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.className = 'graph-node-button';
    button.type = 'button';
    button.dataset.selected = String(node.id === selectedGraphNodeId);
    button.setAttribute('aria-pressed', String(node.id === selectedGraphNodeId));
    const kind = document.createElement('span');
    kind.className = 'node-kind';
    kind.textContent = node.kind;
    const id = document.createElement('span');
    id.className = 'node-id';
    id.textContent = graphNodeLabel(node, nodes);
    id.title = node.id;
    const location = document.createElement('span');
    location.className = 'diagnostic-location';
    location.textContent = `${fileName(node.span.fileName)}:${node.span.start.line}:${node.span.start.column}`;
    button.append(kind, id, location);
    button.addEventListener('click', () => {
      selectedGraphNodeId = node.id;
      renderGraph();
      revealSpan(node.span.fileName, node.span.start.offset, node.span.end.offset);
    });
    item.append(button);
    graphNodeList.append(item);
  }
  renderGraphInspector(graph);
};

const createSizeCard = (label: string, value: string): HTMLDivElement => {
  const card = document.createElement('div');
  card.className = 'size-card';
  const labelElement = document.createElement('span');
  labelElement.className = 'size-label';
  labelElement.textContent = label;
  const valueElement = document.createElement('strong');
  valueElement.className = 'size-value';
  valueElement.textContent = value;
  card.append(labelElement, valueElement);
  return card;
};

const renderSize = (): void => {
  sizeContent.replaceChildren();
  const toolbar = document.createElement('div');
  toolbar.className = 'pane-toolbar';
  const headingWrap = document.createElement('div');
  const heading = document.createElement('h2');
  heading.className = 'pane-title';
  heading.textContent = 'Generated app payload';
  const hint = document.createElement('div');
  hint.className = 'pane-hint';
  hint.textContent =
    'Includes generated application code, @oxe/runtime, and @oxe/runtime-dom. Compiler, editor, and Vite tooling are excluded.';
  headingWrap.append(heading, hint);
  const badge = document.createElement('span');
  badge.className = 'measurement-badge';
  badge.dataset.exact = String(sizeState.exact);
  badge.textContent = sizeState.exact ? 'Exact bundle' : 'Browser estimate';
  toolbar.append(headingWrap, badge);
  sizeContent.append(toolbar);

  if (sizeState.status === 'loading' || sizeState.status === 'idle') {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Measuring the current successful run…';
    sizeContent.append(empty);
    return;
  }
  if (sizeState.status === 'stale') {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Run the current source to refresh its payload measurement.';
    sizeContent.append(empty);
    return;
  }
  if (sizeState.status === 'error') {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = sizeState.message ?? 'The payload could not be measured.';
    sizeContent.append(empty);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'size-grid';
  if (sizeState.report) {
    grid.append(
      createSizeCard('Raw bundle', formatBytes(sizeState.report.bytes.raw)),
      createSizeCard('Minified', formatBytes(sizeState.report.bytes.minified)),
      createSizeCard('Gzip', formatBytes(sizeState.report.bytes.gzip)),
      createSizeCard('Brotli', formatBytes(sizeState.report.bytes.brotli)),
    );
  } else if (sizeState.sourceBytes !== undefined) {
    grid.append(createSizeCard('Generated JS', formatBytes(sizeState.sourceBytes)));
    if (sizeState.sourceGzipBytes !== undefined) {
      grid.append(createSizeCard('Generated JS gzip', formatBytes(sizeState.sourceGzipBytes)));
    }
  }
  sizeContent.append(grid);

  if (!sizeState.report) {
    const explanation = document.createElement('p');
    explanation.className = 'pane-hint';
    explanation.textContent =
      'The exact local esbuild endpoint is unavailable in this static build, so these figures cover generated JavaScript only and do not claim to include the runtime.';
    sizeContent.append(explanation);
    return;
  }

  const methodology = document.createElement('p');
  methodology.className = 'pane-hint';
  methodology.textContent = `${sizeState.report.methodology.bundler} ${sizeState.report.methodology.bundlerVersion} · ${sizeState.report.methodology.format} · ${sizeState.report.methodology.target} · ${sizeState.report.methodology.compression}`;
  sizeContent.append(methodology);

  const table = document.createElement('table');
  table.className = 'module-table';
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of ['Module', 'Kind', 'Minified']) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = label;
    headRow.append(cell);
  }
  head.append(headRow);
  const body = document.createElement('tbody');
  for (const module of sizeState.report.attribution.modules) {
    const row = document.createElement('tr');
    const id = document.createElement('td');
    id.textContent = module.id;
    const kind = document.createElement('td');
    kind.textContent = module.kind;
    const bytes = document.createElement('td');
    bytes.textContent = formatBytes(module.minified);
    row.append(id, kind, bytes);
    body.append(row);
  }
  table.append(head, body);
  sizeContent.append(table);
};

const updateSizeShortcut = (): void => {
  if (sizeState.status === 'loading') {
    sizeShortcutLabel.textContent = 'Measuring…';
    return;
  }
  if (sizeState.status === 'stale') {
    sizeShortcutLabel.textContent = 'Size stale';
    return;
  }
  if (sizeState.report) {
    sizeShortcutLabel.textContent = `${formatBytes(sizeState.report.bytes.gzip)} gzip`;
    sizeShortcut.title = `Generated app bundle: ${formatBytes(sizeState.report.bytes.minified)} minified, ${formatBytes(sizeState.report.bytes.brotli)} Brotli`;
    return;
  }
  if (sizeState.sourceBytes !== undefined) {
    sizeShortcutLabel.textContent = `${formatBytes(sizeState.sourceBytes)} generated`;
    sizeShortcut.title = 'Generated JavaScript estimate; open Size for its exact boundary.';
    return;
  }
  sizeShortcutLabel.textContent =
    sizeState.status === 'error' ? 'Size unavailable' : 'Size pending';
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isByteCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const moduleKinds = new Set(['generated-app', 'runtime', 'runtime-dom']);

const isSizeReport = (value: unknown): value is OxeSizeReport => {
  if (!isRecord(value)) {
    return false;
  }
  const bytes = value.bytes;
  const boundary = value.boundary;
  const attribution = value.attribution;
  const methodology = value.methodology;
  if (
    value.schemaVersion !== 'oxe.playground-size.v1' ||
    !isRecord(bytes) ||
    !['raw', 'minified', 'gzip', 'brotli'].every((key) => isByteCount(bytes[key])) ||
    !isRecord(boundary) ||
    boundary.scope !== 'shipped-app-payload' ||
    !Array.isArray(boundary.includes) ||
    !Array.isArray(boundary.excludesTooling) ||
    !isRecord(attribution) ||
    !Array.isArray(attribution.modules) ||
    !isRecord(attribution.unattributed) ||
    !isByteCount(attribution.unattributed.raw) ||
    !isByteCount(attribution.unattributed.minified) ||
    !isRecord(methodology) ||
    typeof methodology.bundler !== 'string' ||
    typeof methodology.bundlerVersion !== 'string' ||
    typeof methodology.compression !== 'string' ||
    typeof methodology.format !== 'string' ||
    typeof methodology.target !== 'string' ||
    typeof methodology.attribution !== 'string'
  ) {
    return false;
  }
  return attribution.modules.every(
    (module) =>
      isRecord(module) &&
      typeof module.id === 'string' &&
      typeof module.kind === 'string' &&
      moduleKinds.has(module.kind) &&
      isByteCount(module.raw) &&
      isByteCount(module.minified),
  );
};

const isSizeResponse = (value: unknown): value is OxeSizeResponse => {
  if (!isRecord(value)) {
    return false;
  }
  if (value.ok === true) {
    return isSizeReport(value.report);
  }
  return (
    value.ok === false &&
    isRecord(value.error) &&
    typeof value.error.code === 'string' &&
    typeof value.error.message === 'string'
  );
};

const gzipLength = async (source: string): Promise<number | undefined> => {
  if (!('CompressionStream' in window)) {
    return undefined;
  }
  try {
    const input = new Blob([source]).stream();
    const compressed = input.pipeThrough(new CompressionStream('gzip'));
    return (await new Response(compressed).arrayBuffer()).byteLength;
  } catch {
    return undefined;
  }
};

const setEstimatedSize = async (result: CompileResult, requestId: number): Promise<void> => {
  const moduleSource = result.moduleSource ?? '';
  const bytes = new TextEncoder().encode(moduleSource).byteLength;
  const gzip = await gzipLength(moduleSource);
  if (requestId !== sizeRequestSequence) {
    return;
  }
  sizeState = {
    exact: false,
    status: 'ready',
    sourceBytes: bytes,
    ...(gzip === undefined ? {} : { sourceGzipBytes: gzip }),
  };
  updateSizeShortcut();
  renderSize();
};

const measureSize = async (
  files: readonly { readonly moduleId: string; readonly source: string }[],
  result: CompileResult,
): Promise<void> => {
  const requestId = ++sizeRequestSequence;
  sizeState = { exact: false, status: 'loading' };
  updateSizeShortcut();
  renderSize();
  try {
    const response = await fetch(OXE_SIZE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(selectedExample.capabilitySet ? { capabilitySet: selectedExample.capabilitySet } : {}),
        ...(selectedExample.localization ? { localization: true } : {}),
        entryModuleId: selectedExample.entryModuleId,
        entryExport: selectedExample.entryExport,
        files,
      }),
    });
    const value: unknown = await response.json();
    if (requestId !== sizeRequestSequence) {
      return;
    }
    if (!isSizeResponse(value)) {
      throw new TypeError('The size endpoint returned an invalid response.');
    }
    if (!value.ok) {
      const failure: OxeSizeFailure = value;
      sizeState = { exact: false, status: 'error', message: failure.error.message };
    } else {
      sizeState = { exact: true, status: 'ready', report: value.report };
    }
    updateSizeShortcut();
    renderSize();
  } catch {
    await setEstimatedSize(result, requestId);
  }
};

const postPreviewMount = (result: CompileResult): void => {
  if (!previewReady || !result.factorySource || !result.mountExport) {
    return;
  }
  previewFrame.contentWindow?.postMessage(
    {
      type: 'preview:mount',
      version: OXE_PLAYGROUND_PROTOCOL_VERSION,
      runId: result.runId,
      ...(selectedExample.capabilitySet ? { capabilitySet: selectedExample.capabilitySet } : {}),
      ...(selectedExample.localization ? { localization: true } : {}),
      factorySource: result.factorySource,
      ...(result.factorySourceMap ? { factorySourceMap: result.factorySourceMap } : {}),
      mountExport: result.mountExport,
    },
    window.location.origin,
  );
};

const postPreviewClear = (runId: number): void => {
  if (!previewReady) {
    return;
  }
  previewFrame.contentWindow?.postMessage(
    { type: 'preview:clear', version: OXE_PLAYGROUND_PROTOCOL_VERSION, runId },
    window.location.origin,
  );
};

const updateSyntaxOutputs = (): void => {
  const module = currentResult?.modules.find((candidate) => candidate.moduleId === activeModuleId);
  astOutput.textContent = module?.astJson ?? '// AST is unavailable for this file.';
  tokensOutput.textContent = module?.tokenJson ?? '// Tokens are unavailable for this file.';
};

const updateCompilerOutputs = (result: CompileResult): void => {
  generatedOutput.textContent = result.moduleSource ?? '// Generated JavaScript is unavailable.';
  graphOutput.textContent = result.graphJson ?? '';
  updateSyntaxOutputs();
  renderDiagnostics();
  renderGraph();
};

const handleCompileResult = (result: CompileResult): void => {
  if (result.runId !== latestRequestedRunId) {
    return;
  }
  const firstResultForExample = currentResult === undefined;
  currentResult = result;
  runButton.disabled = false;
  compileTime.textContent = `Compile ${formatMilliseconds(result.compileMilliseconds)}`;
  updateCompilerOutputs(result);

  const valid =
    result.stage === 'complete' &&
    result.diagnostics.length === 0 &&
    result.factorySource !== undefined &&
    result.mountExport !== undefined;
  if (!valid) {
    setCompileTone(
      'danger',
      `${diagnosticCount()} ${diagnosticCount() === 1 ? 'error' : 'errors'}`,
    );
    graphStatus.textContent = 'Graph unavailable';
    sizeRequestSequence += 1;
    sizeState = { exact: false, status: 'stale' };
    updateSizeShortcut();
    renderSize();
    if (lastSuccessfulResult) {
      setPreviewOverlay('Current source has errors. Showing the last successful preview.');
    } else {
      postPreviewClear(result.runId);
      setPreviewOverlay('Fix the compiler diagnostics to render a preview.');
    }
    if (
      firstResultForExample &&
      selectedExample.intentionallyInvalid === true &&
      isExamplePristine()
    ) {
      showTab('diagnostics');
    }
    return;
  }

  lastSuccessfulResult = result;
  mountedRunId = undefined;
  mountMilliseconds = undefined;
  mutations = emptyMutations();
  reactivityEvents = [];
  ownership = undefined;
  renderReactivity();
  renderOwnership();
  mountTime.textContent = 'Mount —';
  mutationStatus.textContent = 'DOM mutations —';
  setCompileTone('success', 'Compiled');
  const stats = result.graphStats;
  graphStatus.textContent = stats
    ? `Graph ${stats.nodes} nodes · ${stats.edges} edges`
    : 'Graph ready';
  setPreviewOverlay('Mounting generated output…');
  postPreviewMount(result);
  void measureSize(currentProjectFiles(), result);
};

const compileSource = (): void => {
  if (compileTimer !== undefined) {
    window.clearTimeout(compileTimer);
    compileTimer = undefined;
  }
  const runId = ++runSequence;
  latestRequestedRunId = runId;
  runButton.disabled = true;
  setCompileTone('working', 'Compiling');
  sizeRequestSequence += 1;
  sizeState = { exact: false, status: 'stale' };
  updateSizeShortcut();
  renderSize();
  setPreviewOverlay(
    lastSuccessfulResult
      ? 'Compiling edits. The preview is from the last successful run.'
      : 'Compiling the example…',
  );
  compilerWorker.postMessage({
    type: 'compile',
    version: OXE_PLAYGROUND_PROTOCOL_VERSION,
    runId,
    ...(selectedExample.capabilitySet ? { capabilitySet: selectedExample.capabilitySet } : {}),
    ...(selectedExample.localization ? { localization: true } : {}),
    entryModuleId: selectedExample.entryModuleId,
    entryExport: selectedExample.entryExport,
    files: currentProjectFiles(),
  });
};

const scheduleCompile = (): void => {
  if (compileTimer !== undefined) {
    window.clearTimeout(compileTimer);
  }
  compileTimer = window.setTimeout(compileSource, 320);
};

const buildExampleOptions = (): void => {
  exampleSelect.replaceChildren();
  for (const group of exampleGroups) {
    const optionGroup = document.createElement('optgroup');
    optionGroup.label = group;
    for (const example of examples.filter((candidate) => candidate.group === group)) {
      const option = document.createElement('option');
      option.value = example.id;
      option.textContent = example.label;
      optionGroup.append(option);
    }
    exampleSelect.append(optionGroup);
  }
};

const loadExample = (example: PlaygroundExample): void => {
  selectedExample = example;
  activeModuleId = example.entryModuleId;
  projectDrafts = loadProjectDrafts(example);
  exampleSelect.value = example.id;
  exampleDescription.textContent = example.description;
  editor.value = sourceFor(activeModuleId);
  editor.setAttribute('aria-label', `OXE source code: ${fileName(activeModuleId)}`);
  currentResult = undefined;
  selectedGraphNodeId = undefined;
  lastSuccessfulResult = undefined;
  mountedRunId = undefined;
  mountMilliseconds = undefined;
  mutations = emptyMutations();
  consoleEvents = [];
  reactivityEvents = [];
  ownership = undefined;
  previewErrors = [];
  generatedOutput.textContent = '';
  graphOutput.textContent = '';
  astOutput.textContent = '';
  tokensOutput.textContent = '';
  compileTime.textContent = 'Compile —';
  mountTime.textContent = 'Mount —';
  graphStatus.textContent = 'Graph —';
  mutationStatus.textContent = 'DOM mutations —';
  sizeState = { exact: false, status: 'idle' };
  renderFileTabs();
  updateLineGutter();
  updateDirtyState();
  renderDiagnostics();
  renderConsole();
  renderReactivity();
  renderOwnership();
  renderGraph();
  renderSize();
  updateSizeShortcut();
  const url = new URL(window.location.href);
  url.searchParams.set('example', example.id);
  history.replaceState(null, '', url);
  showTab('preview');
  compileSource();
};

const copyText = async (text: string, successMessage: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch {
    showToast('Clipboard access is unavailable.');
  }
};

const createDebugReport = (): string => {
  const report = {
    schemaVersion: 'oxe.playground-debug.v2',
    example: selectedExample.id,
    entryModuleId: selectedExample.entryModuleId,
    entryExport: selectedExample.entryExport,
    activeModuleId,
    files: currentProjectFiles(),
    currentRunId: currentResult?.runId,
    compile: currentResult
      ? {
          stage: currentResult.stage,
          milliseconds: currentResult.compileMilliseconds,
          diagnostics: currentResult.diagnostics,
          error: currentResult.error,
        }
      : undefined,
    graphStats: currentResult?.graphStats,
    selectedGraphNodeId,
    mount: { runId: mountedRunId, milliseconds: mountMilliseconds },
    mutations,
    previewErrors,
    console: consoleEvents,
    reactivity: reactivityEvents,
    ownership,
    size: sizeState,
    graph: currentResult?.graphJson ? JSON.parse(currentResult.graphJson) : undefined,
    generatedJavaScript: currentResult?.moduleSource,
  };
  return `${JSON.stringify(report, null, 2)}\n`;
};

for (const tab of tabs) {
  const button = document.createElement('button');
  button.className = 'tab-button';
  button.type = 'button';
  button.role = 'tab';
  button.dataset.outputTab = tab.id;
  button.id = `tab-${tab.id}`;
  button.setAttribute('aria-controls', `pane-${tab.id}`);
  button.setAttribute('aria-selected', String(tab.id === activeTab));
  button.tabIndex = tab.id === activeTab ? 0 : -1;
  const label = document.createElement('span');
  label.textContent = tab.label;
  button.append(label);
  if (
    tab.id === 'diagnostics' ||
    tab.id === 'console' ||
    tab.id === 'reactivity' ||
    tab.id === 'ownership'
  ) {
    const count = document.createElement('span');
    count.className = 'tab-count';
    count.dataset.tabCount = tab.id;
    count.textContent = '0';
    button.append(count);
  }
  button.addEventListener('click', () => showTab(tab.id));
  tabList.append(button);
  const pane = document.querySelector(`#pane-${tab.id}`);
  if (pane instanceof HTMLElement) {
    pane.setAttribute('aria-labelledby', button.id);
  }
}

buildExampleOptions();

compilerWorker.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!isCompileResult(event.data)) {
    return;
  }
  handleCompileResult(event.data);
});

compilerWorker.addEventListener('error', (event) => {
  runButton.disabled = false;
  setCompileTone('danger', 'Worker failed');
  setPreviewOverlay(`Compiler worker failed: ${event.message}`);
});

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== previewFrame.contentWindow || event.origin !== window.location.origin) {
    return;
  }
  if (!isPreviewEvent(event.data)) {
    return;
  }
  switch (event.data.type) {
    case 'preview:ready':
      previewReady = true;
      if (lastSuccessfulResult) {
        postPreviewMount(lastSuccessfulResult);
      } else {
        postPreviewClear(latestRequestedRunId);
      }
      break;
    case 'preview:mounted':
      if (event.data.runId !== lastSuccessfulResult?.runId) {
        return;
      }
      mountedRunId = event.data.runId;
      mountMilliseconds = event.data.mountMilliseconds;
      mountTime.textContent = `Mount ${formatMilliseconds(mountMilliseconds)}`;
      setPreviewOverlay();
      break;
    case 'preview:mutations':
      if (event.data.runId !== lastSuccessfulResult?.runId) {
        return;
      }
      mutations = event.data.counts;
      mutationStatus.textContent = `DOM ${mutations.characterData} text · ${mutations.addedNodes} added · ${mutations.removedNodes} removed`;
      break;
    case 'preview:console':
      if (event.data.runId !== null && event.data.runId !== lastSuccessfulResult?.runId) {
        return;
      }
      consoleEvents = [...consoleEvents.slice(-199), event.data];
      renderConsole();
      break;
    case 'preview:reactivity':
      if (event.data.runId !== lastSuccessfulResult?.runId) {
        return;
      }
      reactivityEvents = [...reactivityEvents.slice(-499), event.data.event];
      renderReactivity();
      break;
    case 'preview:ownership':
      if (event.data.runId !== (lastSuccessfulResult?.runId ?? latestRequestedRunId)) {
        return;
      }
      ownership = event.data.snapshot;
      renderOwnership();
      break;
    case 'preview:error':
      if (event.data.runId !== null && event.data.runId !== lastSuccessfulResult?.runId) {
        return;
      }
      previewErrors = [...previewErrors.slice(-49), event.data];
      renderConsole();
      setPreviewOverlay(`Preview ${event.data.phase} error: ${event.data.error.message}`);
      showTab('console');
      break;
  }
});

editor.addEventListener('input', () => {
  projectDrafts.set(activeModuleId, editor.value);
  saveDraft(selectedExample, activeModuleId, editor.value);
  updateLineGutter();
  updateDirtyState();
  sizeRequestSequence += 1;
  sizeState = { exact: false, status: 'stale' };
  updateSizeShortcut();
  renderSize();
  scheduleCompile();
});

editor.addEventListener('scroll', () => {
  lineGutter.scrollTop = editor.scrollTop;
});

editor.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    compileSource();
    return;
  }
  if (event.key === 'Escape') {
    allowTabEscape = true;
    return;
  }
  if (event.key !== 'Tab') {
    allowTabEscape = false;
    return;
  }
  if (allowTabEscape) {
    allowTabEscape = false;
    return;
  }
  event.preventDefault();
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  editor.setRangeText('  ', start, end, 'end');
  editor.dispatchEvent(new Event('input', { bubbles: true }));
});

runButton.addEventListener('click', compileSource);

resetButton.addEventListener('click', () => {
  const file = originalFile(activeModuleId);
  if (!file) {
    return;
  }
  deleteDraft(selectedExample, activeModuleId);
  projectDrafts.set(activeModuleId, file.source);
  editor.value = file.source;
  updateLineGutter();
  updateDirtyState();
  compileSource();
  showToast(`${fileName(activeModuleId)} reset.`);
});

exampleSelect.addEventListener('change', () => {
  const example = findExample(exampleSelect.value);
  if (example) {
    loadExample(example);
  }
});

copySourceButton.addEventListener('click', () => {
  void copyText(editor.value, 'Source copied.');
});

copyDebugButton.addEventListener('click', () => {
  void copyText(createDebugReport(), 'Debug report copied.');
});

clearConsoleButton.addEventListener('click', () => {
  consoleEvents = [];
  previewErrors = [];
  renderConsole();
});

clearReactivityButton.addEventListener('click', () => {
  reactivityEvents = [];
  renderReactivity();
});

sizeShortcut.addEventListener('click', () => showTab('size'));

viewportSelect.addEventListener('change', () => {
  previewFrameShell.style.width =
    viewportSelect.value === 'fluid' ? '100%' : `${viewportSelect.value}px`;
});

document.querySelectorAll<HTMLButtonElement>('[data-mobile-target]').forEach((button) => {
  button.addEventListener('click', () => {
    const target = button.dataset.mobileTarget;
    if (target === 'source' || target === 'output') {
      setMobilePanel(target);
    }
  });
});

tabList.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    return;
  }
  event.preventDefault();
  const currentIndex = tabs.findIndex((tab) => tab.id === activeTab);
  let nextIndex = currentIndex;
  if (event.key === 'ArrowLeft') {
    nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  } else if (event.key === 'ArrowRight') {
    nextIndex = (currentIndex + 1) % tabs.length;
  } else if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = tabs.length - 1;
  }
  const next = tabs[nextIndex];
  if (next) {
    showTab(next.id, true);
  }
});

fileTabList.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    return;
  }
  const currentIndex = selectedExample.files.findIndex((file) => file.moduleId === activeModuleId);
  if (currentIndex < 0) {
    return;
  }
  event.preventDefault();
  let nextIndex = currentIndex;
  if (event.key === 'ArrowLeft') {
    nextIndex = (currentIndex - 1 + selectedExample.files.length) % selectedExample.files.length;
  } else if (event.key === 'ArrowRight') {
    nextIndex = (currentIndex + 1) % selectedExample.files.length;
  } else if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = selectedExample.files.length - 1;
  }
  const next = selectedExample.files[nextIndex];
  if (next) {
    activateFile(next.moduleId);
    fileTabList.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  }
});

let draggingSplitter = false;

const setSourceWidth = (clientX: number): void => {
  const bounds = workspace.getBoundingClientRect();
  const percentage = ((clientX - bounds.left) / bounds.width) * 100;
  const clamped = Math.min(70, Math.max(30, percentage));
  workspace.style.setProperty('--source-width', `${clamped}%`);
  splitter.setAttribute('aria-valuenow', String(Math.round(clamped)));
};

splitter.addEventListener('pointerdown', (event) => {
  draggingSplitter = true;
  splitter.dataset.dragging = 'true';
  splitter.setPointerCapture(event.pointerId);
  setSourceWidth(event.clientX);
});

splitter.addEventListener('pointermove', (event) => {
  if (draggingSplitter) {
    setSourceWidth(event.clientX);
  }
});

const stopDragging = (event: PointerEvent): void => {
  if (!draggingSplitter) {
    return;
  }
  draggingSplitter = false;
  splitter.dataset.dragging = 'false';
  if (splitter.hasPointerCapture(event.pointerId)) {
    splitter.releasePointerCapture(event.pointerId);
  }
};

splitter.addEventListener('pointerup', stopDragging);
splitter.addEventListener('pointercancel', stopDragging);
splitter.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
    return;
  }
  event.preventDefault();
  const current = Number(splitter.getAttribute('aria-valuenow')) || 54;
  const next = Math.min(70, Math.max(30, current + (event.key === 'ArrowRight' ? 2 : -2)));
  workspace.style.setProperty('--source-width', `${next}%`);
  splitter.setAttribute('aria-valuenow', String(next));
});

window.addEventListener('beforeunload', () => {
  compilerWorker.terminate();
});

loadExample(selectedExample);
