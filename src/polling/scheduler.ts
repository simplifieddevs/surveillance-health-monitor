import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";
import { loadEnv } from "../config/env.js";
import { getLogger } from "../core/logger.js";
import { adapterFor } from "../adapters/registry.js";
import { withTenantDb } from "../db/client.js";
import {
  listEnabledDevices,
  type Device,
} from "../db/repositories/devices.js";
import { withResolvedCredential } from "../db/repositories/credentials.js";
import { insertEvents, type NormalizedEvent } from "../db/repositories/events.js";
import { CredentialVault } from "../crypto/credential-vault.js";
import { normalize } from "./normalize.js";
import { PollBudget } from "./budget.js";
import { err } from "../core/errors.js";
import {
  systemContext,
  type TenantContext,
} from "../core/tenant-context.js";

const log = getLogger().child({ component: "polling" });

/**
 * Scheduler — one BullMQ repeatable per company tier per minute, fan-out
 * to a per-device "poll" job. The job body is intentionally small; the
 * worker re-reads the device row at execution time so config changes
 * propagate without queue rebuilds.
 */

const COMPANY_TICK_QUEUE = "shm-company-tick";
const POLL_QUEUE = "shm-device-poll";

export interface SchedulerDeps {
  redis: Redis;
  vault: CredentialVault;
  budget: PollBudget;
}

export class PollingScheduler {
  private readonly tickQueue: Queue;
  private readonly pollQueue: Queue;
  private readonly tickWorker: Worker;

  constructor(private readonly deps: SchedulerDeps) {
    // BullMQ bundles its own copy of ioredis; the structural type still
    // matches at runtime. Cast through unknown to bridge the version split.
    const conn = deps.redis as unknown as ConnectionOptions;
    this.tickQueue = new Queue(COMPANY_TICK_QUEUE, { connection: conn });
    this.pollQueue = new Queue(POLL_QUEUE, { connection: conn });
    this.tickWorker = new Worker(
      COMPANY_TICK_QUEUE,
      (job: Job<{ companyId: string }>) => this.runCompanyTick(job.data.companyId),
      { connection: conn, concurrency: 5 },
    );
    this.tickWorker.on("failed", (job, err) =>
      log.error({ jobId: job?.id, companyId: job?.data?.companyId, err: String(err) }, "tick job failed"),
    );
    this.tickWorker.on("error", (err) =>
      log.error({ err: String(err) }, "tick worker error"),
    );
  }

  /** Schedule a per-company tick that fires every minute. */
  async scheduleCompanyTick(companyId: string): Promise<void> {
    await this.tickQueue.add(
      `tick:${companyId}`,
      { companyId },
      {
        repeat: { pattern: "* * * * *" }, // every minute
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );
  }

  /** Worker entry: enqueue one poll job per enabled device in the company. */
  async runCompanyTick(companyId: string): Promise<number> {
    // The tick is system-initiated; we use SystemContext for the listing
    // path (which uses set_config('app.company_id', ...) under the hood),
    // then transition to TenantContext for the actual poll job.
    const tenant: TenantContext = {
      companyId,
      subjectId: "system",
      subjectKind: "service",
      requestId: `tick:${companyId}`,
    };
    void systemContext; // imported to make the type relationship explicit
    const enqueued = await withTenantDb(tenant, async (db) => {
      const devices = await listEnabledDevices(db, tenant, 1000);
      if (devices.length === 1000) {
        log.warn({ companyId }, "device list hit 1000-device cap — some devices may not be polled; add pagination");
      }
      for (const d of devices) {
        await this.pollQueue.add(
          `poll:${d.id}`,
          { deviceId: d.id, companyId },
          {
            // Stable jobId per device: if a poll job for this device is
            // already waiting or active, BullMQ skips the add. Prevents
            // unbounded queue growth when polls take longer than one tick.
            jobId: `poll:${d.id}`,
            removeOnComplete: 100,
            removeOnFail: 100,
            attempts: 3,
            backoff: { type: "exponential", delay: 5_000 },
          },
        );
      }
      return devices.length;
    });
    log.info({ companyId, enqueued }, "tick fan-out done");
    return enqueued;
  }

  getPollQueue(): Queue { return this.pollQueue; }
  getTickQueue(): Queue { return this.tickQueue; }

  async close(): Promise<void> {
    await this.tickWorker.close();
    await this.tickQueue.close();
    await this.pollQueue.close();
  }
}

/**
 * PollWorker — one worker process can run many of these; BullMQ handles
 * concurrency via the connection pool.
 */
export class PollWorker {
  private readonly worker: Worker;
  private readonly deps: SchedulerDeps;

