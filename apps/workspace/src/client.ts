import type {
  ApplicationAgentRequestV1,
  ApplicationAgentResponseV1,
  ApplicationMetricV1,
  ApplicationMutationBatchV1,
  ApplicationOutboxJobV1,
} from '@oxe/graph';
import type { ApplicationPublicationStateV1 } from '@oxe/compiler';
import {
  parseApplicationDevelopmentInteraction,
  type ApplicationDevelopmentInteractionV1,
} from '@oxe/graph';

import {
  filterWorkspaceNodes,
  groupWorkspaceNodes,
  semanticLabel,
  type WorkspaceNodeSummary,
} from './model.js';
import type { WorkspaceChatEventV1, WorkspaceConversationMessageV1 } from './agent.js';
import {
  formatPerformanceBytes,
  formatPerformanceMilliseconds,
  summarizePagePerformance,
  summarizeRuntimePerformance,
  type PageNavigationPerformanceSample,
  type PageResourcePerformanceSample,
} from './performance.js';

(window as Window & { __OXE_WORKSPACE_STARTED__?: boolean }).__OXE_WORKSPACE_STARTED__ = true;

type SuccessfulResponse = Extract<ApplicationAgentResponseV1, { readonly ok: true }>;
type PreviewResult = Extract<SuccessfulResponse['result'], { readonly kind: 'preview' }>;
type HistoryResult = Extract<SuccessfulResponse['result'], { readonly kind: 'inspect.history' }>;

interface WorkspaceConfig {
  readonly agentRequestSchema: ApplicationAgentRequestV1['schemaVersion'];
  readonly agentAvailable: boolean;
  readonly appId: string;
  readonly applicationUrl: string;
  readonly artifactRevision?: number;
  readonly operationsAvailable: boolean;
  readonly publication: ApplicationPublicationStateV1;
  readonly revision: number;
}

const required = <ElementType extends Element>(selector: string): ElementType => {
  const element = document.querySelector<ElementType>(selector);
  if (!element) throw new Error(`Workspace element ${selector} is missing.`);
  return element;
};

const button = (text: string, className?: string): HTMLButtonElement => {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = text;
  if (className) element.className = className;
  return element;
};

const workspace = required<HTMLElement>('[data-workspace]');
const appName = required<HTMLElement>('[data-app-name]');
const revisionChip = required<HTMLElement>('[data-revision]');
const nodeCount = required<HTMLElement>('[data-node-count]');
const nodeGroups = required<HTMLElement>('[data-node-groups]');
const structureSearch = required<HTMLInputElement>('[data-structure-search]');
const agentRail = required<HTMLElement>('[data-agent-rail]');
const agentLauncher = required<HTMLButtonElement>('[data-agent-launcher]');
const agentBackdrop = required<HTMLButtonElement>('[data-agent-backdrop]');
const agentProgress = required<HTMLElement>('[data-agent-progress]');
const contextCard = required<HTMLElement>('[data-context-card]');
const interactionContext = required<HTMLElement>('[data-interaction-context]');
const transcript = required<HTMLElement>('[data-transcript]');
const nodeDetail = required<HTMLElement>('[data-node-detail]');
const revisionList = required<HTMLElement>('[data-revision-list]');
const revisionDetail = required<HTMLElement>('[data-revision-detail]');
const previewFrame = required<HTMLIFrameElement>('[data-preview-frame]');
const previewFallback = required<HTMLElement>('[data-preview-fallback]');
const compactMap = required<HTMLElement>('[data-compact-map]');
const previewState = required<HTMLElement>('[data-preview-state]');
const previewDot = required<HTMLElement>('[data-preview-dot]');
const openPreview = required<HTMLAnchorElement>('[data-open-preview]');
const retryPublication = required<HTMLButtonElement>('[data-retry-publication]');
const runtimeStatus = required<HTMLElement>('[data-runtime-status]');
const runtimeStats = required<HTMLElement>('[data-runtime-stats]');
const runtimeMetrics = required<HTMLElement>('[data-runtime-metrics]');
const runtimeJobs = required<HTMLElement>('[data-runtime-jobs]');
const performanceStatus = required<HTMLElement>('[data-performance-status]');
const performanceSummary = required<HTMLElement>('[data-performance-summary]');
const performanceTimings = required<HTMLElement>('[data-performance-timings]');
const performanceResources = required<HTMLElement>('[data-performance-resources]');
const performanceRuntime = required<HTMLElement>('[data-performance-runtime]');

let config: WorkspaceConfig;
let nodes: readonly WorkspaceNodeSummary[] = [];
let history: HistoryResult['revisions'] = [];
let pendingDraft:
  { readonly batch: ApplicationMutationBatchV1; readonly result: PreviewResult } | undefined;
const conversation: WorkspaceConversationMessageV1[] = [];
const recentInteractions: ApplicationDevelopmentInteractionV1[] = [];

