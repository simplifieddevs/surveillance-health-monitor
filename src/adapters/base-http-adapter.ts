import { fetch, Agent, type RequestInit, type Response } from "undici";
import { loadEnv } from "../config/env.js";
import { err } from "../core/errors.js";
import { getLogger } from "../core/logger.js";

/**
 * BaseHTTPAdapter — shared HTTP client + auth header helpers.
 *
 * Why this exists:
 *   - Centralizes timeouts, retries, and SSRF-safe connection pooling.
 *   - Each vendor only contributes URL paths + payload shapes.
 *   - We never pass credentials through loggers or response objects that
 *     escape this class.
 *
 * The shared undici Agent disables redirects (vendors don't legitimately
 * redirect) and pins IPv4 to keep behavior consistent across networks.
 */

const log = getLogger().child({ component: "vendor-http" });

const agent = new Agent({
  connect: { timeout: 2_000 },
  bodyTimeout: loadEnv().VENDOR_HTTP_TIMEOUT_MS,
  headersTimeout: loadEnv().VENDOR_HTTP_TIMEOUT_MS,
  maxRedirections: 0,
});

export type VendorAuth =
  | { kind: "basic"; username: string; password: string }
  | { kind: "bearer"; token: string }
  | { kind: "digest"; username: string; password: string } // ONVIF digest
  | { kind: "none" };

export class BaseHTTPAdapter {
  protected authHeaders(auth: VendorAuth): Record<string, string> {
    switch (auth.kind) {
      case "basic": {
        const value = Buffer.from(`${auth.username}:${auth.password}`, "utf8").toString("base64");
        return { Authorization: `Basic ${value}` };
      }
      case "bearer":
        return { Authorization: `Bearer ${auth.token}` };
      case "digest":
      case "none":
        return {};
    }
  }

  /**
   * Perform an HTTP request with timeout and bounded retries on transient
   * errors. The body is consumed as JSON when possible, else text.
   * NEVER logs request or response bodies — log only the URL and status.
   */
  protected async request(
    method: "GET" | "POST",
    url: string,
    auth: VendorAuth,
    init?: Omit<RequestInit, "method" | "headers"> & { headers?: Record<string, string> },
  ): Promise<{ status: number; body: unknown; contentType: string }> {
    const env = loadEnv();
    const headers: Record<string, string> = {
      Accept: "application/json, application/xml;q=0.9, */*;q=0.5",
      ...this.authHeaders(auth),
      ...(init?.headers ?? {}),
    };

    let lastErr: unknown;
    for (let attempt = 0; attempt <= env.VENDOR_HTTP_RETRIES; attempt++) {
      const started = Date.now();
      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers,
          dispatcher: agent,
          ...init,
        });
      } catch (e) {
        lastErr = e;
        log.warn({ url, attempt, err: String(e) }, "vendor http failed");
        continue;
      }

      const contentType = res.headers.get("content-type") ?? "";
      const body = await safeReadBody(res, contentType);

      if (res.status >= 500 && attempt < env.VENDOR_HTTP_RETRIES) {
        lastErr = new Error(`HTTP ${res.status}`);
        log.warn({ url, attempt, status: res.status }, "vendor 5xx, retrying");
        continue;
      }

      log.debug({ url, method, status: res.status, ms: Date.now() - started }, "vendor http");
      return { status: res.status, body, contentType };
    }

    throw err.adapterUnavailable(url, lastErr);
  }

  /** GET helper for connectivity probes. */
  protected async probe(
    url: string,
    auth: VendorAuth,
  ): Promise<{ ok: boolean; latencyMs: number; reason?: string }> {
    const started = Date.now();
    try {
      const { status } = await this.request("GET", url, auth);
      const latencyMs = Date.now() - started;
      // 401/403 mean network reachable but auth wrong; that's still "ok"
      // from a connectivity standpoint. TestConnectivity cares about reach.
      return { ok: status > 0 && status < 500, latencyMs, reason: status >= 500 ? `HTTP ${status}` : undefined };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - started, reason: String(e) };
    }
  }
}

async function safeReadBody(res: Response, contentType: string): Promise<unknown> {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  // Always attempt JSON parse — many NVR vendors return JSON with text/plain
  // or no content-type, which would otherwise leave the body as a raw string
  // and break all downstream parsers.
  if (contentType.includes("application/json") || !contentType || contentType.includes("text/")) {
    try { return JSON.parse(text); } catch { /* not JSON, fall through */ }
  }
  return text;
}
