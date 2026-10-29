---
title: Create CRUD
directory: docs/prompts
task_type: prompt
created: 2026-04-02
---

# Create CRUD

This file instructs AI agents on how to design and implement a complete CRUD module for any given resource in this NestJS project. Follow the workflow, file structure, and conventions below exactly. Use the `auth` module at `src/auth/` as the primary style and structure reference.

---

## Agent Workflow

Follow these steps in order before writing any code:

1. **Identify the resource** — confirm the entity name (e.g. `product`, `order`, `post`). Use singular lowercase for the module name.
2. **Read the reference module** — read `src/auth/` top to bottom: controller, service, module, dto, schema, types. Calibrate naming, import style, and response patterns from it.
3. **Read supporting files** — read `docs/code/coding_conventions.md` and `docs/code/best_practices.md` before writing any code.
4. **Plan the schema** — confirm fields, types, and any relationships with the user before generating files.
5. **Generate all files** in the order defined in the [File Generation Order](#file-generation-order) section.
6. **Register the module** in `src/app.module.ts`.
7. **Run the quality checklist** at the end before finalizing.

---

## Directory Structure

For a resource named `<resource>`, create the following structure under `src/`:

```
src/
└── <resource>/
    ├── <resource>.module.ts
    ├── <resource>.controller.ts
    ├── <resource>.service.ts
    ├── dto/
    │   ├── <resource>.dto.ts
    │   └── index.ts
    ├── schemas/
    │   └── <resource>.schema.ts
    └── types/
        ├── <resource>.types.ts
        └── index.ts
```

Add guards or decorators inside `src/common/` only if they are generic and reusable across modules. Resource-specific logic stays inside the resource directory.

---

## File Generation Order

Generate files in this exact order to avoid missing imports:

1. `schemas/<resource>.schema.ts`
2. `types/<resource>.types.ts` + `types/index.ts`
3. `dto/<resource>.dto.ts` + `dto/index.ts`
4. `<resource>.service.ts`
5. `<resource>.controller.ts`
6. `<resource>.module.ts`
7. Update `src/app.module.ts`

---

## File Specifications

### 1. Schema — `schemas/<resource>.schema.ts`

- Define a `I<Resource>` interface that describes the **pure domain shape** — no Mongoose types, no decorators.
- The schema class **extends `Document` and implements `I<Resource>`** — this gives Mongoose its hooks while keeping field definitions typed against the interface.
- Export `<Resource>Document` as `HydratedDocument<<Resource>>` — this is the type used in the service for the Mongoose model.
- Include `timestamps: true` in the `@Schema` options — this automatically adds `createdAt` and `updatedAt`.
- Use `@Prop` options to enforce constraints: `required`, `unique`, `default`, `lowercase`, `trim`, `ref`, etc.
- Use `Types.ObjectId` and `ref` for any relational references to other schemas.

```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export interface I<Resource> {
  name: string;
  isActive: boolean;
  // add fields here — plain types only, no Mongoose imports
}

export type <Resource>Document = HydratedDocument<<Resource>>;

@Schema({ timestamps: true })
export class <Resource> extends Document implements I<Resource> {
  @Prop({
    required: true,
    unique: true,
    trim: true,
  })
  name: string;

  @Prop({ default: true })
  isActive: boolean;

  // relational reference example:
  // @Prop({ type: Types.ObjectId, ref: 'OtherResource', required: true })
  // otherResourceId: Types.ObjectId;
}

export const <Resource>Schema = SchemaFactory.createForClass(<Resource>);
```

**Why this pattern:**

- `I<Resource>` is the single source of truth for the domain shape — DTOs, response types, and service logic can all reference it.
- `extends Document` gives Mongoose `.save()`, `.toObject()`, `_id`, etc.
- `implements I<Resource>` forces the class to satisfy the interface — TypeScript will error if a field is missing or mistyped.
- `HydratedDocument<<Resource>>` gives the service full type awareness of both the class fields and the Mongoose document methods.

**`@Prop` option reference:**

| Option      | Type      | Use when                                       |
| ----------- | --------- | ---------------------------------------------- |
| `required`  | `boolean` | Field must always be present                   |
| `unique`    | `boolean` | Field must be unique across documents          |
| `default`   | any       | Field has a fallback value if not provided     |
| `lowercase` | `boolean` | Normalize string to lowercase before saving    |
| `trim`      | `boolean` | Strip leading/trailing whitespace              |
| `ref`       | `string`  | Name of the referenced schema (relations)      |
| `type`      | type      | Required when using `Types.ObjectId` or arrays |

---

### 2. Types — `types/<resource>.types.ts`

- Define request/response interfaces used by the service and controller.
- Do not import Mongoose types here — keep types plain.
- Export everything through `types/index.ts`.

```ts
export interface Create<Resource>Payload {
  name: string;
  // mirror the DTO fields
}

export interface <Resource>Response {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}
```

---

### 3. DTO — `dto/<resource>.dto.ts`

- Use `class-validator` decorators for all fields.
- Create separate classes for `Create` and `Update` operations.
- Extend `PartialType` from `@nestjs/mapped-types` for the Update DTO.
- Export everything through `dto/index.ts`.

```ts
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class Create<Resource>Dto {
  @IsString()
  @IsNotEmpty()
  name: string;

  // add fields here
}

export class Update<Resource>Dto extends PartialType(Create<Resource>Dto) {}
```

---

### 4. Service — `<resource>.service.ts`

- Inject the Mongoose model using `@InjectModel(<Resource>.name)`.
- Import `<Resource>` and `<Resource>Document` from the schema — use `Model<<Resource>Document>` as the model type.
- The `I<Resource>` interface from the schema can be used to type response mapping if needed.
- Implement the following methods: `create`, `findAll`, `findOne`, `update`, `remove`.
- Return plain objects or mapped `<Resource>Response` types — never return raw Mongoose documents.
- Use `async/await` throughout; no `.then()` chains.
- Throw `NotFoundException` from `@nestjs/common` when a document is not found.
- Use Nest `Logger` from `@nestjs/common` for error and info logging (Winston pipeline in `src/core/logger/`).

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { <Resource>, <Resource>Document } from './schemas/<resource>.schema';
import { Create<Resource>Dto, Update<Resource>Dto } from './dto';
import { <Resource>Response } from './types';

@Injectable()
export class <Resource>Service {
  constructor(
    @InjectModel(<Resource>.name)
    private readonly <resource>Model: Model<<Resource>Document>,
  ) {}

  async create(dto: Create<Resource>Dto): Promise<<Resource>Response> { ... }
  async findAll(): Promise<<Resource>Response[]> { ... }
  async findOne(id: string): Promise<<Resource>Response> { ... }
  async update(id: string, dto: Update<Resource>Dto): Promise<<Resource>Response> { ... }
  async remove(id: string): Promise<void> { ... }
}
```

---

### 5. Controller — `<resource>.controller.ts`

- Use `@Controller('<resource>')` with the plural resource name as the route prefix (e.g. `products`).
- Apply `@UseGuards(JwtAuthGuard)` at the controller level unless a route is intentionally public.
- Mark public routes with the `@Public()` decorator from `src/common/decorator/`.
- Use correct HTTP method decorators: `@Post`, `@Get`, `@Patch`, `@Delete`.
- Use `@Param('id')` for ID extraction and `@Body()` with the appropriate DTO.
- Return values directly from the service — do not wrap in custom response objects unless the project standard requires it.

```ts
import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { <Resource>Service } from './<resource>.service';
import { Create<Resource>Dto, Update<Resource>Dto } from './dto';

@UseGuards(JwtAuthGuard)
@Controller('<resources>')
export class <Resource>Controller {
  constructor(private readonly <resource>Service: <Resource>Service) {}

  @Post()
  create(@Body() dto: Create<Resource>Dto) {
    return this.<resource>Service.create(dto);
  }

  @Get()
  findAll() {
    return this.<resource>Service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.<resource>Service.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Update<Resource>Dto) {
    return this.<resource>Service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.<resource>Service.remove(id);
  }
}
```

---

### 6. Module — `<resource>.module.ts`

- Import `MongooseModule.forFeature` to register the schema.
- Declare and export the service so other modules can import it if needed.

```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { <Resource>, <Resource>Schema } from './schemas/<resource>.schema'; // also exports I<Resource> and <Resource>Document
import { <Resource>Service } from './<resource>.service';
import { <Resource>Controller } from './<resource>.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: <Resource>.name, schema: <Resource>Schema }]),
  ],
  controllers: [<Resource>Controller],
  providers: [<Resource>Service],
  exports: [<Resource>Service],
})
export class <Resource>Module {}
```

---

### 7. Register in AppModule — `src/app.module.ts`

Add the new module to the `imports` array in `app.module.ts`:

```ts
import { <Resource>Module } from './<resource>/<resource>.module';

