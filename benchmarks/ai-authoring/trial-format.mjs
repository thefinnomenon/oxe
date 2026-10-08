import { readFile } from 'node:fs/promises';

const REQUIRED_FIELDS = [
  'arm',
  'correctionTurns',
  'inputTokens',
  'invalidMutations',
  'latencyMs',
  'model',
  'outputTokens',
  'provider',
  'success',
  'taskId',
  'toolCalls',
  'trial',
  'usageSource',
];

const OPTIONAL_FIELDS = ['failureReason', 'notes', 'seed', 'startedAt'];

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const fail = (location, message) => {
  throw new TypeError(`${location}: ${message}`);
};

export const validateTrialSuite = (value, location = 'task suite') => {
  if (!isRecord(value)) fail(location, 'must be an object.');
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'arms,schemaVersion,tasks')
    fail(location, 'has unknown or missing fields.');
  if (value.schemaVersion !== 'oxe.ai-authoring-task-suite.v1')
    fail(location, 'has an unsupported schemaVersion.');
  if (!Array.isArray(value.arms) || value.arms.length < 2)
    fail(location, 'arms must contain at least two entries.');
  if (value.arms.some((arm) => typeof arm !== 'string' || arm.length === 0))
    fail(location, 'arms must be non-empty strings.');
  if (new Set(value.arms).size !== value.arms.length) fail(location, 'arms must be unique.');
  if (!Array.isArray(value.tasks) || value.tasks.length === 0)
    fail(location, 'tasks must be a non-empty array.');
  const taskIds = new Set();
  value.tasks.forEach((task, index) => {
    const taskLocation = `${location}.tasks[${index}]`;
    if (!isRecord(task)) fail(taskLocation, 'must be an object.');
    if (Object.keys(task).sort().join(',') !== 'category,expected,id,prompt')
      fail(taskLocation, 'has unknown or missing fields.');
    for (const field of ['category', 'id', 'prompt'])
      if (typeof task[field] !== 'string' || task[field].length === 0)
        fail(taskLocation, `${field} must be a non-empty string.`);
    if (taskIds.has(task.id)) fail(taskLocation, `duplicate task id ${JSON.stringify(task.id)}.`);
    taskIds.add(task.id);
    if (
      !Array.isArray(task.expected) ||
      task.expected.length === 0 ||
      task.expected.some(
        (expectation) => typeof expectation !== 'string' || expectation.length === 0,
      )
    )
      fail(taskLocation, 'expected must contain non-empty assertions.');
  });
  return Object.freeze({
    arms: Object.freeze([...value.arms]),
    schemaVersion: value.schemaVersion,
    tasks: Object.freeze(
      value.tasks.map((task) =>
        Object.freeze({ ...task, expected: Object.freeze([...task.expected]) }),
      ),
    ),
  });
};

export const loadTrialSuite = async (url = new URL('./tasks.json', import.meta.url)) =>
  validateTrialSuite(JSON.parse(await readFile(url, 'utf8')));

export const validateTrial = (value, suite, location = 'trial') => {
  if (!isRecord(value)) fail(location, 'record must be an object.');
  const allowed = new Set([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]);
  for (const key of Object.keys(value).sort())
    if (!allowed.has(key)) fail(location, `unknown field ${JSON.stringify(key)}.`);
  for (const field of REQUIRED_FIELDS) if (!(field in value)) fail(location, `missing ${field}.`);

  const arms = new Set(suite.arms);
  const tasks = new Set(suite.tasks.map((task) => task.id));
  if (typeof value.arm !== 'string' || !arms.has(value.arm))
    fail(location, `arm must be one of ${suite.arms.join(', ')}.`);
  if (typeof value.taskId !== 'string' || !tasks.has(value.taskId))
    fail(location, `taskId ${JSON.stringify(value.taskId)} is not in the task suite.`);
  if (typeof value.success !== 'boolean') fail(location, 'success must be boolean.');
  if (value.usageSource !== 'provider' && value.usageSource !== 'synthetic')
    fail(location, 'usageSource must be "provider" or "synthetic".');
  if (value.usageSource === 'synthetic' && value.provider !== 'synthetic')
    fail(location, 'synthetic usage must name the synthetic provider.');
  for (const field of [
    'correctionTurns',
    'inputTokens',
    'invalidMutations',
    'outputTokens',
    'toolCalls',
  ])
    if (!Number.isSafeInteger(value[field]) || value[field] < 0)
      fail(location, `${field} must be a nonnegative integer.`);
  if (!Number.isFinite(value.latencyMs) || value.latencyMs < 0)
    fail(location, 'latencyMs must be a finite nonnegative number.');
  if (!Number.isSafeInteger(value.trial) || value.trial < 1)
    fail(location, 'trial must be a positive integer.');
  if ('seed' in value && (!Number.isSafeInteger(value.seed) || value.seed < 0))
    fail(location, 'seed must be a nonnegative integer.');
  for (const field of ['failureReason', 'model', 'notes', 'provider', 'startedAt'])
    if (field in value && (typeof value[field] !== 'string' || value[field].length === 0))
      fail(location, `${field} must be a non-empty string when present.`);
  if (value.success && 'failureReason' in value)
    fail(location, 'successful trials cannot include failureReason.');
  if (!value.success && !('failureReason' in value))
    fail(location, 'failed trials must include failureReason.');
  return Object.freeze({ ...value });
};

export const parseTrialJsonLines = (text, suite) => {
  const rows = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => validateTrial(JSON.parse(line), suite, `trial line ${index + 1}`));
  const identities = new Set();
  for (const row of rows) {
    const identity = `${row.taskId}\u0000${row.arm}\u0000${row.trial}`;
    if (identities.has(identity))
      fail(
        'trial collection',
        `duplicate task/arm/trial identity ${row.taskId}/${row.arm}/${row.trial}.`,
      );
    identities.add(identity);
  }
  return Object.freeze(rows);
};

export const trialCoverage = (rows, suite, targetPerCell = 30) => {
  const cells = suite.tasks.flatMap((task) =>
    suite.arms.map((arm) => {
      const trials = rows.filter((row) => row.taskId === task.id && row.arm === arm).length;
      return Object.freeze({
        arm,
        complete: trials >= targetPerCell,
        target: targetPerCell,
        taskId: task.id,
        trials,
      });
    }),
  );
  return Object.freeze({
    balanced: cells.every((cell) => cell.complete),
    cells: Object.freeze(cells),
    targetPerCell,
  });
};
