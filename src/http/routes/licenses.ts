import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { withTenantDb, withSystemDb } from "../../db/client.js";
import {
  getEffectiveLicense,
  requireLicense,
} from "../../db/repositories/licenses.js";
import { licenses } from "../../db/schema.js";
import { LICENSE_TIERS } from "../../config/license-tiers.js";
import { err } from "../../core/errors.js";

const IssueBody = z.object({
  companyId: z.string().uuid(),
  tier: z.enum(["trial", "basic", "pro", "enterprise"]),
  expiresAt: z.string().datetime(),
  seats: z.number().int().nonnegative().optional(),
  notes: z.string().max(1000).optional(),
});

export const licenseRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/license", async (req) => {
    const ctx = req.tenant;
    if (!ctx) throw err.tenantRequired(req.id);
    const lic = await withTenantDb(ctx, (db) => getEffectiveLicense(db, ctx));
    if (!lic) return { license: null, tier: null };
    return { license: lic, tier: LICENSE_TIERS[lic.tier] };
  });

  // Admin-only: issue a new license. Cross-tenant by design.
  app.post("/v1/_internal/licenses", async (req, reply) => {
    const ctx = req.tenant;
    if (!ctx) throw err.tenantRequired(req.id);
    if (ctx.subjectKind !== "service") throw err.forbidden("admin only");
    const body = IssueBody.parse(req.body);
    const inserted = await withSystemDb(async (db) => {
      const rows = await db
        .insert(licenses)
        .values({
          companyId: body.companyId,
          tier: body.tier,
          state: "active",
          expiresAt: new Date(body.expiresAt),
          seats: body.seats ?? 0,
          notes: body.notes ?? null,
        })
        .returning();
      return rows[0];
    });
    reply.code(201);
    return inserted;
  });

  // Helper used by the worker cron: returns ids of licenses whose state
  // should be transitioned to "expired". System-initiated.
  app.get("/v1/_internal/licenses/expiring", async () => {
    const now = new Date();
    const due = await withSystemDb(async (db) => {
      const { and, lt, inArray } = await import("drizzle-orm");
      const rows = await db
        .select()
        .from(licenses)
        .where(and(inArray(licenses.state, ["trial", "active"]), lt(licenses.expiresAt, now)));
      return rows;
    });
    return { due: due.map((d) => d.id), count: due.length };
  });

  // Lint helper: requireLicense is exercised by every poll path.
  app.get("/v1/license/require", async (req) => {
    const ctx = req.tenant;
    if (!ctx) throw err.tenantRequired(req.id);
    return withTenantDb(ctx, (db) => requireLicense(db, ctx));
  });
};
