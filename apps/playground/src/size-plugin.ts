import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { relative, resolve, sep } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

import { analyzeProject, generateDomModuleSource } from '@oxe/compiler';
import {
  build,
  version as esbuildVersion,
  type BuildResult,
  type Metafile,
  type OnResolveArgs,
  type PluginBuild,
} from 'esbuild';
import type { Plugin } from 'vite';

import { capabilitiesForPlayground, isPlaygroundCapabilitySet } from './demo-capabilities.js';

import {
  OXE_SIZE_ENDPOINT,
  type OxeSizeDiagnostic,
  type OxeSizeFailure,
  type OxeSizeModuleContribution,
  type OxeSizeModuleKind,
  type OxeSizeReport,
  type OxeSizeRequest,
  type OxeSizeResponse,
  type OxeSizeSuccess,
} from './size-types.js';

const DEFAULT_MAX_REQUEST_BYTES = 128 * 1024;
const DEFAULT_MAX_CACHE_ENTRIES = 64;
const GENERATED_ENTRY = 'oxe-size:generated-app';
const GENERATED_NAMESPACE = 'oxe-size-generated';
const CACHE_VERSION = 'oxe-size-v2-project-es2022';

interface BundleOutput {
  readonly bytes: Uint8Array;
  readonly metafile: Metafile;
}

interface ContributionPair {
  minified: number;
  raw: number;
}

export interface OxeSizePluginOptions {
  readonly maxCacheEntries?: number;
  readonly maxRequestBytes?: number;
  /** Absolute repository root containing packages/runtime and packages/runtime-dom. */
  readonly repositoryRoot?: string;
}

export interface OxeSizeMeasurementService {
  measure(request: OxeSizeRequest): Promise<OxeSizeSuccess>;
}

export class OxeSizeRequestError extends Error {
  public readonly code: OxeSizeFailure['error']['code'];
  public readonly diagnostics: readonly OxeSizeDiagnostic[] | undefined;
  public readonly status: number;

