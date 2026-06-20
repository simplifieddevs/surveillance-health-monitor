import { and, desc, eq, inArray } from "drizzle-orm";
import { licenses } from "../schema.js";
import type { Db } from "../client.js";
import type { TenantContext } from "../../core/tenant-context.js";
import { err } from "../../core/errors.js";
import { LICENSE_TIERS, type LicenseState, type LicenseTierId } from "../../config/license-tiers.js";

export interface License {
  id: string;
  companyId: string;
  tier: LicenseTierId;
  state: LicenseState;
  issuedAt: Date;
  expiresAt: Date;
  seats: number;
}

/**
 * Return the currently-effective license for a company, or null if none.
 * "Effective" = in trial or active state, not yet expired.
 * If expired, the caller must treat it as expired even if state says active —
 * we re-check expiresAt here.
 */
export async function getEffectiveLicense(
  db: Db,
  ctx: TenantContext,
  now: Date = new Date(),
): Promise<License | null> {
  const rows = await db
    .select()
    .from(licenses)
    .where(
      and(
        eq(licenses.companyId, ctx.companyId),
        inArray(licenses.state, ["trial", "active"]),
      ),
    )
    .orderBy(desc(licenses.issuedAt))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { ...rowToLicense(row), state: "expired" };
  }
  return rowToLicense(row);
}

function rowToLicense(row: typeof licenses.$inferSelect): License {
  return {
    id: row.id,
    companyId: row.companyId,
    tier: row.tier,
    state: row.state,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    seats: row.seats,
  };
}

/**
 * Throws LICENSE_REQUIRED or LICENSE_EXPIRED if the company has no usable
 * license at the moment. This is the single enforcement point — every
 * server-side action that requires an active license calls this first.
 */
export async function requireLicense(db: Db, ctx: TenantContext): Promise<License> {
  const lic = await getEffectiveLicense(db, ctx);
  if (!lic) throw err.licenseRequired();
  if (lic.state === "expired") throw err.licenseExpired(ctx.companyId);
  return lic;
}

/** Sanity check the seats-vs-tier constraint. */
export function assertSeatsWithinTier(lic: License): void {
  const cap = LICENSE_TIERS[lic.tier].maxDevices;
  if (cap !== Number.MAX_SAFE_INTEGER && lic.seats > cap) {
    throw err.budgetExceeded("devices", cap);
  }
}
