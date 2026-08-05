# Performance tests and benchmarks

OXE separates deterministic performance contracts from machine-sensitive timing baselines. Both
layers use representative application work instead of isolated no-op loops.

## Commands

Run the complete timing suite from the repository root:

```sh
pnpm bench
```

The root command runs package suites sequentially so they do not compete for the same CPU. A
focused suite remains available through its package, for example:

```sh
pnpm --filter @oxe/compiler bench
pnpm --filter @oxe/runtime-server bench
```

The normal `pnpm test` command includes deterministic structural contracts. Those tests verify
linear compiler lowering as literal collection input grows, one reactive fan-out execution per
batched update, and SSR collection, element, and text work for a 250-row keyed list. They belong in
CI because they count reproducible work rather than elapsed time.

## Timing scenarios

The Vitest timing baselines currently cover:

- compiler analysis and direct-DOM code generation for a 250-row keyed collection;
- reactive propagation through 100 explicit computations, including a four-write batch;
- filesystem-manifest construction and matching across 502 routes;
- blocking JavaScript SSR for 250 keyed rows; and
- readiness scheduling, identity deduplication, rendering, and serialization for 100 granular
  consumers sharing one request.

Timing results are local observations, not pass/fail thresholds. CPU scheduling, power mode,
thermal state, Node.js and browser versions, and other workloads can move them materially. Compare
results on the same machine and runtime, use repeated samples, and investigate a distribution shift
before treating it as a regression.

## Playground performance lab

The Playground's **Performance** view ties measurements to the currently authored project. It shows
the latest compiler-worker time, direct-DOM mount time, semantic graph shape, observed post-mount DOM
mutations, and shipped-payload measurement. **Run 5 samples** recompiles and remounts unchanged
source in the current warm browser session, then reports median and nearest-rank p95 compile and
mount times plus every raw sample.

The browser sample intentionally does not claim cold-start, navigation, network, SSR, retained
memory, or end-to-end user timing. Those require controlled browser automation and host-level
instrumentation. Payload figures keep their existing explicit boundary: exact local reports include
the generated application, `@oxe/runtime`, and `@oxe/runtime-dom`, while static deployments may only
provide a generated-JavaScript estimate.

## Next coverage

The suite should grow with the application graph. Priority additions are browser-automated large
keyed-list updates, form input and selection preservation, async navigation, SSR dashboards using
authorized server functions, retained-memory and retainer inspection, and comparable result
artifacts for change-over-change tracking.
