import { randomUUID } from "node:crypto";
import { BaseHTTPAdapter } from "./base-http-adapter.js";
import { getLogger } from "../core/logger.js";
import type {
  VendorAdapter,
  AdapterCredential,
  AdapterTarget,
  PullResult,
  AdapterEvent,
} from "./types.js";

const log = getLogger().child({ component: "uniview-tvt" });

/**
 * Uniview / TVT LAPI adapter.
 *
 * Uniview NVRs and TVT NVRs share the same LAPI HTTP/JSON interface.
 * Auth: HTTP Basic over HTTP (port 80 by default, configurable via vendorConfig.httpPort).
 *
 * Key endpoints:
 *   GET /LAPI/V1.0/System/DeviceBasicInfo   → firmware, model
 *   GET /LAPI/V1.0/Storage/DiskInfo          → disk health
 *   GET /LAPI/V1.0/ChannelMgmt/ChannelList   → channel count / names
 *   GET /LAPI/V1.0/Event/AlarmEvent          → event log (cursor-based)
 *
 * Cursor: ISO-8601 timestamp of the last event we consumed.
 * On first poll we look back 1 hour. The NVR's event log is circular so
 * very old events may already be purged — that's fine.
 */

export class UniviewTvtAdapter extends BaseHTTPAdapter implements VendorAdapter {
  readonly vendor = "uniview" as const;

  async testConnectivity(target: AdapterTarget, credential: AdapterCredential) {
    const url = baseUrl(target) + "/LAPI/V1.0/System/DeviceBasicInfo";
    return this.probe(url, auth(credential));
  }

