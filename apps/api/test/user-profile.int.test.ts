import { successEnvelopeSchema } from "@repo/contracts";
import {
  federatedIdentities,
  organizationMemberships,
  organizations,
  users,
} from "@repo/db";
import { and, eq } from "drizzle-orm";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bearer,
  createUserAccount,
  login,
  NEW_ACCOUNT_PASSWORD,
  type Tokens,
} from "./support/actors.js";
import { createTestApp, type TestApp } from "./support/app.js";
import {
  expectNoSecrets,
  userProfileResourceSchema,
} from "./support/resources.js";
import {
  cookieValue,
  csrfCookie,
  REFRESH_COOKIE,
  setCookie,
  TRANSPORT_HEADER,
} from "./support/transport.js";
import {
  FIXTURE_PASSWORD,
  FIXTURE_USERS,
  resetAndSeed,
  superAdmin,
} from "./support/seed.js";

/**
 * `/api/v1/user/profile` — a user acting on their own account (ADR-0019 §3).
 *
 * The ownership question this segment has to answer is answered structurally:
 * there is no `:id` anywhere below, so every handler reads the account from
 * `ctx.principal` and there is nothing for a caller to tamper with. What is
 * left to check is that the *shape* of the endpoints preserves that — the
 * profile body cannot carry `status` or `roles`, and the same resource comes
 * back here as on the admin segment so a client learns one shape (ADR-0012).
 */

const userEnvelope = successEnvelopeSchema(userProfileResourceSchema);

const PROFILE = "/api/v1/user/profile";

