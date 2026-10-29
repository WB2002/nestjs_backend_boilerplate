# [AGENTS.md](http://AGENTS.md)

NestJS 12 API on **Fastify** REST, GraphQL, WebSockets, BullMQ, MongoDB + optional Postgres, Redis. User instructions in the session override this file.

## Commands

- Install: `pnpm install` — pnpm only, never npm/yarn; never hand-edit `pnpm-lock.yaml`
- Dev server: `pnpm run start:dev`
- Lint: `pnpm quality:lint` (CI mode) · `pnpm run lint` (auto-fix)
- Typecheck: `pnpm quality:types` (tsc + tsd type tests)
- Unit tests: `pnpm test:unit`
- One test file: `pnpm exec jest --config jest.config.ts <path/to/file.spec.ts>`
- Integration tests: `pnpm test:integration` (needs Docker; Testcontainers, runs in band)
- After any GraphQL schema change: `pnpm quality:contract:update-snapshot`
- Full gate before a PR: `pnpm quality` (slow) — matrix in `docs/quality/README.md`

Local Node must be 24.9+ (`.nvmrc`); Nest 12 ESM in Jest fails on older versions.
README's `test:e2e` and `test:cov` scripts are outdated — use the commands above.

## Verifying work

Before calling a change done, run `pnpm quality:lint`, `pnpm quality:types`, and `pnpm test:unit`, and report the commands with their results. Also run integration, contract, or property suites when the change touches persistence, GraphQL SDL, or cross-service behavior.

## Conventions

- Controllers: routing only. Services: business logic, never raw `Request`/`Response`.
- Expected failures throw Nest HTTP exceptions. No empty `catch` blocks.
- DTOs: every property has class-validator decorators; update DTOs use `PartialType`.
- Imports use the `@/` alias and the `dto/` / `types/` barrels, not deep paths.
- Switches over unions/enums end with an exhaustive `never` default.
- Named exports only.
- Tests live in `src/**/tests/`: `*.spec.ts` (must run without Docker) or `*.integration.spec.ts`. Property tests use `jest.property.config.ts`; contract tests use `jest.contract.config.ts`. Skip trivial assert-true tests.

Full rules: `docs/conventions/code_standards.convention.md`.

## Adding features

- New CRUD module: follow `docs/instructions/create_crud.instruction.md`, model it on `src/auth/`, register it in `app.module.ts`, add `docs/features/<resource>.feature.md`.
- For a feature listed in `docs/features/features.md`, read its feature doc and any plan in `docs/superpowers/plans/` before editing.
- Update `docs/features/*` when behavior or env vars change.
- Ops docs (multi-VM, ALB, overload): `docs/operations/`.

## Git and security

- Don't commit or push unless asked. Don't use `--no-verify`. Don't force-push `main`/`master`.
- Don't disable an ESLint or Semgrep security rule without a comment stating why.
- Never commit secrets or `.env` files.
