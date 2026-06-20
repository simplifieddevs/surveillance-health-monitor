import type { AdapterEvent } from "../adapters/types.js";
import type { NormalizedEvent } from "../db/repositories/events.js";
import { getLogger } from "../core/logger.js";

const log = getLogger().child({ component: "normalize" });

/**
 * Convert vendor AdapterEvents to persisted NormalizedEvents.
 *
 * Responsibilities:
 *   - Stamp companyId + siteId from the device row.
 *   - Mark events whose vendor clock is >5 minutes off from our clock
 *     with clock_skew_s in normalizedFields.
 *   - Strip any key that looks like a credential from rawPayload.
 *   - Coalesce: drop events with detectedAt in the future by more than 5m.
 *
 * Trust model: AdapterEvent.type and severity come from adapters. We
 * accept them as-is here; the adapter contract is the trust boundary.
 */

const SKEW_THRESHOLD_MS = 5 * 60 * 1000;
const CREDENTIAL_KEY_HINTS = [
  "password",
  "passwd",
  "pass",
  "secret",
  "token",
  "authorization",
  "auth",
  "api_key",
  "apikey",
];

export interface DeviceForNormalization {
  readonly id: string;
  readonly companyId: string;
  readonly siteId: string;
}

export function normalize(
  device: DeviceForNormalization,
  vendorEvents: readonly AdapterEvent[],
  now: Date = new Date(),
): NormalizedEvent[] {
  const out: NormalizedEvent[] = [];
  for (const e of vendorEvents) {
    if (e.detectedAt.getTime() - now.getTime() > SKEW_THRESHOLD_MS) {
      log.warn({ deviceId: device.id, detectedAt: e.detectedAt }, "dropping far-future event");
      continue;
    }
    const skew = Math.abs(now.getTime() - e.detectedAt.getTime());
    const normalizedFields: Record<string, unknown> = { ...e.normalizedFields };
    if (skew > SKEW_THRESHOLD_MS) {
      normalizedFields.clock_skew_s = Math.round(skew / 1000);
    }

    out.push({
      companyId: device.companyId,
      siteId: device.siteId,
      deviceId: device.id,
      type: e.type,
      severity: e.severity,
      detectedAt: e.detectedAt,
      rawPayload: scrubCredentials(e.rawPayload),
      normalizedFields,
    });
  }
  return out;
}

function scrubCredentials(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (CREDENTIAL_KEY_HINTS.some((h) => k.toLowerCase().includes(h))) {
      out[k] = "[redacted]";
      continue;
    }
    out[k] = scrubValue(v);
  }
  return out;
}

function scrubValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrubValue);
  if (v && typeof v === "object") return scrubCredentials(v as Record<string, unknown>);
  return v;
}
