# @oxe/storage-core

`@oxe/storage-core` adds bucket/storage migration support for OXE using a generic S3-compatible abstraction.

## Goals

- schema buckets -> deterministic storage snapshot
- snapshot diff -> explicit storage operations
- apply storage operations against any S3-compatible endpoint
- local MinIO support for development/integration tests
- production provider support through endpoint-driven config

## Architecture

- `provider/`: provider interface (`StorageProvider`)
- `s3-compatible/`: S3-compatible provider implementation/config helpers
- `snapshot/`: normalized storage snapshot model and builder
- `diff/`: previous vs next storage snapshot diff
- `operations/`: ambiguity detection, rename hints, planning, ordering, serialization
- `apply/`: apply storage migration artifacts + DB-backed tracking integration
- `io/`: storage snapshot and migration artifact file I/O
- `diagnostics/`: warnings/errors for conservative planning
- `prompts/`: interactive/test adapters for bucket ambiguity resolution

## Snapshot model

Storage snapshot file:

- `.oxe/storage-snapshot.json`

Key fields:

- `formatVersion`
- `generatedFromRootDir`
- `naming` (`bucketPrefix`)
- `buckets` by logical schema name with:
  - logical name
  - provider-visible bucket name
  - optional `renameFrom`
  - normalized metadata
  - source path provenance

## Migration artifact format

Storage migrations are written as sidecar JSON files in `migrations/`:

- `0001_init.storage.json`
- `0002_add_assets.storage.json`

DB SQL remains in `.sql` files. Numbering is deterministic and aligned when DB and storage changes are generated together.

## Supported v1 storage operations

- `create_bucket`
- `delete_bucket`
- `rename_bucket` (planned as conservative strategy: create new bucket and keep old)
- `warn_bucket_metadata_change` (records metadata deltas with diagnostics; no provider-policy enforcement yet)

## Rename behavior

Bucket rename-vs-delete ambiguity can be resolved by:

1. explicit hints (`renameHints.bucketRenames`)
2. schema hint (`bucket(..., { renameFrom: 'OldBucket' })`)
3. interactive prompt adapter

v1 apply strategy for rename is conservative:

- create target bucket if missing
- keep source bucket (no automatic object copy/deletion)

## Delete behavior

Bucket deletion is conservative:

- non-empty delete fails by default
- if `forceDeleteNonEmptyBuckets` is enabled, objects are emptied first and then bucket is deleted

## S3-compatible provider

Main implementation:

- `S3CompatibleStorageProvider`

Config shape:

- `endpoint`
- `region`
- `accessKeyId`
- `secretAccessKey`
- `forcePathStyle`
- optional `sessionToken`

Environment helper:

- `createS3CompatibleProviderFromEnv()`
- `readS3CompatibleProviderConfigFromEnv()`

Required env vars:

- `OXE_STORAGE_ENDPOINT`
- `OXE_STORAGE_ACCESS_KEY_ID`
- `OXE_STORAGE_SECRET_ACCESS_KEY`

Optional env vars:

- `OXE_STORAGE_REGION` (default `us-east-1`)
- `OXE_STORAGE_FORCE_PATH_STYLE` (default `true`)
- `OXE_STORAGE_SESSION_TOKEN`

## MinIO local setup

With repo-level docker compose helper:

```bash
pnpm db:up
```

Set env for local MinIO:

```bash
export OXE_STORAGE_ENDPOINT=http://localhost:9000
export OXE_STORAGE_REGION=us-east-1
export OXE_STORAGE_ACCESS_KEY_ID=oxe-minio
export OXE_STORAGE_SECRET_ACCESS_KEY=oxe-minio-secret
export OXE_STORAGE_FORCE_PATH_STYLE=true
```

Integration test env (MinIO + Postgres tracking):

```bash
export OXE_TEST_MINIO_ENDPOINT=http://localhost:9000
export OXE_TEST_MINIO_REGION=us-east-1
export OXE_TEST_MINIO_ACCESS_KEY=oxe-minio
export OXE_TEST_MINIO_SECRET_KEY=oxe-minio-secret
export OXE_TEST_DATABASE_URL=postgres://oxe:oxe@localhost:54329/oxe_dev
```

## Production S3-compatible usage

Use the same provider abstraction with production endpoint/credentials:

- endpoint can target AWS S3, Cloudflare R2, DigitalOcean Spaces, Wasabi, etc.
- OXE logic stays endpoint-driven and provider-agnostic

## Tests

Run:

```bash
pnpm --filter @oxe/storage-core test
```

MinIO integration tests are env-gated and skip when required env vars are missing.

## v1 deferred

- automatic object copy/move for bucket renames
- provider-specific bucket policy/lifecycle enforcement
- object-content migration workflows
- richer drift/introspection for provider-side bucket policy settings
