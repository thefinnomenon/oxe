# OXE

OXE is an AI-first fullstack framework in progress.

Phase 1 in this repo provides a graph-first schema foundation built with a constrained TypeScript DSL.

## Monorepo structure

- `packages/schema-core`: Schema DSL, loader, semantic validator, normalized graph builder, diagnostics, tests.
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

## Deferred in later phases

- Migration generator
- Runtime validator/codegen pipeline
- CRUD route generation
- Admin metadata generation
- Event metadata generation
- Package-provided schema roots
- Visual schema editing and AI-assisted schema editing

## Why constrained TypeScript DSL

This project intentionally avoids a free-form imperative schema API.

The DSL is constrained and declarative so schema definitions remain:

- predictable to parse/load,
- stable for semantic validation,
- easy to normalize into one graph model,
- suitable for future visual and AI-assisted editing flows.

The normalized schema graph is the internal source of truth.
