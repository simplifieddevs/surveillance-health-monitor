-- 0001_init.sql
-- Initial schema for surveillance-health-monitor.
-- All tables carry company_id for tenant isolation. RLS policies
-- (0002_rls_policies.sql) are an additional safety net.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- --- enums ----------------------------------------------------------------

CREATE TYPE license_state AS ENUM ('trial','active','expired','suspended');
CREATE TYPE license_tier  AS ENUM ('trial','basic','pro','enterprise');
CREATE TYPE event_severity AS ENUM ('info','warning','error','critical');
CREATE TYPE event_type AS ENUM (
  'device_offline','device_online','auth_failed',
  'recording_lost','recording_resumed',
  'storage_full','storage_warning',
  'channel_lost','channel_restored',
  'firmware_mismatch','config_changed',
  'motion_detected','tamper_detected',
  'video_loss','network_unstable','internal_error'
);
CREATE TYPE device_status AS ENUM ('unknown','online','degraded','offline');
CREATE TYPE vendor        AS ENUM ('onvif','hikvision','dahua','uniview','hanwha','axis');

-- --- companies ------------------------------------------------------------

CREATE TABLE companies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- --- sites ----------------------------------------------------------------

CREATE TABLE sites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  timezone    text NOT NULL DEFAULT 'UTC',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sites_company_idx ON sites (company_id);

-- --- licenses -------------------------------------------------------------

CREATE TABLE licenses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tier        license_tier NOT NULL,
  state       license_state NOT NULL DEFAULT 'trial',
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  seats       integer NOT NULL DEFAULT 0,
  notes       text
);
CREATE INDEX licenses_company_idx ON licenses (company_id);
-- One license in trial-or-active state per company at a time.
CREATE UNIQUE INDEX licenses_company_state_uniq
  ON licenses (company_id)
  WHERE state IN ('trial','active');

-- --- devices --------------------------------------------------------------

CREATE TABLE devices (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  site_id                  uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name                     text NOT NULL,
  vendor                   vendor NOT NULL,
  model                    text,
  firmware_version         text,
  address                  text NOT NULL,
  vendor_config            jsonb NOT NULL DEFAULT '{}'::jsonb,
  credential_cipher        bytea NOT NULL,
  credential_iv            bytea NOT NULL,
  credential_key_version   integer NOT NULL,
  status                   device_status NOT NULL DEFAULT 'unknown',
  last_seen_at             timestamptz,
  poll_cursor              text,
  enabled                  boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX devices_company_idx        ON devices (company_id);
CREATE INDEX devices_company_site_idx   ON devices (company_id, site_id);
CREATE INDEX devices_company_enabled_idx ON devices (company_id, enabled);

-- --- events ---------------------------------------------------------------

CREATE TABLE events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  site_id             uuid NOT NULL,
  device_id           uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  type                event_type NOT NULL,
  severity            event_severity NOT NULL,
  detected_at         timestamptz NOT NULL,
  ingested_at         timestamptz NOT NULL DEFAULT now(),
  raw_payload         jsonb NOT NULL,
  normalized_fields   jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX events_company_detected_idx ON events (company_id, detected_at);
CREATE INDEX events_device_detected_idx  ON events (device_id, detected_at);
CREATE INDEX events_company_type_idx     ON events (company_id, type);

-- Monthly partitions for events are created by a separate migration (0003).

-- --- audit ----------------------------------------------------------------

CREATE TABLE audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid,
  subject_id   text NOT NULL,
  action       text NOT NULL,
  resource     text NOT NULL,
  resource_id  text,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_company_occurred_idx ON audit_log (company_id, occurred_at);
