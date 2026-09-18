import { federatedIdentities, type DbExecutor } from "@repo/db";
import type { FederatedProvider } from "@repo/contracts";
import { and, asc, eq, gt, inArray } from "drizzle-orm";

/**
 * Every query against `federated_identities` (ADR-0009, ADR-0072).
 *
 * Split out of `users.repository.ts` at `D20.7` and nothing else changed: the
 * family is one table, reached by one module, and `createUsersRepository`
 * spreads it back in so `repository.identitiesOf(…)` still names the same
 * function to every caller. The account's own rows — including the
 * `softDelete` that removes every identity with them, and the `lockById` both
 * resets take before they act — stay with `users`, because they are statements
 * about that table.
 */

/**
 * One external identity linked to an account, as the account's resources
 * carry it (ADR-0072 §3).
 *
 * The provider's `subject` is deliberately not on it: it is the key a sign-in
 * resolves by and nothing a reader of an account needs. It never leaves
 * {@link UsersRepository.findIdentityBySubject}.
 */
export interface IdentityRecord {
  readonly userId: string;
  readonly provider: FederatedProvider;
  readonly email: string | null;
  readonly linkedAt: Date;
}

/** What linking writes (ADR-0072 §1, §3). */
export interface NewIdentityInput {
  readonly userId: string;
  readonly provider: FederatedProvider;
  readonly subject: string;
  /** The address the provider reported, informational only; `null` when it reported none. */
  readonly email: string | null;
  readonly at: Date;
}

export const createUserIdentitiesRepository = (db: DbExecutor) =>
  ({
    /**
     * The identities linked to each of these accounts (ADR-0072 §3), for the
     * resources that carry them — `/user/profile`, `me` and the admin's user
     * resource.
     *
     * One statement for a whole page rather than one per row, and a separate
     * statement rather than a relation on the aggregate read: the aggregate
     * read is also the principal lookup behind every login and refresh, and
     * neither of those needs to know which ways in an account has. It reads
     * `federated_identities_user_id_provider_unique`, which leads with the
     * reference.
     */
    identitiesOf: async (
      userIds: readonly string[],
      tx: DbExecutor = db,
    ): Promise<readonly IdentityRecord[]> => {
      // `inArray(column, [])` is not a no-op in SQL, and an empty page has
      // nothing to look up anyway.
      if (userIds.length === 0) return [];

      return tx
        .select({
          userId: federatedIdentities.userId,
          provider: federatedIdentities.provider,
          email: federatedIdentities.email,
          linkedAt: federatedIdentities.linkedAt,
        })
        .from(federatedIdentities)
        .where(inArray(federatedIdentities.userId, [...userIds]))
        .orderBy(
          asc(federatedIdentities.provider),
          asc(federatedIdentities.linkedAt),
        );
    },

    /**
     * The first question a sign-in asks (ADR-0072 §1): which account, if any,
     * this provider's subject is a way into.
     *
     * By (`provider`, `subject`) and nothing else — whatever address either
     * side carries today. No `deleted_at` filter is needed on the account:
     * deletion deletes the identities in the same transaction
     * ({@link UsersRepository.softDelete}), so an identity always names a live
     * row. The caller reads that row through the aggregate read it already
     * uses, which is also what refuses the case if that ever stops being true.
     */
    findIdentityBySubject: async (
      provider: FederatedProvider,
      subject: string,
      tx: DbExecutor = db,
    ): Promise<{ readonly id: string; readonly userId: string } | undefined> =>
      tx.query.federatedIdentities.findFirst({
        columns: { id: true, userId: true },
        where: and(
          eq(federatedIdentities.provider, provider),
          eq(federatedIdentities.subject, subject),
        ),
      }),

    /**
     * Links an identity to an account (ADR-0072 §1, §3), or resolves to
     * `false` when either uniqueness already holds it — the subject is
     * another account's, or this account already has an identity of this
     * provider.
     *
     * `onConflictDoNothing` with no target, so **both** constraints answer
     * `false` rather than a unique violation the error handler would turn into
     * a `409` on a route whose every answer must be a redirect. Neither
     * conflict is something to retry: the caller refuses.
     */
    linkIdentity: async (
      input: NewIdentityInput,
      tx: DbExecutor = db,
    ): Promise<boolean> => {
      const inserted = await tx
        .insert(federatedIdentities)
        .values({
          userId: input.userId,
          provider: input.provider,
          subject: input.subject,
          email: input.email,
          // `linked_at` is the **database's** `now()`, not `input.at`
          // (`D19.5`'s `security-reviewer`): a session-minted reset compares
          // it with `sessions.created_at`, which the database stamps too
          // (ADR-0072 §3, amended after `D19.4`), and two clocks would let
          // a skewed API host misorder a link and a session.
          createdAt: input.at,
          updatedAt: input.at,
        })
        .onConflictDoNothing()
        .returning({ id: federatedIdentities.id });

      return inserted.length > 0;
    },

    /**
     * `DELETE /api/v1/user/profile/identities/:provider` — the owner removing
     * one way in (ADR-0072 §3). By (`user_id`, `provider`), which is the
     * second unique constraint and so at most one row.
     *
     * @returns `false` when the account had no identity of that provider.
     */
    unlinkIdentity: async (
      userId: string,
      provider: FederatedProvider,
      tx: DbExecutor = db,
    ): Promise<boolean> => {
      const removed = await tx
        .delete(federatedIdentities)
        .where(
          and(
            eq(federatedIdentities.userId, userId),
            eq(federatedIdentities.provider, provider),
          ),
        )
        .returning({ id: federatedIdentities.id });

      return removed.length > 0;
    },

    /**
     * Every identity of the account, removed on the caller's executor — what a
     * password written without the account's own authority does (ADR-0072 §3,
     * amended): the reset by mail and the administrative reset.
     *
     * **`linkedAfter` narrows it to the identities linked later than that
     * instant** — the session-minted reset's rule (§3, amended after `D19.4`):
     * whatever joined the account after the session that asked for the link
     * began goes, and what is older stays. Omitted, every identity goes.
     *
     * Returns the providers removed, one per row, so the caller writes one
     * `account.identity_unlinked` row each; the subjects never leave this
     * layer. `softDelete` above is the other statement that removes them all.
     */
    unlinkIdentities: async (
      userId: string,
      tx: DbExecutor = db,
      linkedAfter?: Date,
    ): Promise<readonly FederatedProvider[]> => {
      const removed = await tx
        .delete(federatedIdentities)
        .where(
          and(
            eq(federatedIdentities.userId, userId),
            linkedAfter === undefined
              ? undefined
              : gt(federatedIdentities.linkedAt, linkedAfter),
          ),
        )
        .returning({ provider: federatedIdentities.provider });

      return removed.map((row) => row.provider);
    },

    /**
     * A sign-in through an identity that was already linked (ADR-0072 §1).
     *
     * @returns `false` when the row is gone — removed by a reset that
     * committed after the sign-in found it (`D19.5`'s `security-reviewer`),
     * which the caller refuses rather than minting a way in the reset took.
     */
    touchIdentityLogin: async (
      id: string,
      at: Date,
      tx: DbExecutor = db,
    ): Promise<boolean> => {
      const touched = await tx
        .update(federatedIdentities)
        .set({ lastLoginAt: at, updatedAt: at })
        .where(eq(federatedIdentities.id, id))
        .returning({ id: federatedIdentities.id });

      return touched.length > 0;
    },
  }) as const;

export type UserIdentitiesRepository = ReturnType<
  typeof createUserIdentitiesRepository
>;
