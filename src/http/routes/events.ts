import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { withTenantDb } from "../../db/client.js";
import {
  eventCounts,
  listEvents,
  type EventType,
  type EventSeverity,
} from "../../db/repositories/events.js";
import { err } from "../../core/errors.js";

const ListQuery = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  deviceId: z.string().uuid().optional(),
  type: z.enum([
    "device_offline","device_online","auth_failed",
    "recording_lost","recording_resumed",
    "storage_full","storage_warning",
    "channel_lost","channel_restored",
    "firmware_mismatch","config_changed",
    "motion_detected","tamper_detected",
    "video_loss","network_unstable","internal_error",
  ]).optional(),
  severity: z.enum(["info","warning","error","critical"]).optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
});

const CountsQuery = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

export const eventsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/events", async (req) => {
    const ctx = req.tenant;
    if (!ctx) throw err.tenantRequired(req.id);
    const q = ListQuery.parse(req.query);
    return withTenantDb(ctx, (db) =>
      listEvents(db, ctx, {
        from: new Date(q.from),
        to: new Date(q.to),
        deviceId: q.deviceId,
        type: q.type as EventType | undefined,
        severity: q.severity as EventSeverity | undefined,
        limit: q.limit,
      }),
    );
  });

  app.get("/v1/events/counts", async (req) => {
    const ctx = req.tenant;
    if (!ctx) throw err.tenantRequired(req.id);
    const q = CountsQuery.parse(req.query);
    return withTenantDb(ctx, (db) =>
      eventCounts(db, ctx, new Date(q.from), new Date(q.to)),
    );
  });
};
