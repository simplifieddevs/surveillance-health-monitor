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
import { buildWsSecurity, soapEnvelope, extractTag, extractAllElements } from "./onvif-soap.js";

const log = getLogger().child({ component: "onvif" });

const TIME_DRIFT_THRESHOLD_S = 300; // 5 minutes
const SOAP_CT = { "Content-Type": "application/soap+xml; charset=utf-8" };

/**
 * ONVIF adapter — generic, works with any ONVIF-conformant device.
 *
 * Auth: WS-Security UsernameToken with PasswordDigest (ONVIF standard).
 * The WS-Security header is embedded inside the SOAP envelope, so no
 * HTTP-level auth header is used.
 *
 * Health checks:
 *   GetDeviceInformation  → firmware version
 *   GetSystemDateAndTime  → clock drift detection
 *   GetReceivers          → per-channel online/offline (NVR-only; skipped
 *                           on cameras that don't implement the service)
 *
 * ONVIF port is 80 by default; override via vendorConfig.onvifPort.
 */
export class OnvifAdapter extends BaseHTTPAdapter implements VendorAdapter {
  readonly vendor = "onvif" as const;

  async testConnectivity(
    target: AdapterTarget,
    _credential: AdapterCredential,
  ): Promise<{ ok: boolean; latencyMs: number; reason?: string }> {
    // A GET to the device service returns WSDL or 405 — either proves reach.
    return this.probe(deviceServiceUrl(target), { kind: "none" });
  }

  async pull(
    target: AdapterTarget,
    credential: AdapterCredential,
    cursor: string | null,
  ): Promise<PullResult> {
    const sec = wsSecHeader(credential);
    const dUrl = deviceServiceUrl(target);
    const events: AdapterEvent[] = [];
    let firmwareVersion: string | undefined;

    // ── 1. Device info ───────────────────────────────────────────────────
    try {
      const xml = await this.soapPost(dUrl, "<tds:GetDeviceInformation/>", sec);
      firmwareVersion = extractTag(xml, "FirmwareVersion");
      const model = extractTag(xml, "Model");
      log.debug({ address: target.address, firmwareVersion, model }, "onvif device info");
    } catch (e) {
      log.warn({ address: target.address, err: String(e) }, "onvif device info failed");
    }

    // ── 2. Time drift ────────────────────────────────────────────────────
    try {
      const xml = await this.soapPost(dUrl, "<tds:GetSystemDateAndTime/>", sec);
      const drift = parseTimeDrift(xml);
      log.debug({ address: target.address, hasDrift: !!drift }, "onvif time check");
      if (drift) events.push(drift);
    } catch (e) {
      log.warn({ address: target.address, err: String(e) }, "onvif time check failed");
    }

    // ── 3. Channel status via Receiver service (NVR only) ────────────────
    // Not all devices implement this service; failures are silent (debug).
    try {
      const rUrl = receiverServiceUrl(target);
      const xml = await this.soapPost(rUrl, "<trv:GetReceivers/>", sec);
      const channelEvents = parseReceivers(xml);
      log.debug({ address: target.address, events: channelEvents.length }, "onvif receivers");
      events.push(...channelEvents);
    } catch (e) {
      log.debug({ address: target.address, err: String(e) }, "onvif receiver service not available");
    }

    return {
      events,
      nextCursor: cursor ?? new Date().toISOString(),
      status: deriveStatus(events),
      firmwareVersion,
    };
  }

  private async soapPost(url: string, bodyContent: string, security?: string): Promise<string> {
    const r = await this.request("POST", url, { kind: "none" }, {
      headers: SOAP_CT,
      body: soapEnvelope(bodyContent, security),
    });
    const xml = typeof r.body === "string" ? r.body : "";
    if (xml.toLowerCase().includes(":fault>") || xml.toLowerCase().includes("<fault>")) {
      const faultText = extractTag(xml, "Text") ?? extractTag(xml, "faultstring") ?? "";
      log.debug({ url, fault: faultText }, "onvif soap fault");
    }
    return xml;
  }
}

// ── URL builders ──────────────────────────────────────────────────────────────

function deviceServiceUrl(target: AdapterTarget): string {
  return joinUrl(target, "/onvif/device_service");
}

function receiverServiceUrl(target: AdapterTarget): string {
  return joinUrl(target, "/onvif/receiver_service");
}

function joinUrl(target: AdapterTarget, path: string): string {
  const port = (target.vendorConfig?.onvifPort as number | undefined) ?? 80;
  const addr = target.address.replace(/\/+$/, "");
  if (/^https?:\/\//i.test(addr)) return addr + path;
  return `http://${addr}:${port}${path}`;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function wsSecHeader(c: AdapterCredential): string | undefined {
  if (c.username && c.password) return buildWsSecurity(c.username, c.password);
  return undefined;
}

// ── Parsers ───────────────────────────────────────────────────────────────────

function parseTimeDrift(xml: string): AdapterEvent | null {
  const utcXml = extractTag(xml, "UTCDateTime");
  if (!utcXml) return null;

  const year   = extractTag(utcXml, "Year");
  const month  = extractTag(utcXml, "Month");
  const day    = extractTag(utcXml, "Day");
  const hour   = extractTag(utcXml, "Hour");
  const minute = extractTag(utcXml, "Minute");
  const second = extractTag(utcXml, "Second");

  if (!year || !month || !day || !hour || !minute || !second) return null;

  const deviceUtc = new Date(
    Date.UTC(+year, +month - 1, +day, +hour, +minute, +second),
  );
  if (isNaN(deviceUtc.getTime())) return null;

  const driftSec = Math.abs((Date.now() - deviceUtc.getTime()) / 1000);
  if (driftSec < TIME_DRIFT_THRESHOLD_S) return null;

  return {
    externalId: randomUUID(),
    type: "internal_error",
    severity: "warning",
    detectedAt: new Date(),
    rawPayload: {},
    normalizedFields: { kind: "time_drift", driftSeconds: Math.round(driftSec) },
  };
}

function parseReceivers(xml: string): AdapterEvent[] {
  const receivers = extractAllElements(xml, "Receiver");
  const events: AdapterEvent[] = [];

  for (const { attrs, content } of receivers) {
    const token = attrs.match(/token="([^"]+)"/)?.[1];
    const state = extractTag(content, "ReceiverState");
    const connected = extractTag(content, "Connected");

    const isOffline =
      state === "NotConnected" ||
      connected === "false" ||
      connected === "0";

    if (isOffline) {
      events.push({
        externalId: randomUUID(),
        type: "channel_lost",
        severity: "error",
        detectedAt: new Date(),
        rawPayload: {},
        normalizedFields: { receiverToken: token, receiverState: state },
      });
    }
  }
  return events;
}

function deriveStatus(events: AdapterEvent[]): "online" | "degraded" | "offline" {
  if (events.some((e) => e.type === "device_offline")) return "offline";
  if (events.some((e) => e.severity === "critical" || e.severity === "error")) return "degraded";
  if (events.some((e) => e.severity === "warning")) return "degraded";
  return "online";
}