  async pull(
    target: AdapterTarget,
    credential: AdapterCredential,
    cursor: string | null,
  ): Promise<PullResult> {
    const base = baseUrl(target);
    const a = auth(credential);
    const events: AdapterEvent[] = [];

    // ── 1. Device info (firmware version) ───────────────────────────────
    let firmwareVersion: string | undefined;
    try {
      const r = await this.request("GET", base + "/LAPI/V1.0/System/DeviceBasicInfo", a);
      firmwareVersion = extractFirmware(r.body);
      log.debug({ address: target.address, firmwareVersion, status: r.status }, "device info");
    } catch (e) { log.warn({ address: target.address, err: String(e) }, "device info failed"); }

    // ── 2. Disk health ───────────────────────────────────────────────────
    try {
      const r = await this.request("GET", base + "/LAPI/V1.0/Storage/DiskInfo", a);
      const diskEvents = parseDiskInfo(r.body);
      log.debug({ address: target.address, status: r.status, events: diskEvents.length }, "disk info");
      events.push(...diskEvents);
    } catch (e) { log.warn({ address: target.address, err: String(e) }, "disk info failed"); }

    // ── 3. Channel status ────────────────────────────────────────────────
    try {
      const r = await this.request("GET", base + "/LAPI/V1.0/ChannelMgmt/ChannelList", a);
      const channelEvents = parseChannelList(r.body);
      log.debug({ address: target.address, status: r.status, events: channelEvents.length }, "channel list");
      events.push(...channelEvents);
    } catch (e) { log.warn({ address: target.address, err: String(e) }, "channel list failed"); }

    // ── 4. Alarm events (cursor-based) ───────────────────────────────────
    // Cursor always advances to now so the next poll window is current.
    // If alarm events return a more precise latestTime we use that instead.
    let nextCursor = new Date().toISOString();
    try {
      const startTime = cursor
        ? isoToUnix(cursor)
        : Math.floor(Date.now() / 1000) - 3600; // look back 1 h on first poll

      const params = new URLSearchParams({
        startTime: String(startTime),
        endTime: String(Math.floor(Date.now() / 1000)),
        pageNo: "1",
        pageSize: "200",
      });
      const r = await this.request("GET", base + "/LAPI/V1.0/Event/AlarmEvent?" + params, a);
      const { alarmEvents, latestTime } = parseAlarmEvents(r.body);
      log.debug({ address: target.address, status: r.status, events: alarmEvents.length }, "alarm events");
      events.push(...alarmEvents);
      if (latestTime) nextCursor = new Date(latestTime * 1000).toISOString();
    } catch (e) { log.warn({ address: target.address, err: String(e) }, "alarm events failed"); }

    // ── 5. Time sync ─────────────────────────────────────────────────────
    try {
      const r = await this.request("GET", base + "/LAPI/V1.0/System/Time", a);
      const drift = checkTimeDrift(r.body);
      log.debug({ address: target.address, status: r.status, hasDrift: !!drift }, "time check");
      if (drift) events.push(drift);
    } catch (e) { log.warn({ address: target.address, err: String(e) }, "time check failed"); }

    return {
      events,
      nextCursor,
      status: deriveStatus(events),
      firmwareVersion,
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function baseUrl(target: AdapterTarget): string {
  const port = (target.vendorConfig?.httpPort as number | undefined) ?? 80;
  const addr = target.address.replace(/\/+$/, "");
  if (/^https?:\/\//i.test(addr)) return addr;
  const scheme = port === 443 ? "https" : "http";
  return `${scheme}://${addr}:${port}`;
}

function auth(c: AdapterCredential) {
  if (c.username && c.password)
    return { kind: "basic" as const, username: c.username, password: c.password };
  return { kind: "none" as const };
}

function isoToUnix(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

// ResponseCode 0 = success in Uniview LAPI
function isOk(body: unknown): body is { Response: { ResponseCode: number; Data: unknown } } {
  return (
    typeof body === "object" &&
    body !== null &&
    "Response" in body &&
    typeof (body as Record<string, unknown>).Response === "object" &&
    ((body as { Response: { ResponseCode?: unknown } }).Response.ResponseCode === 0 ||
      (body as { Response: { ResponseCode?: unknown } }).Response.ResponseCode === undefined)
  );
}

function getData(body: unknown): unknown {
  if (body === null) return null; // empty/no-content response; connection issues already logged by retry logic
  if (!isOk(body)) {
    const code = (body as { Response?: { ResponseCode?: unknown } })?.Response?.ResponseCode;
    if (code !== undefined && code !== 0) {
      log.debug({ responseCode: code, body: JSON.stringify(body)?.slice(0, 200) }, "uniview: lapi error response");
    } else {
      log.warn({ body: JSON.stringify(body)?.slice(0, 500) }, "uniview: unexpected response shape");
    }
    return null;
  }
  return (body as { Response: { Data: unknown } }).Response.Data;
}

function extractFirmware(body: unknown): string | undefined {
  const data = getData(body) as Record<string, unknown> | null;
  if (!data) return undefined;
  return (data.FirmwareVersion as string | undefined) ?? (data.SoftwareVersion as string | undefined);
}

// ── Disk parsing ──────────────────────────────────────────────────────────

function parseDiskInfo(body: unknown): AdapterEvent[] {
  const data = getData(body) as Record<string, unknown> | null;
  if (!data) return [];
  const list = (data.DiskList ?? data.HddList) as unknown[] | undefined;
  if (!Array.isArray(list)) return [];

  const events: AdapterEvent[] = [];
  for (const disk of list) {
    const d = disk as Record<string, unknown>;
    const status = d.Status as number | undefined;

    // Status: 0=Normal, 1=Uninitialized, 2=Error, 3=Full
    // Only report hardware failures — capacity warnings (status=3, usedPct) not surfaced.
    if (status === 2) {
      events.push(makeEvent("recording_lost", "critical", {
        diskNo: d.DiskNo,
        kind: "disk_failure",
      }));
    } else if (status === 1) {
      events.push(makeEvent("internal_error", "warning", {
        diskNo: d.DiskNo,
        kind: "disk_uninitialized",
      }));
    }
  }
  return events;
}

// ── Channel parsing ───────────────────────────────────────────────────────

function parseChannelList(body: unknown): AdapterEvent[] {
  const data = getData(body) as Record<string, unknown> | null;
  if (!data) return [];

  // Some firmware wraps channels under ChannelList, others under Channels
  const list = (data.ChannelList ?? data.Channels) as unknown[] | undefined;
  if (!Array.isArray(list)) return [];

  const events: AdapterEvent[] = [];
  for (const ch of list) {
    const c = ch as Record<string, unknown>;
    // Field name varies across Uniview/TVT firmware versions
    const status = c.ConnectStatus ?? c.ChannelStatus ?? c.IPCStatus ?? c.CameraStatus ?? c.Status;
    const offline =
      status === 0 ||
      status === "offline" || status === "Offline" ||
      status === "disconnected" || status === "Disconnected" ||
      status === "NoVideo";
    if (offline) {
      events.push(
        makeEvent("channel_lost", "error", {
          channelId: c.ChannelID ?? c.ChanNo ?? c.ID,
          channelName: c.ChannelName ?? c.ChanName ?? c.Name,
        }),
      );
    }
  }
  return events;
}

// ── Alarm event parsing ───────────────────────────────────────────────────

// Uniview EventType integer → normalized type
const EVENT_TYPE_MAP: Record<number, AdapterEvent["type"]> = {
  131073: "video_loss",       // VideoLoss
  131074: "motion_detected",  // MotionDetection
  131075: "tamper_detected",  // Tampering
  131076: "video_loss",       // VideoBlind
  65537:  "storage_full",     // DiskFull
  65538:  "storage_full",     // DiskError
  65539:  "storage_warning",  // NoDisk
  65540:  "recording_lost",   // RecordingAbnormal
  196609: "network_unstable", // NetworkDisconnected
  196610: "network_unstable", // IPConflict
  262145: "device_offline",   // DeviceOffline
};

function parseAlarmEvents(body: unknown): { alarmEvents: AdapterEvent[]; latestTime: number | null } {
  const data = getData(body) as Record<string, unknown> | null;
  if (!data) return { alarmEvents: [], latestTime: null };

  const list = (data.AlarmEventList ?? data.EventList) as unknown[] | undefined;
  if (!Array.isArray(list) || list.length === 0) return { alarmEvents: [], latestTime: null };

  const events: AdapterEvent[] = [];
  let latestTime: number | null = null;

  for (const item of list) {
    const e = item as Record<string, unknown>;
    const eventTypeCode = e.EventType as number | undefined;
    const startTime = (e.StartTime as number | undefined) ?? Math.floor(Date.now() / 1000);

    if (startTime > (latestTime ?? 0)) latestTime = startTime;

    const type: AdapterEvent["type"] =
      (eventTypeCode !== undefined ? EVENT_TYPE_MAP[eventTypeCode] : undefined) ?? "internal_error";

    const severity = severityFor(type);

    events.push({
      externalId: (e.EventID as string | undefined) ?? randomUUID(),
      type,
      severity,
      detectedAt: new Date(startTime * 1000),
      rawPayload: { eventType: eventTypeCode, channelId: e.ChannelID },
      normalizedFields: {
        channelId: e.ChannelID,
        eventTypeCode,
        status: e.Status,
      },
    });
  }

  return { alarmEvents: events, latestTime };
}

// ── Time sync ─────────────────────────────────────────────────────────────

const TIME_DRIFT_THRESHOLD_S = 300; // 5 minutes

function checkTimeDrift(body: unknown): AdapterEvent | null {
  const data = getData(body) as Record<string, unknown> | null;
  if (!data) return null;

  let deviceUtcMs: number | null = null;

  if (typeof data.UTCTime === "string") {
    // UTCTime is directly comparable to Date.now()
    const str = data.UTCTime.includes("Z") ? data.UTCTime : data.UTCTime.replace(" ", "T") + "Z";
    const d = new Date(str);
    if (!isNaN(d.getTime())) deviceUtcMs = d.getTime();
  } else if (typeof data.LocalTime === "string") {
    // Convert local time to UTC using device-reported offset (seconds from UTC).
    // Default to UTC-5 (-18000s) if the device doesn't report its timezone.
    const offsetSeconds = typeof data.TimeZone === "number" ? data.TimeZone : -5 * 3600;
    const localMs = new Date(data.LocalTime.replace(" ", "T")).getTime();
    if (!isNaN(localMs)) deviceUtcMs = localMs - offsetSeconds * 1000;
  }

  if (deviceUtcMs === null) return null;

  const driftSeconds = Math.abs((Date.now() - deviceUtcMs) / 1000);
  if (driftSeconds < TIME_DRIFT_THRESHOLD_S) return null;

  return makeEvent("internal_error", "warning", {
    kind: "time_drift",
    driftSeconds: Math.round(driftSeconds),
  });
}

function severityFor(type: AdapterEvent["type"]): AdapterEvent["severity"] {
  switch (type) {
    case "device_offline":
    case "storage_full":
    case "recording_lost":
      return "critical";
    case "channel_lost":
    case "video_loss":
    case "tamper_detected":
      return "error";
    case "storage_warning":
    case "network_unstable":
      return "warning";
    default:
      return "info";
  }
}

function deriveStatus(events: AdapterEvent[]): "online" | "degraded" | "offline" {
  if (events.some((e) => e.type === "device_offline")) return "offline";
  if (events.some((e) => e.severity === "critical" || e.severity === "error")) return "degraded";
  if (events.some((e) => e.severity === "warning")) return "degraded";
  return "online";
}

function makeEvent(
  type: AdapterEvent["type"],
  severity: AdapterEvent["severity"],
  fields: Record<string, unknown>,
): AdapterEvent {
  return {
    externalId: randomUUID(),
    type,
    severity,
    detectedAt: new Date(),
    rawPayload: {},
    normalizedFields: fields,
  };
}