  public constructor(
    status: number,
    code: OxeSizeFailure['error']['code'],
    message: string,
    diagnostics?: readonly OxeSizeDiagnostic[],
  ) {
    super(message);
    this.name = 'OxeSizeRequestError';
    this.status = status;
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

const isInside = (fileName: string, root: string): boolean => {
  const path = relative(root, fileName);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !path.startsWith(sep));
};

const findRepositoryRoot = (requested: string | undefined): string => {
  if (requested) {
    return resolve(requested);
  }

  const candidates = [process.cwd(), resolve(process.cwd(), '../..')];
  const match = candidates.find((candidate) =>
    existsSync(resolve(candidate, 'packages/runtime/src/index.ts')),
  );
  if (!match) {
    throw new Error('Could not locate the OXE repository root for bundle measurement.');
  }
  return match;
};

const bundleGeneratedSource = async (
  generatedSource: string,
  repositoryRoot: string,
  minify: boolean,
): Promise<BundleOutput> => {
  const runtimeEntry = resolve(repositoryRoot, 'packages/runtime/src/index.ts');
  const runtimeDomEntry = resolve(repositoryRoot, 'packages/runtime-dom/src/index.ts');

  const result: BuildResult<{ metafile: true; write: false }> = await build({
    absWorkingDir: repositoryRoot,
    bundle: true,
    charset: 'utf8',
    entryPoints: [GENERATED_ENTRY],
    format: 'esm',
    legalComments: 'none',
    logLevel: 'silent',
    metafile: true,
    minify,
    outfile: 'app.js',
    platform: 'browser',
    plugins: [
      {
        name: 'oxe-size-boundary',
        setup(context: PluginBuild) {
          context.onResolve({ filter: /^oxe-size:generated-app$/ }, () => ({
            path: GENERATED_ENTRY,
            namespace: GENERATED_NAMESPACE,
          }));
          context.onLoad({ filter: /.*/, namespace: GENERATED_NAMESPACE }, () => ({
            contents: generatedSource,
            loader: 'js',
            resolveDir: repositoryRoot,
          }));
          context.onResolve({ filter: /^@oxe\/runtime$/ }, () => ({ path: runtimeEntry }));
          context.onResolve({ filter: /^@oxe\/runtime-dom$/ }, () => ({
            path: runtimeDomEntry,
          }));
          context.onResolve(
            { filter: /.*/, namespace: GENERATED_NAMESPACE },
            (args: OnResolveArgs) => ({
              errors: [
                {
                  text:
                    `Generated OXE applications may import only @oxe/runtime and ` +
                    `@oxe/runtime-dom; received ${JSON.stringify(args.path)}.`,
                },
              ],
            }),
          );
          context.onResolve({ filter: /^[^./]/ }, (args: OnResolveArgs) => ({
            errors: [
              {
                text: `Measured runtime code contains an unsupported package import ${JSON.stringify(args.path)}.`,
              },
            ],
          }));
        },
      },
    ],
    sourcemap: false,
    target: ['es2022'],
    treeShaking: true,
    write: false,
  });

  const output = result.outputFiles[0];
  if (!output) {
    throw new Error('esbuild did not emit the measured application bundle.');
  }
  return { bytes: output.contents, metafile: result.metafile };
};

const contributionKind = (
  input: string,
  repositoryRoot: string,
  runtimeRoot: string,
  runtimeDomRoot: string,
): OxeSizeModuleKind => {
  if (input.includes(GENERATED_NAMESPACE) || input === GENERATED_ENTRY) {
    return 'generated-app';
  }
  const absolute = resolve(repositoryRoot, input);
  if (isInside(absolute, runtimeDomRoot)) {
    return 'runtime-dom';
  }
  if (isInside(absolute, runtimeRoot)) {
    return 'runtime';
  }
  throw new Error(`Unexpected input escaped the shipped-app measurement boundary: ${input}`);
};

const contributionId = (
  input: string,
  kind: OxeSizeModuleKind,
  repositoryRoot: string,
  runtimeRoot: string,
  runtimeDomRoot: string,
): string => {
  if (kind === 'generated-app') {
    return 'generated:App.oxe';
  }
  const root = kind === 'runtime' ? runtimeRoot : runtimeDomRoot;
  const packageName = kind === 'runtime' ? '@oxe/runtime' : '@oxe/runtime-dom';
  return `${packageName}/${relative(root, resolve(repositoryRoot, input)).split(sep).join('/')}`;
};

const outputContributions = (metafile: Metafile): Readonly<Record<string, number>> => {
  const output = Object.values(metafile.outputs)[0];
  if (!output) {
    throw new Error('esbuild metafile did not describe the measured bundle.');
  }
  return Object.fromEntries(
    Object.entries(output.inputs).map(([input, details]) => [input, details.bytesInOutput]),
  );
};

const buildAttribution = (
  raw: BundleOutput,
  minified: BundleOutput,
  repositoryRoot: string,
): OxeSizeReport['attribution'] => {
  const runtimeRoot = resolve(repositoryRoot, 'packages/runtime/src');
  const runtimeDomRoot = resolve(repositoryRoot, 'packages/runtime-dom/src');
  const pairs = new Map<string, ContributionPair>();

  for (const [input, bytes] of Object.entries(outputContributions(raw.metafile))) {
    pairs.set(input, { raw: bytes, minified: 0 });
  }
  for (const [input, bytes] of Object.entries(outputContributions(minified.metafile))) {
    const pair = pairs.get(input) ?? { raw: 0, minified: 0 };
    pair.minified = bytes;
    pairs.set(input, pair);
  }

  const modules: OxeSizeModuleContribution[] = [...pairs.entries()]
    .map(([input, bytes]) => {
      const kind = contributionKind(input, repositoryRoot, runtimeRoot, runtimeDomRoot);
      return {
        id: contributionId(input, kind, repositoryRoot, runtimeRoot, runtimeDomRoot),
        kind,
        raw: bytes.raw,
        minified: bytes.minified,
      };
    })
    .filter((module) => module.raw > 0 || module.minified > 0)
    .sort((left, right) => left.id.localeCompare(right.id));

  const attributedRaw = modules.reduce((total, module) => total + module.raw, 0);
  const attributedMinified = modules.reduce((total, module) => total + module.minified, 0);
  return {
    modules,
    unattributed: {
      raw: raw.bytes.byteLength - attributedRaw,
      minified: minified.bytes.byteLength - attributedMinified,
    },
  };
};

export const measureGeneratedAppBundle = async (
  generatedSource: string,
  repositoryRoot = findRepositoryRoot(undefined),
): Promise<OxeSizeReport> => {
  const [raw, minified] = await Promise.all([
    bundleGeneratedSource(generatedSource, repositoryRoot, false),
    bundleGeneratedSource(generatedSource, repositoryRoot, true),
  ]);

  return {
    schemaVersion: 'oxe.playground-size.v1',
    boundary: {
      scope: 'shipped-app-payload',
      includes: ['generated app', '@oxe/runtime', '@oxe/runtime-dom'],
      excludesTooling: ['@oxe/compiler', 'playground editor', 'Vite dev client'],
    },
    bytes: {
      raw: raw.bytes.byteLength,
      minified: minified.bytes.byteLength,
      gzip: gzipSync(minified.bytes, { level: 9 }).byteLength,
      brotli: brotliCompressSync(minified.bytes, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
      }).byteLength,
    },
    attribution: buildAttribution(raw, minified, repositoryRoot),
    methodology: {
      bundler: 'esbuild',
      bundlerVersion: esbuildVersion,
      compression: 'gzip-9 and brotli-11 over the complete minified bundle',
      format: 'esm',
      target: 'es2022',
      attribution: 'esbuild bytesInOutput; compressed bytes are bundle-wide only',
    },
  };
};

