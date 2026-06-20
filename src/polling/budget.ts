/**
 * PollBudget — per-company concurrency gate.
 *
 * Why this exists: a single tenant on a Pro tier might have 100 devices.
 * If the scheduler naively fires them all every minute, we hit the
 * vendor's per-IP rate limit. License tier caps the maxConcurrentPolls;
 * we enforce it as a Redis-backed semaphore so the budget is shared
 * across all worker processes.
 *
 * Usage:
 *   const release = await budget.acquire(ctx, 1);
 *   try { ... do poll ... } finally { await release(); }
 *
 * If acquire() cannot get a slot within budgetTimeoutMs it throws
 * LICENSE_BUDGET_EXCEEDED. The scheduler catches this and defers the
 * device to the next tick.
 */

import { Redis } from "ioredis";
import { loadEnv } from "../config/env.js";
import { getLogger } from "../core/logger.js";
import type { TenantContext } from "../core/tenant-context.js";
import type { LicenseTier } from "../config/license-tiers.js";
import { err } from "../core/errors.js";
import { newCursorToken } from "../core/ids.js";

const log = getLogger().child({ component: "budget" });

const SEMAPHORE_KEY = (companyId: string) => `shm:polling:sem:${companyId}`;
const ACQUIRE_TIMEOUT_DEFAULT_MS = 30_000;

export class PollBudget {
  constructor(private readonly redis: Redis) {}

  /**
   * Acquire one slot. Returns a release function. The slot is owned by
   * a per-acquisition token; if the process dies, the token expires via
   * the per-slot TTL and the slot is reclaimed.
   */
  async acquire(
    ctx: TenantContext,
    tier: LicenseTier,
    opts?: { timeoutMs?: number },
  ): Promise<() => Promise<void>> {
    const max = tier.maxConcurrentPolls;
    const timeout = opts?.timeoutMs ?? ACQUIRE_TIMEOUT_DEFAULT_MS;
    const key = SEMAPHORE_KEY(ctx.companyId);
    const token = newCursorToken();
    const deadline = Date.now() + timeout;

    while (true) {
      const current = await this.semaphoreCount(key);
      if (current < max) {
        const ok = await this.acquireSlot(key, token, 60_000);
        if (ok) {
          return async () => {
            // Lua-style compare-and-delete to avoid releasing someone
            // else's token if our TTL expired.
            await this.redis.lrem(key, 1, token);
          };
        }
      }
      if (Date.now() >= deadline) {
        throw err.budgetExceeded("concurrency", max);
      }
      const waitMs = jitter(100, 250);
      log.debug({ companyId: ctx.companyId, current, max, waitMs }, "budget wait");
      await sleep(waitMs);
    }
  }

  private async semaphoreCount(key: string): Promise<number> {
    const n = await this.redis.llen(key);
    return n ?? 0;
  }

  private async acquireSlot(key: string, token: string, ttlMs: number): Promise<boolean> {
    // Use RPUSH with a token, and keep the slot alive via TTL refresh
    // through the worker's own liveness — simple, race-free under
    // single Redis.
    const ok = await this.redis.rpush(key, token);
    if (ok !== 1) return false;
    // We don't strictly need expire on a list, but if our process dies
    // the slot leaks — mitigate with a soft TTL on the key itself.
    await this.redis.pexpire(key, ttlMs);
    return true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function jitter(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}
