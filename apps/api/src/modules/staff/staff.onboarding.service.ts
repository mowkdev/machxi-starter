import type {
  CreateStaffBody,
  ResendStaffOnboardingBody,
  StaffResource,
  StaffRole,
} from "@repo/contracts";
import type { DbExecutor } from "@repo/db";

import type { LimitedHasher } from "../../core/auth/index.js";
import type { RequestContext } from "../../core/context/index.js";
import { localeFor } from "../../core/mail/index.js";
import type { MailDelivery, MailTemplates } from "../../core/mail/index.js";
import type { AccountTokens } from "../../core/tokens/index.js";
import { staffEmailTaken, staffNotInvited } from "./staff.errors.js";
import { toStaffResource } from "./staff.mapper.js";
import type { StaffRecord, StaffRepository } from "./staff.repository.js";

/**
 * Staff onboarding — ADR-0071 §8's flow, in one file (ADR-0009).
 *
 * Split out of `staff.service.ts` at `D20.7`, and these two endpoints because
 * they are the whole of one flow rather than two neighbours: `POST
 * /admin/staff` with no password creates the `invited` row **and** mints the
 * link in the same commit, and `POST /admin/staff/:id/onboarding/resend`
 * replaces that link. The mint they share — the purpose and the population
 * written once — moves with them, which is what keeps "a `staff_onboarding`
 * token is minted against `{ type: "staff" }`" a fact of one file.
 *
 * The accept is not here and never was: the link is followed without a
 * session, so the auth module consumes it (ADR-0071 §1).
 *
 * `createStaffService` composes this and returns its members under their own
 * names, so `service.create` and `service.resendOnboarding` are what a
 * controller calls, as before.
 */

export interface StaffOnboardingServiceDeps {
  readonly repository: StaffRepository;
  /** Already wrapped in the process-wide concurrency cap (ADR-0020). */
  readonly hasher: LimitedHasher;
  /**
   * ADR-0071 §1's mint. Staff onboarding is this module's own flow (§8), so
   * the link an invitation carries is minted here and consumed by the auth
   * module.
   */
  readonly accountTokens: AccountTokens;
  /** ADR-0071 §2's messages, built from the two SPA origins at the root. */
  readonly mailTemplates: MailTemplates;
  /**
   * The detached send `createStaffService` builds over ADR-0066 §1's port, so
   * both halves of the module deliver through one delivery.
   */
  readonly deliverDetached: MailDelivery["deliverDetached"];
  /** Runs `fn` inside one database transaction (ADR-0006). */
  readonly transaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  /**
   * The three helpers `createStaffService` builds once: the acting staff
   * member, the `super_admin` grant rule (ADR-0017 §Invariants) and the read
   * that turns a missing row into `404`. Passed in rather than rebuilt, so
   * there is one definition of each and the rules cannot drift apart.
   */
  readonly actor: (ctx: RequestContext) => { readonly id: string };
  readonly assertMaySetSuperAdmin: (
    ctx: RequestContext,
    nextRoles: readonly StaffRole[] | undefined,
    currentRoles: readonly StaffRole[],
  ) => void;
  readonly read: (id: string, tx?: DbExecutor) => Promise<StaffRecord>;
}