  constructor(deps: SchedulerDeps) {
    this.deps = deps;
    this.worker = new Worker(
      POLL_QUEUE,
      (job) => this.handle(job),
      {
        connection: deps.redis as unknown as ConnectionOptions,
        concurrency: loadEnv().POLL_CONCURRENCY,
      },
    );
  }

  private async handle(job: Job<{ deviceId: string; companyId: string }>): Promise<void> {
    const { deviceId, companyId } = job.data;
    const tenant = {
      companyId,
      subjectId: "system",
      subjectKind: "service" as const,
      requestId: `poll:${job.id}`,
    };

    // Captured outside the try so the catch block can generate an offline event.
    let deviceSnapshot: { companyId: string; siteId: string; status: string } | undefined;

    try {
      await withTenantDb(tenant, async (db) => {
        // 1. Load device under tenant scope (RLS guarantees isolation).
        const device = await loadDevice(db, tenant, deviceId);
        deviceSnapshot = { companyId: device.companyId, siteId: device.siteId, status: device.status };

        // NOTE: license enforcement is currently disabled per product
        // decision. requireLicense() and the concurrency budget are
        // skipped here. The licenses table, tier config, error codes,
        // and repo functions are preserved so re-enabling is a code
        // change at this site, not a migration.

        // 2. Pull through the adapter. Credentials are decrypted only
        //    inside this closure; they never leave this function.
        await withResolvedCredential(db, tenant, deviceId, this.deps.vault, async (cred) => {
          const adapter = adapterFor(device.vendor);
          const pull = await adapter.pull(
            { address: device.address, vendorConfig: device.vendorConfig },
            cred,
            device.pollCursor,
          );

          // 3. Normalize + persist.
          const normalized = normalize(device, pull.events);
          if (normalized.length > 0) {
            await insertEvents(db, normalized);
          }

          // 4. Update device status + cursor.
          const newStatus = pull.status ?? "online";
          const { updateStatus } = await import("../db/repositories/devices.js");
          await updateStatus(db, tenant, deviceId, {
            status: newStatus,
            lastSeenAt: new Date(),
            pollCursor: pull.nextCursor ?? device.pollCursor,
          });

          // 5. Generate status-change events so online/offline transitions
          //    appear in the event feed.
          if (device.status !== newStatus && (newStatus === "offline" || device.status === "offline")) {
            const type = newStatus === "offline" ? "device_offline" : "device_online";
            await insertEvents(db, [statusChangeEvent(device, type)]);
          }
        });
      });
    } catch (e) {
      // Map ADAPTER_UNAVAILABLE -> device offline. Other errors propagate.
      const appErr = e && typeof e === "object" && "code" in e ? (e as { code?: string }) : null;
      if (appErr?.code === "ADAPTER_UNAVAILABLE" || appErr?.code === "ADAPTER_TIMEOUT") {
        log.warn({ deviceId, code: appErr.code }, "marking device offline");
        await withTenantDb(tenant, async (db) => {
          const { updateStatus } = await import("../db/repositories/devices.js");
          await updateStatus(db, tenant, deviceId, { status: "offline" });
          // Generate offline event only on transition (deviceSnapshot captured before the try).
          if (deviceSnapshot && deviceSnapshot.status !== "offline") {
            await insertEvents(db, [{
              companyId: deviceSnapshot.companyId,
              siteId: deviceSnapshot.siteId,
              deviceId,
              type: "device_offline",
              severity: "critical",
              detectedAt: new Date(),
              rawPayload: {},
              normalizedFields: { cause: appErr.code },
            }]);
          }
        });
        throw err.adapterUnavailable(`device=${deviceId}`);
      }
      throw e;
    }
  }

  async close(): Promise<void> {
    await this.worker.close();
  }
}

async function loadDevice(
  db: import("../db/client.js").Db,
  ctx: import("../core/tenant-context.js").TenantContext,
  id: string,
): Promise<Device> {
  const { getDevice } = await import("../db/repositories/devices.js");
  return getDevice(db, ctx, id);
}

function statusChangeEvent(
  device: Device,
  type: "device_offline" | "device_online",
): NormalizedEvent {
  return {
    companyId: device.companyId,
    siteId: device.siteId,
    deviceId: device.id,
    type,
    severity: type === "device_offline" ? "critical" : "info",
    detectedAt: new Date(),
    rawPayload: {},
    normalizedFields: { trigger: "status_change" },
  };
}
