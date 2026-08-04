import type { PlaygroundCapabilitySet } from './demo-capabilities.js';

export const OXE_SIZE_ENDPOINT = '/__oxe/size';

export interface OxeSizeProjectFile {
  readonly moduleId: string;
  readonly source: string;
}

export interface OxeSizeRequest {
  readonly capabilitySet?: PlaygroundCapabilitySet;
  readonly entryExport: string;
  readonly entryModuleId: string;
  readonly files: readonly OxeSizeProjectFile[];
}

export interface OxeSizeBytes {
  /** Unminified, tree-shaken application bundle. */
  readonly raw: number;
  /** Minified, tree-shaken application bundle. */
  readonly minified: number;
  /** Gzip level 9 applied to the minified bundle. */
  readonly gzip: number;
  /** Brotli quality 11 applied to the minified bundle. */
  readonly brotli: number;
}

export type OxeSizeModuleKind = 'generated-app' | 'runtime' | 'runtime-dom';

export interface OxeSizeModuleContribution {
  readonly id: string;
  readonly kind: OxeSizeModuleKind;
  /** esbuild attribution before minification. Contributions are not compressed independently. */
  readonly raw: number;
  /** esbuild attribution after minification. Contributions are not compressed independently. */
  readonly minified: number;
}

export interface OxeSizeAttribution {
  readonly modules: readonly OxeSizeModuleContribution[];
  /** Bundle syntax which esbuild does not attribute to an individual input. */
  readonly unattributed: {
    readonly raw: number;
    readonly minified: number;
  };
}

export interface OxeSizeBoundary {
  readonly scope: 'shipped-app-payload';
  readonly includes: readonly ['generated app', '@oxe/runtime', '@oxe/runtime-dom'];
  readonly excludesTooling: readonly ['@oxe/compiler', 'playground editor', 'Vite dev client'];
}

export interface OxeSizeMethodology {
  readonly bundler: 'esbuild';
  readonly bundlerVersion: string;
  readonly compression: 'gzip-9 and brotli-11 over the complete minified bundle';
  readonly format: 'esm';
  readonly target: 'es2022';
  readonly attribution: 'esbuild bytesInOutput; compressed bytes are bundle-wide only';
}

export interface OxeSizeReport {
  readonly schemaVersion: 'oxe.playground-size.v1';
  readonly boundary: OxeSizeBoundary;
  readonly bytes: OxeSizeBytes;
  readonly attribution: OxeSizeAttribution;
  readonly methodology: OxeSizeMethodology;
}

export interface OxeSizePosition {
  readonly column: number;
  readonly line: number;
  readonly offset: number;
}

export interface OxeSizeSpan {
  readonly fileName: string;
  readonly start: OxeSizePosition;
  readonly end: OxeSizePosition;
}

export interface OxeSizeDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: 'error';
  readonly span: OxeSizeSpan;
}

export interface OxeSizeSuccess {
  readonly ok: true;
  readonly report: OxeSizeReport;
}

export type OxeSizeErrorCode =
  | 'BUNDLE_FAILED'
  | 'COMPILE_DIAGNOSTICS'
  | 'INVALID_REQUEST'
  | 'METHOD_NOT_ALLOWED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE';

export interface OxeSizeFailure {
  readonly ok: false;
  readonly error: {
    readonly code: OxeSizeErrorCode;
    readonly message: string;
  };
  readonly diagnostics?: readonly OxeSizeDiagnostic[];
}

export type OxeSizeResponse = OxeSizeSuccess | OxeSizeFailure;
