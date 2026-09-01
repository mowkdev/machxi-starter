import { auditEvents, sessions } from "@repo/db";
import { desc, eq } from "drizzle-orm";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  NEW_ACCOUNT_PASSWORD,
  bearer,
  createStaffMember,
  createUserAccount,
  login,
  type Tokens,
} from "./support/actors.js";
import { createTestApp, type TestApp } from "./support/app.js";
import {
  FIXTURE_PASSWORD,
  FIXTURE_USERS,
  resetAndSeed,
  superAdmin,
} from "./support/seed.js";

/**
 * What an impersonated session may **not** do, what it leaves behind when it
 * does, and how it ends (ADR-0057 §5–§6, ADR-0058).
 *
 * `impersonation.int.test.ts` next door owns the mint and the exchange. This
 * file owns the three properties that only exist once a session is open:
 *
 * - the **exclusions** — the operations that would let an impersonator take
 *   the account over, refused by a named middleware rather than by a hidden
 *   button, and each one still available to the account's real owner;
 * - the **attribution** — both identities on every mutating request, in the
 *   audit table and on the log line;
 * - the **exits** — the banner's own control, and the one an operator does not
 *   choose: a staff member revoked for cause loses the sessions they are
 *   impersonating through, which every revocation path in the API missed
 *   until `D13.5` because an impersonated row is a *customer's*.
 */

const PROFILE = "/api/v1/user/profile";
const SETTINGS = "/api/v1/user/settings";
const LOGOUT_ALL = "/api/v1/user/auth/logout-all";
const LOGOUT = "/api/v1/user/auth/logout";

let harness: TestApp;
let adminToken: string;

const auditRows = () =>
  harness.db.db
    .select()
    .from(auditEvents)
    .orderBy(desc(auditEvents.occurredAt));

const sessionRows = (principalId: string) =>
  harness.db.db
    .select()
    .from(sessions)
    .where(eq(sessions.principalId, principalId));

/**
 * A trail row is written **after** the response (ADR-0058), so a test that
 * reads the table the instant supertest resolves is racing the insert it is
 * looking for. Polling is the honest way to wait for it: the discipline is
 * "best effort, off the request's path", and pretending otherwise in a test
 * would be pretending the row is transactional.
 */
const eventually = async <T>(
  read: () => Promise<T | undefined>,
): Promise<T> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const found = await read();

    if (found !== undefined) return found;

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error("the expected audit row never arrived");
};

/**
 * A customer account, and an impersonated session opened against it by the
 * seeded super admin — the whole flow, because nothing short of it produces a
 * token with an actor claim on it.
 */
const impersonate = async (
  email: string,
  operatorToken = adminToken,
): Promise<{ readonly userId: string; readonly tokens: Tokens }> => {
  const target = await createUserAccount(harness.app, adminToken, { email });

  const minted = await supertest(harness.app)
    .post(`/api/v1/admin/users/${target.id}/impersonate`)
    .set("Authorization", bearer(operatorToken))
    .expect(200);

  const opened = await supertest(harness.app)
    .post("/api/v1/user/auth/impersonate")
    .send({ token: minted.body.data.token })
    .expect(200);

  return {
    userId: target.id,
    tokens: {
      accessToken: opened.body.data.accessToken as string,
      refreshToken: opened.body.data.refreshToken as string,
    },
  };
};

/** The same account, signed in as itself — the control in every exclusion case. */
const signIn = (email: string) =>
  login(harness.app, "user", { email, password: NEW_ACCOUNT_PASSWORD });

beforeAll(async () => {
  harness = createTestApp();
  await resetAndSeed({ db: harness.db, hasher: harness.container.hasher });

  const tokens = await login(harness.app, "staff", superAdmin());

  adminToken = tokens.accessToken;
});

afterAll(async () => {
  await harness.close();
});

