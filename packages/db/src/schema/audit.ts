import {
  index,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { auditActorTypeEnum, primaryId } from "./_shared.js";

/**
 * The append-only audit log (ADR-0058).
 *
 * One row per audited thing that happened: who did it, which account it was
 * done as, what it was, and the request it arrived on. Logs answer "what is
 * happening" and are rotated away; this table answers "what happened" and
 * survives, which is the whole reason the operator chose a table over
 * structured logs alone at D13's scoping.
 *
 * **No foreign keys, deliberately.** An audit row must outlive the hard
 * deletion of its actor (staff, ADR-0028) and of its subject, or the log
 * un-writes itself exactly when an incident needs it. That is a stronger
 * version of the reason `sessions` carries none: sessions *could* not have one
 * because Postgres cannot express a polymorphic reference, and this table
 * *must* not have one even where it could.
 *
 * **Append-only is a rule of the code, not a word in the name**: the
 * repository in `apps/api/src/core/audit` exposes an insert and nothing else,
 * no service holds an update or a delete path, and `db:*` tooling does not
 * prune it — retention is a deployment decision (ADR-0058 §Consequences), not
 * a job this schema ships.
 */

export const auditEvents = pgTable(
  "audit_events",
  {
    // UUIDv7, so `order by id` is `order by time` and the index grows at its
    // right edge — the property that matters most on the one table in this
    // schema that only ever gains rows.
    id: primaryId(),
    /**
     * The row's one time, and the reason `timestamps()` is not spread here:
     * `updated_at` on an append-only table is a contradiction — there is no
     * update path for it to record — and a `created_at` beside this column
     * would be two names for one instant with nothing keeping them equal.
     */
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /**
     * The human driving the request — the staff member when the principal is
     * impersonating (ADR-0057 §4), the principal itself otherwise. Never the
     * principal shape blindly: see `audit.service.ts`, which is where that
     * mapping is made and where writing it inverted would hide a staff
     * member's actions behind the customer they were acting as.
     */
    actorType: auditActorTypeEnum().notNull(),
    actorId: uuid().notNull(),
    /** The account the request ran as, set **only** when it differs from the actor. */
    actingAsType: auditActorTypeEnum(),
    actingAsId: uuid(),
    /**
     * Dot-namespaced, e.g. `impersonation.minted`. `text`, not an enum: the
     * names live with their writers in `apps/api` (ADR-0058), because no
     * client reads them in v1 and a contracts enum for server-only vocabulary
     * is the altitude mistake ADR-0050 names. The day an admin screen lists
     * these events is the day they cross the wire and earn a contracts home.
     */
    event: text().notNull(),
    /** Joins the row to the request logs (ADR-0010); null for non-HTTP writers. */
    requestId: text(),
    /** `inet` so a v6 address needs no widening later, as on `sessions`. */
    ip: inet(),
    userAgent: text(),
    /** Event-specific facts, small by convention. Never a credential. */
    data: jsonb().$type<Record<string, unknown>>(),
  },
  (table) => [
    // "Everything this person did, most recent first" — the query an incident
    // actually runs, and the reason `occurred_at` is the third column rather
    // than an index of its own.
    index("audit_events_actor_idx").on(
      table.actorType,
      table.actorId,
      table.occurredAt,
    ),
    // "Every mint, ever" — the same question asked of one kind of event.
    index("audit_events_event_idx").on(table.event, table.occurredAt),
  ],
);
