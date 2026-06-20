import { BaseHTTPAdapter } from "./base-http-adapter.js";
import type {
  VendorAdapter,
  AdapterCredential,
  AdapterTarget,
  PullResult,
  AdapterEvent,
} from "./types.js";

/**
 * Hanwha Vision (Wisenet) SUNAPI adapter.
 *
 * Endpoint shapes (basic auth over HTTP):
 *   GET  /stw-cgi/system.cgi?msubmenu=deviceinfo
 *   GET  /stw-cgi/event.cgi?msubmenu=eventlist&type=...&starttime=...&endtime=...
 *   GET  /stw-cgi/recording.cgi?msubmenu=status
 *   GET  /stw-cgi/storage.cgi?msubmenu=diskinfo
 *
 * Hanwha also publishes ONVIF profile S/G — most models default to ONVIF
 * unless explicitly switched. The SUNAPI adapter exists for fields only
 * SUNAPI exposes (e.g. analytics channels).
 */

export class HanwhaSunapiAdapter extends BaseHTTPAdapter implements VendorAdapter {
  readonly vendor = "hanwha" as const;

  async testConnectivity(target: AdapterTarget, credential: AdapterCredential) {
    const url = joinUrl(target.address, "/stw-cgi/system.cgi") + "?msubmenu=deviceinfo";
    return this.probe(url, authFromCredential(credential));
  }

  async pull(
    target: AdapterTarget,
    credential: AdapterCredential,
    cursor: string | null,
  ): Promise<PullResult> {
    const params = new URLSearchParams({ msubmenu: "eventlist", type: "all" });
    if (cursor) params.set("starttime", cursor);
    params.set("endtime", new Date().toISOString());
    const url = joinUrl(target.address, "/stw-cgi/event.cgi") + "?" + params.toString();
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
  if (c.username && c.password) return { kind: "basic" as const, username: c.username, password: c.password };
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
