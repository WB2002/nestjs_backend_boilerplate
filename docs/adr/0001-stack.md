# ADR 0001: Application stack

Status: proposed  
Date: 2026-10-29

## Context

This repository is a NestJS backend boilerplate used as a reusable API foundation. Agents and humans need a single accepted stack reference for verify scripts, policies, and CI.

## Decision

- **Runtime:** Node.js 24.9+ (see `.nvmrc`), ESM TypeScript
- **Framework:** NestJS 12 on Fastify (REST, GraphQL, WebSockets)
- **Package manager:** pnpm only; lockfile `pnpm-lock.yaml`
- **Data:** PostgreSQL (preferred primary); MongoDB as fallback where modules still use document storage or during migration
- **Cache / queues:** Redis; BullMQ for background work
- **Testing:** Jest unit (`pnpm test:unit`); integration with Testcontainers (`pnpm test:integration`); contract/property configs as documented in `docs/quality/README.md`
- **Quality gate:** `pnpm quality:lint`, `pnpm quality:types`, `pnpm quality:app-security`, supply-chain scripts under `scripts/ci/`
- **AI-SDLC:** Artifact workflow under `intent/`; control plane in `.cursor/`; entry runbook `docs/ai-sdlc.md`

## Consequences

- `scripts/verify.sh` maps to lint, types, and unit tests until this ADR is accepted; integration remains optional in `verify-full.sh` for CI without Docker.
- Policy levels in `.cursor/policies/` may move from `deferred` to `enforced` as checks align with the commands above.

## Approval

Human owner sets Status to **accepted** when this matches production intent.
