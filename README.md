# OXE

OXE is an AI-first fullstack framework in progress.

Phase 1 in this repo provides a graph-first schema foundation built with a constrained TypeScript DSL.

## Monorepo structure

- `packages/schema-core`: Schema DSL, loader, semantic validator, normalized graph builder, diagnostics, tests.
- `packages/migrate-core`: Snapshot-based Postgres migration engine (graph -> snapshot -> diff -> operations -> SQL -> files).
- `packages/storage-core`: Snapshot/diff/apply engine for bucket/storage migrations over S3-compatible providers.
- `packages/shared`: Small shared utilities/types.
- `packages/cli`: Placeholder CLI package for future commands.
- `apps/playground`: Local harness for loading schemas and printing the normalized graph.

## Tooling

- `pnpm` workspaces
- TypeScript (ESM)
- `tsup` for package builds
- Vitest for tests
- ESLint + Prettier
- Husky + lint-staged hooks

## Scripts

- `pnpm build`: Build all workspace packages/apps.
- `pnpm dev`: Run the playground in watch mode.
- `pnpm test`: Run all tests.
- `pnpm lint`: Run lint across all workspaces.
- `pnpm format`: Format the repository with Prettier.
- `pnpm typecheck`: Type-check all workspaces.
- `pnpm db:up`: Start local Postgres + MinIO (Docker Compose helper).
- `pnpm db:down`: Stop/remove local Postgres + MinIO helper containers/volumes.

## Git hooks

- `pre-commit`: `lint-staged`, `lint`, `typecheck`, `test`
- `pre-push`: `lint`, `typecheck`, `test`

This enforces lint/typecheck/tests on both commit and push.

## Current schema scope (implemented)

- Top-level declarations: `table`, `bucket`, `role`, `enumType`, `objectType`
- `defineSchema(...)` support
- Field builder namespace: `field.*` scalar/object/enum builders
- Field chaining for shape/auth/owner/transforms/validators/DB metadata
- Schema loading from `/schemas/**/*.ts`
- Module loading rules:
  - Prefer `default export defineSchema(...)`
  - Otherwise collect named exported declarations
- Semantic validation
- Normalized schema graph generation
- Built-in table fields injected into graph:
  - `id` (UUIDv7 default)
  - `createdAt` (default now)
  - `updatedAt` (default now + auto-updated)

## Current migration scope (implemented, v1)

- Graph-based, snapshot-based Postgres migration engine in `@oxe/migrate-core`
- Schema graph -> deterministic DB snapshot
- Snapshot diff -> typed migration operations
- SQL generation with deterministic ordering
- Snapshot persistence: `.oxe/db-snapshot.json`
- Migration file generation: `migrations/0001_*.sql`
- Storage migration artifact generation: `migrations/0001_*.storage.json`
- Storage snapshot persistence: `.oxe/storage-snapshot.json`
- Conservative destructive/risky change blocking by default
- Interactive and non-interactive rename-vs-delete resolution
- Schema-level rename hints (`renameFrom`) for tables/columns
- Table-level composite indexes and composite unique constraints
- Migration application against real Postgres (`migrate:apply`)
- DB migration tracking table (`_oxe_migrations`)
- DB-backed migration status (`migrate:status`)
- Postgres introspection + drift detection (`migrate:drift`)
- Real Postgres integration tests (env-gated)
- Bucket/storage migration planning and apply flow (S3-compatible provider abstraction)
- Local MinIO support via the same S3-compatible provider path used in production

## Storage provider config

The storage layer is S3-compatible and endpoint-driven (not AWS-hardcoded).

Required env vars for storage apply:

- `OXE_STORAGE_ENDPOINT`
- `OXE_STORAGE_ACCESS_KEY_ID`
- `OXE_STORAGE_SECRET_ACCESS_KEY`

Optional:

- `OXE_STORAGE_REGION` (default `us-east-1`)
- `OXE_STORAGE_FORCE_PATH_STYLE` (default `true`)
- `OXE_STORAGE_SESSION_TOKEN`
- `OXE_STORAGE_BUCKET_PREFIX` (for deterministic provider bucket naming in snapshots/migrations)

MinIO local defaults with `pnpm db:up`:

- endpoint: `http://localhost:9000`
- access key: `oxe-minio`
- secret key: `oxe-minio-secret`

## Deferred in later phases

- Runtime validator/codegen pipeline
- CRUD route generation
- Admin metadata generation
- Event metadata generation
- Package-provided schema roots
- Visual schema editing and AI-assisted schema editing
- Migration enhancements:
  - rename detection heuristics
  - reversible down migrations
  - richer enum evolution tooling
  - online migration strategies
  - migration locking/concurrency safeguards

## Why constrained TypeScript DSL

This project intentionally avoids a free-form imperative schema API.

The DSL is constrained and declarative so schema definitions remain:

- predictable to parse/load,
- stable for semantic validation,
- easy to normalize into one graph model,
- suitable for future visual and AI-assisted editing flows.

The normalized schema graph is the internal source of truth.
