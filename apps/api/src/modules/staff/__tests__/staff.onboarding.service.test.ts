import { describe, expect, it } from "vitest";

import {
  ACTOR_ID,
  ADMIN_ID,
  adminRow,
  build,
  contextFor,
  ctx,
  expectAppError,
  INVITED_ID,
  type FakeStaffRow,
} from "./staff.service.harness.js";

/**
 * Staff onboarding against fake repositories (ADR-0021 §Unit).
 *
 * The cases that moved here at `D20.7` with `staff.onboarding.service.ts`:
 * ADR-0071 §8's two endpoints, the `invited` row and the link that makes it
 * usable. They are still driven through `createStaffService` — the split
 * changed which file a function is written in and nothing a caller can see —
 * so the harness is the one in `staff.service.harness.ts` and the describe
 * keeps the name the whole suite has always used.
 */

describe("createStaffService", () => {
  describe("create", () => {
    it("hashes the password and grants the requested roles", async () => {
      const { service, hasher, repo } = build([]);

      const created = await service.create(ctx(), {
        email: "new@machxi.local",
        password: "InitialPassword!1",
        firstName: "Nina",
        lastName: "New",
        roles: ["manager", "editor"],
      });

      expect(hasher.calls.hash).toBe(1);
      expect(created.roles).toEqual(["manager", "editor"]);
      expect(created.status).toBe("active");
      expect(repo.rows.get(created.id)?.passwordHash).toBe(
        "hashed:InitialPassword!1",
      );
    });

    it("records who granted the roles", async () => {
      // `staff_roles.granted_by` exists to answer "who made this person an
      // admin" (ADR-0017); it can only come from `ctx.principal`.
      const { service, repo } = build([]);

      const created = await service.create(ctx(), {
        email: "new@machxi.local",
        password: "InitialPassword!1",
        firstName: "Nina",
        lastName: "New",
        roles: ["editor"],
      });

      expect(repo.grants).toEqual([
        { staffId: created.id, grantedBy: ACTOR_ID },
      ]);
    });

    it("answers STAFF_EMAIL_TAKEN for a duplicate address", async () => {
      const { service } = build([adminRow()]);

      await expectAppError(
        () =>
          service.create(ctx(), {
            email: "admin@machxi.local",
            password: "InitialPassword!1",
            firstName: "Ada",
            lastName: "Twin",
            roles: ["editor"],
          }),
        "STAFF_EMAIL_TAKEN",
        409,
      );
    });

    it("refuses a caller who is not a staff principal", async () => {
      // Only reachable through a router mounted with the wrong guard, and it
      // answers 401 rather than crashing (ADR-0019, amended step 8).
      const { service } = build([]);

      await expectAppError(
        () =>
          service.create(contextFor(null), {
            email: "new@machxi.local",
            password: "InitialPassword!1",
            firstName: "Nina",
            lastName: "New",
            roles: ["editor"],
          }),
        "UNAUTHENTICATED",
        401,
      );
    });

    /* ── the invitation half (ADR-0071 §8) ──────────────────────────────── */

    it("creates an invited row with no hash and mails the link", async () => {
      const { service, hasher, repo, tokens, mail } = build([]);

      const created = await service.create(ctx(), {
        email: "invitee@machxi.local",
        firstName: "Ivy",
        lastName: "Invited",
        roles: ["editor"],
      });

      expect(created.status).toBe("invited");
      // No password in the body is no argon2 at all — the one place this
      // endpoint got cheaper rather than more expensive.
      expect(hasher.calls.hash).toBe(0);
      expect(repo.rows.get(created.id)?.passwordHash).toBeNull();
      expect(tokens.minted).toEqual([
        { purpose: "staff_onboarding", principalId: created.id },
      ]);
      expect(mail.sent).toEqual([
        { to: "invitee@machxi.local", subject: "Set up your account" },
      ]);
    });

    it("mails nothing when a password was supplied", async () => {
      // The two halves of one endpoint, and this is the assertion that keeps
      // them apart: an `active` account's credential was handed over out of
      // band, so a message here would be a link nobody needs to a mailbox
      // nobody asked to involve.
      const { service, tokens, mail } = build([]);

      await service.create(ctx(), {
        email: "typed@machxi.local",
        password: "InitialPassword!1",
        firstName: "Tom",
        lastName: "Typed",
        roles: ["editor"],
      });

      expect(tokens.minted).toEqual([]);
      expect(mail.sent).toEqual([]);
    });

    it("mints nothing when the address is taken", async () => {
      // The mint is inside the transaction the insert is in (ADR-0071 §1), so
      // a refused create leaves no token row and sends no message — which the
      // fake can only show because the insert resolves `undefined` rather
      // than throwing, exactly as the unique index makes it.
      const { service, tokens, mail } = build([adminRow()]);

      await expectAppError(
        () =>
          service.create(ctx(), {
            email: "admin@machxi.local",
            firstName: "Ada",
            lastName: "Twin",
            roles: ["editor"],
          }),
        "STAFF_EMAIL_TAKEN",
        409,
      );

      expect(tokens.minted).toEqual([]);
      expect(mail.sent).toEqual([]);
    });
  });

  describe("resendOnboarding", () => {
    /** An `invited` row: the only state this endpoint acts on. */
    const invitedRow = (): FakeStaffRow => ({
      id: INVITED_ID,
      email: "invitee@machxi.local",
      passwordHash: null,
      firstName: "Ivy",
      lastName: "Invited",
      status: "invited",
      roles: ["editor"],
    });

    it("re-mints and mails the row's own address", async () => {
      const { service, tokens, mail } = build([invitedRow()]);

      await service.resendOnboarding(ctx(), INVITED_ID, {});

      expect(tokens.minted).toEqual([
        { purpose: "staff_onboarding", principalId: INVITED_ID },
      ]);
      // The address on the row, never one the caller passed: this body has no
      // address field, which is what makes a stolen admin session unable to
      // redirect the link.
      expect(mail.sent).toEqual([
        { to: "invitee@machxi.local", subject: "Set up your account" },
      ]);
    });

    it("answers STAFF_NOT_INVITED for an active operator", async () => {
      const { service, tokens, mail } = build([adminRow()]);

      await expectAppError(
        () => service.resendOnboarding(ctx(), ADMIN_ID, {}),
        "STAFF_NOT_INVITED",
        409,
      );

      expect(tokens.minted).toEqual([]);
      expect(mail.sent).toEqual([]);
    });

    it("answers STAFF_NOT_INVITED for a disabled operator", async () => {
      // The sharper half of the same rule: a `disabled` account must not be
      // handed a way back in by mail, and "not invited" is the honest reason.
      const { service, mail } = build([
        { ...invitedRow(), status: "disabled" },
      ]);

      await expectAppError(
        () => service.resendOnboarding(ctx(), INVITED_ID, {}),
        "STAFF_NOT_INVITED",
        409,
      );

      expect(mail.sent).toEqual([]);
    });

    it("answers 404 for an unknown id", async () => {
      const { service } = build([]);

      await expectAppError(
        () => service.resendOnboarding(ctx(), INVITED_ID, {}),
        "NOT_FOUND",
        404,
      );
    });
  });
});
