import { and, eq } from "drizzle-orm";
import { devices, type vendorEnum } from "../schema.js";
import type { Db } from "../client.js";
import type { TenantContext } from "../../core/tenant-context.js";
import { err } from "../../core/errors.js";
import type { EncryptedCredential } from "../../crypto/credential-vault.js";

export type Vendor = (typeof vendorEnum)["enumValues"][number];

export interface Device {
  id: string;
  companyId: string;
  siteId: string;
  name: string;
  vendor: Vendor;
  model: string | null;
  firmwareVersion: string | null;
  address: string;
  vendorConfig: Record<string, unknown>;
  status: "unknown" | "online" | "degraded" | "offline";
  lastSeenAt: Date | null;
  pollCursor: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Internal: full row including credential bytes. Repository layer is the
 * only thing allowed to read/write credential_* columns.
 */
export interface DeviceWithCreds extends Device {
  credentialCipher: Buffer;
  credentialIv: Buffer;
  credentialKeyVersion: number;
}

export async function getDevice(db: Db, ctx: TenantContext, id: string): Promise<Device> {
  const row = await loadDeviceRow(db, ctx, id);
  return toDevice(row);
}

/**
 * Returns the credential bytes too. Callers MUST hold the vault and pass
 * the row to CredentialVault.decrypt immediately. Never persist the
 * plaintext or return it from a route.
 */
export async function getDeviceWithCreds(
  db: Db,
  ctx: TenantContext,
  id: string,
): Promise<DeviceWithCreds> {
  const row = await loadDeviceRow(db, ctx, id);
  return { ...toDevice(row), credentialCipher: row.credentialCipher, credentialIv: row.credentialIv, credentialKeyVersion: row.credentialKeyVersion };
}

async function loadDeviceRow(db: Db, ctx: TenantContext, id: string) {
  const rows = await db
    .select()
    .from(devices)
    .where(and(eq(devices.companyId, ctx.companyId), eq(devices.id, id)))
    .limit(1);
  const row = rows[0];
  if (!row) throw err.notFound("Device", id);
  return row;
}

function toDevice(row: typeof devices.$inferSelect): Device {
  return {
    id: row.id,
    companyId: row.companyId,
    siteId: row.siteId,
    name: row.name,
    vendor: row.vendor,
    model: row.model,
    firmwareVersion: row.firmwareVersion,
    address: row.address,
    vendorConfig: (row.vendorConfig ?? {}) as Record<string, unknown>,
    status: row.status,
    lastSeenAt: row.lastSeenAt,
    pollCursor: row.pollCursor,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function deleteDevice(db: Db, ctx: TenantContext, id: string): Promise<void> {
  const result = await db
    .delete(devices)
    .where(and(eq(devices.companyId, ctx.companyId), eq(devices.id, id)))
    .returning({ id: devices.id });
  if (result.length === 0) throw err.notFound("Device", id);
}

export interface UpdateDeviceInput {
  name?: string;
  address?: string;
  vendorConfig?: Record<string, unknown>;
  credentials?: EncryptedCredential;
  enabled?: boolean;
}

export async function updateDevice(
  db: Db,
  ctx: TenantContext,
  id: string,
  input: UpdateDeviceInput,
): Promise<Device> {
  const rows = await db
    .update(devices)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.vendorConfig !== undefined ? { vendorConfig: input.vendorConfig } : {}),
      ...(input.credentials !== undefined
        ? {
            credentialCipher: input.credentials.ciphertext,
            credentialIv: input.credentials.iv,
            credentialKeyVersion: input.credentials.keyVersion,
          }
        : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(devices.companyId, ctx.companyId), eq(devices.id, id)))
    .returning();
  const row = rows[0];
  if (!row) throw err.notFound("Device", id);
  return toDevice(row);
}

export interface CreateDeviceInput {
  siteId: string;
  name: string;
  vendor: Vendor;
  address: string;
  model?: string;
  firmwareVersion?: string;
  vendorConfig?: Record<string, unknown>;
  credentials: EncryptedCredential;
}

export async function createDevice(
  db: Db,
  ctx: TenantContext,
  input: CreateDeviceInput,
): Promise<Device> {
  // Ensure the site belongs to this tenant. RLS catches it but we want
  // a clean 404 instead of a 0-row insert.
  // (handled by foreign key + RLS; insert would fail with FK violation).
  const rows = await db
    .insert(devices)
    .values({
      companyId: ctx.companyId,
      siteId: input.siteId,
      name: input.name,
      vendor: input.vendor,
      address: input.address,
      model: input.model ?? null,
      firmwareVersion: input.firmwareVersion ?? null,
      vendorConfig: input.vendorConfig ?? {},
      credentialCipher: input.credentials.ciphertext,
      credentialIv: input.credentials.iv,
      credentialKeyVersion: input.credentials.keyVersion,
    })
    .returning();
  const row = rows[0];
  if (!row) throw err.internal(new Error("device insert returned no rows"));
  return toDevice(row);
}

export async function listEnabledDevices(
  db: Db,
  ctx: TenantContext,
  limit = 1000,
): Promise<Device[]> {
  const rows = await db
    .select()
    .from(devices)
    .where(and(eq(devices.companyId, ctx.companyId), eq(devices.enabled, true)))
    .limit(limit);
  return rows.map(toDevice);
}

export async function updateStatus(
  db: Db,
  ctx: TenantContext,
  deviceId: string,
  patch: { status?: Device["status"]; lastSeenAt?: Date | null; pollCursor?: string | null },
): Promise<void> {
  await db
    .update(devices)
    .set({
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.lastSeenAt !== undefined ? { lastSeenAt: patch.lastSeenAt } : {}),
      ...(patch.pollCursor !== undefined ? { pollCursor: patch.pollCursor } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(devices.companyId, ctx.companyId), eq(devices.id, deviceId)));
}

/** Count devices in this tenant — used to enforce tier.maxDevices on insert. */
export async function countDevices(db: Db, ctx: TenantContext): Promise<number> {
  const rows = await db
    .select({ id: devices.id })
    .from(devices)
    .where(eq(devices.companyId, ctx.companyId));
  return rows.length;
}
