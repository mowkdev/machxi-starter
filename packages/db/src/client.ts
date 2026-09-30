import { sql as raw } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema/index.js";

/**
 * The database client (ADR-0006).
 *
 * There is **no singleton**: the API builds one at startup from its validated
 * config (ADR-0004) and passes it down through the container (ADR-0009), while
 * migrations, seeds and tests each open their own. A module-level connection
 * would be opened by the act of importing a repository, which makes unit tests
 * reach for the network and gives the process no way to close cleanly.
 */

export interface CreateDbOptions {
  /** Pool size; the API passes `DB_POOL_MAX` (ADR-0004). Default 10. */
  max?: number;
  /**
   * Seconds a connection may sit idle before the driver closes it. Default 0
   * (never), which is what a long-lived API server wants; short-lived scripts
   * pass a small value so the process can exit.
   */
  idleTimeout?: number;
  /**
   * Seconds to wait for a connection to be established. Default 10 — long
   * enough for a container that is still starting, short enough that a wrong
   * host fails the startup probe rather than hanging it (ADR-0003).
   */
  connectTimeout?: number;
  /**
   * Disables the prepared-statement cache. Required behind a transaction-mode
   * pooler (PgBouncer, Supabase's 6543 port), where a prepared statement does
   * not survive to the next query on the same logical connection.
   *
   * The API passes `DB_PREPARED_STATEMENTS` (ADR-0061 §3); before that this
   * option had no call site and no variable behind it, which meant the pooler
   * it was written for could not actually be used.
   */
  noPreparedStatements?: boolean;
  /**
   * `statement_timeout`, in milliseconds; `0` disables it (ADR-0061 §3).
   *
   * Set on the *connection*, so every session in the pool carries it and no
   * query has to remember. Without one, a pathological query holds a
   * connection until the driver gives up, which at `DB_POOL_MAX` of them is an
   * outage. The default is high enough that tripping it means something is
   * wrong rather than that something is slow.
   *
   * The CLI entry points that run DDL pass `0` explicitly: a migration is a
   * long statement by nature, and an API-shaped bound would eventually cancel
   * one halfway.
   */
  statementTimeoutMs?: number;
  /**
   * `idle_in_transaction_session_timeout`, in milliseconds; `0` disables it.
   *
   * The other half of the bound above: a transaction left open by a crashed
   * handler holds its locks and pins `xmin`, so autovacuum stops reclaiming
   * rows database-wide. Postgres cancels the session instead.
   */
  idleTransactionTimeoutMs?: number;
  /**
   * `application_name` — what `pg_stat_activity` shows for these sessions.
   *
   * Free, and the difference between "some connection is blocking" and "the
   * API is blocking" at the moment someone is looking (ADR-0061 §3).
   */
  applicationName?: string;
  /**
   * What to do with a server notice. Default: discard.
   *
   * The default is right for the API — logging belongs to the caller's logger
   * (ADR-0005), and postgres.js would otherwise print to stdout. It is wrong
   * for the migration runner, where a notice is sometimes the only channel a
   * partial result has: a `GRANT` whose grantor holds the grant option on some
   * privileges and not others commits with
   * `WARNING: no privileges were granted`, and a discarded notice makes that
   * indistinguishable from a clean run (ADR-0061 §1).
   */
  onNotice?: (notice: { message?: string }) => void;
  /**
   * Seconds before the driver retires a connection; `0` is never. Unset keeps
   * postgres.js's own default, a random 30 to 60 minutes, which is right for a
   * pool.
   *
   * The migration runner passes `0`: its advisory lock belongs to the one
   * session that took it, and a connection retired between two statements of
   * a long run would carry on unlocked on a fresh session.
   */
  maxLifetime?: number;
}

/**
 * The default `statement_timeout`, in milliseconds (ADR-0061 §3).
 *
 * Thirty seconds: an order of magnitude above the slowest query this
 * repository has (a seeded list page answers in single-digit milliseconds) and
 * well inside any reverse proxy's own timeout, so it fires on the query that
 * is wrong rather than on the one that is merely large. A deployment that
 * disagrees sets `DB_STATEMENT_TIMEOUT_MS`, and `0` turns it off.
 */
export const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

/** The default `idle_in_transaction_session_timeout`, in milliseconds. */
export const DEFAULT_IDLE_TRANSACTION_TIMEOUT_MS = 60_000;

/** The default `application_name`, overridden by the API's `DB_APPLICATION_NAME`. */
export const DEFAULT_APPLICATION_NAME = "machxi";

const createDrizzle = (sql: postgres.Sql) =>
  // `casing: 'snake_case'` is what lets every column be declared as
  // `firstName: text()` and stored as `first_name` (ADR-0006) — the physical
  // name is derived, never spelled twice.
  drizzle(sql, { schema, casing: "snake_case" });

/** The Drizzle instance: what repositories run their queries on. */
export type Db = ReturnType<typeof createDrizzle>;

/** The transaction handle passed to `db.transaction(async (tx) => …)`. */
export type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Whatever a repository may run a query on. Repositories take an optional
 * executor so a service can compose several of them atomically (ADR-0006);
 * outside a transaction it is the `Db` itself.
 */
export type DbExecutor = Db | Transaction;

export const createDb = (url: string, options: CreateDbOptions = {}) => {
  const {
    max = 10,
    idleTimeout = 0,
    connectTimeout = 10,
    noPreparedStatements = false,
    statementTimeoutMs = DEFAULT_STATEMENT_TIMEOUT_MS,
    idleTransactionTimeoutMs = DEFAULT_IDLE_TRANSACTION_TIMEOUT_MS,
    applicationName = DEFAULT_APPLICATION_NAME,
    onNotice,
    maxLifetime,
  } = options;

  const sql = postgres(url, {
    max,
    idle_timeout: idleTimeout,
    connect_timeout: connectTimeout,
    prepare: !noPreparedStatements,
    // Session parameters, applied by postgres.js on every connection it opens
    // — including the ones it opens to replace a closed idle connection
    // (ADR-0061 §3). A `SET` issued once after connecting would cover the
    // first connection of the pool and no other.
    //
    // Bare numbers, which is what both GUCs read as milliseconds.
    connection: {
      statement_timeout: statementTimeoutMs,
      idle_in_transaction_session_timeout: idleTransactionTimeoutMs,
      application_name: applicationName,
    },
    // postgres.js prints connection notices to stdout unless told otherwise;
    // logging belongs to the caller's logger (ADR-0005), not to the driver.
    // A caller that wants them — the migration runner does, see `onNotice` —
    // says so.
    onnotice: onNotice ?? (() => undefined),
    // Only when stated: postgres.js reads a present key, even one holding
    // `undefined`, in place of its default.
    ...(maxLifetime === undefined ? {} : { max_lifetime: maxLifetime }),
  });

  const db = createDrizzle(sql);

  return {
    db,
    sql,
    /**
     * `SELECT 1`. Used by the startup probe, which refuses to bind the port if
     * it fails (ADR-0003), and by `GET /health/ready` (ADR-0016). It rejects —
     * it does not return a boolean — so the caller can log the driver's own
     * error rather than a flattened "database unreachable".
     */
    ping: async (): Promise<void> => {
      await db.execute(raw`select 1`);
    },
    /** Closes the pool. `end()` waits for in-flight queries to finish. */
    close: async (): Promise<void> => {
      await sql.end();
    },
  } as const;
};

/** What `createDb` hands back: the client plus its lifecycle functions. */
export type DbClient = ReturnType<typeof createDb>;
