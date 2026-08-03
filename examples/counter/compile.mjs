import { readFile } from 'node:fs/promises';

import { analyzeSource, generateDomModuleSource } from '../../packages/compiler/dist/index.js';

const moduleId = 'examples/counter/App.oxe';
const source = await readFile(new URL('./App.oxe', import.meta.url), 'utf8');
const result = analyzeSource(source, moduleId, moduleId);

if (!result.graph) {
  process.stderr.write(`${JSON.stringify(result.diagnostics, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(generateDomModuleSource(result.graph));
}
