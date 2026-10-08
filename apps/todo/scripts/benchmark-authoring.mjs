import { readFile } from 'node:fs/promises';

import {
  ApplicationArtifactCache,
  lowerApplicationRouteToUiGraph,
  planApplicationArtifactInvalidation,
} from '../../../packages/compiler/dist/index.js';
import {
  loadApplicationGraph,
  createStandardApplicationCapability,
  measureCompactApplicationProjection,
  previewApplicationMutation,
  projectCompactApplicationGraph,
  serializeApplicationGraph,
} from '../../../packages/graph/dist/index.js';

const graphUrl = new URL('../../../examples/application-graph-todo/graph.json', import.meta.url);
const generatedClientUrl = new URL('../dist/generated/application-client.js', import.meta.url);
const browserClientUrl = new URL('../dist/client.js', import.meta.url);
const graphSource = await readFile(graphUrl, 'utf8');
const graph = loadApplicationGraph(JSON.parse(graphSource));
const compact = projectCompactApplicationGraph(graph);
const compactSize = measureCompactApplicationProjection(compact);
const loweredUi = JSON.stringify(lowerApplicationRouteToUiGraph(graph).graph);
const generatedJavaScript = `${await readFile(generatedClientUrl, 'utf8')}\n${await readFile(browserClientUrl, 'utf8')}`;
const batch = {
  base: graph.revision,
  ops: [
    {
      as: 'priority',
      default: 'normal',
      entity: 'entity.task',
      name: 'priority',
      op: 'field.add',
      type: { enum: ['low', 'normal', 'high'] },
    },
    { field: '$priority', form: 'element.createTaskForm', op: 'form.field.add' },
    { field: '$priority', list: 'element.taskList', op: 'list.display.add' },
  ],
};
const batchSource = JSON.stringify(batch);
const preview = previewApplicationMutation(graph, batch);
if (!preview.ok) throw new Error(preview.result.diagnostics[0]?.message ?? 'Mutation failed.');
const nextGraphSource = serializeApplicationGraph(preview.result.graph);
const invalid = previewApplicationMutation(graph, {
  base: graph.revision,
  ops: [{ field: 'field.task.done', form: 'element.createTaskForm', op: 'form.field.add' }],
});
const invalidDiagnostics = invalid.ok
  ? []
  : [...(invalid.result.graphDiagnostics ?? []), ...invalid.result.diagnostics];
const artifacts = planApplicationArtifactInvalidation(graph, preview.result.graph);
const taskEntity = graph.entities.find((entity) => entity.id === 'entity.task');
if (!taskEntity) throw new Error('Todo benchmark requires entity.task.');
const proxyScenarios = [
  { id: 'add-task-priority', batch },
  {
    id: 'rename-task-field',
    batch: {
      base: graph.revision,
      ops: [{ name: 'label', node: 'field.task.title', op: 'symbol.rename' }],
    },
  },
  {
    id: 'tighten-task-read-policy',
    batch: {
      base: graph.revision,
      ops: [
        {
          action: 'read',
          op: 'policy.rule.set',
          policy: 'policy.task',
          predicate: { kind: 'relationEqualsActor', relation: 'relation.taskOwner' },
        },
      ],
    },
  },
  {
    id: 'preview-remove-task-query',
    batch: {
      base: graph.revision,
      ops: [{ node: 'query.myTasks', op: 'semantic.remove' }],
    },
  },
  {
    id: 'add-optional-task-due-date',
    batch: {
      base: graph.revision,
      ops: [
        {
          node: {
            entity: 'entity.task',
            id: 'field.task.dueDate',
            kind: 'field',
            name: 'dueDate',
            required: false,
            valueType: { kind: 'optional', value: { kind: 'date' } },
          },
          op: 'semantic.add',
        },
        {
          node: {
            ...taskEntity,
            fields: [...(taskEntity.fields ?? []), 'field.task.dueDate'],
          },
          op: 'semantic.replace',
        },
      ],
    },
  },
  {
    id: 'add-document-upload-capability',
    batch: {
      base: graph.revision,
      ops: [
        {
          node: createStandardApplicationCapability('objectStorage'),
          op: 'semantic.add',
        },
      ],
    },
  },
];
const proxyScenarioResults = proxyScenarios.map((scenario) => {
  const source = JSON.stringify(scenario.batch);
  const result = previewApplicationMutation(graph, scenario.batch);
  return {
    affectedSemanticNodes: result.ok ? result.impact.impacted.length : 0,
    diagnosticCodes: result.ok
      ? []
      : [...(result.result.graphDiagnostics ?? []), ...result.result.diagnostics].map(
          (diagnostic) => diagnostic.code,
        ),
    id: scenario.id,
    mutationBytes: Buffer.byteLength(source),
    mutationHeuristicTokens: Math.ceil(Buffer.byteLength(source) / 4),
    valid: result.ok,
  };
});

