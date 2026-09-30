/**
 * The API's view of `@repo/db` (ADR-0009).
 *
 * Repositories import their executor type from here rather than reaching into
 * the package directly, so the one place that would have to change if the ORM
 * or the client factory changed is this file. The schema tables are
 * deliberately **not** re-exported: SQL belongs to repositories, and a lint
 * rule (ADR-0002) keeps table imports out of services and controllers — a
 * convenient re-export here would be a hole in it.
 */
export {
  createDb,
  DEFAULT_APPLICATION_NAME,
  DEFAULT_IDLE_TRANSACTION_TIMEOUT_MS,
  DEFAULT_STATEMENT_TIMEOUT_MS,
  type CreateDbOptions,
  type Db,
  type DbClient,
  type DbExecutor,
  type Transaction,
} from "@repo/db";
export { probeDatabase, type ProbeDatabaseOptions } from "./probe.js";
export {
  createTransaction,
  DEFAULT_TRANSACTION_ATTEMPTS,
  isDeadlock,
  PG_DEADLOCK_DETECTED,
  type CreateTransactionDeps,
} from "./transaction.js";
