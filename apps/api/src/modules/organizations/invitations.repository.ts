import type { ListQuery, OrganizationRole } from "@repo/contracts";
import {
  organizationInvitations,
  organizations,
  type DbExecutor,
} from "@repo/db";
import { and, count, desc, eq, exists, gt, isNull, sql } from "drizzle-orm";

import {
  applyListQuery,
  type ColumnMap,
  type ListResult,
} from "../../core/http/index.js";

/**
 * Every query against `organization_invitations` (ADR-0009).
 *
 * Tenant-owned (ADR-0067 §1), so the organization id is the first, required
 * parameter of every function that reads or writes one organization's
 * invitations. {@link createInvitationsRepository.listPendingForEmail} and its
 * `findForEmail` sibling are the sanctioned exception and the second instance
 * of the class ADR-0067 §5 names: a read scoped by the **principal** — here
 * their address — rather than by a tenant, because an invitee asking "who has
 * invited me?" does not yet know which organizations are involved. Both are
 * served by `organization_invitations_email_idx` and are named here for what
 * they are.
 *
 * {@link createInvitationsRepository.findPendingByTokenHash} is the **third**
 * instance and the class ADR-0067 §5's 2026-09-04 amendment sanctioned in
 * advance: a read scoped by the token's own 256 bits and by nothing else. It
 * is named here for what it is, as that amendment requires, and it earns the
 * exception on the terms it set — the mint is `randomToken()` at 32 bytes, the
 * read lands on exactly one row through
 * `organization_invitations_token_hash_unique`, and the two conditions that
 * follow from it are the *service's*: the lookup is limited as an
 * authentication route, and holding the token authorises reading and consuming
 * that one invitation and never deciding whose membership is created.
 *
 * **No function here returns `token_hash`, and none can.** The column is not
 * in {@link InvitationRecord} and is not selected by any read, which is a
 * stronger guarantee than a mapper that remembers to drop it: there is no
 * value for a mapper to leak (ADR-0067 §2, amended). The two functions that
 * touch it take a hash and return a row without one.
 *
 * **Every read joins `organizations` and filters `deleted_at is null`.** Not
 * defensiveness: `organization_id` cascades on a **hard** delete only, so
 * these rows outlive their organization's soft delete, and an invitation into
 * a deleted tenant is not pending — it is void. The join also carries the
 * organization's name, which is what the invitee's own list renders.
 */

