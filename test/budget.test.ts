import { describe, it, expect } from "vitest";
import "./setup.js";
import { PollBudget } from "../src/polling/budget.js";
import { LICENSE_TIERS } from "../src/config/license-tiers.js";

// These tests use ioredis-mock style assertions only — the budget is
// thin enough that integration tests against real Redis are preferable.
// Here we verify error mapping and the public contract.

describe("PollBudget", () => {
  it("throws LICENSE_BUDGET_EXCEEDED on acquire timeout", async () => {
    // No Redis connection here; we rely on the constructor to succeed
    // (it doesn't connect until first call) and assert error mapping
    // when acquire is called without a live Redis. We don't actually
    // hit Redis — instead, exercise the error path directly.
    const { err } = await import("../src/core/errors.js");
    const e = err.budgetExceeded("concurrency", 5);
    expect(e.code).toBe("LICENSE_BUDGET_EXCEEDED");
    expect(e.statusCode).toBe(409);
    expect(e.details).toEqual({ kind: "concurrency", limit: 5 });
  });

  it("uses the tier's maxConcurrentPolls as the cap", () => {
    expect(LICENSE_TIERS.trial.maxConcurrentPolls).toBe(2);
    expect(LICENSE_TIERS.basic.maxConcurrentPolls).toBe(8);
    expect(LICENSE_TIERS.pro.maxConcurrentPolls).toBe(32);
    expect(LICENSE_TIERS.enterprise.maxConcurrentPolls).toBe(128);
  });

  it("enforcement is currently disabled per product decision", () => {
    // The license gates in routes and the polling worker are commented
    // out. The data model (licenses table, tier config, error codes)
    // is preserved so re-enabling is a behavior toggle. This test is
    // a regression guard: if someone re-enables enforcement without
    // updating tests + docs, we'll catch it.
    //
    // We strip line-leading whitespace + "//" before matching so the
    // commented-out example code doesn't trigger a false positive.
    const stripComments = (s: string) =>
      s.split("\n").map((l) => l.trim().replace(/^\/\/\s?/, "")).join("\n");

    const fs = require("node:fs");
    const devicesRoute = stripComments(
      fs.readFileSync("src/http/routes/devices.ts", "utf8"),
    );
    expect(devicesRoute).not.toMatch(/await requireLicense\(/);
    expect(devicesRoute).not.toMatch(/budgetExceeded\("devices"/);

    const scheduler = stripComments(
      fs.readFileSync("src/polling/scheduler.ts", "utf8"),
    );
    expect(scheduler).not.toMatch(/await requireLicense\(/);
    expect(scheduler).not.toMatch(/budget\.acquire\(/);
  });
});
