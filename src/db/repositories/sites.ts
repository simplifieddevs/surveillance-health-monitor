import { and, eq } from "drizzle-orm";
import { sites } from "../schema.js";
import type { Db } from "../client.js";
import type { TenantContext } from "../../core/tenant-context.js";
import { err } from "../../core/errors.js";

export interface Site {
  id: string;
  companyId: string;
  name: string;
  timezone: string;
}

export async function listSites(db: Db, ctx: TenantContext): Promise<Site[]> {
  // RLS already filters by company_id; we still pass ctx.companyId
  // explicitly so a future read replica without RLS is safe.
  const rows = await db
    .select()
    .from(sites)
    .where(eq(sites.companyId, ctx.companyId));
  return rows.map((r) => ({
    id: r.id,
    companyId: r.companyId,
    name: r.name,
    timezone: r.timezone,
  }));
}

export async function getSite(db: Db, ctx: TenantContext, id: string): Promise<Site> {
  const rows = await db
    .select()
    .from(sites)
    .where(and(eq(sites.companyId, ctx.companyId), eq(sites.id, id)))
    .limit(1);
  const row = rows[0];
  if (!row) throw err.notFound("Site", id);
  return { id: row.id, companyId: row.companyId, name: row.name, timezone: row.timezone };
}

export interface UpdateSiteInput {
  name?: string;
  timezone?: string;
}

export async function updateSite(
  db: Db,
  ctx: TenantContext,
  id: string,
  input: UpdateSiteInput,
): Promise<Site> {
  const rows = await db
    .update(sites)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
    })
    .where(and(eq(sites.companyId, ctx.companyId), eq(sites.id, id)))
    .returning();
  const row = rows[0];
  if (!row) throw err.notFound("Site", id);
  return { id: row.id, companyId: row.companyId, name: row.name, timezone: row.timezone };
}

export interface CreateSiteInput {
  name: string;
  timezone?: string;
}

export async function createSite(
  db: Db,
  ctx: TenantContext,
  input: CreateSiteInput,
): Promise<Site> {
  const rows = await db
    .insert(sites)
    .values({
      companyId: ctx.companyId,
      name: input.name,
      timezone: input.timezone ?? "UTC",
    })
    .returning();
  const row = rows[0];
  if (!row) throw err.internal(new Error("insert returned no rows"));
  return { id: row.id, companyId: row.companyId, name: row.name, timezone: row.timezone };
}
