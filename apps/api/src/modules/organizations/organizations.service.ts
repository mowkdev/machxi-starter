import type {
  AcceptInvitationByTokenBody,
  CreateInvitationBody,
  CreateOrganizationAdminBody,
  CreateOrganizationBody,
  InvitationLookupResource,
  InvitationResource,
  ListQuery,
  LookupInvitationBody,
  MembershipResource,
  Page,
  OrganizationResource,
  OrganizationRole,
  UpdateOrganizationBody,
} from "@repo/contracts";
import { randomToken, sha256Base64url } from "@repo/crypto";
import {
  personalOrganizationName,
  personalOrganizationSlug,
  type DbExecutor,
  type PersonalOrganizationOwner,
} from "@repo/db";

import { requirePopulation } from "../../core/auth/index.js";
import { createMailDelivery, localeFor } from "../../core/mail/index.js";
import type { MailSender, MailTemplates } from "../../core/mail/index.js";
import { toPage } from "../../core/http/index.js";
import type { RequestContext } from "../../core/context/index.js";
import { internal } from "../../core/errors/index.js";
import type { InvitationsRepository } from "./invitations.repository.js";
import {
  alreadyAMember,
  callerAccountGone,
  invitationAddressMismatch,
  invitationAlreadyPending,
  invitationNotFound,
  invitationNotPending,
  lastOrganizationOwner,
  membershipNotFound,
  organizationNotFound,
  organizationRoleInsufficient,
  organizationSlugTaken,
  personalOrganizationClosed,
  personalOrganizationSlugFixed,
  personalOrganizationUndeletable,
} from "./organizations.errors.js";
import {
  toInvitationLookupResource,
  toInvitationResource,
  toMembershipResource,
  toOrganizationResource,
} from "./organizations.mapper.js";
import type { MembershipsRepository } from "./memberships.repository.js";
import type { OrganizationsRepository } from "./organizations.repository.js";

/**
 * The organizations service (ADR-0009, ADR-0067 §2).
 *
 * It owns three things at `D15.2`: the personal organization's whole
 * lifecycle, which every path that creates or deletes a user goes through; the
 * two invariants that keep an organization's membership coherent; and the
 * reads `requireMembership` resolves a request against. The HTTP surface that
 * calls the rest of it — creating a team organization, editing one, the
 * invitation flow — is `D15.3`'s.
 *
 * Two of its functions are called by *other modules' services* rather than by
 * a controller: `ensurePersonalOrganizationFor` from the auth service's
 * `register` and from the users service's `create`, and
 * `deletePersonalOrganizationFor` from both of the users service's deletion
 * paths. That is the service-to-service edge ADR-0009 permits and the shape
 * the `sessions` dependency already has — a module reaches another module's
 * *service*, narrowed to what it may call, and never its repository. It runs
 * on the caller's transaction, so "a user exists" and "that user has a
 * personal organization" are one commit and there is no window in which the
 * first is true and the second is not.
 */

export interface OrganizationsServiceDeps {
  readonly repository: OrganizationsRepository;
  readonly memberships: MembershipsRepository;
  readonly invitations: InvitationsRepository;
  /** `ORGANIZATION_INVITATION_TTL` (ADR-0004, ADR-0067 §2). */
  readonly invitationTtlSec: number;
  /** Runs `fn` inside one database transaction (ADR-0006). */
  readonly transaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  readonly now?: () => Date;
  /**
   * The invitation's opaque token, minted per row.
   *
   * Injectable for the reason `newRefreshToken` is on the auth service: a test
   * that wants to know which token was minted should not have to read one out
   * of a mock of the crypto package. The default is `randomToken()` at its own
   * default of 32 bytes — 256 bits, which ADR-0067 §2 fixes here rather than
   * leaving to the create path, because this is the one credential in the
   * schema whose lookup is scoped by nothing else.
   */
  readonly newInvitationToken?: () => string;
  /**
   * ADR-0066 §1's port and ADR-0071 §2's messages, reached the way the auth
   * service reaches them: through `core/mail`, never a client this module
   * imports.
   *
   * They arrive at `D18.7`, when §2's marked call in {@link
   * createOrganizationsService.invite} stopped being a comment. Nothing else
   * in this service sends.
   */
  readonly mail: MailSender;
  readonly mailTemplates: MailTemplates;
}

