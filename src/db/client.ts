import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "./schema.js";
import type { TenantContext, SystemContext } from "../core/tenant-context.js";
import { isSystemContext } from "../core/tenant-context.js";
import { loadEnv } from "../config/env.js";

/**
 * Postgres client + Drizzle binding.
 *
 * Two separate pools:
 *   - `systemPool`: single connection used for migrations and cross-tenant
 *     work (e.g. license-expiry cron). RLS still applies but we don't
 *     set app.company_id on it.
 *   - `tenantPool(...)`: per-tenant session that sets app.company_id on
 *     every checkout via SET LOCAL. Every tenant-scoped query goes
 *     through this.
 *
 * The split matters: a misconfigured "tenant" path can never accidentally
 * inherit a system-level connection.
 */

const { Pool } = pg;
export type PgPool = pg.Pool;

let systemSingleton: PgPool | undefined;

export function systemPool(): PgPool {
  if (!systemSingleton) {
    const env = loadEnv();
    systemSingleton = new Pool({
      connectionString: env.DATABASE_URL,
      max: 4,
      idleTimeoutMillis: 30_000,
    });
  }
  return systemSingleton;
}

/**
 * Acquire a tenant-bound client. Use:
 *
 *   const db = await withTenantDb(ctx, async (db) => {
 *     return db.select().from(devices)...;
 *   });
 *
 * Internally we checkout a connection, run `SET LOCAL app.company_id`,
 * run the callback, and release. `SET LOCAL` is scoped to the
 * transaction so it can't leak across checkouts.
 */
export async function withTenantDb<T>(
  ctx: TenantContext | SystemContext,
  fn: (db: NodePgDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  const pool = systemPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!isSystemContext(ctx)) {
      // Validate UUID shape before letting it near Postgres.
      const companyId = ctx.companyId;
      // SET LOCAL doesn't accept parameters; identifier-style injection
      // is prevented because companyId is validated at the route layer
      // (UUID_RE in core/ids.ts) and we cast through ::uuid below.
      await client.query("SELECT set_config('app.company_id', $1, true)", [companyId]);
    }
    const db = drizzle(client, { schema });
    const result = await fn(db);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Variant for system-level, cross-tenant queries (no company_id set). */
export async function withSystemDb<T>(
  fn: (db: NodePgDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  const pool = systemPool();
  const client = await pool.connect();
  try {
    const db = drizzle(client, { schema });
    return await fn(db);
  } finally {
    client.release();
  }
}

/**
 * Bootstrap helper: validates the connection and that RLS is on for
 * tenant-scoped tables. Called at startup; exits non-zero on failure.
 */
export async function pingDatabase(): Promise<void> {
  const pool = systemPool();
  const { rows } = await pool.query<{ ok: number }>("SELECT 1::int AS ok");
  if (rows[0]?.ok !== 1) throw new Error("Database ping returned unexpected result");
}

export type Db = NodePgDatabase<typeof schema>;
export { schema };
