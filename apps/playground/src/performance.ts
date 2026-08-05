export interface BrowserPerformanceSample {
  readonly compileMilliseconds: number;
  readonly mountMilliseconds: number;
}

export interface BrowserBenchmarkState {
  readonly message?: string;
  readonly samples: readonly BrowserPerformanceSample[];
  readonly status: 'complete' | 'error' | 'idle' | 'running';
  readonly targetSamples: number;
}

export interface CurrentPerformanceMetrics {
  readonly compileMilliseconds?: number;
  readonly domMutations: number;
  readonly graphEdges?: number;
  readonly graphNodes?: number;
  readonly mountMilliseconds?: number;
  readonly payload?: string;
}

export interface DurationSummary {
  readonly maximum: number;
  readonly median: number;
  readonly minimum: number;
  readonly p95: number;
}

export interface PerformancePanelOptions {
  readonly benchmark: BrowserBenchmarkState;
  readonly current: CurrentPerformanceMetrics;
  readonly onRunBenchmark: () => void;
}

const percentile = (sorted: readonly number[], fraction: number): number => {
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
};

export const summarizeDurations = (values: readonly number[]): DurationSummary | undefined => {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);
  return {
    maximum: sorted.at(-1) ?? 0,
    median,
    minimum: sorted[0] ?? 0,
    p95: percentile(sorted, 0.95),
  };
};

const formatMilliseconds = (value: number | undefined): string =>
  value === undefined ? '—' : `${value.toFixed(value < 10 ? 2 : 1)} ms`;

const createMetric = (label: string, value: string, detail?: string): HTMLDivElement => {
  const card = document.createElement('div');
  card.className = 'metric-card';
  const labelElement = document.createElement('span');
  labelElement.className = 'metric-label';
  labelElement.textContent = label;
  const valueElement = document.createElement('strong');
  valueElement.className = 'metric-value';
  valueElement.textContent = value;
  card.append(labelElement, valueElement);
  if (detail) {
    const detailElement = document.createElement('span');
    detailElement.className = 'metric-detail';
    detailElement.textContent = detail;
    card.append(detailElement);
  }
  return card;
};

const appendSummary = (container: HTMLElement, label: string, values: readonly number[]): void => {
  const summary = summarizeDurations(values);
  if (!summary) return;
  container.append(
    createMetric(`${label} median`, formatMilliseconds(summary.median), `${values.length} runs`),
    createMetric(`${label} p95`, formatMilliseconds(summary.p95), 'Nearest-rank p95'),
  );
};

export const renderPerformancePanel = (
  container: HTMLElement,
  options: PerformancePanelOptions,
): void => {
  container.replaceChildren();

  const toolbar = document.createElement('div');
  toolbar.className = 'pane-toolbar';
  const headingWrap = document.createElement('div');
  const heading = document.createElement('h2');
  heading.className = 'pane-title';
  heading.textContent = 'Performance lab';
  const hint = document.createElement('div');
  hint.className = 'pane-hint';
  hint.textContent =
    'Inspect the current run or collect a warm five-run browser sample for this project.';
  headingWrap.append(heading, hint);
  const runButton = document.createElement('button');
  runButton.className = 'button button-primary';
  runButton.type = 'button';
  runButton.disabled = options.benchmark.status === 'running';
  runButton.textContent =
    options.benchmark.status === 'running'
      ? `Running ${options.benchmark.samples.length + 1}/${options.benchmark.targetSamples}…`
      : 'Run 5 samples';
  runButton.addEventListener('click', options.onRunBenchmark);
  toolbar.append(headingWrap, runButton);
  container.append(toolbar);

  const currentHeading = document.createElement('h3');
  currentHeading.className = 'performance-section-title';
  currentHeading.textContent = 'Current browser run';
  const currentGrid = document.createElement('div');
  currentGrid.className = 'metrics-grid';
  currentGrid.append(
    createMetric('Compile', formatMilliseconds(options.current.compileMilliseconds)),
    createMetric('Mount', formatMilliseconds(options.current.mountMilliseconds)),
    createMetric(
      'Graph',
      options.current.graphNodes === undefined
        ? '—'
        : `${options.current.graphNodes.toLocaleString()} nodes`,
      options.current.graphEdges === undefined
        ? undefined
        : `${options.current.graphEdges.toLocaleString()} edges`,
    ),
    createMetric(
      'Post-mount DOM',
      options.current.domMutations.toLocaleString(),
      'Observed mutations',
    ),
    createMetric('Payload', options.current.payload ?? '—', 'Current successful build'),
  );
  container.append(currentHeading, currentGrid);

  const benchmarkHeading = document.createElement('h3');
  benchmarkHeading.className = 'performance-section-title';
  benchmarkHeading.textContent = 'Browser sample';
  const benchmarkStatus = document.createElement('p');
  benchmarkStatus.className = 'performance-status';
  benchmarkStatus.setAttribute('aria-live', 'polite');
  benchmarkStatus.dataset.status = options.benchmark.status;
  benchmarkStatus.textContent =
    options.benchmark.message ??
    (options.benchmark.status === 'idle'
      ? 'Run the unchanged source five times to compare compiler-worker and direct-DOM mount timings.'
      : options.benchmark.status === 'running'
        ? `Collected ${options.benchmark.samples.length} of ${options.benchmark.targetSamples} samples.`
        : `Collected ${options.benchmark.samples.length} samples.`);
  container.append(benchmarkHeading, benchmarkStatus);

  if (options.benchmark.samples.length > 0) {
    const summaryGrid = document.createElement('div');
    summaryGrid.className = 'metrics-grid';
    appendSummary(
      summaryGrid,
      'Compile',
      options.benchmark.samples.map((sample) => sample.compileMilliseconds),
    );
    appendSummary(
      summaryGrid,
      'Mount',
      options.benchmark.samples.map((sample) => sample.mountMilliseconds),
    );
    container.append(summaryGrid);

    const table = document.createElement('table');
    table.className = 'module-table performance-table';
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const label of ['Run', 'Compile', 'Mount']) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = label;
      headRow.append(cell);
    }
    head.append(headRow);
    const body = document.createElement('tbody');
    options.benchmark.samples.forEach((sample, index) => {
      const row = document.createElement('tr');
      for (const value of [
        String(index + 1),
        formatMilliseconds(sample.compileMilliseconds),
        formatMilliseconds(sample.mountMilliseconds),
      ]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      body.append(row);
    });
    table.append(head, body);
    container.append(table);
  }

  const methodology = document.createElement('section');
  methodology.className = 'performance-methodology';
  const methodologyHeading = document.createElement('h3');
  methodologyHeading.className = 'performance-section-title';
  methodologyHeading.textContent = 'Command-line baselines';
  const methodologyCopy = document.createElement('p');
  methodologyCopy.className = 'pane-hint';
  methodologyCopy.append(
    'Run ',
    Object.assign(document.createElement('code'), { textContent: 'pnpm bench' }),
    ' for compiler, reactive runtime, router, blocking SSR, and readiness-stream timing distributions. ',
  );
  const link = document.createElement('a');
  link.href = 'https://github.com/thefinnomenon/oxe/blob/main/docs/performance.md';
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = 'Read the benchmark methodology';
  methodologyCopy.append(link, '.');
  methodology.append(methodologyHeading, methodologyCopy);
  container.append(methodology);
};
