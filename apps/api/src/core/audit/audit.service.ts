import type { Population } from "@repo/contracts";

import type { DbExecutor } from "../db/index.js";
import { internal } from "../errors/index.js";
import type { Principal, RequestContext } from "../context/index.js";
import type { AuditRepository } from "./audit.repository.js";

/**
 * The audit writer (ADR-0058).
 *
 * Container-wired, `ctx` first, so every row inherits the request it happened
 * on — `requestId`, ip and user agent — without a caller remembering to pass
 * them. Two write disciplines, chosen per call site, and the choice is the
 * whole of the API:
 *
 * - {@link Audit.record} is **transactional**: it is awaited, it throws, and
 *   it takes the caller's executor. An impersonation mint that cannot be
 *   audited does not happen.
 * - {@link Audit.trail} is **best-effort**: it returns nothing, never throws,
 *   and logs at `error` when the insert fails. It is for the rows written
 *   behind a response that has already succeeded, where failing the request
 *   would be the worse outcome; the completion log line still carries both
 *   identities, so a lost trail row degrades to the logs rather than to
 *   nothing.
 */

/** One end of an audit row: a population and an id, never a resource. */
export interface AuditIdentity {
  readonly type: Population;
  readonly id: string;
}

/**
 * Who the row is about, in ADR-0058's terms: the human, and the account they
 * were acting as when the two differ.
 */
export interface AuditIdentities {
  readonly actor: AuditIdentity;
  readonly actingAs?: AuditIdentity | undefined;
}

export interface AuditEntry {
  /** Dot-namespaced, and defined beside its writer — never in `@repo/contracts`. */
  readonly event: string;
  /**
   * Supplied instead of deriving from `ctx.principal`.
   *
   * Required where there is no principal to derive from: `impersonation.
   * exchanged` is served on an unauthenticated route — the handoff token is
   * the credential — so both identities come off the consumed handoff row and
   * never off the context (ADR-0058).
   */
  readonly identities?: AuditIdentities;
  /** Event-specific facts, small by convention. Never a credential. */
  readonly data?: Record<string, unknown>;
}

/**
 * The identity mapping, by human rather than by principal shape (ADR-0058).
 *
 * **Getting this backwards is the failure this function exists to prevent.**
 * Under impersonation the *actor* is the staff member who chose to act and the
 * *acting-as* is the customer whose account served the request. A builder who
 * maps `ctx.principal` straight onto `actor` writes the inverse, and the one
 * query an incident actually runs — "everything this staff member did" —
 * returns nothing at all.
 *
 * **The branch arrived at `D13.5`**, which is what the trip wire that used to
 * stand here (`ACTOR_BRANCH_PENDING`, written at `D13.2` and re-pointed at
 * `D13.3`) existed to force: `impersonatedBy` is now on the customer shape of
 * `Principal`, the wire failed `pnpm check-types` exactly as designed, and it
 * was deleted in the same step that grew the branch below. This function is
 * still the single place the mapping is made.
 */
export const identitiesFromPrincipal = (
  principal: Principal,
): AuditIdentities =>
  principal.kind === "user" && principal.impersonatedBy !== undefined
    ? {
        // The human who chose to act, and the account that served the request.
        // Not the other way round, whatever `ctx.principal` looks like.
        actor: { type: "staff", id: principal.impersonatedBy },
        actingAs: { type: "user", id: principal.id },
      }
    : { actor: { type: principal.kind, id: principal.id } };

export interface Audit {
  /**
   * Appends a lifecycle row, transactionally with the operation it records.
   *
   * @throws when the row cannot be attributed — no `identities` and no
   *   principal on the context — or when the insert fails. Both are the
   *   caller's transaction rolling back, which is the point.
   */
  readonly record: (
    ctx: RequestContext,
    entry: AuditEntry,
    tx?: DbExecutor,
  ) => Promise<void>;
  /**
   * Appends a trail row behind a response that has already been decided.
   *
   * Returns nothing and never rejects: the write is dispatched and its failure
   * is logged. Deliberately not `Promise<void>` — a signature a caller could
   * `await` would invite exactly the "just make it transactional" edit this
   * discipline exists to refuse.
   */
  readonly trail: (ctx: RequestContext, entry: AuditEntry) => void;
}