export const createOrganizationsService = ({
  repository,
  memberships,
  invitations,
  invitationTtlSec,
  transaction,
  now = () => new Date(),
  newInvitationToken = () => randomToken(),
  mail,
  mailTemplates,
}: OrganizationsServiceDeps) => {
  /**
   * The invitation's send, through `core/mail` (ADR-0066 §1, ADR-0071 §5).
   *
   * Detached, like the two senders in the auth service and for a reason of its
   * own rather than theirs: `invite` is not an endpoint whose branches must
   * look alike — it answers `201` with the invitation and never reports
   * delivery — so awaiting a relay would only make the inviter wait for a
   * result they are not given, and a transport that is down would turn a
   * created invitation into a request that appears to hang. A failure is
   * logged and swallowed either way (`deliver`'s own docblock says why), so
   * nothing observable changes.
   */
  const { deliverDetached } = createMailDelivery({ mail });
  /** A live organization, or the refusal every read of a missing one gives. */
  const read = async (id: string, tx?: DbExecutor) => {
    const record = await repository.findById(id, tx);

    if (record === undefined) throw organizationNotFound();

    return record;
  };

  /**
   * The last-owner invariant (ADR-0067 §2), in one place because both writes
   * that can break it break it the same way.
   *
   * It assumes the caller has already taken `lockOwnerInvariant` — see
   * {@link lockedMembershipWrite}, which is the only way in. The lock is not
   * taken here because by the time this function has a role to look at, the
   * read that produced it has already happened: the count is only as good as
   * the snapshot the *whole decision* was made against, and that snapshot
   * starts at the role read, not at the count.
   */
  const assertOwnerSurvives = async (
    organizationId: string,
    losing: { readonly userId: string; readonly role: OrganizationRole },
    tx: DbExecutor,
  ): Promise<void> => {
    if (losing.role !== "owner") return;

    const remaining = await memberships.countOwnersExcept(
      organizationId,
      losing.userId,
      tx,
    );

    if (remaining === 0) throw lastOrganizationOwner();
  };

  /**
   * The calling account's id and **address**.
   *
   * The address is what the invitee's own surface is scoped by (ADR-0067 §5),
   * and no principal carries one: ADR-0018 puts an id, a population and roles
   * in the token and nothing else, deliberately, so that a token is not a
   * place personal data travels. One read per request that needs it.
   *
   * A live account, so a session that outlived its account by a moment cannot
   * accept an invitation — `authenticate` would already have refused it, and
   * this is the second half of the same fact rather than a duplicate check.
   */
  const callerAccount = async (ctx: RequestContext, tx?: DbExecutor) => {
    const principal = requirePopulation(ctx, "user");
    const account = await memberships.findAccount(principal.id, tx);

    // A live session for an account that is gone. `authenticate` reads the
    // session row rather than the account, so this is reachable in the window
    // between a soft delete and its session revocation committing.
    if (account === undefined) throw callerAccountGone();

    return account;
  };

  /**
   * Every write that can break the owner invariant, inside one transaction
   * with the lock taken **before the first read**.
   *
   * The ordering is the staff service's, and it is the ordering because the
   * alternative loses to a stale role. Taking the lock only once a role read
   * says "owner" leaves the non-owner path unserialised, and a non-owner path
   * can still empty an organization: a removal reads `member`, skips the lock,
   * and by the time it deletes, that member has been promoted to owner and the
   * previous sole owner has been removed by a request that counted this one as
   * the survivor. Two writes, each individually correct against what it read,
   * and no owner left.
   *
   * So the lock is the first statement, and it covers the read as well as the
   * count. It is per organization (`lockOwnerInvariant` says why), so this
   * serialises one tenant's membership edits and no other's, and it is
   * released with the transaction either way.
   */
  const lockedMembershipWrite = async <T>(
    organizationId: string,
    write: (tx: DbExecutor) => Promise<T>,
  ): Promise<T> =>
    transaction(async (tx) => {
      await memberships.lockOwnerInvariant(organizationId, tx);

      return write(tx);
    });

  return {
    /**
     * The personal organization, created or found (ADR-0067 §2).
     *
     * Called by every path that brings a user into existence —
     * `POST /public/auth/register`, `POST /admin/users`, and (through the
     * seeders' own copy of this, which shares the derivation rather than the
     * code, because a seeder has no container) `pnpm db:seed`. It runs on the
     * transaction the caller is already in, which is the whole point: the
     * account and its organization commit together, so "every user has at
     * least one organization" is a property of the database rather than a
     * sequence somebody must not interrupt.
     *
     * **Idempotent**, and by construction rather than by a read-then-write:
     * the slug is derived from the account's id, so a second call conflicts on
     * `organizations_slug_active_unique` and does nothing, and the membership
     * conflicts on its composite primary key. That matters beyond retries —
     * the backfill migration ran the same derivation in SQL, so this is also
     * what makes the migration and the API agree about an account created on
     * either side of it.
     *
     * @returns the organization's id, so a caller that wants to log or return
     *   it need not read the row back.
     */
    ensurePersonalOrganizationFor: async (
      ctx: RequestContext,
      owner: PersonalOrganizationOwner,
      tx: DbExecutor,
    ): Promise<string> => {
      const slug = personalOrganizationSlug(owner.id);

      const created = await repository.create(
        {
          slug,
          name: personalOrganizationName(owner),
          kind: "personal",
          createdBy: owner.id,
        },
        tx,
      );

      // `undefined` means a live organization already holds the slug, and the
      // slug is derived from this account's id — so the row is this account's
      // own personal organization and this call is a repeat. Read it back
      // rather than assuming: the membership insert below needs its id, and a
      // slug collision that was *not* this account's would be a squatted
      // reserved prefix, which `slugSchema` refuses at the edge.
      const organization =
        created ?? (await repository.findPersonalFor(owner.id, tx));

      if (organization === undefined) {
        // Not reachable through any request: the insert either created the row
        // or conflicted with this account's own, and `personal-` is reserved
        // so no other account can hold the slug. A 500 rather than a guess,
        // because the alternative is a user with no organization — the one
        // state ADR-0067 §2 exists to make impossible.
        throw internal(
          new Error(
            `personal organization for ${owner.id} neither created nor found`,
          ),
        );
      }

      await memberships.create(organization.id, owner.id, "owner", tx);

      ctx.logger.debug(
        { userId: owner.id, organizationId: organization.id },
        "personal organization ensured",
      );

      return organization.id;
    },

    /**
     * Soft-deletes the account's personal organization, inside the
     * transaction that is deleting the account (ADR-0067 §2, ADR-0028).
     *
     * The only path by which a personal organization is deleted at all: on its
     * own it refuses with `409`, because a user with no organization is a
     * state no query in this repository has a branch for. Both user-deletion
     * paths call it — `DELETE /admin/users/:id` and `DELETE /user/profile` —
     * and both pass their own `at`, so the account and its organization carry
     * the same `deleted_at`.
     *
     * Silent when there is nothing to delete: an account whose organization
     * was already soft-deleted, or one created before the backfill and somehow
     * missed by it, must still be deletable. A deletion that refused because
     * of a missing dependent row would be an account nobody can close.
     *
     * The team organizations the account owns are deliberately **untouched**.
     * Deleting a user does not delete the teams they created — other people
     * are in them — and what happens to a team whose last owner closes their
     * account is a question ADR-0067 does not answer; it becomes real only
     * when the deletion paths meet the ownership invariant, which is beyond
     * this deliverable's scope boundary (§7).
     */
    deletePersonalOrganizationFor: async (
      ctx: RequestContext,
      userId: string,
      at: Date,
      tx: DbExecutor,
    ): Promise<void> => {
      const organization = await repository.findPersonalFor(userId, tx);

      if (organization === undefined) return;

      await repository.softDelete(organization.id, at, tx);

      ctx.logger.info(
        { userId, organizationId: organization.id },
        "personal organization deleted with its account",
      );
    },

    /**
     * Soft-deletes a `team` organization (ADR-0067 §3).
     *
     * A `personal` one refuses with `409` rather than `403`: the caller is its
     * owner and holds exactly the role the route requires, and what the
     * request conflicts with is the organization's kind.
     *
     * Memberships and invitations are **not** removed. They cascade on a hard
     * delete only, so they survive this — which is why every read of either
     * joins `organizations` and filters `deleted_at`, rather than trusting the
     * absence of a row.
     */
    remove: async (ctx: RequestContext, id: string): Promise<void> => {
      const at = now();
      const record = await read(id);

      if (record.kind === "personal") throw personalOrganizationUndeletable();

      await transaction(async (tx) => {
        // The boolean is what sees a concurrent delete: the read above ran
        // outside this transaction, so two owners deleting at once can both
        // pass it, and the loser would otherwise change nothing and answer
        // `204` for a request that did nothing.
        if (!(await repository.softDelete(record.id, at, tx))) {
          throw organizationNotFound();
        }
      });

      ctx.logger.info(
        { organizationId: record.id, slug: record.slug },
        "organization deleted",
      );
    },

    /**
     * Changes a member's role (ADR-0067 §2).
     *
     * The read, the invariant and the write are one transaction because they
     * are one decision: the count that decides whether the last owner is being
     * demoted must be taken against the snapshot the update lands on.
     */
    setMemberRole: async (
      ctx: RequestContext,
      organizationId: string,
      userId: string,
      role: OrganizationRole,
    ): Promise<void> => {
      const at = now();

      await lockedMembershipWrite(organizationId, async (tx) => {
        const organization = await read(organizationId, tx);
        const membership = await memberships.findFor(
          organization.id,
          userId,
          tx,
        );

        if (membership === undefined) throw membershipNotFound();
        if (membership.role === role) return;

        await assertOwnerSurvives(
          organization.id,
          { userId, role: membership.role },
          tx,
        );

        if (
          !(await memberships.updateRole(organization.id, userId, role, at, tx))
        ) {
          throw membershipNotFound();
        }
      });

      ctx.logger.info(
        { organizationId, userId, role },
        "organization membership role changed",
      );
    },

    /**
     * Removes a member (ADR-0067 §2) — somebody else, or the caller leaving.
     *
     * One function for both, because they are the same write with the same
     * invariant: the last owner cannot be removed and cannot leave.
     *
     * What differs is **who was allowed to ask**, and that is a resource rule
     * rather than a role guard (ADR-0019 §3): removing somebody else needs
     * `owner` or `admin`, and leaving needs only that the caller is the member
     * being removed. A route guard cannot express it — it would have to admit
     * any member and then the actual rule would live nowhere — so the route
     * admits any member and the comparison happens here, against the caller's
     * own id.
     *
     * @param actor the caller's membership when the request came from the user
     *   segment, `null` when it came from the admin one. Staff are never
     *   members (ADR-0067 §3), so there is no role to compare and nothing they
     *   could be leaving; `null` is "this rule does not apply", never "skip
     *   the check".
     */
    removeMember: async (
      ctx: RequestContext,
      organizationId: string,
      userId: string,
      actor: {
        readonly userId: string;
        readonly role: OrganizationRole;
      } | null,
    ): Promise<void> => {
      if (
        actor !== null &&
        actor.userId !== userId &&
        actor.role !== "owner" &&
        actor.role !== "admin"
      ) {
        throw organizationRoleInsufficient();
      }

      await lockedMembershipWrite(organizationId, async (tx) => {
        const organization = await read(organizationId, tx);
        const membership = await memberships.findFor(
          organization.id,
          userId,
          tx,
        );

        if (membership === undefined) throw membershipNotFound();

        await assertOwnerSurvives(
          organization.id,
          { userId, role: membership.role },
          tx,
        );

        if (!(await memberships.remove(organization.id, userId, tx))) {
          throw membershipNotFound();
        }
      });

      ctx.logger.info(
        { organizationId, userId },
        "organization membership removed",
      );
    },

    /* ── the user segment (ADR-0067 §4) ─────────────────────────────────── */

    /**
     * `GET /api/v1/user/orgs` — the caller's own organizations, each with the
     * role that got them there.
     *
     * The switcher's query, and the principal-scoped read ADR-0067 §5
     * sanctions: it names no tenant because the caller is asking which tenants
     * they have. Every account has at least one — its personal organization —
     * so this list is never empty for a live account, which is the invariant
     * that lets the client render a switcher with no empty state.
     */
    listMine: async (
      ctx: RequestContext,
    ): Promise<readonly OrganizationResource[]> => {
      const principal = requirePopulation(ctx, "user");
      const rows = await memberships.listForUser(principal.id);

      return rows.map((row) =>
        toOrganizationResource(row.organization, row.role),
      );
    },

    /**
     * `POST /api/v1/user/orgs` — a `team` organization with the caller as its
     * owner (ADR-0067 §2).
     *
     * One transaction: an organization with no owner is a state the last-owner
     * invariant cannot repair, so the row and the membership commit together
     * or neither does.
     */
    createTeam: async (
      ctx: RequestContext,
      body: CreateOrganizationBody,
    ): Promise<OrganizationResource> => {
      const principal = requirePopulation(ctx, "user");

      const created = await transaction(async (tx) => {
        const organization = await repository.create(
          {
            slug: body.slug,
            name: body.name,
            kind: "team",
            createdBy: principal.id,
          },
          tx,
        );

        if (organization === undefined) return undefined;

        await memberships.create(organization.id, principal.id, "owner", tx);

        return organization;
      });

      if (created === undefined) throw organizationSlugTaken();

      ctx.logger.info(
        { organizationId: created.id, slug: created.slug },
        "team organization created",
      );

      return toOrganizationResource(created, "owner");
    },

    /**
     * `GET /api/v1/user/orgs/:orgId` — one organization, as a member sees it.
     *
     * The read cannot fail with `404` in practice: `requireMembership` has
     * already resolved a live organization for this request. It reads the row
     * again rather than rendering the guard's three fields, because the
     * resource is the whole row and the guard deliberately carries only what a
     * guard needs.
     */
    getForMember: async (
      _ctx: RequestContext,
      organizationId: string,
      role: OrganizationRole,
    ): Promise<OrganizationResource> =>
      toOrganizationResource(await read(organizationId), role),

    /**
     * `PATCH` on either segment — name and slug, and nothing else
     * (ADR-0067 §7).
     *
     * A slug edit on a `personal` organization is refused with `409`
     * (`D15.2`'s review): the slug is derived from the account's id, and that
     * derivation is what proves "exactly one personal organization per live
     * account" without a journal. The name is freely editable — it is what the
     * switcher renders and it proves nothing.
     */
    update: async (
      ctx: RequestContext,
      organizationId: string,
      body: UpdateOrganizationBody,
      role: OrganizationRole | null,
    ): Promise<OrganizationResource> => {
      const at = now();

      const updated = await transaction(async (tx) => {
        const current = await read(organizationId, tx);

        if (body.slug !== undefined && current.kind === "personal") {
          throw personalOrganizationSlugFixed();
        }

        return repository.update(organizationId, body, at, tx);
      });

      // Three outcomes, because the caller is owed a different answer to each:
      // `undefined` is a live organization already holding the slug, `null` is
      // no live row with that id — which only a delete concurrent with this
      // request can produce, the read above having just found one.
      if (updated === undefined) throw organizationSlugTaken();
      if (updated === null) throw organizationNotFound();

      ctx.logger.info(
        { organizationId, slug: updated.slug },
        "organization updated",
      );

      return toOrganizationResource(updated, role);
    },

    /**
     * `GET .../members` on either segment (ADR-0014 as carried by ADR-0060).
     *
     * Tenant-scoped at the repository, so the organization is a parameter and
     * not something a filter could widen.
     */
    listMembers: async (
      _ctx: RequestContext,
      organizationId: string,
      query: ListQuery,
    ): Promise<Page<MembershipResource>> => {
      const { rows, total } = await memberships.list(organizationId, query);

      return toPage(query, rows.map(toMembershipResource), total);
    },

    /* ── invitations (ADR-0067 §2) ──────────────────────────────────────── */

    /**
     * `POST /api/v1/user/orgs/:orgId/invitations` — an invitation by address.
     *
     * **It never looks an account up**, which is what makes the flow
     * enumeration-safe by construction rather than by care (ADR-0020
     * §Enumeration): the row names an address, so the response is the same
     * status and the same shape whether or not that address has an account.
     * The one distinguishable refusal is "already a member", and it tells the
     * inviter only what the members list they can already read would.
     *
     * **The token is minted here and returned to nobody.** Only its SHA-256
     * reaches the database (ADR-0067 §2, amended), and no response body
     * carries either. Since `D18.7` it leaves this function in exactly one
     * direction: into the link of the message below (ADR-0071 §5). That is
     * what ADR-0067 §2 shaped the column for, and it needed no migration —
     * every row created since D15 carries a hash.
     */
    invite: async (
      ctx: RequestContext,
      organizationId: string,
      body: CreateInvitationBody,
    ): Promise<InvitationResource> => {
      const principal = requirePopulation(ctx, "user");
      const at = now();

      const token = newInvitationToken();
      const created = await transaction(async (tx) => {
        const organization = await read(organizationId, tx);

        // A personal organization has exactly one member, and the record leans
        // on that in more places than it looks (the error factory says which).
        // The caller holds `owner` on their own, so the route's guard admits
        // them and this is the only thing that does not.
        if (organization.kind === "personal") {
          throw personalOrganizationClosed();
        }

        if (
          (await memberships.findByEmail(organizationId, body.email, tx)) !==
          undefined
        ) {
          throw alreadyAMember();
        }

        // One outstanding offer per address per organization. An invitation
        // has no natural key — the same address may be invited again once an
        // offer has ended — so this is the check rather than a constraint, and
        // it is inside the transaction that inserts, which is what makes it a
        // check rather than a race.
        if (
          (await invitations.listPendingForEmail(body.email, at, tx)).some(
            (row) => row.organizationId === organizationId,
          )
        ) {
          throw invitationAlreadyPending();
        }

        const invitation = await invitations.create(
          organizationId,
          {
            email: body.email,
            role: body.role,
            invitedBy: principal.id,
            tokenHash: sha256Base64url(token),
            expiresAt: new Date(at.getTime() + invitationTtlSec * 1000),
          },
          tx,
        );

        return { invitation, organizationName: organization.name };
      });

      /*
       * The marked call (ADR-0067 §2), filled at `D18.7` (ADR-0071 §5).
       *
       * **After the commit**, for the reason registration's send is: a message
       * sent from inside the transaction is a message that arrives for an
       * invitation that was rolled back, and its link would name a row that
       * does not exist — the one failure the recipient cannot recover from,
       * since only the inviter can send another.
       *
       * The locale comes from the **body**, not from an account (ADR-0071 §2):
       * an invitation goes to a stranger, so there may be no stored locale to
       * read and, where there is one, it belongs to the inviter rather than to
       * the reader.
       */
      deliverDetached(
        ctx,
        created.invitation.email,
        { purpose: "organization_invitation" },
        mailTemplates.organizationInvitation({
          token,
          locale: localeFor(body.locale),
          organizationName: created.organizationName,
        }),
      );

      ctx.logger.info(
        { organizationId, invitationId: created.invitation.id },
        "organization invitation created",
      );

      return toInvitationResource(
        { ...created.invitation, organizationName: created.organizationName },
        at,
      );
    },

    /** `GET /api/v1/user/orgs/:orgId/invitations` — the pending ones. */
    listInvitations: async (
      _ctx: RequestContext,
      organizationId: string,
      query: ListQuery,
    ): Promise<Page<InvitationResource>> => {
      const at = now();
      const { rows, total } = await invitations.listPendingFor(
        organizationId,
        query,
        at,
      );

      return toPage(
        query,
        rows.map((row) => toInvitationResource(row, at)),
        total,
      );
    },

    /**
     * `DELETE /api/v1/user/orgs/:orgId/invitations/:id` — revoke.
     *
     * The atomic consume, so a revoke racing an accept has one winner and the
     * loser is told the invitation is no longer pending rather than reporting
     * a success that changed nothing.
     */
    revokeInvitation: async (
      ctx: RequestContext,
      organizationId: string,
      id: string,
    ): Promise<void> => {
      const at = now();

      if ((await invitations.findById(organizationId, id)) === undefined) {
        throw invitationNotFound();
      }

      if (
        (await invitations.consume(organizationId, id, "revokedAt", at)) ===
        undefined
      ) {
        throw invitationNotPending();
      }

      ctx.logger.info(
        { organizationId, invitationId: id },
        "organization invitation revoked",
      );
    },

    /* ── the invitee's own surface, self-scoped (ADR-0067 §4) ───────────── */

    /**
     * `GET /api/v1/user/invitations` — the pending invitations addressed to
     * the caller's own address.
     *
     * Outside the `/orgs/:orgId` prefix, and that is ADR-0067 §4's rule rather
     * than a convenience: the caller is asking about their address, and they
     * do not yet know which organizations are involved. The address comes from
     * the account rather than from the request — no principal carries one
     * (ADR-0018) — so there is nothing here for a caller to name but
     * themselves.
     */
    listMyInvitations: async (
      ctx: RequestContext,
    ): Promise<readonly InvitationResource[]> => {
      const at = now();
      const account = await callerAccount(ctx);
      const rows = await invitations.listPendingForEmail(account.email, at);

      return rows.map((row) => toInvitationResource(row, at));
    },

    /**
     * `POST /api/v1/user/invitations/:id/accept` (ADR-0067 §2).
     *
     * One transaction, and the consume is what decides: the stamp is written
     * by a statement whose `where` clause carries every condition that would
     * refuse it — the three terminal stamps, the expiry and the organization
     * still being live — so two concurrent accepts cannot both write a
     * membership, and single use needs no column of its own.
     *
     * **Which account joins is decided here, from the authenticated caller**,
     * never from the row: the invitation names an address, and the membership
     * names the account that answered to it. The row keeps both facts.
     *
     * For the life of D15 an invitation is claimed by **address match alone**,
     * and nothing here verifies an address — the exposure ADR-0067
     * §Consequences records as accepted rather than fixed. The row's token is
     * what lets the deliverable that ships the send close it cheaply.
     */
    acceptInvitation: async (
      ctx: RequestContext,
      id: string,
    ): Promise<OrganizationResource> => {
      const at = now();
      const account = await callerAccount(ctx);

      const joined = await transaction(async (tx) => {
        const invitation = await invitations.findForEmail(
          account.email,
          id,
          tx,
        );

        if (invitation === undefined) throw invitationNotFound();

        const consumed = await invitations.consume(
          invitation.organizationId,
          id,
          "acceptedAt",
          at,
          tx,
        );

        if (consumed === undefined) throw invitationNotPending();

        // Already a member — of an organization that just invited them, which
        // an owner can produce by inviting an address and adding it before it
        // is accepted. The membership already there wins: this must not demote
        // an owner to the `member` the invitation named, which is why the role
        // is read back below rather than assumed to be the invitation's.
        await memberships.create(
          invitation.organizationId,
          account.id,
          invitation.role,
          tx,
        );

        // Both reads inside the transaction that wrote the membership. Outside
        // it they would see a world a concurrent removal could already have
        // changed, and the answer would be a `200` reporting `role: null` for a
        // membership this very request had just created (`D15.3`'s review).
        const organization = await read(invitation.organizationId, tx);
        const membership = await memberships.findFor(
          invitation.organizationId,
          account.id,
          tx,
        );

        return { organization, role: membership?.role ?? invitation.role };
      });

      ctx.logger.info(
        { organizationId: joined.organization.id, invitationId: id },
        "organization invitation accepted",
      );

      return toOrganizationResource(joined.organization, joined.role);
    },

    /**
     * `POST /api/v1/public/invitations/lookup` — what the link's holder is
     * shown before they act (ADR-0071 §5, on ADR-0067 §5's two conditions).
     *
     * **Unauthenticated, and scoped by the token alone.** That is the read
     * ADR-0067 §5's amendment sanctioned in advance, on terms this function
     * keeps: the credential is 256 bits, it lands on one row through a unique
     * index, and holding it authorises reading *this* invitation and nothing
     * else — never deciding whose membership is created, which is the accept
     * path's business below.
     *
     * **One `404` for every failure.** Unknown, consumed, declined, revoked,
     * expired and "its organization was deleted" are the same `undefined` from
     * the repository and the same answer here. Splitting them would tell an
     * anonymous caller which tokens once existed, and the last of them would
     * tell somebody about an organization they were never in.
     *
     * The route's limiter is the other condition (ADR-0071 §5), and it is
     * mounted rather than checked here: guessing is the only attack on a
     * lookup with no other scope.
     */
    lookupInvitation: async (
      _ctx: RequestContext,
      { token }: LookupInvitationBody,
    ): Promise<InvitationLookupResource> => {
      const invitation = await invitations.findPendingByTokenHash(
        sha256Base64url(token),
        now(),
      );

      if (invitation === undefined) throw invitationNotFound();

      // Nothing is logged. A line naming the organization or the address would
      // put the answer to an anonymous, unauthenticated probe into the logs,
      // and the request id already says one arrived (ADR-0005, ADR-0020).
      return toInvitationLookupResource(invitation);
    },

    /**
     * `POST /api/v1/user/invitations/accept-by-token` (ADR-0071 §5).
     *
     * **The token proves the mailbox and the session proves the account, and
     * the two must agree.** That agreement is what closes the exposure
     * ADR-0067 §Consequences accepted and `D15.1` escalated: acceptance by
     * address match alone was reachable by whoever registered an address,
     * because nothing verified one. Both halves are now real — §3 makes every
     * `active` account's address proven, and this path requires the link as
     * well.
     *
     * The **mismatch is refused before the consume**, so a link opened in the
     * wrong browser is not spent: the person forwards nothing, signs in as the
     * invited address and follows the same link again. A refused consumption
     * spends nothing is the rule every flow in ADR-0071 §1 keeps, and this is
     * where it would be easiest to break.
     *
     * The consume itself is `acceptInvitation`'s, by id inside the same
     * transaction the token read ran in: the guarded `update` is what decides,
     * so two concurrent accepts still have one winner, and the token read
     * above is a *read* — it grants no authority the statement below does not
     * re-check.
     */
    acceptInvitationByToken: async (
      ctx: RequestContext,
      { token }: AcceptInvitationByTokenBody,
    ): Promise<OrganizationResource> => {
      const at = now();
      const account = await callerAccount(ctx);

      const joined = await transaction(async (tx) => {
        const invitation = await invitations.findPendingByTokenHash(
          sha256Base64url(token),
          at,
          tx,
        );

        if (invitation === undefined) throw invitationNotFound();

        /*
         * Exact, and **not** folded here (`D18.7`'s `security-reviewer`).
         *
         * Both sides were normalised on the way in — `emailSchema` trims and
         * lower-cases before either value was ever stored — and the column is
         * `citext` besides, so equality is the honest statement of that
         * invariant. A `toLowerCase()` on top would not add safety: JavaScript
         * folds and Postgres `lower()` under the server's locale disagree on
         * non-ASCII (the Turkish dotted and dotless I among them), and the
         * direction that disagreement runs matters — two addresses the unique
         * index holds apart, folded together here, would grant a membership to
         * a near-miss address. Comparing raw fails **closed** instead: the
         * worst a disagreement can produce is a spurious `403` on a link its
         * owner can ask to have sent again.
         */
        if (invitation.email !== account.email) {
          throw invitationAddressMismatch();
        }

        const consumed = await invitations.consume(
          invitation.organizationId,
          invitation.id,
          "acceptedAt",
          at,
          tx,
        );

        if (consumed === undefined) throw invitationNotPending();

        // The membership the invitation named, unless one is already there —
        // `acceptInvitation`'s reasoning, and the same read-back below for the
        // same reason: an existing `owner` must not be demoted to `member`.
        await memberships.create(
          invitation.organizationId,
          account.id,
          invitation.role,
          tx,
        );

        const organization = await read(invitation.organizationId, tx);
        const membership = await memberships.findFor(
          invitation.organizationId,
          account.id,
          tx,
        );

        return {
          organization,
          role: membership?.role ?? invitation.role,
          invitationId: invitation.id,
        };
      });

      ctx.logger.info(
        {
          organizationId: joined.organization.id,
          invitationId: joined.invitationId,
        },
        "organization invitation accepted from its link",
      );

      return toOrganizationResource(joined.organization, joined.role);
    },

    /** `POST /api/v1/user/invitations/:id/decline` — the same consume. */
    declineInvitation: async (
      ctx: RequestContext,
      id: string,
    ): Promise<void> => {
      const at = now();
      const account = await callerAccount(ctx);
      const invitation = await invitations.findForEmail(account.email, id);

      if (invitation === undefined) throw invitationNotFound();

      if (
        (await invitations.consume(
          invitation.organizationId,
          id,
          "declinedAt",
          at,
        )) === undefined
      ) {
        throw invitationNotPending();
      }

      ctx.logger.info(
        { organizationId: invitation.organizationId, invitationId: id },
        "organization invitation declined",
      );
    },

    /* ── the admin segment (ADR-0067 §3) ────────────────────────────────── */

    /** `GET /api/v1/admin/organizations` (ADR-0014 as carried by ADR-0060). */
    list: async (
      _ctx: RequestContext,
      query: ListQuery,
    ): Promise<Page<OrganizationResource>> => {
      const { rows, total } = await repository.list(query);

      return toPage(
        query,
        // `null` throughout: staff are never members (ADR-0067 §3), so there
        // is no role to report and the field says so rather than being absent
        // on one segment and present on the other.
        rows.map((row) => toOrganizationResource(row, null)),
        total,
      );
    },

    /**
     * `GET /api/v1/admin/organizations/:id/memberships`.
     *
     * The existence read is what separates this from the user segment's twin:
     * there `requireMembership` has already proved the organization is live and
     * the caller is in it, and here nothing has. Without it a mistyped or stale
     * id would answer `200` with an empty page while `GET /:id` on the same
     * prefix answers `404`, and a screen would render an empty members table
     * instead of not-found (`D15.3`'s review).
     *
     * `findAnyById`, so a soft-deleted organization lists its members the way
     * it answers `GET /:id`: staff who can open one must be able to see who was
     * in it.
     */
    listMembersForStaff: async (
      _ctx: RequestContext,
      organizationId: string,
      query: ListQuery,
    ): Promise<Page<MembershipResource>> => {
      if ((await repository.findAnyById(organizationId)) === undefined) {
        throw organizationNotFound();
      }

      const { rows, total } = await memberships.list(organizationId, query);

      return toPage(query, rows.map(toMembershipResource), total);
    },

    /**
     * `GET /api/v1/admin/organizations/:id` — soft-deleted rows included.
     *
     * The `users` reading: staff may list deleted organizations, so staff must
     * be able to open one, and a `404` for a row they were just shown is the
     * worse lie.
     */
    getAnyById: async (
      _ctx: RequestContext,
      id: string,
    ): Promise<OrganizationResource> => {
      const record = await repository.findAnyById(id);

      if (record === undefined) throw organizationNotFound();

      return toOrganizationResource(record, null);
    },

    /**
     * `POST /api/v1/admin/organizations` — staff create one for an account.
     *
     * It names an owner and the user-segment create does not, because staff
     * are never members (ADR-0067 §3): somebody has to be the owner of an
     * organization staff bring into existence, and it cannot be the operator.
     * `kind` is not a field — a `personal` organization is the system's to
     * create, exactly one per account.
     *
     * The account is checked inside the transaction rather than left to the
     * foreign key: a `500` is not the answer an admin naming a wrong id is
     * owed. Accounts are soft-deleted and never hard-deleted, so the check and
     * the insert cannot disagree.
     */
    createForOwner: async (
      ctx: RequestContext,
      body: CreateOrganizationAdminBody,
    ): Promise<OrganizationResource> => {
      const created = await transaction(async (tx) => {
        const owner = await memberships.findAccount(body.ownerId, tx);

        if (owner === undefined) throw membershipNotFound();

        const organization = await repository.create(
          {
            slug: body.slug,
            name: body.name,
            kind: "team",
            createdBy: owner.id,
          },
          tx,
        );

        if (organization === undefined) return undefined;

        await memberships.create(organization.id, owner.id, "owner", tx);

        return organization;
      });

      if (created === undefined) throw organizationSlugTaken();

      ctx.logger.info(
        { organizationId: created.id, slug: created.slug },
        "organization created by staff",
      );

      return toOrganizationResource(created, null);
    },

    /**
     * `POST /api/v1/admin/organizations/:id/memberships` — by **user id**
     * (ADR-0067 §3).
     *
     * The one path that grants membership without an invitation, and it takes
     * an id rather than an address for the reason the record gives: staff
     * already list accounts, so there is nothing here to enumerate.
     */
    addMember: async (
      ctx: RequestContext,
      organizationId: string,
      userId: string,
      role: OrganizationRole,
    ): Promise<void> => {
      await transaction(async (tx) => {
        const organization = await read(organizationId, tx);

        // The admin twin of the refusal in `invite`: staff are above the
        // tenants and still may not put a second person into an organization
        // whose whole shape is one member (ADR-0067 §2).
        if (organization.kind === "personal") {
          throw personalOrganizationClosed();
        }

        const account = await memberships.findAccount(userId, tx);

        if (account === undefined) throw membershipNotFound();

        // Idempotent by the composite primary key, and the existing row wins:
        // adding somebody who is already an owner must not demote them to the
        // role this request happened to name. A role *change* is `PATCH`.
        await memberships.create(organizationId, userId, role, tx);
      });

      ctx.logger.info(
        { organizationId, userId, role },
        "organization membership added by staff",
      );
    },
  } as const;
};

export type OrganizationsService = ReturnType<
  typeof createOrganizationsService
>;
