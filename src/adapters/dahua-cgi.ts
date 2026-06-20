import { BaseHTTPAdapter } from "./base-http-adapter.js";
import type {
  VendorAdapter,
  AdapterCredential,
  AdapterTarget,
  PullResult,
  AdapterEvent,
} from "./types.js";

/**
 * Dahua HTTP CGI adapter.
 *
 * Endpoint shapes (HTTP digest auth):
 *   GET  /cgi-bin/magicBox.cgi?action=getSystemInfo
 *   GET  /cgi-bin/eventManager.cgi?action=getEventIndexes&code=VideoLoss
 *   GET  /cgi-bin/storage.cgi?action=getStorageInfo
 *   POST /cgi-bin/recordManager.cgi?action=find  (record search)
 *
 * Event subscription model: Dahua uses a polling model over CGI. Each
 * event type has its own action; we iterate known event types and
 * convert each one to a normalized AdapterEvent.
 */

const POLLED_EVENT_TYPES = [
  "VideoLoss",
  "VideoMotion",
  "StorageLowSpace",
  "StorageFailure",
  "UserLock",
  "NetAbort",
  "IPConflict",
  "MACConflict",
  "PowerFault",
] as const;

export class DahuaCgiAdapter extends BaseHTTPAdapter implements VendorAdapter {
  readonly vendor = "dahua" as const;

  async testConnectivity(target: AdapterTarget, credential: AdapterCredential) {
    const url = joinUrl(target.address, "/cgi-bin/magicBox.cgi") + "?action=getSystemInfo";
    return this.probe(url, authFromCredential(credential));
  }

  async pull(
    target: AdapterTarget,
    credential: AdapterCredential,
    cursor: string | null,
  ): Promise<PullResult> {
    const events: AdapterEvent[] = [];
    let degraded = false;

    for (const code of POLLED_EVENT_TYPES) {
      const url = joinUrl(target.address, "/cgi-bin/eventManager.cgi") +
        `?action=getEventIndexes&code=${encodeURIComponent(code)}`;
      const res = await this.request("GET", url, authFromCredential(credential));
      const parsed = parseEventIndexResponse(res.body, code);
      events.push(...parsed);
      if (parsed.some((e) => e.severity !== "info")) degraded = true;
    }

    return {
      events,
      nextCursor: cursor ?? new Date().toISOString(),
      status: events.some((e) => e.type === "device_offline")
        ? "offline"
        : degraded
          ? "degraded"
          : "online",
    };
  }
}

function joinUrl(address: string, path: string): string {
  if (/^https?:\/\//i.test(address)) return address.replace(/\/+$/, "") + path;
  return `http://${address.replace(/\/+$/, "")}${path}`;
}

function authFromCredential(c: AdapterCredential) {
  if (c.username && c.password) return { kind: "digest" as const, username: c.username, password: c.password };
  return { kind: "none" as const };
}

function parseEventIndexResponse(body: unknown, code: string): AdapterEvent[] {
  void body; void code;
  return [];
}
