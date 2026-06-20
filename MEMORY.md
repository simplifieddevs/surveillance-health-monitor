
## Surveillance Health Monitor (project)
- Path: `/home/agent/.openclaw/workspace/projects/surveillance-health-monitor/`
- Stack: Node 20, TypeScript strict, Fastify 5, Drizzle ORM, BullMQ, ioredis, undici, Zod
- Multi-tenant via Postgres RLS (forced) + JWT company_id claim; `SET LOCAL app.company_id` per request
- AES-256-GCM credential vault with `KeyProvider` interface (env impl shipped; KMS pluggable)
- Adapters: ONVIF, Hikvision ISAPI, Dahua HTTP CGI, Uniview LAPI, Hanwha SUNAPI, Axis VAPIX (HTTP layer real, response parsers stubbed)
- License tiers: trial/basic/pro/enterprise with maxDevices, pollInterval, maxConcurrentPolls, retention
- Tests: 15 vitest cases passing; typecheck clean
- Known TS gotcha: bullmq bundles its own ioredis — cast `as unknown as ConnectionOptions` at the BullMQ boundary
- Pino logger doesn't satisfy Fastify's FastifyBaseLogger shape (msgPrefix); we use Fastify's default logger and bridge via onResponse hook
