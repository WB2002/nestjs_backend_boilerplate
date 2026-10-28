# Quality toolchain

Deterministic checks run locally via `pnpm quality:*` and in GitHub Actions (`.github/workflows/quality.yml`).

## Commands

| Script                                  | Purpose                                              |
| --------------------------------------- | ---------------------------------------------------- |
| `pnpm quality`                          | Full sequential run (slow; use before opening a PR)  |
| `pnpm quality:lint`                     | ESLint without `--fix`                               |
| `pnpm quality:types`                    | `tsc --noEmit` + `tsd` type tests                    |
| `pnpm quality:unit`                     | Jest unit tests                                      |
| `pnpm quality:integration`              | Jest + Testcontainers (requires Docker)              |
| `pnpm quality:property`                 | fast-check property suite                            |
| `pnpm quality:contract`                 | REST JSON Schema + GraphQL SDL snapshot              |
| `pnpm quality:mutation`                 | Stryker on changed `src/**/*.ts` files               |
| `pnpm quality:supply-chain`             | Frozen lockfile, `pnpm audit`, Trivy filesystem scan |
| `pnpm quality:contract:update-snapshot` | Regenerate GraphQL SDL snapshot after schema changes |

## Hooks

- **pre-commit:** lint-staged + Gitleaks (unchanged)
- **pre-push:** lint, types, unit (optional locally; skipped if Husky not installed)

## CI branch protection

Require these status checks on `main` / `master`:

- `lint`, `types`, `supply-chain`, `unit`, `integration`, `property`, `contract`, `mutation`, `secrets`
- CodeQL `Analyze` job from `.github/workflows/codeql.yml`

## Supply chain

- **`pnpm audit`:** fails on high/critical advisories; use `pnpm.overrides` in `package.json` when patches exist.
- **Trivy:** install CLI locally or use Docker (`scripts/ci/run-trivy.sh`); CI uses `aquasecurity/trivy-action`.
- **Dependabot:** weekly npm and GitHub Actions PRs (`.github/dependabot.yml`).

## Mutation testing

`quality:mutation` mutates only TypeScript files changed vs `QUALITY_BASE_REF` (default `origin/main`). With no eligible changes, the script exits 0 and logs `mutation skipped: no eligible changed files`.

Force a local run:

```bash
MUTATE_FILES=src/core/overload/priority/should-shed-priority-request.ts pnpm exec stryker run
```

## GraphQL contracts

SDL source of truth: `src/**/*.graphql`. Snapshot: `test/contracts/graphql/schema.snapshot.graphql`. After intentional schema edits:

```bash
pnpm quality:contract:update-snapshot
```

## Optional AI review

Enable [Cursor Bugbot](https://cursor.com/docs/bugbot) or CodeRabbit on the repository. The `AI Review (optional)` workflow does not fail merges.

Design spec: [../superpowers/specs/2026-10-29-quality-toolchain-design.md](../superpowers/specs/2026-10-29-quality-toolchain-design.md)
