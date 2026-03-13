# @oxe/migrate-core

`@oxe/migrate-core` is the OXE Postgres migration system built around:

1. schema graph (`@oxe/schema-core`)
2. deterministic database snapshot
3. snapshot diff
4. typed migration operations
5. SQL rendering
6. migration file + snapshot persistence
7. migration application + DB tracking
8. DB introspection + drift detection

For bucket/storage migrations, OXE uses `@oxe/storage-core` alongside this package in the CLI orchestration flow.

## Architecture

- `snapshot/`: graph -> DB snapshot mapping
- `diff/`: previous snapshot -> next snapshot changes
- `ambiguity/`: conservative rename-vs-delete ambiguity detection
- `resolution/`: resolve ambiguity with provided answers or prompt adapter
- `operations/`: migration planning, rename hints, deterministic ordering
- `sql/`: SQL rendering from operations
- `io/`: snapshot/migration file I/O and local status file
- `apply/`: apply pending migrations to Postgres
- `tracking/`: `_oxe_migrations` table lifecycle and records
- `introspection/`: live Postgres schema -> snapshot
- `drift/`: expected snapshot vs actual DB drift detection
- `prompts/`: interactive/test prompt adapters
- `diagnostics/`: typed migration diagnostics

## Rename handling

v1 supports three rename resolution paths:

1. Interactive ambiguity prompts (`migrate:generate --interactive`)
2. Explicit planner hints (`renameHints`)
3. Schema-level hints:
   - `table('Account', { renameFrom: 'User', ... })`
   - `field.string().renameFrom('fullName')`

Notes:

- Schema hints are optional.
- In non-interactive mode, explicit/schema hints can resolve ambiguous rename-vs-delete cases.
- The engine stays conservative and does not silently guess renames.

## Composite constraints

Table-level composite constraints are supported in the DSL:

- `indexes: [['orgId', 'createdAt']]`
- `unique: [['orgId', 'email']]` (or `uniques`)

These flow through graph -> snapshot -> diff -> operations -> SQL -> introspection/drift.

## Public API highlights

- `buildDatabaseSnapshot(schemaGraph)`
- `diffDatabaseSnapshots(previous, next)`
- `collectRenameHints(diff, explicitHints?)`
- `planMigrationWithAmbiguityResolution(diff, options)`
- `generateMigrationPlan(diff, options)`
- `orderMigrationOperations(operations)`
- `renderMigrationSql(plan, options)`
- `writeMigrationFiles(...)`
- `applyMigrations(options)`
- `getMigrationStatus(options)`
- `introspectDatabaseSnapshot(options)`
- `detectDatabaseDrift(expected, actual)`
- `detectDatabaseDriftFromPostgres({ expectedSnapshot, connection })`

## Migration tracking table

Applied migrations are tracked in Postgres table:

- `_oxe_migrations`

Tracked fields:

- `id` (migration filename, PK)
- `checksum`
- `applied_at`
- `execution_ms`

`applyMigrations(...)` uses this table to determine pending/skipped migrations and to prevent silent checksum drift.

## CLI flow

- `oxe migrate:generate [--interactive] [--allow-destructive] [--dry-run]`
- `oxe migrate:apply [--url <postgres-url>]`
- `oxe migrate:status [--url <postgres-url>] [--local]`
- `oxe migrate:drift [--url <postgres-url>] [--schema <schema>]`

## Determinism and safety

- Stable operation ordering via `orderMigrationOperations(...)`
- Deterministic SQL output for identical inputs
- Destructive/risky changes emit diagnostics and block by default unless explicitly allowed
- Unsupported enum mutations (reorder/removal/rename) emit clear diagnostics

## Integration tests (real Postgres)

Integration tests are included and gated by connection URL env var:

- `OXE_TEST_DATABASE_URL` (preferred)
- fallback: `DATABASE_URL`

When URL is not set, integration tests are skipped.

### Local Postgres helper

From repo root:

```bash
pnpm db:up
export OXE_TEST_DATABASE_URL=postgres://oxe:oxe@localhost:54329/oxe_dev
pnpm --filter @oxe/migrate-core test
pnpm db:down
```

## Current v1 limitations

- No automatic rename inference without hints/prompts
- No down migration generation
- No transactional splitting for Postgres statements that must run outside transactions
- No live DB introspection of advanced Postgres features outside core v1 scope
- No migration lock/concurrency coordinator yet

## Next phases

- rename persistence/hints files
- richer enum evolution support
- reversible migrations
- online migration strategies
- migration execution locks + status history improvements
- broader Postgres feature introspection
