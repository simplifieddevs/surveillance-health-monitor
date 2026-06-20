import type { FastifyRequest, FastifyReply, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { requireUser, registerAuth } from "./auth.js";
import { AppError } from "../core/errors.js";
import type { TenantContext } from "../core/tenant-context.js";

/**
 * tenantGuard — Fastify plugin that:
 *   1. Registers @fastify/jwt.
 *   2. Adds an `onRequest` hook that authenticates the request, attaches
 *      a TenantContext as `req.tenant`, and refuses requests with no
 *      valid JWT (other than the routes in OPEN_PATHS).
 *
 * Routes that need a tenant simply read `req.tenant`. There's no way for
 * a handler to skip the guard short of registering the route in
 * OPEN_PATHS, which is the audit-friendly list to keep small.
 */

const OPEN_PATHS: ReadonlySet<string> = new Set([
  "/healthz",
  "/readyz",
  "/openapi.json",
]);

declare module "fastify" {
  interface FastifyRequest {
    tenant?: TenantContext;
  }
}

async function tenantGuardImpl(app: import("fastify").FastifyInstance): Promise<void> {
  await registerAuth(app);

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    // Skip CORS preflight.
    if (req.method === "OPTIONS") return;
    // The hook runs before route resolution, so req.routeOptions is unset.
    // Match by raw URL against the open set.
    const url = (req.url ?? "").split("?")[0] ?? "";
    if (OPEN_PATHS.has(url)) return;

    const authenticate = requireUser(app);
    const ctx = await authenticate(req);
    req.tenant = ctx;
    void reply;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      reply.code(err.statusCode).send({
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
      });
      return;
    }
    reply.code(500).send({
      error: { code: "INTERNAL", message: "Internal error" },
    });
  });
}

export const tenantGuard: FastifyPluginAsync = fp(tenantGuardImpl, {
  name: "shm.tenant-guard",
});
