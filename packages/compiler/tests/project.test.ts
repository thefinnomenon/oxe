import { describe, expect, it } from 'vitest';

import {
  analyzeProject,
  generateDomFactorySource,
  type AnalyzeProjectResult,
} from '../src/index.js';

const project = async (
  files: Readonly<Record<string, string>>,
  entryModuleId = 'src/App.oxe',
  entryExport = 'App',
): Promise<{ readonly calls: readonly string[]; readonly result: AnalyzeProjectResult }> => {
  const calls: string[] = [];
  const result = await analyzeProject({
    entryExport,
    entryModuleId,
    loadModule: async (moduleId) => {
      calls.push(moduleId);
      return files[moduleId];
    },
  });
  return { calls, result };
};

const requireGraph = (result: AnalyzeProjectResult) => {
  if (!result.graph) {
    throw new Error(`Expected a project graph, received ${JSON.stringify(result.diagnostics)}.`);
  }
  return result.graph;
};

describe('OXE project analysis', () => {
  it('loads exact relative modules once and links exported components across module boundaries', async () => {
    const { calls, result } = await project({
      'src/App.oxe': `import { Card } from "./components/Card.oxe"

export App():
  title = "Hello"

  <main>
    <Card title={title}>
`,
      'src/components/Card.oxe': `export Card(title):
  <section>
    <h1>{title}

export Unused():
  <aside>Never generated

Private():
  <footer>Also never generated
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.entryModuleId).toBe('src/App.oxe');
    expect(result.modules.map((module) => module.moduleId)).toEqual([
      'src/App.oxe',
      'src/components/Card.oxe',
    ]);
    expect(calls).toEqual(['src/App.oxe', 'src/components/Card.oxe']);

    const graph = requireGraph(result);
    expect(graph.entryComponents).toEqual(['src/App.oxe#component/App']);
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'src/App.oxe#component/App/view/element[0]/instance[0]',
          kind: 'component-instance',
          componentId: 'src/components/Card.oxe#component/Card',
        }),
      ]),
    );

    const generated = generateDomFactorySource(graph);
    expect(generated).toContain('const Card = (document, props) => {');
    expect(generated).toContain('const App = (document) => {');
    expect(generated).not.toContain('Unused');
    expect(generated).not.toContain('Never generated');
    expect(generated).not.toContain('Private');
    expect(generated).not.toContain('Also never generated');
  });

  it('keeps only the explicitly selected exported component as the graph entry', async () => {
    const { result } = await project({
      'src/App.oxe': `export App():
  <main>App

export Story():
  <main>Story
`,
    });

    const graph = requireGraph(result);
    expect(graph.entryComponents).toEqual(['src/App.oxe#component/App']);
    expect(generateDomFactorySource(graph)).not.toContain('Story');
  });

  it('rejects missing modules and paths that escape the project root at the import site', async () => {
    const missing = await project({
      'src/App.oxe': `import { Card } from "./Card.oxe"

export App():
  <main>
`,
    });
    expect(missing.result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'OXE2016',
        message:
          'Cannot load imported module "src/Card.oxe". The path must name an existing .oxe file exactly.',
        span: expect.objectContaining({ fileName: 'src/App.oxe' }),
      }),
    ]);

    const escaped = await project({
      'src/App.oxe': `import { Card } from "../../Card.oxe"

export App():
  <main>
`,
    });
    expect(escaped.result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'OXE2016',
        message: 'OXE module ids cannot escape the project root.',
        span: expect.objectContaining({ fileName: 'src/App.oxe' }),
      }),
    ]);

    const inexactEntry = await project({}, 'src/App');
    expect(inexactEntry.calls).toEqual([]);
    expect(inexactEntry.result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'OXE2016',
        message: 'The OXE project entry must be an exact project-relative path ending in .oxe.',
      }),
    ]);
  });

  it('caches a shared transitive module across more than one exact import edge', async () => {
    const { calls, result } = await project({
      'src/App.oxe': `import { Card } from "./Card.oxe"
import { Layout } from "./Layout.oxe"

export App():
  <Layout>
`,
      'src/Card.oxe': `export Card():
  <article>Card
`,
      'src/Layout.oxe': `import { Card } from "./Card.oxe"

export Layout():
  <main>
    <Card>
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(calls).toEqual(['src/App.oxe', 'src/Card.oxe', 'src/Layout.oxe']);
    expect(calls.filter((moduleId) => moduleId === 'src/Card.oxe')).toHaveLength(1);
  });

  it('rejects import cycles with the exact normalized cycle path', async () => {
    const { calls, result } = await project({
      'src/App.oxe': `import { Card } from "./Card.oxe"

export App():
  <Card>
`,
      'src/Card.oxe': `import { App } from "./App.oxe"

export Card():
  <main>
`,
    });

    expect(calls).toEqual(['src/App.oxe', 'src/Card.oxe']);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'OXE2016',
        message: 'Import cycles are not supported: src/App.oxe -> src/Card.oxe -> src/App.oxe.',
        span: expect.objectContaining({ fileName: 'src/Card.oxe' }),
      }),
    ]);
  });

  it('requires explicit exports and a collision-free component namespace', async () => {
    const hidden = await project({
      'src/App.oxe': `import { Card } from "./Card.oxe"

export App():
  <Card>
`,
      'src/Card.oxe': `Card():
  <main>
`,
    });
    expect(hidden.result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'OXE2010',
        message: 'Module "src/Card.oxe" does not explicitly export component "Card".',
      }),
    ]);

    const collision = await project({
      'src/App.oxe': `import { Card } from "./Card.oxe"

Card():
  <aside>

export App():
  <Card>
`,
      'src/Card.oxe': `export Card():
  <main>
`,
    });
    expect(collision.result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'OXE2016',
        message: 'Imported component "Card" collides with another name in module "src/App.oxe".',
        related: [
          expect.objectContaining({ message: 'The existing name is declared or imported here.' }),
        ],
      }),
    ]);
  });

  it('requires an explicitly exported, prop-free selected entry', async () => {
    const notExported = await project({
      'src/App.oxe': `App():
  <main>
`,
    });
    expect(notExported.result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'OXE2017',
        message: 'Entry "App" must name an explicitly exported component in module "src/App.oxe".',
      }),
    ]);

    const withProps = await project({
      'src/App.oxe': `export App(title):
  <main>{title}
`,
    });
    expect(withProps.result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'OXE2017',
        message: 'Entry component "App" must not declare or consume props.',
      }),
    ]);
  });
});
