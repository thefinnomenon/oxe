# AI authoring benchmark

OXE's graph-first thesis is that an AI agent can make correct application changes with less
context, less output, fewer correction turns, and less compilation work than it can by editing a
normalized document or repository source directly. The benchmark deliberately separates local
representation/tooling measurements from model-performance claims.

## Locally reproducible proxy

Run:

```sh
pnpm todo:bench:authoring
```

The representative `add-task-priority` scenario inspects the compact semantic projection and submits one
three-operation atomic mutation. On the r16 Todo fixture, the observed projection is 1,874 UTF-8
bytes (469 tokens by the explicitly labeled bytes/4 heuristic) and the mutation is 302 bytes (76
heuristic tokens). For comparison, the full normalized graph is 34,882 bytes, the lowered UI graph
is 111,909 bytes, and the generated browser JavaScript inspected by the benchmark is 45,736 bytes.
The compact input is therefore 18.6x smaller than the normalized graph, 59.7x smaller than the
lowered UI projection, and 24.4x smaller than generated JavaScript. A full normalized-graph
replacement is 120.7x larger than the typed mutation output.

Nine rounds of 1,000 mutation previews observed a median 717.0 microseconds per preview on the
development machine. This includes immutable mutation, complete graph validation, stable-ID impact
closure, and no persistence or code generation. These values are machine-specific and should be
compared on the same machine and commit.

The revision-aware artifact cache was measured over nine rounds. A cold Todo projection built all
19 browser/database/server/verification artifacts in a median 7,789.9 microseconds. An unchanged
warm revision returned the cached artifact set in 212.4 microseconds (36.7x faster). The broad
priority mutation rebuilt nine artifacts and reused ten; its median 7,277.4 microseconds includes
full semantic impact analysis and regeneration/fingerprint verification of conservative dependent
artifacts. It was 1.07x faster than the cold build on this run; the more durable benefit is avoiding
ten publications, while narrow and unchanged revisions receive more reuse.

This proxy proves representation size, atomic edit size, deterministic diagnostics, impact scope,
and local tool latency. It does **not** prove provider-billed tokens, model reasoning quality,
end-to-end model latency, or cross-model success rate. No exact provider tokenizer is installed, so
the report never presents the heuristic as an exact token count.

## Controlled model experiment

The task suite is [`benchmarks/ai-authoring/tasks.json`](../benchmarks/ai-authoring/tasks.json). It
currently contains ten categories spanning schema, policy, query, operation, optional data,
capability, nested context, component/style, and revision-recovery work. Run each task in three
blinded arms with the same pinned model snapshot, reasoning effort, system prompt, time limit,
output-token limit, and tool budget. Reasoning models in this harness do not set `temperature` or
`top_p`:

1. `compact-semantic`: compact projection plus typed inspection/mutation/preview tools.
2. `normalized-graph`: full normalized graph plus whole-document edit and validation tools.
3. `repository-source`: OXE/source/generated-file inspection and ordinary file-editing tools.

Use at least 30 independently reset trials per task and arm. Record one JSON object per line:

```json
{
  "taskId": "add-task-priority",
  "arm": "compact-semantic",
  "trial": 1,
  "success": true,
  "inputTokens": 0,
  "outputTokens": 0,
  "latencyMs": 0,
  "model": "pinned-model-snapshot",
  "toolCalls": 0,
  "correctionTurns": 0,
  "invalidMutations": 0,
  "usageSource": "provider",
  "provider": "openai"
}
```

Validate and append each provider result without hand-editing the JSONL collection:

```sh
pnpm ai:trials:record -- trial.json trials.jsonl
```

The recorder rejects unknown tasks or arms, duplicate/unknown fields, negative metrics, invalid
trial numbers, and inconsistent success/failure fields. Score completed records with:

```sh
pnpm ai:trials:score -- trials.jsonl
```

The scorer rejects duplicate task/arm/trial identities, reports the full task-by-arm coverage
matrix, and emits both aggregate and per-task results. Success rates include Wilson 95% confidence
intervals. A result is marked balanced only once every task/arm cell reaches the requested sample
target (30 by default). No model results are checked into this repository until real provider runs
have been collected; the local proxy is not substituted for a controlled model trial.

### Ready-to-run harness

The checked-in harness has three deliberately separate responsibilities:

- `openai-responses-adapter.mjs` sends only the public task and the representation assigned to that
  arm. It uses the Responses API, disables provider storage with `store: false`, permits one function
  call at a time, and sums exact usage across every response in a tool loop.
- `held-out-evaluator.mjs` receives the submitted candidate in a fresh temporary directory and owns
  the assertions that determine success. The adapter never receives `task.expected`.
