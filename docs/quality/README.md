# Quality toolchain

Deterministic checks run locally via `pnpm quality:*` and in GitHub Actions (`.github/workflows/quality.yml`).

## Commands

| Script                                  | Purpose                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm quality`                          | Full sequential run (slow; use before opening a PR)                                         |
| `pnpm quality:lint`                     | ESLint without `--fix`                                                                      |
| `pnpm quality:types`                    | `tsc --noEmit` + `tsd` type tests                                                           |
| `pnpm quality:unit`                     | Jest unit tests                                                                             |
| `pnpm quality:integration`              | Jest + Testcontainers (requires Docker)                                                     |
| `pnpm quality:property`                 | fast-check property suite                                                                   |
| `pnpm quality:contract`                 | REST JSON Schema + GraphQL SDL snapshot                                                     |
| `pnpm quality:mutation`                 | Stryker on changed `src/**/*.ts` files                                                      |
| `pnpm quality:app-security`             | Semgrep (local rules + OSS registry) + long-base64 heuristic on `src/`, `test/`, `scripts/` |
| `pnpm quality:app-security:changed`     | Same as app-security but Semgrep only on changed app paths                                  |
| `pnpm quality:supply-chain`             | Frozen lockfile, `pnpm audit`, OSV-Scanner, Trivy vuln + secrets on app paths               |
| `pnpm quality:osv`                      | OSV-Scanner only (CVSS ≥ 7 gate; matches CI supply-chain)                                   |
| `pnpm quality:supply-chain:check`       | `pnpm audit` + OSV without reinstall/Trivy                                                  |
| `pnpm quality:contract:update-snapshot` | Regenerate GraphQL SDL snapshot after schema changes                                        |

## Hooks

- **pre-commit:** lint-staged + Gitleaks (unchanged)
- **pre-push:** lint, types, unit (optional locally; skipped if Husky not installed)

## CI branch protection

Require these status checks on `main` / `master`:

- `lint`, `types`, `app-security`, `supply-chain`, `unit`, `integration`, `property`, `contract`, `mutation`, `secrets`
- `dependency-review` (pull requests) from `.github/workflows/dependency-review.yml`
- CodeQL `Analyze` job from `.github/workflows/codeql.yml`

## App security (first-party code)

Scans **your** TypeScript and shell under `src/`, `test/`, and `scripts/`—not `node_modules`.

- **Semgrep:** custom rules in `semgrep/rules/obfuscated-exfil.yaml` (eval/Function/vm, base64→execute, env→fetch) plus OSS configs `p/javascript` and `p/nodejs`. CI runs `semgrep --test` on those rules before scanning.
- **Long-base64 heuristic:** `scripts/ci/scan-long-base64-literals.sh` flags very long base64-like string literals (tune with `BASE64_LITERAL_MIN_LEN`).
- **ESLint:** `src/**/*.ts` forbids global `eval`, `new Function`, and `node:vm` imports.
- **Fixture:** `test/security/semgrep-fixtures/` holds intentional bad samples for rule tests; excluded from CI scans.

Local tooling (or use Docker images referenced in `scripts/ci/*.sh`):

```bash
brew install semgrep osv-scanner trivy jq
pnpm quality:osv
pip install semgrep   # alternative Semgrep install
pnpm quality:app-security
```

## Supply chain

- **`pnpm audit`:** fails on high/critical advisories; use `pnpm.overrides` in `package.json` when patches exist.
- **OSV-Scanner:** `scripts/ci/run-osv-scanner.sh` against `pnpm-lock.yaml` (fails on CVSS ≥ 7, same bar as `pnpm audit --audit-level=high`).
- **Trivy:** `run-trivy.sh` (vulns, skips `node_modules`) and `run-trivy-app-secrets.sh` (secrets on `src`, `test`, `scripts` only). CI installs Trivy via `aquasecurity/setup-trivy`.
- **Dependency Review:** GitHub Action on pull requests (`.github/workflows/dependency-review.yml`).
- **Dependabot:** weekly npm and GitHub Actions PRs (`.github/dependabot.yml`).

## Open-source only

This toolchain uses **Semgrep**, **OSV-Scanner**, **Trivy**, **Gitleaks**, **CodeQL**, **pnpm audit**, and **GitHub Dependency Review**—not commercial scanners (e.g. Socket or Snyk paid tiers).

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

## CodeQL

The [CodeQL workflow](../.github/workflows/codeql.yml) always runs analysis on push/PR. Uploading results to the **Security** tab requires code scanning to be turned on for the repository.

1. On GitHub: **Settings → Security → Code scanning** → set up **Advanced** (CodeQL) if prompted.
2. Add a repository **Actions variable** named `CODEQL_UPLOAD` with value `true` (Settings → Secrets and variables → Actions → Variables).

Until `CODEQL_UPLOAD` is `true`, the workflow analyzes code but skips SARIF upload so CI does not fail with “Code scanning is not enabled”.

## Language-specific vs conformance

Quality verification is split between this repository's language-specific test suite and an external black-box conformance test suite:

### What stays in this repository

- **TypeScript type-level assertions (`tsd`):** Verifies compile-time type invariants, generic constraints, and API surface typing (`pnpm quality:types`).
- **Property-based tests (`fast-check`):** Verifies mathematical invariants, input fuzzing, and algorithmic properties of internal utilities (`pnpm quality:property`).
- **Unit tests:** Verifies pure functions, internal business logic, and NestJS dependency injection, module configuration, guards, interceptors, and decorator metadata wiring (`pnpm quality:unit`).
- **Testcontainers persistence integration tests:** Verifies raw database schema migrations, transaction locks (`FOR UPDATE SKIP LOCKED`), and database drivers against real ephemeral Postgres/MongoDB containers (`pnpm quality:integration`).

### What belongs in the conformance suite

HTTP-observable behavior is validated externally via the language-agnostic conformance suite (`backend_boilerplate_conformance_tests`):

- Wire contracts (REST endpoints, GraphQL queries/mutations, WebSockets).
- Authentication lifecycles, session cookies, and double-submit CSRF tokens.
- Distributed coordination (multi-VM Redis rate limiting, cache stampede locks, loader coalescing, negative caching).
- Resilience mechanisms (deadlines, client retries, backoff, circuit breaking, priority shedding, load leveling queues).
- Standard HTTP status semantics (400, 401, 403, 404, 409, 422, 429 + `Retry-After`, 503 + `Retry-After`).
- Logging and telemetry privacy scrubbing (PII and span attribute redaction).

Testing observable behavior through external black-box HTTP calls allows alternative backend implementations (e.g. in Go, Rust, Python, Java) to prove behavioral equivalence against the exact same test suite.

## Optional AI review

Enable [Cursor Bugbot](https://cursor.com/docs/bugbot) or CodeRabbit on the repository. The `AI Review (optional)` workflow does not fail merges.

Design specs: [quality toolchain](../intent/quality-toolchain/spec.md), [source security CI layering](../intent/source-security-ci-layering/spec.md)
