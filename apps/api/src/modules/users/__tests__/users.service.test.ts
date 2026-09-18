import { describe, expect, it } from "vitest";

import { REVOKE_REASONS } from "../../auth/index.js";

import {
  ACTOR_PASSWORD,
  adminCtx,
  build,
  CUSTOMER_URL,
  emptyQuery,
  expectAppError,
  MINTED_TOKEN,
  OTHER_ID,
  selfCtx,
  SESSION_ID,
  USER_ID,
  userRow,
} from "./users.service.harness.js";

/**
 * The users module against fake repositories (ADR-0021 §Unit).
 *
 * One service serves two segments, and the rules worth isolating here are the
 * ones that keep them apart: the admin functions take an id, the profile
 * functions read `ctx.principal` and can therefore never act on somebody else
 * (ADR-0019 §3). The change-password sequence gets the most attention — it is
 * the only place in the step that verifies a credential.
 *
 * The account's own lifecycle — `create`, `remove` and `deleteProfile` — moved
 * to `users.lifecycle.service.test.ts` at `D20.7` with the code it proves; the
 * fakes both suites build on are in `users.service.harness.ts`.
 */
describe("createUsersService — the admin segment", () => {
  describe("list", () => {
    it("returns a page that echoes the resolved query for `meta`", async () => {
      const { service } = build([userRow(), userRow({ id: OTHER_ID })]);

      const page = await service.list(adminCtx(), emptyQuery());

      expect(page.items).toHaveLength(2);
      expect(page).toMatchObject({ total: 2, offset: 0, limit: 20 });
    });

    it("keeps the password hash out of the page", async () => {
      const { service } = build([userRow()]);

      const page = await service.list(adminCtx(), emptyQuery());

      expect(page.items[0]).not.toHaveProperty("passwordHash");
      expect(JSON.stringify(page)).not.toContain("hashed:");
    });
  });

  describe("getById", () => {
    it("returns the resource", async () => {
      const { service } = build([userRow()]);

      await expect(service.getById(adminCtx(), USER_ID)).resolves.toMatchObject(
        { id: USER_ID, email: "customer@machxi.local", roles: ["customer"] },
      );
    });

    it("still returns a soft-deleted account", async () => {
      // An admin who can list deleted accounts must be able to open one;
      // answering 404 for a row they were just shown is the worse lie.
      const { service } = build([userRow({ deleted: true })]);

      await expect(service.getById(adminCtx(), USER_ID)).resolves.toMatchObject(
        { id: USER_ID },
      );
    });

    it("answers NOT_FOUND for an unknown id", async () => {
      const { service } = build([]);

      await expectAppError(
        () => service.getById(adminCtx(), USER_ID),
        "NOT_FOUND",
        404,
      );
    });
  });

  describe("update", () => {
    it("clears a name when the patch sends null", async () => {
      // The column is nullable, so "unset it" is a legal request that must be
      // distinguishable from "leave it".
      const { service } = build([userRow()]);

      await expect(
        service.update(adminCtx(), USER_ID, { firstName: null }),
      ).resolves.toMatchObject({ firstName: null, lastName: "Customer" });
    });

    it("leaves a name alone when the patch omits it", async () => {
      const { service } = build([userRow()]);

      await expect(
        service.update(adminCtx(), USER_ID, { lastName: "Renamed" }),
      ).resolves.toMatchObject({ firstName: "Cleo", lastName: "Renamed" });
    });

    it("replaces the role set", async () => {
      const { service, repo } = build([userRow({ roles: [] })]);

      await service.update(adminCtx(), USER_ID, { roles: ["customer"] });

      expect(repo.rows.get(USER_ID)?.roles).toEqual(["customer"]);
    });

    it("leaves the roles alone when the patch does not mention them", async () => {
      const { service, repo } = build([userRow()]);

      await service.update(adminCtx(), USER_ID, { firstName: "Cleopatra" });

      expect(repo.calls.replaceRoles).toBe(0);
    });

    it("revokes every session when an active account is disabled", async () => {
      const { service, sessions } = build([userRow()]);

      await service.update(adminCtx(), USER_ID, { status: "disabled" });

      expect(sessions.revocations).toEqual([
        {
          principalId: USER_ID,
          reason: REVOKE_REASONS.accountDisabled,
          exceptSessionId: undefined,
        },
      ]);
    });

    it("revokes when the role set changes", async () => {
      // Roles ride in the token's claims, so revoking is what makes the change
      // take effect rather than waiting out `JWT_ACCESS_TTL` (ADR-0018).
      const { service, sessions } = build([userRow()]);

      await service.update(adminCtx(), USER_ID, { roles: ["customer"] });

      expect(sessions.revocations).toEqual([]);

      const cleared = build([userRow({ roles: [] })]);

      await cleared.service.update(adminCtx(), USER_ID, {
        roles: ["customer"],
      });

      expect(cleared.sessions.revocations).toEqual([
        {
          principalId: USER_ID,
          reason: REVOKE_REASONS.rolesChanged,
          exceptSessionId: undefined,
        },
      ]);
    });

    it("does not revoke when the account was already inactive", async () => {
      const { service, sessions } = build([userRow({ status: "disabled" })]);

      await service.update(adminCtx(), USER_ID, { status: "disabled" });

      expect(sessions.revocations).toEqual([]);
    });

    it("answers NOT_FOUND for an unknown id", async () => {
      const { service } = build([]);

      await expectAppError(
        () => service.update(adminCtx(), USER_ID, { firstName: "Ghost" }),
        "NOT_FOUND",
        404,
      );
    });
  });

  describe("revokeSessions", () => {
    it("revokes with the admin reason", async () => {
      const { service, sessions } = build([userRow()]);

      await service.revokeSessions(adminCtx(), USER_ID);

      expect(sessions.revocations).toEqual([
        {
          principalId: USER_ID,
          reason: REVOKE_REASONS.adminRevoke,
          exceptSessionId: undefined,
        },
      ]);
    });

    it("answers NOT_FOUND for an unknown id rather than a silent success", async () => {
      const { service, sessions } = build([]);

      await expectAppError(
        () => service.revokeSessions(adminCtx(), USER_ID),
        "NOT_FOUND",
        404,
      );
      expect(sessions.revocations).toEqual([]);
    });
  });
});

