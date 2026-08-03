import { describe, expect, it } from 'vitest';

import {
  OXE_PLAYGROUND_PROTOCOL_VERSION,
  isCompileRequest,
  isCompileResult,
  isPreviewCommand,
  isPreviewEvent,
} from '../src/protocol.js';

describe('playground message protocol', () => {
  it('accepts a complete compiler result and rejects stale protocol versions', () => {
    const result = {
      type: 'compile-result',
      version: OXE_PLAYGROUND_PROTOCOL_VERSION,
      runId: 3,
      stage: 'complete',
      diagnostics: [],
      modules: [
        {
          moduleId: 'playground/App.oxe',
          astJson: '{}\n',
          tokenJson: '[]\n',
        },
      ],
      compileMilliseconds: 1.5,
      graphJson: '{}\n',
      factorySource: '(runtime, dom) => ({ runtime, dom })',
      moduleSource: 'export {}\n',
      mountExport: 'mountApp',
    };

    expect(isCompileResult(result)).toBe(true);
    expect(isCompileResult({ ...result, version: 1 })).toBe(false);
  });

  it('requires non-negative safe run ids and all compiler boundary names', () => {
    const request = {
      type: 'compile',
      version: OXE_PLAYGROUND_PROTOCOL_VERSION,
      runId: 0,
      entryModuleId: 'playground/App.oxe',
      entryExport: 'App',
      files: [
        { moduleId: 'playground/App.oxe', source: 'export App():\n  <main>\n' },
        { moduleId: 'playground/Card.oxe', source: 'export Card():\n  <article>\n' },
      ],
    };

    expect(isCompileRequest(request)).toBe(true);
    expect(isCompileRequest({ ...request, runId: -1 })).toBe(false);
    expect(isCompileRequest({ ...request, entryModuleId: undefined })).toBe(false);
    expect(isCompileRequest({ ...request, entryModuleId: 'playground/Missing.oxe' })).toBe(false);
    expect(isCompileRequest({ ...request, files: [...request.files, request.files[0]] })).toBe(
      false,
    );
  });

  it('validates both directions of preview messages', () => {
    expect(
      isPreviewCommand({
        type: 'preview:mount',
        version: OXE_PLAYGROUND_PROTOCOL_VERSION,
        runId: 7,
        factorySource: '() => ({})',
        mountExport: 'mountApp',
      }),
    ).toBe(true);
    expect(
      isPreviewCommand({
        type: 'preview:mount',
        version: OXE_PLAYGROUND_PROTOCOL_VERSION,
        runId: 7,
        factorySource: '() => ({})',
      }),
    ).toBe(false);

    expect(
      isPreviewEvent({
        type: 'preview:mutations',
        version: OXE_PLAYGROUND_PROTOCOL_VERSION,
        runId: 7,
        counts: {
          addedNodes: 1,
          attributes: 0,
          characterData: 2,
          childList: 1,
          removedNodes: 0,
        },
      }),
    ).toBe(true);
    expect(
      isPreviewEvent({
        type: 'preview:mutations',
        version: OXE_PLAYGROUND_PROTOCOL_VERSION,
        runId: 7,
        counts: { addedNodes: -1 },
      }),
    ).toBe(false);
  });
});
