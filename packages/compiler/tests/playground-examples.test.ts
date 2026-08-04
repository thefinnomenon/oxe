import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { analyzeSource, generateDomArtifact } from '../src/index.js';

interface ExampleExpectation {
  readonly directory: string;
  readonly diagnostic?: string;
}

const examples: readonly ExampleExpectation[] = [
  { directory: 'component-composition' },
  { directory: 'composition-features' },
  { directory: 'context' },
  { directory: 'conditional-region' },
  { directory: 'conditional-values' },
  { directory: 'keyed-collection' },
  { directory: 'untrack-snapshot' },
  { directory: 'counter' },
  { directory: 'dom-attributes' },
  { directory: 'static' },
  { directory: 'derived' },
  { directory: 'batched' },
  { directory: 'diagnostics-unknown-name', diagnostic: 'OXE2002' },
  { directory: 'diagnostics-missing-context-provider', diagnostic: 'OXE2008' },
  { directory: 'diagnostics-cycle', diagnostic: 'OXE2004' },
  { directory: 'diagnostics-type-error', diagnostic: 'OXE2009' },
];

describe('playground examples', () => {
  for (const example of examples) {
    it(`${example.directory} matches its compiler expectation`, async () => {
      const moduleId = `examples/${example.directory}/App.oxe`;
      const source = await readFile(new URL(`../../../${moduleId}`, import.meta.url), 'utf8');
      const result = analyzeSource(source, moduleId, moduleId);

      if (example.diagnostic) {
        expect(result.graph).toBeUndefined();
        expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
          example.diagnostic,
        );
        return;
      }

      expect(result.diagnostics).toEqual([]);
      if (!result.graph) {
        throw new Error(`Expected ${moduleId} to produce a semantic graph.`);
      }
      const artifact = generateDomArtifact(result.graph);
      expect(artifact.mountExport).toBe('mountApp');
      expect(artifact.factorySource).not.toContain('innerHTML');
      expect(artifact.moduleSource).toContain("from '@oxe/runtime-dom';");
    });
  }
});
