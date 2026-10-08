import { runControlledTrial } from './trial-runner.mjs';

const identity = ({ arm, taskId, trial }) => `${taskId}\u0000${arm}\u0000${trial}`;

const random = (seed) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

export const createTrialSchedule = ({ arms, existing = [], seed, suite, trials }) => {
  const completed = new Set(existing.map(identity));
  const schedule = suite.tasks.flatMap((task) =>
    arms.flatMap((arm) =>
      Array.from({ length: trials }, (_, index) => ({
        arm,
        seed:
          (seed +
            index +
            1 +
            suite.tasks.indexOf(task) * 10_000 +
            suite.arms.indexOf(arm) * 1_000) >>>
          0,
        task,
        taskId: task.id,
        trial: index + 1,
      })),
    ),
  );
  const next = random(seed);
  for (let index = schedule.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1));
    [schedule[index], schedule[swap]] = [schedule[swap], schedule[index]];
  }
  return Object.freeze(schedule.filter((item) => !completed.has(identity(item))));
};

const withTimeout = async (milliseconds, run) => {
  const controller = new AbortController();
  const reason = new Error(`Trial exceeded ${milliseconds} milliseconds.`);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(reason);
      reject(reason);
    }, milliseconds);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
};

export const runTrialMatrix = async ({
  adapter,
  append,
  arms,
  concurrency,
  evaluator,
  existing,
  limits,
  now = performance.now.bind(performance),
  onProgress = () => undefined,
  startingProviderTokens = 0,
  seed,
  suite,
  synthetic = false,
  trials,
}) => {
  const schedule = createTrialSchedule({ arms, existing, seed, suite, trials });
  if (schedule.length > limits.maxTotalTrials)
    throw new RangeError(
      `Schedule has ${schedule.length} unrecorded trials; --max-total-trials is ${limits.maxTotalTrials}.`,
    );
  let completed = 0;
  let providerTokens = startingProviderTokens;
  let stoppedByTokenBudget = false;
  if (limits.maxTotalTokens > 0 && providerTokens >= limits.maxTotalTokens)
    return Object.freeze({
      completed,
      providerTokens,
      scheduled: schedule.length,
      stoppedByTokenBudget: schedule.length > 0,
    });
  for (let index = 0; index < schedule.length; index += concurrency) {
    const batch = schedule.slice(index, index + concurrency);
    const outcomes = await Promise.allSettled(
      batch.map((item) =>
        withTimeout(limits.timeoutMs, (signal) =>
          runControlledTrial({
            adapter,
            arm: item.arm,
            evaluator,
            limits,
            now,
            seed: item.seed,
            signal,
            suite,
            task: item.task,
            trial: item.trial,
            usageSource: synthetic ? 'synthetic' : 'provider',
          }),
        ),
      ),
    );
    const rows = outcomes
      .filter((outcome) => outcome.status === 'fulfilled')
      .map((outcome) => outcome.value);
    for (const row of rows) {
      await append(row);
      completed += 1;
      providerTokens += row.inputTokens + row.outputTokens;
      onProgress(row);
    }
    const failure = outcomes.find((outcome) => outcome.status === 'rejected');
    if (failure) throw failure.reason;
    if (limits.maxTotalTokens > 0 && providerTokens >= limits.maxTotalTokens) {
      stoppedByTokenBudget = index + batch.length < schedule.length;
      break;
    }
  }
  return Object.freeze({
    completed,
    providerTokens,
    scheduled: schedule.length,
    stoppedByTokenBudget,
  });
};
