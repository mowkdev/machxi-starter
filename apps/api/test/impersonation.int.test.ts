import { auditEvents, impersonationHandoffs, sessions } from "@repo/db";
import { desc, eq } from "drizzle-orm";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppConfig } from "../src/core/config/index.js";
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
  FIXTURE_STAFF,
  FIXTURE_USERS,
  resetAndSeed,
  superAdmin,
} from "./support/seed.js";
import {
  CSRF_HEADER,
  REFRESH_COOKIE,
  TRANSPORT_HEADER,
  cookieValue,
  csrfCookie,
  setCookie,
  setCookies,
} from "./support/transport.js";

/**
 * The mint, the handoff and the exchange, end to end (ADR-0057 §1–§4,
 * ADR-0021).
 *
 * The unit suites prove the pieces — the token service's cap, the sessions
 * repository's columns — and only this file can prove the properties that are
 * the *composition*: that the mint sets no cookie, that the exchange sets only
 * the user population's, that a replay updates no row because the consume is
 * one statement, and that rotation leaves an impersonated session's end
 * exactly where the exchange put it.
 *
 * Every assertion about what the flow must **not** do is the important half
 * here. This is the highest-risk surface in the ledger and the plan makes
 * `security-reviewer` mandatory on every step of it; the tests are what the
 * reviewer's findings become.
 */

const MINT = (id: string) => `/api/v1/admin/users/${id}/impersonate`;
const EXCHANGE = "/api/v1/user/auth/impersonate";
const USER_CSRF_COOKIE = csrfCookie("user");

let harness: TestApp;
let adminToken: string;
let targetUserId: string;

/** `POST /admin/users/:id/impersonate` as the seeded super admin. */
const mint = (id: string, token = adminToken) =>
  supertest(harness.app).post(MINT(id)).set("Authorization", bearer(token));

const exchange = (token: string) =>
  supertest(harness.app).post(EXCHANGE).send({ token });

const sessionRows = (principalId: string) =>
  harness.db.db
    .select()
    .from(sessions)
    .where(eq(sessions.principalId, principalId));

const auditRows = () =>
  harness.db.db
    .select()
    .from(auditEvents)
    .orderBy(desc(auditEvents.occurredAt));

beforeAll(async () => {
  harness = createTestApp();
  await resetAndSeed({ db: harness.db, hasher: harness.hasher });

  const tokens: Tokens = await login(harness.app, "staff", superAdmin());

  adminToken = tokens.accessToken;

  // A dedicated target rather than the shared `customer@machxi.local` fixture:
  // this file revokes, exchanges and counts sessions, and the other user files
  // sign in as that account.
  const target = await createUserAccount(harness.app, adminToken, {
    email: "impersonation-target@machxi.local",
    firstName: "Impersonation",
    lastName: "Target",
  });

  targetUserId = target.id;
});

afterAll(async () => {
  await harness.close();
});

