import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { withTenantDb } from "../../db/client.js";
import { eventCounts } from "../../db/repositories/events.js";
import { listEnabledDevices, countDevices } from "../../db/repositories/devices.js";
import { getEffectiveLicense } from "../../db/repositories/licenses.js";
import { LICENSE_TIERS } from "../../config/license-tiers.js";
import { err } from "../../core/errors.js";

/**
 * Big-screen view = the dashboard.
 *
 * One endpoint, one shape. Different rendering (operator console,
 * wall-mounted display, etc.) is a client concern. The server returns
 * the same payload regardless of caller.
 */

const WindowQuery = z.object({
  windowHours: z.coerce.number().int().positive().max(168).default(24),
});

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/dashboard", async (req) => {
    const ctx = req.tenant;
    if (!ctx) throw err.tenantRequired(req.id);
    const { windowHours } = WindowQuery.parse(req.query);
    const to = new Date();
    const from = new Date(to.getTime() - windowHours * 3_600_000);

    return withTenantDb(ctx, async (db) => {
      const [counts, devices, total, license] = await Promise.all([
        eventCounts(db, ctx, from, to),
        listEnabledDevices(db, ctx, 5000),
        countDevices(db, ctx),
        getEffectiveLicense(db, ctx),
      ]);

      const byStatus = { online: 0, degraded: 0, offline: 0, unknown: 0 };
      for (const d of devices) byStatus[d.status]++;

      return {
        generatedAt: to.toISOString(),
        windowHours,
        devices: {
          total,
          byStatus,
          tier: license ? LICENSE_TIERS[license.tier] : null,
        },
        events: counts,
      };
    });
  });
};
