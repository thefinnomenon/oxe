import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadTrialSuite, parseTrialJsonLines } from './trial-format.mjs';
import { runTrialMatrix } from './matrix-runner.mjs';

const values = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  const value = process.argv[index + 1];
  if (!name?.startsWith('--') || value === undefined)
    throw new TypeError('Arguments must be --name value pairs.');
  values.set(name.slice(2), value);
}

const knownArguments = new Set([
  'adapter',
  'arm',
  'concurrency',
  'evaluator',
  'max-output-tokens',
  'max-tool-calls',
  'max-total-tokens',
  'max-total-trials',
  'output',
  'seed',
  'synthetic',
  'timeout-ms',
  'trials',
]);
for (const name of values.keys())
  if (!knownArguments.has(name)) throw new TypeError(`Unknown argument --${name}.`);

const adapterPath = values.get('adapter');
const evaluatorPath = values.get('evaluator');
const outputPath = values.get('output');
if (!adapterPath || !evaluatorPath || !outputPath)
  throw new TypeError(
    'Usage: node run-trials.mjs --adapter module --evaluator module --output trials.jsonl [--trials 30] [--arm arm]',
  );

const integer = (name, fallback, { maximum = Number.MAX_SAFE_INTEGER, minimum = 0 } = {}) => {
  const value = Number(values.get(name) ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new TypeError(`--${name} must be an integer from ${minimum} through ${maximum}.`);
  return value;
};
const trials = integer('trials', 30, { minimum: 1 });
const concurrency = integer('concurrency', 1, { maximum: 8, minimum: 1 });
const seed = integer('seed', 2_026_091_300, { maximum: 0xffff_ffff, minimum: 0 });
const syntheticValue = values.get('synthetic') ?? 'false';
if (syntheticValue !== 'true' && syntheticValue !== 'false')
  throw new TypeError('--synthetic must be true or false.');
const synthetic = syntheticValue === 'true';
const limits = Object.freeze({
  maxOutputTokens: integer('max-output-tokens', 24_000, { minimum: 1 }),
  maxToolCalls: integer('max-tool-calls', 30, { maximum: 100, minimum: 1 }),
  maxTotalTokens: integer('max-total-tokens', 0, { minimum: 0 }),
  maxTotalTrials: integer('max-total-trials', 100, { minimum: 1 }),
  timeoutMs: integer('timeout-ms', 300_000, { minimum: 1_000 }),
});

const suite = await loadTrialSuite();
const requestedArm = values.get('arm');
const arms = requestedArm ? [requestedArm] : suite.arms;
for (const arm of arms)
  if (!suite.arms.includes(arm))
    throw new TypeError(`Unknown benchmark arm ${JSON.stringify(arm)}.`);

const adapter = await import(pathToFileURL(resolve(adapterPath)).href);
const evaluator = await import(pathToFileURL(resolve(evaluatorPath)).href);
if (typeof adapter.runTrial !== 'function') throw new TypeError('Adapter must export runTrial.');
if (typeof evaluator.evaluateTrial !== 'function')
  throw new TypeError('Evaluator must export evaluateTrial.');

let existingSource = '';
try {
  existingSource = await readFile(outputPath, 'utf8');
} catch (error) {
  if (!(error && typeof error === 'object' && error.code === 'ENOENT')) throw error;
}
const existing = parseTrialJsonLines(existingSource, suite);
if (existing.some((row) => (row.usageSource === 'synthetic') !== synthetic))
  throw new TypeError('Synthetic and provider trials cannot share an output file.');
const startingProviderTokens = existing.reduce(
  (total, row) => total + row.inputTokens + row.outputTokens,
  0,
);
await mkdir(dirname(resolve(outputPath)), { recursive: true });

const summary = await runTrialMatrix({
  adapter,
  append: (row) => appendFile(outputPath, `${JSON.stringify(row)}\n`, 'utf8'),
  arms,
  concurrency,
  evaluator,
  existing,
  limits,
  onProgress: (row) => process.stdout.write(`Recorded ${row.taskId}/${row.arm}/${row.trial}.\n`),
  seed,
  startingProviderTokens,
  suite,
  synthetic,
  trials,
});
process.stdout.write(`${JSON.stringify({ ...summary, seed, synthetic })}\n`);