describe("the mint", () => {
  it("answers a handoff token and sets no cookie of any kind", async () => {
    // The absence is the security property (ADR-0057 §1): the admin segment's
    // cookies are never written by this flow, which is what leaves the minting
    // staff member's own session untouched.
    const response = await mint(targetUserId).expect(200);

    expect(response.body.data.token).toEqual(expect.any(String));
    expect(Date.parse(response.body.data.expiresAt as string)).toBeGreaterThan(
      Date.now(),
    );
    expect(setCookies(response)).toEqual([]);
  });

  it("stores only the token's hash, with both identities and the mint's client", async () => {
    const response = await mint(targetUserId).set("User-Agent", "vitest-mint");
    const token = response.body.data.token as string;

    // The one read of this table outside its repository, and it is what the
    // test is for: that the plaintext is nowhere in it.
    //
    // Newest first by `id`, which is a UUIDv7 — earlier tests in this file
    // have minted for the same target, and `find` on `userId` alone would
    // assert against whichever of them the planner happened to return.
    const rows = await harness.db.db
      .select()
      .from(impersonationHandoffs)
      .orderBy(desc(impersonationHandoffs.id));
    const row = rows.find((candidate) => candidate.userId === targetUserId);

    expect(rows.map((candidate) => candidate.tokenHash)).not.toContain(token);
    expect(row?.staffId).toEqual(expect.any(String));
    expect(row?.consumedAt).toBeNull();
    expect(row?.userAgent).toBe("vitest-mint");
  });

  it("refuses a manager", async () => {
    // `admin` only (ADR-0057 §1): a manager may read the customer base and may
    // not become one of them. `authorize("admin")` on the route narrows the
    // mount's `authorize("admin", "manager")`.
    const manager = await login(harness.app, "staff", {
      email: FIXTURE_STAFF.manager,
      password: FIXTURE_PASSWORD,
    });

    const response = await mint(targetUserId, manager.accessToken).expect(403);

    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("refuses an unauthenticated caller, and a customer's own token", async () => {
    await supertest(harness.app).post(MINT(targetUserId)).expect(401);

    // A user-population token on the admin segment is `AUTH_TOKEN_INVALID`,
    // not `FORBIDDEN`: the segment's `authenticate("staff")` refuses it on the
    // audience before any guard reads a role (ADR-0019 §1).
    const customer = await login(harness.app, "user", {
      email: FIXTURE_USERS.active,
      password: FIXTURE_PASSWORD,
    });

    const response = await mint(targetUserId, customer.accessToken).expect(401);

    expect(response.body.error.code).toBe("AUTH_TOKEN_INVALID");
  });

  it("refuses a disabled target", async () => {
    const disabled = await createUserAccount(harness.app, adminToken, {
      email: "impersonation-disabled@machxi.local",
      status: "disabled",
    });

    const response = await mint(disabled.id).expect(409);

    expect(response.body.error.code).toBe("CONFLICT");
  });

  it("refuses a deleted target", async () => {
    const doomed = await createUserAccount(harness.app, adminToken, {
      email: "impersonation-deleted@machxi.local",
    });

    await supertest(harness.app)
      .delete(`/api/v1/admin/users/${doomed.id}`)
      .set("Authorization", bearer(adminToken))
      .expect(204);

    const response = await mint(doomed.id).expect(409);

    expect(response.body.error.code).toBe("USER_DELETED");
  });

  it("refuses an unknown target", async () => {
    const response = await mint("00000000-0000-7000-8000-000000000009").expect(
      404,
    );

    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("writes an impersonation.minted row naming the staff member as the actor", async () => {
    // The inversion `identitiesFromPrincipal` warns about, asserted rather
    // than commented: the actor is the human who chose to act, and the
    // acting-as is the account (ADR-0058).
    await mint(targetUserId).expect(200);

    const minted = (await auditRows()).find(
      (row) => row.event === "impersonation.minted",
    );

    expect(minted).toMatchObject({
      actorType: "staff",
      actingAsType: "user",
      actingAsId: targetUserId,
    });
    expect(minted?.data).toMatchObject({ handoffId: expect.any(String) });
    // Never the credential, in the one table nothing prunes.
    expect(JSON.stringify(minted?.data)).not.toContain("token");
  });
});

describe("the exchange", () => {
  it("opens a user session and sets only the user population's cookies", async () => {
    const minted = await mint(targetUserId).expect(200);
    const response = await exchange(minted.body.data.token as string)
      .set(TRANSPORT_HEADER, "cookie")
      .expect(200);

    expect(response.body.data.principal).toMatchObject({
      kind: "user",
      id: targetUserId,
      impersonatedBy: { email: superAdmin().email },
    });

    // The login shape, on the user segment's cookies and nothing else: the
    // admin segment's CSRF cookie must not appear, or the flow would be
    // touching the staff session it exists to leave alone (ADR-0056).
    expect(cookieValue(response, REFRESH_COOKIE)).toEqual(expect.any(String));
    expect(cookieValue(response, USER_CSRF_COOKIE)).toEqual(expect.any(String));
    expect(cookieValue(response, csrfCookie("staff"))).toBeUndefined();

    // And the refresh cookie is path-scoped to the *user* segment, which is
    // the stronger half of "the staff session is untouched": the two segments
    // hold different cookie keys, so this one cannot overwrite the admin
    // panel's (ADR-0029 §Token transport).
    expect(setCookie(response, REFRESH_COOKIE)).toContain(
      "Path=/api/v1/user/auth",
    );

    // Cookie transport removes the token from the body, exactly as login does.
    expect(response.body.data.refreshToken).toBeUndefined();
  });

  it("gives the session a fixed end, and the access token dies no later", async () => {
    const minted = await mint(targetUserId).expect(200);
    const response = await exchange(minted.body.data.token as string).expect(
      200,
    );

    const endsAt = Date.parse(
      response.body.data.refreshTokenExpiresAt as string,
    );
    const accessEndsAt = Date.parse(
      response.body.data.accessTokenExpiresAt as string,
    );
    const ttlMs = harness.config.auth.impersonationSessionTtlSec * 1000;

    // Not `REFRESH_TOKEN_TTL` (30 days in `.env.test`): the fixed end is
    // anchored at the exchange (ADR-0057 §4).
    expect(endsAt - Date.now()).toBeLessThanOrEqual(ttlMs + 5_000);
    expect(endsAt - Date.now()).toBeGreaterThan(ttlMs - 60_000);
    expect(accessEndsAt).toBeLessThanOrEqual(endsAt);
  });

  it("marks the session with its actor and audits the exchange", async () => {
    const minted = await mint(targetUserId).expect(200);

    await exchange(minted.body.data.token as string).expect(200);

    const impersonated = (await sessionRows(targetUserId)).filter(
      (row) => row.impersonatedByStaffId !== null,
    );

    expect(impersonated.length).toBeGreaterThan(0);

    const exchanged = (await auditRows()).find(
      (row) => row.event === "impersonation.exchanged",
    );

    expect(exchanged).toMatchObject({
      actorType: "staff",
      actingAsType: "user",
      actingAsId: targetUserId,
    });
  });

  it("refuses a handoff whose target went inactive after the mint", async () => {
    // A minute passes between the mint and the exchange at most, and the
    // mint's check cannot speak for the exchange's instant (ADR-0057 §3).
    const victim = await createUserAccount(harness.app, adminToken, {
      email: "impersonation-disabled-late@machxi.local",
    });

    const minted = await mint(victim.id).expect(200);

    await supertest(harness.app)
      .patch(`/api/v1/admin/users/${victim.id}`)
      .set("Authorization", bearer(adminToken))
      .send({ status: "disabled" })
      .expect(200);

    const response = await exchange(minted.body.data.token as string).expect(
      401,
    );

    // The same indistinguishable answer a replay gets, and no session.
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
    expect(setCookies(response)).toEqual([]);
    expect(await sessionRows(victim.id)).toEqual([]);
  });

  it("refuses a handoff whose minting staff member was disabled", async () => {
    // The judgement the exchange makes and refresh does not: a session whose
    // actor cannot be resolved is one the banner could never name, and
    // ADR-0057 §7 makes that banner unremovable.
    const operator = await createStaffMember(harness.app, adminToken, {
      email: "impersonation-operator@machxi.local",
      roles: ["admin"],
    });

    const operatorTokens = await login(harness.app, "staff", {
      email: operator.email,
      password: NEW_ACCOUNT_PASSWORD,
    });

    const minted = await mint(targetUserId, operatorTokens.accessToken).expect(
      200,
    );

    await supertest(harness.app)
      .patch(`/api/v1/admin/staff/${operator.id}`)
      .set("Authorization", bearer(adminToken))
      .send({ status: "disabled" })
      .expect(200);

    const before = (await sessionRows(targetUserId)).length;
    const response = await exchange(minted.body.data.token as string).expect(
      401,
    );

    expect(response.body.error.code).toBe("UNAUTHENTICATED");
    expect((await sessionRows(targetUserId)).length).toBe(before);
  });

  it("refuses a replayed handoff, with nothing minted", async () => {
    // Strictly single-use, and by the shape of one statement rather than by a
    // read-then-write that could race (ADR-0057 §2).
    const minted = await mint(targetUserId).expect(200);
    const token = minted.body.data.token as string;

    await exchange(token).expect(200);

    const before = (await sessionRows(targetUserId)).length;
    const replay = await exchange(token).expect(401);

    expect(replay.body.error.code).toBe("UNAUTHENTICATED");
    expect(setCookies(replay)).toEqual([]);
    expect((await sessionRows(targetUserId)).length).toBe(before);
  });

  it("refuses two concurrent exchanges of one handoff, minting exactly one session", async () => {
    const minted = await mint(targetUserId).expect(200);
    const token = minted.body.data.token as string;
    const before = (await sessionRows(targetUserId)).length;

    const results = await Promise.all([exchange(token), exchange(token)]);

    expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
    expect((await sessionRows(targetUserId)).length).toBe(before + 1);
  });

  it("refuses an expired handoff", async () => {
    // Its own app, because the TTL is configuration and the suite's default is
    // the production 60 seconds — which no test may wait out.
    const expiring = createTestApp({
      config: (config: AppConfig): AppConfig => ({
        ...config,
        auth: { ...config.auth, impersonationHandoffTtlSec: 1 },
      }),
    });

    try {
      const minted = await supertest(expiring.app)
        .post(MINT(targetUserId))
        .set("Authorization", bearer(adminToken))
        .expect(200);

      await new Promise((resolve) => setTimeout(resolve, 1_100));

      const response = await supertest(expiring.app)
        .post(EXCHANGE)
        .send({ token: minted.body.data.token })
        .expect(401);

      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    } finally {
      await expiring.close();
    }
  });

  it("refuses an unknown token, and a malformed one before that", async () => {
    const unknown = await exchange("A".repeat(43)).expect(401);

    expect(unknown.body.error.code).toBe("UNAUTHENTICATED");

    await supertest(harness.app).post(EXCHANGE).send({}).expect(400);
    await supertest(harness.app)
      .post(EXCHANGE)
      .send({ token: "x".repeat(513) })
      .expect(400);
  });

  it("does not exist on the admin segment", async () => {
    // An admin-segment twin would be a way to mint a *staff* session from a
    // URL fragment (ADR-0057 §3). The route is registered only where the auth
    // factory's population is `user`, so the path answers as an unknown one.
    const minted = await mint(targetUserId).expect(200);

    await supertest(harness.app)
      .post("/api/v1/admin/auth/impersonate")
      .send({ token: minted.body.data.token })
      .expect(401);
  });

  it("leaves a pre-existing customer session alive in the database", async () => {
    // The operator's call at scoping (ADR-0057 §3): the browser's cookies are
    // overwritten, the row is not touched, and the customer's other devices
    // are unaffected.
    const customer = await login(harness.app, "user", {
      email: FIXTURE_USERS.active,
      password: FIXTURE_PASSWORD,
    });

    const minted = await mint(targetUserId).expect(200);

    await exchange(minted.body.data.token as string)
      .set(TRANSPORT_HEADER, "cookie")
      .expect(200);

    // The proof the row is untouched is that its own refresh still works.
    await supertest(harness.app)
      .post("/api/v1/user/auth/refresh")
      .send({ refreshToken: customer.refreshToken })
      .expect(200);
  });

  it("ends the impersonated session it replaces, on the trail", async () => {
    // ADR-0070 §4. The admin panel now stays on screen, so a second
    // Impersonate is one click away and the user population's cookies are one
    // jar: without this the first tab's next refresh would answer with the
    // *second* customer's principal and the first session would live out its
    // fixed end with nothing on the trail to say so.
    const victim = await createUserAccount(harness.app, adminToken, {
      email: "impersonation-replaced@machxi.local",
    });

    const first = await exchange(
      (await mint(victim.id).expect(200)).body.data.token as string,
    ).expect(200);
    const staleToken = first.body.data.refreshToken as string;
    const firstHandoffId = (
      (await auditRows()).find(
        (row) =>
          row.event === "impersonation.exchanged" &&
          row.actingAsId === victim.id,
      )?.data as { handoffId?: string } | null
    )?.handoffId;

    // What the browser does on the second confirm: the refresh cookie is
    // scoped to `/api/v1/user/auth` and the exchange is a route under it, so
    // it rides along — as a fact about the jar, never as this request's
    // credential.
    const replacement = (await mint(victim.id).expect(200)).body.data
      .token as string;
    const second = await supertest(harness.app)
      .post(EXCHANGE)
      .set("Cookie", [`${REFRESH_COOKIE}=${staleToken}`])
      .send({ token: replacement })
      .expect(200);

    // The stale tab meets the signed-out path it already has, rather than a
    // banner that quietly changed names.
    const stale = await supertest(harness.app)
      .post("/api/v1/user/auth/refresh")
      .send({ refreshToken: staleToken })
      .expect(401);

    expect(stale.body.error.code).toBe("AUTH_SESSION_REVOKED");

    // And the replacement is live: the two writes are one transaction, so
    // there is no ordering in which the first ends and the second is missing.
    await supertest(harness.app)
      .post("/api/v1/user/auth/refresh")
      .send({ refreshToken: second.body.data.refreshToken })
      .expect(200);

    const rows = await sessionRows(victim.id);
    const ended = rows.find((row) => row.revokedAt !== null);

    expect(ended?.revokedReason).toBe("impersonation_ended");
    expect(rows.filter((row) => row.revokedAt === null).length).toBe(1);

    // `replaced` is the point of the row: it separates a second impersonation
    // in the same browser from the exit control's `logout` and from a
    // revocation for cause (ADR-0057 §6, ADR-0070 §4).
    const trail = (await auditRows()).find(
      (row) =>
        row.event === "impersonation.ended" &&
        (row.data as { sessionId?: string } | null)?.sessionId === ended?.id,
    );

    expect(trail).toMatchObject({
      actorType: "staff",
      actingAsType: "user",
      actingAsId: victim.id,
    });

    // And it names the exchange that replaced it: the row's actor is the
    // operator whose impersonation ended, who on a shared workstation is not
    // the one who ended it.
    expect(trail?.data).toMatchObject({
      reason: "replaced",
      replacedByStaffId: trail?.actorId,
      replacedByHandoffId: expect.any(String),
    });
    expect(
      (trail?.data as { replacedByHandoffId?: string } | null)
        ?.replacedByHandoffId,
    ).not.toBe(firstHandoffId);
  });

  it("leaves a real customer session refreshing when its cookie rides along", async () => {
    // The carve-out is one predicate on one column: ADR-0057 §3 stands for a
    // session nobody is impersonating through, cookie in the jar or not.
    const customer = await login(harness.app, "user", {
      email: FIXTURE_USERS.active,
      password: FIXTURE_PASSWORD,
    });

    const minted = await mint(targetUserId).expect(200);

    await supertest(harness.app)
      .post(EXCHANGE)
      .set("Cookie", [`${REFRESH_COOKIE}=${customer.refreshToken}`])
      .send({ token: minted.body.data.token })
      .expect(200);

    await supertest(harness.app)
      .post("/api/v1/user/auth/refresh")
      .send({ refreshToken: customer.refreshToken })
      .expect(200);
  });

  it("mints as before when the cookie resolves to nothing", async () => {
    // Expired, revoked, unknown, rotated out: ignored here as it is on any
    // other request, and the exchange's own refusals are unchanged.
    const victim = await createUserAccount(harness.app, adminToken, {
      email: "impersonation-unknown-cookie@machxi.local",
    });

    const minted = await mint(victim.id).expect(200);

    const response = await supertest(harness.app)
      .post(EXCHANGE)
      .set("Cookie", [`${REFRESH_COOKIE}=${"A".repeat(43)}`])
      .send({ token: minted.body.data.token })
      .expect(200);

    expect(response.body.data.principal).toMatchObject({
      kind: "user",
      id: victim.id,
      impersonatedBy: { email: superAdmin().email },
    });
    expect(
      (await sessionRows(victim.id)).filter((row) => row.revokedAt === null)
        .length,
    ).toBe(1);
  });
});

describe("an impersonated session", () => {
  it("rotates without moving its end", async () => {
    // The one change ADR-0057 §4 makes to ADR-0018's refresh flow, and the
    // reason a reload survives while the window does not grow.
    const minted = await mint(targetUserId).expect(200);
    const opened = await exchange(minted.body.data.token as string).expect(200);
    const endsAt = opened.body.data.refreshTokenExpiresAt as string;

    const rotated = await supertest(harness.app)
      .post("/api/v1/user/auth/refresh")
      .send({ refreshToken: opened.body.data.refreshToken })
      .expect(200);

    expect(rotated.body.data.refreshTokenExpiresAt).toBe(endsAt);
    expect(rotated.body.data.refreshToken).not.toBe(
      opened.body.data.refreshToken,
    );
    // And the fact survives the rotation, which is what the banner needs.
    expect(rotated.body.data.principal.impersonatedBy).toMatchObject({
      email: superAdmin().email,
    });
  });

  it("leaves an ordinary session's sliding expiry alone", async () => {
    // The supersession's terms: every ADR-0018 behaviour outside the two named
    // deltas must show no diff. A login's refresh still slides.
    const opened = await login(harness.app, "user", {
      email: FIXTURE_USERS.active,
      password: FIXTURE_PASSWORD,
    });

    const first = await supertest(harness.app)
      .post("/api/v1/user/auth/refresh")
      .send({ refreshToken: opened.refreshToken })
      .expect(200);

    const rotated = await supertest(harness.app)
      .post("/api/v1/user/auth/refresh")
      .send({ refreshToken: first.body.data.refreshToken })
      .expect(200);

    expect(
      Date.parse(rotated.body.data.refreshTokenExpiresAt as string),
    ).toBeGreaterThanOrEqual(
      Date.parse(first.body.data.refreshTokenExpiresAt as string),
    );
    expect(rotated.body.data.principal.impersonatedBy).toBeUndefined();
  });

  it("serves the customer's own endpoints, on the customer's own CSRF cookie", async () => {
    const minted = await mint(targetUserId).expect(200);
    const opened = await exchange(minted.body.data.token as string)
      .set(TRANSPORT_HEADER, "cookie")
      .expect(200);

    const refresh = cookieValue(opened, REFRESH_COOKIE) ?? "";
    const csrf = cookieValue(opened, USER_CSRF_COOKIE) ?? "";

    await supertest(harness.app)
      .get("/api/v1/user/profile")
      .set("Authorization", bearer(opened.body.data.accessToken as string))
      .expect(200);

    // The cookie half works too: the exchange placed exactly what login places,
    // so a browser can refresh from it.
    await supertest(harness.app)
      .post("/api/v1/user/auth/refresh")
      .set("Cookie", [
        `${REFRESH_COOKIE}=${refresh}`,
        `${USER_CSRF_COOKIE}=${csrf}`,
      ])
      .set(CSRF_HEADER, csrf)
      .set(TRANSPORT_HEADER, "cookie")
      .expect(200);
  });
});

describe("the mint's rate limit", () => {
  let limited: TestApp;

  beforeAll(async () => {
    // Its own app with a real budget, the pattern the login limiter's test
    // uses: the memory store lives inside the limiter, which lives inside one
    // app, so a count here cannot leak into another file. `.env.test` turns
    // this limiter off for the rest of the suite.
    limited = createTestApp({
      config: (config: AppConfig): AppConfig => ({
        ...config,
        rateLimit: { ...config.rateLimit, impersonationMax: 2 },
      }),
    });
    await resetAndSeed({ db: limited.db, hasher: limited.hasher });
  });

  afterAll(async () => {
    await limited.close();
  });

  it("stops one staff member at their own budget, keyed on the actor", async () => {
    // A per-actor budget rather than a per-IP one (ADR-0057 §1): a support
    // desk shares an egress address, so an IP key would either bound nothing
    // or lock out the team.
    const admin = await login(limited.app, "staff", superAdmin());
    const target = await createUserAccount(limited.app, admin.accessToken, {
      email: "limited-target@machxi.local",
    });

    const attempt = () =>
      supertest(limited.app)
        .post(MINT(target.id))
        .set("Authorization", bearer(admin.accessToken));

    await attempt().expect(200);
    await attempt().expect(200);

    const response = await attempt().expect(429);

    expect(response.body.error.code).toBe("RATE_LIMITED");
    expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
  });
});
