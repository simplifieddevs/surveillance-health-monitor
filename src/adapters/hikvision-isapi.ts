import { BaseHTTPAdapter } from "./base-http-adapter.js";
import type {
  VendorAdapter,
  AdapterCredential,
  AdapterTarget,
  PullResult,
  AdapterEvent,
} from "./types.js";

/**
 * Hikvision ISAPI adapter.
 *
 * Endpoint shapes (HTTP digest auth):
 *   GET  /ISAPI/System/deviceInfo
 *   GET  /ISAPI/ContentMgmt/InputProxy/channels
 *   GET  /ISAPI/Event/notification/alertStream        (long-poll event stream)
 *   POST /ISAPI/Streaming/tracks/{id}?command=start   (for live probe)
 *   GET  /ISAPI/Streaming/tracks/{id}/status
 *
 * Event stream returns XML with <EventNotification> elements. Each has
 * <eventType>uridefined/hikvision/<...></eventType> and an <EventDateTime>.
 *
 * For this scaffold the HTTP layer is real; the XML parser is stubbed.
 */

export class HikvisionIsapiAdapter extends BaseHTTPAdapter implements VendorAdapter {
  readonly vendor = "hikvision" as const;

  async testConnectivity(target: AdapterTarget, credential: AdapterCredential) {
    const url = joinUrl(target.address, "/ISAPI/System/deviceInfo");
    return this.probe(url, authFromCredential(credential));
  }

  async pull(
    target: AdapterTarget,
    credential: AdapterCredential,
    cursor: string | null,
  ): Promise<PullResult> {
    // Hikvision keeps an event stream at /ISAPI/Event/notification/alertStream
    // that we long-poll. For a polling-driven model we instead query the
    // status pages and detect state changes; the event log is a separate
    // endpoint.
    const statusUrl = joinUrl(target.address, "/ISAPI/Streaming/tracks/1/status");
    const res = await this.request("GET", statusUrl, authFromCredential(credential));
    const events = parseTrackStatusResponse(res.body, res.contentType);

    return {
      events,
      nextCursor: cursor ?? new Date().toISOString(),
      status: deriveStatusFromEvents(events),
    };
  }
}

function joinUrl(address: string, path: string): string {
  if (/^https?:\/\//i.test(address)) return address.replace(/\/+$/, "") + path;
  return `http://${address.replace(/\/+$/, "")}${path}`;
}

function authFromCredential(c: AdapterCredential) {
  // ISAPI supports both digest and basic. Digest is preferred — Hikvision
  // devices ship with digest enabled by default.
  if (c.username && c.password) return { kind: "digest" as const, username: c.username, password: c.password };
  return { kind: "none" as const };
}

function parseTrackStatusResponse(body: unknown, _contentType: string): AdapterEvent[] {
  void body;
  return [];
}

function deriveStatusFromEvents(events: AdapterEvent[]): "online" | "degraded" | "offline" {
  if (events.some((e) => e.type === "device_offline")) return "offline";
  if (events.some((e) => e.severity === "warning" || e.severity === "error")) return "degraded";
  return "online";
}
