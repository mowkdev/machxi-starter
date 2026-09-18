import type {
  AcceptInvitationByTokenBody,
  CreateInvitationBody,
  InvitationLookupResource,
  InvitationResource,
  ListQuery,
  LookupInvitationBody,
  OrganizationResource,
  Page,
} from "@repo/contracts";
import { sha256Base64url } from "@repo/crypto";
import type { DbExecutor } from "@repo/db";

import { requirePopulation } from "../../core/auth/index.js";
import type { RequestContext } from "../../core/context/index.js";
import { toPage } from "../../core/http/index.js";
import { localeFor } from "../../core/mail/index.js";
import type { MailDelivery, MailTemplates } from "../../core/mail/index.js";
import type { InvitationsRepository } from "./invitations.repository.js";
import type { MembershipsRepository } from "./memberships.repository.js";
import {
  alreadyAMember,
  invitationAddressMismatch,
  invitationAlreadyPending,
  invitationNotFound,
  invitationNotPending,
  personalOrganizationClosed,
} from "./organizations.errors.js";
import {
  toInvitationLookupResource,
  toInvitationResource,
  toOrganizationResource,
} from "./organizations.mapper.js";
import type { OrganizationRecord } from "./organizations.repository.js";

/**
 * The invitation flow (ADR-0067 §2, §4, §5; ADR-0071 §5).
 *
 * Split out of `organizations.service.ts` at `D20.7` along the section marker
 * that was already in it: the owner's half — create, list, revoke — and the
 * invitee's own self-scoped surface, which is outside the `/orgs/:orgId`
 * prefix because the caller is asking about their address rather than about an
 * organization they can already name (§4). The public lookup (ADR-0071 §5)
 * comes with them, because it reads the same row by the same token the accept
 * spends.
 *
 * `createOrganizationsService` composes this and returns its members under
 * their own names, so nothing outside the module knows the file exists.
 */

export interface OrganizationInvitationsServiceDeps {
  readonly memberships: MembershipsRepository;
  readonly invitations: InvitationsRepository;
  /** `ORGANIZATION_INVITATION_TTL` (ADR-0004, ADR-0067 §2). */
  readonly invitationTtlSec: number;
  /** Runs `fn` inside one database transaction (ADR-0006). */
  readonly transaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  readonly now: () => Date;
  /** The invitation's opaque token, minted per row — see `OrganizationsServiceDeps`. */
  readonly newInvitationToken: () => string;
  /** ADR-0071 §2's messages, built from the two SPA origins at the root. */
  readonly mailTemplates: MailTemplates;
  /**
   * The detached send `createOrganizationsService` builds over ADR-0066 §1's
   * port, so the whole module delivers through one delivery.
   */
  readonly deliverDetached: MailDelivery["deliverDetached"];
  /**
   * The two reads `createOrganizationsService` builds once: a live
   * organization or the refusal every read of a missing one gives, and the
   * calling account's id and **address**, which is what the invitee's own
   * surface is scoped by (ADR-0067 §5). Passed in rather than rebuilt, so
   * there is one definition of each.
   */
  readonly read: (id: string, tx?: DbExecutor) => Promise<OrganizationRecord>;
  readonly callerAccount: (
    ctx: RequestContext,
    tx?: DbExecutor,
  ) => Promise<{ readonly id: string; readonly email: string }>;
}

export const createOrganizationInvitationsService = ({
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
}: OrganizationInvitationsServiceDeps) =>
  ({
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
  }) as const;

export type OrganizationInvitationsService = ReturnType<
  typeof createOrganizationInvitationsService
>;
