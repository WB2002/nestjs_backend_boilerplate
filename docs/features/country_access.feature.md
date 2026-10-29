# Country Access (IP Georestriction)

Coarse country-based access control using local MaxMind GeoLite2 Country lookups
and an in-memory allowlist snapshot. Persistence is database-agnostic behind a
single repository interface.

## Architecture

```
PostgreSQL (default)  OR  MongoDB
            │
            ▼
  CountryAccessRepository
            │
            ▼
  CountryAccessService  →  ReadonlySet<string> (enabled countries)
            │
Request → ClientIp → GeoIP (MMDB) → Country → Allow / 403
```

The request path never queries a database and never calls a remote geolocation API.

## Persistence swap

Default binding (PostgreSQL):

```ts
const ACTIVE_PERSISTENCE_PROVIDER = 'postgres';
{ provide: COUNTRY_ACCESS_REPOSITORY, useExisting: PostgresCountryAccessRepository }
```

To use MongoDB, change that one `useExisting` target to `MongoCountryAccessRepository`
(and set `ACTIVE_PERSISTENCE_PROVIDER` to `'mongodb'`) in
`src/common/country-access/country-access.module.ts`. Do not duplicate business logic.

## PostgreSQL migration

```bash
psql "$POSTGRES_URL" -f migrations/postgres/001_create_country_access.sql
# rollback:
psql "$POSTGRES_URL" -f migrations/postgres/001_create_country_access.down.sql
```

Table: `country_access (country_code CHAR(2) PK, enabled, created_at, updated_at)`.

## MongoDB collection

Collection: `country_access`

```json
{
  "_id": "PK",
  "countryCode": "PK",
  "enabled": true,
  "createdAt": "...",
  "updatedAt": "..."
}
```

Unique index on `countryCode`. Indexes are ensured via Mongoose schema registration.

## GeoLite2 Country MMDB

1. Create a free MaxMind account: https://www.maxmind.com/en/geolite2/signup
2. Generate a license key under Account → Manage License Keys.
3. Download GeoLite2 Country (MMDB), or use geoipupdate:

```bash
# Example with geoipupdate (install separately)
# Edit GeoIP.conf with AccountID + LicenseKey
geoipupdate -d /data
export GEOIP_DATABASE_PATH=/data/GeoLite2-Country.mmdb
```

4. Mount the file into Docker (see `docker-compose.yml` comments). **Do not commit `*.mmdb`.**

Update monthly — MaxMind rotates GeoLite2 databases regularly.

## Request flow

1. Global `CountryAccessGuard` (after JWT, before rate limit)
2. `@SkipCountryAccess()` / configured bypass paths (defaults: `/health`, `/health/ready`)
3. If snapshot is inactive (initial DB failure): allow and log bypass
4. Resolve trusted client IP via Fastify `request.ip` (`TRUST_PROXY`)
5. Local MMDB country lookup
6. In-memory allowlist check → continue or HTTP 403

## Startup behavior

- Missing/invalid `GEOIP_DATABASE_PATH` / MMDB → **fail startup**
- Repository unavailable on first load → guard stays **inactive** (allows traffic) and retries on the refresh interval. Treat this as a temporary risk; prefer fixing DB connectivity quickly.
- Refresh failure after activation → keep last known-good snapshot

## Configuration

| Variable                                | Default                 | Purpose                             |
| --------------------------------------- | ----------------------- | ----------------------------------- |
| `GEOIP_DATABASE_PATH`                   | required                | Path to GeoLite2-Country.mmdb       |
| `COUNTRY_ACCESS_REFRESH_INTERVAL_MS`    | `60000`                 | Snapshot refresh interval           |
| `COUNTRY_ACCESS_UNKNOWN_COUNTRY_POLICY` | `block`                 | `block` or `allow` when GeoIP fails |
| `COUNTRY_ACCESS_BYPASS_PATHS`           | `/health,/health/ready` | Comma-separated bypass paths        |
| `TRUST_PROXY`                           | `false`                 | `true`, `false`, or CIDR/IP list    |
| `POSTGRES_*`                            | see `.env.example`      | Default repository connection       |

There is no `DATABASE_TYPE` switch; swap the repository `useExisting` target (and `ACTIVE_PERSISTENCE_PROVIDER`) manually.

## Observability

Structured logs/metrics (`CountryAccess` namespace) cover:

- access denied (country code + reason; never full IP)
- invalid IP / unknown country / GeoIP failure
- inactive bypass
- refresh success/failure, provider, snapshot version, last successful refresh

## Security notes

Country filtering is **not** authentication, RBAC, or entitlement checking.
It is a coarse network/application restriction only.

Unknown/private/malformed IPs default to **block** when the service is active.
Do not trust `X-Forwarded-For` unless `TRUST_PROXY` is configured for your reverse proxy.
