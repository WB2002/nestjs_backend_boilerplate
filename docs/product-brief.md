# Product brief

## Problem

Teams need a production-grade NestJS API foundation with auth, overload controls, observability, and security defaults—not a blank starter—without rebuilding the same cross-cutting modules for every product.

## Users

- Backend engineers shipping new API products on a shared boilerplate
- Platform / SRE owners operating multi-VM or ALB-fronted deployments
- AI agents implementing features under human-gated intent/spec/plan artifacts

## Success metrics

- New modules follow documented CRUD and convention patterns without rework
- Quality gate (`pnpm quality` / CI) passes on main
- Feature behavior documented in `docs/features/` and traceable to `intent/<slug>/`

## Scope

- Reusable HTTP/GraphQL/WebSocket API core, background jobs, caching, rate limits, CSRF, captcha, feature flags, notifications
- Operations and overload documentation under `docs/operations/`
- Artifact-driven AI-SDLC under `intent/` and `.cursor/`

## Non-goals

- A single deployed product UI (this repo is backend-only)
- Hosting or provisioning cloud accounts in-repo
- Replacing human approval of intent, spec, plan, or production deploys