- `matrix-runner.mjs` deterministically randomizes task/arm/trial order, resumes exact missing cells,
  appends completed rows in schedule order, and owns trial, concurrency, timeout, and token limits.

First exercise all 30 task/arm cells using the synthetic adapter. This makes no network request and
its rows are validated in memory, never accepted by the scorer as provider evidence:

```sh
pnpm ai:trials:dry
```

When an API key is available, export it in the invoking shell. Do not add it to the graph, fixture,
trial output, or source control. Set `OXE_AI_MODEL` to an exact dated snapshot before publishing a
scientific comparison; when omitted, the adapter currently defaults to `gpt-6-astra`. The model
name returned by the provider is stored on every row.

```sh
export OPENAI_API_KEY='...'
export OXE_AI_MODEL='your-pinned-model-snapshot'
export OXE_AI_REASONING_EFFORT='low'
pnpm ai:trials:pilot
```

The pilot schedules 3 repetitions for each of 10 tasks in 3 arms (90 trials), runs sequentially,
and writes ignored resumable state to `.oxe/ai-authoring/pilot.jsonl`. Its hard guards are 90 newly
scheduled trials, 30 tool calls and 24,000 output tokens per trial, five minutes per trial, and two
million cumulative provider tokens. A token limit can be exceeded by the final completed request;
with the default concurrency of one, at most one trial creates that overshoot. API or transport
errors with indeterminate provider usage stop the run instead of fabricating a trial record.

Inspect coverage and results before increasing sample size:

```sh
pnpm ai:trials:score -- .oxe/ai-authoring/pilot.jsonl
```

After the pilot confirms task validity, tool behavior, limits, and expected spend, the preconfigured
full run schedules 30 repetitions per cell (900 trials) into a separate file with a 20-million-token
cap:

```sh
pnpm ai:trials:full
pnpm ai:trials:score -- .oxe/ai-authoring/full.jsonl
```

Both commands are restart-safe: existing valid task/arm/trial identities are skipped and their token
usage counts toward the cumulative cap. Keep concurrency at one for the pilot. Higher concurrency is
supported up to eight, but a partially failed batch can incur several in-flight provider requests and
can overshoot a token cap by that batch.

For a custom provider adapter or evaluator, run the generic matrix entry point:

```sh
pnpm ai:trials:run -- \
  --adapter /absolute/path/provider-adapter.mjs \
  --evaluator /absolute/path/held-out-evaluator.mjs \
  --output trials.jsonl \
  --trials 30 \
  --concurrency 1 \
  --seed 2026091300 \
  --max-total-trials 900
```

The adapter exports `runTrial` and returns its provider/model identity, candidate artifact,
tool/correction/invalid-mutation counts, and exact provider `inputTokens`/`outputTokens`. The
separate evaluator exports `evaluateTrial`, receives the candidate, and alone decides success.
Estimated token values are rejected as controlled trial data. Interrupted runs resume at missing
task/arm/trial cells while preserving failures.

Success is determined only by structural graph validation, task-specific held-out assertions, and
the compiler projections exercised by those assertions—not by the model's own claim. The repository
test suite qualifies the fixed harness itself; it is not rerun inside every paid trial. Provider usage
supplies exact input/output tokens. Latency starts when the task is delivered and stops at a verified
terminal result. A correction turn is any tool result that requires the model to revise a failed
attempt. Report confidence intervals and preserve failed trials; excluding them would bias the
result.

## Browser and package benchmarks

`pnpm --filter @oxe/todo bench:client` measures raw/gzip/Brotli output, compares shared-runtime
facets with same-graph duplicated-runtime facets, and measures generated-client runtime operations.
The latest split total was 9,760 Brotli bytes versus a 13,109-byte duplicated-runtime baseline, a
25.5% reduction. On the same run, a cache hit took a median 0.240 microseconds, validation of a
100-row response took 56.0 microseconds, and 10,000 generated clients retained about 2,701 heap
bytes each. These local heap/timing values are diagnostic and machine-specific.

`pnpm bench:application-values` measures the richer semantic contract independently. With all six
standard capability recipes attached to Todo, its compact projection was 2,723 bytes versus 42,341
normalized bytes (15.55x smaller). Exact recursive validation of a nested 100-record value took a
median 42.2 microseconds over nine rounds of 5,000 iterations on the development machine.

`pnpm todo:bench:browser` launches installed Chrome headlessly against a running Todo
server and verifies the SSR hydration identity, generated shared runtime, authentication semantics,
keyboard focus, narrow viewport overflow, dark theme, and reduced motion while recording browser
timings. Browser timing is diagnostic rather than a stable cross-machine score.
The latest isolated run passed all ten conformance assertions and observed a 2,320,388-byte JS
heap, 41,639 transferred resource bytes, and 44 ms to DOM content loaded.
