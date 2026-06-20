import { describe, it, expect } from "vitest";
import "./setup.js";
import { adapterFor, _setAdapters } from "../src/adapters/registry.js";
import { FakeAdapter } from "./helpers/fake-adapter.js";

describe("Adapter registry", () => {
  it("returns the right adapter for each vendor", () => {
    expect(adapterFor("onvif").vendor).toBe("onvif");
    expect(adapterFor("hikvision").vendor).toBe("hikvision");
    expect(adapterFor("dahua").vendor).toBe("dahua");
    expect(adapterFor("uniview").vendor).toBe("uniview");
    expect(adapterFor("hanwha").vendor).toBe("hanwha");
    expect(adapterFor("axis").vendor).toBe("axis");
  });

  it("supports test injection", async () => {
    const fake = new FakeAdapter({ vendor: "onvif", events: [] });
    _setAdapters({ onvif: () => fake });
    const a = adapterFor("onvif");
    expect(a).toBe(fake);
  });
});

describe("FakeAdapter", () => {
  it("records pull inputs", async () => {
    const a = new FakeAdapter({ vendor: "hikvision", events: [] });
    await a.pull({ address: "10.0.0.1", vendorConfig: {} }, { username: "u", password: "p" }, null);
    expect(a.pullCount).toBe(1);
    expect(a.lastTarget?.address).toBe("10.0.0.1");
    expect(a.lastCredential?.username).toBe("u");
    expect(a.lastCursor).toBeNull();
  });
});