describe("user profile", () => {
  let harness: TestApp;
  let staffTokens: Tokens;
  let customerTokens: Tokens;

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ db: harness.db, hasher: harness.hasher });

    // The super admin is only here to create the accounts the destructive
    // tests below act on, so that the shared `customer` fixture keeps the
    // password every other file signs in with.
    staffTokens = await login(harness.app, "staff", superAdmin());
    customerTokens = await login(harness.app, "user", {
      email: FIXTURE_USERS.active,
      password: FIXTURE_PASSWORD,
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  const request = () => supertest(harness.app);

  /** An account nobody else in the file touches, already signed in. */
  const freshUser = async (
    email: string,
  ): Promise<{ id: string; tokens: Tokens }> => {
    const created = await createUserAccount(
      harness.app,
      staffTokens.accessToken,
      { email, firstName: "Fresh", lastName: "User" },
    );

    return {
      id: created.id,
      tokens: await login(harness.app, "user", {
        email,
        password: NEW_ACCOUNT_PASSWORD,
      }),
    };
  };

  describe("GET /api/v1/user/profile", () => {
    it("returns the caller's own account", async () => {
      const response = await request()
        .get(PROFILE)
        .set("Authorization", bearer(customerTokens.accessToken))
        .expect(200);

      expect(userEnvelope.safeParse(response.body).success).toBe(true);
      expect(response.body.data.email).toBe(FIXTURE_USERS.active);
      expect(response.body.meta.requestId).toEqual(expect.any(String));
      expectNoSecrets(response.body);
    });

    it("says which ways in the account has, and never the subject", async () => {
      // The `--dev` customer keeps its password and carries one Google
      // identity (ADR-0072 §3): both controls the security section offers
      // are decided from these two fields.
      const response = await request()
        .get(PROFILE)
        .set("Authorization", bearer(customerTokens.accessToken))
        .expect(200);

      expect(response.body.data.hasPassword).toBe(true);
      expect(response.body.data.identities).toEqual([
        {
          provider: "google",
          email: FIXTURE_USERS.active,
          linkedAt: expect.any(String),
        },
      ]);
      expect(JSON.stringify(response.body)).not.toContain(
        "dev-fixture-google-subject",
      );
    });

    it("forbids caching personal data", async () => {
      // The router mounts `no-store` over the whole profile: this response is
      // personal data and the one below it carries two passwords (ADR-0020).
      await request()
        .get(PROFILE)
        .set("Authorization", bearer(customerTokens.accessToken))
        .expect("Cache-Control", "no-store")
        .expect(200);
    });

    it("refuses a caller with no credentials", async () => {
      const response = await request().get(PROFILE).expect(401);

      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("refuses a staff token with 401, never 403", async () => {
      // ADR-0019 §1 again, in the other direction: a staff member has no
      // profile on this segment, and must not learn that the route exists.
      const response = await request()
        .get(PROFILE)
        .set("Authorization", bearer(staffTokens.accessToken))
        .expect(401);

      expect(response.body.error.code).toBe("AUTH_TOKEN_INVALID");
    });
  });

  describe("PATCH /api/v1/user/profile", () => {
    const patch = (token: string, body: object) =>
      request().patch(PROFILE).set("Authorization", bearer(token)).send(body);

    it("updates the caller's own names", async () => {
      const { tokens } = await freshUser("patch.profile@machxi.local");

      const response = await patch(tokens.accessToken, {
        firstName: "Renamed",
        lastName: "Twice",
      }).expect(200);

      expect(userEnvelope.safeParse(response.body).success).toBe(true);
      expect(response.body.data.firstName).toBe("Renamed");
      expect(response.body.data.lastName).toBe("Twice");
    });

    it("clears a name when it is sent as null", async () => {
      const { tokens } = await freshUser("clear.profile.name@machxi.local");

      const response = await patch(tokens.accessToken, {
        firstName: null,
      }).expect(200);

      expect(response.body.data.firstName).toBeNull();
      // Only the field that was sent: `undefined` still means "leave it".
      expect(response.body.data.lastName).toBe("User");
    });

    it("rejects an empty patch", async () => {
      const response = await patch(customerTokens.accessToken, {}).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("has no field for status, so a user cannot re-enable themselves", async () => {
      // `updateProfileBody` is a strict object of two names. There is nothing
      // to reject at runtime because there is no field — the request fails as
      // an unknown key, which is the whole design (ADR-0019 §3).
      const response = await patch(customerTokens.accessToken, {
        status: "active",
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("has no field for roles, so a user cannot promote themselves", async () => {
      const response = await patch(customerTokens.accessToken, {
        firstName: "Cleo",
        roles: ["customer"],
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("has no field for email, so a user cannot change their login identifier", async () => {
      /*
       * The rule ADR-0055 §4 states as "names editable, email not", asserted
       * here for the first time at `D12.2`'s reading (`D12.3`): the two cases
       * above prove `status` and `roles` are absent, and email was left to the
       * `.strictObject` without a case of its own.
       *
       * It matters more than the other two, because email is not merely a
       * field — it is the login identifier and the unique key the partial
       * index is built on (ADR-0017), so changing it is a verification flow
       * (ADR-0027 draws the same boundary for staff) rather than a patch. An
       * unknown key is what refuses it, which is why the answer is 400 and not
       * 403: there is no rule to break because there is no field.
       */
      /*
       * **Paired with a valid key, which the sibling `roles` case does and the
       * first draft of this one did not** (`D12.3` review). `email` alone is
       * refused by two independent rules: the unknown key, and — once the
       * unknown key is stripped — `updateProfileBody`'s "not empty" refine. So
       * a `.strictObject` relaxed to `z.object` would leave this green while
       * the property the case is named for was gone. With `firstName` present
       * the patch is non-empty, and the only thing left that can refuse it is
       * the unknown key.
       */
      const response = await patch(customerTokens.accessToken, {
        firstName: "Cleo",
        email: "someone.else@machxi.local",
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("refuses a caller with no credentials", async () => {
      const response = await request()
        .patch(PROFILE)
        .send({ firstName: "Anonymous" })
        .expect(401);

      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    });
  });

  describe("POST /api/v1/user/profile/change-password", () => {
    const changePassword = (token: string, body: object) =>
      request()
        .post(`${PROFILE}/change-password`)
        .set("Authorization", bearer(token))
        .send(body);

    it("rotates the password, keeps this session and ends the others", async () => {
      const email = "rotates.password@machxi.local";
      const { tokens: first } = await freshUser(email);
      // A second device, signed in with the same credentials.
      const second = await login(harness.app, "user", {
        email,
        password: NEW_ACCOUNT_PASSWORD,
      });

      const nextPassword = "RotatedPassword!2026";

      const response = await changePassword(first.accessToken, {
        currentPassword: NEW_ACCOUNT_PASSWORD,
        newPassword: nextPassword,
      }).expect(204);

      expect(response.body).toEqual({});
      expect(response.text).toBe("");

      // The caller keeps the session they just proved they own; logging them
      // out of the device in their hand would be a worse experience for no
      // security gain.
      await request()
        .get(PROFILE)
        .set("Authorization", bearer(first.accessToken))
        .expect(200);

      // Every other session goes, because ending a session somebody else
      // controls is the reason a password gets changed.
      const other = await request()
        .get(PROFILE)
        .set("Authorization", bearer(second.accessToken))
        .expect(401);

      expect(other.body.error.code).toBe("AUTH_SESSION_REVOKED");

      // And the credential itself actually changed.
      await login(harness.app, "user", { email, password: nextPassword });

      const withOldPassword = await request()
        .post("/api/v1/user/auth/login")
        .send({ email, password: NEW_ACCOUNT_PASSWORD })
        .expect(401);

      expect(withOldPassword.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
    });

    it("refuses a wrong current password with 403, not 401", async () => {
      // The session is valid and stays valid, so a 401 would be untrue about
      // the request and would send every client interceptor that reads 401 as
      // "the session died" to the login screen over a typo (ADR-0013).
      const { tokens } = await freshUser("wrong.current@machxi.local");

      const response = await changePassword(tokens.accessToken, {
        currentPassword: "definitely-not-the-password",
        newPassword: "SomethingElse!2026",
      }).expect(403);

      // Renamed in D2.3: the condition is a property of the credential check
      // and occurs in four endpoints across both populations (ADR-0027).
      expect(response.body.error.code).toBe("AUTH_CURRENT_PASSWORD_INVALID");

      // Refused, not partially applied: the old password still works.
      await request()
        .get(PROFILE)
        .set("Authorization", bearer(tokens.accessToken))
        .expect(200);

      await login(harness.app, "user", {
        email: "wrong.current@machxi.local",
        password: NEW_ACCOUNT_PASSWORD,
      });
    });

    it("refuses a new password identical to the current one", async () => {
      const response = await changePassword(customerTokens.accessToken, {
        currentPassword: FIXTURE_PASSWORD,
        newPassword: FIXTURE_PASSWORD,
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(
        response.body.error.details.map(
          (detail: { path: string }) => detail.path,
        ),
      ).toContain("newPassword");
    });

    it("holds the new password to the policy and the old one only to a bound", async () => {
      // `currentPassword` is a credential being verified, not a new one:
      // applying the policy to it would answer "is this long enough to be one
      // of ours?" before any credential check (ADR-0018).
      const response = await changePassword(customerTokens.accessToken, {
        currentPassword: "x",
        newPassword: "short",
      }).expect(400);

      const paths = response.body.error.details.map(
        (detail: { path: string }) => detail.path,
      );

      expect(paths).toContain("newPassword");
      expect(paths).not.toContain("currentPassword");
    });

    it("refuses an account that has no password at all", async () => {
      /*
       * ADR-0027's third `change-password` rule, and the one the integration
       * tier had never asserted — it was proved in `users.service.test.ts`
       * against a fake repository and nowhere against the running endpoint
       * (`D12.3`'s reading).
       *
       * `users.password_hash` is nullable and `null` means **no password
       * login** (ADR-0017), never "any password matches". The failure mode
       * this closes is a truthy-check regression — `record.passwordHash &&
       * verify(...)` reversed, or a hasher that returns `true` for a null
       * digest — which would hand the account to anyone holding a session for
       * it. Worth a real request precisely because it is the kind of bug a
       * fake hasher cannot have.
       *
       * The account is given a session first and its password removed after,
       * because that is the only order that produces the state: a passwordless
       * account cannot sign in, so the session has to predate the null.
       */
      const { id, tokens } = await freshUser("passwordless@machxi.local");

      await harness.db.db
        .update(users)
        .set({ passwordHash: null })
        .where(eq(users.id, id));

      const response = await changePassword(tokens.accessToken, {
        currentPassword: NEW_ACCOUNT_PASSWORD,
        newPassword: "SomethingElse!2026",
      }).expect(403);

      // The same answer a wrong password gets, deliberately: the endpoint does
      // not tell a caller whether the account has a password at all.
      expect(response.body.error.code).toBe("AUTH_CURRENT_PASSWORD_INVALID");

      const row = await harness.db.db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, id));

      expect(row[0]?.passwordHash).toBeNull();
    });

    it("rejects an unknown field rather than ignoring it", async () => {
      const response = await changePassword(customerTokens.accessToken, {
        currentPassword: FIXTURE_PASSWORD,
        newPassword: "SomethingElse!2026",
        userId: "00000000-0000-4000-8000-000000000000",
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("refuses a caller with no credentials", async () => {
      const response = await request()
        .post(`${PROFILE}/change-password`)
        .send({
          currentPassword: FIXTURE_PASSWORD,
          newPassword: "SomethingElse!2026",
        })
        .expect(401);

      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    });
  });

  /**
   * `DELETE /api/v1/user/profile` — the account closing itself (`D12.4`).
   *
   * ADR-0028's user semantics with a different actor: the row survives
   * soft-deleted, `status` goes to `disabled` beside the timestamp, the
   * address is released by the partial unique index, and every session ends.
   * What the self-service actor adds is ADR-0055 §4's two rules — the current
   * password is required, and *no* session is spared, which is the one place
   * this parts company with `change-password` two blocks above.
   */
  describe("DELETE /api/v1/user/profile", () => {
    const remove = (token: string, body: object) =>
      request().delete(PROFILE).set("Authorization", bearer(token)).send(body);

    it("soft-deletes: 204, the row survives, and it is disabled", async () => {
      const email = "closes.itself@machxi.local";
      const { id, tokens } = await freshUser(email);

      const response = await remove(tokens.accessToken, {
        currentPassword: NEW_ACCOUNT_PASSWORD,
      }).expect(204);

      expect(response.body).toEqual({});
      expect(response.text).toBe("");

      // Read through the admin segment, which is the only view left: the self
      // view filters `deleted_at`, and the caller's session is gone anyway.
      const after = await request()
        .get(`/api/v1/admin/users/${id}`)
        .set("Authorization", bearer(staffTokens.accessToken))
        .expect(200);

      expect(after.body.data.deletedAt).toEqual(expect.any(String));
      // Written beside the timestamp so `status` stays truthful on its own:
      // `filter[status][eq]=active` is an allow-listed filter, and an
      // active-and-deleted account would satisfy it (ADR-0028).
      expect(after.body.data.status).toBe("disabled");
    });

    it("soft-deletes the account's personal organization in the same transaction", async () => {
      // The admin path's twin (ADR-0067 §2): which actor closed the account
      // does not change what happens to the organization that exists only for
      // it.
      const email = "closes.with.org@machxi.local";
      const { id, tokens } = await freshUser(email);

      const [before] = await harness.db.db
        .select({ id: organizations.id, deletedAt: organizations.deletedAt })
        .from(organizations)
        .where(
          and(
            eq(organizations.createdBy, id),
            eq(organizations.kind, "personal"),
          ),
        );

      expect(before?.deletedAt).toBeNull();

      await remove(tokens.accessToken, {
        currentPassword: NEW_ACCOUNT_PASSWORD,
      }).expect(204);

      const [after] = await harness.db.db
        .select({ deletedAt: organizations.deletedAt })
        .from(organizations)
        .where(eq(organizations.id, before?.id ?? ""));

      expect(after?.deletedAt).toBeInstanceOf(Date);

      const [account] = await harness.db.db
        .select({ deletedAt: users.deletedAt })
        .from(users)
        .where(eq(users.id, id));

      // One commit, so one timestamp: no window in which a closed account
      // still has a live organization.
      expect(after?.deletedAt?.toISOString()).toBe(
        account?.deletedAt?.toISOString(),
      );

      // The membership survives — nothing cascades on a soft delete — which
      // is why every read of it joins `organizations` and filters
      // `deleted_at`.
      const memberships = await harness.asTooling((tx) =>
        tx
          .select({ userId: organizationMemberships.userId })
          .from(organizationMemberships)
          .where(eq(organizationMemberships.organizationId, before?.id ?? "")),
      );

      expect(memberships).toEqual([{ userId: id }]);
    });

    it("ends every session, the caller's included", async () => {
      // The rule that separates this from `change-password`: there the caller
      // keeps the session they just proved they own, because the point is to
      // end the ones they do not control. Here there is no account left to be
      // signed in to (ADR-0055 §4).
      const email = "signs.out.everywhere@machxi.local";
      const { tokens: first } = await freshUser(email);
      const second = await login(harness.app, "user", {
        email,
        password: NEW_ACCOUNT_PASSWORD,
      });

      await remove(first.accessToken, {
        currentPassword: NEW_ACCOUNT_PASSWORD,
      }).expect(204);

      const caller = await request()
        .get(PROFILE)
        .set("Authorization", bearer(first.accessToken))
        .expect(401);

      expect(caller.body.error.code).toBe("AUTH_SESSION_REVOKED");

      const other = await request()
        .get(PROFILE)
        .set("Authorization", bearer(second.accessToken))
        .expect(401);

      expect(other.body.error.code).toBe("AUTH_SESSION_REVOKED");

      // And the credential cannot open a new one: `findByEmail` filters
      // `deleted_at is null`, so this is indistinguishable from an unknown
      // address (ADR-0020 §Enumeration).
      const relogin = await request()
        .post("/api/v1/user/auth/login")
        .send({ email, password: NEW_ACCOUNT_PASSWORD })
        .expect(401);

      expect(relogin.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
    });

    it("clears the auth cookies of a cookie-transport client", async () => {
      // Revoking the session server-side and leaving the credential in the
      // browser would make "signed out everywhere" true of the database and
      // false of the device in the person's hand — and the browser would spend
      // a refresh-limiter failure on the dead cookie at every boot (ADR-0029).
      const email = "cookie.closes.itself@machxi.local";

      await freshUser(email);

      // Signed in *as the cookie client*, and deleted with that session's own
      // access token: clearing is unconditional, so a body-transport caller
      // would pass this too, and then the case would not be about what it is
      // named for.
      const signedIn = await request()
        .post("/api/v1/user/auth/login")
        .set(TRANSPORT_HEADER, "cookie")
        .send({ email, password: NEW_ACCOUNT_PASSWORD })
        .expect(200);

      expect(cookieValue(signedIn, REFRESH_COOKIE)).toEqual(expect.any(String));

      const response = await remove(signedIn.body.data.accessToken as string, {
        currentPassword: NEW_ACCOUNT_PASSWORD,
      }).expect(204);

      // Both are *sent* and both are empty — a `Set-Cookie` with an expiry in
      // the past is the only way to remove one.
      expect(setCookie(response, REFRESH_COOKIE)).toEqual(expect.any(String));
      expect(cookieValue(response, REFRESH_COOKIE)).toBeUndefined();
      expect(setCookie(response, csrfCookie("user"))).toEqual(
        expect.any(String),
      );
      expect(cookieValue(response, csrfCookie("user"))).toBeUndefined();
    });

    it("leaves an admin panel signed in in another tab alone", async () => {
      // D12's finding 6, extended by `D12.4` and closed by ADR-0056: closing a
      // customer account used to clear the one host-wide `__Host-machxi.csrf`,
      // so it took the admin panel's CSRF token with it. The refusal window
      // that opened was the same one an ordinary refresh opened, and this
      // endpoint is the one where the person cannot simply try again.
      const email = "closes.beside.an.admin@machxi.local";

      await freshUser(email);

      const staffSession = await request()
        .post("/api/v1/admin/auth/login")
        .set(TRANSPORT_HEADER, "cookie")
        .send(superAdmin())
        .expect(200);

      const staffCsrf = cookieValue(staffSession, csrfCookie("staff")) ?? "";

      expect(staffCsrf).not.toBe("");

      const signedIn = await request()
        .post("/api/v1/user/auth/login")
        .set(TRANSPORT_HEADER, "cookie")
        .send({ email, password: NEW_ACCOUNT_PASSWORD })
        .expect(200);

      const response = await remove(signedIn.body.data.accessToken as string, {
        currentPassword: NEW_ACCOUNT_PASSWORD,
      })
        // Both CSRF cookies travel here — they are at `Path=/` — which is what
        // makes the assertion below about the server's choice rather than
        // about what the browser happened to send.
        .set("Cookie", [
          `${csrfCookie("staff")}=${staffCsrf}`,
          `${csrfCookie("user")}=${cookieValue(signedIn, csrfCookie("user")) ?? ""}`,
        ])
        .expect(204);

      expect(setCookie(response, csrfCookie("staff"))).toBeUndefined();

      // And the staff session's own double-submit still passes afterwards,
      // which is the property the cookie assertion is a proxy for.
      await request()
        .post("/api/v1/admin/auth/refresh")
        .set(TRANSPORT_HEADER, "cookie")
        .set("Cookie", [
          `${REFRESH_COOKIE}=${cookieValue(staffSession, REFRESH_COOKIE) ?? ""}`,
          `${csrfCookie("staff")}=${staffCsrf}`,
        ])
        .set("X-CSRF-Token", staffCsrf)
        .expect(200);
    });

    it("releases the address, so the same person can come back", async () => {
      // The partial unique index, reached through the self-service door this
      // time: `unique (email) where deleted_at is null` is what makes the
      // support answer "I closed my account and want to return" possible, and
      // an account that closed itself must release its address exactly as one
      // an admin closed does (ADR-0028).
      const email = "comes.back@machxi.local";
      const { id: first, tokens } = await freshUser(email);

      await remove(tokens.accessToken, {
        currentPassword: NEW_ACCOUNT_PASSWORD,
      }).expect(204);

      const second = await createUserAccount(
        harness.app,
        staffTokens.accessToken,
        { email },
      );

      expect(second.id).not.toBe(first);
      expect(second.deletedAt).toBeNull();
    });

    it("takes the account's federated identities with it (ADR-0072 §1)", async () => {
      // The admin path's twin: `(provider, subject)` is unique with no
      // predicate, so an identity left behind would hold that Google account
      // for ever. Closing oneself releases it exactly as an admin delete does.
      const { id, tokens } = await freshUser(
        "closes.with.identity@machxi.local",
      );

      await harness.db.db.insert(federatedIdentities).values({
        userId: id,
        provider: "google",
        subject: "closes-itself-subject",
      });

      await remove(tokens.accessToken, {
        currentPassword: NEW_ACCOUNT_PASSWORD,
      }).expect(204);

      expect(
        await harness.db.db
          .select({ id: federatedIdentities.id })
          .from(federatedIdentities)
          .where(eq(federatedIdentities.subject, "closes-itself-subject")),
      ).toEqual([]);
    });

    it("refuses a wrong current password with 403, and deletes nothing", async () => {
      // A session is not an identity proof for an irreversible act: a hijacked
      // tab must not be able to destroy the account (ADR-0055 §4). `403` and
      // not `401` for the reason `change-password` gives — the session is
      // valid and stays valid.
      const email = "wrong.password.close@machxi.local";
      const { tokens } = await freshUser(email);

      const response = await remove(tokens.accessToken, {
        currentPassword: "definitely-not-the-password",
      }).expect(403);

      expect(response.body.error.code).toBe("AUTH_CURRENT_PASSWORD_INVALID");

      // Refused, not partially applied: the session and the account are intact.
      await request()
        .get(PROFILE)
        .set("Authorization", bearer(tokens.accessToken))
        .expect(200);
    });

    it("refuses an account that has no password at all", async () => {
      // `users.password_hash` is nullable and `null` means **no password
      // login** (ADR-0017), never "any password matches". The failure mode is
      // the same truthy-check regression `change-password` guards against, and
      // here it would hand an irreversible act to anyone holding a session.
      const email = "passwordless.close@machxi.local";
      const { id, tokens } = await freshUser(email);

      await harness.db.db
        .update(users)
        .set({ passwordHash: null })
        .where(eq(users.id, id));

      const response = await remove(tokens.accessToken, {
        currentPassword: NEW_ACCOUNT_PASSWORD,
      }).expect(403);

      expect(response.body.error.code).toBe("AUTH_CURRENT_PASSWORD_INVALID");

      const row = await harness.db.db
        .select({ deletedAt: users.deletedAt })
        .from(users)
        .where(eq(users.id, id));

      expect(row[0]?.deletedAt).toBeNull();
    });

    it("requires the password to be there at all", async () => {
      const response = await remove(customerTokens.accessToken, {}).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("carries no id, so no field can name somebody else's account", async () => {
      // The strict body is the whole ownership story on this segment: there is
      // no `:id` in the path and no subject in the body, so the only account
      // this endpoint can ever close is `ctx.principal`'s (ADR-0019 §3).
      const response = await remove(customerTokens.accessToken, {
        currentPassword: FIXTURE_PASSWORD,
        userId: "00000000-0000-4000-8000-000000000000",
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");

      // And the account that was named as the actor is untouched.
      await request()
        .get(PROFILE)
        .set("Authorization", bearer(customerTokens.accessToken))
        .expect(200);
    });

    it("refuses a caller with no credentials", async () => {
      const response = await request()
        .delete(PROFILE)
        .send({ currentPassword: FIXTURE_PASSWORD })
        .expect(401);

      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("cannot be repeated, because the session that could is gone", async () => {
      // Where the admin segment answers `409 USER_DELETED` for a second
      // delete, this one never gets that far: the first call revoked the
      // caller's own session, so the repeat is refused by `authenticate`.
      // `404` — what the service would answer — is unreachable from a real
      // client, and that is the endpoint being self-consistent rather than a
      // gap.
      const email = "closes.twice@machxi.local";
      const { tokens } = await freshUser(email);

      await remove(tokens.accessToken, {
        currentPassword: NEW_ACCOUNT_PASSWORD,
      }).expect(204);

      const again = await remove(tokens.accessToken, {
        currentPassword: NEW_ACCOUNT_PASSWORD,
      }).expect(401);

      expect(again.body.error.code).toBe("AUTH_SESSION_REVOKED");
    });

    it("forbids caching the request that carries a password", async () => {
      const email = "no.store.close@machxi.local";
      const { tokens } = await freshUser(email);

      await remove(tokens.accessToken, {
        currentPassword: NEW_ACCOUNT_PASSWORD,
      })
        .expect("Cache-Control", "no-store")
        .expect(204);
    });
  });

  describe("a soft-deleted account (ADR-0017)", () => {
    it("has no profile, even while its access token is still live", async () => {
      // `authenticate` verifies the session, not the account, so this is
      // reachable for as long as the token lives. The self view uses
      // `findById`, which excludes deleted rows: the profile is gone, and 404
      // is the honest answer — where the *admin* view of the same row is 200.
      const { id, tokens } = await freshUser("deleted.profile@machxi.local");

      await harness.db.db
        .update(users)
        .set({ deletedAt: new Date() })
        .where(eq(users.id, id));

      const response = await request()
        .get(PROFILE)
        .set("Authorization", bearer(tokens.accessToken))
        .expect(404);

      expect(response.body.error.code).toBe("NOT_FOUND");

      const patched = await request()
        .patch(PROFILE)
        .set("Authorization", bearer(tokens.accessToken))
        .send({ firstName: "Ghost" })
        .expect(404);

      expect(patched.body.error.code).toBe("NOT_FOUND");

      // The admin segment still sees it, which is the pairing that makes the
      // 404 above a statement about ownership rather than about existence.
      await request()
        .get(`/api/v1/admin/users/${id}`)
        .set("Authorization", bearer(staffTokens.accessToken))
        .expect(200);
    });
  });
});
