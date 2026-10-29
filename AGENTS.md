# AGENTS.md

NestJS 12 API on **Fastify** REST, GraphQL, WebSockets, BullMQ, **Postgres (primary)** with MongoDB fallback, Redis. Artifact-driven AI-SDLC: start at [docs/ai-sdlc.md](docs/ai-sdlc.md). User instructions in the session override this file.

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
- AI-SDLC verify mirror: `scripts/verify.sh` · full (local): `scripts/verify-full.sh`

Local Node must be 24.9+ (`.nvmrc`); Nest 12 ESM in Jest fails on older versions.
README's `test:e2e` and `test:cov` scripts are outdated — use the commands above.

## Verifying work

Before calling a change done, run `pnpm quality:lint`, `pnpm quality:types`, and `pnpm test:unit`, and report the commands with their results. Also run integration, contract, or property suites when the change touches persistence, GraphQL SDL, or cross-service behavior.

For SDLC-only or guardrail changes, also run `scripts/verify.sh` (or paste CI `AI-SDLC` workflow output) before reporting complete.

## Conventions

- Controllers: routing only. Services: business logic, never raw `Request`/`Response`.
- Expected failures throw Nest HTTP exceptions. No empty `catch` blocks.
- DTOs: every property has class-validator decorators; update DTOs use `PartialType`.
- Imports use the `@/` alias and the `dto/` / `types/` barrels, not deep paths.
- Switches over unions/enums end with an exhaustive `never` default.
- Named exports only.
- Tests live in `src/**/tests/`: `*.spec.ts` (must run without Docker) or `*.integration.spec.ts`. Property tests use `jest.property.config.ts`; contract tests use `jest.contract.config.ts`. Skip trivial assert-true tests.
- Intent artifacts: `.cursor/rules/intent-artifacts.mdc` and templates in `intent/_templates/`.

Full rules: `docs/conventions/code_standards.convention.md`.

## Adding features

- New CRUD module: follow `docs/instructions/create_crud.instruction.md`, model it on `src/auth/`, register it in `app.module.ts`, add `docs/features/<resource>.feature.md`.
- For a feature listed in `docs/features/features.md`, read its feature doc and any `intent/<slug>/spec.md` and `plan.md` before editing.
- Greenfield product work: `/new-intent` → human accepts → `/spec` → `/plan` (see SDLC workflow below).
- Update `docs/features/*` when behavior or env vars change.
- Ops docs (multi-VM, ALB, overload): `docs/operations/`.

## SDLC workflow

- Work starts with product discovery in `intent/<slug>/intent.md`.
- A human accepts the product scope in `intent.md`.
- For changes to information a user sees or actions a user takes, `/design-experience <slug>` produces a draft `experience.md`; `ux-reviewer` reports gaps before the human accepts it.
- `/spec <slug>` produces `spec.md` after the intent and, when applicable, the experience are accepted. Non-interactive requirements use `Experience: none`.
- `/plan <slug>` (in Plan mode) produces `plan.md`. HIGH (tier 2) requires an accepted `intent/<slug>/architecture-gate.md` first. CRITICAL: the human writes the plan.
- `/orchestrate <slug>` names the next role and writes `intent/<slug>/orchestration.md`. It does not implement, review, merge, or deploy.
- Implementation follows the plan and updates `plan.md` in the same change if it departs.
- Bug fixes use `/fix-bug`.

## Correctness

- AI generates implementation. Intent, accepted experience, spec, tests, and policies define what is correct. Agents may prepare evidence and must not manufacture an approval.
- Default autonomy is L2. Do not merge or deploy.
- Do not review your own change. Hand it to the readonly review agents.
- Do not set Status to `accepted`. Only the human owner does.
- Do not invent product scope or visible interaction behavior in a spec, plan, or implementation. Stop at the missing human gate.
- A HIGH (tier 2) plan requires an accepted architecture gate. CRITICAL design and plan stay with the human.

## Engineering principles

- Search for existing utilities before writing new ones. Reuse; do not duplicate.
- No drive-by refactors or unrelated edits. Out-of-scope findings become an intent, not part of the diff.
- No abstraction until there are two real callers. Prefer deleting code to adding it.
- No commented-out code, no dead code, no `TODO` without an intent/issue reference.
- Dependencies only via `/add-dependency`. Never hand-edit manifests or lockfiles.
- Every behavior change has a test that fails without it. Never weaken or delete a test to get green.
- Public behavior change means docs updated in the same change (see plan.md Docs impact).
- Stay inside plan.md scope. If scope must grow, stop and update the plan first.
- Tier 2 changes: stop for human design review before implementing, and do not write `plan.md` until the architecture gate is accepted.

## Things the agent gets wrong

- (add a line here whenever the same mistake happens twice)

## Git and security

- Don't commit or push unless asked. Don't use `--no-verify`. Don't force-push `main`/`master`.
- Don't disable an ESLint or Semgrep security rule without a comment stating why.
- Never commit secrets or `.env` files.
