const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const exactKeys = (value, allowed, location) => {
  for (const key of Object.keys(value).sort())
    if (!allowed.includes(key))
      throw new TypeError(`${location}: unknown field ${JSON.stringify(key)}.`);
};

export const validateAuthoringCandidate = (value, taskId, location = 'candidate') => {
  if (!isRecord(value)) throw new TypeError(`${location}: must be an object.`);
  exactKeys(value, ['action', 'schemaVersion', 'taskId'], location);
  if (value.schemaVersion !== 'oxe.ai-authoring-candidate.v1')
    throw new TypeError(`${location}: has an unsupported schemaVersion.`);
  if (value.taskId !== taskId)
    throw new TypeError(`${location}: taskId must be ${JSON.stringify(taskId)}.`);
  if (!isRecord(value.action)) throw new TypeError(`${location}.action: must be an object.`);
  if (value.action.kind === 'replaceGraph') {
    exactKeys(value.action, ['graph', 'kind'], `${location}.action`);
    if (!isRecord(value.action.graph))
      throw new TypeError(`${location}.action.graph: must be an object.`);
  } else if (value.action.kind === 'mutation') {
    exactKeys(value.action, ['batch', 'kind'], `${location}.action`);
    if (!isRecord(value.action.batch))
      throw new TypeError(`${location}.action.batch: must be an object.`);
  } else if (value.action.kind === 'protocol') {
    exactKeys(value.action, ['kind', 'request'], `${location}.action`);
    if (!isRecord(value.action.request))
      throw new TypeError(`${location}.action.request: must be an object.`);
  } else if (value.action.kind === 'dryRun') {
    exactKeys(value.action, ['kind'], `${location}.action`);
  } else {
    throw new TypeError(`${location}.action.kind: is unsupported.`);
  }
  return Object.freeze({ ...value, action: Object.freeze({ ...value.action }) });
};

export const parseAuthoringCandidate = (source, taskId, location = 'candidate') => {
  if (typeof source !== 'string' || source.length === 0)
    throw new TypeError(`${location}: must be non-empty JSON text.`);
  return validateAuthoringCandidate(JSON.parse(source), taskId, location);
};
