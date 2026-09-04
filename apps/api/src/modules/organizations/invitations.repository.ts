import type { OrganizationRole } from "@repo/contracts";
import {
  organizationInvitations,
  organizations,
  type DbExecutor,
} from "@repo/db";
import { and, desc, eq, exists, gt, isNull, sql } from "drizzle-orm";

/**
 * Every query against `organization_invitations` (ADR-0009).
 *
 * Tenant-owned (ADR-0067 §1), so the organization id is the first, required
 * parameter of every function that reads or writes one organization's
 * invitations. {@link createInvitationsRepository.listPendingForEmail} is the
 * sanctioned exception and the second instance of the class ADR-0067 §5 names:
 * a read scoped by the **principal** — here their address — rather than by a
 * tenant, because an invitee asking "who has invited me?" does not yet know
 * which organizations are involved. It is served by
 * `organization_invitations_email_idx` and is named here for what it is.
 *
 * **No function here returns `token_hash`, and none can.** The column is not
 * in {@link InvitationRecord} and is not selected by any read, which is a
 * stronger guarantee than a mapper that remembers to drop it: there is no
 * value for a mapper to leak (ADR-0067 §2, amended 2026-09-04). The one
 * function that touches it takes a hash and returns a row without one.
 *
 * The invitations module core lands here at `D15.2`; its routes, schemas and
 * controller are `D15.3`'s, which is also where the create path starts minting
 * the token this table stores the digest of.
 */

/**
 * An invitation row — every column except `token_hash`.
 *
 * There is no `status`: the row's state is its timestamps (ADR-0067 §2,
 * amended at `D15.1`), because `expired` becomes true as a clock passes and no
 * column can hold a fact nothing writes. The mapper folds these four into the
 * wire's `InvitationStatus`.
 */
export interface InvitationRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly role: OrganizationRole;
  readonly invitedBy: string;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly declinedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** What creating an invitation writes, the tenant apart. */
