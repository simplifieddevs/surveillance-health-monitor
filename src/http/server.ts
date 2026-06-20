import Fastify, { type FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { loadEnv } from "../config/env.js";
import { getLogger } from "../core/logger.js";
import { pingDatabase } from "../db/client.js";
import { tenantGuard } from "./tenant-guard.js";
import { registerWs } from "./ws.js";
import { sitesRoutes } from "./routes/sites.js";
import { deviceRoutes } from "./routes/devices.js";
import { companiesRoutes } from "./routes/companies.js";
import { licenseRoutes } from "./routes/licenses.js";
import { eventsRoutes } from "./routes/events.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import type { CredentialVault } from "../crypto/credential-vault.js";

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
  }
}

export interface ServerDeps {
  vault: CredentialVault;
  redis: Redis;
}

/**
 * Build (but do not start) the Fastify server. Exported separately from
 * `start()` so tests can build + close without binding a port.
 */
export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const env = loadEnv();
  const app = Fastify({
    logger: false, // we log via our own pino instance through onResponse hooks if needed
    disableRequestLogging: true,
    trustProxy: false,
    bodyLimit: 1024 * 1024, // 1 MiB; credentials can be large for some vendors
  });

  // Stash shared deps on the instance so route plugins can reach them.
  app.redis = deps.redis;

  // Bridge our pino logger into Fastify's request lifecycle.
  const log = getLogger();
  app.addHook("onResponse", async (req, reply) => {
    log.info(
      {
        requestId: req.id,
        method: req.method,
        url: req.url,
        statusCode: reply.statusCode,
      },
      "request",
    );
  });

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/readyz", async (req, reply) => {
    try {
      await pingDatabase();
      return { ok: true, db: "ok" };
    } catch (e) {
      reply.code(503);
      return { ok: false, db: "fail", err: String(e) };
    }
  });

  // Auth + tenant guard BEFORE route plugins so the onRequest hook is
  // installed ahead of route resolution.
  await app.register(tenantGuard);

  // Routes.
  await app.register(sitesRoutes);
  await app.register(companiesRoutes);
  await app.register(licenseRoutes);
  await app.register(eventsRoutes);
  await app.register(dashboardRoutes);
  await app.register(deviceRoutes, { deps: { vault: deps.vault } });

  // WebSocket stream (also gated by tenant guard via onRequest hook).
  await registerWs(app);

  return app;
}

export async function startServer(app: FastifyInstance): Promise<void> {
  const env = loadEnv();
  await app.listen({ host: env.HTTP_HOST, port: env.HTTP_PORT });
}
