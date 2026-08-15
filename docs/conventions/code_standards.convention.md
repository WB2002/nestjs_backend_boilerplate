# Code Standards

This file defines the coding standards for the `nestjs_backend_boilerplate` project. All contributors and AI agents must follow these standards when writing or modifying any code. For where files go, see `docs/code/project_structure.convention.md`. For how to build a CRUD module, see `docs/prompts/create_crud.md`.

---

## Language and Runtime

- TypeScript is the only permitted language — no plain `.js` files inside `src/`.
- `strict` mode is enabled in `tsconfig.json` — all strict checks must pass.
- Target runtime is Node.js — do not use browser APIs.
- Use `pnpm` exclusively for package management — do not use `npm` or `yarn`.

---

## Naming Conventions

| Construct                 | Convention                      | Example              |
| ------------------------- | ------------------------------- | -------------------- |
| Class                     | PascalCase                      | `ProductService`     |
| Interface                 | PascalCase, prefixed `I`        | `IProduct`           |
| Type alias                | PascalCase                      | `ProductDocument`    |
| Enum                      | PascalCase, members UPPER_SNAKE | `UserRole.ADMIN`     |
| Function / method         | camelCase                       | `findOneById`        |
| Variable                  | camelCase                       | `productModel`       |
| Constant                  | UPPER_SNAKE_CASE                | `MAX_LOGIN_ATTEMPTS` |
| File                      | kebab-case                      | `product.service.ts` |
| Directory                 | singular, lowercase             | `product`, `common`  |
| Mongoose model (injected) | `<resource>Model`               | `productModel`       |
| DTO                       | `<Action><Resource>Dto`         | `CreateProductDto`   |
| Schema interface          | `I<Resource>`                   | `IProduct`           |
| Document type             | `<Resource>Document`            | `ProductDocument`    |

---

## TypeScript

- Always declare explicit return types on public class methods.
- Never use `any` — use `unknown` and narrow the type, or define a proper interface.
- Never use non-null assertion (`!`) — handle `null` and `undefined` explicitly.
- Prefer `interface` over `type` for object shapes. Use `type` only for unions, intersections, or aliases.
- Use `readonly` on class properties that are never reassigned after construction.
- Use `as const` for literal values that should not be widened.
- Never use `enum` for string values — use a `const` object with `as const` instead:

```ts
// correct
export const UserRole = {
  ADMIN: 'admin',
  USER: 'user',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

// incorrect
enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
}
```

---

## Imports

- Use absolute imports from the module root — avoid deep relative paths (`../../../`).
- Always import from a directory's `index.ts`, not from the file directly:

```ts
// correct
import { CreateProductDto } from './dto';
import { AppLogger } from '../common/logger';

// incorrect
import { CreateProductDto } from './dto/product.dto';
import { AppLogger } from '../common/logger/logger.context';
```

- Group imports in this order, separated by a blank line:
  1. Node built-ins (e.g. `path`, `crypto`)
  2. Third-party packages (e.g. `@nestjs/common`, `mongoose`)
  3. Internal project imports (`src/common`, `src/types`)
  4. Module-local imports (`./dto`, `./schemas`)

- Never use wildcard imports (`import * as ...`) unless the library requires it.

---

## Classes and Decorators

- One class per file — no exceptions.
- All NestJS injectable classes (`@Injectable`, `@Controller`, `@Module`) must use constructor injection — no property injection.
- Constructor parameters must be `private readonly` unless mutation is explicitly required:

```ts
// correct
constructor(private readonly productService: ProductService) {}

// incorrect
constructor(private productService: ProductService) {}
```

- Decorate every DTO property with at least one `class-validator` decorator.
- Never put business logic in a constructor — use `onModuleInit` if initialization logic is needed.

---

## Async and Error Handling

- Use `async/await` exclusively — no `.then()` or `.catch()` chains.
- Always `await` promises — never fire-and-forget unless explicitly intentional and documented.
- Throw NestJS HTTP exceptions from services — do not construct raw `Error` objects for expected failures:

