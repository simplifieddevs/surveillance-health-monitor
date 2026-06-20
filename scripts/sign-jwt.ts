/**
 * sign-jwt — mint a development JWT for the SSM API.
 *
 * The token matches exactly what src/http/auth.ts verifies:
 *   - alg: HS256
 *   - iss / aud / sub / company_id / kind / scope
 *
 * Usage:
 *   npx tsx scripts/sign-jwt.ts \
 *     --company <uuid> \
 *     --sub     <user-or-service-id> \
 *     --kind    user|service \
 *     --scope   events:read,devices:write \
 *     --ttl     3600
 *
 * Reads JWT_SECRET and JWT_ISSUER/AUDIENCE from .env (or the current shell env).
 * Prints the token to stdout. Nothing else.
 *
 * This script is for development. Do NOT call it from production code paths.
 */

import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

type Kind = "user" | "service";

interface CliOptions {
  companyId: string;
  sub: string;
  kind: Kind;
  scope: string[];
  ttlSeconds: number;
}

function loadDotenv(file: string): void {
  // Tiny .env loader — no new dep. Reads KEY=VALUE lines, ignores blanks/comments.
  try {
    const text = readFileSync(file, "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const [, k, vRaw] = m;
      if (k === undefined || vRaw === undefined) continue;
      let v = vRaw.trim();
      // Strip surrounding quotes if present.
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    // .env optional; rely on shell env.
  }
}

function parseArgs(argv: readonly string[]): CliOptions {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    if (idx < 0 || idx + 1 >= argv.length) return undefined;
    return argv[idx + 1];
  };
  const companyId = get("--company") ?? "";
  const sub = get("--sub") ?? "";
  const kindRaw = get("--kind") ?? "user";
  const scopeRaw = get("--scope") ?? "";
  const ttlRaw = get("--ttl") ?? "3600";
  if (!companyId) throw new Error("--company <uuid> is required");
  if (!sub) throw new Error("--sub <id> is required");
  if (kindRaw !== "user" && kindRaw !== "service") {
    throw new Error("--kind must be 'user' or 'service'");
  }
  const ttl = Number(ttlRaw);
  if (!Number.isInteger(ttl) || ttl <= 0 || ttl > 60 * 60 * 24 * 365) {
    throw new Error("--ttl must be a positive integer (seconds, max 1y)");
  }
  return {
    companyId,
    sub,
    kind: kindRaw,
    scope: scopeRaw ? scopeRaw.split(",").map((s) => s.trim()).filter(Boolean) : [],
    ttlSeconds: ttl,
  };
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function sign(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(payload));
  const signing = `${headerB64}.${payloadB64}`;
  const sig = createHmac("sha256", secret).update(signing).digest();
  return `${signing}.${b64url(sig)}`;
}

/** Tiny self-check: re-verify the signature we just produced. Catches typos. */
function selfVerify(token: string, secret: string): void {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token shape");
  const [h, p, s] = parts;
  if (!h || !p || !s) throw new Error("malformed token shape");
  const expected = createHmac("sha256", secret).update(`${h}.${p}`).digest();
  const got = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    throw new Error("self-verify failed — signing/secret mismatch");
  }
}

async function main(): Promise<void> {
  // Load .env from the project root if present.
  const envPath = path.resolve(process.cwd(), ".env");
  loadDotenv(envPath);

  const opts = parseArgs(process.argv.slice(2));

  const secret = process.env.JWT_SECRET;
  const issuer = process.env.JWT_ISSUER ?? "shm";
  const audience = process.env.JWT_AUDIENCE ?? "shm-api";
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be set in env or .env (>=32 chars)");
  }

  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    iss: issuer,
    aud: audience,
    sub: opts.sub,
    company_id: opts.companyId,
    kind: opts.kind,
    iat: now,
    nbf: now,
    exp: now + opts.ttlSeconds,
    jti: randomUUID(),
  };
  if (opts.scope.length > 0) payload.scope = opts.scope;

  const token = sign(payload, secret);
  selfVerify(token, secret);

  // Machine-readable summary on stderr, token on stdout.
  process.stderr.write(
    JSON.stringify(
      {
        ok: true,
        company_id: opts.companyId,
        sub: opts.sub,
        kind: opts.kind,
        scope: opts.scope,
        ttl_seconds: opts.ttlSeconds,
        expires_at: new Date((now + opts.ttlSeconds) * 1000).toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  process.stdout.write(token + "\n");
}

main().catch((e) => {
  process.stderr.write(`error: ${(e as Error).message}\n`);
  process.exit(1);
});
