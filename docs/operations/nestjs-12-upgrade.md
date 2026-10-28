# NestJS 12 upgrade (Phase 1)

## What changed

- Nest framework and platform packages: 11 → 12.
- `@nestjs/graphql` / `@nestjs/apollo`: 13 → 14; GraphQL IDE: `graphiql` replaces `playground`.
- `@nestjs/terminus`: 12; custom feature-flag health uses `HealthIndicatorService`.
- TypeScript 6; `tsconfig` uses `module` / `moduleResolution`: `nodenext`.
- Jest runs with `--experimental-vm-modules` (Node 24.9+); unit tests use shims for `sanitize-html`, `@nestjs/bullmq`, and `pg` (see `jest/` and `jest.config.ts`). Integration tests use `jest.integration.config.ts` (real `pg`; requires Docker for Testcontainers).
- Docker base image: `node:24-alpine`.

## What did not change

- class-validator + ValidationPipe; SanitizationPipe order.
- Fastify AJV options in `src/main.ts`.
- OpenTelemetry via `src/instrumentation.ts` (no `@nestjs/observe` in Phase 1).

## Verify after future Nest bumps

```bash
pnpm run lint && pnpm run build && pnpm test:unit && pnpm test:integration && pnpm run smoke:shutdown
```
