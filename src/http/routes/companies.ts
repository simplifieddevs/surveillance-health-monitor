import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { withTenantDb } from "../../db/client.js";
import * as companiesRepo from "../../db/repositories/companies.js";
import { err } from "../../core/errors.js";

const CreateBody = z.object({ name: z.string().min(1).max(200) });
const IdParams = z.object({ id: z.string().uuid() });

export const companiesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/companies/:id", async (req) => {
    const ctx = req.tenant;
    if (!ctx) throw err.tenantRequired(req.id);
    // A tenant can only read its own company row.
    if (req.params && typeof req.params === "object" && "id" in req.params) {
      const { id } = IdParams.parse(req.params);
      if (id !== ctx.companyId) throw err.forbidden("cross-tenant company lookup");
      return withTenantDb(ctx, (db) => companiesRepo.getCompany(db, ctx, id));
    }
    throw err.validation("missing id");
  });

  // Company creation is an admin operation; the bootstrap endpoint is
  // intentionally NOT a public route — operators create companies through
  // a separate provisioning service. Documented here for completeness.
  app.post("/v1/_internal/companies", async (req, reply) => {
    const ctx = req.tenant;
    if (!ctx) throw err.tenantRequired(req.id);
    if (ctx.subjectKind !== "service") throw err.forbidden("admin only");
    const body = CreateBody.parse(req.body);
    // We use a system-side insert — it bypasses tenant RLS for the
    // bootstrap row, then the company's own tenant scope applies.
    const { withSystemDb } = await import("../../db/client.js");
    const { companies } = await import("../../db/schema.js");
    const inserted = await withSystemDb(async (db) => {
      const rows = await db.insert(companies).values({ name: body.name }).returning();
      return rows[0];
    });
    reply.code(201);
    return inserted;
  });
};