describe("the exclusion list", () => {
  it("refuses change-password, and lets the account's owner through", async () => {
    // The takeover operation par excellence: a new password is a credential
    // the customer never chose, on an account they cannot get back.
    const email = "exclusions-password@machxi.local";
    const { tokens } = await impersonate(email);

    const refused = await supertest(harness.app)
      .post(`${PROFILE}/change-password`)
      .set("Authorization", bearer(tokens.accessToken))
      .send({
        currentPassword: NEW_ACCOUNT_PASSWORD,
        newPassword: "TakenOver!2026",
      })
      .expect(403);

    expect(refused.body.error.code).toBe("AUTH_IMPERSONATION_REFUSED");

    // And the password is untouched, which is the property behind the status:
    // the guard runs before the schema and before the argon2 pool.
    const owner = await signIn(email);

    await supertest(harness.app)
      .post(`${PROFILE}/change-password`)
      .set("Authorization", bearer(owner.accessToken))
      .send({
        currentPassword: NEW_ACCOUNT_PASSWORD,
        newPassword: "ChosenByTheOwner!2026",
      })
      .expect(204);
  });

  it("refuses self-deletion, and lets the account's owner through", async () => {
    const email = "exclusions-delete@machxi.local";
    const { tokens } = await impersonate(email);

    const refused = await supertest(harness.app)
      .delete(PROFILE)
      .set("Authorization", bearer(tokens.accessToken))
      .send({ currentPassword: NEW_ACCOUNT_PASSWORD })
      .expect(403);

    expect(refused.body.error.code).toBe("AUTH_IMPERSONATION_REFUSED");

    const owner = await signIn(email);

    await supertest(harness.app)
      .delete(PROFILE)
      .set("Authorization", bearer(owner.accessToken))
      .send({ currentPassword: NEW_ACCOUNT_PASSWORD })
      .expect(204);
  });

  it("refuses logout-all, and lets the account's owner through", async () => {
    // Ending the customer's real sessions on every device they own is a
    // takeover step — it locks the owner out while the impersonator stays in
    // — and it is why `logout` is deliberately *not* on the list: that one is
    // the exit.
    const email = "exclusions-logout-all@machxi.local";
    const { tokens } = await impersonate(email);

    const refused = await supertest(harness.app)
      .post(LOGOUT_ALL)
      .set("Authorization", bearer(tokens.accessToken))
      .expect(403);

    expect(refused.body.error.code).toBe("AUTH_IMPERSONATION_REFUSED");

    const owner = await signIn(email);

    await supertest(harness.app)
      .post(LOGOUT_ALL)
      .set("Authorization", bearer(owner.accessToken))
      .expect(204);
  });

  it("does not end the impersonated session it refused", async () => {
    // `AUTH_IMPERSONATION_REFUSED` is deliberately outside `TERMINAL_AUTH_CODES`
    // (`D13.3`): the session is valid and stays valid, so a refused dialog
    // must not sign the operator out of an impersonation mid-flight.
    const { tokens } = await impersonate("exclusions-survives@machxi.local");

    await supertest(harness.app)
      .post(LOGOUT_ALL)
      .set("Authorization", bearer(tokens.accessToken))
      .expect(403);

    await supertest(harness.app)
      .get(PROFILE)
      .set("Authorization", bearer(tokens.accessToken))
      .expect(200);
  });

  it("writes an impersonation.refused row naming both identities", async () => {
    const { userId, tokens } = await impersonate(
      "exclusions-audited@machxi.local",
    );

    await supertest(harness.app)
      .post(LOGOUT_ALL)
      .set("Authorization", bearer(tokens.accessToken))
      .expect(403);

    const refused = await eventually(async () =>
      (await auditRows()).find(
        (row) =>
          row.event === "impersonation.refused" && row.actingAsId === userId,
      ),
    );

    expect(refused).toMatchObject({
      actorType: "staff",
      actingAsType: "user",
      actingAsId: userId,
      data: { method: "POST", path: LOGOUT_ALL },
    });
  });

  it("leaves the operations support actually needs alone", async () => {
    // ADR-0057 §5's other half: everything else the customer can do, the
    // impersonator can do — audited. A profile edit is what support opens the
    // app for, and it cannot move the address.
    const { tokens } = await impersonate("exclusions-allowed@machxi.local");

    await supertest(harness.app)
      .patch(PROFILE)
      .set("Authorization", bearer(tokens.accessToken))
      .send({ firstName: "Repaired" })
      .expect(200);
  });

  it("does not refuse the same operations on an ordinary session", async () => {
    // The supersession's terms: outside the two named deltas, ADR-0018's
    // behaviour shows no diff. The seeded customer never meets the guard.
    const customer = await login(harness.app, "user", {
      email: FIXTURE_USERS.active,
      password: FIXTURE_PASSWORD,
    });

    await supertest(harness.app)
      .post(LOGOUT_ALL)
      .set("Authorization", bearer(customer.accessToken))
      .expect(204);
  });
});

