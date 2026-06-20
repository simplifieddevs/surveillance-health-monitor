import { BaseHTTPAdapter } from "./base-http-adapter.js";
import type {
  VendorAdapter,
  AdapterCredential,
  AdapterTarget,
  PullResult,
  AdapterEvent,
} from "./types.js";

/**
 * Uniview (TVT) / NVR HTTP API adapter.
 *
 * Endpoint shapes (basic auth over HTTP):
 *   GET  /LAPI/10.10/V1.0/Page/DeviceInfo
 *   GET  /LAPI/10.10/V1.0/Page/ChannelInfo
 *   GET  /LAPI/10.10/V1.0/Event/AlarmEvent?startTime=&endTime=&cursor=
 *   GET  /LAPI/10.10/V1.0/Storage/DiskInfo
 *
 * UNV uses a JSON cursor for incremental event reads. We pass it through
 * transparently.
 */

export class UniviewTvtAdapter extends BaseHTTPAdapter implements VendorAdapter {
  readonly vendor = "uniview" as const;

  async testConnectivity(target: AdapterTarget, credential: AdapterCredential) {
    const url = joinUrl(target.address, "/LAPI/10.10/V1.0/Page/DeviceInfo");
    return this.probe(url, authFromCredential(credential));
  }

  async pull(
    target: AdapterTarget,
    credential: AdapterCredential,
    cursor: string | null,
  ): Promise<PullResult> {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    params.set("pageSize", "200");
    const url = joinUrl(target.address, "/LAPI/10.10/V1.0/Event/AlarmEvent") + "?" + params.toString();
    const res = await this.request("GET", url, authFromCredential(credential));
    const { events, nextCursor } = parseAlarmEventResponse(res.body, res.contentType);
    return {
      events,
      nextCursor: nextCursor ?? cursor,
      status: deriveStatus(events),
    };
  }
}

function joinUrl(address: string, path: string): string {
  if (/^https?:\/\//i.test(address)) return address.replace(/\/+$/, "") + path;
  return `http://${address.replace(/\/+$/, "")}${path}`;
}

function authFromCredential(c: AdapterCredential) {
  if (c.username && c.password) return { kind: "basic" as const, username: c.username, password: c.password };
  return { kind: "none" as const };
}

function parseAlarmEventResponse(body: unknown, _contentType: string): { events: AdapterEvent[]; nextCursor: string | null } {
  void body;
  return { events: [], nextCursor: null };
}

function deriveStatus(events: AdapterEvent[]): "online" | "degraded" | "offline" {
  if (events.some((e) => e.type === "device_offline")) return "offline";
  if (events.some((e) => e.severity === "warning" || e.severity === "error")) return "degraded";
  return "online";
}
