import { BaseHTTPAdapter } from "./base-http-adapter.js";
import type {
  VendorAdapter,
  AdapterCredential,
  AdapterTarget,
  PullResult,
  AdapterEvent,
} from "./types.js";

/**
 * Axis VAPIX adapter.
 *
 * Endpoint shapes (HTTP basic or digest auth):
 *   GET  /axis-cgi/basicdeviceinfo.cgi
 *   GET  /axis-cgi/applications/list.cgi
 *   GET  /axis-cgi/events/list.cgi?starttime=&endtime=
 *   GET  /axis-cgi/streammgmt.cgi (for live probe)
 *
 * VAPIX uses ISO-8601 timestamps for cursoring.
 */

export class AxisVapixAdapter extends BaseHTTPAdapter implements VendorAdapter {
  readonly vendor = "axis" as const;

  async testConnectivity(target: AdapterTarget, credential: AdapterCredential) {
    const url = joinUrl(target.address, "/axis-cgi/basicdeviceinfo.cgi");
    return this.probe(url, authFromCredential(credential));
  }

  async pull(
    target: AdapterTarget,
    credential: AdapterCredential,
    cursor: string | null,
  ): Promise<PullResult> {
    const params = new URLSearchParams();
    params.set("starttime", cursor ?? "1970-01-01T00:00:00Z");
    params.set("endtime", new Date().toISOString());
    const url = joinUrl(target.address, "/axis-cgi/events/list.cgi") + "?" + params.toString();
    const res = await this.request("GET", url, authFromCredential(credential));
    const events = parseEventListResponse(res.body, res.contentType);
    return {
      events,
      nextCursor: new Date().toISOString(),
      status: deriveStatus(events),
    };
  }
}

function joinUrl(address: string, path: string): string {
  if (/^https?:\/\//i.test(address)) return address.replace(/\/+$/, "") + path;
  return `http://${address.replace(/\/+$/, "")}${path}`;
}

function authFromCredential(c: AdapterCredential) {
  // VAPIX prefers digest; basic is acceptable on older firmware.
  if (c.username && c.password) return { kind: "digest" as const, username: c.username, password: c.password };
  return { kind: "none" as const };
}

function parseEventListResponse(body: unknown, _contentType: string): AdapterEvent[] {
  void body;
  return [];
}

function deriveStatus(events: AdapterEvent[]): "online" | "degraded" | "offline" {
  if (events.some((e) => e.type === "device_offline")) return "offline";
  if (events.some((e) => e.severity === "warning" || e.severity === "error")) return "degraded";
  return "online";
}
