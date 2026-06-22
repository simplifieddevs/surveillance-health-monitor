-- Dev seed: insert the fixed company used by DISABLE_AUTH=true mode.
-- Safe to run in production — the WHERE NOT EXISTS guard makes it a no-op
-- if auth is properly configured and a real company already exists.
INSERT INTO companies (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Demo Company')
ON CONFLICT (id) DO NOTHING;
