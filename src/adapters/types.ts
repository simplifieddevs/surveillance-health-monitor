/**
 * Adapter contract.
 *
 * The polling core speaks only to this interface. Vendor-specific code
 * lives in implementations under src/adapters/. To add a new vendor:
 *   1. Add a value to the `vendor` enum in schema.ts (migration).
 *   2. Implement VendorAdapter here.
 *   3. Register in src/adapters/registry.ts.
 *
 * Implementations are pure HTTP/parsing. They do not touch the DB.
 * They receive credentials already decrypted by CredentialVault and must
 * not log them.
 */

import type { Vendor } from "../db/repositories/devices.js";

/** Resolved credentials passed in by the polling layer. */
export interface AdapterCredential {
  readonly username?: string;
  readonly password?: string;
  readonly token?: string;
  readonly raw?: string;
}

/** Vendor-specific, vendor-owned configuration on the device row. */
export type VendorConfig = Record<string, unknown>;

/** Where the device lives on the network. */
export interface AdapterTarget {
  readonly address: string;       // vendor-specific URL, host:port, etc.
  readonly vendorConfig: VendorConfig;
}

/** A single normalized event surfaced from the vendor. */
export interface AdapterEvent {
  /** Vendor-assigned id when available, else a synthetic ULID. */
  readonly externalId: string;
  readonly type:
    | "device_offline"
    | "device_online"
    | "auth_failed"
    | "recording_lost"
    | "recording_resumed"
    | "storage_full"
    | "storage_warning"
    | "channel_lost"
    | "channel_restored"
    | "firmware_mismatch"
    | "config_changed"
    | "motion_detected"
    | "tamper_detected"
    | "video_loss"
    | "network_unstable"
    | "internal_error";
  readonly severity: "info" | "warning" | "error" | "critical";
  /** Vendor wall-clock time. We trust device clocks at face value but
   *  mark drift in normalizedFields if ingest skew exceeds 5 minutes. */
  readonly detectedAt: Date;
  /** Sanitized vendor payload. Implementations MUST strip credentials
   *  (Authorization headers, password fields, etc.). */
  readonly rawPayload: Record<string, unknown>;
  /** Canonical, queryable fields. Examples:
   *    {channelId: 1}, {storageUsedPct: 92}, {firmwareVersion: "5.7.0"} */
  readonly normalizedFields: Record<string, unknown>;
}

/** Result of a pull. cursor advances after a successful read. */
export interface PullResult {
  readonly events: readonly AdapterEvent[];
  /** Opaque cursor the adapter wants to see again next call. */
  readonly nextCursor: string | null;
  /** Optional device-level snapshot for the status field. */
  readonly status?: "online" | "degraded" | "offline";
  /** Optional firmware version observed during the pull. */
  readonly firmwareVersion?: string;
}

/**
 * The interface every vendor implements. Pull is the only method that
 * crosses the network in normal operation; the others are for setup.
 */
export interface VendorAdapter {
  readonly vendor: Vendor;
  /**
   * Pull new events since cursor (or all available if null). Must be
   * idempotent: a network retry with the same cursor MUST NOT duplicate
   * events the caller already has.
   */
  pull(
    target: AdapterTarget,
    credential: AdapterCredential,
    cursor: string | null,
  ): Promise<PullResult>;

  /** Liveness check used by testConnectivity and worker health probe. */
  testConnectivity(
    target: AdapterTarget,
    credential: AdapterCredential,
  ): Promise<{ ok: boolean; latencyMs: number; reason?: string }>;
}
