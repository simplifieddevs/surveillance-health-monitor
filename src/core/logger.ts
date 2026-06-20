import pino, { type Logger } from "pino";
import { loadEnv } from "../config/env.js";

/**
 * Structured logger.
 * Rules:
 *   - Never log credentials, raw payloads, or full HTTP bodies.
 *   - Always include requestId and companyId when known.
 *   - Use child loggers for sub-systems (poll, adapter, worker).
 */

let root: Logger | undefined;

export function getLogger(): Logger {
  if (!root) {
    const env = loadEnv();
    root = pino({
      level: env.LOG_LEVEL,
      base: { app: "shm", env: env.NODE_ENV },
      redact: {
        paths: [
          "password",
          "*.password",
          "credentials",
          "*.credentials",
          "raw_payload",
          "*.raw_payload",
          "headers.authorization",
          "headers.cookie",
        ],
        remove: true,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }
  return root;
}

export function child(bindings: Record<string, unknown>): Logger {
  return getLogger().child(bindings);
}
