# Source security CI layering — design

**Date:** 2026-10-29  
**Status:** Approved for implementation

## Problem

Supply-chain malware and backdoors often use obfuscated JavaScript (e.g. base64 payloads, `eval` / `Function`) and exfiltrate `process.env` over HTTP. This repository must detect **suspicious patterns in first-party code** (`src/`, `test/`, `scripts/`) in CI—not by scanning `node_modules`.

## Goals

1. Layer **open-source only** tools in GitHub Actions and `pnpm quality:*` (no Socket, Snyk paid tiers, or other commercial scanners).
2. Fail CI on high-confidence obfuscation / exfil patterns in application paths.
3. Keep existing gates: ESLint, Gitleaks, CodeQL, `pnpm audit`, Trivy (CVEs).
4. Add advisory coverage for **lockfile changes** on pull requests (Dependency Review + OSV-Scanner).

## Non-goals

- Scanning or vendoring analysis of `node_modules` contents.
- Runtime network egress blocking in CI (future hardening).
- Replacing human review of new dependencies.

## Open-source tool stack

| Layer               | Tool                                                                            | License / cost                      |
| ------------------- | ------------------------------------------------------------------------------- | ----------------------------------- |
| Lint (patterns)     | ESLint + `eslint-plugin-security` + SonarJS                                     | OSS (already present)               |
| SAST (custom rules) | [Semgrep](https://github.com/semgrep/semgrep)                                   | LGPL-2.1                            |
| Secrets in tree     | [Gitleaks](https://github.com/gitleaks/gitleaks)                                | MIT (already present)               |
| Deep SAST           | [CodeQL](https://github.com/github/codeql-action)                               | Free for GitHub-hosted analysis     |
| Dependency CVEs     | `pnpm audit`, [OSV-Scanner](https://github.com/google/osv-scanner)              | OSS                                 |
| FS CVEs / secrets   | [Trivy](https://github.com/aquasecurity/trivy)                                  | Apache-2.0                          |
| PR dependency diff  | [dependency-review-action](https://github.com/actions/dependency-review-action) | GitHub Action (no third-party SaaS) |

## Scan scope

| Path              | Semgrep                                     | Trivy secret | ESLint                        | Long-base64 heuristic |
| ----------------- | ------------------------------------------- | ------------ | ----------------------------- | --------------------- |
| `src/**`          | yes                                         | yes          | yes                           | yes                   |
| `test/**`         | yes (relaxed test overrides in ESLint only) | yes          | yes                           | yes                   |
| `scripts/**`      | yes                                         | yes          | no (not in eslint glob today) | yes                   |
| `node_modules/**` | **no**                                      | **no**       | ignored                       | **no**                |

## Semgrep rule themes

1. Dynamic execution: `eval`, `new Function`, `vm.runInThisContext` with non-literal input.
2. Decode-then-execute: `Buffer.from(..., 'base64')` / `atob` flowing to execution sinks (heuristic patterns).
3. Env enumeration + network: `Object.keys(process.env)` / spread of env near `fetch`, `axios`, `http.request` (high severity, narrow patterns).
4. Optional: Semgrep OSS registry configs `p/javascript`, `p/nodejs`, `p/supply-chain` limited to app paths via CLI `--include`.

## CI job layout (quality workflow)

| Job                 | Purpose                                                               |
| ------------------- | --------------------------------------------------------------------- |
| `lint`              | ESLint (extended security rules)                                      |
| `app-security`      | Semgrep + long-base64 script on app paths                             |
| `supply-chain`      | frozen lockfile, audit, OSV-Scanner, Trivy vuln (skip `node_modules`) |
| `dependency-review` | PR-only; blocks vulnerable dependency changes                         |
| `secrets`           | Gitleaks (unchanged)                                                  |
| CodeQL workflow     | unchanged                                                             |

## Branch protection

Add required checks: `app-security`, `dependency-review` (PRs), existing supply-chain and secrets.

## Documentation

Update `docs/quality/README.md` with new scripts, local run commands, and allowlist process for false positives.