export const createStaffOnboardingService = ({
  repository,
  hasher,
  accountTokens,
  mailTemplates,
  deliverDetached,
  transaction,
  actor,
  assertMaySetSuperAdmin,
  read,
}: StaffOnboardingServiceDeps) => {
  /**
   * ADR-0071 §8's link, minted for one operator.
   *
   * A named helper rather than two inline calls, so the purpose and the
   * population are written once: a `staff_onboarding` token minted against
   * `{ type: "user" }` would be a link the admin segment can never claim, and
   * the mistake would surface as a dead link in somebody's mailbox rather than
   * as a failure here.
   *
   * No payload. Unlike `change_email` (§6) there is nothing to carry: the row
   * the token names is the whole of what the accept needs, and the password
   * arrives with the request that spends it.
   */
  const mintOnboardingLink = async (
    ctx: RequestContext,
    staffId: string,
    tx?: DbExecutor,
  ): Promise<string> => {
    const { token } = await accountTokens.mint(
      ctx,
      {
        purpose: "staff_onboarding",
        principal: { type: "staff", id: staffId },
      },
      tx,
    );

    return token;
  };

  return {
    /**
     * `POST /api/v1/admin/staff` (ADR-0018 §Staff onboarding, ADR-0071 §8).
     *
     * **Two rows, one request, and the body decides which.** A `password`
     * makes the `active` account this endpoint has always made — the
     * credential is handed over out of band. No `password` makes an `invited`
     * one with a null hash, and an onboarding link goes to the address: the
     * operator chooses their own credential and it never travels through
     * whoever created the row. That is §8's default, and the reason there is
     * no `status` field for it to disagree with.
     *
     * The account and its grants are one transaction: a staff member who
     * exists with no role can sign in and do nothing, which is a support
     * ticket rather than a state worth being able to reach. **The token joins
     * that commit** for registration's reason (ADR-0071 §1): there must be no
     * interval in which an `invited` row exists with no way to become usable.
     *
     * The password is hashed **outside** the transaction. argon2 holds a libuv
     * thread for ~130 ms, and holding a database connection open across that
     * for no reason is how a burst of creates exhausts the pool. An invitation
     * buys no hash at all, which is the one place this endpoint got cheaper.
     *
     * **The message goes out after the commit**, which is `register`'s rule
     * exactly: a link mailed from inside a transaction that then rolls back
     * names a token row that does not exist, and its reader has no way to
     * recover on their own. Detached, because the answer reports the account
     * and never the delivery.
     */
    create: async (
      ctx: RequestContext,
      body: CreateStaffBody,
    ): Promise<StaffResource> => {
      const grantedBy = actor(ctx).id;

      // A brand-new account holds nothing yet, so any `super_admin` in the
      // body is a grant.
      assertMaySetSuperAdmin(ctx, body.roles, []);

      const invited = body.password === undefined;
      const passwordHash =
        body.password === undefined ? null : await hasher.hash(body.password);

      const created = await transaction(async (tx) => {
        const record = await repository.create(
          {
            email: body.email,
            passwordHash,
            firstName: body.firstName,
            lastName: body.lastName,
            status: invited ? "invited" : "active",
          },
          tx,
        );

        if (record === undefined) return undefined;

        await repository.replaceRoles(record.id, body.roles, grantedBy, tx);

        const token = invited
          ? await mintOnboardingLink(ctx, record.id, tx)
          : undefined;

        return { ...record, roles: body.roles, token };
      });

      if (created === undefined) throw staffEmailTaken();

      if (created.token !== undefined) {
        deliverDetached(
          ctx,
          created.email,
          { population: "staff", purpose: "staff_onboarding" },
          mailTemplates.staffOnboarding({
            token: created.token,
            locale: localeFor(body.locale),
          }),
        );
      }

      ctx.logger.info(
        { staffId: created.id, roles: created.roles, grantedBy, invited },
        "staff member created",
      );

      return toStaffResource(created);
    },

    /**
     * `POST /api/v1/admin/staff/:id/onboarding/resend` (ADR-0071 §8).
     *
     * **`invited` and nothing else.** An operator who has already chosen a
     * password has no pending invitation to replace, and a `disabled` one must
     * not be handed a way back in by mail — both answer `409
     * STAFF_NOT_INVITED` rather than a silent success, because the caller is
     * an authenticated admin looking at the row and a `204` that did nothing
     * would be a claim they cannot check.
     *
     * The mint supersedes the live token for the pair (ADR-0071 §1), so an
     * admin who presses this five times leaves one working link rather than
     * five — and the previous one stops working, which is the property that
     * makes offering "resend" safe at all.
     *
     * The status is read on the pooled client rather than inside a
     * transaction, and that is honest about what this buys: two admins
     * resending in the same instant both pass the check, and the lock inside
     * the mint serialises them so the later link is the one that works.
     * Nothing here writes the row, so there is no state for the race to leave
     * inconsistent — the cost is one extra message.
     */
    resendOnboarding: async (
      ctx: RequestContext,
      id: string,
      body: ResendStaffOnboardingBody,
    ): Promise<void> => {
      const target = await read(id);

      if (target.status !== "invited") {
        ctx.logger.warn(
          { staffId: target.id, status: target.status },
          "onboarding resend refused, the account is not invited",
        );

        throw staffNotInvited();
      }

      const token = await mintOnboardingLink(ctx, target.id);

      deliverDetached(
        ctx,
        target.email,
        { population: "staff", purpose: "staff_onboarding" },
        mailTemplates.staffOnboarding({
          token,
          locale: localeFor(body.locale),
        }),
      );

      ctx.logger.info(
        { staffId: target.id, by: actor(ctx).id },
        "onboarding link re-sent",
      );
    },
  } as const;
};

export type StaffOnboardingService = ReturnType<
  typeof createStaffOnboardingService
>;
