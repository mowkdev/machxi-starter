import {
  declaredErrorEnvelopeSchema,
  listEnvelopeSchema,
  successEnvelopeSchema,
} from "@repo/contracts";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bearer,
  createStaffMember,
  listQueryString,
  login,
  NEW_ACCOUNT_PASSWORD,
  type Tokens,
} from "./support/actors.js";
import { createTestApp, type TestApp } from "./support/app.js";
import { lastMailTo, tokenFromMail } from "./support/mail.js";
import { expectNoSecrets, staffResourceSchema } from "./support/resources.js";
import {
  FIXTURE_PASSWORD,
  FIXTURE_STAFF,
  FIXTURE_USERS,
  resetAndSeed,
  superAdmin,
} from "./support/seed.js";

/**
 * `/api/v1/admin/staff` end to end (ADR-0019, ADR-0021).
 *
 * This is the resource ADR-0019 asks a test to enumerate: it is `admin`
 * throughout, guarded once at the mount point in `admin.router.ts`, so "every
 * route is protected" is a claim about the *set* of routes and cannot be
 * checked one endpoint at a time. The guard matrix below is that enumeration —
 * a route added to the router without a mount-level guard fails it.
 *
 * The seeded staff population is one `super_admin`, one `manager` and one
 * `editor`, which means the interesting caller — an `admin` who is *not* a
 * super admin, and so does not get the ADR-0019 bypass — has to be created
 * through the endpoint under test.
 */

const staffEnvelope = successEnvelopeSchema(staffResourceSchema);
const staffListEnvelope = listEnvelopeSchema(staffResourceSchema);

/** A syntactically valid id that no row has — the 404 case, not the 400 one. */
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

const STAFF_BASE = "/api/v1/admin/staff";

