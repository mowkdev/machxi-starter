import type { Population } from "@repo/contracts";
import { auditEvents, type Db, type DbExecutor } from "@repo/db";

/**
 * The one path into `audit_events` (ADR-0058, ADR-0009).
 *
 * **Insert and nothing else.** ADR-0058's "append-only is a rule of the code,
 * not a word in the name" is this file: there is no update and no delete to
 * call, so no service can hold one, and `packages/config-eslint/api.js` keeps
 * the table itself out of every other layer. The read half is deliberately
 * absent too — v1 has no reader (ADR-0058 §No read surface in v1), and a
 * finder written for the tests alone would be production code with no
 * production caller. An operator reads this table with SQL; the day an
 * `/admin/audit` screen exists is the day a read belongs here.
 *
 * It lives in `core/` rather than in a feature module because the writer is
 * infrastructure every module borrows, like the logger and the context — the
 * events it records belong to the features, the mechanism does not.
 */

/** One row, as the service has already resolved it. */
export interface AuditEventRow {
  readonly occurredAt: Date;
  readonly actorType: Population;
  readonly actorId: string;
  readonly actingAsType: Population | null;
  readonly actingAsId: string | null;
  readonly event: string;
  readonly requestId: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly data: Record<string, unknown> | null;
}

export interface AuditRepository {
  /**
   * Appends one row.
   *
   * `tx` is how the lifecycle discipline works: a caller inside a transaction
   * passes its executor and the row lives or dies with the operation it
   * records. Omitted, the insert is its own statement, which is what the
   * best-effort trail wants.
   */
  readonly insert: (row: AuditEventRow, tx?: DbExecutor) => Promise<void>;
}

export const createAuditRepository = (db: Db): AuditRepository =>
  ({
    insert: async (row, tx = db) => {
      await tx.insert(auditEvents).values(row);
    },
  }) as const;
