/**
 * Domain error taxonomy. Every error thrown by core code MUST extend AppError.
 * Routes convert AppError -> HTTP; workers convert AppError -> job outcome.
 */

export type ErrorCode =
  | "TENANT_REQUIRED"        // request without tenant context
  | "TENANT_MISMATCH"        // resource belongs to another tenant
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "LICENSE_REQUIRED"       // company has no active license
  | "LICENSE_EXPIRED"
  | "LICENSE_BUDGET_EXCEEDED"// would exceed tier maxDevices or concurrency
  | "ADAPTER_UNAVAILABLE"    // vendor SDK / HTTP failed
  | "ADAPTER_TIMEOUT"
  | "CREDENTIAL_DECRYPT_FAILED"
  | "INTERNAL";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details: Record<string, unknown> | undefined;
  public override readonly cause: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    opts?: { statusCode?: number; details?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = opts?.statusCode ?? statusForCode(code);
    this.details = opts?.details;
    this.cause = opts?.cause;
  }
}

function statusForCode(code: ErrorCode): number {
  switch (code) {
    case "TENANT_REQUIRED":
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
    case "TENANT_MISMATCH":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
    case "LICENSE_BUDGET_EXCEEDED":
      return 409;
    case "VALIDATION_FAILED":
    case "LICENSE_REQUIRED":
    case "LICENSE_EXPIRED":
      return 422;
    case "CREDENTIAL_DECRYPT_FAILED":
      return 424; // Failed Dependency — surfaced for ops attention
    case "ADAPTER_TIMEOUT":
      return 504;
    case "ADAPTER_UNAVAILABLE":
      return 502;
    case "INTERNAL":
    default:
      return 500;
  }
}

/** Convenience builders. */
export const err = {
  tenantRequired: (requestId: string) =>
    new AppError("TENANT_REQUIRED", "Tenant context required", { details: { requestId } }),
  tenantMismatch: (resource: string) =>
    new AppError("TENANT_MISMATCH", `Resource not visible to this tenant: ${resource}`),
  notFound: (resource: string, id: string) =>
    new AppError("NOT_FOUND", `${resource} not found`, { details: { id } }),
  validation: (message: string, details?: Record<string, unknown>) =>
    new AppError("VALIDATION_FAILED", message, { details }),
  conflict: (message: string, details?: Record<string, unknown>) =>
    new AppError("CONFLICT", message, { details }),
  unauthorized: (msg = "Unauthorized") => new AppError("UNAUTHORIZED", msg),
  forbidden: (msg = "Forbidden") => new AppError("FORBIDDEN", msg),
  licenseRequired: () => new AppError("LICENSE_REQUIRED", "No active license for this company"),
  licenseExpired: (companyId: string) =>
    new AppError("LICENSE_EXPIRED", "License has expired", { details: { companyId } }),
  budgetExceeded: (kind: "devices" | "concurrency", limit: number) =>
    new AppError("LICENSE_BUDGET_EXCEEDED", `License ${kind} budget exceeded`, {
      details: { kind, limit },
    }),
  adapterUnavailable: (vendor: string, cause?: unknown) =>
    new AppError("ADAPTER_UNAVAILABLE", `Adapter unavailable: ${vendor}`, { cause }),
  adapterTimeout: (vendor: string) =>
    new AppError("ADAPTER_TIMEOUT", `Adapter timeout: ${vendor}`),
  credentialDecrypt: (deviceId: string, cause?: unknown) =>
    new AppError("CREDENTIAL_DECRYPT_FAILED", "Failed to decrypt credentials", {
      details: { deviceId },
      cause,
    }),
  internal: (cause?: unknown) => new AppError("INTERNAL", "Internal error", { cause }),
};
