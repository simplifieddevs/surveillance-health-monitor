/**
 * Process entrypoint.
 *
 * Two run modes:
 *   - "api"     — starts the HTTP server.
 *   - "worker"  — starts the polling worker + license expiry cron.
 *
 * Both share the same dependency wiring (vault, redis, db).
 */

import { Redis } from "ioredis";
import { loadEnv } from "./config/env.js";
import { getLogger } from "./core/logger.js";
import { runMigrations } from "./db/migrate.js";
import { EnvKeyProvider } from "./crypto/env-key-provider.js";
import { CredentialVault } from "./crypto/credential-vault.js";
import { PollBudget } from "./polling/budget.js";
import { buildServer, startServer } from "./http/server.js";
import {
  PollingScheduler,
  PollWorker,
} from "./polling/scheduler.js";
import { EventIndexer } from "./workers/event-indexer.js";
import { scheduleLicenseExpiry, startLicenseExpiryWorker } from "./workers/license-expiry.js";

const log = getLogger().child({ component: "main" });

async function main(): Promise<void> {
  loadEnv(); // validate env first; throws on misconfig

  const redis = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
  const keys = new EnvKeyProvider();
  const vault = new CredentialVault(keys);
  const budget = new PollBudget(redis);

  const deps = { redis, vault, budget };

  // Always run migrations on boot. Cheap with the _migrations guard.
  await runMigrations();

  const mode = (process.env.SHIM_MODE ?? "api").toLowerCase();

  if (mode === "api") {
    const app = await buildServer(deps);
    await startServer(app);
    log.info({ mode }, "ready");
  } else if (mode === "worker") {
    const scheduler = new PollingScheduler(deps);
    const worker = new PollWorker(deps);
    const indexer = new EventIndexer(deps);
    await indexer.start();
    await scheduleLicenseExpiry(redis);
    startLicenseExpiryWorker(redis);
    log.info({ mode }, "worker ready");
    // Keep alive until SIGINT/SIGTERM.
    const stop = async () => {
      await worker.close();
      await scheduler.close();
      await indexer.stop();
      await redis.quit();
      process.exit(0);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } else {
    throw new Error(`unknown SHIM_MODE: ${mode}`);
  }
}

main().catch((e) => {
  log.fatal({ err: String(e), stack: (e as Error)?.stack }, "boot failed");
  process.exit(1);
});