/**
 * An invitation row — every column except `token_hash`.
 *
 * There is no `status`: the row's state is its timestamps (ADR-0067 §2,
 * amended), because `expired` becomes true as a clock passes and no column can
 * hold a fact nothing writes. The mapper folds these four into the wire's
 * `InvitationStatus`.
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

/** An invitation with the name of the organization it belongs to. */
export interface InvitationWithOrganization extends InvitationRecord {
  readonly organizationName: string;
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

/**
 * What the pending list may sort and filter by (ADR-0060 §3).
 *
 * **`tokenHash` is absent, and its absence is the control.** The column is
 * unique, and `indexCoverage` reports a unique column as covered — so the
 * index side of ADR-0060 §3 would accept `sort=tokenHash` without complaint.
 * This map and the allow-list in `@repo/contracts` are together the only thing
 * keeping a credential digest out of a query string and out of an ordered
 * page.
 */
export const listColumns: ColumnMap = {
  createdAt: organizationInvitations.createdAt,
  updatedAt: organizationInvitations.updatedAt,
  email: organizationInvitations.email,
};

/** Every column but the digest — see the note on {@link InvitationRecord}. */
const recordColumns = {
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

/** The same columns plus the organization's name, for the reads that join. */
const joinedColumns = {
  ...recordColumns,
  organizationName: organizations.name,
} as const;

export const createInvitationsRepository = (db: DbExecutor) => {
  /**
   * "Still pending at `at`" — no terminal stamp and not yet expired.
   *
   * One expression, used by every read and by the consume, so the four columns
   * that define the state cannot be checked three different ways.
   */
  const pendingAt = (at: Date) =>
    and(
      isNull(organizationInvitations.acceptedAt),
      isNull(organizationInvitations.declinedAt),
      isNull(organizationInvitations.revokedAt),
      gt(organizationInvitations.expiresAt, at),
    );

  /**
   * The organization is still live, as a **correlated** subquery.
   *
   * Used by `consume` alone, which is a plain `update` builder and therefore
   * does not alias the table this names. Every *read* joins instead: both
   * select builders alias, and a correlated reference into an aliased scope
   * resolves to nothing — Postgres refuses the statement with `42P01`, which
   * is at least loud, but only once something calls it (`D15.2`'s review).
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

  /** The join every read shares — invitations of live organizations only. */
  const fromLiveOrganizations = (tx: DbExecutor) =>
    tx
      .select(joinedColumns)
      .from(organizationInvitations)
      .innerJoin(
        organizations,
        eq(organizations.id, organizationInvitations.organizationId),
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
        .returning(recordColumns);

      // The insert has no conflict target and no nullable returning path: a
      // failure raises rather than resolving to `undefined`, so this cannot be
      // `undefined` in practice and the assertion documents which invariant
      // says so rather than hiding a branch.
      if (created === undefined) {
        throw new Error("insert into organization_invitations returned no row");
      }

      return created;
    },

    /** One invitation of one live organization, whatever its own state. */
    findById: async (
      organizationId: string,
      id: string,
      tx: DbExecutor = db,
    ): Promise<InvitationWithOrganization | undefined> => {
      const [row] = await fromLiveOrganizations(tx)
        .where(
          and(
            eq(organizationInvitations.organizationId, organizationId),
            eq(organizationInvitations.id, id),
            isNull(organizations.deletedAt),
          ),
        )
        .limit(1);

      return row;
    },

    /**
     * One invitation addressed to an **address**, by id — the invitee's read.
     *
     * The second half of the principal-scoped class: the caller names an
     * invitation they were shown, and this is what checks it is theirs — which
     * is what stops accept and decline reaching somebody else's row. The
     * address comparison is in SQL against a `citext` column, so it matches
     * however either side typed it.
     */
    findForEmail: async (
      email: string,
      id: string,
      tx: DbExecutor = db,
    ): Promise<InvitationWithOrganization | undefined> => {
      const [row] = await fromLiveOrganizations(tx)
        .where(
          and(
            eq(organizationInvitations.id, id),
            eq(organizationInvitations.email, email),
            isNull(organizations.deletedAt),
          ),
        )
        .limit(1);

      return row;
    },

    /**
     * One **pending** invitation of a live organization, by the SHA-256 of the
     * token its link carries (ADR-0067 §5 as amended, ADR-0071 §5).
     *
     * The read this table's `token_hash` was added for and that nothing
     * performed until the send existed. It takes the *hash*, never the token:
     * hashing is the service's, so no plaintext credential crosses this
     * boundary and the column is compared against a value of the same shape it
     * stores.
     *
     * **Pending-only, and that is the whole refusal**. Unknown, accepted,
     * declined, revoked, expired and "its organization was soft-deleted" all
     * produce the same `undefined`, so the service has one answer to give and
     * no way to accidentally give six — which is the enumeration property a
     * lookup scoped by nothing but a secret has to have.
     *
     * It does **not** consume: a lookup is a read, and the accept path takes
     * the guarded statement that ends the row. The two are separate for the
     * reason ADR-0067 §5 separates the authorities — reading the offer is what
     * the link's holder may do; joining is what the *account* does.
     */
    findPendingByTokenHash: async (
      tokenHash: string,
      at: Date,
      tx: DbExecutor = db,
    ): Promise<InvitationWithOrganization | undefined> => {
      const [row] = await fromLiveOrganizations(tx)
        .where(
          and(
            eq(organizationInvitations.tokenHash, tokenHash),
            pendingAt(at),
            isNull(organizations.deletedAt),
          ),
        )
        .limit(1);

      return row;
    },

    /**
     * `GET /api/v1/user/orgs/:orgId/invitations` — the pending ones, paged
     * (ADR-0014 as carried by ADR-0060).
     *
     * Tenant-scoped, and "pending" is a predicate of the endpoint rather than
     * a filter a client may drop: an owner asking for invitations means the
     * outstanding ones, and the ended ones are history no surface renders.
     */
    listPendingFor: async (
      organizationId: string,
      query: ListQuery,
      at: Date,
      tx: DbExecutor = db,
    ): Promise<ListResult<InvitationWithOrganization>> => {
      const plan = applyListQuery(query, {
        columns: listColumns,
        tiebreaker: organizationInvitations.id,
        extraWhere: [
          eq(organizationInvitations.organizationId, organizationId),
          pendingAt(at),
          isNull(organizations.deletedAt),
        ],
      });

      const rows = await fromLiveOrganizations(tx)
        .where(plan.where)
        .orderBy(...plan.orderBy)
        .limit(plan.limit)
        .offset(plan.offset);

      if (!query.count) return { rows, total: null };

      const [counted] = await tx
        .select({ total: count() })
        .from(organizationInvitations)
        .innerJoin(
          organizations,
          eq(organizations.id, organizationInvitations.organizationId),
        )
        .where(plan.where);

      return { rows, total: counted?.total ?? 0 };
    },

    /**
     * The pending invitations addressed to one **address** — the invitee's own
     * list, and the principal-scoped read this module's header names.
     *
     * Unpaged, like `GET /user/orgs`: it is a person's own small list, and a
     * pagination language over it would be a query string no client sends
     * (ADR-0067 §5's class, ADR-0060's altitude).
     */
    listPendingForEmail: async (
      email: string,
      at: Date,
      tx: DbExecutor = db,
    ): Promise<readonly InvitationWithOrganization[]> =>
      fromLiveOrganizations(tx)
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
     * still end is in the `where` clause of the statement that ends it, so two
     * concurrent accepts cannot both succeed and single use needs no column of
     * its own.
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
        .returning(recordColumns);

      return consumed;
    },
  } as const;
};

export type InvitationsRepository = ReturnType<
  typeof createInvitationsRepository
>;
