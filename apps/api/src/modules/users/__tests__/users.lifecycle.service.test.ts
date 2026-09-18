import { describe, expect, it } from "vitest";

import { REVOKE_REASONS } from "../../auth/index.js";

import {
  adminCtx,
  build,
  expectAppError,
  NOW,
  OTHER_ID,
  selfCtx,
  USER_ID,
  userRow,
} from "./users.service.harness.js";

/**
 * The account's own lifecycle against fake repositories (ADR-0021 §Unit).
 *
 * The cases that moved here at `D20.7` with `users.lifecycle.service.ts`: the
 * staff-side `create` and the two paths that close an account. They are still
 * driven through `createUsersService` — the split changed which file a
 * function is written in and nothing a caller can see — so the harness is the
 * one in `users.service.harness.ts` and the describes keep the names the whole
 * suite has always used.
 */

describe("createUsersService — the admin segment", () => {
  describe("create", () => {
    it("defaults the roles to `customer` when the body omits them", async () => {
      // v1 has exactly one user role, and an account with none can do nothing
      // (ADR-0017).
      const { service } = build([]);

      const created = await service.create(adminCtx(), {
        email: "new@machxi.local",
        password: "InitialPassword!1",
      });

      expect(created.roles).toEqual(["customer"]);
    });

    it("stamps the address as proven, because staff asserted it", async () => {
      // ADR-0071 §3: the operator who typed the address is the authority a
      // confirmation link would be asking, so no link is sent and the account
      // is `active` with a proven address in one statement. That is what keeps
      // "every `active` user has a proven address" true of this path too.
      const { service, repo } = build([]);

      const created = await service.create(adminCtx(), {
        email: "new@machxi.local",
        password: "InitialPassword!1",
      });

      expect(repo.rows.get(created.id)?.emailVerifiedAt).not.toBeNull();
    });

    it("leaves the stamp null when the admin asks for `pending_verification`", async () => {
      // An admin deliberately creating an account that has proven nothing —
      // the row the `--dev` fixtures carry and the backfill migration skipped.
      // Stamping it would make the column disagree with the status on the one
      // status the verification flow exists to move.
      const { service, repo } = build([]);

      const created = await service.create(adminCtx(), {
        email: "new@machxi.local",
        password: "InitialPassword!1",
        status: "pending_verification",
      });

      expect(repo.rows.get(created.id)?.emailVerifiedAt).toBeNull();
    });

    it("ensures the account's personal organization (ADR-0067 §2)", async () => {
      const { service, organizations } = build([]);

      const created = await service.create(adminCtx(), {
        email: "new@machxi.local",
        password: "InitialPassword!1",
      });

      // One of the three paths that bring a user into existence, so it must
      // create the organization; that the two writes are one *commit* is the
      // integration suite's claim, not this one's.
      expect(organizations.calls.ensured).toEqual([created.id]);
    });

    it("honours an explicit status", async () => {
      const { service } = build([]);

      await expect(
        service.create(adminCtx(), {
          email: "new@machxi.local",
          password: "InitialPassword!1",
          status: "pending_verification",
        }),
      ).resolves.toMatchObject({ status: "pending_verification" });
    });

    it("hashes the password", async () => {
      const { service, hasher, repo } = build([]);

      const created = await service.create(adminCtx(), {
        email: "new@machxi.local",
        password: "InitialPassword!1",
      });

      expect(hasher.calls.hash).toBe(1);
      expect(repo.rows.get(created.id)?.passwordHash).toBe(
        "hashed:InitialPassword!1",
      );
    });

    it("answers USER_EMAIL_TAKEN for a duplicate address", async () => {
      // Named, unlike anonymous registration, because the caller is staff who
      // can already list every address (ADR-0020 §Enumeration).
      const { service } = build([userRow()]);

      await expectAppError(
        () =>
          service.create(adminCtx(), {
            email: "customer@machxi.local",
            password: "InitialPassword!1",
          }),
        "USER_EMAIL_TAKEN",
        409,
      );
    });
  });
});

