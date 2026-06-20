import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { events } from "../schema.js";
import type { Db } from "../client.js";
import type { TenantContext } from "../../core/tenant-context.js";

export type EventType = (typeof events.type.enumValues)[number];
export type EventSeverity = (typeof events.severity.enumValues)[number];

export interface NormalizedEvent {
  companyId: string;
  siteId: string;
  deviceId: string;
  type: EventType;
  severity: EventSeverity;
  detectedAt: Date;
  rawPayload: Record<string, unknown>;
  normalizedFields: Record<string, unknown>;
}

/**
 * Insert a batch of events. We trust the caller to have already:
 *   - assigned companyId and siteId from the device
 *   - redacted credentials from rawPayload
 *   - validated the enum types
 *
 * Returns the count actually inserted (some adapters may emit duplicates
 * within the same window; we keep them for now — true dedup is a future
 * migration that adds a unique index on (device_id, type, detected_at)).
 */
export async function insertEvents(db: Db, batch: NormalizedEvent[]): Promise<number> {
  if (batch.length === 0) return 0;
  const rows = await db
    .insert(events)
    .values(
      batch.map((e) => ({
        companyId: e.companyId,
        siteId: e.siteId,
        deviceId: e.deviceId,
        type: e.type,
        severity: e.severity,
        detectedAt: e.detectedAt,
        rawPayload: e.rawPayload,
        normalizedFields: e.normalizedFields,
      })),
    )
    .returning({ id: events.id });
  return rows.length;
}

export interface ListEventsQuery {
  from: Date;
  to: Date;
  deviceId?: string;
  type?: EventType;
  severity?: EventSeverity;
  limit?: number; // default 200, cap 1000
}

export interface ListedEvent {
  id: string;
  deviceId: string;
  siteId: string;
  type: EventType;
  severity: EventSeverity;
  detectedAt: Date;
  ingestedAt: Date;
  normalizedFields: Record<string, unknown>;
}

export async function listEvents(
  db: Db,
  ctx: TenantContext,
  q: ListEventsQuery,
): Promise<ListedEvent[]> {
  const limit = Math.min(Math.max(q.limit ?? 200, 1), 1000);
  const conds = [
    eq(events.companyId, ctx.companyId),
    gte(events.detectedAt, q.from),
    lt(events.detectedAt, q.to),
  ];
  if (q.deviceId) conds.push(eq(events.deviceId, q.deviceId));
  if (q.type) conds.push(eq(events.type, q.type));
  if (q.severity) conds.push(eq(events.severity, q.severity));

  const rows = await db
    .select({
      id: events.id,
      deviceId: events.deviceId,
      siteId: events.siteId,
      type: events.type,
      severity: events.severity,
      detectedAt: events.detectedAt,
      ingestedAt: events.ingestedAt,
      normalizedFields: events.normalizedFields,
    })
    .from(events)
    .where(and(...conds))
    .orderBy(desc(events.detectedAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    normalizedFields: (r.normalizedFields ?? {}) as Record<string, unknown>,
  }));
}

/** Aggregations for the dashboard. Cheap by design. */
export interface EventCounts {
  total: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
}

export async function eventCounts(
  db: Db,
  ctx: TenantContext,
  from: Date,
  to: Date,
): Promise<EventCounts> {
  const rows = await db
    .select({
      type: events.type,
      severity: events.severity,
      n: sql<number>`count(*)::int`,
    })
    .from(events)
    .where(
      and(
        eq(events.companyId, ctx.companyId),
        gte(events.detectedAt, from),
        lt(events.detectedAt, to),
      ),
    )
    .groupBy(events.type, events.severity);

  const byType: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    byType[r.type] = (byType[r.type] ?? 0) + r.n;
    bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + r.n;
    total += r.n;
  }
  return { total, byType, bySeverity };
}