const request = async (
  operation: ApplicationAgentRequestV1['operation'],
): Promise<ApplicationAgentResponseV1> => {
  const payload: ApplicationAgentRequestV1 = {
    appId: config.appId,
    operation,
    requestId: crypto.randomUUID(),
    schemaVersion: config.agentRequestSchema,
  };
  const response = await fetch('/api/agent', {
    body: JSON.stringify(payload),
    headers: { 'content-type': 'application/json', 'x-oxe-workspace-request': '1' },
    method: 'POST',
  });
  if (!response.ok) throw new Error(`Workspace protocol returned HTTP ${response.status}.`);
  return (await response.json()) as ApplicationAgentResponseV1;
};

const appendTranscript = (
  role: 'agent' | 'system' | 'you',
  message: string,
  detail?: string,
): HTMLElement => {
  const entry = document.createElement('article');
  entry.className = `message message-${role}`;
  const label = document.createElement('p');
  label.className = 'message-role';
  label.textContent = role === 'you' ? 'You' : role === 'agent' ? 'OXE agent' : 'Workspace';
  const body = document.createElement('p');
  body.textContent = message;
  entry.append(label, body);
  if (detail) {
    const secondary = document.createElement('pre');
    secondary.textContent = detail;
    entry.append(secondary);
  }
  transcript.append(entry);
  transcript.scrollTop = transcript.scrollHeight;
  return entry;
};

const streamChat = async (message: string): Promise<void> => {
  conversation.push({ role: 'user', text: message });
  const response = await fetch('/api/chat', {
    body: JSON.stringify({
      interactions: recentInteractions.slice(-12),
      messages: conversation.slice(-40),
    }),
    headers: { 'content-type': 'application/json', 'x-oxe-workspace-request': '1' },
    method: 'POST',
  });
  if (!response.ok) {
    const failure = (await response.json()) as { readonly error?: string };
    throw new Error(failure.error ?? `Workspace chat returned HTTP ${response.status}.`);
  }
  if (!response.body) throw new Error('Workspace chat response has no stream.');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffered += chunk.value;
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      if (!line) continue;
      const event = JSON.parse(line) as
        WorkspaceChatEventV1 | { readonly error: string; readonly kind: 'error' };
      if (event.kind === 'error') throw new Error(event.error);
      if (event.kind === 'message') {
        conversation.push({ role: 'assistant', text: event.text });
        appendTranscript('agent', event.text);
        agentProgress.hidden = true;
      } else if (event.kind === 'preview') renderDraft(event.batch, event.result);
      else if (event.kind === 'progress') {
        agentProgress.textContent = event.detail;
        agentProgress.hidden = false;
      }
    }
  }
};

type RailName = 'agent' | 'graph' | 'performance' | 'revisions' | 'runtime';

const railTabs = [...document.querySelectorAll<HTMLButtonElement>('[data-rail-tab]')];

