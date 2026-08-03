import { analyzeProject, generateDomArtifact, parseSource, scanSource } from '@oxe/compiler';
import { serializeUiGraph } from '@oxe/graph';

import {
  OXE_PLAYGROUND_PROTOCOL_VERSION,
  isCompileRequest,
  serializeError,
  type CompileResult,
  type CompileFile,
  type CompileStage,
  type GraphStats,
} from './protocol.js';

const worker = self as DedicatedWorkerGlobalScope;

const prettyJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const diagnosticStage = (code: string): CompileStage => {
  if (code.startsWith('OXE10')) {
    return 'scan';
  }
  if (code.startsWith('OXE11')) {
    return 'parse';
  }
  return 'analyze';
};

const graphStats = (graph: {
  readonly edges: readonly unknown[];
  readonly entryComponents: readonly unknown[];
  readonly nodes: readonly unknown[];
}): GraphStats => ({
  edges: graph.edges.length,
  entries: graph.entryComponents.length,
  nodes: graph.nodes.length,
});

const compile = async (request: {
  readonly entryExport: string;
  readonly entryModuleId: string;
  readonly files: readonly CompileFile[];
  readonly runId: number;
}): Promise<CompileResult> => {
  const startedAt = performance.now();
  const sources = new Map(request.files.map((file) => [file.moduleId, file.source]));
  const modules = request.files.map((file) => ({
    moduleId: file.moduleId,
    astJson: prettyJson(parseSource(file.source, file.moduleId).ast),
    tokenJson: prettyJson(scanSource(file.source, file.moduleId).tokens),
  }));
  const analyzed = await analyzeProject({
    entryModuleId: request.entryModuleId,
    entryExport: request.entryExport,
    loadModule: async (moduleId) => sources.get(moduleId),
  });
  const common = {
    type: 'compile-result' as const,
    version: OXE_PLAYGROUND_PROTOCOL_VERSION,
    runId: request.runId,
    diagnostics: analyzed.diagnostics,
    modules,
  };

  if (!analyzed.graph) {
    return {
      ...common,
      stage: analyzed.diagnostics[0] ? diagnosticStage(analyzed.diagnostics[0].code) : 'analyze',
      compileMilliseconds: performance.now() - startedAt,
    };
  }

  const serializedGraph = serializeUiGraph(analyzed.graph);
  const stats = graphStats(analyzed.graph);

  try {
    const artifact = generateDomArtifact(analyzed.graph);
    return {
      ...common,
      stage: 'complete',
      graphJson: serializedGraph,
      graphStats: stats,
      componentExport: artifact.componentExport,
      mountExport: artifact.mountExport,
      factorySource: artifact.factorySource,
      moduleSource: artifact.moduleSource,
      compileMilliseconds: performance.now() - startedAt,
    };
  } catch (error) {
    return {
      ...common,
      stage: 'codegen',
      graphJson: serializedGraph,
      graphStats: stats,
      error: serializeError(error),
      compileMilliseconds: performance.now() - startedAt,
    };
  }
};

worker.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!isCompileRequest(event.data)) {
    return;
  }

  const request = event.data;
  const startedAt = performance.now();
  void compile(request)
    .then((result) => worker.postMessage(result))
    .catch((error: unknown) => {
      const result: CompileResult = {
        type: 'compile-result',
        version: OXE_PLAYGROUND_PROTOCOL_VERSION,
        runId: request.runId,
        stage: 'internal',
        diagnostics: [],
        modules: [],
        error: serializeError(error),
        compileMilliseconds: performance.now() - startedAt,
      };
      worker.postMessage(result);
    });
});

export {};
