import { BaseHTTPAdapter } from "./base-http-adapter.js";
import type {
  VendorAdapter,
  AdapterCredential,
  AdapterTarget,
  PullResult,
  AdapterEvent,
} from "./types.js";

/**
 * ONVIF adapter — generic, works with any ONVIF-conformant device.
 *
 * Real-world note: ONVIF's PullMessages is the canonical event stream,
 * but many devices implement the older Event service. We hit
 * `onvif/device_service` for the GetDeviceInformation probe, and
 * `onvif/event_service` for PullMessages with a cursor.
 *
 * For this scaffold we model the request/response shape; the actual XML
 * body construction lives in src/adapters/onvif-xml.ts in production.
 * Here we use the device's REST-friendly profile when available.
 */

export class OnvifAdapter extends BaseHTTPAdapter implements VendorAdapter {
  readonly vendor = "onvif" as const;

  async testConnectivity(
    target: AdapterTarget,
    credential: AdapterCredential,
  ): Promise<{ ok: boolean; latencyMs: number; reason?: string }> {
    const url = joinUrl(target.address, "/onvif/device_service");
    return this.probe(url, authFromCredential(credential));
  }

  async pull(
    target: AdapterTarget,
    credential: AdapterCredential,
    cursor: string | null,
  ): Promise<PullResult> {
    const url = joinUrl(target.address, "/onvif/event_service");
    // Real implementation: build PullMessages XML, parse NotificationMessage
    // stream, map to AdapterEvent. Stubbed here to keep the scaffold
    // vendor-agnostic.
    const res = await this.request("POST", url, authFromCredential(credential), {
      headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
      body: buildPullMessagesXml(cursor, 60),
    });

    const events = parsePullMessagesResponse(res.body, res.contentType);
    return {
      events,
      nextCursor: deriveNextCursor(events, cursor),
      status: events.some((e) => e.type === "device_offline") ? "offline" : "online",
    };
  }
}

function joinUrl(address: string, path: string): string {
  if (/^https?:\/\//i.test(address)) return address.replace(/\/+$/, "") + path;
  return `http://${address.replace(/\/+$/, "")}${path}`;
}

function authFromCredential(c: AdapterCredential) {
  if (c.token) return { kind: "bearer" as const, token: c.token };
  if (c.username && c.password) return { kind: "digest" as const, username: c.username, password: c.password };
  return { kind: "none" as const };
}

/* ------------------------------------------------------------------ */
/* The functions below are intentionally minimal — they're the seams
 * where the XML stack plugs in. Kept here so the structure is visible. */

function buildPullMessagesXml(cursor: string | null, timeoutSec: number): string {
  // Real impl: WS-Security header + SOAP envelope + PullMessages element.
  // Returning the cursor for trace purposes only.
  return `<!-- ONVIF PullMessages cursor=${cursor ?? "init"} timeout=${timeoutSec}s -->`;
}

function parsePullMessagesResponse(body: unknown, _contentType: string): AdapterEvent[] {
  // Real impl: XML parse + iterate NotificationMessage. Stub returns [].
  void body;
  return [];
}

function deriveNextCursor(events: AdapterEvent[], prev: string | null): string | null {
  if (events.length === 0) return prev;
  // ONVIF cursors are absolute timestamps; this stub just rotates.
  return new Date().toISOString();
}