describe("the mutation trail", () => {
  it("records a settings write with both identities", async () => {
    // The operator's call at scoping: settings writes are allowed under
    // impersonation, because reproducing an issue sometimes needs them — and
    // every one of them lands with both identities on it (ADR-0057 §5).
    const { userId, tokens } = await impersonate("trail-settings@machxi.local");

    await supertest(harness.app)
      .patch(SETTINGS)
      .set("Authorization", bearer(tokens.accessToken))
      .send({ theme: "dark" })
      .expect(200);

    const row = await eventually(async () =>
      (await auditRows()).find(
        (candidate) =>
          candidate.event === "impersonation.mutation" &&
          candidate.actingAsId === userId,
      ),
    );

    expect(row).toMatchObject({
      actorType: "staff",
      actingAsType: "user",
      actingAsId: userId,
      data: { method: "PATCH", path: SETTINGS, statusCode: 200 },
    });
    // The request id is what joins this row to the access line that carries
    // the same two identities (ADR-0058).
    expect(row.requestId).toEqual(expect.any(String));
  });

  it("records nothing for a read", async () => {
    // Reads are logged, not audited (ADR-0057 §6): they are the bulk of the
    // traffic and the least of the questions an incident asks.
    const { userId, tokens } = await impersonate("trail-read@machxi.local");

    await supertest(harness.app)
      .get(PROFILE)
      .set("Authorization", bearer(tokens.accessToken))
      .expect(200);

    // A mutation on the same session, to give the trail something to catch up
    // to: if a read had been recorded it would be sitting before this row.
    await supertest(harness.app)
      .patch(PROFILE)
      .set("Authorization", bearer(tokens.accessToken))
      .send({ firstName: "Read" })
      .expect(200);

    await eventually(async () =>
      (await auditRows()).find(
        (row) =>
          row.event === "impersonation.mutation" && row.actingAsId === userId,
      ),
    );

    const forThisSession = (await auditRows()).filter(
      (row) =>
        row.event === "impersonation.mutation" && row.actingAsId === userId,
    );

    expect(forThisSession).toHaveLength(1);
    expect(forThisSession[0]?.data).toMatchObject({ method: "PATCH" });
  });

  it("records nothing for an ordinary customer's own mutation", async () => {
    const email = "trail-ordinary@machxi.local";

    await createUserAccount(harness.app, adminToken, { email });

    const owner = await signIn(email);

    await supertest(harness.app)
      .patch(PROFILE)
      .set("Authorization", bearer(owner.accessToken))
      .send({ firstName: "Nobody" })
      .expect(200);

    expect(
      (await auditRows()).some(
        (row) =>
          row.event === "impersonation.mutation" &&
          (row.data as { path?: string } | null)?.path === PROFILE &&
          row.actorType === "user",
      ),
    ).toBe(false);
  });
});

describe("the exit", () => {
  it("revokes with impersonation_ended and audits it", async () => {
    // The banner's one control calls the ordinary logout, and the service
    // sees the actor column (ADR-0057 §6).
    const { userId, tokens } = await impersonate("exit-logout@machxi.local");

    await supertest(harness.app)
      .post(LOGOUT)
      .set("Authorization", bearer(tokens.accessToken))
      .expect(204);

    const row = (await sessionRows(userId)).find(
      (candidate) => candidate.impersonatedByStaffId !== null,
    );

    expect(row?.revokedAt).not.toBeNull();
    expect(row?.revokedReason).toBe("impersonation_ended");

    const ended = await eventually(async () =>
      (await auditRows()).find(
        (candidate) =>
          candidate.event === "impersonation.ended" &&
          candidate.actingAsId === userId,
      ),
    );

    expect(ended).toMatchObject({ actorType: "staff", actingAsType: "user" });
  });

  it("leaves both an ended row and a mutation row, which is not double-counting", async () => {
    // The exit is a `POST` that answers `204`, so it is a lifecycle event *and*
    // a mutating request served under impersonation — two rows, two event
    // names, deliberately. Both reviewers raised it at `D13.5` and the answer
    // was to pin it rather than special-case one path inside a middleware
    // whose whole value is that it has none.
    const { userId, tokens } = await impersonate("exit-two-rows@machxi.local");

    await supertest(harness.app)
      .post(LOGOUT)
      .set("Authorization", bearer(tokens.accessToken))
      .expect(204);

    await eventually(async () =>
      (await auditRows()).find(
        (row) =>
          row.event === "impersonation.mutation" && row.actingAsId === userId,
      ),
    );

    expect(
      (await auditRows())
        .filter((row) => row.actingAsId === userId)
        .map((row) => row.event)
        .sort(),
    ).toEqual([
      "impersonation.ended",
      "impersonation.exchanged",
      "impersonation.minted",
      "impersonation.mutation",
    ]);
  });

  it("kills the session it ended, refresh token and all", async () => {
    const { tokens } = await impersonate("exit-dead@machxi.local");

    await supertest(harness.app)
      .post(LOGOUT)
      .set("Authorization", bearer(tokens.accessToken))
      .expect(204);

    await supertest(harness.app)
      .get(PROFILE)
      .set("Authorization", bearer(tokens.accessToken))
      .expect(401);

    await supertest(harness.app)
      .post("/api/v1/user/auth/refresh")
      .send({ refreshToken: tokens.refreshToken })
      .expect(401);
  });

  it("still writes plain logout on an ordinary session", async () => {
    const email = "exit-ordinary@machxi.local";
    const target = await createUserAccount(harness.app, adminToken, { email });
    const owner = await signIn(email);

    await supertest(harness.app)
      .post(LOGOUT)
      .set("Authorization", bearer(owner.accessToken))
      .expect(204);

    const row = (await sessionRows(target.id)).find(
      (candidate) => candidate.revokedAt !== null,
    );

    expect(row?.revokedReason).toBe("logout");
  });
});

