# Project Structure Convention

This file documents the canonical directory and file structure of the `nestjs_backend_boilerplate` project. It is the authoritative reference for where files live, what each directory owns, and how new modules must be structured. All contributors and AI agents must follow these conventions when adding or modifying code.

---

## Top-Level Layout

```
nestjs_backend_boilerplate/
├── src/                        # All application source code
├── docs/                       # Project documentation and AI agent prompts
├── docker-compose.yml          # Local development container setup
├── Dockerfile                  # Production container definition
├── nest-cli.json               # NestJS CLI configuration
├── package.json
├── pnpm-lock.yaml              # Lockfile — never edit manually
├── eslint.config.mjs           # Linting rules
├── tsconfig.json               # Base TypeScript config
├── tsconfig.build.json         # Build-specific TypeScript config
└── README.md
```

**Rules:**

- All application code lives under `src/` — nothing outside it is part of the runtime.
- All documentation lives under `docs/` — no `.md` files inside `src/`.
- Use `pnpm` exclusively — do not use `npm` or `yarn`. Never edit `pnpm-lock.yaml` by hand.

---

## Source Directory — `src/`

```
src/
├── main.ts                     # Application bootstrap — do not add business logic here
├── app.module.ts               # Root module — imports all feature modules
├── app.controller.ts           # Root-level health/meta routes only
├── app.service.ts              # Root-level service only if no feature module fits
├── auth/                       # Authentication feature module
├── health/                     # Health check module
├── common/                     # Shared infrastructure — no business logic
└── types/                      # Global type definitions
```

### Ownership rules

- `main.ts` — bootstrap only: `NestFactory.create`, global pipes, filters, middleware, and `app.listen`. No business logic.
- `app.module.ts` — imports feature modules and global providers (e.g. `MongooseModule.forRoot`, `ConfigModule`). No route handlers.
- `app.controller.ts` / `app.service.ts` — use only for application-level concerns that do not belong to any feature module. Keep minimal.
- New features always get their own module directory — never add feature routes to `app.controller.ts`.

---

## Feature Module Structure

Every feature lives in its own directory under `src/`. Use the `auth` module as the canonical reference for structure and style.

```
src/<resource>/
├── <resource>.module.ts        # NestJS module definition
├── <resource>.controller.ts    # Route handlers — no business logic
├── <resource>.service.ts       # Business logic — no HTTP concerns
├── dto/
│   ├── <resource>.dto.ts       # Create and Update DTO classes
│   └── index.ts                # Re-exports all DTOs
├── schemas/
│   └── <resource>.schema.ts    # Mongoose schema, interface, and document type
└── types/
    ├── <resource>.types.ts     # Response interfaces and payload types
    └── index.ts                # Re-exports all types
```

Add the following only when the feature requires them:

```
├── guards/                     # Guards specific to this feature only
│   └── <name>.guard.ts
├── strategies/                 # Passport strategies (auth module only by default)
│   └── <name>.strategy.ts
└── decorators/                 # Decorators specific to this feature only
    └── <name>.decorator.ts
```

**Rules:**

- Controllers handle HTTP only — no business logic.
- Services contain all business logic — no HTTP primitives (`Request`, `Response`, etc.).
- Guards, strategies, and decorators that are reusable across features belong in `src/common/`, not inside the feature directory.
- Every `dto/` and `types/` folder must have an `index.ts` that re-exports all members. Always import from the index, not the file directly.

---

## Auth Module — `src/auth/`

The auth module is the most complete feature module in the project and serves as the style reference for all new modules.

```
src/auth/
├── auth.module.ts
├── auth.controller.ts
├── auth.service.ts
├── dto/
│   ├── auth.dto.ts
│   └── index.ts
├── schemas/
│   ├── user.schema.ts          # User entity — primary auth schema
│   └── session.schema.ts       # Session entity for JWT session tracking
├── guards/
│   ├── jwt-auth.guard.ts       # Protects routes requiring a valid JWT
│   └── local-auth.guard.ts     # Handles username/password login flow
├── strategies/
│   ├── jwt.strategy.ts         # JWT validation strategy
│   └── local.strategy.ts       # Local (username/password) strategy
└── types/
    ├── auth.types.ts
    └── index.ts
```

**Conventions carried into new modules:**

- Guards live inside the module that owns them (`auth/guards/`) — only move to `common/` if used by other modules.
- Multiple schemas per module are allowed when entities are tightly coupled (e.g. `user` and `session`).
- `JwtAuthGuard` is registered globally — all routes are protected by default. Apply `@Public()` at the controller or route handler level to opt out of authentication.

---

## Common Module — `src/common/`

Contains shared infrastructure used across all feature modules. Nothing in `common/` should contain business logic or be tied to a single feature.