const showRail = (name: RailName): void => {
  agentRail.classList.remove('collapsed');
  workspace.classList.remove('agent-collapsed');
  agentRail.setAttribute('aria-hidden', 'false');
  agentLauncher.hidden = true;
  agentLauncher.setAttribute('aria-expanded', 'true');
  railTabs.forEach((tab) => {
    const selected = tab.dataset.railTab === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll<HTMLElement>('[data-rail-view]').forEach((view) => {
    view.hidden = view.dataset.railView !== name;
  });
};

const closeRail = (): void => {
  agentRail.classList.add('collapsed');
  workspace.classList.add('agent-collapsed');
  agentRail.setAttribute('aria-hidden', 'true');
  agentLauncher.hidden = false;
  agentLauncher.setAttribute('aria-expanded', 'false');
  agentLauncher.focus();
};

const interactionSummary = (interaction: ApplicationDevelopmentInteractionV1): string => {
  const target = interaction.target;
  const name =
    target?.label ??
    target?.elementId ??
    target?.operationId ??
    target?.fieldId ??
    interaction.route;
  return interaction.kind === 'operation' && interaction.outcome
    ? `${name} · ${interaction.outcome}`
    : `${name} · ${interaction.kind}`;
};

const renderInteractionContext = (): void => {
  const latest = recentInteractions.at(-1);
  contextCard.hidden = !latest;
  interactionContext.textContent = latest ? interactionSummary(latest) : '';
};

interface RuntimeOperationsSnapshot {
  readonly capturedAt: string;
  readonly deadLetterJobs: readonly ApplicationOutboxJobV1[];
  readonly telemetry: {
    readonly metrics: readonly ApplicationMetricV1[];
  };
  readonly worker: {
    readonly claimed: number;
    readonly completed: number;
    readonly failed: number;
    readonly pendingRetry: number;
    readonly runs: number;
    readonly state: 'idle' | 'running' | 'stopped' | 'stopping';
  };
}

const runtimeRequestHeaders = {
  'x-oxe-workspace-request': '1',
} as const;

const replayJob = async (
  job: ApplicationOutboxJobV1,
  control: HTMLButtonElement,
): Promise<void> => {
  control.disabled = true;
  control.textContent = 'Replaying…';
  try {
    const response = await fetch('/api/operations/replay', {
      body: JSON.stringify({ jobId: job.id }),
      headers: { ...runtimeRequestHeaders, 'content-type': 'application/json' },
      method: 'POST',
    });
    const result = (await response.json()) as { readonly error?: string };
    if (!response.ok) throw new Error(result.error ?? `Replay returned HTTP ${response.status}.`);
    await refreshRuntimeOperations();
  } catch (error) {
    runtimeStatus.textContent =
      error instanceof Error ? error.message : 'Runtime job replay failed.';
    runtimeStatus.className = 'runtime-status runtime-error';
    control.disabled = false;
    control.textContent = 'Replay';
  }
};

const metricRow = (metric: ApplicationMetricV1): HTMLElement => {
  const row = document.createElement('div');
  row.className = 'runtime-metric';
  const name = document.createElement('div');
  const kind = document.createElement('span');
  kind.className = 'runtime-kind';
  kind.textContent = metric.kind;
  const semanticId = document.createElement('code');
  semanticId.textContent = metric.semanticId;
  name.append(kind, semanticId);
  const values = document.createElement('span');
  values.textContent = `${metric.totalCount} calls · ${metric.failureCount} failed · ${(metric.totalDurationMs / Math.max(1, metric.totalCount)).toFixed(1)} ms avg`;
  row.append(name, values);
  return row;
};

const renderRuntimeOperations = (snapshot: RuntimeOperationsSnapshot): void => {
  runtimeStatus.textContent = `Worker ${snapshot.worker.state} · updated ${new Date(snapshot.capturedAt).toLocaleTimeString()}`;
  runtimeStatus.className = 'runtime-status';
  runtimeStats.replaceChildren();
  for (const [label, value] of [
    ['Runs', snapshot.worker.runs],
    ['Claimed', snapshot.worker.claimed],
    ['Completed', snapshot.worker.completed],
    ['Failed', snapshot.worker.failed],
    ['Retrying', snapshot.worker.pendingRetry],
  ] as const) {
    const item = document.createElement('div');
    const count = document.createElement('strong');
    count.textContent = String(value);
    const copy = document.createElement('span');
    copy.textContent = label;
    item.append(count, copy);
    runtimeStats.append(item);
  }
  runtimeMetrics.replaceChildren();
  if (snapshot.telemetry.metrics.length === 0) {
    runtimeMetrics.textContent = 'No application operations have been observed yet.';
    runtimeMetrics.className = 'runtime-list runtime-empty';
  } else {
    runtimeMetrics.className = 'runtime-list';
    snapshot.telemetry.metrics.forEach((metric) => runtimeMetrics.append(metricRow(metric)));
  }
  runtimeJobs.replaceChildren();
  if (snapshot.deadLetterJobs.length === 0) {
    runtimeJobs.textContent = 'No dead-letter jobs.';
    runtimeJobs.className = 'runtime-list runtime-empty';
    return;
  }
  runtimeJobs.className = 'runtime-list';
  for (const job of snapshot.deadLetterJobs) {
    const card = document.createElement('article');
    card.className = 'runtime-job';
    const copy = document.createElement('div');
    const title = document.createElement('code');
    title.textContent = job.capabilityId;
    const detail = document.createElement('span');
    detail.textContent = `${job.method} · ${job.attempts}/${job.maxAttempts} attempts · ${job.lastErrorKind ?? 'delivery failure'}`;
    copy.append(title, detail);
    const replay = button('Replay');
    replay.setAttribute('aria-label', `Replay dead-letter job ${job.id}`);
    replay.addEventListener('click', () => void replayJob(job, replay));
    card.append(copy, replay);
    runtimeJobs.append(card);
  }
};

const fetchRuntimeOperations = async (): Promise<RuntimeOperationsSnapshot> => {
  const response = await fetch('/api/operations', {
    cache: 'no-store',
    headers: runtimeRequestHeaders,
  });
  const result = (await response.json()) as RuntimeOperationsSnapshot & { readonly error?: string };
  if (!response.ok)
    throw new Error(result.error ?? `Runtime operations returned HTTP ${response.status}.`);
  return result;
};

const refreshRuntimeOperations = async (): Promise<void> => {
  if (!config.operationsAvailable) {
    runtimeStatus.textContent = 'Runtime operations are not configured.';
    runtimeStatus.className = 'runtime-status';
    runtimeStats.replaceChildren();
    runtimeMetrics.textContent =
      'Set OXE_DEVELOPMENT_OPERATIONS_TOKEN on both the application and workspace servers.';
    runtimeMetrics.className = 'runtime-list runtime-empty';
    runtimeJobs.textContent = 'Dead-letter inspection is unavailable.';
    runtimeJobs.className = 'runtime-list runtime-empty';
    return;
  }
  runtimeStatus.textContent = 'Loading runtime operations…';
  runtimeStatus.className = 'runtime-status';
  try {
    renderRuntimeOperations(await fetchRuntimeOperations());
  } catch (error) {
    runtimeStatus.textContent =
      error instanceof Error ? error.message : 'Runtime operations are unavailable.';
    runtimeStatus.className = 'runtime-status runtime-error';
  }
};

const pageResourceName = (value: string): string => {
  try {
    const url = new URL(value, previewFrame.src || window.location.href);
    return url.pathname;
  } catch {
    return value;
  }
};

const readPagePerformance = (): ReturnType<typeof summarizePagePerformance> | undefined => {
  try {
    const pagePerformance = previewFrame.contentWindow?.performance;
    if (!pagePerformance) return undefined;
    const navigationEntry = pagePerformance.getEntriesByType('navigation')[0];
    const navigation = navigationEntry as PerformanceNavigationTiming | undefined;
    const navigationSample: PageNavigationPerformanceSample | undefined = navigation
      ? {
          decodedBodySize: navigation.decodedBodySize,
          domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
          duration: navigation.duration,
          loadEventEnd: navigation.loadEventEnd,
          requestStart: navigation.requestStart,
          responseStart: navigation.responseStart,
          startTime: navigation.startTime,
          transferSize: navigation.transferSize,
        }
      : undefined;
    const resources = pagePerformance
      .getEntriesByType('resource')
      .map((entry): PageResourcePerformanceSample => {
        const resource = entry as PerformanceResourceTiming;
        return {
          decodedBodySize: resource.decodedBodySize,
          duration: resource.duration,
          initiatorType: resource.initiatorType || 'resource',
          name: pageResourceName(resource.name),
          transferSize: resource.transferSize,
        };
      });
    const firstContentfulPaint = pagePerformance.getEntriesByName('first-contentful-paint')[0];
    return summarizePagePerformance({
      ...(firstContentfulPaint ? { firstContentfulPaintMs: firstContentfulPaint.startTime } : {}),
      ...(navigationSample ? { navigation: navigationSample } : {}),
      resources,
    });
  } catch {
    return undefined;
  }
};

const performanceCard = (label: string, value: string): HTMLElement => {
  const card = document.createElement('div');
  card.className = 'performance-card';
  const result = document.createElement('strong');
  result.textContent = value;
  const copy = document.createElement('span');
  copy.textContent = label;
  card.append(result, copy);
  return card;
};

const performanceRow = (label: string, value: string): HTMLElement => {
  const row = document.createElement('div');
  row.className = 'performance-row';
  const copy = document.createElement('span');
  copy.textContent = label;
  const result = document.createElement('strong');
  result.textContent = value;
  row.append(copy, result);
  return row;
};

const emptyPerformanceSection = (container: HTMLElement, message: string): void => {
  container.className = 'performance-list performance-empty';
  container.textContent = message;
};

const renderPagePerformance = (): boolean => {
  const summary = readPagePerformance();
  performanceSummary.replaceChildren();
  performanceTimings.replaceChildren();
  performanceResources.replaceChildren();
  if (!summary || summary.requestCount === 0) {
    emptyPerformanceSection(
      performanceTimings,
      'Page timing is not available yet. Load the application and measure again.',
    );
    emptyPerformanceSection(performanceResources, 'No resource timing entries are available.');
    return false;
  }
  performanceSummary.append(
    performanceCard('Time to first byte', formatPerformanceMilliseconds(summary.ttfbMs)),
    performanceCard(
      'First contentful paint',
      formatPerformanceMilliseconds(summary.firstContentfulPaintMs),
    ),
    performanceCard('Page load', formatPerformanceMilliseconds(summary.loadMs)),
    performanceCard('Transferred', formatPerformanceBytes(summary.transferBytes)),
  );
  performanceTimings.className = 'performance-list';
  performanceTimings.append(
    performanceRow('DOM content loaded', formatPerformanceMilliseconds(summary.domContentLoadedMs)),
    performanceRow('Network requests', String(summary.requestCount)),
    performanceRow('Decoded resources', formatPerformanceBytes(summary.decodedBytes)),
  );
  if (summary.slowestResources.length === 0) {
    emptyPerformanceSection(performanceResources, 'This page has no separate resource entries.');
  } else {
    performanceResources.className = 'performance-list';
    const maximumDuration = summary.slowestResources[0]?.duration ?? 1;
    for (const resource of summary.slowestResources) {
      const row = document.createElement('div');
      row.className = 'performance-resource';
      const copy = document.createElement('div');
      const name = document.createElement('code');
      name.textContent = resource.name;
      name.title = resource.name;
      const detail = document.createElement('span');
      detail.textContent = `${resource.initiatorType} · ${formatPerformanceBytes(resource.transferSize)}`;
      const meter = document.createElement('div');
      meter.className = 'performance-resource-meter';
      const meterFill = document.createElement('span');
      meterFill.style.setProperty(
        '--duration-share',
        `${Math.max(4, (resource.duration / Math.max(1, maximumDuration)) * 100)}%`,
      );
      meter.append(meterFill);
      copy.append(name, detail, meter);
      const duration = document.createElement('strong');
      duration.textContent = formatPerformanceMilliseconds(resource.duration);
      row.append(copy, duration);
      performanceResources.append(row);
    }
  }
  return true;
};

const renderRuntimePerformance = (snapshot: RuntimeOperationsSnapshot): void => {
  performanceRuntime.replaceChildren();
  const summary = summarizeRuntimePerformance(snapshot.telemetry.metrics);
  if (summary.totalCount === 0) {
    emptyPerformanceSection(
      performanceRuntime,
      'No server operations have been observed in this runtime yet.',
    );
    return;
  }
  performanceRuntime.className = 'performance-list performance-runtime-grid';
  performanceRuntime.append(
    performanceRow('Observed calls', String(summary.totalCount)),
    performanceRow('Average duration', formatPerformanceMilliseconds(summary.averageDurationMs)),
    performanceRow('Maximum duration', formatPerformanceMilliseconds(summary.maximumDurationMs)),
    performanceRow('Failures', String(summary.failureCount)),
  );
  if (summary.slowestSemanticId)
    performanceRuntime.append(performanceRow('Slowest semantic node', summary.slowestSemanticId));
};

const refreshPerformance = async (): Promise<void> => {
  performanceStatus.textContent = 'Measuring the running application…';
  performanceStatus.className = 'performance-status';
  const pageAvailable = renderPagePerformance();
  if (!config.operationsAvailable) {
    emptyPerformanceSection(
      performanceRuntime,
      'Runtime telemetry is not configured for this application.',
    );
    performanceStatus.textContent = pageAvailable
      ? `Browser measurements updated ${new Date().toLocaleTimeString()}.`
      : 'Browser measurements are not available yet.';
    return;
  }
  try {
    const snapshot = await fetchRuntimeOperations();
    renderRuntimePerformance(snapshot);
    performanceStatus.textContent = `${pageAvailable ? 'Browser and runtime' : 'Runtime'} measurements updated ${new Date().toLocaleTimeString()}.`;
  } catch (error) {
    emptyPerformanceSection(
      performanceRuntime,
      error instanceof Error ? error.message : 'Runtime telemetry is unavailable.',
    );
    performanceStatus.textContent = pageAvailable
      ? `Browser measurements updated ${new Date().toLocaleTimeString()}; runtime telemetry is unavailable.`
      : 'Performance measurements are unavailable.';
    performanceStatus.className = 'performance-status performance-error';
  }
};

const renderNodes = (): void => {
  const filtered = filterWorkspaceNodes(nodes, structureSearch.value);
  nodeCount.textContent = String(filtered.length);
  nodeGroups.replaceChildren();
  for (const group of groupWorkspaceNodes(filtered)) {
    const section = document.createElement('details');
    section.className = 'node-group';
    section.open =
      structureSearch.value.length > 0 || ['app', 'entity', 'view'].includes(group.kind);
    const summary = document.createElement('summary');
    const title = document.createElement('span');
    title.textContent = group.kind;
    const count = document.createElement('span');
    count.textContent = String(group.nodes.length);
    summary.append(title, count);
    const list = document.createElement('div');
    list.className = 'node-list';
    for (const node of group.nodes) {
      const item = button(semanticLabel(node.id), 'node-button');
      item.title = node.id;
      const id = document.createElement('span');
      id.textContent = node.id;
      const edges = document.createElement('span');
      edges.className = 'edge-count';
      edges.textContent = `${node.incoming} in · ${node.outgoing} out`;
      item.replaceChildren(id, edges);
      item.addEventListener('click', () => void inspectNode(node.id));
      list.append(item);
    }
    section.append(summary, list);
    nodeGroups.append(section);
  }
};

const inspectNode = async (semanticId: string): Promise<void> => {
  showRail('graph');
  nodeDetail.textContent = 'Loading semantic node…';
  const response = await request({ inspect: { kind: 'node', semanticId }, kind: 'inspect' });
  if (!response.ok) {
    nodeDetail.textContent = response.diagnostics
      .map((diagnostic) => diagnostic.message)
      .join('\n');
    return;
  }
  if (response.result.kind !== 'inspect.node') return;
  const heading = document.createElement('div');
  heading.className = 'detail-heading';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = response.result.node.kind;
  const title = document.createElement('h2');
  title.textContent = response.result.node.id;
  const path = document.createElement('code');
  path.textContent = response.result.node.path;
  heading.append(eyebrow, title, path);
  const body = document.createElement('pre');
  try {
    body.textContent = JSON.stringify(JSON.parse(response.result.node.bodyJson), null, 2);
  } catch {
    body.textContent = response.result.node.bodyJson;
  }
  const references = document.createElement('div');
  references.className = 'reference-summary';
  references.textContent = `${response.result.incoming.length} incoming · ${response.result.outgoing.length} outgoing`;
  nodeDetail.replaceChildren(heading, references, body);
};

const renderHistory = (): void => {
  revisionList.replaceChildren();
  for (const revision of history) {
    const item = button(`r${revision.revision}`, 'revision-button');
    const copy = document.createElement('span');
    copy.textContent = `${revision.reason} · ${revision.mutationCount} mutations`;
    item.append(copy);
    item.addEventListener('click', () => void inspectRevision(revision));
    revisionList.append(item);
  }
};

const inspectRevision = async (revision: HistoryResult['revisions'][number]): Promise<void> => {
  showRail('revisions');
  revisionDetail.textContent = 'Loading revision…';
  if (revision.parentRevision === null) {
    const response = await request({
      inspect: { kind: 'map' },
      kind: 'inspect',
      revision: revision.revision,
    });
    if (!response.ok || response.result.kind !== 'inspect.map') {
      revisionDetail.textContent = 'The initial revision could not be loaded.';
      return;
    }
    const title = document.createElement('h2');
    title.textContent = `r${revision.revision} · initial revision`;
    const projection = document.createElement('pre');
    projection.textContent = response.result.projection;
    const restore = button('Restore as new revision');
    restore.disabled = revision.revision === config.revision;
    restore.addEventListener('click', () => void restoreRevision(revision.revision, restore));
    revisionDetail.replaceChildren(title, projection, restore);
    return;
  }
  const response = await request({
    inspect: {
      fromRevision: revision.parentRevision,
      kind: 'diff',
      toRevision: revision.revision,
    },
    kind: 'inspect',
  });
  if (!response.ok || response.result.kind !== 'inspect.diff') {
    revisionDetail.textContent = response.ok
      ? 'Unexpected revision response.'
      : response.diagnostics.map((diagnostic) => diagnostic.message).join('\n');
    return;
  }
  const title = document.createElement('h2');
  title.textContent = `r${response.result.fromRevision} → r${response.result.toRevision}`;
  const changes = document.createElement('ul');
  for (const change of response.result.impact.changes) {
    const item = document.createElement('li');
    item.textContent = `${change.change} ${change.kind} ${change.id}`;
    changes.append(item);
  }
  const impact = document.createElement('p');
  impact.className = 'impact-copy';
  impact.textContent = `${response.result.impact.impacted.length} semantic nodes in the impact closure.`;
  const restore = button('Restore as new revision');
  restore.disabled = revision.revision === config.revision;
  restore.addEventListener('click', () => void restoreRevision(revision.revision, restore));
  revisionDetail.replaceChildren(title, impact, changes, restore);
};

const restoreRevision = async (
  targetRevision: number,
  control: HTMLButtonElement,
): Promise<void> => {
  control.disabled = true;
  control.textContent = 'Restoring…';
  try {
    const response = await request({
      baseRevision: config.revision,
      kind: 'revert',
      targetRevision,
    });
    if (!response.ok || response.result.kind !== 'revert')
      throw new Error(
        response.ok ? 'Unexpected revert response.' : response.diagnostics[0]?.message,
      );
    appendTranscript(
      'agent',
      `Restored r${targetRevision} as r${response.revision}.`,
      response.result.summary,
    );
    config = { ...config, revision: response.revision };
    await refreshWorkspace();
  } catch (error) {
    appendTranscript('system', error instanceof Error ? error.message : String(error));
    control.disabled = false;
    control.textContent = 'Restore as new revision';
  }
};

const renderDraft = (batch: ApplicationMutationBatchV1, result: PreviewResult): void => {
  pendingDraft = { batch, result };
  const card = appendTranscript('agent', 'I prepared a semantic mutation for review.');
  card.classList.add('draft-card');
  if (!result.preview.ok) {
    const diagnostics = document.createElement('pre');
    diagnostics.textContent = [
      ...result.preview.result.diagnostics,
      ...(result.preview.result.graphDiagnostics ?? []),
    ]
      .map((diagnostic) => `${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`)
      .join('\n');
    card.append(diagnostics);
    return;
  }
  const changes = document.createElement('ul');
  for (const change of result.preview.result.changes) {
    const item = document.createElement('li');
    item.textContent = JSON.stringify(change);
    changes.append(item);
  }
  const impact = document.createElement('p');
  impact.className = 'impact-copy';
  impact.textContent = `${result.preview.impact.impacted.length} affected nodes · ${result.artifactPlan?.artifacts.length ?? 0} planned artifacts`;
  const commit = button('Commit reviewed revision', 'primary-button');
  commit.disabled = !result.previewFingerprint;
  commit.addEventListener('click', () => void commitDraft(commit));
  card.append(impact, changes, commit);
};

const commitDraft = async (control: HTMLButtonElement): Promise<void> => {
  if (!pendingDraft?.result.previewFingerprint) return;
  control.disabled = true;
  const response = await request({
    batch: pendingDraft.batch,
    kind: 'commit',
    previewFingerprint: pendingDraft.result.previewFingerprint,
  });
  if (!response.ok || response.result.kind !== 'commit') {
    const publicationFailed = !response.ok && response.diagnostics[0]?.code === 'OXE3404';
    appendTranscript(
      'system',
      response.ok
        ? 'Unexpected commit response.'
        : (response.diagnostics[0]?.message ?? 'Commit failed.'),
    );
    if (publicationFailed) pendingDraft = undefined;
    await refreshWorkspace();
    return;
  }
  appendTranscript('agent', `Committed r${response.revision}.`, response.result.summary);
  config = { ...config, revision: response.revision };
  pendingDraft = undefined;
  await refreshWorkspace();
};

const refreshPreview = async (): Promise<void> => {
  previewState.textContent = 'Checking application server…';
  previewDot.className = 'status-dot checking';
  let result: {
    readonly artifactRevision?: number;
    readonly publication: ApplicationPublicationStateV1;
    readonly reachable: boolean;
    readonly source: 'configured' | 'last-good';
    readonly url: string;
  };
  try {
    const response = await fetch('/api/application-status', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    result = (await response.json()) as typeof result;
  } catch {
    previewState.textContent = 'Workspace connection interrupted · retrying';
    previewDot.className = 'status-dot offline';
    return;
  }
  config = {
    ...config,
    applicationUrl: result.url,
    ...(result.artifactRevision === undefined ? {} : { artifactRevision: result.artifactRevision }),
    publication: result.publication,
  };
  retryPublication.hidden = result.publication.status !== 'failed';
  openPreview.href = result.url;
  if (result.reachable) {
    const lastGood = result.source === 'last-good';
    const attempt = result.publication.lastAttempt;
    previewState.textContent =
      result.publication.status === 'failed'
        ? `Live r${result.publication.activeRevision} · r${result.publication.candidateRevision ?? attempt?.revision ?? '–'} ${attempt?.stage ?? 'publication'} failed`
        : result.publication.status === 'publishing'
          ? `Publishing r${result.publication.candidateRevision ?? '–'} · live r${result.publication.activeRevision}`
          : lastGood
            ? `Last-good generated build · r${result.artifactRevision ?? '–'}`
            : 'Development application connected';
    previewState.title = attempt?.message ?? '';
    previewDot.className = `status-dot ${lastGood || result.publication.status !== 'active' ? 'checking' : 'connected'}`;
    previewFallback.hidden = true;
    previewFrame.hidden = false;
    const previewUrl = `${result.url}${result.url.includes('?') ? '&' : '?'}oxeRevision=${result.artifactRevision ?? config.revision}`;
    if (previewFrame.getAttribute('src') !== previewUrl) previewFrame.src = previewUrl;
  } else {
    previewState.textContent = 'Application server offline';
    previewDot.className = 'status-dot offline';
    previewFrame.hidden = true;
    previewFallback.hidden = false;
  }
};

const refreshWorkspace = async (): Promise<void> => {
  const configuration = await fetch('/api/config', { cache: 'no-store' });
  if (configuration.ok) config = (await configuration.json()) as WorkspaceConfig;
  const [nodeResponse, historyResponse, mapResponse] = await Promise.all([
    request({ inspect: { kind: 'nodes', limit: 100 }, kind: 'inspect' }),
    request({ inspect: { kind: 'history', limit: 100 }, kind: 'inspect' }),
    request({ inspect: { kind: 'map' }, kind: 'inspect' }),
  ]);
  if (nodeResponse.ok && nodeResponse.result.kind === 'inspect.nodes') {
    nodes = nodeResponse.result.nodes;
    renderNodes();
  }
  if (historyResponse.ok && historyResponse.result.kind === 'inspect.history') {
    history = historyResponse.result.revisions;
    renderHistory();
  }
  if (mapResponse.ok && mapResponse.result.kind === 'inspect.map')
    compactMap.textContent = mapResponse.result.projection;
  revisionChip.textContent = `r${config.publication.activeRevision}`;
  revisionChip.title =
    config.publication.activeRevision === config.revision
      ? `Live revision r${config.revision}`
      : `Live revision r${config.publication.activeRevision}; graph head r${config.revision}`;
  await refreshPreview();
};

railTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => {
    const name = tab.dataset.railTab as RailName;
    showRail(name);
    if (name === 'runtime') void refreshRuntimeOperations();
    if (name === 'performance') void refreshPerformance();
  });
  tab.addEventListener('keydown', (event) => {
    let targetIndex: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      targetIndex = (index + 1) % railTabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      targetIndex = (index - 1 + railTabs.length) % railTabs.length;
    else if (event.key === 'Home') targetIndex = 0;
    else if (event.key === 'End') targetIndex = railTabs.length - 1;
    if (targetIndex === undefined) return;
    event.preventDefault();
    railTabs[targetIndex]?.focus();
    railTabs[targetIndex]?.click();
  });
});
required<HTMLButtonElement>('[data-refresh-runtime]').addEventListener(
  'click',
  () => void refreshRuntimeOperations(),
);
required<HTMLButtonElement>('[data-refresh-performance]').addEventListener(
  'click',
  () => void refreshPerformance(),
);
required<HTMLButtonElement>('[data-collapse-agent]').addEventListener('click', () => {
  closeRail();
});
agentLauncher.addEventListener('click', () => {
  showRail('agent');
  railTabs.find((tab) => tab.dataset.railTab === 'agent')?.focus();
});
agentBackdrop.addEventListener('click', closeRail);
required<HTMLButtonElement>('[data-refresh-preview]').addEventListener(
  'click',
  () => void refreshPreview(),
);
retryPublication.addEventListener('click', () => {
  retryPublication.disabled = true;
  retryPublication.textContent = 'Publishing…';
  void fetch('/api/publication/retry', {
    headers: { 'x-oxe-workspace-request': '1' },
    method: 'POST',
  })
    .then(async (response) => {
      const result = (await response.json()) as { readonly error?: string };
      if (!response.ok)
        throw new Error(result.error ?? `Publication retry returned HTTP ${response.status}.`);
      appendTranscript('agent', 'The current graph revision is live.');
    })
    .catch((error: unknown) =>
      appendTranscript('system', error instanceof Error ? error.message : String(error)),
    )
    .finally(() => {
      retryPublication.disabled = false;
      retryPublication.textContent = 'Retry publish';
      void refreshWorkspace();
    });
});
previewFrame.addEventListener('load', () => {
  const selected = document.querySelector<HTMLElement>(
    '[data-rail-tab="performance"][aria-selected="true"]',
  );
  if (selected) window.setTimeout(() => void refreshPerformance(), 0);
});
structureSearch.addEventListener('input', renderNodes);
required<HTMLButtonElement>('[data-clear-context]').addEventListener('click', () => {
  recentInteractions.splice(0);
  renderInteractionContext();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !agentRail.classList.contains('collapsed')) closeRail();
});
window.addEventListener('message', (event) => {
  if (event.source !== previewFrame.contentWindow) return;
  let previewOrigin: string;
  try {
    previewOrigin = new URL(config.applicationUrl, window.location.href).origin;
  } catch {
    return;
  }
  if (event.origin !== previewOrigin) return;
  try {
    const interaction = parseApplicationDevelopmentInteraction(event.data);
    recentInteractions.push(interaction);
    if (recentInteractions.length > 20)
      recentInteractions.splice(0, recentInteractions.length - 20);
    renderInteractionContext();
  } catch {
    // Application messages are ignored unless they match the strict semantic protocol.
  }
});
required<HTMLFormElement>('[data-agent-form]').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = required<HTMLTextAreaElement>('#agent-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  appendTranscript('you', text);
  if (config.agentAvailable) {
    void streamChat(text)
      .catch((error: unknown) =>
        appendTranscript('system', error instanceof Error ? error.message : String(error)),
      )
      .finally(() => (agentProgress.hidden = true));
    return;
  }
  const latestTarget = recentInteractions.at(-1)?.target;
  const semanticQuery =
    latestTarget?.operationId ?? latestTarget?.elementId ?? latestTarget?.fieldId ?? text;
  void request({ inspect: { kind: 'search', limit: 12, text: semanticQuery }, kind: 'inspect' })
    .then((response) => {
      if (!response.ok || response.result.kind !== 'inspect.search')
        throw new Error(
          response.ok ? 'Unexpected search response.' : response.diagnostics[0]?.message,
        );
      appendTranscript(
        'agent',
        response.result.matches.length === 0
          ? 'No semantic nodes matched. Configure a model to turn this request into a revision.'
          : `I located ${response.result.matches.length} relevant semantic node${response.result.matches.length === 1 ? '' : 's'}. Configure a model to inspect and prepare a revision.`,
        response.result.matches.map((match) => `${match.kind} ${match.id}`).join('\n'),
      );
    })
    .catch((error: unknown) =>
      appendTranscript('system', error instanceof Error ? error.message : String(error)),
    );
});

const initialize = async (): Promise<void> => {
  const response = await fetch('/api/config', { cache: 'no-store' });
  if (!response.ok) throw new Error('Workspace configuration could not be loaded.');
  config = (await response.json()) as WorkspaceConfig;
  appName.textContent = config.appId;
  revisionChip.textContent = `r${config.publication.activeRevision}`;
  openPreview.href = config.applicationUrl;
  appendTranscript(
    'agent',
    config.agentAvailable
      ? 'The semantic graph and typed model tools are ready. I can inspect and prepare mutations for review.'
      : 'The semantic graph is ready. Configure OPENAI_API_KEY or OXE_AGENT_ENDPOINT for revision chat; context-aware semantic search remains available.',
  );
  await refreshWorkspace();
  window.setInterval(() => void refreshPreview(), 5_000);
};

void initialize().catch((error: unknown) => {
  previewState.textContent = 'Workspace failed to initialize';
  previewDot.className = 'status-dot offline';
  appendTranscript('system', error instanceof Error ? error.message : String(error));
});
