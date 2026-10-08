export const runTrial = async ({ arm, seed, task, trial }) => ({
  candidate: {
    action: { kind: 'dryRun' },
    schemaVersion: 'oxe.ai-authoring-candidate.v1',
    taskId: task.id,
  },
  correctionTurns: 0,
  invalidMutations: 0,
  model: 'deterministic-dry-run',
  provider: 'synthetic',
  seed,
  toolCalls: arm === 'repository-source' ? 2 : 1,
  trial,
  usage: { inputTokens: 0, outputTokens: 0 },
});
