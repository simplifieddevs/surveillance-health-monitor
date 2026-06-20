# Surveillance Health Monitor

Multi-tenant surveillance device health monitor. Tracks online/offline,
recording status, storage, channel state, and tamper signals across a
heterogeneous fleet (ONVIF, Hikvision ISAPI, Dahua HTTP CGI, Uniview
TVT LAPI, Hanwha SUNAPI, Axis VAPIX).

## Design pillars

- **Tenant isolation.** Every tenant-scoped table has Row-Level Security
  forced. The DB connection sets `app.company_id` per request via
  `SET LOCAL` inside an explicit transaction. A request without a valid
  JWT simply returns no rows.
- **Adapter boundary.** The polling core talks only to
  `VendorAdapter`. Vendor code lives in `src/adapters/<vendor>.ts`. To
  add a vendor: implement `VendorAdapter`, register in
  `src/adapters/registry.ts`, add the enum value in `src/db/schema.ts`
  + a migration.
- **Credentials are opaque.** `CredentialVault` uses AES-256-GCM with a
  per-ciphertext IV. Decryption happens only inside `withResolvedCredential`
  for the duration of one adapter call. Plaintext is never persisted and
  never crosses a route boundary.
- **License enforcement at the server.** `requireLicense()` is called by
  every action that creates devices or runs polls. Tier budgets
  (maxDevices, maxConcurrentPolls, retention) are enforced centrally.
- **Events, not logs.** `Event = (company_id, site_id, device_id, type,
  severity, detected_at, raw_payload, normalized_fields)`. The polling
  worker normalizes vendor output to this shape and inserts.

## Running locally

```bash
cp .env.example .env
# Edit .env: set JWT_SECRET, CRED_ENC_KEY to real 32-byte base64 keys.

docker compose up -d                  # Postgres + Redis
npm install
npm run migrate                       # applies src/db/migrations/*.sql
SHIM_MODE=api npm run dev             # HTTP server on :8080
SHIM_MODE=worker npm run dev          # polling + license-expiry cron
```

In another terminal:

```bash
npm test
```

## Project layout

```
src/
  config/         env loader, license tier table
  core/           tenant context, errors, logger, ids
  crypto/         KeyProvider, AES-GCM CredentialVault
  db/             schema, migrations, repositories, client
  adapters/       vendor adapters + registry (ONVIF + 5 vendors)
  polling/        scheduler, worker, budget, normalization
  http/           server, auth, tenant guard, routes, websocket
  workers/        event-indexer (LISTEN/NOTIFY -> WS), license-expiry
test/             vitest unit tests, fake adapter, fake vault
```

## API surface

OpenAPI: `openapi.yaml`. Quick reference:

| Method | Path | Notes |
|---|---|---|
| GET | `/healthz`, `/readyz` | probes |
| GET | `/v1/companies/{id}` | self only |
| GET/POST | `/v1/sites` | tenant-scoped |
| GET/POST | `/v1/devices` | tenant-scoped; tier budget on POST |
| GET | `/v1/license` | effective license + tier metadata |
| GET | `/v1/events` | window query, filters |
| GET | `/v1/events/counts` | grouped counts |
| GET | `/v1/dashboard` | single-payload view for ops + big screen |
| WS | `/v1/events/stream` | live + backfill via `{since}` |
| POST | `/v1/_internal/...` | service-token-only admin |

All non-probe routes require a Bearer JWT with `company_id` in the
payload. Tenant guard installs a single Fastify hook; there is no other
way to bypass it.

## What you need to wire up before prod

1. **Vendor XML/JSON parsers.** Adapters have the HTTP layer; the
   response parsers (ONVIF SOAP, Hikvision ISAPI XML, Dahua CGI
   responses, UNV LAPI JSON, Hanwha SUNAPI, Axis VAPIX) are stubbed
   and need implementation per the vendor's real shapes.
2. **Key management.** `EnvKeyProvider` is fine for dev. For prod,
   implement `KeyProvider` against AWS KMS / GCP KMS / Vault Transit.
3. **Migrations runner.** The included `src/db/migrate.ts` is a simple
   forward-only runner. For multi-developer setups, switch to
   `drizzle-kit` or `node-pg-migrate`.
4. **Auth issuer.** Tokens are assumed to be issued elsewhere; this
   service only verifies. The JWT secret (`JWT_SECRET`) must match.
5. **Partition rotation.** `events` is not yet partitioned — production
   scale requires monthly partitions and a rotation job.