```ts
// correct
throw new NotFoundException(`Product ${id} not found`);
throw new BadRequestException('Email already in use');

// incorrect
throw new Error('not found');
```

- Never swallow errors with an empty `catch` block — always log or rethrow:

```ts
// correct
try {
  await this.productModel.findById(id);
} catch (error) {
  this.logger.error('Failed to find product', error);
  throw new InternalServerErrorException();
}

// incorrect
try {
  await this.productModel.findById(id);
} catch {}
```

---

## Logging

- The project logger from `src/common/logger/` is the only permitted logging mechanism.
- `console.log`, `console.error`, and `console.warn` are forbidden everywhere in `src/`.
- Inject the logger via the constructor — never instantiate it directly.
- Use the correct log level:

| Level   | When to use                                             |
| ------- | ------------------------------------------------------- |
| `log`   | General informational events (module init, key actions) |
| `warn`  | Recoverable unexpected states                           |
| `error` | Caught exceptions and failures                          |
| `debug` | Verbose detail useful only during development           |

---

## Mongoose and Schemas

- Every schema file exports four things in this order: the domain interface (`I<Resource>`), the document type (`<Resource>Document`), the schema class, and the schema constant.
- Schema class always extends `Document` and implements `I<Resource>`.
- Always include `timestamps: true` in `@Schema` options.
- Never query the database from a controller — all database access lives in the service.
- Never return a raw Mongoose document from a service method — map to a response type or plain object before returning.
- Use `lean()` on read queries that do not need Mongoose document methods.

---

## DTOs and Validation

- Every DTO property must have at least one `class-validator` decorator.
- Use `PartialType` from `@nestjs/mapped-types` for Update DTOs — do not duplicate field definitions.
- Do not add transformation logic inside DTOs — use `class-transformer` decorators (`@Transform`, `@Type`) only for type coercion.
- DTOs are request-boundary objects only — do not pass them into schema constructors or return them from services.

---

## Controllers

- Controllers are routing layers only — no business logic, no database calls.
- Every route handler must have an explicit HTTP method decorator (`@Get`, `@Post`, `@Patch`, `@Delete`).
- Use `@Param`, `@Body`, `@Query` decorators to extract request data — never access `req` directly unless there is no alternative.
- Do not add `@UseGuards(JwtAuthGuard)` — the guard is globally registered. Use `@Public()` to opt out on a controller or route handler.
- Return the service result directly — do not wrap responses in a custom envelope unless it is a project-wide standard.

---

## Services

- Services contain all business logic — they are framework-agnostic by design.
- Never import `@nestjs/common` HTTP primitives (`Request`, `Response`, `HttpException` subclasses are fine) into a service.
- Every public method must have an explicit return type.
- Keep methods focused — if a method exceeds ~30 lines, consider extracting a private helper.

---

## Constants

- All magic strings and numbers must be extracted to a constant.
- Application-wide constants belong in `src/common/constant/`.
- Module-specific constants belong in the module directory — not in `src/common/`.
- Constant files use UPPER_SNAKE_CASE for exported values:

```ts
// src/common/constant/app.constant.ts
export const APP_NAME = 'nestjs_backend_boilerplate';
export const MAX_LOGIN_ATTEMPTS = 5;
```

---

## Comments and Documentation

- Code should be self-documenting — prefer clear naming over explanatory comments.
- Use comments only to explain **why**, never **what** — the code explains what.
- Do not leave commented-out code in the codebase — use version control instead.
- Use JSDoc (`/** */`) on public service methods when the behaviour is non-obvious:

```ts
/**
 * Finds an active product by ID.
 * Returns null if the product exists but is inactive.
 */
async findActiveById(id: string): Promise<ProductResponse | null> { ... }
```

---

## General Rules

- No `console.log` anywhere in `src/`.
- No `TODO` comments in committed code — create a ticket instead.
- No unused imports, variables, or parameters — the linter will catch these.
- No default exports — always use named exports.
- No barrel files (`index.ts`) outside of `dto/` and `types/` directories — keep re-exports intentional and scoped.
- Never disable ESLint rules inline (`// eslint-disable`) without a comment explaining why.
