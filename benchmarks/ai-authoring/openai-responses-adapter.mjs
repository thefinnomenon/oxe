import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAuthoringCandidate } from './candidate-format.mjs';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const graphPath = 'examples/application-graph-todo/graph.json';
const repositoryFiles = Object.freeze([
  graphPath,
  'examples/application-graph-todo/README.md',
  'docs/application-graph-architecture.md',
  'packages/graph/src/application-mutate.ts',
  'packages/graph/src/application-types.ts',
]);

const tool = (name, description, properties, required = Object.keys(properties)) => ({
  type: 'function',
  name,
  description,
  parameters: { additionalProperties: false, properties, required, type: 'object' },
  strict: true,
});

const submitTool = tool(
  'submit_candidate',
  'Submit the final oxe.ai-authoring-candidate.v1 object as JSON text.',
  { candidateJson: { type: 'string' } },
);

const normalizedTools = Object.freeze([
  tool('validate_graph', 'Structurally and semantically validate a proposed normalized graph.', {
    graphJson: { type: 'string' },
  }),
  submitTool,
]);

const compactTools = Object.freeze([
  tool('inspect_graph', 'Inspect the semantic graph without loading normalized JSON.', {
    kind: { enum: ['map', 'search', 'node', 'incoming'], type: 'string' },
    query: { type: 'string' },
    semanticId: { type: 'string' },
  }),
  tool(
    'preview_mutation',
    'Validate and inspect one atomic semantic mutation without committing it.',
    {
      batchJson: { type: 'string' },
    },
  ),
  submitTool,
]);

const repositoryTools = Object.freeze([
  tool('list_files', 'List the files available in the isolated repository fixture.', {}, []),
  tool('read_file', 'Read one available UTF-8 repository file.', { path: { type: 'string' } }),
  tool('search_files', 'Search available repository files for a literal text fragment.', {
    query: { type: 'string' },
  }),
  tool('write_file', 'Replace an editable UTF-8 file in the isolated fixture.', {
    content: { type: 'string' },
    path: { type: 'string' },
  }),
  tool(
    'validate_graph',
    'Validate the current authoritative graph in the isolated fixture.',
    {},
    [],
  ),
  tool(
    'finish_repository',
    'Submit the current authoritative graph file from the isolated repository.',
    {},
    [],
  ),
  submitTool,
]);

const candidateInstructions = (taskId) => `Your final artifact must use exactly this envelope:
{"schemaVersion":"oxe.ai-authoring-candidate.v1","taskId":${JSON.stringify(taskId)},"action":...}
The action must be one of:
- {"kind":"mutation","batch":{...}}
- {"kind":"replaceGraph","graph":{...}}
- {"kind":"protocol","request":{...}}
Submit it with submit_candidate. Do not claim success in prose.`;

const systemInstructions = `You are participating in a controlled application-authoring benchmark.
Complete the requested change autonomously. Preserve unrelated behavior and stable semantic IDs.
Use only the tools and representation supplied for this arm. Never infer access to hidden evaluator assertions.
Inspect narrowly, preview semantic mutations when that tool is available, and fix invalid attempts before submitting.`;

const exactFixturePath = (root, path) => {
  if (typeof path !== 'string' || !repositoryFiles.includes(path))
    throw new TypeError('Path is not available in the repository fixture.');
  const target = resolve(root, normalize(path));
  const within = relative(root, target);
  if (within.startsWith('..') || within === '') throw new TypeError('Fixture path is invalid.');
  return target;
};

const createRepositoryFixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'oxe-ai-authoring-adapter-'));
  for (const path of repositoryFiles) {
    const target = exactFixturePath(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(resolve(repositoryRoot, path), 'utf8'), 'utf8');
  }
  return root;
};

