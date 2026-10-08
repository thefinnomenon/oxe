import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const output = new URL('../dist/', import.meta.url);
await mkdir(output, { recursive: true });
const clientUrl = new URL('client.js', output);
await build({
  bundle: true,
  charset: 'utf8',
  entryPoints: [fileURLToPath(new URL('../src/client.ts', import.meta.url))],
  format: 'iife',
  legalComments: 'none',
  logLevel: 'silent',
  outfile: fileURLToPath(clientUrl),
  platform: 'browser',
  target: ['safari15'],
});
const clientSource = await readFile(clientUrl, 'utf8');
if (/^\s*(?:import|export)\s/mu.test(clientSource))
  throw new Error('Workspace browser bundle contains unresolved module syntax.');
const stylesSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const fingerprint = (source) => createHash('sha256').update(source).digest('hex').slice(0, 12);
const html = (await readFile(new URL('../index.html', import.meta.url), 'utf8'))
  .replace('href="/styles.css"', `href="/styles.css?v=${fingerprint(stylesSource)}"`)
  .replace('src="/client.js"', `src="/client.js?v=${fingerprint(clientSource)}"`);
await Promise.all([
  writeFile(new URL('index.html', output), html),
  writeFile(new URL('styles.css', output), stylesSource),
]);
