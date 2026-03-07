# @oxe/migrate-core

`@oxe/migrate-core` provides the v1 OXE Postgres migration engine.

It is graph-based and snapshot-based:

1. schema graph (`@oxe/schema-core`)
2. normalized database snapshot
3. snapshot diff
4. typed migration operations
5. SQL rendering
6. migration/snapshot file writes

## Architecture

- `snapshot/`: graph -> database snapshot conversion and snapshot types
- `diff/`: previous snapshot -> next snapshot diffing
- `operations/`: explicit migration operation planning + conservative diagnostics
- `sql/`: deterministic Postgres SQL rendering
- `io/`: snapshot loading/saving and migration file writing
- `diagnostics/`: migration diagnostics types/helpers

## Public API

- `buildDatabaseSnapshot(schemaGraph)`
- `diffDatabaseSnapshots(previousSnapshot, nextSnapshot)`
- `generateMigrationPlan(diff, options)`
- `renderMigrationSql(plan, options)`
- `loadDatabaseSnapshot(options)`
- `saveDatabaseSnapshot(snapshot, options)`
- `writeMigrationFiles({ plan, nextSnapshot, ... })`

## v1 scope

Implemented:

- Tables, columns, nullability, defaults, PKs
- Field-level unique/index metadata
- Foreign keys and `onDelete`
- Enums and append-only enum evolution
- Object type fields mapped to `jsonb`
- Scalar arrays mapped to Postgres arrays
- Deterministic snapshot JSON and SQL output
- Migration file + snapshot persistence
- Conservative destructive/risky change blocking by default

Intentionally deferred in v1:

- Rename detection
- Down migrations
- Live DB introspection
- Data backfills
- Partial/generated indexes or columns
- Advanced Postgres-specific schema features
- Trigger/function generation
- Validator-to-DB constraint compilation

## File conventions

- Snapshot: `.oxe/db-snapshot.json`
- Migrations: `migrations/0001_<name>.sql`

## Safety behavior

`generateMigrationPlan` blocks by default when destructive/risky changes are present (for example dropping a table/column or tightening to `NOT NULL`).

Use `allowDestructive: true` only when you intentionally accept those operations.

## Tests

Run:

```bash
pnpm --filter @oxe/migrate-core test
```

## Next phases

- Rename hints / rename detection
- DB introspection
- Reversible migrations
- Richer enum evolution workflows
- Composite indexes / composite unique constraints
- Safe validator-to-check compilation
- Package-aware schema ownership
- Migration apply/status tracking