const outputText = (response) =>
  response.output
    .filter((item) => item?.type === 'message' && Array.isArray(item.content))
    .flatMap((item) => item.content)
    .filter((item) => item?.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('');

const requireResponse = (value) => {
  if (!value || typeof value !== 'object' || !Array.isArray(value.output))
    throw new TypeError('OpenAI returned an invalid Responses API payload.');
  const usage = value.usage;
  if (
    !usage ||
    typeof usage !== 'object' ||
    !Number.isSafeInteger(usage.input_tokens) ||
    usage.input_tokens < 0 ||
    !Number.isSafeInteger(usage.output_tokens) ||
    usage.output_tokens < 0
  )
    throw new TypeError('OpenAI response omitted exact token usage.');
  return value;
};

const jsonResult = (value) => JSON.stringify(value).slice(0, 60_000);

const compactContext = async () => {
  const graphModule = await import('../../packages/graph/dist/index.js');
  const source = JSON.parse(await readFile(resolve(repositoryRoot, graphPath), 'utf8'));
  const graph = graphModule.loadApplicationGraph(source);
  return { graph, graphModule, projection: graphModule.projectCompactApplicationGraph(graph) };
};

const compactToolCall = (context, name, argumentsValue) => {
  if (name === 'inspect_graph') {
    const index = context.graphModule.indexApplicationGraph(context.graph);
    if (argumentsValue.kind === 'map') return { projection: context.projection };
    if (argumentsValue.kind === 'search') {
      const query = String(argumentsValue.query).toLowerCase();
      return {
        nodes: index.nodes
          .filter((node) => `${node.id}\n${node.bodyJson}`.toLowerCase().includes(query))
          .slice(0, 30),
      };
    }
    const node = index.nodes.find((candidate) => candidate.id === argumentsValue.semanticId);
    if (argumentsValue.kind === 'node')
      return node
        ? {
            incoming: index.references.filter((edge) => edge.targetId === node.id),
            node,
            outgoing: index.references.filter((edge) => edge.sourceId === node.id),
          }
        : { error: 'Semantic node does not exist.' };
    return {
      references: index.references.filter((edge) => edge.targetId === argumentsValue.semanticId),
    };
  }
  if (name === 'preview_mutation') {
    const preview = context.graphModule.previewApplicationMutation(
      context.graph,
      JSON.parse(argumentsValue.batchJson),
    );
    return preview.ok
      ? {
          changes: preview.result.changes,
          impact: preview.impact,
          ok: true,
          revision: preview.result.graph.revision,
        }
      : {
          diagnostics: preview.result.diagnostics,
          incomingReferences: preview.incomingReferences,
          ok: false,
        };
  }
  throw new TypeError(`Unsupported compact tool ${JSON.stringify(name)}.`);
};

const validateGraphText = (context, source) => {
  try {
    const value = JSON.parse(source);
    const diagnostics = context.graphModule.validateApplicationGraph(value);
    return diagnostics.length === 0 ? { ok: true } : { diagnostics, ok: false };
  } catch (error) {
    return {
      diagnostics: [
        { message: error instanceof Error ? error.message : 'Graph JSON is invalid.', path: '$' },
      ],
      ok: false,
    };
  }
};

const repositoryToolCall = async (context, root, name, argumentsValue, taskId) => {
  if (name === 'list_files') return { files: repositoryFiles };
  if (name === 'read_file')
    return { content: await readFile(exactFixturePath(root, argumentsValue.path), 'utf8') };
  if (name === 'search_files') {
    if (typeof argumentsValue.query !== 'string' || argumentsValue.query.length === 0)
      throw new TypeError('Search query must be non-empty.');
    const matches = [];
    for (const path of repositoryFiles) {
      const lines = (await readFile(exactFixturePath(root, path), 'utf8')).split(/\r?\n/u);
      lines.forEach((line, index) => {
        if (matches.length < 80 && line.includes(argumentsValue.query))
          matches.push({ line: index + 1, path, text: line.slice(0, 500) });
      });
    }
    return { matches };
  }
  if (name === 'write_file') {
    if (argumentsValue.path !== graphPath)
      throw new TypeError('Only the authoritative application graph is editable in this fixture.');
    if (typeof argumentsValue.content !== 'string' || argumentsValue.content.length > 1_000_000)
      throw new TypeError('Editable file content must be UTF-8 text no larger than 1 MB.');
    JSON.parse(argumentsValue.content);
    await writeFile(exactFixturePath(root, argumentsValue.path), argumentsValue.content, 'utf8');
    return { bytes: Buffer.byteLength(argumentsValue.content), written: argumentsValue.path };
  }
  if (name === 'validate_graph')
    return validateGraphText(context, await readFile(exactFixturePath(root, graphPath), 'utf8'));
  if (name === 'finish_repository')
    return parseAuthoringCandidate(
      JSON.stringify({
        action: {
          graph: JSON.parse(await readFile(exactFixturePath(root, graphPath), 'utf8')),
          kind: 'replaceGraph',
        },
        schemaVersion: 'oxe.ai-authoring-candidate.v1',
        taskId,
      }),
      taskId,
    );
  throw new TypeError(`Unsupported repository tool ${JSON.stringify(name)}.`);
};

const requestOpenAI = async ({ apiKey, body, signal }) => {
  const response = await fetch('https://api.openai.com/v1/responses', {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'user-agent': 'oxe-ai-authoring-benchmark/1',
    },
    method: 'POST',
    signal,
  });
  if (!response.ok) {
    let code = 'unknown';
    try {
      const payload = await response.json();
      if (typeof payload?.error?.code === 'string') code = payload.error.code;
    } catch {
      // The status and provider error code are sufficient and avoid logging response bodies.
    }
    throw new Error(`OpenAI Responses API failed with HTTP ${response.status} (${code}).`);
  }
  return requireResponse(await response.json());
};

