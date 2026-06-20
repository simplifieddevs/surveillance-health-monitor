/**
 * License tiers and the poll budgets they enforce.
 *
 * Budget = (maxDevices, pollIntervalSeconds, maxConcurrentPolls).
 * The scheduler never lets a company exceed its tier; license downgrade
 * takes effect immediately for new schedules.
 */

export type LicenseTierId = "trial" | "basic" | "pro" | "enterprise";

export interface LicenseTier {
  readonly id: LicenseTierId;
  readonly label: string;
  readonly maxDevices: number;        // 0 = unlimited (we still gate via DB)
  readonly pollIntervalSeconds: number;
  readonly maxConcurrentPolls: number;
  readonly retentionDays: number;     // event retention window
}

export const LICENSE_TIERS: Readonly<Record<LicenseTierId, LicenseTier>> = Object.freeze({
  trial: {
    id: "trial",
    label: "Trial",
    maxDevices: 5,
    pollIntervalSeconds: 60,
    maxConcurrentPolls: 2,
    retentionDays: 7,
  },
  basic: {
    id: "basic",
    label: "Basic",
    maxDevices: 25,
    pollIntervalSeconds: 120,
    maxConcurrentPolls: 8,
    retentionDays: 30,
  },
  pro: {
    id: "pro",
    label: "Pro",
    maxDevices: 100,
    pollIntervalSeconds: 60,
    maxConcurrentPolls: 32,
    retentionDays: 90,
  },
  enterprise: {
    id: "enterprise",
    label: "Enterprise",
    maxDevices: Number.MAX_SAFE_INTEGER,
    pollIntervalSeconds: 30,
    maxConcurrentPolls: 128,
    retentionDays: 365,
  },
});

export type LicenseState = "trial" | "active" | "expired" | "suspended";

export function tierFor(state: LicenseState, id: LicenseTierId): LicenseTier {
  // All states use the same tier shape today; this is where future
  // per-state overrides (e.g. suspended forces a degraded budget) plug in.
  void state;
  return LICENSE_TIERS[id];
}
