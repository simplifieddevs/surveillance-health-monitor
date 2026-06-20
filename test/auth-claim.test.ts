import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Regression guard: the auth handler must read the snake_case JWT claim
 * `company_id`, not `companyId`. The token shape (snake_case) is enforced
 * by the sign-jwt script and the OpenAPI spec; if someone changes the
 * claim name on either side without updating the other, this test fails.
 *
 * The actual token-verify integration test is in the live box, where we
 * hit the API. This unit test catches accidental claim-name drift.
 */

describe("auth claim wiring", () => {
  it("src/http/auth.ts reads `company_id` from the JWT payload", () => {
    const src = readFileSync("src/http/auth.ts", "utf8");
    // Must reference the snake_case claim.
    expect(src).toMatch(/company_id/);
    // Must not rely on a camelCase alias that doesn't exist on the wire.
    expect(src).not.toMatch(/\.companyId\b/);
  });

  it("scripts/sign-jwt.ts writes `company_id` into the payload", () => {
    const src = readFileSync("scripts/sign-jwt.ts", "utf8");
    expect(src).toMatch(/company_id/);
  });

  it("openapi.yaml documents Bearer auth", () => {
    const src = readFileSync("openapi.yaml", "utf8");
    expect(src).toMatch(/bearerAuth/);
  });
});
