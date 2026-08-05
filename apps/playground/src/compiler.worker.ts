import { analyzeProject, generateDomArtifact, parseSource, scanSource } from '@oxe/compiler';
import { serializeUiGraph } from '@oxe/graph';
import { createFileRouteManifest, matchRoute } from '@oxe/router';

import { capabilitiesForPlayground, type PlaygroundCapabilitySet } from './demo-capabilities.js';

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
  readonly capabilitySet?: PlaygroundCapabilitySet;
  readonly entryExport: string;
  readonly entryModuleId: string;
  readonly files: readonly CompileFile[];
  readonly localization?: boolean;
  readonly runId: number;
  readonly routeInitialHref?: string;
}): Promise<CompileResult> => {
  const startedAt = performance.now();
  const sources = new Map(request.files.map((file) => [file.moduleId, file.source]));
  const modules = request.files.map((file) => ({
    moduleId: file.moduleId,
    astJson: prettyJson(parseSource(file.source, file.moduleId).ast),
    tokenJson: prettyJson(scanSource(file.source, file.moduleId).tokens),
  }));
  if (request.routeInitialHref !== undefined) {
    const manifest = createFileRouteManifest(request.files.map((file) => file.moduleId));
    const initialMatch = matchRoute(manifest, request.routeInitialHref);
    if (!initialMatch) {
      throw new Error(
        `The initial playground URL ${JSON.stringify(request.routeInitialHref)} does not match a route.`,
      );
    }
    const definitions = new Map(
      manifest.routes.flatMap((route) => route.segments.map((segment) => [segment.id, segment])),
    );
    const compiled = await Promise.all(
      [...definitions.values()].map(async (segment) => {
        const analyzed = await analyzeProject({
          capabilities: capabilitiesForPlayground(request.capabilitySet),
          entryExport: segment.exportName,
          entryModuleId: segment.moduleId,
          loadModule: async (moduleId) => sources.get(moduleId),
          ...(request.localization === undefined ? {} : { localization: request.localization }),
          routeSegment: segment.kind,
        });
        return { analyzed, segment };
      }),
    );
    const diagnostics = compiled.flatMap(({ analyzed }) => analyzed.diagnostics);
    const common = {
      type: 'compile-result' as const,
      version: OXE_PLAYGROUND_PROTOCOL_VERSION,
      runId: request.runId,
      diagnostics,
      modules,
    };
    if (diagnostics.length > 0 || compiled.some(({ analyzed }) => !analyzed.graph)) {
      return {
        ...common,
        stage: diagnostics[0] ? diagnosticStage(diagnostics[0].code) : 'analyze',
        compileMilliseconds: performance.now() - startedAt,
      };
    }
    const artifacts = compiled.map(({ analyzed, segment }) => {
      if (!analyzed.graph) throw new Error(`Route segment ${segment.id} has no graph.`);
      const artifact = generateDomArtifact(analyzed.graph, { routeSegment: segment.kind });
      if (!artifact.routeSegmentExport) {
        throw new Error(`Route segment ${segment.id} has no generated segment export.`);
      }
      return {
        artifact,
        graph: analyzed.graph,
        routeSegmentExport: artifact.routeSegmentExport,
        segment,
      };
    });
    const initialPage = initialMatch.route.segments.at(-1);
    const display = artifacts.find(({ segment }) => segment.id === initialPage?.id) ?? artifacts[0];
    if (!display) throw new Error('The route playground produced no artifacts.');
    const stats = artifacts.reduce(
      (total, { graph }) => ({
        edges: total.edges + graph.edges.length,
        entries: total.entries + graph.entryComponents.length,
        nodes: total.nodes + graph.nodes.length,
      }),
      { edges: 0, entries: 0, nodes: 0 },
    );
    return {
      ...common,
      stage: 'complete',
      graphJson: serializeUiGraph(display.graph),
      graphStats: stats,
      moduleSource: artifacts
        .map(({ artifact, segment }) => `// ${segment.moduleId}\n${artifact.moduleSource}`)
        .join('\n'),
      routeBundle: {
        initialHref: initialMatch.location.href,
        manifest,
        segments: artifacts.map(({ artifact, routeSegmentExport, segment }) => ({
          factorySource: artifact.factorySource,
          id: segment.id,
          routeSegmentExport,
        })),
      },
      compileMilliseconds: performance.now() - startedAt,
    };
  }
  const analyzed = await analyzeProject({
    capabilities: capabilitiesForPlayground(request.capabilitySet),
    entryModuleId: request.entryModuleId,
    entryExport: request.entryExport,
    ...(request.localization === undefined ? {} : { localization: request.localization }),
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
      factorySourceMap: artifact.factorySourceMap,
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