describe("createUsersService — the user segment", () => {
  describe("getProfile", () => {
    it("reads the account from `ctx.principal`, not from an argument", async () => {
      const { service } = build([
        userRow(),
        userRow({ id: OTHER_ID, email: "other@machxi.local" }),
      ]);

      await expect(service.getProfile(selfCtx())).resolves.toMatchObject({
        id: USER_ID,
        email: "customer@machxi.local",
      });
    });

    it("refuses a staff principal", async () => {
      // A staff principal here can only come from a router mounted with the
      // wrong guard, and it answers 401 — never 403, which would confirm the
      // route exists to the wrong population (ADR-0019 §1).
      const { service } = build([userRow()]);

      await expectAppError(
        () => service.getProfile(adminCtx()),
        "UNAUTHENTICATED",
        401,
      );
    });

    it("answers NOT_FOUND once the account is soft-deleted", async () => {
      // `authenticate` verifies the session, not the account, so a deletion
      // inside the token's lifetime is only caught here.
      const { service } = build([userRow({ deleted: true })]);

      await expectAppError(
        () => service.getProfile(selfCtx()),
        "NOT_FOUND",
        404,
      );
    });
  });

  describe("updateProfile", () => {
    it("updates only the caller's own row", async () => {
      const { service, repo } = build([
        userRow(),
        userRow({ id: OTHER_ID, firstName: "Other" }),
      ]);

      await service.updateProfile(selfCtx(), { firstName: "Cleopatra" });

      expect(repo.rows.get(USER_ID)?.firstName).toBe("Cleopatra");
      expect(repo.rows.get(OTHER_ID)?.firstName).toBe("Other");
    });

    it("clears a name when the body sends null", async () => {
      const { service } = build([userRow()]);

      await expect(
        service.updateProfile(selfCtx(), { lastName: null }),
      ).resolves.toMatchObject({ lastName: null });
    });

    it("refuses a soft-deleted account before writing anything", async () => {
      const { service, repo } = build([userRow({ deleted: true })]);

      await expectAppError(
        () => service.updateProfile(selfCtx(), { firstName: "Ghost" }),
        "NOT_FOUND",
        404,
      );
      expect(repo.rows.get(USER_ID)?.firstName).toBe("Cleo");
    });
  });

  describe("changePassword", () => {
    const body = {
      currentPassword: "CurrentPassword!1",
      newPassword: "BrandNewPassword!2",
    } as const;

    it("stores the new hash", async () => {
      const { service, repo } = build([userRow()]);

      await service.changePassword(selfCtx(), body);

      expect(repo.rows.get(USER_ID)?.passwordHash).toBe(
        "hashed:BrandNewPassword!2",
      );
    });

    it("revokes every other session and spares the caller's own", async () => {
      // A password change is how somebody ends a session they no longer
      // control, so leaving the others alive would defeat the point — and
      // logging out the device in hand is a worse experience for no gain,
      // since that session is the one they just proved they own.
      const { service, sessions } = build([userRow()]);

      await service.changePassword(selfCtx(), body);

      expect(sessions.revocations).toEqual([
        {
          principalId: USER_ID,
          reason: REVOKE_REASONS.passwordChanged,
          exceptSessionId: SESSION_ID,
        },
      ]);
    });

    it("answers AUTH_CURRENT_PASSWORD_INVALID when the current password is wrong", async () => {
      const { service } = build([userRow()]);

      await expectAppError(
        () =>
          service.changePassword(selfCtx(), {
            currentPassword: "NotThePassword!9",
            newPassword: body.newPassword,
          }),
        "AUTH_CURRENT_PASSWORD_INVALID",
        403,
      );
    });

    it("writes nothing and revokes nothing when verification fails", async () => {
      const { service, repo, sessions } = build([userRow()]);

      await expect(
        service.changePassword(selfCtx(), {
          currentPassword: "NotThePassword!9",
          newPassword: body.newPassword,
        }),
      ).rejects.toThrow();

      expect(repo.calls.updatePasswordHash).toBe(0);
      expect(sessions.revocations).toEqual([]);
    });

    it("refuses an account that has no password at all", async () => {
      // `null` means "no password login" (ADR-0017), never "any password
      // matches" — and it fails through the same answer a wrong password gets.
      const { service, hasher } = build([userRow({ passwordHash: null })]);

      await expectAppError(
        () => service.changePassword(selfCtx(), body),
        "AUTH_CURRENT_PASSWORD_INVALID",
        403,
      );
      expect(hasher.calls.verify).toBe(0);
    });

    it("refuses a staff principal", async () => {
      const { service } = build([userRow()]);

      await expectAppError(
        () => service.changePassword(adminCtx(), body),
        "UNAUTHENTICATED",
        401,
      );
    });
  });

  /* -- D18.9: a person changes their own address (ADR-0071 §6) ------------- */

  describe("requestEmailChange", () => {
    const body = {
      newEmail: "moved@machxi.local",
      currentPassword: "CurrentPassword!1",
    } as const;

    it("changes nothing, mints the address into the token and mails the new one", async () => {
      const { service, repo, tokens, mail } = build([userRow()]);

      await service.requestEmailChange(selfCtx(), body);

      // The claim the whole flow rests on: asking is not moving.
      expect(repo.rows.get(USER_ID)?.email).toBe("customer@machxi.local");

      expect(tokens.mints).toEqual([
        {
          purpose: "change_email",
          principalId: USER_ID,
          // The address waits here until somebody proves it, and the locale
          // rides with it so the anonymous confirmation can write the old
          // address's notice in this account's language (ADR-0071 §1, §2).
          payload: { newEmail: body.newEmail, locale: "lv" },
        },
      ]);

      expect(mail.sent).toHaveLength(1);
      expect(mail.sent[0]?.to).toBe(body.newEmail);
      // The link's shape, against the real templates: the token is after the
      // `#` and nowhere a server log, a proxy or a `Referer` could see it.
      expect(mail.sent[0]?.text).toContain(
        `${CUSTOMER_URL}/confirm-email#token=${MINTED_TOKEN}`,
      );
    });

    it("refuses a wrong current password before minting or mailing anything", async () => {
      const { service, tokens, mail } = build([userRow()]);

      await expect(
        service.requestEmailChange(selfCtx(), {
          ...body,
          currentPassword: "not-the-password",
        }),
      ).rejects.toMatchObject({ code: "AUTH_CURRENT_PASSWORD_INVALID" });

      expect(tokens.mints).toHaveLength(0);
      expect(mail.sent).toHaveLength(0);
    });

    it("refuses an account with no password login rather than admitting it", async () => {
      // `null` means "no password login" (ADR-0017) and never "any password
      // matches" — `changePassword`'s and `deleteProfile`'s rule exactly.
      const { service, tokens } = build([userRow({ passwordHash: null })]);

      await expect(
        service.requestEmailChange(selfCtx(), body),
      ).rejects.toMatchObject({ code: "AUTH_CURRENT_PASSWORD_INVALID" });

      expect(tokens.mints).toHaveLength(0);
    });

    it("refuses an address a live account already holds, the caller's own included", async () => {
      const { service, tokens, mail } = build([
        userRow(),
        userRow({ id: OTHER_ID, email: body.newEmail }),
      ]);

      await expect(
        service.requestEmailChange(selfCtx(), body),
      ).rejects.toMatchObject({ code: "USER_EMAIL_TAKEN" });

      await expect(
        service.requestEmailChange(selfCtx(), {
          ...body,
          newEmail: "customer@machxi.local",
        }),
      ).rejects.toMatchObject({ code: "USER_EMAIL_TAKEN" });

      expect(tokens.mints).toHaveLength(0);
      expect(mail.sent).toHaveLength(0);
    });

    it("accepts an address only a soft-deleted account holds", async () => {
      // The partial unique index releases an address on soft deletion
      // (ADR-0028), so a deleted row holding the string is not a conflict.
      const { service, tokens } = build([
        userRow(),
        userRow({ id: OTHER_ID, email: body.newEmail, deleted: true }),
      ]);

      await service.requestEmailChange(selfCtx(), body);

      expect(tokens.mints).toHaveLength(1);
    });
  });

  describe("writes aimed at a deleted account (ADR-0028)", () => {
    /**
     * `409`, not `404`: the account exists and the caller may still read it.
     * What conflicts is the state of the row — the same distinction
     * `STAFF_LAST_SUPER_ADMIN` draws.
     */
    it("refuses PATCH, so no row can be active and deleted at once", async () => {
      // The bug this closes: `update` read through `readAny`, which tolerates a
      // deleted row, so an admin could set one back to `active` without
      // clearing `deleted_at`.
      const { service, repo } = build([userRow({ deleted: true })]);

      await expectAppError(
        () => service.update(adminCtx(), USER_ID, { status: "active" }),
        "USER_DELETED",
        409,
      );

      expect(repo.rows.get(USER_ID)?.status).toBe("active");
      expect(repo.rows.get(USER_ID)?.deleted).toBe(true);
    });

    it("refuses a session revoke", async () => {
      const { service, sessions } = build([userRow({ deleted: true })]);

      await expectAppError(
        () => service.revokeSessions(adminCtx(), USER_ID),
        "USER_DELETED",
        409,
      );
      expect(sessions.revocations).toEqual([]);
    });

    it("refuses a password reset, and buys no hash doing it", async () => {
      const { service, repo, hasher } = build([userRow({ deleted: true })]);

      await expectAppError(
        () =>
          service.setPassword(adminCtx(), USER_ID, {
            password: "ResetByAdmin!2026",
            currentPassword: ACTOR_PASSWORD,
          }),
        "USER_DELETED",
        409,
      );

      expect(repo.calls.updatePasswordHash).toBe(0);
      expect(hasher.calls.hash).toBe(0);
    });

    it("still reads through getById, because an admin may open one", async () => {
      // Answering `404` for a row the admin list just showed them would be the
      // worse lie; the read path keeps the tolerance the write path drops.
      const { service } = build([userRow({ deleted: true })]);

      const resource = await service.getById(adminCtx(), USER_ID);

      expect(resource.id).toBe(USER_ID);
      expect(resource.deletedAt).not.toBeNull();
    });
  });

  /* -- D2.3: the administrative reset (ADR-0027) --------------------------- */

  describe("setPassword", () => {
    const body = {
      password: "ResetByAdmin!2026",
      currentPassword: ACTOR_PASSWORD,
    };

    it("sets the password and ends every one of the subject's sessions", async () => {
      // No exception for anybody, unlike `changePassword`: the subject proved
      // nothing here, and the plausible reason for a reset is that the account
      // is compromised (ADR-0027 rule 3).
      const { service, repo, sessions } = build([userRow()]);

      await service.setPassword(adminCtx(), USER_ID, body);

      expect(repo.rows.get(USER_ID)?.passwordHash).toBe(
        "hashed:ResetByAdmin!2026",
      );
      expect(sessions.revocations).toEqual([
        {
          principalId: USER_ID,
          reason: REVOKE_REASONS.passwordReset,
          exceptSessionId: undefined,
        },
      ]);
    });

    it("requires the acting staff member's own password", async () => {
      const { service, repo, sessions } = build([userRow()]);

      await expectAppError(
        () =>
          service.setPassword(adminCtx(), USER_ID, {
            ...body,
            currentPassword: "not-the-password",
          }),
        "AUTH_CURRENT_PASSWORD_INVALID",
        403,
      );

      expect(repo.calls.updatePasswordHash).toBe(0);
      expect(sessions.revocations).toEqual([]);
    });

    it("asks the staff service, because the actor is not of this population", async () => {
      // `ctx.principal` here is staff, so this service cannot verify the
      // credential itself; it reaches the staff module through its service
      // rather than reading the `staff` table (ADR-0009, ADR-0027 rule 1).
      const { service, actors } = build([userRow()]);

      await service.setPassword(adminCtx(), USER_ID, body);

      expect(actors.calls.verifyActorPassword).toBe(1);
    });

    it("checks the actor before the subject, so it cannot be used to probe ids", async () => {
      const { service } = build([]);

      await expectAppError(
        () =>
          service.setPassword(adminCtx(), OTHER_ID, {
            ...body,
            currentPassword: "not-the-password",
          }),
        "AUTH_CURRENT_PASSWORD_INVALID",
        403,
      );
    });

    it("answers NOT_FOUND for an unknown id once the actor verifies", async () => {
      const { service, sessions } = build([userRow()]);

      await expectAppError(
        () => service.setPassword(adminCtx(), OTHER_ID, body),
        "NOT_FOUND",
        404,
      );
      expect(sessions.revocations).toEqual([]);
    });

    it("buys no hash for a request it is going to refuse", async () => {
      const { service, hasher } = build([userRow()]);

      await expect(
        service.setPassword(adminCtx(), USER_ID, {
          ...body,
          currentPassword: "not-the-password",
        }),
      ).rejects.toBeDefined();

      expect(hasher.calls.hash).toBe(0);
    });

    it("takes no `currentPassword` of the subject, so a null hash is no obstacle", async () => {
      // The subject is not being asked to prove anything, so an account with
      // no password login (ADR-0017) can still be given one.
      const { service, repo } = build([userRow({ passwordHash: null })]);

      await service.setPassword(adminCtx(), USER_ID, body);

      expect(repo.rows.get(USER_ID)?.passwordHash).toBe(
        "hashed:ResetByAdmin!2026",
      );
    });
  });
});
