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
    // @fastify/jwt copies the payload into req.user verbatim — no camelCase
    // conversion. Fields are optional because jwtVerify() validates the
    // signature, not the claim set.
    user: {
      sub?: string;
      company_id?: string;
      kind?: "user" | "service";
      scope?: readonly string[];
    };
  }
}

// Fixed dev company ID used when DISABLE_AUTH=true. Any UUID is fine —
// just needs to be stable so DB RLS scoping is consistent across requests.
const DEV_COMPANY_ID = "00000000-0000-0000-0000-000000000001";

export async function registerAuth(app: FastifyInstance): Promise<void> {
  const env = loadEnv();
  if (env.DISABLE_AUTH) {
    app.log.warn("DISABLE_AUTH=true — JWT verification is disabled. Never use this in production.");
    return;
  }
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET!,
    sign: { iss: env.JWT_ISSUER, aud: env.JWT_AUDIENCE },
    verify: { allowedIss: env.JWT_ISSUER, allowedAud: env.JWT_AUDIENCE },
  });
}

/**
 * Verify the JWT and produce a TenantContext. Throws UNAUTHORIZED on
 * missing/invalid tokens. The JWT's company_id claim is the ONLY source
 * of truth for tenant identity — never trust a request header or body.
 *
 * WebSocket connections cannot set an Authorization header from the browser,
 * so we also accept a `?token=` query param. The query param is only
 * extracted here — never reflected back or logged.
 */
export function requireUser(app: FastifyInstance) {
  const env = loadEnv();

  if (env.DISABLE_AUTH) {
    return async function devAuth(req: FastifyRequest): Promise<TenantContext> {
      return {
        companyId: DEV_COMPANY_ID,
        subjectId: "dev",
        subjectKind: "user",
        requestId: req.id,
      };
    };
  }

  return async function authenticate(req: FastifyRequest): Promise<TenantContext> {
    // For WebSocket upgrade requests, browsers can't send Authorization.
    // Fall back to ?token= query param if the header is absent.
    const query = req.query as Record<string, string> | undefined;
    const queryToken = query?.token;
    if (queryToken && !req.headers.authorization) {
      req.headers.authorization = `Bearer ${queryToken}`;
    }

    try {
      await req.jwtVerify();
    } catch {
      throw err.unauthorized("invalid or missing token");
    }
    const u = req.user;
    if (!u?.company_id) {
      throw err.unauthorized("token missing company_id");
    }
    if (u.kind !== "user" && u.kind !== "service") {
      throw err.unauthorized("token missing kind");
    }
    return {
      companyId: u.company_id,
      subjectId: u.sub ?? "unknown",
      subjectKind: u.kind,
      requestId: req.id,
    };
  };
}
