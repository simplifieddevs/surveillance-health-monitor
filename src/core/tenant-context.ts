/**
 * Tenant context — the single piece of identity that gates every DB query.
 *
 * Rule: there is no path in this service that issues a query without a
 * TenantContext. If a code path can't produce one, it's a bug, not a
 * permission concern.
 */

export interface TenantContext {
  /** Postgres-friendly tenant id (uuid). */
  readonly companyId: string;
  /** Subject (user or service account) that initiated the request. */
  readonly subjectId: string;
  /** "user" = human operator, "service" = machine-to-machine. */
  readonly subjectKind: "user" | "service";
  /** Request id propagated through logs and downstream calls. */
  readonly requestId: string;
}

/**
 * Branded sentinel type for "no tenant" — used only for system-initiated
 * work that legitimately crosses tenant boundaries (e.g. license expiry
 * cron, system health probes). Routes MUST refuse this.
 */
export type SystemContext = {
  readonly __brand: "SystemContext";
  readonly requestId: string;
};

export function systemContext(requestId: string): SystemContext {
  return Object.freeze({ __brand: "SystemContext" as const, requestId });
}

/** Narrowing helper: is this the dangerous system-only context? */
export function isSystemContext(c: TenantContext | SystemContext): c is SystemContext {
  return (c as SystemContext).__brand === "SystemContext";
}

/**
 * Exhaustiveness sentinel. If you can call this without TS erroring,
 * your switch was non-exhaustive.
 */
export function assertNever(x: never): never {
  throw new Error(`Non-exhaustive case: ${JSON.stringify(x)}`);
}
