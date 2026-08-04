import type { Diagnostic, DomSourceMapV3 } from '@oxe/compiler';
import type { OwnershipSnapshot, ReactiveTraceEvent, ReactiveTraceSource } from '@oxe/runtime';

import { isPlaygroundCapabilitySet, type PlaygroundCapabilitySet } from './demo-capabilities.js';

export const OXE_PLAYGROUND_PROTOCOL_VERSION = 5 as const;

export type CompileStage = 'analyze' | 'codegen' | 'complete' | 'internal' | 'parse' | 'scan';

export interface SerializedError {
  readonly code?: string;
  readonly message: string;
  readonly name: string;
  readonly stack?: string;
}

export interface GraphStats {
  readonly edges: number;
  readonly entries: number;
  readonly nodes: number;
}

export interface CompileFile {
  readonly moduleId: string;
  readonly source: string;
}

export interface CompileModuleOutput {
  readonly astJson: string;
  readonly moduleId: string;
  readonly tokenJson: string;
}

export interface CompileRequest {
  readonly capabilitySet?: PlaygroundCapabilitySet;
  readonly entryExport: string;
  readonly entryModuleId: string;
  readonly files: readonly CompileFile[];
  readonly localization?: boolean;
  readonly runId: number;
  readonly type: 'compile';
  readonly version: typeof OXE_PLAYGROUND_PROTOCOL_VERSION;
}

export interface CompileResult {
  readonly compileMilliseconds: number;
  readonly componentExport?: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly error?: SerializedError;
  readonly factorySource?: string;
  readonly factorySourceMap?: DomSourceMapV3;
  readonly graphJson?: string;
  readonly graphStats?: GraphStats;
  readonly moduleSource?: string;
  readonly mountExport?: string;
  readonly modules: readonly CompileModuleOutput[];
  readonly runId: number;
  readonly stage: CompileStage;
  readonly type: 'compile-result';
  readonly version: typeof OXE_PLAYGROUND_PROTOCOL_VERSION;
}

export interface PreviewMountCommand {
  readonly capabilitySet?: PlaygroundCapabilitySet;
  readonly factorySource: string;
  readonly factorySourceMap?: DomSourceMapV3;
  readonly mountExport: string;
  readonly localization?: boolean;
  readonly runId: number;
  readonly type: 'preview:mount';
  readonly version: typeof OXE_PLAYGROUND_PROTOCOL_VERSION;
}

export interface PreviewClearCommand {
  readonly runId: number;
  readonly type: 'preview:clear';
  readonly version: typeof OXE_PLAYGROUND_PROTOCOL_VERSION;
}

export type PreviewCommand = PreviewClearCommand | PreviewMountCommand;

export interface PreviewReadyEvent {
  readonly type: 'preview:ready';
  readonly version: typeof OXE_PLAYGROUND_PROTOCOL_VERSION;
}

export interface PreviewMountedEvent {
  readonly mountMilliseconds: number;
  readonly runId: number;
  readonly type: 'preview:mounted';
  readonly version: typeof OXE_PLAYGROUND_PROTOCOL_VERSION;
}

export type PreviewErrorPhase = 'factory' | 'import' | 'mount' | 'protocol' | 'runtime' | 'unmount';

export interface PreviewErrorEvent {
  readonly error: SerializedError;
  readonly phase: PreviewErrorPhase;
  readonly runId: number | null;
  readonly type: 'preview:error';
  readonly version: typeof OXE_PLAYGROUND_PROTOCOL_VERSION;
}

export type PreviewConsoleLevel = 'debug' | 'error' | 'info' | 'log' | 'warn';

export interface PreviewConsoleEvent {
  readonly arguments: readonly string[];
  readonly level: PreviewConsoleLevel;
  readonly runId: number | null;
  readonly timestamp: number;
  readonly type: 'preview:console';
  readonly version: typeof OXE_PLAYGROUND_PROTOCOL_VERSION;
}

export interface MutationCounts {
  readonly addedNodes: number;
  readonly attributes: number;
  readonly characterData: number;
  readonly childList: number;
  readonly removedNodes: number;
}

export interface PreviewMutationsEvent {
  readonly counts: MutationCounts;
  readonly runId: number;
  readonly type: 'preview:mutations';
  readonly version: typeof OXE_PLAYGROUND_PROTOCOL_VERSION;
}

export interface PreviewReactivityEvent {
  readonly event: ReactiveTraceEvent;
  readonly runId: number;
  readonly type: 'preview:reactivity';
  readonly version: typeof OXE_PLAYGROUND_PROTOCOL_VERSION;
}

export interface PreviewOwnershipEvent {
  readonly runId: number;
  readonly snapshot: OwnershipSnapshot;
  readonly type: 'preview:ownership';
  readonly version: typeof OXE_PLAYGROUND_PROTOCOL_VERSION;
}