describe("revoking a staff member's sessions", () => {
  /**
   * `D13.4`'s `security-reviewer` finding 1, and the reason this clause was
   * added to `D13.5`'s done-when: an impersonated row is `principal_type =
   * 'user'` carrying the customer's id, so `revokeAllForPrincipal({
   * principalType: "staff", … })` — which is every revocation path in the API
   * — matched none of them. An operator disabled *for cause* kept a
   * full-access customer session for the rest of `IMPERSONATION_SESSION_TTL`.
   */
  const operatorImpersonating = async (email: string, targetEmail: string) => {
    const operator = await createStaffMember(harness.app, adminToken, {
      email,
      roles: ["admin"],
    });

    const operatorTokens = await login(harness.app, "staff", {
      email: operator.email,
      password: NEW_ACCOUNT_PASSWORD,
    });

    const opened = await impersonate(targetEmail, operatorTokens.accessToken);

    return { operator, operatorTokens, ...opened } as const;
  };

  it("ends the sessions they are impersonating through, on the forced logout", async () => {
    const { operator, userId, tokens } = await operatorImpersonating(
      "revoked-operator@machxi.local",
      "revoked-through@machxi.local",
    );

    await supertest(harness.app)
      .post(`/api/v1/admin/staff/${operator.id}/sessions/revoke`)
      .set("Authorization", bearer(adminToken))
      .expect(204);

    await supertest(harness.app)
      .get(PROFILE)
      .set("Authorization", bearer(tokens.accessToken))
      .expect(401);

    const row = (await sessionRows(userId)).find(
      (candidate) => candidate.impersonatedByStaffId === operator.id,
    );

    expect(row?.revokedReason).toBe("impersonation_ended");

    // And it is on the trail, transactionally with the revocation. An
    // impersonation ended *for cause* is the one an incident queries, and
    // before `D13.5`'s review it produced no audit row at all — only a
    // prunable `sessions.revoked_reason`, the near-audit ADR-0058 replaces.
    const ended = (await auditRows()).find(
      (candidate) =>
        candidate.event === "impersonation.ended" &&
        candidate.actingAsId === userId,
    );

    expect(ended).toMatchObject({
      actorType: "staff",
      actorId: operator.id,
      actingAsType: "user",
      data: { reason: "admin_revoke" },
    });
  });

  it("ends them when the operator is disabled", async () => {
    const { operator, tokens } = await operatorImpersonating(
      "disabled-operator@machxi.local",
      "disabled-through@machxi.local",
    );

    await supertest(harness.app)
      .patch(`/api/v1/admin/staff/${operator.id}`)
      .set("Authorization", bearer(adminToken))
      .send({ status: "disabled" })
      .expect(200);

    await supertest(harness.app)
      .get(PROFILE)
      .set("Authorization", bearer(tokens.accessToken))
      .expect(401);
  });

  it("ends them when the operator is deleted", async () => {
    // Staff are hard-deleted (ADR-0028), and the column has no foreign key —
    // so nothing but this predicate would ever have ended the row.
    const { operator, tokens } = await operatorImpersonating(
      "deleted-operator@machxi.local",
      "deleted-through@machxi.local",
    );

    await supertest(harness.app)
      .delete(`/api/v1/admin/staff/${operator.id}`)
      .set("Authorization", bearer(adminToken))
      .expect(204);

    await supertest(harness.app)
      .get(PROFILE)
      .set("Authorization", bearer(tokens.accessToken))
      .expect(401);
  });

  it("leaves the customer's own sessions alone", async () => {
    // The predicate is an equality on `impersonated_by_staff_id`, which is
    // null on every ordinary row: revoking the operator must not sign the
    // customer out of their own devices.
    const { operator, userId } = await operatorImpersonating(
      "spared-operator@machxi.local",
      "spared-through@machxi.local",
    );

    const owner = await signIn("spared-through@machxi.local");

    await supertest(harness.app)
      .post(`/api/v1/admin/staff/${operator.id}/sessions/revoke`)
      .set("Authorization", bearer(adminToken))
      .expect(204);

    await supertest(harness.app)
      .get(PROFILE)
      .set("Authorization", bearer(owner.accessToken))
      .expect(200);

    expect(
      (await sessionRows(userId)).filter(
        (row) => row.impersonatedByStaffId === null && row.revokedAt === null,
      ).length,
    ).toBeGreaterThan(0);
  });
});
