/**
 * Worker: event-indexer
 *
 * Reads new events as they are inserted and republishes them on the
 * per-tenant Redis channel so WebSocket clients can push them out
 * without polling Postgres.
 *
 * Implementation choice: Postgres LISTEN/NOTIFY on an "events_inserted"
 * channel. Each insert from the polling worker emits NOTIFY events,
 * payload = the new event id. Indexer reads id, fetches the row, and
 * publishes on shm:events:<companyId>.
 */

import { Redis } from "ioredis";
import pg from "pg";
import { loadEnv } from "../config/env.js";
import { getLogger } from "../core/logger.js";

const log = getLogger().child({ component: "event-indexer" });

export interface IndexerDeps {
  redis: Redis;
}

export class EventIndexer {
  private readonly client: pg.Client;

  constructor(private readonly deps: IndexerDeps) {
    this.client = new pg.Client({ connectionString: loadEnv().DATABASE_URL });
  }

  async start(): Promise<void> {
    await this.client.connect();
    await this.client.query("LISTEN events_inserted");
    this.client.on("notification", async (msg) => {
      if (msg.channel !== "events_inserted" || !msg.payload) return;
      try {
        const id = msg.payload;
        const { rows } = await this.client.query<{
          id: string;
          company_id: string;
          device_id: string;
          site_id: string;
          type: string;
          severity: string;
          detected_at: Date;
          normalized_fields: Record<string, unknown>;
        }>(
          `SELECT id, company_id, device_id, site_id, type, severity,
                  detected_at, normalized_fields
             FROM events WHERE id = $1`,
          [id],
        );
        const ev = rows[0];
        if (!ev) return;
        const payload = JSON.stringify({
          type: "event",
          event: {
            id: ev.id,
            deviceId: ev.device_id,
            siteId: ev.site_id,
            type: ev.type,
            severity: ev.severity,
            detectedAt: ev.detected_at.toISOString(),
            normalizedFields: ev.normalized_fields ?? {},
          },
        });
        await this.deps.redis.publish(`shm:events:${ev.company_id}`, payload);
      } catch (e) {
        log.error({ err: String(e) }, "failed to republish event");
      }
    });
    log.info("event-indexer started");
  }

  async stop(): Promise<void> {
    await this.client.query("UNLISTEN events_inserted").catch(() => {});
    await this.client.end().catch(() => {});
  }
}