```
src/common/
├── constant/
│   ├── app.constant.ts         # Application-wide constants (env keys, app name, etc.)
│   ├── cookie.constant.ts      # Cookie name and config constants
│   └── index.ts
├── decorator/
│   ├── public.decorator.ts     # @Public() — marks a route as unauthenticated
│   └── index.ts
├── filters/
│   ├── all-exceptions.filter.ts  # Global exception filter — formats all error responses
│   └── index.ts
├── logger/
│   ├── logger.config.ts        # Pino/Winston logger configuration
│   ├── logger.context.ts       # Request-scoped logger context
│   ├── logger.middleware.ts    # HTTP request logging middleware
│   ├── logging.interceptor.ts  # Response logging interceptor
│   ├── trace.decorator.ts      # @Trace() method-level tracing decorator
│   ├── tracing.interceptor.ts  # Distributed tracing interceptor
│   └── index.ts
└── util/
    ├── cookie.util.ts          # Cookie read/write helpers
    └── index.ts
```

**Rules:**

- Never import a feature module from `common/` — `common/` is a leaf in the dependency graph.
- All exports must go through the directory's `index.ts`.
- Adding a new shared utility, decorator, filter, or constant always goes here.
- The logger in `src/common/logger/` is the only permitted logging mechanism — no `console.log` anywhere in the project.

---

## Global Types — `src/types/`

```
src/types/
├── app.types.ts                # Application-wide interfaces (e.g. Request augmentation)
├── logger.types.ts             # Logger-specific type definitions
└── index.ts
```

**Rules:**

- Only truly global types live here — types used by a single module belong in that module's `types/` directory.
- Do not import from feature modules here — this directory must have zero feature dependencies.

---

## Health Module — `src/health/`

```
src/health/
├── health.controller.ts        # GET /health endpoint
└── health.module.ts
```

Minimal module — no service, no DTOs, no schemas. Exposes a health check endpoint used by Docker and load balancers. Do not add business logic here.

---

## Docs Directory — `docs/`

```
docs/
├── code/                       # Coding standards and conventions
│   ├── best_practices.md
│   ├── coding_conventions.md
│   ├── project_structure.md
│   └── tools_and_dependencies.md
├── features/                   # Feature-level documentation
│   ├── auth_feature.md
│   └── features.md
└── prompts/                    # AI agent instructions
    ├── create_crud.md
    └── create_markdown.md
```

| Directory        | Contains                                                       |
| ---------------- | -------------------------------------------------------------- |
| `docs/code/`     | Coding standards, conventions, dependency notes                |
| `docs/features/` | One file per feature describing endpoints, logic, and usage    |
| `docs/prompts/`  | Agent instruction files — how to create CRUDs, markdowns, etc. |

**Rules:**

- Every new feature module gets a corresponding `docs/features/<resource>_feature.md`.
- Every new AI agent instruction gets a file in `docs/prompts/`.
- File names use lowercase with underscores — no spaces, no camelCase.

---

## File Naming Reference

| File type       | Convention                 | Example                    |
| --------------- | -------------------------- | -------------------------- |
| Module          | `<resource>.module.ts`     | `product.module.ts`        |
| Controller      | `<resource>.controller.ts` | `product.controller.ts`    |
| Service         | `<resource>.service.ts`    | `product.service.ts`       |
| Schema          | `<resource>.schema.ts`     | `product.schema.ts`        |
| DTO             | `<resource>.dto.ts`        | `product.dto.ts`           |
| Types           | `<resource>.types.ts`      | `product.types.ts`         |
| Guard           | `<name>.guard.ts`          | `jwt-auth.guard.ts`        |
| Strategy        | `<name>.strategy.ts`       | `jwt.strategy.ts`          |
| Decorator       | `<name>.decorator.ts`      | `public.decorator.ts`      |
| Middleware      | `<name>.middleware.ts`     | `logger.middleware.ts`     |
| Interceptor     | `<name>.interceptor.ts`    | `logging.interceptor.ts`   |
| Filter          | `<name>.filter.ts`         | `all-exceptions.filter.ts` |
| Constant        | `<name>.constant.ts`       | `app.constant.ts`          |
| Utility         | `<name>.util.ts`           | `cookie.util.ts`           |
| Index re-export | `index.ts`                 | `index.ts`                 |
| Markdown doc    | `<name>.md`                | `auth.feature.md`          |

---

## Dependency Direction

Modules may only import in the following directions — never in reverse:

```
feature modules (auth, health, product, ...)
        ↓
   src/common/
        ↓
    src/types/
```

- Feature modules import from `common/` and `types/` freely.
- `common/` imports from `types/` only — never from a feature module.
- `types/` imports nothing from the project.
- Feature modules do not import from each other unless the dependency is explicitly exported and intentional (e.g. `AuthModule` exporting `JwtAuthGuard` for use in other controllers).

---

## Adding a New Feature Module — Checklist

- [ ] Directory created at `src/<resource>/` using singular lowercase name
- [ ] All required files present: module, controller, service, dto/, schemas/, types/
- [ ] `dto/index.ts` and `types/index.ts` created and exporting all members
- [ ] Schema file present in `schemas/` directory
- [ ] Module registered in `src/app.module.ts`
- [ ] Feature documented in `docs/features/<resource>_feature.md`
- [ ] No business logic in the controller
- [ ] No HTTP primitives in the service
- [ ] No `console.log` — project logger used throughout
- [ ] `@Public()` applied to any controller or route handler that should be unauthenticated
