-- Custom migration (ADR-0061): the application role's privileges, and the two
-- statements that make `audit_events` append-only in the database rather than
-- only in the code (ADR-0058).
--
-- Runs as the **owner** role, which is what `db:migrate` now connects as
-- (ADR-0061 §1). The application role is created outside a migration — by
-- `docker/local/postgres/init/00-roles.sql` locally, by CI's replay of that
-- same directory, and by a deployment's own provisioning — because a role that
-- could create roles would need CREATEROLE, which is most of the privilege
-- this record exists to take away. So this file refuses rather than creates.
--
-- The role NAME is a literal, like every other identifier in a migration. A
-- fork that renames it renames it in the init script, in the four connection
-- strings and here, together.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'machxi_app') THEN
    RAISE EXCEPTION
      'role "machxi_app" does not exist: create the application role before migrating (ADR-0061 §1; docker/local/postgres/init/00-roles.sql locally, `pnpm docker:reset` on a volume that predates it)';
  END IF;
END
$$;--> statement-breakpoint

-- USAGE alone would already be there from the init script; restated because
-- `db:reset` drops the schema and this migration is what rebuilds the grant.
GRANT USAGE ON SCHEMA public TO machxi_app;--> statement-breakpoint

-- Rows, not structure: no CREATE, no ownership, no TRUNCATE, no REFERENCES.
-- TRUNCATE is left out deliberately — a row-level trigger never fires for it,
-- so it is the one statement the append-only pair below cannot stop, and the
-- application role must not hold it. The test harness truncates on the owner's
-- connection for exactly that reason (`truncateAllWithOwner`).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO machxi_app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO machxi_app;--> statement-breakpoint

-- The same privileges for every table a LATER migration creates, so a new
-- table is usable by the API without a grant nobody remembers to write. Scoped
-- to objects created by the role running this statement — the owner — which is
-- the only role that creates any.
--
-- **Every** future table, `audit_events` included: a migration that recreates
-- that table — the sanctioned retention path of ADR-0061 §2 is the obvious one
-- — gets the default grant back and leaves only the trigger standing. Any
-- migration that touches `audit_events` must re-issue the `REVOKE` below.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO machxi_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO machxi_app;--> statement-breakpoint

-- Append-only, half one: the API cannot try (ADR-0061 §2). This has to come
-- after the blanket grant above, which included both.
REVOKE UPDATE, DELETE ON audit_events FROM machxi_app;--> statement-breakpoint

-- Append-only, half two: nobody can, the owner and a psql session included —
-- which is where an accidental `DELETE FROM audit_events WHERE ...` actually
-- comes from. Retention, if a deployment ever wants it, is a deliberate
-- migration that drops this trigger, deletes, and restores it.
CREATE FUNCTION audit_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (ADR-0058, ADR-0061)';
END
$$;--> statement-breakpoint

CREATE TRIGGER audit_events_no_change
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();--> statement-breakpoint

-- And the post-condition: the grants above are actually in force.
--
-- The case this is for is an **existing** database — one that ran 0000-0007
-- under the old superuser and had `machxi_owner` added afterwards, so the
-- schema is the owner's but the tables are not. Measured on PostgreSQL 16
-- (`D14.4`), `GRANT ... ON ALL TABLES` and the `REVOKE` above both raise
-- `permission denied for table users` outright in that state, so the run fails
-- and rolls back before this block is reached — which is the outcome we want
-- and the reason the upgrade path below is documented rather than automated.
--
-- This block is the belt to that pair of braces, and it earns its two lines on
-- the case Postgres does *not* make an error: a grantor holding the grant
-- option on some privileges and not others gets a `WARNING: no privileges were
-- granted` and a commit. That is a partial application, it would journal 0008
-- as applied, and the first symptom would be a `permission denied` from the
-- API with no migration left to re-run.
--
-- The upgrade path either way: `REASSIGN OWNED BY <old admin> TO machxi_owner`
-- in the database, then migrate again (docs/deploy.md step 2).
DO $$
BEGIN
  IF NOT has_table_privilege('machxi_app', 'users', 'SELECT')
     OR NOT has_table_privilege('machxi_app', 'audit_events', 'INSERT')
     OR has_table_privilege('machxi_app', 'audit_events', 'UPDATE') THEN
    RAISE EXCEPTION
      'the grants above did not take: the migrating role does not own the tables in schema public, so GRANT and REVOKE were no-ops (ADR-0061 §1). Run `REASSIGN OWNED BY <the role that created them> TO machxi_owner` in this database and migrate again — see docs/deploy.md.';
  END IF;
END
$$;
