import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  primaryKey,
  pgEnum,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Drizzle schema — mirrors src/db/migrations/0001_init.sql exactly.
 * Keep these two files in sync; migrations are authoritative at runtime.
 */

// --- enums ----------------------------------------------------------------

export const licenseStateEnum = pgEnum("license_state", [
  "trial",
  "active",
  "expired",
  "suspended",
]);

export const licenseTierEnum = pgEnum("license_tier", [
  "trial",
  "basic",
  "pro",
  "enterprise",
]);

export const eventSeverityEnum = pgEnum("event_severity", [
  "info",
  "warning",
  "error",
  "critical",
]);

export const eventTypeEnum = pgEnum("event_type", [
  "device_offline",
  "device_online",
  "auth_failed",
  "recording_lost",
  "recording_resumed",
  "storage_full",
  "storage_warning",
  "channel_lost",
  "channel_restored",
  "firmware_mismatch",
  "config_changed",
  "motion_detected",
  "tamper_detected",
  "video_loss",
  "network_unstable",
  "internal_error",
]);

export const deviceStatusEnum = pgEnum("device_status", [
  "unknown",
  "online",
  "degraded",
  "offline",
]);

export const vendorEnum = pgEnum("vendor", [
  "onvif",
  "hikvision",
  "dahua",
  "uniview",
  "hanwha",
  "axis",
]);

// bytea helper — Drizzle's built-in is fine but we want explicit naming.
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

// --- companies ------------------------------------------------------------

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- sites ----------------------------------------------------------------

export const sites = pgTable(
  "sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCompany: index("sites_company_idx").on(t.companyId),
  }),
);

// --- licenses -------------------------------------------------------------

export const licenses = pgTable(
  "licenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    tier: licenseTierEnum("tier").notNull(),
    state: licenseStateEnum("state").notNull().default("trial"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    seats: integer("seats").notNull().default(0),
    notes: text("notes"),
  },
  (t) => ({
    byCompany: index("licenses_company_idx").on(t.companyId),
    // One active or trial license per company at a time; expired/suspended
    // are kept for audit but a new one supersedes them.
    byCompanyState: uniqueIndex("licenses_company_state_uniq")
      .on(t.companyId)
      .where(sql`state in ('trial','active')`),
  }),
);

// --- devices --------------------------------------------------------------

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    vendor: vendorEnum("vendor").notNull(),
    model: text("model"),
    firmwareVersion: text("firmware_version"),
    /** Network address; opaque to us — vendor adapters parse per-protocol. */
    address: text("address").notNull(),
    /** Free-form vendor-specific configuration (channel count, RTSP URL template, etc.). */
    vendorConfig: jsonb("vendor_config").notNull().default(sql`'{}'::jsonb`),
    /** Encrypted credentials. Schema: EncryptedCredential. */
    credentialCipher: bytea("credential_cipher").notNull(),
    credentialIv: bytea("credential_iv").notNull(),
    credentialKeyVersion: integer("credential_key_version").notNull(),
    status: deviceStatusEnum("status").notNull().default("unknown"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    /** Cursor returned by the last successful adapter pull. Opaque to core. */
    pollCursor: text("poll_cursor"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCompany: index("devices_company_idx").on(t.companyId),
    byCompanySite: index("devices_company_site_idx").on(t.companyId, t.siteId),
    byCompanyEnabled: index("devices_company_enabled_idx").on(t.companyId, t.enabled),
  }),
);

// --- events ---------------------------------------------------------------

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").notNull(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    type: eventTypeEnum("type").notNull(),
    severity: eventSeverityEnum("severity").notNull(),
    /** Vendor-supplied wall-clock time. */
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
    /** Time we ingested. Useful when vendor clocks drift. */
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
    /** Sanitized vendor payload. NEVER contains credentials. */
    rawPayload: jsonb("raw_payload").notNull(),
    /** Canonical, queryable fields. Shape depends on event type. */
    normalizedFields: jsonb("normalized_fields").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => ({
    byCompanyDetected: index("events_company_detected_idx").on(t.companyId, t.detectedAt),
    byDeviceDetected: index("events_device_detected_idx").on(t.deviceId, t.detectedAt),
    byCompanyType: index("events_company_type_idx").on(t.companyId, t.type),
  }),
);

// --- audit ----------------------------------------------------------------

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id"),
    subjectId: text("subject_id").notNull(),
    action: text("action").notNull(),
    resource: text("resource").notNull(),
    resourceId: text("resource_id"),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCompanyOccurred: index("audit_company_occurred_idx").on(t.companyId, t.occurredAt),
  }),
);

// Re-export the SQL helper for migrations.
export { sql };
