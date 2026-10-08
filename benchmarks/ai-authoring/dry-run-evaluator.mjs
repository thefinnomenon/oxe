import { validateAuthoringCandidate } from './candidate-format.mjs';

export const evaluateTrial = async ({ candidate: value, task }) => {
  const candidate = validateAuthoringCandidate(value, task.id);
  return candidate.action.kind === 'dryRun'
    ? { success: true }
    : { failureReason: 'Dry-run candidate action is invalid.', success: false };
};