describe("createUsersService — the user segment", () => {
  /* -- D12.4: self-service deletion (ADR-0055 §4) -------------------------- */

  describe("deleteProfile", () => {
    const body = { currentPassword: "CurrentPassword!1" } as const;

    it("soft-deletes the caller's own row and disables it", async () => {
      // ADR-0028's user semantics, unchanged by the actor: the row survives
      // because future order history references it, and `status` is written
      // beside the timestamp so it stays truthful on its own.
      const { service, repo, organizations } = build([userRow()]);

      await service.deleteProfile(selfCtx(), body);

      expect(repo.rows.get(USER_ID)?.deleted).toBe(true);
      expect(repo.rows.get(USER_ID)?.status).toBe("disabled");
      // The admin path's twin: which actor closed the account does not change
      // what happens to the organization that exists only for it.
      expect(organizations.calls.deleted).toEqual([
        { userId: USER_ID, at: NOW },
      ]);
    });

    it("revokes every session, sparing none — unlike a password change", async () => {
      // The one behavioural difference between this and `changePassword`:
      // there the caller keeps the session they just proved they own, because
      // the point is to end the ones they do not control. Here there is no
      // account left to be signed in to, so `exceptSessionId` is absent from
      // both sweeps.
      const { service, sessions } = build([userRow()]);

      await service.deleteProfile(selfCtx(), body);

      expect(sessions.revocations).toEqual([
        {
          principalId: USER_ID,
          reason: REVOKE_REASONS.accountDeleted,
          exceptSessionId: undefined,
        },
        {
          principalId: USER_ID,
          reason: REVOKE_REASONS.accountDeleted,
          exceptSessionId: undefined,
        },
      ]);
    });

    it("answers AUTH_CURRENT_PASSWORD_INVALID when the password is wrong", async () => {
      const { service } = build([userRow()]);

      await expectAppError(
        () =>
          service.deleteProfile(selfCtx(), {
            currentPassword: "NotThePassword!9",
          }),
        "AUTH_CURRENT_PASSWORD_INVALID",
        403,
      );
    });

    it("deletes nothing and revokes nothing when verification fails", async () => {
      // The rule this covers is that re-authentication runs *before* the
      // write, not beside it: a hijacked tab must not be able to destroy the
      // account, and half a deletion is worse than none.
      const { service, repo, sessions } = build([userRow()]);

      await expect(
        service.deleteProfile(selfCtx(), {
          currentPassword: "NotThePassword!9",
        }),
      ).rejects.toThrow();

      expect(repo.rows.get(USER_ID)?.deleted).toBe(false);
      expect(sessions.revocations).toEqual([]);
    });

    it("refuses an account that has no password at all", async () => {
      // `null` means "no password login" (ADR-0017), never "any password
      // matches" — the same rule `changePassword` follows, and it matters more
      // here because the operation is irreversible.
      const { service, hasher, repo } = build([
        userRow({ passwordHash: null }),
      ]);

      await expectAppError(
        () => service.deleteProfile(selfCtx(), body),
        "AUTH_CURRENT_PASSWORD_INVALID",
        403,
      );
      expect(hasher.calls.verify).toBe(0);
      expect(repo.rows.get(USER_ID)?.deleted).toBe(false);
    });

    it("answers NOT_FOUND for an account that is already deleted", async () => {
      // `404` and not the admin segment's `409 USER_DELETED`: the self view
      // filters `deleted_at`, so every other profile endpoint already answers
      // `404` for this row and this one agrees with them. No hash is bought
      // for it either — the read comes first.
      const { service, sessions, hasher } = build([userRow({ deleted: true })]);

      await expectAppError(
        () => service.deleteProfile(selfCtx(), body),
        "NOT_FOUND",
        404,
      );
      expect(sessions.revocations).toEqual([]);
      expect(hasher.calls.verify).toBe(0);
    });

    it("can only ever reach the caller's own row", async () => {
      // Structural rather than checked: the function takes no id, so there is
      // nothing for a caller to tamper with (ADR-0019 §3). The second account
      // is here to make that visible rather than to be argued about.
      const { service, repo } = build([
        userRow(),
        userRow({ id: OTHER_ID, email: "someone.else@machxi.local" }),
      ]);

      await service.deleteProfile(selfCtx(), body);

      expect(repo.rows.get(OTHER_ID)?.deleted).toBe(false);
      expect(repo.rows.get(OTHER_ID)?.status).toBe("active");
    });

    it("refuses a staff principal", async () => {
      // ADR-0028 rule 4 refuses staff self-deletion outright, and this segment
      // is not where it would be built even if it existed.
      const { service } = build([userRow()]);

      await expectAppError(
        () => service.deleteProfile(adminCtx(), body),
        "UNAUTHENTICATED",
        401,
      );
    });
  });

  /* -- D2.4: soft deletion (ADR-0028) -------------------------------------- */

  describe("remove", () => {
    it("marks the row deleted, disables it, and ends every session", async () => {
      const { service, repo, sessions, organizations } = build([userRow()]);

      await service.remove(adminCtx(), USER_ID);

      expect(repo.rows.get(USER_ID)?.deleted).toBe(true);
      expect(repo.rows.get(USER_ID)?.status).toBe("disabled");
      // And the personal organization with it, stamped with the account's own
      // `at` (ADR-0067 §2).
      expect(organizations.calls.deleted).toEqual([
        { userId: USER_ID, at: NOW },
      ]);
      // Twice: once inside the transaction, and once after it commits, for a
      // login that read the account before the delete and inserts its session
      // after the first sweep has run (`login` verifies argon2 outside any
      // transaction, which is ~130 ms of window).
      expect(sessions.revocations).toEqual([
        {
          principalId: USER_ID,
          reason: REVOKE_REASONS.accountDeleted,
          exceptSessionId: undefined,
        },
        {
          principalId: USER_ID,
          reason: REVOKE_REASONS.accountDeleted,
          exceptSessionId: undefined,
        },
      ]);
    });

    it("answers NOT_FOUND for an unknown id", async () => {
      const { service, sessions } = build([userRow()]);

      await expectAppError(
        () => service.remove(adminCtx(), OTHER_ID),
        "NOT_FOUND",
        404,
      );
      expect(sessions.revocations).toEqual([]);
    });

    it("refuses the loser of a concurrent delete, rather than reporting success", async () => {
      // The read that refuses an already-deleted subject happens outside the
      // transaction, so two callers can both pass it. `softDelete` matches
      // live rows only, and its boolean is the one thing that sees the race:
      // without it the loser writes nothing and answers `204` for a request
      // ADR-0028 says is a `409`.
      const { service, repo, sessions } = build([userRow()]);

      // Stands in for the sibling transaction committing first.
      const row = repo.rows.get(USER_ID);

      if (row !== undefined) row.deleted = true;

      await expectAppError(
        () => service.remove(adminCtx(), USER_ID),
        "USER_DELETED",
        409,
      );
      expect(sessions.revocations).toEqual([]);
    });

    it("refuses a second delete with USER_DELETED rather than moving the timestamp", async () => {
      const { service, sessions } = build([userRow({ deleted: true })]);

      await expectAppError(
        () => service.remove(adminCtx(), USER_ID),
        "USER_DELETED",
        409,
      );
      expect(sessions.revocations).toEqual([]);
    });
  });
});
