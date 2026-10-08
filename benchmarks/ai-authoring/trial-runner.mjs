import { validateTrial } from './trial-format.mjs';

const requiredInteger = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`Adapter ${name} must be a nonnegative integer.`);
  return value;
};

const requiredText = (value, name) => {
  if (typeof value !== 'string' || value.length === 0)
    throw new TypeError(`Adapter ${name} must be a non-empty string.`);
  return value;
};

export const runControlledTrial = async ({
  adapter,
  arm,
  evaluator,
  limits,
  now,
  seed,
  signal,
  suite,
  task,
  trial,
  usageSource = 'provider',
}) => {
  const startedAt = now();
  const publicTask = Object.freeze({ category: task.category, id: task.id, prompt: task.prompt });
  const result = await adapter.runTrial({
    arm,
    limits,
    seed,
    signal,
    task: publicTask,
    trial,
  });
  const latencyMs = now() - startedAt;
  if (!result || typeof result !== 'object' || !result.usage || typeof result.usage !== 'object')
    throw new TypeError('Adapter must return provider usage and a candidate artifact.');
  const evaluation =
    typeof result.failureReason === 'string'
      ? { failureReason: result.failureReason, success: false }
      : await evaluator.evaluateTrial({
          arm,
          candidate: result.candidate,
          signal,
          task: Object.freeze({ ...task }),
          trial,
        });
  if (!evaluation || typeof evaluation !== 'object' || typeof evaluation.success !== 'boolean')
    throw new TypeError('Evaluator must return a boolean success result.');
  const row = {
    arm,
    correctionTurns: requiredInteger(result.correctionTurns, 'correctionTurns'),
    inputTokens: requiredInteger(result.usage.inputTokens, 'usage.inputTokens'),
    invalidMutations: requiredInteger(result.invalidMutations, 'invalidMutations'),
    latencyMs,
    model: requiredText(result.model, 'model'),
    outputTokens: requiredInteger(result.usage.outputTokens, 'usage.outputTokens'),
    provider: requiredText(result.provider, 'provider'),
    success: evaluation.success,
    taskId: task.id,
    toolCalls: requiredInteger(result.toolCalls, 'toolCalls'),
    trial,
    usageSource,
    ...(!evaluation.success
      ? { failureReason: requiredText(evaluation.failureReason, 'evaluation.failureReason') }
      : {}),
    ...(Number.isSafeInteger(seed) && seed >= 0 ? { seed } : {}),
  };
  return validateTrial(row, suite);
};
