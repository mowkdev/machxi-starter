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
   */
  noPreparedStatements?: boolean;
}

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
  } = options;

  const sql = postgres(url, {
    max,
    idle_timeout: idleTimeout,
    connect_timeout: connectTimeout,
    prepare: !noPreparedStatements,
    // postgres.js prints connection notices to stdout unless told otherwise;
    // logging belongs to the caller's logger (ADR-0005), not to the driver.
    onnotice: () => undefined,
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
