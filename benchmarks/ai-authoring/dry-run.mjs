import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as adapter from './dry-run-adapter.mjs';
import * as evaluator from './dry-run-evaluator.mjs';
import { loadTrialSuite, parseTrialJsonLines } from './trial-format.mjs';
import { runTrialMatrix } from './matrix-runner.mjs';

const root = await mkdtemp(join(tmpdir(), 'oxe-ai-authoring-dry-run-'));
const rows = [];
try {
  const suite = await loadTrialSuite();
  const summary = await runTrialMatrix({
    adapter,
    append: async (row) => rows.push(row),
    arms: suite.arms,
    concurrency: 3,
    evaluator,
    existing: [],
    limits: {
      maxOutputTokens: 1,
      maxToolCalls: 3,
      maxTotalTokens: 0,
      maxTotalTrials: 30,
      timeoutMs: 5_000,
    },
    seed: 2_026_091_300,
    suite,
    synthetic: true,
    trials: 1,
  });
  const source = rows.map((row) => JSON.stringify(row)).join('\n');
  parseTrialJsonLines(`${source}\n`, suite);
  process.stdout.write(`${JSON.stringify({ ...summary, validatedRows: rows.length })}\n`);
} finally {
  await rm(root, { force: true, recursive: true });
}
