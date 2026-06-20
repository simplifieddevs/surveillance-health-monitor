import { randomUUID, randomBytes } from "node:crypto";

/** Server-side id generator. Uses crypto.randomUUID — collision-safe. */
export function newId(): string {
  return randomUUID();
}

/** Short opaque id for cursors / correlation tokens (16 bytes -> 32 hex chars). */
export function newCursorToken(): string {
  return randomBytes(16).toString("hex");
}

/** Validate UUID-v4-ish shape; cheap pre-check before hitting the DB. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}
