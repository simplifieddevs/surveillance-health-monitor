import { describe, it, expect } from "vitest";
import { normalize } from "../src/polling/normalize.js";
import type { AdapterEvent } from "../src/adapters/types.js";

const DEVICE = {
  id: "00000000-0000-0000-0000-000000000001",
  companyId: "00000000-0000-0000-0000-000000000002",
  siteId: "00000000-0000-0000-0000-000000000003",
};

describe("normalize", () => {
  it("stamps tenant + site ids and scrubs credentials in raw payload", () => {
    const ev: AdapterEvent = {
      externalId: "abc",
      type: "auth_failed",
      severity: "warning",
      detectedAt: new Date(),
      rawPayload: { username: "admin", password: "leaked", token: "tok", nested: { api_key: "k" } },
      normalizedFields: { reason: "bad_pw" },
    };
    const now = new Date();
    const [out] = normalize(DEVICE, [ev], now);
    expect(out).toBeDefined();
    expect(out!.companyId).toBe(DEVICE.companyId);
    expect(out!.siteId).toBe(DEVICE.siteId);
    expect(out!.rawPayload).toEqual({
      username: "admin",
      password: "[redacted]",
      token: "[redacted]",
      nested: { api_key: "[redacted]" },
    });
  });

  it("marks clock skew when detectedAt is more than 5m off", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const ev: AdapterEvent = {
      externalId: "x",
      type: "video_loss",
      severity: "warning",
      detectedAt: new Date("2026-01-01T11:50:00Z"), // 10 min behind
      rawPayload: {},
      normalizedFields: {},
    };
    const [out] = normalize(DEVICE, [ev], now);
    expect(out!.normalizedFields.clock_skew_s).toBe(600);
  });

  it("drops far-future events", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const ev: AdapterEvent = {
      externalId: "x",
      type: "motion_detected",
      severity: "info",
      detectedAt: new Date("2026-01-01T13:00:00Z"), // +1h
      rawPayload: {},
      normalizedFields: {},
    };
    const out = normalize(DEVICE, [ev], now);
    expect(out).toHaveLength(0);
  });
});
