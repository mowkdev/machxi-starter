import type {
  CreateOrganizationAdminBody,
  CreateOrganizationBody,
  ListQuery,
  MembershipResource,
  Page,
  OrganizationResource,
  OrganizationRole,
  UpdateOrganizationBody,
} from "@repo/contracts";
import { randomToken } from "@repo/crypto";
import {
  personalOrganizationName,
  personalOrganizationSlug,
  type DbExecutor,
  type PersonalOrganizationOwner,
} from "@repo/db";

import { requirePopulation } from "../../core/auth/index.js";
import { createMailDelivery } from "../../core/mail/index.js";
import type { MailSender, MailTemplates } from "../../core/mail/index.js";
import { toPage } from "../../core/http/index.js";
import type { RequestContext } from "../../core/context/index.js";
import { internal } from "../../core/errors/index.js";
import type { InvitationsRepository } from "./invitations.repository.js";
import { createOrganizationInvitationsService } from "./organizations.invitations.service.js";
import {
  callerAccountGone,
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

  /**
   * The invitation flow (ADR-0067 §2, §4, §5), composed here and returned
   * below under its own member names.
   *
   * It takes the two reads above rather than rebuilding them: "a live
   * organization, or the refusal every read of a missing one gives" and "the
   * calling account's id and address" are single definitions the whole module
   * shares, and an invitation that resolved either of them differently would
   * be a second answer to the same question.
   */
  const invitationFlow = createOrganizationInvitationsService({
    memberships,
    invitations,
    invitationTtlSec,
    transaction,
    now,
    newInvitationToken,
    mailTemplates,
    deliverDetached,
    read,
    callerAccount,
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

      // On a public route — registration, the federated callback — there is
      // no principal and no guard, so the new tenant is placed by name before
      // its first membership is written (ADR-0078 §4 as amended at `D29.4`).
      await memberships.enterOrganization(organization.id, tx);
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

        // The organization this transaction has just created is the tenant
        // its first membership is written in (ADR-0078 §4 as amended at
        // `D29.4`).
        await memberships.enterOrganization(organization.id, tx);
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

    /**
     * The invitation flow — the owner's half, the invitee's own surface and
     * the public lookup — from `organizations.invitations.service.ts`
     * (ADR-0067 §2, §4, §5; split at `D20.7`).
     *
     * Spread rather than re-declared, so each member keeps the name a
     * controller already calls it by and this service's surface is unchanged.
     */
    ...invitationFlow,

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

        // A staff request places no tenant of its own (ADR-0083 §2), and this
        // one is not under `/:id` — the organization it names is the one it
        // has just created, so it enters it before writing the owner's
        // membership, as the user segment's create does.
        await memberships.enterOrganization(organization.id, tx);
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
