# Architecture

Stub aligned with `docs/conventions/project_structure.convention.md`. Accept or replace after `/project-brief` review.

## System boundaries

- This repository is the **application tier**: NestJS API, workers, and in-process adapters
- Edge rate limiting, ALB, and multi-VM Redis coordination are documented as deployment concerns in `docs/operations/`

## Domain

- Modular Nest domains under `src/` (auth, notifications, overload, http client, etc.)
- Shared cross-cutting core under `src/core/`

## Data

- PostgreSQL as preferred primary relational store (including skip-locked job patterns where applicable)
- MongoDB as fallback for document-oriented modules or transitional dual-store setups
- Redis for cache, pub/sub, rate limits, and coordination

## APIs

- REST and GraphQL on Fastify
- WebSockets with authenticated sessions
- Outbound HTTP client with concurrency and deadline policies

## Infrastructure

- Container-friendly Node 24+ process
- BullMQ workers; background job feature doc in `docs/features/background_jobs.feature.md`

## Non-functional requirements

See `docs/nfr.md` for SLOs, latency, retention, and compliance pointers.
