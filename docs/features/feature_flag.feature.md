# Feature Flag Feature

## Overview

Redis-backed feature flags with an in-memory snapshot per application instance. Request-path evaluation is synchronous and never calls Redis. Updates propagate via Redis Pub/Sub with periodic reconciliation for missed events.

---

## Evaluation API

Business modules inject `FeatureFlagService` only:

```ts
featureFlags.isEnabled(
  'new-checkout',
  {
    userId: user.id,
    organizationId: organization.id,
  },
  { defaultValue: false },
);
```

- **Boolean:** `enabled` maps directly to on/off.
- **Percentage:** deterministic `sha256(\`${flagKey}:${targetingValue}\`).slice(0, 8) % 100 < rolloutPercentage`.
- Missing flag / missing targeting / invalid config → `defaultValue` (default `false`).

---

## Redis layout

| Purpose   | Key / channel               |
| --------- | --------------------------- |
| Flag JSON | `feature_flags:{env}:{key}` |
| Index SET | `feature_flags:index:{env}` |
| Pub/Sub   | `feature_flags:events`      |

`env` comes from `FEATURE_FLAG_ENV`, then `NODE_ENV`, then `development`.

Writes use a Lua CAS script (optimistic concurrency via `expectedVersion`).

---

## Management API

All routes require JWT authentication. Admins (`User.role = admin`) receive permissions `flag:read`, `flag:create`, `flag:update`, `flag:delete`.

Emails listed in `FEATURE_FLAG_ADMIN_EMAILS` are promoted to admin on register/login.

| Method | Path                  | Permission                                 |
| ------ | --------------------- | ------------------------------------------ |
| GET    | `/feature-flags`      | `flag:read`                                |
| GET    | `/feature-flags/:key` | `flag:read`                                |
| POST   | `/feature-flags`      | `flag:create`                              |
| PUT    | `/feature-flags/:key` | `flag:update` (`expectedVersion` required) |
| DELETE | `/feature-flags/:key` | `flag:delete` (`expectedVersion` required) |

Audit records are appended to MongoDB collection `feature_flag_audits`.

---

## Failure behavior

- Redis down at startup → empty local snapshot, evaluations use defaults, app still starts.
- Pub/Sub disconnect → keep serving local snapshot, reconnect, full reconcile.
- `/health` and `/health/ready` include a `feature_flags` detail that reports `stale` but **does not fail** the probe solely because flags are stale.

---

## Environment variables

- `FEATURE_FLAG_ENV`
- `FEATURE_FLAG_RECONCILE_MS` (default `45000`)
- `FEATURE_FLAG_ADMIN_EMAILS`
- `FEATURE_FLAG_METRICS` (default enabled; set `false` to disable EMF)

---

## Module location

`src/core/feature-flag/` — export surface is `FeatureFlagModule` and `FeatureFlagService`.
