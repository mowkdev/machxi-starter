-- Second database for the integration test run (ADR-0021): tests truncate and
-- re-seed on every run, which must never touch the dev database.
--
-- Runs once, as POSTGRES_USER, only on first start of an empty data volume.
-- `docker-entrypoint-initdb.d` cannot see the compose variables from a .sql
-- file, so the name is literal: if you change POSTGRES_DB in .env, change this
-- name and DATABASE_URL_TEST with it, then `pnpm docker:reset`.
--
-- Extensions belong in migration 0000, not here (ADR-0008) — the test database,
-- CI and production all get them from the same migration.
CREATE DATABASE machxi_test;

-- The same two grants 00-roles.sql makes on the dev database (ADR-0061 §1);
-- database privileges are per database, so they cannot be made there.
GRANT CONNECT, CREATE ON DATABASE machxi_test TO machxi_owner;
GRANT CONNECT ON DATABASE machxi_test TO machxi_app;

-- And the same schema ownership, which has to be set from inside the database
-- it applies to. `\c` reconnects as the same user to the new database.
\c machxi_test
ALTER SCHEMA public OWNER TO machxi_owner;
GRANT USAGE ON SCHEMA public TO machxi_app;
