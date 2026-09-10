import type { AcceptedResource } from "@repo/contracts";
import type { Request, Response } from "express";

import { respond } from "../../core/http/index.js";
import type { ValidatedRequest } from "../../core/middleware/index.js";
import type { AuthCookies } from "../auth/index.js";
import type {
  changeEmailSchema,
  changePasswordSchema,
  createUserSchema,
  deleteProfileSchema,
  deleteUserSchema,
  getUserSchema,
  listUsersSchema,
  revokeUserSessionsSchema,
  setUserPasswordSchema,
  updateProfileSchema,
  updateUserSchema,
} from "./users.schemas.js";
import type { UsersService } from "./users.service.js";

/**
 * HTTP adapters for the users module (ADR-0009).
 *
 * Two factories over one service, because they are mounted on two segments
 * with different guards. Keeping them apart means a route file can only reach
 * the handlers its segment is allowed to expose: there is no way to mount
 * `update` — which takes an id from the URL — inside `/api/v1/user/profile`,
 * because {@link createUserProfileController} does not have it.
 */

/** `/api/v1/admin/users` — staff acting on somebody else's account. */
export const createUsersController = (service: UsersService) =>
  ({
    list: async (
      req: ValidatedRequest<typeof listUsersSchema>,
      res: Response,
    ): Promise<void> => {
      respond.list(res, await service.list(req.ctx, req.valid.query));
    },

    getById: async (
      req: ValidatedRequest<typeof getUserSchema>,
      res: Response,
    ): Promise<void> => {
      respond.ok(res, await service.getById(req.ctx, req.valid.params.id));
    },

    create: async (
      req: ValidatedRequest<typeof createUserSchema>,
      res: Response,
    ): Promise<void> => {
      respond.created(res, await service.create(req.ctx, req.valid.body));
    },

    update: async (
      req: ValidatedRequest<typeof updateUserSchema>,
      res: Response,
    ): Promise<void> => {
      respond.ok(
        res,
        await service.update(req.ctx, req.valid.params.id, req.valid.body),
      );
    },

    /** `204`: the sessions are gone, and there is nothing to say about it. */
    revokeSessions: async (
      req: ValidatedRequest<typeof revokeUserSessionsSchema>,
      res: Response,
    ): Promise<void> => {
      await service.revokeSessions(req.ctx, req.valid.params.id);
      respond.noContent(res);
    },

    /**
     * `204`: the password is set and every session of the subject is gone.
     * Reporting how many were revoked would tell the caller how many devices
     * the account was signed in on, which is of no use to them.
     */
    setPassword: async (
      req: ValidatedRequest<typeof setUserPasswordSchema>,
      res: Response,
    ): Promise<void> => {
      await service.setPassword(req.ctx, req.valid.params.id, req.valid.body);
      respond.noContent(res);
    },

    /**
     * `204`: the account is soft-deleted. The row survives and stays readable
     * through `GET /:id`, so there is nothing new to tell the caller — and a
     * body here would invite a client to treat the response as the account's
     * final state rather than as confirmation (ADR-0012).
     */
    remove: async (
      req: ValidatedRequest<typeof deleteUserSchema>,
      res: Response,
    ): Promise<void> => {
      await service.remove(req.ctx, req.valid.params.id);
      respond.noContent(res);
    },
  }) as const;

export type UsersController = ReturnType<typeof createUsersController>;

export interface UserProfileControllerDeps {
  readonly service: UsersService;
  /**
   * This deployment's cookie writers (ADR-0064 §1). Self-deletion clears the
   * user population's cookies, so this controller needs the same bundle the
   * auth controller writes with — one built object, so a clear can never name
   * a cookie a write did not.
   */
  readonly cookies: AuthCookies;
}

/** `/api/v1/user/profile` — a user acting on their own account. */
export const createUserProfileController = ({
  service,
  cookies,
}: UserProfileControllerDeps) =>
  ({
    /** No `:id` and no schema: the account is `ctx.principal` (ADR-0019 §3). */
    get: async (req: Request, res: Response): Promise<void> => {
      respond.ok(res, await service.getProfile(req.ctx));
    },

    update: async (
      req: ValidatedRequest<typeof updateProfileSchema>,
      res: Response,
    ): Promise<void> => {
      respond.ok(res, await service.updateProfile(req.ctx, req.valid.body));
    },

    /**
     * `204`: the password changed and the other sessions ended. Returning how
     * many were revoked would tell a caller who just proved they hold the
     * password how many devices to expect to be signed out — true, but of no
     * use to the legitimate owner and a hint to anybody else.
     */
    changePassword: async (
      req: ValidatedRequest<typeof changePasswordSchema>,
      res: Response,
    ): Promise<void> => {
      await service.changePassword(req.ctx, req.valid.body);
      respond.noContent(res);
    },

    /**
     * `202`: a link is on its way to the new address and **nothing has
     * changed** (ADR-0071 §6).
     *
     * The status is the whole of what this endpoint promises. `200` would say
     * the address moved, which it has not and must not — the caller has typed
     * a mailbox they may not own — and `204` would say the same thing more
     * quietly. `202` is the shape `register` and both `forgot` endpoints
     * already use for "accepted, and the rest happens in a mailbox".
     *
     * Unlike those three, this one is **not** an oracle-free answer and does
     * not have to be: the caller is authenticated, and `409 USER_EMAIL_TAKEN`
     * tells them only that somebody holds an address they were about to move
     * to — which they will discover from the flow's failure anyway, and which
     * they can only act on if they are told (ADR-0020 §Enumeration bounds what
     * an *anonymous* caller may learn).
     */
    changeEmail: async (
      req: ValidatedRequest<typeof changeEmailSchema>,
      res: Response,
    ): Promise<void> => {
      await service.requestEmailChange(req.ctx, req.valid.body);
      respond.accepted<AcceptedResource>(res, { accepted: true });
    },

    /**
     * `204`: the account is closed and every session of it, this one included,
     * is gone (ADR-0055 §4).
     *
     * The cookies go with it. `cookies.clearAuthCookies` is what `logout` and
     * `logout-all` call, for a reason that applies here with nothing left to
     * argue: the refresh cookie is scoped to `/api/v1/user/auth`, so it is not
     * even sent to this request, and a browser that keeps it would spend a
     * `RATE_LIMIT_REFRESH_MAX` failure on it at every boot until it expires on
     * its own. Revoking the session server-side and leaving the credential in
     * the browser would make "signed out everywhere" true of the database and
     * false of the device the person is holding.
     *
     * `"user"` is written rather than injected because this factory has one
     * mount by construction — it is the segment's controller, and ADR-0028
     * rule 4 means no staff mirror of this handler will ever exist.
     *
     * It clears **the user population's** CSRF cookie and no other. That was
     * the plan's finding 6 and is now ADR-0056: the cookie used to be one
     * host-wide `__Host-<app>.csrf`, so closing a customer account removed
     * the CSRF token of an admin panel signed in in another tab. Since the
     * split there is nothing here that an admin session can notice, and since
     * `D14.7` the name's leading word comes from `APP_ID` (ADR-0064 §1).
     */
    remove: async (
      req: ValidatedRequest<typeof deleteProfileSchema>,
      res: Response,
    ): Promise<void> => {
      await service.deleteProfile(req.ctx, req.valid.body);
      cookies.clearAuthCookies(req, res, "user");
      respond.noContent(res);
    },
  }) as const;

export type UserProfileController = ReturnType<
  typeof createUserProfileController
>;
