import { describe, it, expect } from "vitest";
import { AppError, err } from "../src/core/errors.js";

describe("AppError", () => {
  it("maps codes to status codes", () => {
    expect(err.tenantRequired("x").statusCode).toBe(401);
    expect(err.forbidden().statusCode).toBe(403);
    expect(err.notFound("X", "1").statusCode).toBe(404);
    expect(err.conflict("dup").statusCode).toBe(409);
    expect(err.licenseRequired().statusCode).toBe(422);
    expect(err.budgetExceeded("devices", 5).statusCode).toBe(409);
    expect(err.adapterTimeout("onvif").statusCode).toBe(504);
    expect(err.adapterUnavailable("onvif").statusCode).toBe(502);
    expect(err.credentialDecrypt("dev-1").statusCode).toBe(424);
    expect(err.internal().statusCode).toBe(500);
  });

  it("preserves cause and details", () => {
    const cause = new Error("upstream");
    const e = new AppError("INTERNAL", "boom", { details: { a: 1 }, cause });
    expect(e.details).toEqual({ a: 1 });
    expect(e.cause).toBe(cause);
  });
});
