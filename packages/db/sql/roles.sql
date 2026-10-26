-- Optional least-privilege roles (PRD §7.2). Run once as the database owner, then point each service
-- at its own role via DATABASE_URL_WEB / DATABASE_URL_EXECUTOR. The append-only trigger holds either way.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'web_rw') THEN CREATE ROLE web_rw LOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'executor_rw') THEN CREATE ROLE executor_rw LOGIN; END IF;
END $$;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO web_rw, executor_rw;
GRANT INSERT ON audit_log TO web_rw, executor_rw;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM web_rw, executor_rw;

-- web: intake, approvals, sessions, owner data. No attempt writes.
GRANT INSERT, UPDATE ON payment_intents, approvals, sessions, users, agents, telegram_links, mandates, payees, webhook_events TO web_rw;
-- executor: attempts, intent status, balances, approvals it consumes or voids.
GRANT INSERT, UPDATE ON attempts, payment_intents, approvals, balance_snapshots, webhook_events TO executor_rw;
