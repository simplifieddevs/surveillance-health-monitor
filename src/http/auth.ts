import type { FastifyInstance, FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import { loadEnv } from "../config/env.js";
import type { TenantContext } from "../core/tenant-context.js";
import { err } from "../core/errors.js";

/**
 * JWT auth — HS256. Tokens carry company_id, sub, and scope.
 * Routes that don't pass through tenantGuard MUST NOT touch tenant data.
 *
 * Subject kinds:
 *   - "user":   human operator (console, dashboard).
 *   - "service": M2M (poller callbacks, webhooks). Bound to company_id
 *                and limited to a narrow allowlist of routes.
 */

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: string;
      company_id: string;
      kind: "user" | "service";
      scope?: readonly string[];
      iat?: number;
      exp?: number;
      iss?: string;
      aud?: string;
    };
    user: {
      sub: string;
      companyId: string;
      kind: "user" | "service";
      scope: readonly string[];
    };
  }
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  const env = loadEnv();
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { iss: env.JWT_ISSUER, aud: env.JWT_AUDIENCE },
    verify: { allowedIss: env.JWT_ISSUER, allowedAud: env.JWT_AUDIENCE },
  });
}

/**
 * Verify the JWT and produce a TenantContext. Throws UNAUTHORIZED on
 * missing/invalid tokens. The JWT's company_id claim is the ONLY source
 * of truth for tenant identity — never trust a request header or body.
 */
export function requireUser(app: FastifyInstance) {
  return async function authenticate(req: FastifyRequest): Promise<TenantContext> {
    try {
      await req.jwtVerify();
    } catch {
      throw err.unauthorized("invalid or missing token");
    }
    const payload = req.user;
    if (!payload?.companyId) {
      throw err.unauthorized("token missing company_id");
    }
    return {
      companyId: payload.companyId,
      subjectId: payload.sub,
      subjectKind: payload.kind,
      requestId: req.id,
    };
  };
}