export type PreviewEvent =
  | PreviewConsoleEvent
  | PreviewErrorEvent
  | PreviewMountedEvent
  | PreviewMutationsEvent
  | PreviewOwnershipEvent
  | PreviewReactivityEvent
  | PreviewReadyEvent;

const compileStages = new Set<CompileStage>([
  'analyze',
  'codegen',
  'complete',
  'internal',
  'parse',
  'scan',
]);

const consoleLevels = new Set<PreviewConsoleLevel>(['debug', 'error', 'info', 'log', 'warn']);

const errorPhases = new Set<PreviewErrorPhase>([
  'factory',
  'import',
  'mount',
  'protocol',
  'runtime',
  'unmount',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasProtocolVersion = (value: Record<string, unknown>): boolean =>
  value.version === OXE_PLAYGROUND_PROTOCOL_VERSION;

const isRunId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === 'string';

const isSourceMap = (value: unknown): value is DomSourceMapV3 =>
  isRecord(value) &&
  value.version === 3 &&
  typeof value.file === 'string' &&
  typeof value.mappings === 'string' &&
  Array.isArray(value.names) &&
  value.names.every((item) => typeof item === 'string') &&
  Array.isArray(value.sources) &&
  value.sources.every((item) => typeof item === 'string');

const isSerializedError = (value: unknown): value is SerializedError =>
  isRecord(value) &&
  typeof value.name === 'string' &&
  typeof value.message === 'string' &&
  isOptionalString(value.stack) &&
  isOptionalString(value.code);

const isMutationCounts = (value: unknown): value is MutationCounts =>
  isRecord(value) &&
  ['addedNodes', 'attributes', 'characterData', 'childList', 'removedNodes'].every(
    (key) => typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && value[key] >= 0,
  );

const isGraphStats = (value: unknown): value is GraphStats =>
  isRecord(value) &&
  ['edges', 'entries', 'nodes'].every(
    (key) => typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && value[key] >= 0,
  );

const isReactiveTraceSource = (value: unknown): value is ReactiveTraceSource =>
  isRecord(value) &&
  typeof value.name === 'string' &&
  isOptionalString(value.id) &&
  (value.path === undefined ||
    (Array.isArray(value.path) && value.path.every((item) => typeof item === 'string')));

const isReactiveTraceEvent = (value: unknown): value is ReactiveTraceEvent =>
  isRecord(value) &&
  ['execute', 'invalidate', 'suppress', 'write'].includes(String(value.kind)) &&
  typeof value.reason === 'string' &&
  typeof value.timestamp === 'number' &&
  Number.isFinite(value.timestamp) &&
  isReactiveTraceSource(value.source) &&
  (value.computation === undefined ||
    (isRecord(value.computation) &&
      isReactiveTraceSource(value.computation) &&
      (value.computation.kind === 'derived' || value.computation.kind === 'reaction')));

const ownershipKinds = new Set(['context', 'derived', 'reaction', 'root']);
const resourceKinds = new Set(['cleanup', 'event-listener', 'keyed-region', 'resource']);

const isOwnershipSummary = (value: unknown): boolean =>
  isRecord(value) &&
  ['contexts', 'derived', 'owners', 'reactions', 'resources', 'roots'].every(
    (key) => typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && value[key] >= 0,
  );

const isOwnershipSnapshot = (value: unknown): value is OwnershipSnapshot =>
  isRecord(value) &&
  typeof value.timestamp === 'number' &&
  Number.isFinite(value.timestamp) &&
  isOwnershipSummary(value.summary) &&
  Array.isArray(value.owners) &&
  value.owners.every(
    (owner) =>
      isRecord(owner) &&
      typeof owner.id === 'number' &&
      Number.isSafeInteger(owner.id) &&
      owner.id > 0 &&
      typeof owner.name === 'string' &&
      typeof owner.kind === 'string' &&
      ownershipKinds.has(owner.kind) &&
      typeof owner.childCount === 'number' &&
      Number.isSafeInteger(owner.childCount) &&
      owner.childCount >= 0 &&
      (owner.parentId === undefined ||
        (typeof owner.parentId === 'number' && Number.isSafeInteger(owner.parentId))) &&
      isOptionalString(owner.traceId) &&
      Array.isArray(owner.resources) &&
      owner.resources.every(
        (resource) =>
          isRecord(resource) &&
          typeof resource.name === 'string' &&
          typeof resource.kind === 'string' &&
          resourceKinds.has(resource.kind),
      ),
  );

export const isCompileRequest = (value: unknown): value is CompileRequest =>
  isRecord(value) &&
  value.type === 'compile' &&
  hasProtocolVersion(value) &&
  isRunId(value.runId) &&
  typeof value.entryModuleId === 'string' &&
  value.entryModuleId.length > 0 &&
  typeof value.entryExport === 'string' &&
  value.entryExport.length > 0 &&
  (value.capabilitySet === undefined || isPlaygroundCapabilitySet(value.capabilitySet)) &&
  (value.localization === undefined || typeof value.localization === 'boolean') &&
  Array.isArray(value.files) &&
  value.files.length > 0 &&
  value.files.every(
    (file) =>
      isRecord(file) &&
      typeof file.moduleId === 'string' &&
      file.moduleId.length > 0 &&
      typeof file.source === 'string',
  ) &&
  new Set(value.files.map((file) => (isRecord(file) ? file.moduleId : undefined))).size ===
    value.files.length &&
  value.files.some((file) => isRecord(file) && file.moduleId === value.entryModuleId);

export const isCompileResult = (value: unknown): value is CompileResult =>
  isRecord(value) &&
  value.type === 'compile-result' &&
  hasProtocolVersion(value) &&
  isRunId(value.runId) &&
  typeof value.stage === 'string' &&
  compileStages.has(value.stage as CompileStage) &&
  Array.isArray(value.diagnostics) &&
  Array.isArray(value.modules) &&
  value.modules.every(
    (module) =>
      isRecord(module) &&
      typeof module.moduleId === 'string' &&
      typeof module.astJson === 'string' &&
      typeof module.tokenJson === 'string',
  ) &&
  typeof value.compileMilliseconds === 'number' &&
  Number.isFinite(value.compileMilliseconds) &&
  value.compileMilliseconds >= 0 &&
  isOptionalString(value.componentExport) &&
  isOptionalString(value.factorySource) &&
  (value.factorySourceMap === undefined || isSourceMap(value.factorySourceMap)) &&
  isOptionalString(value.graphJson) &&
  isOptionalString(value.moduleSource) &&
  isOptionalString(value.mountExport) &&
  (value.graphStats === undefined || isGraphStats(value.graphStats)) &&
  (value.error === undefined || isSerializedError(value.error));

export const isPreviewCommand = (value: unknown): value is PreviewCommand => {
  if (!isRecord(value) || !hasProtocolVersion(value) || !isRunId(value.runId)) {
    return false;
  }
  if (value.type === 'preview:clear') {
    return true;
  }
  return (
    value.type === 'preview:mount' &&
    (value.capabilitySet === undefined || isPlaygroundCapabilitySet(value.capabilitySet)) &&
    (value.localization === undefined || typeof value.localization === 'boolean') &&
    typeof value.factorySource === 'string' &&
    (value.factorySourceMap === undefined || isSourceMap(value.factorySourceMap)) &&
    typeof value.mountExport === 'string'
  );
};

export const isPreviewEvent = (value: unknown): value is PreviewEvent => {
  if (!isRecord(value) || !hasProtocolVersion(value)) {
    return false;
  }
  switch (value.type) {
    case 'preview:ready':
      return true;
    case 'preview:mounted':
      return (
        isRunId(value.runId) &&
        typeof value.mountMilliseconds === 'number' &&
        Number.isFinite(value.mountMilliseconds)
      );
    case 'preview:error':
      return (
        (value.runId === null || isRunId(value.runId)) &&
        typeof value.phase === 'string' &&
        errorPhases.has(value.phase as PreviewErrorPhase) &&
        isSerializedError(value.error)
      );
    case 'preview:console':
      return (
        (value.runId === null || isRunId(value.runId)) &&
        typeof value.level === 'string' &&
        consoleLevels.has(value.level as PreviewConsoleLevel) &&
        Array.isArray(value.arguments) &&
        value.arguments.every((item) => typeof item === 'string') &&
        typeof value.timestamp === 'number' &&
        Number.isFinite(value.timestamp)
      );
    case 'preview:mutations':
      return isRunId(value.runId) && isMutationCounts(value.counts);
    case 'preview:ownership':
      return isRunId(value.runId) && isOwnershipSnapshot(value.snapshot);
    case 'preview:reactivity':
      return isRunId(value.runId) && isReactiveTraceEvent(value.event);
    default:
      return false;
  }
};

export const serializeError = (value: unknown): SerializedError => {
  if (value instanceof Error) {
    const withCode = value as Error & { readonly code?: unknown };
    return {
      name: value.name,
      message: value.message,
      ...(value.stack ? { stack: value.stack } : {}),
      ...(typeof withCode.code === 'string' ? { code: withCode.code } : {}),
    };
  }

  return {
    name: 'Error',
    message: typeof value === 'string' ? value : String(value),
  };
};