const bytes = (value) => Buffer.byteLength(value);
const heuristicTokens = (value) => Math.ceil(bytes(value) / 4);
const median = (values) =>
  [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
const samples = [];
for (let round = 0; round < 9; round += 1) {
  const startedAt = performance.now();
  for (let iteration = 0; iteration < 1_000; iteration += 1)
    previewApplicationMutation(graph, batch);
  samples.push(((performance.now() - startedAt) * 1_000) / 1_000);
}
const cacheSamples = { cold: [], incremental: [], warm: [] };
for (let round = 0; round < 9; round += 1) {
  let startedAt = performance.now();
  for (let iteration = 0; iteration < 50; iteration += 1)
    new ApplicationArtifactCache().compile(graph);
  cacheSamples.cold.push(((performance.now() - startedAt) * 1_000) / 50);

  const warmCache = new ApplicationArtifactCache();
  warmCache.compile(graph);
  startedAt = performance.now();
  for (let iteration = 0; iteration < 1_000; iteration += 1) warmCache.compile(graph);
  cacheSamples.warm.push(((performance.now() - startedAt) * 1_000) / 1_000);

  const incrementalCaches = Array.from({ length: 50 }, () => {
    const cache = new ApplicationArtifactCache();
    cache.compile(graph);
    return cache;
  });
  startedAt = performance.now();
  for (const cache of incrementalCaches) cache.compile(preview.result.graph);
  cacheSamples.incremental.push(((performance.now() - startedAt) * 1_000) / 50);
}
const measuredCache = new ApplicationArtifactCache();
const coldCompilation = measuredCache.compile(graph);
const incrementalCompilation = measuredCache.compile(preview.result.graph);

const semanticInput = bytes(compact);
const normalizedInput = bytes(graphSource);
const uiInput = bytes(loweredUi);
const javascriptInput = bytes(generatedJavaScript);
const report = {
  claimScope: {
    measured: [
      'representation size',
      'typed atomic edit size',
      'validation diagnostics',
      'semantic impact closure',
      'local mutation and impact-analysis time',
      'cold, warm, and revision-incremental generated-artifact cache time',
    ],
    notMeasured: [
      'model reasoning quality',
      'provider-billed tokens',
      'end-to-end model latency',
      'cross-model success rate',
    ],
    level: 'representation-and-tooling-proxy',
  },
  scenario: 'Add Task.priority to storage, create form, and task list in one revision.',
  arms: {
    compactSemanticMutation: {
      input: {
        characters: compactSize.characters,
        heuristicTokens: heuristicTokens(compact),
        lines: compactSize.lines,
        utf8Bytes: compactSize.utf8Bytes,
      },
      output: {
        atomicOperations: batch.ops.length,
        heuristicTokens: heuristicTokens(batchSource),
        utf8Bytes: bytes(batchSource),
      },
    },
    fullNormalizedGraphReplacement: {
      input: {
        heuristicTokens: heuristicTokens(graphSource),
        utf8Bytes: normalizedInput,
      },
      output: {
        heuristicTokens: heuristicTokens(nextGraphSource),
        utf8Bytes: bytes(nextGraphSource),
      },
    },
    loweredUiProjectionInspection: {
      input: { heuristicTokens: heuristicTokens(loweredUi), utf8Bytes: uiInput },
      authoritative: false,
    },
    generatedJavaScriptInspection: {
      input: { heuristicTokens: heuristicTokens(generatedJavaScript), utf8Bytes: javascriptInput },
      authoritative: false,
    },
  },
  ratios: {
    compactInputVsGeneratedJavaScript: javascriptInput / semanticInput,
    compactInputVsLoweredUi: uiInput / semanticInput,
    compactInputVsNormalizedGraph: normalizedInput / semanticInput,
    atomicOutputVsFullGraphReplacement: bytes(nextGraphSource) / bytes(batchSource),
  },
  correctness: {
    affectedArtifacts: artifacts.artifacts.map((artifact) => artifact.id),
    affectedSemanticNodes: preview.impact.impacted.length,
    invalidAttemptDiagnosticCount: invalidDiagnostics.length,
    invalidAttemptFirstDiagnostic: invalidDiagnostics[0],
    mutationCommitted: preview.result.ok,
    revision: preview.result.revision,
    unchangedInputRevision: graph.revision,
  },
  scenarioMatrix: proxyScenarioResults,
  performance: {
    artifactCache: {
      coldBuildMicroseconds: median(cacheSamples.cold),
      coldStats: coldCompilation.stats,
      incrementalBuildMicroseconds: median(cacheSamples.incremental),
      incrementalStats: incrementalCompilation.stats,
      rounds: cacheSamples.cold.length,
      warmHitMicroseconds: median(cacheSamples.warm),
    },
    medianMutationPreviewMicroseconds: median(samples),
    rounds: samples.length,
    previewsPerRound: 1_000,
  },
  tokenMethod: 'Heuristic only: ceil(UTF-8 bytes / 4). No provider tokenizer is installed.',
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
