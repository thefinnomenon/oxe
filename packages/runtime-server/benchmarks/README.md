# Runtime-server baselines

Run `pnpm --filter @oxe/runtime-server bench` from the repository root.

The first case measures reference JavaScript SSR traversal across 250 keyed rows. The second
measures readiness scheduling, identity deduplication, rendering, and serialization for 100
granular consumers sharing one request. These are regression baselines for the JavaScript
architecture; they intentionally do not set timing thresholds or imply that a native backend is
needed.