const validateRequest = (value: unknown): OxeSizeRequest => {
  if (!value || typeof value !== 'object') {
    throw new OxeSizeRequestError(400, 'INVALID_REQUEST', 'Expected a JSON request object.');
  }
  const request = value as {
    capabilitySet?: unknown;
    entryExport?: unknown;
    entryModuleId?: unknown;
    files?: unknown;
  };
  if (
    typeof request.entryExport !== 'string' ||
    typeof request.entryModuleId !== 'string' ||
    !Array.isArray(request.files)
  ) {
    throw new OxeSizeRequestError(
      400,
      'INVALID_REQUEST',
      'Expected "entryModuleId", "entryExport", and a "files" array.',
    );
  }
  if (request.capabilitySet !== undefined && !isPlaygroundCapabilitySet(request.capabilitySet)) {
    throw new OxeSizeRequestError(400, 'INVALID_REQUEST', 'Unknown Playground capability set.');
  }
  if (request.entryModuleId.length === 0 || request.entryModuleId.length > 512) {
    throw new OxeSizeRequestError(
      400,
      'INVALID_REQUEST',
      'The entryModuleId must contain between 1 and 512 characters.',
    );
  }
  if (request.entryExport.length === 0 || request.entryExport.length > 128) {
    throw new OxeSizeRequestError(
      400,
      'INVALID_REQUEST',
      'The entryExport must contain between 1 and 128 characters.',
    );
  }
  if (request.files.length === 0 || request.files.length > 64) {
    throw new OxeSizeRequestError(
      400,
      'INVALID_REQUEST',
      'The project must contain between 1 and 64 files.',
    );
  }
  const files = request.files.map((file, index) => {
    if (!file || typeof file !== 'object') {
      throw new OxeSizeRequestError(
        400,
        'INVALID_REQUEST',
        `Project file ${index + 1} must be an object.`,
      );
    }
    const candidate = file as { moduleId?: unknown; source?: unknown };
    if (
      typeof candidate.moduleId !== 'string' ||
      candidate.moduleId.length === 0 ||
      candidate.moduleId.length > 512 ||
      typeof candidate.source !== 'string'
    ) {
      throw new OxeSizeRequestError(
        400,
        'INVALID_REQUEST',
        `Project file ${index + 1} requires a valid moduleId and string source.`,
      );
    }
    return { moduleId: candidate.moduleId, source: candidate.source };
  });
  if (new Set(files.map((file) => file.moduleId)).size !== files.length) {
    throw new OxeSizeRequestError(400, 'INVALID_REQUEST', 'Project moduleIds must be unique.');
  }
  if (!files.some((file) => file.moduleId === request.entryModuleId)) {
    throw new OxeSizeRequestError(
      400,
      'INVALID_REQUEST',
      'The entryModuleId must identify one of the supplied project files.',
    );
  }
  return {
    ...(request.capabilitySet ? { capabilitySet: request.capabilitySet } : {}),
    entryModuleId: request.entryModuleId,
    entryExport: request.entryExport,
    files,
  };
};

const requestKey = (request: OxeSizeRequest): string => {
  const hash = createHash('sha256')
    .update(CACHE_VERSION)
    .update('\0')
    .update(esbuildVersion)
    .update('\0')
    .update(request.entryModuleId)
    .update('\0')
    .update(request.entryExport);
  hash.update('\0').update(request.capabilitySet ?? 'none');
  for (const file of [...request.files].sort((left, right) =>
    left.moduleId.localeCompare(right.moduleId),
  )) {
    hash.update('\0').update(file.moduleId).update('\0').update(file.source);
  }
  return hash.digest('hex');
};

