import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { withTenantDb } from "../../db/client.js";
import {
  createDevice,
  getDevice,
  listEnabledDevices,
  countDevices,
  type Vendor,
} from "../../db/repositories/devices.js";
import { requireLicense } from "../../db/repositories/licenses.js";
import { CredentialVault } from "../../crypto/credential-vault.js";
import { LICENSE_TIERS } from "../../config/license-tiers.js";
import { err } from "../../core/errors.js";

const VendorEnum = z.enum(["onvif", "hikvision", "dahua", "uniview", "hanwha", "axis"]);

const CreateDeviceBody = z.object({
  siteId: z.string().uuid(),
  name: z.string().min(1).max(200),
  vendor: VendorEnum,
  address: z.string().min(1).max(512),
  model: z.string().max(128).optional(),
  firmwareVersion: z.string().max(64).optional(),
  vendorConfig: z.record(z.unknown()).optional(),
  credentials: z.object({
    username: z.string().max(200).optional(),
    password: z.string().max(512).optional(),
    token: z.string().max(2000).optional(),
    raw: z.string().max(4096).optional(),
  }).refine(
    (v) => v.username !== undefined || v.password !== undefined || v.token !== undefined || v.raw !== undefined,
    { message: "credentials must include at least one field" },
  ),
});

const IdParams = z.object({ id: z.string().uuid() });

export interface DeviceRoutesDeps {
  vault: CredentialVault;
}

export const deviceRoutes: FastifyPluginAsync<{ deps: DeviceRoutesDeps }> = async (app, opts) => {
  const { vault } = opts.deps;

  app.get("/v1/devices", async (req) => {
    const ctx = req.tenant;
    if (!ctx) throw err.tenantRequired(req.id);
    return withTenantDb(ctx, (db) => listEnabledDevices(db, ctx));
  });

  app.post("/v1/devices", async (req, reply) => {
    const ctx = req.tenant;
    if (!ctx) throw err.tenantRequired(req.id);
    const body = CreateDeviceBody.parse(req.body);

    return withTenantDb(ctx, async (db) => {
      const lic = await requireLicense(db, ctx);
      const tier = LICENSE_TIERS[lic.tier];

      // Enforce tier.maxDevices.
      if (tier.maxDevices !== Number.MAX_SAFE_INTEGER) {
        const current = await countDevices(db, ctx);
        if (current >= tier.maxDevices) {
          throw err.budgetExceeded("devices", tier.maxDevices);
        }
      }

      const blob = vault.encrypt(body.credentials);
      const created = await createDevice(db, ctx, {
        siteId: body.siteId,
        name: body.name,
        vendor: body.vendor as Vendor,
        address: body.address,
        model: body.model,
        firmwareVersion: body.firmwareVersion,
        vendorConfig: body.vendorConfig,
        credentials: blob,
      });
      reply.code(201);
      return created;
    });
  });

  app.get("/v1/devices/:id", async (req) => {
    const ctx = req.tenant;
    if (!ctx) throw err.tenantRequired(req.id);
    const { id } = IdParams.parse(req.params);
    return withTenantDb(ctx, (db) => getDevice(db, ctx, id));
  });
};
