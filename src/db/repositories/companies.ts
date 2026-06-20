import { eq } from "drizzle-orm";
import { companies } from "../schema.js";
import type { Db } from "../client.js";
import type { TenantContext } from "../../core/tenant-context.js";

export interface Company {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function getCompany(db: Db, _ctx: TenantContext, id: string): Promise<Company | null> {
  const rows = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