export const createOxeSizeMeasurementService = (
  options: OxeSizePluginOptions = {},
): OxeSizeMeasurementService => {
  const repositoryRoot = findRepositoryRoot(options.repositoryRoot);
  const maxCacheEntries = options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
  const cache = new Map<string, OxeSizeSuccess>();
  const pending = new Map<string, Promise<OxeSizeSuccess>>();

  const measure = async (request: OxeSizeRequest): Promise<OxeSizeSuccess> => {
    const key = requestKey(request);
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }
    const existing = pending.get(key);
    if (existing) {
      return existing;
    }

    const work = (async (): Promise<OxeSizeSuccess> => {
      const sources = new Map(request.files.map((file) => [file.moduleId, file.source]));
      const analyzed = await analyzeProject({
        capabilities: capabilitiesForPlayground(request.capabilitySet),
        entryModuleId: request.entryModuleId,
        entryExport: request.entryExport,
        loadModule: async (moduleId) => sources.get(moduleId),
      });
      if (!analyzed.graph) {
        throw new OxeSizeRequestError(
          422,
          'COMPILE_DIAGNOSTICS',
          'Bundle size is available after the OXE source compiles successfully.',
          analyzed.diagnostics,
        );
      }
      const generatedSource = generateDomModuleSource(analyzed.graph);
      const success: OxeSizeSuccess = {
        ok: true,
        report: await measureGeneratedAppBundle(generatedSource, repositoryRoot),
      };
      cache.set(key, success);
      while (cache.size > maxCacheEntries) {
        const oldest = cache.keys().next().value as string | undefined;
        if (!oldest) {
          break;
        }
        cache.delete(oldest);
      }
      return success;
    })();
    pending.set(key, work);
    try {
      return await work;
    } finally {
      pending.delete(key);
    }
  };

  return { measure };
};

export const readLimitedJsonRequest = async (
  request: AsyncIterable<Uint8Array | string>,
  maxBytes = DEFAULT_MAX_REQUEST_BYTES,
  contentLength?: string,
): Promise<unknown> => {
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new OxeSizeRequestError(413, 'PAYLOAD_TOO_LARGE', 'The size request is too large.');
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maxBytes) {
      throw new OxeSizeRequestError(413, 'PAYLOAD_TOO_LARGE', 'The size request is too large.');
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new OxeSizeRequestError(400, 'INVALID_REQUEST', 'Expected a valid JSON request body.');
  }
};

const sendJson = (response: ServerResponse, status: number, body: OxeSizeResponse): void => {
  const serialized = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(serialized);
};

export const createOxeSizeRequestHandler = (
  options: OxeSizePluginOptions = {},
): ((
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void) => {
  const service = createOxeSizeMeasurementService(options);
  const maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;

  return (request, response, next): void => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname !== OXE_SIZE_ENDPOINT) {
      next();
      return;
    }
    void (async () => {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        throw new OxeSizeRequestError(405, 'METHOD_NOT_ALLOWED', 'Use POST for size requests.');
      }
      if (!(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
        throw new OxeSizeRequestError(
          415,
          'UNSUPPORTED_MEDIA_TYPE',
          'Size requests must use application/json.',
        );
      }
      const body = await readLimitedJsonRequest(
        request,
        maxRequestBytes,
        request.headers['content-length'],
      );
      const success = await service.measure(validateRequest(body));
      sendJson(response, 200, success);
    })().catch((error: unknown) => {
      if (error instanceof OxeSizeRequestError) {
        const failure: OxeSizeFailure = {
          ok: false,
          error: { code: error.code, message: error.message },
          ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}),
        };
        sendJson(response, error.status, failure);
        request.resume();
        return;
      }
      sendJson(response, 500, {
        ok: false,
        error: {
          code: 'BUNDLE_FAILED',
          message: error instanceof Error ? error.message : 'Bundle measurement failed.',
        },
      });
    });
  };
};

export const oxeSizePlugin = (options: OxeSizePluginOptions = {}): Plugin => ({
  name: 'oxe:playground-size',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use(createOxeSizeRequestHandler(options));
  },
});
