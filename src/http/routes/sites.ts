import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { withTenantDb } from "../../db/client.js";
import * as sitesRepo from "../../db/repositories/sites.js";
import { err } from "../../core/errors.js";

const CreateSiteBody = z.object({
  name: z.string().min(1).max(200),
  timezone: z.string().min(1).max(64).optional(),
});

const IdParams = z.object({ id: z.string().uuid() });

export const sitesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/sites", async (req) => {
    const ctx = req.tenant;
    if (!ctx) throw err.tenantRequired(req.id);
    return withTenantDb(ctx, (db) => sitesRepo.listSites(db, ctx));
  });

  app.post("/v1/sites", async (req, reply) => {
    const ctx = req.tenant;
    if (!ctx) throw err.tenantRequired(req.id);
    const body = CreateSiteBody.parse(req.body);
    const site = await withTenantDb(ctx, (db) => sitesRepo.createSite(db, ctx, body));
    reply.code(201);
    return site;
  });

  app.get("/v1/sites/:id", async (req) => {
    const ctx = req.tenant;
    if (!ctx) throw err.tenantRequired(req.id);
    const { id } = IdParams.parse(req.params);
    return withTenantDb(ctx, (db) => sitesRepo.getSite(db, ctx, id));
  });
};