describe("admin staff administration", () => {
  let harness: TestApp;
  let superAdminTokens: Tokens;
  let adminTokens: Tokens;
  let managerTokens: Tokens;
  let editorTokens: Tokens;
  let userTokens: Tokens;
  let adminId: string;

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ hasher: harness.hasher });

    superAdminTokens = await login(harness.app, "staff", superAdmin());

    const admin = await createStaffMember(
      harness.app,
      superAdminTokens.accessToken,
      {
        email: "admin.fixture@machxi.local",
        firstName: "Ada",
        lastName: "Admin",
        roles: ["admin"],
      },
    );

    adminId = admin.id;
    adminTokens = await login(harness.app, "staff", {
      email: admin.email,
      password: NEW_ACCOUNT_PASSWORD,
    });

    managerTokens = await login(harness.app, "staff", {
      email: FIXTURE_STAFF.manager,
      password: FIXTURE_PASSWORD,
    });
    editorTokens = await login(harness.app, "staff", {
      email: FIXTURE_STAFF.editor,
      password: FIXTURE_PASSWORD,
    });
    userTokens = await login(harness.app, "user", {
      email: FIXTURE_USERS.active,
      password: FIXTURE_PASSWORD,
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  const request = () => supertest(harness.app);

  const asAdmin = (path: string) =>
    request().get(path).set("Authorization", bearer(adminTokens.accessToken));

  describe("the guard on every route (ADR-0019)", () => {
    /**
     * Every route the staff router mounts. The bodies are deliberately empty:
     * `authenticate` and `authorize` run before `validate` (ADR-0011), so a
     * request that would fail validation must still be refused for the right
     * reason — otherwise the shape of the body would tell an unprivileged
     * caller which routes exist.
     */
    const ROUTES = [
      { method: "get", path: STAFF_BASE },
      { method: "post", path: STAFF_BASE },
      { method: "get", path: `${STAFF_BASE}/${UNKNOWN_ID}` },
      { method: "patch", path: `${STAFF_BASE}/${UNKNOWN_ID}` },
      { method: "post", path: `${STAFF_BASE}/${UNKNOWN_ID}/sessions/revoke` },
      { method: "post", path: `${STAFF_BASE}/${UNKNOWN_ID}/password` },
      { method: "post", path: `${STAFF_BASE}/${UNKNOWN_ID}/email` },
      {
        method: "post",
        path: `${STAFF_BASE}/${UNKNOWN_ID}/onboarding/resend`,
      },
      { method: "delete", path: `${STAFF_BASE}/${UNKNOWN_ID}` },
    ] as const;

    const call = (route: (typeof ROUTES)[number]) =>
      route.method === "get"
        ? request().get(route.path)
        : route.method === "post"
          ? request().post(route.path)
          : route.method === "delete"
            ? request().delete(route.path)
            : request().patch(route.path);

    it.each(ROUTES)(
      "$method $path refuses a caller with no credentials",
      async (route) => {
        const response = await call(route).expect(401);

        expect(response.body.error.code).toBe("UNAUTHENTICATED");
      },
    );

    it.each(ROUTES)(
      "$method $path refuses a user token with 401, never 403",
      async (route) => {
        // ADR-0019 §1: a 403 would confirm to the wrong population that the
        // route exists. The token is well-formed and live — it is simply
        // minted for the other segment's audience.
        const response = await call(route)
          .set("Authorization", bearer(userTokens.accessToken))
          .expect(401);

        expect(response.body.error.code).toBe("AUTH_TOKEN_INVALID");
      },
    );

    it.each(ROUTES)("$method $path refuses an editor", async (route) => {
      const response = await call(route)
        .set("Authorization", bearer(editorTokens.accessToken))
        .expect(403);

      expect(response.body.error.code).toBe("FORBIDDEN");
      expect(declaredErrorEnvelopeSchema.safeParse(response.body).success).toBe(
        true,
      );
    });

    it.each(ROUTES)("$method $path refuses a manager", async (route) => {
      // Managing operators is not a manager's job: unlike `/admin/users`,
      // which a manager may read, `/admin/staff` is `admin` throughout.
      const response = await call(route)
        .set("Authorization", bearer(managerTokens.accessToken))
        .expect(403);

      expect(response.body.error.code).toBe("FORBIDDEN");
    });
  });

  describe("GET /api/v1/admin/staff", () => {
    it("returns the directory to an admin", async () => {
      const response = await asAdmin(STAFF_BASE).expect(200);

      expect(staffListEnvelope.safeParse(response.body).success).toBe(true);
      expect(response.body.meta.requestId).toEqual(expect.any(String));
      expect(
        response.body.data.map((item: { email: string }) => item.email),
      ).toContain(FIXTURE_STAFF.manager);
    });

    it("admits a super admin, who holds no `admin` role at all", async () => {
      // The ADR-0019 bypass, from the outside: the seeded account's only role
      // is `super_admin`, so a guard that merely listed roles would refuse it.
      const response = await request()
        .get(STAFF_BASE)
        .set("Authorization", bearer(superAdminTokens.accessToken))
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it("never puts a password hash on the wire", async () => {
      const response = await asAdmin(STAFF_BASE).expect(200);

      expectNoSecrets(response.body);
    });

    it("forbids caching the operator directory", async () => {
      // `no-store` is mounted on the whole resource, not on the list route:
      // every response here is personal data about an employee, and a shared
      // proxy has no business holding any of it on disk (ADR-0020).
      await asAdmin(STAFF_BASE).expect("Cache-Control", "no-store").expect(200);
      await asAdmin(`${STAFF_BASE}/${adminId}`)
        .expect("Cache-Control", "no-store")
        .expect(200);
    });
  });

  describe("POST /api/v1/admin/staff", () => {
    it("creates an active account with the roles that were asked for", async () => {
      const response = await request()
        .post(STAFF_BASE)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({
          email: "new.editor@machxi.local",
          password: NEW_ACCOUNT_PASSWORD,
          firstName: "Nina",
          lastName: "Newcomer",
          roles: ["editor", "manager"],
        })
        .expect(201);

      expect(staffEnvelope.safeParse(response.body).success).toBe(true);
      expect(response.body.data.roles.sort()).toEqual(["editor", "manager"]);
      // ADR-0018 §Staff onboarding: the initial password is handed over out of
      // band, so the account is usable immediately rather than `invited`.
      expect(response.body.data.status).toBe("active");
      expect(response.body.data.lastLoginAt).toBeNull();
      expectNoSecrets(response.body);
    });

    it("hands over an account that can sign in straight away", async () => {
      const created = await createStaffMember(
        harness.app,
        adminTokens.accessToken,
        { email: "signs.in@machxi.local", roles: ["editor"] },
      );

      const tokens = await login(harness.app, "staff", {
        email: created.email,
        password: NEW_ACCOUNT_PASSWORD,
      });

      const me = await request()
        .get("/api/v1/admin/auth/me")
        .set("Authorization", bearer(tokens.accessToken))
        .expect(200);

      expect(me.body.data.id).toBe(created.id);
    });

    it("names the conflict when the email is taken", async () => {
      // Unlike public registration, an authenticated admin may be told: they
      // can already list every staff address (ADR-0020 §Enumeration).
      const response = await request()
        .post(STAFF_BASE)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({
          email: FIXTURE_STAFF.manager,
          password: NEW_ACCOUNT_PASSWORD,
          firstName: "Duplicate",
          lastName: "Manager",
          roles: ["editor"],
        })
        .expect(409);

      expect(response.body.error.code).toBe("STAFF_EMAIL_TAKEN");
    });

    it("rejects an unknown field rather than ignoring it", async () => {
      const response = await request()
        .post(STAFF_BASE)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({
          email: "strict@machxi.local",
          password: NEW_ACCOUNT_PASSWORD,
          firstName: "Stan",
          lastName: "Strict",
          roles: ["editor"],
          status: "active",
        })
        .expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("reports which fields are wrong", async () => {
      const response = await request()
        .post(STAFF_BASE)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({
          email: "not-an-email",
          password: "short",
          firstName: "",
          lastName: "Broken",
          roles: [],
        })
        .expect(400);

      const paths = response.body.error.details.map(
        (detail: { path: string }) => detail.path,
      );

      expect(paths).toEqual(
        expect.arrayContaining(["email", "password", "firstName", "roles"]),
      );
    });
  });

  /*
   * ADR-0071 §8 end to end — the invitation, the link, and the accept.
   *
   * What this proves that a unit test cannot: the row, its grants and its
   * token land in **one commit**; the account really cannot sign in until the
   * link is spent, against the same `authenticate` a browser meets; the token
   * is single-use against a real `update … where consumed_at is null`; and the
   * accept answers login's body on whichever transport the caller asked for.
   */
  describe("staff onboarding by invitation (ADR-0071 §8)", () => {
    const ACCEPT = "/api/v1/admin/auth/onboarding/accept";
    const CHOSEN_PASSWORD = "chosen-by-the-operator-1";

    /** Creates an `invited` operator and hands back its link. */
    const invite = async (
      email: string,
    ): Promise<{ id: string; token: string }> => {
      harness.mail.length = 0;

      const response = await request()
        .post(STAFF_BASE)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({
          email,
          firstName: "Ivy",
          lastName: "Invited",
          roles: ["editor"],
        })
        .expect(201);

      return {
        id: response.body.data.id as string,
        token: tokenFromMail(lastMailTo(harness, email)),
      };
    };

    it("creates an invited row and mails a link into the admin app", async () => {
      const email = "invited.one@machxi.local";

      harness.mail.length = 0;

      const response = await request()
        .post(STAFF_BASE)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({
          email,
          firstName: "Ivy",
          lastName: "Invited",
          roles: ["editor"],
        })
        .expect(201);

      expect(staffEnvelope.safeParse(response.body).success).toBe(true);
      expect(response.body.data.status).toBe("invited");
      expectNoSecrets(response.body);

      const message = lastMailTo(harness, email);

      expect(harness.mail).toHaveLength(1);
      // The **admin** app, which is the half of §8 only the origin can carry:
      // a link into the customer app would land an operator on a screen that
      // cannot help them.
      expect(message?.text).toContain(harness.config.apps.adminUrl);
      expect(message?.text).toContain("/onboarding#token=");
    });

    it("has no password for login to be right about", async () => {
      /*
       * **Named for what it proves** (`D18.11`'s `code-reviewer`, correcting
       * this file's first draft). The draft called itself "refuses the
       * invited account at login" and cited `staffRecord`'s status check —
       * which it never reaches: the row's hash is null, so `login` compares
       * against `dummyHash()` and answers before `active` is consulted.
       * Deleting that status check would have left this green.
       *
       * What is actually true, and is the property worth pinning, is that an
       * `invited` operator is **indistinguishable from an unknown address**:
       * every password answers the same `401 AUTH_INVALID_CREDENTIALS`, with
       * no `403` to say the account exists and is waiting (ADR-0020
       * §Enumeration). The status check is what refuses a *disabled* row, and
       * `auth.int.test.ts` owns that case.
       */
      const email = "invited.cannot.login@machxi.local";

      await invite(email);

      for (const password of [CHOSEN_PASSWORD, "a-different-password-3"]) {
        const response = await request()
          .post("/api/v1/admin/auth/login")
          .send({ email, password })
          .expect(401);

        expect(response.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
      }

      const stranger = await request()
        .post("/api/v1/admin/auth/login")
        .send({
          email: "nobody.at.all@machxi.local",
          password: CHOSEN_PASSWORD,
        })
        .expect(401);

      expect(stranger.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
    });

    it("refuses an administrative password set on an invited row", async () => {
      /*
       * `D18.11`'s reviewers, both of them. Writing a hash here would leave
       * `status` at `invited`, so the operator could not sign in with the
       * password they were just handed — and the `204` would be a claim
       * nobody could act on. The invitation is how this account gets its
       * first credential (ADR-0071 §8, amended).
       */
      const { id } = await invite("invited.no.reset@machxi.local");

      const response = await request()
        .post(`${STAFF_BASE}/${id}/password`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({
          password: CHOSEN_PASSWORD,
          currentPassword: NEW_ACCOUNT_PASSWORD,
        })
        .expect(409);

      expect(response.body.error.code).toBe("STAFF_INVITATION_PENDING");

      // And the link still works, which is what "refused" has to mean here.
      const record = await asAdmin(`${STAFF_BASE}/${id}`).expect(200);

      expect(record.body.data.status).toBe("invited");
    });

    it("refuses activating an operator who has never had a password", async () => {
      /*
       * The same row from the other direction (`D18.11`'s
       * `security-reviewer`): `status` is a free field of `updateStaffBody`,
       * so without this an admin could `PATCH` an invitation to `active` and
       * produce an operator who can never sign in — and whom
       * `countOtherActiveSuperAdmins` would count as a survivor of the
       * ADR-0017 invariant, because that query reads `status` alone.
       */
      const { id } = await invite("invited.no.activate@machxi.local");

      const response = await request()
        .patch(`${STAFF_BASE}/${id}`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({ status: "active" })
        .expect(409);

      expect(response.body.error.code).toBe("STAFF_INVITATION_PENDING");

      // Every other status still moves: this refuses a pairing, not a row.
      await request()
        .patch(`${STAFF_BASE}/${id}`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({ status: "disabled" })
        .expect(200);
    });

    it("sets the password, activates the row and signs the device in", async () => {
      const email = "invited.accepts@machxi.local";
      const { id, token } = await invite(email);

      const accepted = await request()
        .post(ACCEPT)
        .send({ token, password: CHOSEN_PASSWORD })
        .expect(200);

      expect(accepted.body.data.principal.id).toBe(id);
      expect(accepted.body.data.accessToken).toEqual(expect.any(String));

      const me = await request()
        .get("/api/v1/admin/auth/me")
        .set("Authorization", bearer(accepted.body.data.accessToken))
        .expect(200);

      expect(me.body.data.id).toBe(id);

      // And the password really is the account's now, through the ordinary
      // door: the accept is not the only way in from here.
      const record = await asAdmin(`${STAFF_BASE}/${id}`).expect(200);

      expect(record.body.data.status).toBe("active");

      const tokens = await login(harness.app, "staff", {
        email,
        password: CHOSEN_PASSWORD,
      });

      expect(tokens.accessToken).toEqual(expect.any(String));
    });

    it("refuses the same link a second time", async () => {
      const { token } = await invite("invited.twice@machxi.local");

      await request()
        .post(ACCEPT)
        .send({ token, password: CHOSEN_PASSWORD })
        .expect(200);

      const replay = await request()
        .post(ACCEPT)
        .send({ token, password: "a-different-password-2" })
        .expect(401);

      expect(replay.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("refuses a token minted for another purpose", async () => {
      // One mechanism, four purposes, and the consume matches the purpose
      // inside the claiming statement (ADR-0071 §1) — so a recovery link
      // cannot be spent as an onboarding one.
      harness.mail.length = 0;

      await request()
        .post("/api/v1/admin/auth/password/forgot")
        .send({ email: FIXTURE_STAFF.manager })
        .expect(202);

      const reset = tokenFromMail(lastMailTo(harness, FIXTURE_STAFF.manager));

      const response = await request()
        .post(ACCEPT)
        .send({ token: reset, password: CHOSEN_PASSWORD })
        .expect(401);

      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("is not mounted on the user segment", async () => {
      // The condition in `auth.routes.ts` is the guard: a user-segment twin
      // would be a second endpoint able to spend a staff token.
      //
      // Sent **with a valid user token**, which is what makes this a claim
      // about the route rather than about the guard above it: anonymously the
      // path answers `401` from that segment's `authenticate`, and a `401`
      // would be indistinguishable from a route that exists and is protected.
      const response = await request()
        .post("/api/v1/user/auth/onboarding/accept")
        .set("Authorization", bearer(userTokens.accessToken))
        .send({ token: "anything", password: CHOSEN_PASSWORD })
        .expect(404);

      expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
    });

    it("re-sends the link and retires the previous one", async () => {
      const email = "invited.resent@machxi.local";
      const { id, token: first } = await invite(email);

      harness.mail.length = 0;

      await request()
        .post(`${STAFF_BASE}/${id}/onboarding/resend`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({})
        .expect(204);

      const second = tokenFromMail(lastMailTo(harness, email));

      expect(second).not.toBe(first);

      // The mint supersedes the live token for the pair (ADR-0071 §1), so
      // "resend" leaves one working link rather than two.
      const stale = await request()
        .post(ACCEPT)
        .send({ token: first, password: CHOSEN_PASSWORD })
        .expect(401);

      expect(stale.body.error.code).toBe("UNAUTHENTICATED");

      await request()
        .post(ACCEPT)
        .send({ token: second, password: CHOSEN_PASSWORD })
        .expect(200);
    });

    it("refuses a resend for an account that is already active", async () => {
      const response = await request()
        .post(`${STAFF_BASE}/${adminId}/onboarding/resend`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({})
        .expect(409);

      expect(response.body.error.code).toBe("STAFF_NOT_INVITED");
    });

    it("answers 404 for a resend against an unknown id", async () => {
      const response = await request()
        .post(`${STAFF_BASE}/${UNKNOWN_ID}/onboarding/resend`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({})
        .expect(404);

      expect(response.body.error.code).toBe("NOT_FOUND");
    });

    it("spends nothing when the account has been disabled since the mint", async () => {
      // A refused consumption rolls the claim back (ADR-0071 §1), so the link
      // works again if the account becomes eligible — which is what makes
      // "refused" different from "spent".
      const email = "invited.disabled@machxi.local";
      const { id, token } = await invite(email);

      await request()
        .patch(`${STAFF_BASE}/${id}`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({ status: "disabled" })
        .expect(200);

      const refused = await request()
        .post(ACCEPT)
        .send({ token, password: CHOSEN_PASSWORD })
        .expect(401);

      expect(refused.body.error.code).toBe("UNAUTHENTICATED");

      await request()
        .patch(`${STAFF_BASE}/${id}`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({ status: "invited" })
        .expect(200);

      await request()
        .post(ACCEPT)
        .send({ token, password: CHOSEN_PASSWORD })
        .expect(200);
    });
  });

  describe("GET /api/v1/admin/staff/:id", () => {
    it("returns one staff member", async () => {
      const response = await asAdmin(`${STAFF_BASE}/${adminId}`).expect(200);

      expect(staffEnvelope.safeParse(response.body).success).toBe(true);
      expect(response.body.data.id).toBe(adminId);
      expect(response.body.data.roles).toEqual(["admin"]);
    });

    it("answers 404 for a well-formed id that no row has", async () => {
      const response = await asAdmin(`${STAFF_BASE}/${UNKNOWN_ID}`).expect(404);

      expect(response.body.error.code).toBe("NOT_FOUND");
    });

    it("answers 400 for an id that is not a uuid", async () => {
      // A malformed id never reaches the service: `staffIdParams` decides it,
      // so the failure is the client's shape, not a missing row (ADR-0011).
      const response = await asAdmin(`${STAFF_BASE}/not-a-uuid`).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("PATCH /api/v1/admin/staff/:id", () => {
    const patch = (id: string, body: object) =>
      request()
        .patch(`${STAFF_BASE}/${id}`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send(body);

    it("updates the profile and replaces the roles", async () => {
      const target = await createStaffMember(
        harness.app,
        adminTokens.accessToken,
        { email: "patch.target@machxi.local", roles: ["editor"] },
      );

      const response = await patch(target.id, {
        firstName: "Renamed",
        roles: ["manager"],
      }).expect(200);

      expect(staffEnvelope.safeParse(response.body).success).toBe(true);
      expect(response.body.data.firstName).toBe("Renamed");
      expect(response.body.data.lastName).toBe(target.lastName);
      expect(response.body.data.roles).toEqual(["manager"]);
      expect(
        new Date(response.body.data.updatedAt).getTime(),
      ).toBeGreaterThanOrEqual(new Date(target.updatedAt).getTime());
    });

    it("rejects an empty patch", async () => {
      // `PATCH {}` is a request that means nothing; the schema refuses it
      // rather than writing `updated_at` for no reason.
      const response = await patch(adminId, {}).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects a field the schema does not carry", async () => {
      // `email` is absent from `updateStaffBody` by design — changing the
      // identifier a session was established with is its own flow.
      const response = await patch(adminId, {
        email: "moved@machxi.local",
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("answers 404 for an unknown id", async () => {
      const response = await patch(UNKNOWN_ID, { firstName: "Ghost" }).expect(
        404,
      );

      expect(response.body.error.code).toBe("NOT_FOUND");
    });

    it("answers 400 for an id that is not a uuid", async () => {
      const response = await patch("not-a-uuid", {
        firstName: "Ghost",
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("ends the live sessions of an account it disables", async () => {
      // ADR-0018 requires the pairing: `sessions` has no foreign key to
      // `staff`, so nothing but this write would stop a disabled operator from
      // using the access token they already hold for another 15 minutes.
      const target = await createStaffMember(
        harness.app,
        adminTokens.accessToken,
        { email: "about.to.be.disabled@machxi.local", roles: ["editor"] },
      );

      const tokens = await login(harness.app, "staff", {
        email: target.email,
        password: NEW_ACCOUNT_PASSWORD,
      });

      await request()
        .get("/api/v1/admin/auth/me")
        .set("Authorization", bearer(tokens.accessToken))
        .expect(200);

      const patched = await patch(target.id, { status: "disabled" }).expect(
        200,
      );

      expect(patched.body.data.status).toBe("disabled");

      const afterDisable = await request()
        .get("/api/v1/admin/auth/me")
        .set("Authorization", bearer(tokens.accessToken))
        .expect(401);

      expect(afterDisable.body.error.code).toBe("AUTH_SESSION_REVOKED");

      const refreshed = await request()
        .post("/api/v1/admin/auth/refresh")
        .send({ refreshToken: tokens.refreshToken })
        .expect(401);

      expect(refreshed.body.error.code).toBe("AUTH_SESSION_REVOKED");
    });
  });

  describe("POST /api/v1/admin/staff/:id/sessions/revoke", () => {
    const revoke = (id: string) =>
      request()
        .post(`${STAFF_BASE}/${id}/sessions/revoke`)
        .set("Authorization", bearer(adminTokens.accessToken));

    it("answers 204 with no body and kills the target's access token", async () => {
      const target = await createStaffMember(
        harness.app,
        adminTokens.accessToken,
        { email: "revoke.target@machxi.local", roles: ["editor"] },
      );

      const tokens = await login(harness.app, "staff", {
        email: target.email,
        password: NEW_ACCOUNT_PASSWORD,
      });

      const response = await revoke(target.id).expect(204);

      // A 204 carries no envelope at all (ADR-0012), so there is nothing to
      // parse and the absence is the assertion.
      expect(response.body).toEqual({});
      expect(response.text).toBe("");

      const afterRevoke = await request()
        .get("/api/v1/admin/auth/me")
        .set("Authorization", bearer(tokens.accessToken))
        .expect(401);

      expect(afterRevoke.body.error.code).toBe("AUTH_SESSION_REVOKED");
    });

    it("is idempotent — a second call is still 204", async () => {
      // Revoking an account with nothing live is a legitimate no-op; only an
      // unknown id is an error.
      const target = await createStaffMember(
        harness.app,
        adminTokens.accessToken,
        { email: "revoke.twice@machxi.local", roles: ["editor"] },
      );

      await revoke(target.id).expect(204);
      await revoke(target.id).expect(204);
    });

    it("answers 404 for an unknown id", async () => {
      // Read first, so a forced logout of an account that does not exist is
      // not indistinguishable from one that has no sessions.
      const response = await revoke(UNKNOWN_ID).expect(404);

      expect(response.body.error.code).toBe("NOT_FOUND");
    });

    it("answers 400 for an id that is not a uuid", async () => {
      const response = await revoke("not-a-uuid").expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  /**
   * `POST /api/v1/admin/staff/:id/password` — the administrative reset
   * (ADR-0027 §Administrative reset).
   *
   * The endpoint that makes a forgotten operator password recoverable without
   * writing an argon2 digest into Postgres by hand. Two rules carry it: the
   * actor re-presents their own password, and the ADR-0017 rank rule protects
   * a super admin from everybody it outranks — rewriting somebody's credential
   * is removing their standing in the most complete way available.
   */
  describe("POST /api/v1/admin/staff/:id/password", () => {
    const RESET_PASSWORD = "ResetByAnAdmin!2026";

    const setPassword = (token: string, id: string, body: object) =>
      request()
        .post(`${STAFF_BASE}/${id}/password`)
        .set("Authorization", bearer(token))
        .send(body);

    it("sets the password, ends every session, and the new one signs in", async () => {
      const email = "reset.staff@machxi.local";
      const target = await createStaffMember(
        harness.app,
        adminTokens.accessToken,
        { email, roles: ["editor"] },
      );
      const tokens = await login(harness.app, "staff", {
        email,
        password: NEW_ACCOUNT_PASSWORD,
      });

      const response = await setPassword(adminTokens.accessToken, target.id, {
        password: RESET_PASSWORD,
        currentPassword: NEW_ACCOUNT_PASSWORD,
      }).expect(204);

      expect(response.body).toEqual({});
      expect(response.text).toBe("");

      const after = await request()
        .get("/api/v1/admin/auth/me")
        .set("Authorization", bearer(tokens.accessToken))
        .expect(401);

      expect(after.body.error.code).toBe("AUTH_SESSION_REVOKED");

      await login(harness.app, "staff", { email, password: RESET_PASSWORD });

      const withOldPassword = await request()
        .post("/api/v1/admin/auth/login")
        .send({ email, password: NEW_ACCOUNT_PASSWORD })
        .expect(401);

      expect(withOldPassword.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
    });

    it("refuses an actor who cannot re-present their own password", async () => {
      const email = "reset.staff.refused@machxi.local";
      const target = await createStaffMember(
        harness.app,
        adminTokens.accessToken,
        { email, roles: ["editor"] },
      );

      const response = await setPassword(adminTokens.accessToken, target.id, {
        password: RESET_PASSWORD,
        currentPassword: "not-the-admins-password",
      }).expect(403);

      expect(response.body.error.code).toBe("AUTH_CURRENT_PASSWORD_INVALID");

      await login(harness.app, "staff", {
        email,
        password: NEW_ACCOUNT_PASSWORD,
      });
    });

    it("refuses an admin who aims it at a super admin", async () => {
      // A privilege everyone it outranks can seize by rewriting its credential
      // is not a privilege (ADR-0017 §Invariants, ADR-0027 rule 2).
      const me = await request()
        .get("/api/v1/admin/auth/me")
        .set("Authorization", bearer(superAdminTokens.accessToken))
        .expect(200);

      const response = await setPassword(
        adminTokens.accessToken,
        me.body.data.id as string,
        {
          password: RESET_PASSWORD,
          currentPassword: NEW_ACCOUNT_PASSWORD,
        },
      ).expect(403);

      expect(response.body.error.code).toBe("FORBIDDEN");

      // The super admin's own credential is untouched, which is the assertion
      // the 403 alone would not make.
      await login(harness.app, "staff", superAdmin());
    });

    it("answers 404 for an unknown id once the actor verifies", async () => {
      const response = await setPassword(adminTokens.accessToken, UNKNOWN_ID, {
        password: RESET_PASSWORD,
        currentPassword: NEW_ACCOUNT_PASSWORD,
      }).expect(404);

      expect(response.body.error.code).toBe("NOT_FOUND");
    });

    it("answers the same 403 for an unknown id when the actor's password is wrong", async () => {
      const response = await setPassword(adminTokens.accessToken, UNKNOWN_ID, {
        password: RESET_PASSWORD,
        currentPassword: "not-the-admins-password",
      }).expect(403);

      expect(response.body.error.code).toBe("AUTH_CURRENT_PASSWORD_INVALID");
    });

    it("rejects an unknown field rather than ignoring it", async () => {
      const response = await setPassword(adminTokens.accessToken, adminId, {
        password: RESET_PASSWORD,
        currentPassword: NEW_ACCOUNT_PASSWORD,
        roles: ["super_admin"],
      }).expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  /**
   * `POST /api/v1/admin/staff/:id/email` — a super admin setting an operator's
   * address outright (ADR-0071 §7).
   *
   * The one route in this router that narrows the mount's `admin` guard, and
   * the reason it does is the operation rather than the subject: an address
   * redirects every future recovery link, so it is not something an `admin`
   * may do to a peer. There is no rank rule underneath, because the only
   * caller who arrives already outranks everybody — including themselves,
   * which §7 permits explicitly.
   */
  describe("POST /api/v1/admin/staff/:id/email", () => {
    const setEmail = (token: string, id: string, body: object) =>
      request()
        .post(`${STAFF_BASE}/${id}/email`)
        .set("Authorization", bearer(token))
        .send(body);

    const emailOf = async (id: string): Promise<string> => {
      const response = await request()
        .get(`${STAFF_BASE}/${id}`)
        .set("Authorization", bearer(superAdminTokens.accessToken))
        .expect(200);

      return response.body.data.email as string;
    };

    it("sets the address, signs the operator in under it, and keeps their sessions", async () => {
      const before = "staff.set.email.before@machxi.local";
      const after = "staff.set.email.after@machxi.local";
      const target = await createStaffMember(
        harness.app,
        adminTokens.accessToken,
        { email: before, roles: ["editor"] },
      );
      const tokens = await login(harness.app, "staff", {
        email: before,
        password: NEW_ACCOUNT_PASSWORD,
      });

      const response = await setEmail(superAdminTokens.accessToken, target.id, {
        email: after,
        currentPassword: superAdmin().password,
      }).expect(204);

      expect(response.text).toBe("");
      expect(await emailOf(target.id)).toBe(after);

      // An address is not a credential (ADR-0071 §6), so nothing is revoked —
      // the operator stays signed in on the device they are holding.
      await request()
        .get("/api/v1/admin/auth/me")
        .set("Authorization", bearer(tokens.accessToken))
        .expect(200);

      await login(harness.app, "staff", {
        email: after,
        password: NEW_ACCOUNT_PASSWORD,
      });

      const withOldAddress = await request()
        .post("/api/v1/admin/auth/login")
        .send({ email: before, password: NEW_ACCOUNT_PASSWORD })
        .expect(401);

      expect(withOldAddress.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
    });

    it("refuses a plain admin with 403 and changes nothing", async () => {
      const email = "staff.set.email.admin.refused@machxi.local";
      const target = await createStaffMember(
        harness.app,
        adminTokens.accessToken,
        { email, roles: ["editor"] },
      );

      const response = await setEmail(adminTokens.accessToken, target.id, {
        email: "staff.set.email.nope@machxi.local",
        currentPassword: NEW_ACCOUNT_PASSWORD,
      }).expect(403);

      expect(response.body.error.code).toBe("FORBIDDEN");
      expect(await emailOf(target.id)).toBe(email);
    });

    it("refuses a super admin who cannot re-present their own password", async () => {
      const email = "staff.set.email.password.refused@machxi.local";
      const target = await createStaffMember(
        harness.app,
        adminTokens.accessToken,
        { email, roles: ["editor"] },
      );

      const response = await setEmail(superAdminTokens.accessToken, target.id, {
        email: "staff.set.email.still.nope@machxi.local",
        currentPassword: "not-the-super-admins-password",
      }).expect(403);

      expect(response.body.error.code).toBe("AUTH_CURRENT_PASSWORD_INVALID");
      expect(await emailOf(target.id)).toBe(email);
    });

    it("answers the same 403 for an id that does not exist", async () => {
      const response = await setEmail(
        superAdminTokens.accessToken,
        UNKNOWN_ID,
        {
          email: "staff.set.email.unknown@machxi.local",
          currentPassword: "not-the-super-admins-password",
        },
      ).expect(403);

      expect(response.body.error.code).toBe("AUTH_CURRENT_PASSWORD_INVALID");
    });

    it("answers 404 for an unknown id once the actor verifies", async () => {
      const response = await setEmail(
        superAdminTokens.accessToken,
        UNKNOWN_ID,
        {
          email: "staff.set.email.unknown2@machxi.local",
          currentPassword: superAdmin().password,
        },
      ).expect(404);

      expect(response.body.error.code).toBe("NOT_FOUND");
    });

    it("answers 409 for an address another operator already holds", async () => {
      const email = "staff.set.email.conflict@machxi.local";
      const target = await createStaffMember(
        harness.app,
        adminTokens.accessToken,
        { email, roles: ["editor"] },
      );

      const response = await setEmail(superAdminTokens.accessToken, target.id, {
        email: FIXTURE_STAFF.manager,
        currentPassword: superAdmin().password,
      }).expect(409);

      expect(response.body.error.code).toBe("STAFF_EMAIL_TAKEN");
      expect(await emailOf(target.id)).toBe(email);
    });

    it("counts the subject's own address as taken", async () => {
      const email = "staff.set.email.same@machxi.local";
      const target = await createStaffMember(
        harness.app,
        adminTokens.accessToken,
        { email, roles: ["editor"] },
      );

      const response = await setEmail(superAdminTokens.accessToken, target.id, {
        email,
        currentPassword: superAdmin().password,
      }).expect(409);

      expect(response.body.error.code).toBe("STAFF_EMAIL_TAKEN");
    });

    it("rejects an unknown field and a malformed address", async () => {
      const unknownField = await setEmail(
        superAdminTokens.accessToken,
        adminId,
        {
          email: "staff.set.email.fine@machxi.local",
          currentPassword: superAdmin().password,
          roles: ["super_admin"],
        },
      ).expect(400);

      expect(unknownField.body.error.code).toBe("VALIDATION_ERROR");

      const malformed = await setEmail(superAdminTokens.accessToken, adminId, {
        email: "not-an-address",
        currentPassword: superAdmin().password,
      }).expect(400);

      expect(malformed.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  /**
   * Who may hand out the role that bypasses every other role check
   * (ADR-0017 §Invariants, ADR-0019).
   *
   * `authorize("admin")` gets a plain `admin` as far as `PATCH /:id`, so
   * without a rule in the service the `super_admin` role is self-service: send
   * your own id with `roles: ["super_admin"]` and the guard that was supposed
   * to be above you is now beneath you. The check is about the *change*, not
   * about the role appearing in the body, which is why the two "unaffected"
   * cases below are part of the rule rather than an accident of it.
   */
  describe("granting and revoking super_admin", () => {
    let superAdminId: string;

    beforeAll(async () => {
      const me = await request()
        .get("/api/v1/admin/auth/me")
        .set("Authorization", bearer(superAdminTokens.accessToken))
        .expect(200);

      superAdminId = me.body.data.id as string;
    });

    it("refuses an admin who creates a super admin", async () => {
      const response = await request()
        .post(STAFF_BASE)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({
          email: "escalation@machxi.local",
          password: NEW_ACCOUNT_PASSWORD,
          firstName: "Esca",
          lastName: "Lation",
          roles: ["super_admin"],
        })
        .expect(403);

      expect(response.body.error.code).toBe("FORBIDDEN");

      // Refused before the insert, not rolled back after it: an account that
      // exists with the wrong roles would be worse than no account at all.
      const search = await request()
        .get(
          `${STAFF_BASE}?${listQueryString({ "filter[email]": "escalation@machxi.local" })}`,
        )
        .set("Authorization", bearer(adminTokens.accessToken))
        .expect(200);

      expect(search.body.data).toEqual([]);
    });

    it("refuses an admin who promotes themselves", async () => {
      // The escalation this rule closes, in one request.
      const response = await request()
        .patch(`${STAFF_BASE}/${adminId}`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({ roles: ["admin", "super_admin"] })
        .expect(403);

      expect(response.body.error.code).toBe("FORBIDDEN");

      const after = await asAdmin(`${STAFF_BASE}/${adminId}`).expect(200);

      expect(after.body.data.roles).toEqual(["admin"]);
    });

    it("refuses an admin who demotes a super admin, before the invariant is consulted", async () => {
      // Privilege outranks state: "you may not do this at all" is a truer
      // answer than "the system will not let anyone do this right now", and a
      // 409 here would tell an admin that the only thing standing between them
      // and the demotion is a second super admin they could create.
      const response = await request()
        .patch(`${STAFF_BASE}/${superAdminId}`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({ roles: ["admin"] })
        .expect(403);

      expect(response.body.error.code).toBe("FORBIDDEN");
      expect(response.body.error.code).not.toBe("STAFF_LAST_SUPER_ADMIN");
    });

    it("lets an admin edit a super admin's profile", async () => {
      // The rule is about role membership, not about who the target is —
      // otherwise a super admin would be unadministrable by anyone else.
      const response = await request()
        .patch(`${STAFF_BASE}/${superAdminId}`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({ firstName: "Renamed" })
        .expect(200);

      expect(response.body.data.firstName).toBe("Renamed");
      expect(response.body.data.roles).toEqual(["super_admin"]);
    });

    it("lets an admin re-send a role set that already holds super_admin", async () => {
      // Membership is unchanged, so nothing is being granted; refusing this
      // would make every unrelated edit to a super admin's roles impossible.
      const response = await request()
        .patch(`${STAFF_BASE}/${superAdminId}`)
        .set("Authorization", bearer(adminTokens.accessToken))
        .send({ roles: ["super_admin"] })
        .expect(200);

      expect(response.body.data.roles).toEqual(["super_admin"]);
    });

    it("lets a super admin grant and revoke the role", async () => {
      const granted = await request()
        .patch(`${STAFF_BASE}/${adminId}`)
        .set("Authorization", bearer(superAdminTokens.accessToken))
        .send({ roles: ["admin", "super_admin"] })
        .expect(200);

      expect([...granted.body.data.roles].sort()).toEqual([
        "admin",
        "super_admin",
      ]);

      const revoked = await request()
        .patch(`${STAFF_BASE}/${adminId}`)
        .set("Authorization", bearer(superAdminTokens.accessToken))
        .send({ roles: ["admin"] })
        .expect(200);

      expect(revoked.body.data.roles).toEqual(["admin"]);
    });
  });

  /**
   * Protecting the *account*, not just the role (ADR-0017 §Invariants).
   *
   * Guarding role membership alone left the hierarchy inverted from below: an
   * `admin` could not take `super_admin` away, but could disable its holder,
   * or call `sessions/revoke` on them in a loop and keep them permanently
   * signed out. A privilege that everyone it outranks can neutralise is not a
   * privilege, so the same rank requirement covers both.
   */
  describe("protecting a super admin", () => {
    let superAdminId: string;
    /**
     * A dedicated `admin`, not the shared fixture.
     *
     * The blocks above change the shared admin's roles, and a role change now
     * ends that account's sessions — see the next describe. Borrowing its
     * token here would make these cases depend on the order the file happens
     * to run in.
     */
    let attacker: Tokens;

    beforeAll(async () => {
      const me = await request()
        .get("/api/v1/admin/auth/me")
        .set("Authorization", bearer(superAdminTokens.accessToken))
        .expect(200);

      superAdminId = me.body.data.id as string;

      await createStaffMember(harness.app, superAdminTokens.accessToken, {
        email: "rank.test@machxi.local",
        firstName: "Rank",
        lastName: "Test",
        roles: ["admin"],
      });

      attacker = await login(harness.app, "staff", {
        email: "rank.test@machxi.local",
        password: NEW_ACCOUNT_PASSWORD,
      });
    });

    it("refuses an admin who tries to disable one", async () => {
      const response = await request()
        .patch(`${STAFF_BASE}/${superAdminId}`)
        .set("Authorization", bearer(attacker.accessToken))
        .send({ status: "disabled" })
        .expect(403);

      expect(response.body.error.code).toBe("FORBIDDEN");
    });

    it("refuses an admin who tries to revoke one's sessions", async () => {
      const response = await request()
        .post(`${STAFF_BASE}/${superAdminId}/sessions/revoke`)
        .set("Authorization", bearer(attacker.accessToken))
        .expect(403);

      expect(response.body.error.code).toBe("FORBIDDEN");
    });

    it("leaves the super admin signed in after both refusals", async () => {
      // The point of the rule, stated as an outcome rather than a status code.
      await request()
        .get("/api/v1/admin/auth/me")
        .set("Authorization", bearer(superAdminTokens.accessToken))
        .expect(200);
    });

    it("lets an admin rename one, which removes no standing", async () => {
      await request()
        .patch(`${STAFF_BASE}/${superAdminId}`)
        .set("Authorization", bearer(attacker.accessToken))
        .send({ firstName: "Renamed" })
        .expect(200);
    });
  });

  /**
   * A role change ends the subject's sessions.
   *
   * Not housekeeping — it is what makes the change take effect. `authorize`
   * reads roles from the access token's claims (ADR-0018), which are up to
   * `JWT_ACCESS_TTL` stale. That was harmless while roles were immutable at
   * runtime; now, without this, a demoted admin keeps `admin` for the rest of
   * the token's life, which is long enough to call this very endpoint and put
   * the role back. An unrevoked demotion is not slow, it is reversible by the
   * person being demoted.
   */
  describe("a role change signs the account out", () => {
    it("kills the demoted account's access and refresh tokens", async () => {
      const target = await createStaffMember(
        harness.app,
        superAdminTokens.accessToken,
        {
          email: "demote.me@machxi.local",
          firstName: "Demo",
          lastName: "Tion",
          roles: ["admin"],
        },
      );

      const targetTokens = await login(harness.app, "staff", {
        email: "demote.me@machxi.local",
        password: NEW_ACCOUNT_PASSWORD,
      });

      await request()
        .get("/api/v1/admin/auth/me")
        .set("Authorization", bearer(targetTokens.accessToken))
        .expect(200);

      await request()
        .patch(`${STAFF_BASE}/${target.id}`)
        .set("Authorization", bearer(superAdminTokens.accessToken))
        .send({ roles: ["editor"] })
        .expect(200);

      // Without the revocation this would still be 200, and the token would
      // still claim `admin` — enough to re-grant itself the role.
      const refused = await request()
        .get("/api/v1/admin/auth/me")
        .set("Authorization", bearer(targetTokens.accessToken))
        .expect(401);

      expect(refused.body.error.code).toBe("AUTH_SESSION_REVOKED");

      // The refresh token dies with it, so the demotion cannot be waited out.
      await request()
        .post("/api/v1/admin/auth/refresh")
        .send({ refreshToken: targetTokens.refreshToken })
        .expect(401);
    });

    it("leaves the session alone when the same role set is re-sent", async () => {
      const target = await createStaffMember(
        harness.app,
        superAdminTokens.accessToken,
        {
          email: "unchanged.roles@machxi.local",
          firstName: "Un",
          lastName: "Changed",
          roles: ["editor", "manager"],
        },
      );

      const targetTokens = await login(harness.app, "staff", {
        email: "unchanged.roles@machxi.local",
        password: NEW_ACCOUNT_PASSWORD,
      });

      // Same set, different order: a client sending the whole resource back
      // must not cost the account its session.
      await request()
        .patch(`${STAFF_BASE}/${target.id}`)
        .set("Authorization", bearer(superAdminTokens.accessToken))
        .send({ roles: ["manager", "editor"] })
        .expect(200);

      await request()
        .get("/api/v1/admin/auth/me")
        .set("Authorization", bearer(targetTokens.accessToken))
        .expect(200);
    });
  });

  /**
   * The ADR-0017 invariant: at least one active `super_admin` must survive
   * every edit. It is a property of the *system*, not of the request, so it is
   * a 409 rather than a 403 — the caller has the privilege; the state refuses.
   *
   * Last in the file because proving the rule requires demoting the seeded
   * super admin, which the final step puts back.
   */
  describe("the last active super admin (ADR-0017)", () => {
    let superAdminId: string;

    const patchSuperAdmin = (body: object) =>
      request()
        .patch(`${STAFF_BASE}/${superAdminId}`)
        .set("Authorization", bearer(superAdminTokens.accessToken))
        .send(body);

    beforeAll(async () => {
      const me = await request()
        .get("/api/v1/admin/auth/me")
        .set("Authorization", bearer(superAdminTokens.accessToken))
        .expect(200);

      superAdminId = me.body.data.id as string;
    });

    it("refuses to demote the only one", async () => {
      const response = await patchSuperAdmin({ roles: ["admin"] }).expect(409);

      expect(response.body.error.code).toBe("STAFF_LAST_SUPER_ADMIN");
    });

    it("refuses to disable the only one", async () => {
      const response = await patchSuperAdmin({ status: "disabled" }).expect(
        409,
      );

      expect(response.body.error.code).toBe("STAFF_LAST_SUPER_ADMIN");
    });

    it("leaves the account untouched after a refusal", async () => {
      // A 409 must be a refusal, not a partial write: the invariant is checked
      // inside the same transaction the update would land in.
      const response = await request()
        .get(`${STAFF_BASE}/${superAdminId}`)
        .set("Authorization", bearer(superAdminTokens.accessToken))
        .expect(200);

      expect(response.body.data.roles).toEqual(["super_admin"]);
      expect(response.body.data.status).toBe("active");
    });

    it("allows the demotion once a second active super admin exists", async () => {
      const second = await createStaffMember(
        harness.app,
        superAdminTokens.accessToken,
        { email: "second.super@machxi.local", roles: ["super_admin"] },
      );

      const demoted = await patchSuperAdmin({ roles: ["admin"] }).expect(200);

      expect(demoted.body.data.roles).toEqual(["admin"]);

      // Put it back through the account that now holds the role, so the
      // invariant is restored by the same rule that was just exercised.
      const secondTokens = await login(harness.app, "staff", {
        email: second.email,
        password: NEW_ACCOUNT_PASSWORD,
      });

      const restored = await request()
        .patch(`${STAFF_BASE}/${superAdminId}`)
        .set("Authorization", bearer(secondTokens.accessToken))
        .send({ roles: ["super_admin"] })
        .expect(200);

      expect(restored.body.data.roles).toEqual(["super_admin"]);
    });
  });
});
