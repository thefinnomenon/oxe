import { readFile } from 'node:fs/promises';

import { loadTrialSuite, parseTrialJsonLines, trialCoverage } from './trial-format.mjs';

const path = process.argv[2];
if (!path) throw new TypeError('Usage: node score-trials.mjs <trials.jsonl> [target-per-cell]');
const targetPerCell = process.argv[3] === undefined ? 30 : Number(process.argv[3]);
if (!Number.isSafeInteger(targetPerCell) || targetPerCell < 1)
  throw new TypeError('target-per-cell must be a positive integer.');

const suite = await loadTrialSuite();
const rows = parseTrialJsonLines(await readFile(path, 'utf8'), suite);
if (rows.some((row) => row.usageSource !== 'provider'))
  throw new TypeError('Synthetic dry-run rows cannot be scored as controlled trial data.');

const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;
const median = (values) => {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2
    : (ordered[middle] ?? 0);
};
const wilson95 = (successes, count) => {
  if (count === 0) return { high: 0, low: 0 };
  const z = 1.959963984540054;
  const rate = successes / count;
  const denominator = 1 + (z * z) / count;
  const center = (rate + (z * z) / (2 * count)) / denominator;
  const margin =
    (z / denominator) * Math.sqrt((rate * (1 - rate)) / count + (z * z) / (4 * count * count));
  return { high: center + margin, low: center - margin };
};
const summarize = (trials) => {
  const successes = trials.filter((trial) => trial.success).length;
  return {
    correctionTurnsMean: mean(trials.map((trial) => trial.correctionTurns)),
    inputTokensMean: mean(trials.map((trial) => trial.inputTokens)),
    invalidMutationsMean: mean(trials.map((trial) => trial.invalidMutations)),
    latencyMedianMs: median(trials.map((trial) => trial.latencyMs)),
    outputTokensMean: mean(trials.map((trial) => trial.outputTokens)),
    successRate: successes / trials.length,
    successRateWilson95: wilson95(successes, trials.length),
    toolCallsMean: mean(trials.map((trial) => trial.toolCalls)),
    trials: trials.length,
  };
};

const byArm = Object.fromEntries(
  suite.arms.map((arm) => {
    const trials = rows.filter((row) => row.arm === arm);
    return [arm, trials.length === 0 ? null : summarize(trials)];
  }),
);
const byTaskAndArm = Object.fromEntries(
  suite.tasks.map((task) => [
    task.id,
    Object.fromEntries(
      suite.arms.map((arm) => {
        const trials = rows.filter((row) => row.taskId === task.id && row.arm === arm);
        return [arm, trials.length === 0 ? null : summarize(trials)];
      }),
    ),
  ]),
);

process.stdout.write(
  `${JSON.stringify(
    {
      byArm,
      byTaskAndArm,
      coverage: trialCoverage(rows, suite, targetPerCell),
      schemaVersion: 'oxe.ai-authoring-score.v1',
    },
    null,
    2,
  )}\n`,
);