@Module({
  imports: [
    // ...existing imports
    <Resource>Module,
  ],
})
export class AppModule {}
```

---

## Naming Conventions

| Concept          | Convention                                              | Example              |
| ---------------- | ------------------------------------------------------- | -------------------- |
| Module folder    | singular, lowercase                                     | `product`            |
| Class names      | PascalCase                                              | `ProductService`     |
| File names       | kebab-case                                              | `product.service.ts` |
| Route prefix     | plural, lowercase                                       | `products`           |
| DTO classes      | `Create<Resource>Dto`                                   | `CreateProductDto`   |
| Domain interface | `I<Resource>`                                           | `IProduct`           |
| Schema class     | PascalCase, extends `Document` implements `I<Resource>` | `Product`            |
| Document type    | `HydratedDocument<<Resource>>`                          | `ProductDocument`    |
| Injected model   | `<resource>Model`                                       | `productModel`       |

---

## Common Patterns

**Guard usage** — apply `JwtAuthGuard` at controller level by default. Use `@Public()` on routes that do not require authentication, consistent with how `auth.controller.ts` handles public routes.

**Error handling** — throw `NotFoundException` when a document lookup by ID returns null. Do not swallow errors silently; let the global exception filter in `src/common/filters/all-exceptions.filter.ts` handle formatting.

**Logging** — use Nest `Logger` for service-level logging (configured via `src/core/logger/`). Do not use `console.log`.

**Index files** — always create `dto/index.ts` and `types/index.ts` that re-export everything. Import from the index, not the file directly, when consuming from outside the folder.

---

## Quality Checklist

Before finalizing any CRUD implementation, verify:

- [ ] All 7 files are generated in the correct directory
- [ ] Schema file exports: `I<Resource>` interface, `<Resource>Document` type, schema class, and schema constant
- [ ] Schema class extends `Document` and implements `I<Resource>`
- [ ] Schema uses `SchemaFactory.createForClass` with `timestamps: true`
- [ ] Service model is typed as `Model<<Resource>Document>`
- [ ] DTOs use `class-validator` decorators and `PartialType` for Update
- [ ] Service throws `NotFoundException` for missing documents
- [ ] Controller applies `JwtAuthGuard` and uses correct HTTP decorators
- [ ] Module registers the schema via `MongooseModule.forFeature`
- [ ] `AppModule` imports the new module
- [ ] `dto/index.ts` and `types/index.ts` export all members
- [ ] No `console.log` — project logger used instead
- [ ] Naming conventions table is followed throughout
- [ ] `src/auth/` was read and used as the style reference
