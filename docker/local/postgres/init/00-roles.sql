-- The two roles the repository connects as (ADR-0061 §1).
--
-- Runs once, as POSTGRES_USER, on first start of an empty data volume — the
-- same rule 01-test-db.sql states, and the same one-time cost: a tree that
-- predates ADR-0061 needs `pnpm docker:reset` (or these statements by hand)
-- before `pnpm db:setup` will work.
--
--   machxi_owner  runs DDL: db:migrate, db:seed, db:reset, drizzle-kit, and
--                 the integration harness's migrateFreshDatabase.
--   machxi_app    is what the API connects as: table privileges only, granted
--                 by migration 0008 — no DDL, no ownership, no superuser, and
--                 no UPDATE or DELETE on audit_events.
--
-- The compose superuser (POSTGRES_USER) stays what it is: the role that
-- created the cluster and the one you reach for when something is wrong. It is
-- deliberately no longer what anything in this repository connects as.
--
-- Names are literal, exactly as in 01-test-db.sql and for the same reason:
-- `docker-entrypoint-initdb.d` cannot see the compose variables from a .sql
-- file. Renaming a role means renaming it here, in the four connection strings
-- in .env(.example), and in migration 0008 — together.
--
-- Passwords match the role names, like POSTGRES_PASSWORD matches POSTGRES_USER
-- in .env.example: this file describes a database that answers on localhost
-- and holds fixtures. A deployment provisions its own roles and its own
-- secrets; see docs/deploy.md.
CREATE ROLE machxi_owner LOGIN PASSWORD 'machxi_owner';
CREATE ROLE machxi_app LOGIN PASSWORD 'machxi_app';

-- CREATE on the database, because `db:reset` drops schema `public` and creates
-- it again; CONNECT is granted to PUBLIC by default and is restated so that a
-- fork tightening the default finds both halves in one place.
GRANT CONNECT, CREATE ON DATABASE machxi TO machxi_owner;
GRANT CONNECT ON DATABASE machxi TO machxi_app;

-- The owner owns the schema, which is what lets it drop and recreate it and
-- what makes every table a migration creates owned by a role that is not a
-- superuser — the precondition for the row-level security ADR-0067 designs.
ALTER SCHEMA public OWNER TO machxi_owner;

-- USAGE only. Table privileges arrive with migration 0008, which is also where
-- ALTER DEFAULT PRIVILEGES makes them apply to every table a later migration
-- creates. A `db:reset` drops this grant with the schema; the migration that
-- follows it puts both back.
GRANT USAGE ON SCHEMA public TO machxi_app;
