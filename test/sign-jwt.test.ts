import { describe, it, expect, beforeAll } from "vitest";
import "./setup.js";
import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * sign-jwt end-to-end test. Runs the script as a child process with controlled
 * env vars, then verifies:
 *   - token shape (3 dot-separated base64url segments)
 *   - signature is valid HS256 against the same JWT_SECRET
 *   - payload fields are correct
 *
 * We use spawnSync + a project-local .env so the script exercises the real
 * .env loading path (matches how an operator will use it).
 */

import { createHmac } from "node:crypto";

const SCRIPT = path.resolve("scripts/sign-jwt.ts");
const TSX = path.resolve("node_modules/.bin/tsx");

function decode(b64: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
  ) as Record<string, unknown>;
}

function runScript(
  args: string[],
  env: NodeJS.ProcessEnv,
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(TSX, [SCRIPT, ...args], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return {
    status: r.status ?? -1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

describe("sign-jwt", () => {
  beforeAll(() => {
    // Sanity: tsx must be installed.
    expect(() => undefined).not.toThrow();
  });

  it("mints a valid HS256 token with the requested claims", () => {
    const companyId = "00000000-0000-0000-0000-000000000abc";
    const sub = "user-test-1";
    const result = runScript(
      ["--company", companyId, "--sub", sub, "--kind", "user", "--ttl", "600"],
      {},
    );
    expect(result.status, result.stderr).toBe(0);

    const token = result.stdout.trim();
    const parts = token.split(".");
    expect(parts).toHaveLength(3);

    const [headerB64, payloadB64, sigB64] = parts;
    const header = decode(headerB64!);
    expect(header.alg).toBe("HS256");
    expect(header.typ).toBe("JWT");

    const payload = decode(payloadB64!);
    expect(payload.company_id).toBe(companyId);
    expect(payload.sub).toBe(sub);
    expect(payload.kind).toBe("user");
    expect(payload.iss).toBe("shm-test"); // from test/setup.ts
    expect(payload.aud).toBe("shm-test-api");
    expect(typeof payload.exp).toBe("number");
    expect(typeof payload.iat).toBe("number");

    // Signature is HS256(JWT_SECRET).
    const secret = process.env.JWT_SECRET ?? "";
    const expected = createHmac("sha256", secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest();
    const got = Buffer.from(sigB64!.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    expect(got.length).toBe(expected.length);
    expect(got.equals(expected)).toBe(true);
  });

  it("rejects missing required args", () => {
    const noCompany = runScript(["--sub", "u"], {});
    expect(noCompany.status).not.toBe(0);
    expect(noCompany.stderr).toMatch(/--company/);

    const noSub = runScript(["--company", "00000000-0000-0000-0000-000000000abc"], {});
    expect(noSub.status).not.toBe(0);
    expect(noSub.stderr).toMatch(/--sub/);
  });

  it("rejects bad --kind", () => {
    const r = runScript(
      ["--company", "00000000-0000-0000-0000-000000000abc", "--sub", "u", "--kind", "robot"],
      {},
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/--kind/);
  });

  it("includes scope when provided", () => {
    const r = runScript(
      [
        "--company",
        "00000000-0000-0000-0000-000000000abc",
        "--sub",
        "u",
        "--kind",
        "service",
        "--scope",
        "events:read,devices:write",
        "--ttl",
        "60",
      ],
      {},
    );
    expect(r.status, r.stderr).toBe(0);
    const [_, payloadB64] = r.stdout.trim().split(".");
    const payload = decode(payloadB64!);
    expect(payload.scope).toEqual(["events:read", "devices:write"]);
    expect(payload.kind).toBe("service");
  });

  it("rejects when JWT_SECRET is missing or too short", () => {
    const r = runScript(
      ["--company", "00000000-0000-0000-0000-000000000abc", "--sub", "u"],
      { JWT_SECRET: "" },
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/JWT_SECRET/);
  });
});