export const runTrial = async ({ arm, limits = {}, seed, signal, task }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required to run provider trials.');
  const model = process.env.OXE_AI_MODEL ?? 'gpt-6-astra';
  const reasoningEffort = process.env.OXE_AI_REASONING_EFFORT ?? 'low';
  const maximumToolCalls = limits.maxToolCalls ?? 30;
  const maximumOutputTokens = limits.maxOutputTokens ?? 8_000;
  const context = await compactContext();
  const repositoryRootTemporary =
    arm === 'repository-source' ? await createRepositoryFixture() : undefined;
  const tools =
    arm === 'compact-semantic'
      ? compactTools
      : arm === 'repository-source'
        ? repositoryTools
        : normalizedTools;
  const representation =
    arm === 'compact-semantic'
      ? `Compact semantic application projection:\n\n${context.projection}`
      : arm === 'normalized-graph'
        ? `Normalized application graph:\n\n${JSON.stringify(context.graph)}`
        : `Use repository tools to inspect and edit the isolated fixture. ${graphPath} is authoritative.`;
  const input = [
    {
      role: 'user',
      content: `${task.prompt}\n\n${representation}\n\n${candidateInstructions(task.id)}`,
    },
  ];
  let correctionTurns = 0;
  let inputTokens = 0;
  let invalidMutations = 0;
  let outputTokens = 0;
  let toolCalls = 0;
  let turns = 0;
  const terminalFailure = (failureReason, responseModel = model) => ({
    candidate: undefined,
    correctionTurns,
    failureReason,
    invalidMutations,
    model: responseModel,
    provider: 'openai',
    seed,
    toolCalls,
    usage: { inputTokens, outputTokens },
  });
  try {
    while (turns < maximumToolCalls + 5) {
      if (outputTokens >= maximumOutputTokens)
        return terminalFailure(`Trial exhausted its ${maximumOutputTokens} output-token budget.`);
      turns += 1;
      const response = await requestOpenAI({
        apiKey,
        body: {
          input,
          instructions: systemInstructions,
          max_output_tokens: Math.max(1, maximumOutputTokens - outputTokens),
          model,
          parallel_tool_calls: false,
          reasoning: { effort: reasoningEffort },
          store: false,
          tool_choice: 'auto',
          tools,
        },
        signal,
      });
      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;
      if (outputTokens > maximumOutputTokens)
        return terminalFailure(
          `Trial exceeded ${maximumOutputTokens} output tokens.`,
          response.model ?? model,
        );
      const calls = response.output.filter((item) => item?.type === 'function_call');
      if (calls.length === 0) {
        try {
          const candidate = parseAuthoringCandidate(outputText(response), task.id, 'model output');
          return {
            candidate,
            correctionTurns,
            invalidMutations,
            model: response.model ?? model,
            provider: 'openai',
            seed,
            toolCalls,
            usage: { inputTokens, outputTokens },
          };
        } catch (error) {
          correctionTurns += 1;
          if (turns >= maximumToolCalls + 5 || outputTokens >= maximumOutputTokens)
            return terminalFailure(
              error instanceof Error ? error.message : 'Model output was invalid.',
              response.model ?? model,
            );
          input.push(...response.output, {
            role: 'user',
            content:
              'The previous response was not a valid candidate envelope. Correct it and call submit_candidate.',
          });
          continue;
        }
      }
      input.push(...response.output);
      for (const call of calls) {
        toolCalls += 1;
        if (toolCalls > maximumToolCalls)
          return terminalFailure(
            `Trial exceeded ${maximumToolCalls} tool calls.`,
            response.model ?? model,
          );
        let result;
        try {
          const argumentsValue = JSON.parse(call.arguments);
          if (call.name === 'submit_candidate') {
            const candidate = parseAuthoringCandidate(argumentsValue.candidateJson, task.id);
            return {
              candidate,
              correctionTurns,
              invalidMutations,
              model: response.model ?? model,
              provider: 'openai',
              seed,
              toolCalls,
              usage: { inputTokens, outputTokens },
            };
          }
          result =
            arm === 'compact-semantic'
              ? compactToolCall(context, call.name, argumentsValue)
              : arm === 'normalized-graph' && call.name === 'validate_graph'
                ? validateGraphText(context, argumentsValue.graphJson)
                : arm === 'repository-source' && repositoryRootTemporary
                  ? await repositoryToolCall(
                      context,
                      repositoryRootTemporary,
                      call.name,
                      argumentsValue,
                      task.id,
                    )
                  : (() => {
                      throw new TypeError(`Unsupported tool ${JSON.stringify(call.name)}.`);
                    })();
          if (
            (call.name === 'preview_mutation' || call.name === 'validate_graph') &&
            result.ok === false
          )
            invalidMutations += 1;
          if (call.name === 'finish_repository') {
            return {
              candidate: result,
              correctionTurns,
              invalidMutations,
              model: response.model ?? model,
              provider: 'openai',
              seed,
              toolCalls,
              usage: { inputTokens, outputTokens },
            };
          }
        } catch (error) {
          correctionTurns += 1;
          result = { error: error instanceof Error ? error.message : 'Tool call failed.' };
        }
        input.push({
          call_id: call.call_id,
          output: jsonResult(result),
          type: 'function_call_output',
        });
      }
    }
    return terminalFailure(`Trial exceeded ${maximumToolCalls + 5} response turns.`);
  } finally {
    if (repositoryRootTemporary)
      await rm(repositoryRootTemporary, { force: true, recursive: true });
  }
};