export interface NewInvitationInput {
  readonly email: string;
  /**
   * Narrowed to the invitable roles by the zod schema and by
   * `organization_invitations_role_not_owner` in the database: `owner` is
   * granted to an existing member and never invited (ADR-0067 §2).
   */
  readonly role: OrganizationRole;
  readonly invitedBy: string;
  /** SHA-256, base64url, of a `randomToken()` the caller has already minted. */
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

/** Every column but the digest — see the note on {@link InvitationRecord}. */
const recordColumns = {
  id: true,
  organizationId: true,
  email: true,
  role: true,
  invitedBy: true,
  expiresAt: true,
  acceptedAt: true,
  declinedAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const returnedColumns = {
  id: organizationInvitations.id,
  organizationId: organizationInvitations.organizationId,
  email: organizationInvitations.email,
  role: organizationInvitations.role,
  invitedBy: organizationInvitations.invitedBy,
  expiresAt: organizationInvitations.expiresAt,
  acceptedAt: organizationInvitations.acceptedAt,
  declinedAt: organizationInvitations.declinedAt,
  revokedAt: organizationInvitations.revokedAt,
  createdAt: organizationInvitations.createdAt,
  updatedAt: organizationInvitations.updatedAt,
} as const;

export const createInvitationsRepository = (db: DbExecutor) => {
  /**
   * "Still pending at `at`" — no terminal stamp and not yet expired.
   *
   * One expression, used by every read and by the consume, so the four
   * columns that define the state cannot be checked three different ways.
   */
  const pendingAt = (at: Date) =>
    and(
      isNull(organizationInvitations.acceptedAt),
      isNull(organizationInvitations.declinedAt),
      isNull(organizationInvitations.revokedAt),
      gt(organizationInvitations.expiresAt, at),
    );

  /**
   * The organization is still live.
   *
   * Load-bearing rather than defensive: `organization_id` cascades on a
   * **hard** delete only, so these rows outlive their organization's soft
   * delete, and an accept without this clause grants membership in a deleted
   * tenant (ADR-0067 §2 writes it into the consume statement for exactly this
   * reason).
   *
   * **Correlated**, so it belongs only to builders that do not alias the table
   * it names — the `update` below does not, the relational query builder does.
   * The read that needs the same filter joins instead; see
   * {@link createInvitationsRepository.listPendingForEmail}.
   */
  const organizationIsLive = exists(
    db
      .select({ one: sql`1` })
      .from(organizations)
      .where(
        and(
          eq(organizations.id, organizationInvitations.organizationId),
          isNull(organizations.deletedAt),
        ),
      ),
  );

  return {
    /** Inserts an invitation. The token is minted by the caller, not here. */
    create: async (
      organizationId: string,
      input: NewInvitationInput,
      tx: DbExecutor = db,
    ): Promise<InvitationRecord> => {
      const [created] = await tx
        .insert(organizationInvitations)
        // The scope **last**, so a caller passing a wider object than
        // `NewInvitationInput` — structural typing only excess-checks object
        // literals — cannot spread an `organizationId` over the required
        // parameter. On the one table where a wrong scope is a cross-tenant
        // invitation, the required argument wins by construction.
        .values({ ...input, organizationId })
        .returning(returnedColumns);

      // The insert has no conflict target and no nullable returning path: a
      // failure raises rather than resolving to `undefined`, so this cannot be
      // `undefined` in practice and the assertion documents which invariant
      // says so rather than hiding a branch.
      if (created === undefined) {
        throw new Error("insert into organization_invitations returned no row");
      }

      return created;
    },

    /** One invitation of one organization, whatever its state. */
    findById: async (
      organizationId: string,
      id: string,
      tx: DbExecutor = db,
    ): Promise<InvitationRecord | undefined> =>
      tx.query.organizationInvitations.findFirst({
        columns: recordColumns,
        where: and(
          eq(organizationInvitations.organizationId, organizationId),
          eq(organizationInvitations.id, id),
        ),
      }),

    /** The organization's pending invitations, newest first. */
    listPendingFor: async (
      organizationId: string,
      at: Date,
      tx: DbExecutor = db,
    ): Promise<readonly InvitationRecord[]> =>
      tx.query.organizationInvitations.findMany({
        columns: recordColumns,
        where: and(
          eq(organizationInvitations.organizationId, organizationId),
          pendingAt(at),
        ),
        orderBy: (row, { desc }) => [desc(row.createdAt), desc(row.id)],
      }),

    /**
     * The pending invitations addressed to one **address** — the invitee's own
     * list, and the principal-scoped read this module's header names.
     *
     * Live organizations only, for the reason the consume filters them: an
     * invitation into a deleted tenant is not pending, it is void, and showing
     * it would offer an accept that must fail.
     *
     * Written as a core `select` with a join rather than as a relational
     * `findMany` with {@link organizationIsLive}, and the difference is not a
     * preference: the relational builder aliases the table it selects from, so
     * a **correlated** subquery naming `organization_invitations` resolves to
     * nothing and Postgres refuses the statement outright (`42P01`). The join
     * needs no correlation and is the shape `memberships.listForUser` already
     * uses. `organizations-repositories.int.test.ts` is what would have caught
     * that before a route existed, and now does.
     */
    listPendingForEmail: async (
      email: string,
      at: Date,
      tx: DbExecutor = db,
    ): Promise<readonly InvitationRecord[]> =>
      tx
        .select(returnedColumns)
        .from(organizationInvitations)
        .innerJoin(
          organizations,
          eq(organizations.id, organizationInvitations.organizationId),
        )
        .where(
          and(
            eq(organizationInvitations.email, email),
            pendingAt(at),
            isNull(organizations.deletedAt),
          ),
        )
        .orderBy(
          desc(organizationInvitations.createdAt),
          desc(organizationInvitations.id),
        ),

    /**
     * Stamps one terminal column on a **pending** invitation, atomically.
     *
     * The `impersonation_handoffs` consume applied to this table's stamps
     * (ADR-0067 §2): every condition that decides whether the invitation may
     * still end is in the `where` clause of the statement that ends it, so
     * two concurrent accepts cannot both succeed and single use needs no
     * column of its own.
     *
     * @returns the row when this call is the one that ended it, `undefined`
     *   when it was already accepted, declined, revoked, expired, or its
     *   organization deleted — one answer for five refusals, which the service
     *   turns into the client's.
     */
    consume: async (
      organizationId: string,
      id: string,
      stamp: "acceptedAt" | "declinedAt" | "revokedAt",
      at: Date,
      tx: DbExecutor = db,
    ): Promise<InvitationRecord | undefined> => {
      const [consumed] = await tx
        .update(organizationInvitations)
        .set({ [stamp]: at, updatedAt: at })
        .where(
          and(
            eq(organizationInvitations.organizationId, organizationId),
            eq(organizationInvitations.id, id),
            pendingAt(at),
            organizationIsLive,
          ),
        )
        .returning(returnedColumns);

      return consumed;
    },
  } as const;
};

export type InvitationsRepository = ReturnType<
  typeof createInvitationsRepository
>;
