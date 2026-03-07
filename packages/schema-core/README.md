# @oxe/schema-core

`@oxe/schema-core` is the phase-1 schema foundation for OXE.

It provides:

- A constrained TypeScript schema DSL for authoring
- Schema discovery/loading from `/schemas/**/*.ts`
- Semantic validation with diagnostics
- Graph-first normalization into a stable internal schema model

## Public API

- `defineSchema(...)`
- `table(...)`
- `bucket(...)`
- `role(...)`
- `enumType(...)`
- `objectType(...)`
- `field` builder namespace
- `loadSchemaProject(...)`
- `validateSchemaProject(...)`
- `buildSchemaGraph(...)`

## DSL shape

### Top-level declarations

- `table`
- `bucket`
- `role`
- `enumType`
- `objectType`

### Field builder

Scalar builders:

- `field.id()`
- `field.string()`
- `field.boolean()`
- `field.int()`
- `field.float()`
- `field.decimal()`
- `field.datetime()`
- `field.date()`
- `field.time()`
- `field.json()`
- `field.bytes()`

Structured builders:

- `field.enum(...)`
- `field.type(...)`

Chaining categories:

- Shape: `optional()`, `array()`
- Auth/ownership: `auth(...)`, `owner()`
- Transforms: `trim()`, `lowercase()`, `uppercase()`, `floor()`, `ceiling()`, `round()`
- Validators: `minLength()`, `maxLength()`, `length()`, `email()`, `url()`, `uuid()`, `regex()`, `min()`, `max()`, `num()`
- DB metadata: `primary()`, `default()`, `unique()`, `index()`, `references()`, `onDelete()`

### Bucket unit inputs

Bucket size/duration/ttl methods accept either raw numbers or unit-aware values.

- Size strings: `"1MB"`, `"512KiB"`, `"1 GB"`
- Duration strings: `"30s"`, `"1h"`, `"7d"`, `"250ms"`

Helpers are also available via `units`:

- `units.size.MB(1)`, `units.size.GB(1)`
- `units.duration.m(30)`, `units.duration.h(1)`

Normalized graph values are stored as:

- Size: bytes
- Duration/TTL: seconds

## Loader behavior

For each module under configured schema roots:

1. If `default export` is `defineSchema(...)`, use only declarations from that schema object.
2. Otherwise, collect named exports that are branded schema declarations.

## Semantic validation checks

Implemented checks include:

- Duplicate declaration names across the project
- Duplicate enum members
- Duplicate field names (case-insensitive collisions)
- Multiple owner fields in a table/bucket
- Invalid object-type usage: auth/owner/DB directives
- Bucket metadata on non-bucket declarations
- `onDelete` without `references`
- Unknown table/enum/object-type references
- Built-in table field override conflicts

Diagnostics are human-readable and include source file and declaration context.

## Normalized graph

`buildSchemaGraph(...)` creates a normalized model with:

- Declarations by kind
- Per-declaration provenance/source file
- Tables, buckets, enums, object types, and roles
- Fully normalized fields with:
  - shape
  - transforms
  - validators
  - DB metadata
  - relationship metadata
  - ownership metadata
  - auth metadata (canonical `get/getMany/create/update/delete`)
- Built-in table field injection (`id`, `createdAt`, `updatedAt`)

This graph is designed to power future migrations, codegen, admin metadata, events, and visual/AI tooling.

## Tests

Tests are in `packages/schema-core/tests` and include:

- DSL builder/declaration tests
- Fixture-based loader tests
- Semantic error tests
- Graph normalization tests
- Auth normalization tests

Run from repo root:

```bash
pnpm --filter @oxe/schema-core test
```

## Next phases (roadmap)

- Migration generator
- Validator generator/codegen
- CRUD API generation
- Admin metadata generation
- Event metadata generation
- Package schema roots
- Visual schema editing + AI editing integration
