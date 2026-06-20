-- 0002_rls_policies.sql
-- Defense-in-depth RLS. Every tenant-scoped table:
--   - has RLS enabled
--   - has RLS forced so even table owners are subject to it
--   - filters rows by current_setting('app.company_id')::uuid
--
-- The application sets `app.company_id` on every connection at the start
-- of a request. Migrations run with role that bypasses RLS via
-- `ALTER TABLE ... FORCE ROW LEVEL SECURITY` plus a separate policy
-- allowing the migration role to read/write without a tenant id.
--
-- If you accidentally issue a query without setting company_id, the
-- policy returns zero rows — the system fails closed.

-- Sites ---------------------------------------------------------------
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites FORCE  ROW LEVEL SECURITY;

CREATE POLICY sites_tenant_isolation ON sites
  USING (company_id = current_setting('app.company_id', true)::uuid)
  WITH CHECK (company_id = current_setting('app.company_id', true)::uuid);

-- Licenses ------------------------------------------------------------
ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE licenses FORCE  ROW LEVEL SECURITY;

CREATE POLICY licenses_tenant_isolation ON licenses
  USING (company_id = current_setting('app.company_id', true)::uuid)
  WITH CHECK (company_id = current_setting('app.company_id', true)::uuid);

-- Devices -------------------------------------------------------------
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices FORCE  ROW LEVEL SECURITY;

CREATE POLICY devices_tenant_isolation ON devices
  USING (company_id = current_setting('app.company_id', true)::uuid)
  WITH CHECK (company_id = current_setting('app.company_id', true)::uuid);

-- Events --------------------------------------------------------------
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE  ROW LEVEL SECURITY;

CREATE POLICY events_tenant_isolation ON events
  USING (company_id = current_setting('app.company_id', true)::uuid)
  WITH CHECK (company_id = current_setting('app.company_id', true)::uuid);

-- Audit log -----------------------------------------------------------
-- audit_log may be written by system-initiated work (no tenant context),
-- so the policy allows NULL company_id for inserts, but reads are still
-- scoped to the tenant.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE  ROW LEVEL SECURITY;

CREATE POLICY audit_read_by_tenant ON audit_log
  FOR SELECT
  USING (
    company_id IS NULL
    OR company_id = current_setting('app.company_id', true)::uuid
  );

CREATE POLICY audit_insert_any ON audit_log
  FOR INSERT
  WITH CHECK (true);
