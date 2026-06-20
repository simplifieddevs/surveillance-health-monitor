import type {
  VendorAdapter,
  AdapterCredential,
  AdapterTarget,
  PullResult,
  AdapterEvent,
} from "../../src/adapters/types.js";
import type { Vendor } from "../../src/db/repositories/devices.js";

/**
 * FakeAdapter — programmable adapter for tests. Configure the events
 * to emit and the connectivity result; the same shape lets us exercise
 * poll success, offline, malformed payload, and slow-network paths.
 */

export interface FakeAdapterOptions {
  vendor: Vendor;
  events?: AdapterEvent[];
  nextCursor?: string | null;
  status?: "online" | "degraded" | "offline";
  connectivity?: { ok: boolean; latencyMs: number; reason?: string };
  throwOnPull?: Error;
}

export class FakeAdapter implements VendorAdapter {
  public pullCount = 0;
  public lastTarget?: AdapterTarget;
  public lastCredential?: AdapterCredential;
  public lastCursor?: string | null;

  constructor(private readonly opts: FakeAdapterOptions) {}

  get vendor(): Vendor { return this.opts.vendor; }

  async pull(
    target: AdapterTarget,
    credential: AdapterCredential,
    cursor: string | null,
  ): Promise<PullResult> {
    this.pullCount++;
    this.lastTarget = target;
    this.lastCredential = credential;
    this.lastCursor = cursor;
    if (this.opts.throwOnPull) throw this.opts.throwOnPull;
    return {
      events: this.opts.events ?? [],
      nextCursor: this.opts.nextCursor ?? new Date().toISOString(),
      status: this.opts.status ?? "online",
    };
  }

  async testConnectivity(
    _target: AdapterTarget,
    _credential: AdapterCredential,
  ): Promise<{ ok: boolean; latencyMs: number; reason?: string }> {
    return this.opts.connectivity ?? { ok: true, latencyMs: 1 };
  }
}
