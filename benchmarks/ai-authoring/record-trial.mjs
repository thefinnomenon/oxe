import { appendFile, readFile } from 'node:fs/promises';

import { loadTrialSuite, parseTrialJsonLines, validateTrial } from './trial-format.mjs';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath)
  throw new TypeError('Usage: node record-trial.mjs <trial.json|-> <trials.jsonl>');

const input =
  inputPath === '-'
    ? await new Promise((resolve, reject) => {
        let value = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => (value += chunk));
        process.stdin.on('end', () => resolve(value));
        process.stdin.on('error', reject);
      })
    : await readFile(inputPath, 'utf8');
const suite = await loadTrialSuite();
const trial = validateTrial(JSON.parse(input), suite);
if (trial.usageSource !== 'provider')
  throw new TypeError('Synthetic dry-run rows cannot be recorded as controlled trial data.');
let existing = '';
try {
  existing = await readFile(outputPath, 'utf8');
} catch (error) {
  if (!(error && typeof error === 'object' && error.code === 'ENOENT')) throw error;
}
parseTrialJsonLines(`${existing}${JSON.stringify(trial)}\n`, suite);
await appendFile(outputPath, `${JSON.stringify(trial)}\n`, 'utf8');
process.stdout.write(`Recorded ${trial.taskId}/${trial.arm}/${trial.trial} in ${outputPath}.\n`);
