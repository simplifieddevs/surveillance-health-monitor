/**
 * Worker: license-expiry
 *
 * Every hour, transition licenses whose expires_at is in the past to
 * state='expired'. This is what makes "license enforcement" real — until
 * this runs, a license that crossed its expires_at while in 'active'
 * state would still be honored.
 */

import { and, inArray, lt } from "drizzle-orm";
import { systemPool, withSystemDb } from "../db/client.js";
import { licenses } from "../db/schema.js";
import { loadEnv } from "../config/env.js";
import { getLogger } from "../core/logger.js";
import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { Redis } from "ioredis";

const log = getLogger().child({ component: "license-expiry" });

const QUEUE = "shm:license-expiry";

export async function scheduleLicenseExpiry(redis: Redis): Promise<void> {
  const q = new Queue(QUEUE, { connection: redis as unknown as ConnectionOptions });
  await q.add(
    "scan",
    {},
    { repeat: { pattern: "17 * * * *" }, removeOnComplete: 50, removeOnFail: 50 },
  );
  await q.close();
}

export function startLicenseExpiryWorker(redis: Redis): Worker {
  return new Worker(QUEUE, async () => scan(), {
    connection: redis as unknown as ConnectionOptions,
    concurrency: 1,
  });
}

export async function scan(): Promise<{ updated: number }> {
  void systemPool;
  void loadEnv;
  const now = new Date();
  const updated = await withSystemDb(async (db) => {
    const result = await db
      .update(licenses)
      .set({ state: "expired" })
      .where(and(inArray(licenses.state, ["trial", "active"]), lt(licenses.expiresAt, now)))
      .returning({ id: licenses.id });
    return result.length;
  });
  if (updated > 0) log.info({ updated }, "licenses transitioned to expired");
  return { updated };
}
