import { describe, expect, it } from 'vitest';
import { createFileRouteManifest } from '@oxe/router';

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
    expect(isCompileRequest({ ...request, capabilitySet: 'async-users' })).toBe(true);
    expect(isCompileRequest({ ...request, capabilitySet: 'server-projects' })).toBe(true);
    expect(isCompileRequest({ ...request, capabilitySet: 'unknown' })).toBe(false);
    expect(isCompileRequest({ ...request, runId: -1 })).toBe(false);
    expect(isCompileRequest({ ...request, entryModuleId: undefined })).toBe(false);
    expect(isCompileRequest({ ...request, entryModuleId: 'playground/Missing.oxe' })).toBe(false);
    expect(isCompileRequest({ ...request, files: [...request.files, request.files[0]] })).toBe(
      false,
    );
    expect(isCompileRequest({ ...request, routeInitialHref: '/projects/alpha' })).toBe(true);
  });

  it('validates independently compiled filesystem route bundles', () => {
    const manifest = createFileRouteManifest([
      'src/routes/layout.oxe',
      'src/routes/page.oxe',
      'src/routes/projects/[projectId]/page.oxe',
    ]);
    const routeBundle = {
      initialHref: '/projects/alpha',
      manifest,
      segments: manifest.routes
        .flatMap((route) => route.segments)
        .filter(
          (segment, index, segments) =>
            segments.findIndex((candidate) => candidate.id === segment.id) === index,
        )
        .map((segment) => ({
          id: segment.id,
          factorySource: '() => ({})',
          routeSegmentExport:
            segment.kind === 'layout' ? 'buildLayoutRouteSegment' : 'buildPageRouteSegment',
        })),
    };

    const command = {
      type: 'preview:mount',
      version: OXE_PLAYGROUND_PROTOCOL_VERSION,
      runId: 8,
      routeBundle,
    };
    expect(isPreviewCommand(command)).toBe(true);
    expect(
      isPreviewCommand({
        ...command,
        routeBundle: { ...routeBundle, segments: routeBundle.segments.slice(1) },
      }),
    ).toBe(false);
    expect(
      isPreviewCommand({
        ...command,
        routeBundle: {
          ...routeBundle,
          manifest: { ...routeBundle.manifest, trailingSlash: 'always' },
        },
      }),
    ).toBe(false);
  });

  it('validates both directions of preview messages', () => {
    expect(
      isPreviewCommand({
        type: 'preview:mount',
        version: OXE_PLAYGROUND_PROTOCOL_VERSION,
        runId: 7,
        factorySource: '() => ({})',
        mountExport: 'mountApp',
        capabilitySet: 'server-projects',
      }),
    ).toBe(true);
    expect(
      isPreviewCommand({
        type: 'preview:mount',
        version: OXE_PLAYGROUND_PROTOCOL_VERSION,
        runId: 7,
        factorySource: '() => ({})',
        mountExport: 'mountApp',
        capabilitySet: 'unknown',
      }),
    ).toBe(false);
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

    expect(
      isPreviewEvent({
        type: 'preview:reactivity',
        version: OXE_PLAYGROUND_PROTOCOL_VERSION,
        runId: 7,
        event: {
          kind: 'invalidate',
          reason: 'profile.name changed',
          source: { id: 'cell:profile', name: 'profile', path: ['name'] },
          computation: { id: 'text:name', kind: 'derived', name: 'profile.name text' },
          timestamp: 12.5,
        },
      }),
    ).toBe(true);
    expect(
      isPreviewEvent({
        type: 'preview:reactivity',
        version: OXE_PLAYGROUND_PROTOCOL_VERSION,
        runId: 7,
        event: {
          kind: 'invalidate',
          reason: 'invalid path',
          source: { name: 'profile', path: [1] },
          timestamp: 12.5,
        },
      }),
    ).toBe(false);

    const ownershipEvent = {
      type: 'preview:ownership',
      version: OXE_PLAYGROUND_PROTOCOL_VERSION,
      runId: 7,
      snapshot: {
        timestamp: 12.5,
        summary: {
          contexts: 0,
          derived: 0,
          owners: 1,
          reactions: 0,
          resources: 1,
          roots: 1,
        },
        owners: [
          {
            childCount: 0,
            id: 1,
            kind: 'root',
            name: 'DOM mount',
            resources: [{ kind: 'event-listener', name: 'click' }],
          },
        ],
      },
    };
    expect(isPreviewEvent(ownershipEvent)).toBe(true);
    expect(
      isPreviewEvent({
        ...ownershipEvent,
        snapshot: {
          ...ownershipEvent.snapshot,
          owners: [{ ...ownershipEvent.snapshot.owners[0], kind: 'unknown-owner' }],
        },
      }),
    ).toBe(false);
  });
});