/**
 * The same cap `sessions` puts on the header (`MAX_USER_AGENT_LENGTH` in the
 * auth service), restated rather than imported: `core/` must not reach into
 * `modules/` (ADR-0009). The header is attacker-controlled and unbounded, and
 * this is the one table nothing ever prunes.
 */
const MAX_AUDIT_USER_AGENT_LENGTH = 512;

/**
 * What a failed insert may be logged as.
 *
 * Drizzle wraps a query failure in an error whose message is
 * `Failed query: … \nparams: …` and whose own properties carry the same — and
 * the params of *this* insert are the audit row, `data` included. Redaction
 * does not reach pino's `err` serialiser (`packages/logger` says so in its own
 * doc comment), so the whole row would be printed. The head of the message
 * names the failed statement and nothing it carried.
 */
const describeFailure = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);

  return message.split("\nparams:")[0] ?? "";
};

export interface CreateAuditDeps {
  readonly repository: AuditRepository;
}

export const createAudit = ({ repository }: CreateAuditDeps): Audit => {
  const resolve = (
    ctx: RequestContext,
    entry: AuditEntry,
  ): AuditIdentities | undefined => {
    const identities =
      entry.identities ??
      (ctx.principal === null
        ? undefined
        : identitiesFromPrincipal(ctx.principal));

    if (identities === undefined) return undefined;

    // ADR-0058 sets acting-as "only when the two differ", and that is an
    // invariant of the row rather than a duty of the call site: a caller
    // passing the same identity twice would otherwise write a row claiming an
    // impersonation that never happened.
    const { actor, actingAs } = identities;

    return actingAs !== undefined &&
      actingAs.type === actor.type &&
      actingAs.id === actor.id
      ? { actor }
      : identities;
  };

  const write = async (
    ctx: RequestContext,
    entry: AuditEntry,
    identities: AuditIdentities,
    tx?: DbExecutor,
  ): Promise<void> => {
    await repository.insert(
      {
        // Stamped here rather than left to the column default: `now()` in
        // Postgres is the *transaction's* start, so a lifecycle row written
        // late in a long transaction would claim to have happened before the
        // thing it records.
        occurredAt: new Date(),
        actorType: identities.actor.type,
        actorId: identities.actor.id,
        actingAsType: identities.actingAs?.type ?? null,
        actingAsId: identities.actingAs?.id ?? null,
        event: entry.event,
        requestId: ctx.requestId,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent?.slice(0, MAX_AUDIT_USER_AGENT_LENGTH) ?? null,
        data: entry.data ?? null,
      },
      tx,
    );
  };

  return {
    record: async (ctx, entry, tx) => {
      const identities = resolve(ctx, entry);

      if (identities === undefined) {
        // Loud, not an anonymous row. An unattributable audit row is worse
        // than none: it is a record that answers the only question the table
        // is ever asked with "somebody".
        throw internal(
          new Error(
            `audit.record("${entry.event}") has no actor: pass identities, or call it where ctx.principal is set (ADR-0058).`,
          ),
        );
      }

      await write(ctx, entry, identities, tx);
    },

    trail: (ctx, entry) => {
      const identities = resolve(ctx, entry);

      if (identities === undefined) {
        ctx.logger.error(
          { event: entry.event },
          "audit trail row has no actor",
        );

        return;
      }

      // `void` because the response is already on its way out: the request
      // does not wait for this insert and does not fail with it.
      void write(ctx, entry, identities).catch((error: unknown) => {
        // Both identities on the line, not just the event. ADR-0058's fallback
        // is "the trail degrades to the logs rather than to nothing", and a
        // line naming only the event degrades to neither — an operator could
        // not tell an unaudited mutation from an audited one.
        ctx.logger.error(
          {
            event: entry.event,
            actor: identities.actor,
            actingAs: identities.actingAs ?? null,
            error: describeFailure(error),
          },
          "audit trail write failed",
        );
      });
    },
  } as const;
};
