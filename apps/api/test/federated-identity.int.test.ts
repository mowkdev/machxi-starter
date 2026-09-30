import {
  accountTokens,
  auditEvents,
  federatedIdentities,
  organizationMemberships,
  organizations,
  sessions,
  users,
  type DbExecutor,
} from "@repo/db";
import { and, eq, sql } from "drizzle-orm";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FakeOidcClaims } from "../src/core/oidc/index.js";
import { createAccountTokensRepository } from "../src/core/tokens/index.js";
import {
  NEW_ACCOUNT_PASSWORD,
  bearer,
  createUserAccount,
  login,
} from "./support/actors.js";
import { createTestApp, type TestApp } from "./support/app.js";
import { lastMailTo, registerVerified, tokenFromMail } from "./support/mail.js";
import {
  FIXTURE_PASSWORD,
  FIXTURE_USERS,
  resetAndSeed,
  superAdmin,
} from "./support/seed.js";
import {
  REFRESH_COOKIE,
  TRANSPORT_HEADER,
  cookieValue,
  setCookie,
} from "./support/transport.js";

/**
 * Sign in with Google on the wire (ADR-0072 §1, §2), against the fake
 * provider the harness hands the container.
 *
 * What this proves that the unit tier cannot: the transaction cookie really
 * binds the callback to the browser that started it; the resolution order —
 * subject, then an authoritative verified address held by an `active` account,
 * then creation on any verified address behind the registration flag —
 * decides against real rows;
 * creation lands the account, its grant, its personal organization and its
 * identity in one commit; and the handoff is a real `account_tokens` row that
 * a second exchange cannot spend. Since `D19.4` it also proves the ways in an
 * account keeps (ADR-0072 §3): the link start and the callback's link intent,
 * unlink with the current password, and the resets that remove every identity
 * beside the session-minted link that keeps them.
 *
 * The fake keeps the two promises the real provider keeps — PKCE and the
 * nonce — so a flow that threaded the wrong value out of its own cookie fails
 * here as it would against Google. Google itself is exercised only by the
 * operator's walk with real credentials (the plan's definition of done).
 */

const START = "/api/v1/public/auth/google/start";
const CALLBACK = "/api/v1/public/auth/google/callback";
const EXCHANGE = "/api/v1/public/auth/google/exchange";
const ME = "/api/v1/user/auth/me";
const LOGIN = "/api/v1/user/auth/login";
const LINK_START = "/api/v1/user/profile/identities/google/start";
const UNLINK = "/api/v1/user/profile/identities/google";
const SET_LINK = "/api/v1/user/profile/password/set-link";
const CHANGE_PASSWORD = "/api/v1/user/profile/change-password";
const FORGOT = "/api/v1/user/auth/password/forgot";
const RESET = "/api/v1/user/auth/password/reset";

/** Written out rather than derived, for `transport.ts`'s reason: a wire fact. */
const OIDC_COOKIE = "__Host-machxi.oidc";

/**
 * What the callback's redirect put in the fragment, where it pointed, and the
 * handoff binding it left in the cookie on a sign-in (ADR-0072 §2, amended at
 * `D19.2`) — `undefined` when it cleared the cookie instead.
 */
interface Landing {
  readonly base: string;
  readonly fragment: URLSearchParams;
  readonly binding: string | undefined;
}

const landingOf = (response: {
  readonly headers: Record<string, unknown>;
}): Landing => {
  const location = response.headers["location"];

  if (typeof location !== "string") {
    throw new Error("the callback set no Location");
  }

  const hash = location.indexOf("#");

  return {
    base: hash === -1 ? location : location.slice(0, hash),
    fragment: new URLSearchParams(hash === -1 ? "" : location.slice(hash + 1)),
    binding: cookieValue(response as never, OIDC_COOKIE),
  };
};

/** Claims for a person Google hosts — a consumer address — stated in full. */
const hosted = (
  subject: string,
  email: string,
  extra: Partial<FakeOidcClaims> = {},
): FakeOidcClaims => ({
  subject,
  email,
  emailVerified: true,
  emailAuthoritative: true,
  ...extra,
});

describe("sign in with Google", () => {
  let harness: TestApp;

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ db: harness.db, hasher: harness.hasher });
  });

  afterAll(async () => {
    await harness.close();
  });

  const request = () => supertest(harness.app);

  /** A start, as the customer app's client makes it. */
  const start = async () => {
    const response = await request().post(START).send({}).expect(200);

    return {
      response,
      authorizationUrl: response.body.data.authorizationUrl as string,
      cookie: cookieValue(response, OIDC_COOKIE) ?? "",
    };
  };

  /** The browser coming back from Google, carrying (or not) its cookie. */
  const callback = (query: Record<string, string>, cookie?: string) => {
    const call = request().get(CALLBACK).query(query);

    return cookie === undefined
      ? call
      : call.set("Cookie", `${OIDC_COOKIE}=${cookie}`);
  };

  /** The whole round trip: start, consent at the fake, callback. */
  const signIn = async (claims: FakeOidcClaims): Promise<Landing> => {
    const { authorizationUrl, cookie } = await start();
    const { code, state } = harness.oidc.consent(authorizationUrl, claims);
    const response = await callback({ code, state }, cookie).expect(302);

    return landingOf(response);
  };

  /** An exchange, presenting a binding cookie or none. */
  const exchange = (token: string, binding?: string) => {
    const call = request()
      .post(EXCHANGE)
      .set(TRANSPORT_HEADER, "cookie")
      .send({ token });

    return binding === undefined
      ? call
      : call.set("Cookie", `${OIDC_COOKIE}=${binding}`);
  };

  /** The exchange the landing route makes, in the browser the callback answered. */
  const redeem = (landing: Landing) =>
    exchange(landing.fragment.get("token") ?? "", landing.binding);

  const userRow = async (email: string) => {
    const [row] = await harness.db.db
      .select({
        id: users.id,
        status: users.status,
        passwordHash: users.passwordHash,
        emailVerifiedAt: users.emailVerifiedAt,
        firstName: users.firstName,
      })
      .from(users)
      .where(eq(users.email, email));

    return row;
  };

  const identitiesOf = (userId: string) =>
    harness.db.db
      .select({
        subject: federatedIdentities.subject,
        email: federatedIdentities.email,
        lastLoginAt: federatedIdentities.lastLoginAt,
      })
      .from(federatedIdentities)
      .where(eq(federatedIdentities.userId, userId));

  const identityBySubject = async (subject: string) => {
    const [row] = await harness.db.db
      .select({ userId: federatedIdentities.userId })
      .from(federatedIdentities)
      .where(eq(federatedIdentities.subject, subject));

    return row;
  };

  const landingBase = () => `${harness.config.apps.customerUrl}/auth/google`;

  /* ── the start ────────────────────────────────────────────────────────── */

  it("answers { authorizationUrl } and sets the transaction cookie HttpOnly, Secure, SameSite=Lax", async () => {
    const { response, authorizationUrl } = await start();

    const url = new URL(authorizationUrl);

    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toEqual(expect.any(String));
    expect(url.searchParams.get("nonce")).toEqual(expect.any(String));
    expect(url.searchParams.get("redirect_uri")).toBe(
      `${harness.config.federated.apiPublicUrl}/api/v1/public/auth/google/callback`,
    );
    // The verifier is the one secret of the round trip and never leaves the
    // cookie: only its challenge is on the URL.
    expect(url.searchParams.get("code_verifier")).toBeNull();

    const cookie = setCookie(response, OIDC_COOKIE) ?? "";

    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/;\s*Secure/i);
    expect(cookie).toMatch(/;\s*SameSite=Lax/i);
    expect(cookie).toMatch(/;\s*Path=\//i);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  /* ── the binding ──────────────────────────────────────────────────────── */

  it("redirects a callback whose state does not match the cookie with #error=, and writes no row", async () => {
    const email = "state.mismatch@gmail.test";
    const { authorizationUrl, cookie } = await start();
    const { code } = harness.oidc.consent(
      authorizationUrl,
      hosted("sub-state-mismatch", email),
    );

    const response = await callback(
      { code, state: "somebody-elses-state" },
      cookie,
    ).expect(302);
    const landing = landingOf(response);

    expect(landing.base).toBe(landingBase());
    expect(landing.fragment.get("error")).toBe("UNAUTHENTICATED");
    expect(landing.fragment.get("token")).toBeNull();
    expect(await userRow(email)).toBeUndefined();
    expect(await identityBySubject("sub-state-mismatch")).toBeUndefined();

    // The transaction is spent whatever happened, so a second navigation
    // cannot finish it.
    expect(setCookie(response, OIDC_COOKIE)).toMatch(
      /Expires=Thu, 01 Jan 1970/,
    );
  });

  it("refuses a callback that arrives without the cookie", async () => {
    const { authorizationUrl } = await start();
    const { code, state } = harness.oidc.consent(
      authorizationUrl,
      hosted("sub-no-cookie", "no.cookie@gmail.test"),
    );

    const response = await callback({ code, state }).expect(302);

    expect(landingOf(response).fragment.get("error")).toBe("UNAUTHENTICATED");
    expect(await userRow("no.cookie@gmail.test")).toBeUndefined();
    expect(await identityBySubject("sub-no-cookie")).toBeUndefined();
  });

  it("refuses a person who declined at Google", async () => {
    const { authorizationUrl, cookie } = await start();
    const state = new URL(authorizationUrl).searchParams.get("state") ?? "";

    const response = await callback(
      { error: "access_denied", state },
      cookie,
    ).expect(302);

    expect(landingOf(response).fragment.get("error")).toBe("UNAUTHENTICATED");
    // Spent, as every other refusal spends it.
    expect(setCookie(response, OIDC_COOKIE)).toMatch(
      /Expires=Thu, 01 Jan 1970/,
    );
  });

  it("refuses a start that is not a JSON request, so a cross-site form cannot make one", async () => {
    // A form can post `text/plain`, which no parser reads and the schema
    // would accept as `{}`; it cannot post `application/json` (`D19.2`'s
    // `security-reviewer`).
    const response = await request()
      .post(START)
      .set("Content-Type", "text/plain")
      .send("locale=en")
      .expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(setCookie(response, OIDC_COOKIE)).toBeUndefined();
  });

  /* ── creation ─────────────────────────────────────────────────────────── */

  describe("an unknown verified address", () => {
    const email = "stranger@gmail.test";
    const subject = "sub-stranger";
    let landing: Landing;

    beforeAll(async () => {
      landing = await signIn(
        hosted(subject, email, { givenName: "Stella", familyName: "Stranger" }),
      );

      expect(landing.base).toBe(landingBase());
    });

    it("creates an active account with no password, its address stamped, one personal organization and one identity", async () => {
      expect(landing.fragment.get("token")).toEqual(expect.any(String));

      const account = await userRow(email);

      expect(account).toMatchObject({
        status: "active",
        passwordHash: null,
        emailVerifiedAt: expect.any(Date),
        firstName: "Stella",
      });

      const owned = await harness.db.db
        .select({
          kind: organizations.kind,
          role: organizationMemberships.role,
        })
        .from(organizationMemberships)
        .innerJoin(
          organizations,
          eq(organizations.id, organizationMemberships.organizationId),
        )
        .where(eq(organizationMemberships.userId, account?.id ?? ""));

      expect(owned).toEqual([{ kind: "personal", role: "owner" }]);
      expect(await identitiesOf(account?.id ?? "")).toEqual([
        { subject, email, lastLoginAt: null },
      ]);

      const trail = await harness.db.db
        .select({ event: auditEvents.event, data: auditEvents.data })
        .from(auditEvents)
        .where(eq(auditEvents.actorId, account?.id ?? ""));

      expect(trail).toEqual(
        expect.arrayContaining([
          { event: "account.verified", data: { provider: "google" } },
          {
            event: "account.identity_linked",
            data: { provider: "google", via: "signup" },
          },
        ]),
      );
    });

    it("leaves the handoff binding in the cookie's place, for the handoff's sixty seconds", async () => {
      // One `Set-Cookie`: the transaction ends and the binding begins
      // (ADR-0072 §2, amended at `D19.2`).
      expect(landing.binding).toEqual(expect.any(String));
    });

    it("refuses the token in a browser the callback did not answer, and spends nothing", async () => {
      // The relay the binding closes: a token lifted from somebody else's
      // redirect, exchanged with no binding, or with another sign-in's.
      const token = landing.fragment.get("token") ?? "";
      const other = await signIn(
        hosted("sub-other-browser", "other.browser@gmail.test"),
      );

      const unbound = await exchange(token).expect(401);
      const misbound = await exchange(token, other.binding).expect(401);

      expect(unbound.body.error.code).toBe("UNAUTHENTICATED");
      expect(misbound.body.error.code).toBe("UNAUTHENTICATED");
      // The cookie is spent on a refusal too.
      expect(setCookie(misbound, OIDC_COOKIE)).toMatch(
        /Expires=Thu, 01 Jan 1970/,
      );
    });

    it("exchanges the fragment token once, into login's body with Set-Cookie", async () => {
      const token = landing.fragment.get("token") ?? "";
      const first = await redeem(landing).expect(200);

      expect(first.body.data.principal).toMatchObject({ kind: "user", email });
      expect(first.body.data.accessToken).toEqual(expect.any(String));
      // Cookie transport: the refresh token went into the jar, not the body.
      expect(first.body.data.refreshToken).toBeUndefined();
      expect(cookieValue(first, REFRESH_COOKIE)).toEqual(expect.any(String));

      const second = await exchange(token, landing.binding).expect(401);

      expect(second.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("answers `me` with hasPassword: false and the one identity", async () => {
      const again = await signIn(hosted(subject, email));
      const session = await request()
        .post(EXCHANGE)
        .set("Cookie", `${OIDC_COOKIE}=${again.binding ?? ""}`)
        .send({ token: again.fragment.get("token") })
        .expect(200);

      const me = await request()
        .get(ME)
        .set("Authorization", bearer(session.body.data.accessToken as string))
        .expect(200);

      expect(me.body.data.hasPassword).toBe(false);
      expect(me.body.data.identities).toEqual([
        { provider: "google", email, linkedAt: expect.any(String) },
      ]);
    });

    it("keeps refusing a password login, as it has for every passwordless account", async () => {
      const response = await request()
        .post(LOGIN)
        .send({ email, password: "any-password-at-all" })
        .expect(401);

      expect(response.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
    });

    it("shows the admin the identity, read-only", async () => {
      const staff = await login(harness.app, "staff", superAdmin());
      const account = await userRow(email);

      const response = await request()
        .get(`/api/v1/admin/users/${account?.id ?? ""}`)
        .set("Authorization", bearer(staff.accessToken))
        .expect(200);

      expect(response.body.data.identities).toEqual([
        { provider: "google", email, linkedAt: expect.any(String) },
      ]);
      expect(response.body.data).not.toHaveProperty("hasPassword");
    });
  });

  /* ── by subject ───────────────────────────────────────────────────────── */

  it("resolves a second sign-in by subject, after the account's address changed", async () => {
    const subject = "sub-moved";
    const first = await signIn(hosted(subject, "before.move@gmail.test"));
    const firstSession = await redeem(first);
    const id = firstSession.body.data.principal.id as string;

    await harness.db.db
      .update(users)
      .set({ email: "after.move@example.test" })
      .where(eq(users.id, id));

    // Google may report a third address by now; the subject is what decides.
    const second = await signIn(
      hosted(subject, "renamed.at.google@gmail.test"),
    );
    const secondSession = await redeem(second).expect(200);

    expect(secondSession.body.data.principal.id).toBe(id);
    expect(await userRow("renamed.at.google@gmail.test")).toBeUndefined();

    const [identity] = await identitiesOf(id);

    expect(identity?.lastLoginAt).toEqual(expect.any(Date));
  });

  it("refuses the exchange once the account is no longer active", async () => {
    // A disable does not supersede a live handoff, so the exchange re-reads
    // the account (`D19.1`'s `security-reviewer`, carried to this step).
    const landing = await signIn(
      hosted("sub-disabled-meanwhile", "disabled.meanwhile@gmail.test"),
    );

    await harness.db.db
      .update(users)
      .set({ status: "disabled" })
      .where(eq(users.email, "disabled.meanwhile@gmail.test"));

    const response = await redeem(landing).expect(401);

    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  /* ── by address ───────────────────────────────────────────────────────── */

  it("links an authoritative verified address to its active holder and signs them in", async () => {
    const email = "linked.by.address@gmail.test";
    const account = await registerVerified(
      harness,
      email,
      "a-perfectly-fine-password",
    );

    const landing = await signIn(hosted("sub-by-address", email));
    const session = await redeem(landing).expect(200);

    expect(session.body.data.principal.id).toBe(account.id);
    expect(await identitiesOf(account.id)).toEqual([
      { subject: "sub-by-address", email, lastLoginAt: null },
    ]);

    const [row] = await harness.db.db
      .select({ data: auditEvents.data })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.actorId, account.id),
          eq(auditEvents.event, "account.identity_linked"),
        ),
      );

    expect(row?.data).toEqual({ provider: "google", via: "address" });

    // The password is untouched: both ways in now work.
    await request()
      .post(LOGIN)
      .send({ email, password: "a-perfectly-fine-password" })
      .expect(200);
  });

  it("refuses a verified address Google is not authoritative for, held by an active account, with AUTH_FEDERATED_LINK_REQUIRED", async () => {
    const holder = await userRow(FIXTURE_USERS.active);
    const before = await identitiesOf(holder?.id ?? "");

    const landing = await signIn(
      hosted("sub-not-authoritative", FIXTURE_USERS.active, {
        emailAuthoritative: false,
      }),
    );

    expect(landing.fragment.get("error")).toBe("AUTH_FEDERATED_LINK_REQUIRED");
    expect(await identityBySubject("sub-not-authoritative")).toBeUndefined();
    expect(await identitiesOf(holder?.id ?? "")).toEqual(before);
  });

  it("refuses to link a second Google account to an account that already has one", async () => {
    // The `--dev` customer carries the fixture identity; another subject for
    // the same address is not the sign-in's to swap in.
    const landing = await signIn(
      hosted("sub-second-google-account", FIXTURE_USERS.active),
    );

    expect(landing.fragment.get("error")).toBe("CONFLICT");
    expect(
      await identityBySubject("sub-second-google-account"),
    ).toBeUndefined();
  });

  it("refuses a pending_verification holder with AUTH_EMAIL_UNVERIFIED and links nothing", async () => {
    const landing = await signIn(
      hosted("sub-pending-holder", FIXTURE_USERS.pending),
    );

    expect(landing.fragment.get("error")).toBe("AUTH_EMAIL_UNVERIFIED");
    expect(await identityBySubject("sub-pending-holder")).toBeUndefined();
    expect(await userRow(FIXTURE_USERS.pending)).toMatchObject({
      status: "pending_verification",
      emailVerifiedAt: null,
    });
  });

  it("refuses a disabled holder with AUTH_ACCOUNT_DISABLED", async () => {
    const landing = await signIn(
      hosted("sub-disabled-holder", FIXTURE_USERS.disabled),
    );

    expect(landing.fragment.get("error")).toBe("AUTH_ACCOUNT_DISABLED");
    expect(await identityBySubject("sub-disabled-holder")).toBeUndefined();
  });

  it("creates an account for a verified address Google does not host when nobody holds it", async () => {
    // The `D19.2` case inverted (ADR-0072 §1, the narrowing withdrawn at
    // `D19.4`): a reset now removes every identity, so an account made on a
    // mailbox that changed hands is recovered by the mailbox, and creation
    // reads the verified claim alone. The held case above still refuses.
    const email = "custom.domain@example.test";
    const landing = await signIn(
      hosted("sub-custom-domain", email, { emailAuthoritative: false }),
    );

    expect(landing.fragment.get("token")).toEqual(expect.any(String));

    const account = await userRow(email);

    expect(account).toMatchObject({ status: "active", passwordHash: null });
    expect(await identityBySubject("sub-custom-domain")).toEqual({
      userId: account?.id,
    });
  });

  it("creates nothing for an unverified email claim", async () => {
    const email = "unverified.claim@example.test";
    const landing = await signIn({
      subject: "sub-unverified",
      email,
      emailVerified: false,
      emailAuthoritative: false,
    });

    expect(landing.fragment.get("error")).toBe("UNAUTHENTICATED");
    expect(await userRow(email)).toBeUndefined();
    expect(await identityBySubject("sub-unverified")).toBeUndefined();
  });

  it("answers an unverified claim for a held address exactly as for an unknown one", async () => {
    // A claim that proves nothing may not learn whether an account holds
    // the address (ADR-0072 §2, amended at `D19.2`).
    const landing = await signIn({
      subject: "sub-unverified-held",
      email: FIXTURE_USERS.active,
      emailVerified: false,
      emailAuthoritative: false,
    });

    expect(landing.fragment.get("error")).toBe("UNAUTHENTICATED");
  });

  /* ── the ways in an account keeps (ADR-0072 §3) ───────────────────────── */

  describe("the ways into an account", () => {
    let adminToken: string;

    beforeAll(async () => {
      adminToken = (await login(harness.app, "staff", superAdmin()))
        .accessToken;
    });

    /** A session for an account made through Google — one with no password. */
    const googleOnly = async (subject: string, email: string) => {
      const session = await redeem(await signIn(hosted(subject, email))).expect(
        200,
      );

      return {
        id: session.body.data.principal.id as string,
        accessToken: session.body.data.accessToken as string,
      };
    };

    /** An account an admin made, with a password, signed in. */
    const passwordAccount = async (email: string) => {
      const created = await createUserAccount(harness.app, adminToken, {
        email,
      });
      const tokens = await login(harness.app, "user", {
        email,
        password: NEW_ACCOUNT_PASSWORD,
      });

      return { id: created.id, accessToken: tokens.accessToken };
    };

    /** The link start, as the security section makes it. */
    const startLink = (accessToken: string) =>
      request()
        .post(LINK_START)
        .set("Authorization", bearer(accessToken))
        .send({});

    /** The whole link round trip for the holder of `accessToken`. */
    const linkAs = async (
      accessToken: string,
      claims: FakeOidcClaims,
    ): Promise<Landing> => {
      const started = await startLink(accessToken).expect(200);
      const { code, state } = harness.oidc.consent(
        started.body.data.authorizationUrl as string,
        claims,
      );

      return landingOf(
        await callback(
          { code, state },
          cookieValue(started, OIDC_COOKIE) ?? "",
        ).expect(302),
      );
    };

    /** A password account with one Google identity linked from its session. */
    const linkedPasswordAccount = async (email: string, subject: string) => {
      const account = await passwordAccount(email);

      expect(
        (
          await linkAs(account.accessToken, hosted(subject, email))
        ).fragment.get("linked"),
      ).toBe("google");

      return account;
    };

    /** An impersonated session on `userId`, minted by the seeded super admin. */
    const impersonate = async (userId: string): Promise<string> => {
      const minted = await request()
        .post(`/api/v1/admin/users/${userId}/impersonate`)
        .set("Authorization", bearer(adminToken))
        .expect(200);
      const opened = await request()
        .post("/api/v1/user/auth/impersonate")
        .send({ token: minted.body.data.token })
        .expect(200);

      return opened.body.data.accessToken as string;
    };

    const unlink = (accessToken: string, currentPassword: string) =>
      request()
        .delete(UNLINK)
        .set("Authorization", bearer(accessToken))
        .send({ currentPassword });

    const trailOf = (userId: string, event: string) =>
      harness.db.db
        .select({ data: auditEvents.data, actorId: auditEvents.actorId })
        .from(auditEvents)
        .where(
          and(eq(auditEvents.actorId, userId), eq(auditEvents.event, event)),
        );

    /* link */

    it("answers a link start with { authorizationUrl } and the transaction cookie", async () => {
      const account = await passwordAccount("link.start@example.test");
      const response = await startLink(account.accessToken).expect(200);

      expect(response.body.data.authorizationUrl).toEqual(expect.any(String));
      expect(setCookie(response, OIDC_COOKIE)).toMatch(/;\s*SameSite=Lax/i);
    });

    it("writes one identity for the caller in the link intent and redirects with #linked=google", async () => {
      // The Google address need not match the account's (ADR-0072 §3).
      const account = await passwordAccount("links.google@example.test");
      const landing = await linkAs(
        account.accessToken,
        hosted("sub-linked-from-security", "someone.else@gmail.test"),
      );

      expect(landing.base).toBe(landingBase());
      expect(landing.fragment.get("linked")).toBe("google");
      expect(landing.fragment.get("token")).toBeNull();
      // No handoff: the transaction is simply spent.
      expect(landing.binding).toBeUndefined();
      expect(await identitiesOf(account.id)).toEqual([
        {
          subject: "sub-linked-from-security",
          email: "someone.else@gmail.test",
          lastLoginAt: null,
        },
      ]);
      expect(
        (await trailOf(account.id, "account.identity_linked")).map(
          (row) => row.data,
        ),
      ).toEqual([{ provider: "google", via: "link" }]);
    });

    it("refuses a subject already linked to another account with #error=AUTH_IDENTITY_TAKEN, and writes nothing", async () => {
      const holder = await googleOnly(
        "sub-held-elsewhere",
        "holder@gmail.test",
      );
      const account = await passwordAccount("wants.it@example.test");

      const landing = await linkAs(
        account.accessToken,
        hosted("sub-held-elsewhere", "holder@gmail.test"),
      );

      expect(landing.fragment.get("error")).toBe("AUTH_IDENTITY_TAKEN");
      expect(await identitiesOf(account.id)).toEqual([]);
      expect(await identityBySubject("sub-held-elsewhere")).toEqual({
        userId: holder.id,
      });
    });

    it("refuses a second Google account on an account that has one with #error=CONFLICT, and swaps nothing", async () => {
      // The owner unlinks the old one first; a link does not replace it
      // (ADR-0072 §3, the sign-in's rule).
      const account = await linkedPasswordAccount(
        "has.one@gmail.test",
        "sub-the-first",
      );

      const landing = await linkAs(
        account.accessToken,
        hosted("sub-the-second", "second.google@gmail.test"),
      );

      expect(landing.fragment.get("error")).toBe("CONFLICT");
      expect(await identitiesOf(account.id)).toEqual([
        expect.objectContaining({ subject: "sub-the-first" }),
      ]);
      expect(await identityBySubject("sub-the-second")).toBeUndefined();
    });

    it("links a Google account the caller already holds again as a no-op", async () => {
      const account = await linkedPasswordAccount(
        "links.twice@gmail.test",
        "sub-links-twice",
      );

      const landing = await linkAs(
        account.accessToken,
        hosted("sub-links-twice", "links.twice@gmail.test"),
      );

      expect(landing.fragment.get("linked")).toBe("google");
      expect(await identitiesOf(account.id)).toHaveLength(1);
      expect(await trailOf(account.id, "account.identity_linked")).toHaveLength(
        1,
      );
    });

    it("refuses a link whose session ended before the callback, and writes nothing", async () => {
      // ADR-0072 §3, amended at `D19.4`: the identity joins the account only
      // while the session that asked is live — a reset ending it in between
      // must not be followed by the link it started.
      const account = await passwordAccount("session.ended@example.test");
      const started = await startLink(account.accessToken).expect(200);

      await request()
        .post(`/api/v1/admin/users/${account.id}/sessions/revoke`)
        .set("Authorization", bearer(adminToken))
        .expect(204);

      const { code, state } = harness.oidc.consent(
        started.body.data.authorizationUrl as string,
        hosted("sub-after-revoke", "after.revoke@gmail.test"),
      );
      const landing = landingOf(
        await callback(
          { code, state },
          cookieValue(started, OIDC_COOKIE) ?? "",
        ).expect(302),
      );

      expect(landing.fragment.get("error")).toBe("UNAUTHENTICATED");
      expect(await identityBySubject("sub-after-revoke")).toBeUndefined();
    });

    /* unlink */

    it("refuses to unlink the last credential of a passwordless account with 409 AUTH_LAST_CREDENTIAL", async () => {
      const account = await googleOnly(
        "sub-last-credential",
        "last@gmail.test",
      );

      const response = await unlink(
        account.accessToken,
        "anything-at-all",
      ).expect(409);

      expect(response.body.error.code).toBe("AUTH_LAST_CREDENTIAL");
      expect(await identitiesOf(account.id)).toHaveLength(1);
    });

    it("refuses an unlink with the wrong current password with 403, and the row stays", async () => {
      const account = await linkedPasswordAccount(
        "unlink.wrong@gmail.test",
        "sub-unlink-wrong",
      );

      const response = await unlink(
        account.accessToken,
        "not-my-password",
      ).expect(403);

      expect(response.body.error.code).toBe("AUTH_CURRENT_PASSWORD_INVALID");
      expect(await identitiesOf(account.id)).toHaveLength(1);
    });

    it("unlinks with the right current password: 204, the row gone, and an account.identity_unlinked row naming the user", async () => {
      const account = await linkedPasswordAccount(
        "unlink.right@gmail.test",
        "sub-unlink-right",
      );

      const response = await unlink(
        account.accessToken,
        NEW_ACCOUNT_PASSWORD,
      ).expect(204);

      expect(response.body).toEqual({});
      expect(await identitiesOf(account.id)).toEqual([]);
      expect(await trailOf(account.id, "account.identity_unlinked")).toEqual([
        { data: { provider: "google", via: "unlink" }, actorId: account.id },
      ]);
      // Nothing about the sessions changed: the caller's still reads `me`.
      await request()
        .get(ME)
        .set("Authorization", bearer(account.accessToken))
        .expect(200);
      // And unlinking what is no longer there is the caller's own `404`.
      expect(
        (await unlink(account.accessToken, NEW_ACCOUNT_PASSWORD).expect(404))
          .body.error.code,
      ).toBe("NOT_FOUND");
    });

    /* impersonation */

    it("refuses the link start, unlink and the set-password link on an impersonated session, while the account's own session succeeds", async () => {
      const account = await linkedPasswordAccount(
        "impersonated.ways@gmail.test",
        "sub-impersonated-ways",
      );
      // The set-password link is for an account without a password (§3,
      // amended after `D19.4`), so its half of the case is a Google-only one.
      const passwordless = await googleOnly(
        "sub-impersonated-passwordless",
        "impersonated.passwordless@gmail.test",
      );
      const operator = await impersonate(account.id);
      const operatorOnPasswordless = await impersonate(passwordless.id);

      for (const refused of [
        await startLink(operator),
        await unlink(operator, NEW_ACCOUNT_PASSWORD),
        await request()
          .post(SET_LINK)
          .set("Authorization", bearer(operatorOnPasswordless)),
      ]) {
        expect(refused.status).toBe(403);
        expect(refused.body.error.code).toBe("AUTH_IMPERSONATION_REFUSED");
      }

      expect(await identitiesOf(account.id)).toHaveLength(1);

      // The owner, signed in as themselves, may do all three.
      await startLink(account.accessToken).expect(200);
      await request()
        .post(SET_LINK)
        .set("Authorization", bearer(passwordless.accessToken))
        .expect(202);
      await unlink(account.accessToken, NEW_ACCOUNT_PASSWORD).expect(204);
    });

    /* the resets (ADR-0072 §3, amended) */

    it("removes every identity at an anonymous reset: 204, the row gone, and an account.identity_unlinked row with via: reset", async () => {
      const email = "reset.by.mail@gmail.test";
      const account = await linkedPasswordAccount(email, "sub-reset-by-mail");

      await request().post(FORGOT).send({ email }).expect(202);
      await request()
        .post(RESET)
        .send({
          token: tokenFromMail(lastMailTo(harness, email)),
          newPassword: "Recovered!2026",
        })
        .expect(204);

      expect(await identitiesOf(account.id)).toEqual([]);
      expect(await trailOf(account.id, "account.identity_unlinked")).toEqual([
        { data: { provider: "google", via: "reset" }, actorId: account.id },
      ]);
      // The Google account is free again: it no longer resolves to anybody.
      expect(await identityBySubject("sub-reset-by-mail")).toBeUndefined();
    });

    it("removes every identity at the administrative reset too", async () => {
      const email = "reset.by.admin@gmail.test";
      const account = await linkedPasswordAccount(email, "sub-reset-by-admin");
      const staff = await login(harness.app, "staff", superAdmin());

      await request()
        .post(`/api/v1/admin/users/${account.id}/password`)
        .set("Authorization", bearer(staff.accessToken))
        .send({
          password: "ResetByStaff!2026",
          currentPassword: superAdmin().password,
        })
        .expect(204);

      expect(await identitiesOf(account.id)).toEqual([]);

      // The operator is the actor and the account the subject — `setEmail`'s
      // shape for an administrative write (ADR-0058).
      const rows = await harness.db.db
        .select({ data: auditEvents.data })
        .from(auditEvents)
        .where(eq(auditEvents.event, "account.identity_unlinked"));

      expect(rows.map((row) => row.data)).toContainEqual({
        subjectType: "user",
        subjectId: account.id,
        provider: "google",
        via: "reset",
      });
    });

    it("leaves the identity at a change of password made with the current one", async () => {
      const account = await linkedPasswordAccount(
        "changes.own@gmail.test",
        "sub-changes-own",
      );

      await request()
        .post(CHANGE_PASSWORD)
        .set("Authorization", bearer(account.accessToken))
        .send({
          currentPassword: NEW_ACCOUNT_PASSWORD,
          newPassword: "ChangedMyself!2026",
        })
        .expect(204);

      expect(await identitiesOf(account.id)).toHaveLength(1);
    });

    it("answers set-link 202, mails a link, and the reset that consumes it sets the password and keeps the identity", async () => {
      const email = "sets.password@gmail.test";
      const account = await googleOnly("sub-sets-password", email);

      const response = await request()
        .post(SET_LINK)
        .set("Authorization", bearer(account.accessToken))
        .expect(202);

      expect(response.body.data).toEqual({ accepted: true });

      const message = lastMailTo(harness, email);

      expect(message?.text).toContain(
        `${harness.config.apps.customerUrl}/reset-password#token=`,
      );

      await request()
        .post(RESET)
        .send({
          token: tokenFromMail(message),
          newPassword: "ChosenLater!2026",
        })
        .expect(204);

      // Both ways in now work: the password just chosen, and Google — the
      // identity the account was made with is older than the session that
      // asked, so the consume keeps it (§3, amended after `D19.4`).
      await request()
        .post(LOGIN)
        .send({ email, password: "ChosenLater!2026" })
        .expect(200);
      expect(await identitiesOf(account.id)).toHaveLength(1);
      expect(await trailOf(account.id, "account.identity_unlinked")).toEqual(
        [],
      );
      expect(
        (await trailOf(account.id, "account.password_reset")).map(
          (row) => row.data,
        ),
      ).toEqual([{ requestedBy: "session", unlinked: [] }]);
    });

    /* the set-password link keeps only what is older than its session */

    /** Asks for the set-password link as `accessToken` and returns its token. */
    const setLinkToken = async (accessToken: string, email: string) => {
      await request()
        .post(SET_LINK)
        .set("Authorization", bearer(accessToken))
        .expect(202);

      return tokenFromMail(lastMailTo(harness, email));
    };

    const consume = (token: string) =>
      request()
        .post(RESET)
        .send({ token, newPassword: "SetFromTheLink!2026" })
        .expect(204);

    it("refuses set-link with 409 CONFLICT on an account that has a password, and mails nothing", async () => {
      // ADR-0072 §3, amended after `D19.4`: an account with a password
      // changes it with the current one; the second door is what a stolen
      // session would need.
      const email = "has.a.password@example.test";
      const account = await passwordAccount(email);
      const before = harness.mail.length;

      const response = await request()
        .post(SET_LINK)
        .set("Authorization", bearer(account.accessToken))
        .expect(409);

      expect(response.body.error.code).toBe("CONFLICT");
      expect(harness.mail.length).toBe(before);
    });

    it("removes, at a session-minted consume, an identity linked after the asking session began", async () => {
      const email = "linked.after@gmail.test";
      const account = await googleOnly("sub-linked-after", email);

      // The one provider allows one identity, and a passwordless account can
      // neither gain a second nor lose its first from a session — so "linked
      // after the session began" is set on the row rather than reached by a
      // flow (the record says the first rule alone suffices today, and this
      // is the rule that keeps it sufficient when a second provider arrives).
      const [session] = await harness.db.db
        .select({ createdAt: sessions.createdAt })
        .from(sessions)
        .where(eq(sessions.principalId, account.id));

      await harness.db.db
        .update(federatedIdentities)
        .set({
          linkedAt: new Date((session?.createdAt.getTime() ?? 0) + 60_000),
        })
        .where(eq(federatedIdentities.userId, account.id));

      await consume(await setLinkToken(account.accessToken, email));

      expect(await identitiesOf(account.id)).toEqual([]);
      expect(await trailOf(account.id, "account.identity_unlinked")).toEqual([
        { data: { provider: "google", via: "reset" }, actorId: account.id },
      ]);
      expect(
        (await trailOf(account.id, "account.password_reset")).map(
          (row) => row.data,
        ),
      ).toEqual([{ requestedBy: "session", unlinked: ["google"] }]);
    });

    it("removes every identity at a session-minted consume when the asking session's row is gone", async () => {
      const email = "session.gone@gmail.test";
      const account = await googleOnly("sub-session-gone", email);
      const token = await setLinkToken(account.accessToken, email);

      // Pruned — a revoked row would still say when it began; a missing one
      // says nothing, and nothing is kept on its word.
      await harness.db.db
        .delete(sessions)
        .where(eq(sessions.principalId, account.id));

      await consume(token);

      expect(await identitiesOf(account.id)).toEqual([]);
      expect(await identityBySubject("sub-session-gone")).toBeUndefined();
    });

    it("names a mailbox reset in the account.password_reset row, with what it removed", async () => {
      const email = "mailbox.reset@gmail.test";
      const account = await linkedPasswordAccount(email, "sub-mailbox-reset");

      await request().post(FORGOT).send({ email }).expect(202);
      await consume(tokenFromMail(lastMailTo(harness, email)));

      expect(
        (await trailOf(account.id, "account.password_reset")).map(
          (row) => row.data,
        ),
      ).toEqual([{ requestedBy: "mailbox", unlinked: ["google"] }]);
    });

    /* a link and a reset of one account serialise on its row */

    /**
     * Holds the account row's lock in a transaction of the suite's own, runs
     * `start` — which must come to wait on that lock — and then `meanwhile`
     * inside the held transaction before it commits.
     *
     * The wait is observed in `pg_locks` rather than assumed from a sleep: a
     * request that never blocked would be a request that ran beside the held
     * transaction, which is exactly the interleaving the lock exists to stop,
     * and the case would pass by timing rather than prove anything.
     */
    const whileTheRowIsHeld = async <T>(
      userId: string,
      begin: () => Promise<T>,
      meanwhile: (tx: DbExecutor) => Promise<void>,
    ): Promise<T> => {
      let pending: Promise<T> | undefined;

      await harness.db.db.transaction(async (tx) => {
        await tx.execute(
          sql`select id from ${users} where id = ${userId} for update`,
        );

        pending = begin();

        for (let attempt = 0; ; attempt += 1) {
          const [row] = await tx.execute<{ waiting: number }>(
            sql`select count(*)::int as waiting from pg_locks where not granted`,
          );

          if ((row?.waiting ?? 0) > 0) break;
          if (attempt === 200) {
            throw new Error("nothing came to wait on the account row");
          }

          await new Promise((resolve) => setTimeout(resolve, 25));
        }

        await meanwhile(tx);
      });

      if (pending === undefined) throw new Error("the request never began");

      return pending;
    };

    it("leaves no identity behind when a link callback waits on a reset of the account", async () => {
      // The reset holds the row; the link that waits on it reads the session
      // the reset revoked, and refuses (ADR-0072 §3, amended after `D19.4`).
      const account = await passwordAccount("link.waits@example.test");
      const started = await startLink(account.accessToken).expect(200);
      const { code, state } = harness.oidc.consent(
        started.body.data.authorizationUrl as string,
        hosted("sub-link-waits", "link.waits@gmail.test"),
      );

      const response = await whileTheRowIsHeld(
        account.id,
        () =>
          callback({ code, state }, cookieValue(started, OIDC_COOKIE) ?? "")
            .expect(302)
            .then((answer) => answer),
        // What a reset does before it commits: every session of the account
        // ends (and every identity it can see goes — there is none yet).
        async (tx) => {
          await tx
            .update(sessions)
            .set({ revokedAt: new Date(), revokedReason: "password_reset" })
            .where(eq(sessions.principalId, account.id));
        },
      );

      expect(landingOf(response).fragment.get("error")).toBe("UNAUTHENTICATED");
      expect(await identityBySubject("sub-link-waits")).toBeUndefined();
    });

    it("refuses at the exchange a Google handoff minted before a reset of the account", async () => {
      // `D19.5`'s `security-reviewer`: a sixty-second handoff is a session
      // not yet issued, and the reset's session sweep cannot see it — so the
      // reset supersedes it, or the person it recovers the account from signs
      // in a moment after the recovery.
      const email = "handoff.before.reset@gmail.test";

      await linkedPasswordAccount(email, "sub-handoff-before-reset");

      const landing = await signIn(hosted("sub-handoff-before-reset", email));

      expect(landing.fragment.get("token")).not.toBeNull();

      await request().post(FORGOT).send({ email }).expect(202);
      await consume(tokenFromMail(lastMailTo(harness, email)));

      const refused = await redeem(landing).expect(401);

      expect(refused.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("refuses a sign-in by subject that waits on a reset removing its identity", async () => {
      // The reset holds the row and removes the identity the sign-in found a
      // moment before; the sign-in that comes second finds it gone and mints
      // nothing (`D19.5`'s `security-reviewer`).
      const email = "signin.waits@gmail.test";
      const account = await linkedPasswordAccount(email, "sub-signin-waits");
      const { authorizationUrl, cookie } = await start();
      const { code, state } = harness.oidc.consent(
        authorizationUrl,
        hosted("sub-signin-waits", email),
      );

      const response = await whileTheRowIsHeld(
        account.id,
        () =>
          callback({ code, state }, cookie)
            .expect(302)
            .then((answer) => answer),
        async (tx) => {
          await tx
            .delete(federatedIdentities)
            .where(eq(federatedIdentities.userId, account.id));
        },
      );

      const landing = landingOf(response);

      expect(landing.fragment.get("token")).toBeNull();
      expect(landing.fragment.get("error")).toBe("UNAUTHENTICATED");
    });

    it("leaves no identity behind when a reset waits on a link to the account", async () => {
      // The link holds the row and commits its identity; the reset that waits
      // on it sees the identity, and removes it.
      const email = "reset.waits@example.test";
      const account = await passwordAccount(email);

      await request().post(FORGOT).send({ email }).expect(202);

      const token = tokenFromMail(lastMailTo(harness, email));

      await whileTheRowIsHeld(
        account.id,
        () => consume(token).then((answer) => answer),
        // What the link commits while it holds the row.
        async (tx) => {
          await tx.insert(federatedIdentities).values({
            userId: account.id,
            provider: "google",
            subject: "sub-reset-waits",
            email: "reset.waits@gmail.test",
          });
        },
      );

      expect(await identityBySubject("sub-reset-waits")).toBeUndefined();
      expect(await trailOf(account.id, "account.identity_unlinked")).toEqual([
        { data: { provider: "google", via: "reset" }, actorId: account.id },
      ]);
    });
    /* an exchange and a reset of one account take turns (ADR-0078 §3) */

    /**
     * Plays a credential event's locks in a transaction of the suite's own —
     * `head` takes what the event holds when the exchange arrives — starts the
     * exchange, waits until it is observed waiting, and then runs `tail`, the
     * rest of the event, **under a lock timeout shorter than Postgres's
     * deadlock timeout**.
     *
     * The timeout is the proof. An exchange that held something the event's
     * tail needs would make the tail wait on it while it waits on the event:
     * the tail's statement then fails on the timeout, and the case with it,
     * before the deadlock detector gets to choose a victim — so a retry at the
     * composition root cannot hide an inverted order here. The waiting is read
     * from `pg_locks`, scoped to this database, rather than assumed from a
     * sleep, for {@link whileTheRowIsHeld}'s reason.
     */
    const whileAnEventHoldsTheAccount = async <T>(
      begin: () => Promise<T>,
      head: (tx: DbExecutor) => Promise<void>,
      tail: (tx: DbExecutor) => Promise<void>,
    ): Promise<T> => {
      let pending: Promise<T> | undefined;

      await harness.db.db.transaction(async (tx) => {
        await head(tx);

        pending = begin();

        for (let attempt = 0; ; attempt += 1) {
          const [row] = await tx.execute<{ waiting: number }>(
            sql`select count(*)::int as waiting
                  from pg_locks l
                  join pg_stat_activity a on a.pid = l.pid
                 where not l.granted and a.datname = current_database()`,
          );

          if ((row?.waiting ?? 0) > 0) break;
          if (attempt === 200) {
            throw new Error("the exchange never came to wait on the event");
          }

          await new Promise((resolve) => setTimeout(resolve, 25));
        }

        await tx.execute(sql`set local lock_timeout = '500ms'`);
        await tail(tx);
      });

      if (pending === undefined) throw new Error("the exchange never began");

      return pending;
    };

    /** The credential lock every sweep takes — the app's own statement. */
    const lockCredentialsOf = (userId: string, tx: DbExecutor) =>
      createAccountTokensRepository(harness.db.db).lockCredentials(
        { principalType: "user", principalId: userId },
        tx,
      );

    /** A sweep of the account's live Google handoffs, as a reset runs it. */
    const sweepHandoffs = (userId: string, tx: DbExecutor) =>
      tx
        .update(accountTokens)
        .set({ consumedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(accountTokens.principalId, userId),
            eq(accountTokens.purpose, "federated_login"),
            sql`${accountTokens.consumedAt} is null`,
          ),
        );

    /** Every session of the account ends, as a reset ends them. */
    const endSessions = (userId: string, tx: DbExecutor) =>
      tx
        .update(sessions)
        .set({ revokedAt: new Date(), revokedReason: "password_reset" })
        .where(eq(sessions.principalId, userId));

    const liveSessionsOf = async (userId: string) =>
      (
        await harness.db.db
          .select({ id: sessions.id })
          .from(sessions)
          .where(
            and(
              eq(sessions.principalId, userId),
              sql`${sessions.revokedAt} is null`,
            ),
          )
      ).length;

    it("an exchange racing a reset ends in one outcome and no deadlock", async () => {
      // The race `D28.5` logged: the callback minted this handoff behind the
      // account row while a reset waited for that row, so the reset's first
      // sweep missed it and its second — behind the row — is the one that
      // reaches it. An exchange that claimed the handoff first and reached
      // for the account second held what that second sweep waits on.
      const email = "exchange.races.reset@gmail.test";
      const account = await linkedPasswordAccount(
        email,
        "sub-exchange-races-reset",
      );
      const landing = await signIn(hosted("sub-exchange-races-reset", email));

      expect(landing.fragment.get("token")).not.toBeNull();

      const response = await whileAnEventHoldsTheAccount(
        () => redeem(landing).then((answer) => answer),
        // The reset past its first sweep: the credential lock, then the row.
        async (tx) => {
          await lockCredentialsOf(account.id, tx);
          await tx.execute(
            sql`select id from ${users} where id = ${account.id} for update`,
          );
        },
        // Its second sweep, and its session sweep.
        async (tx) => {
          await sweepHandoffs(account.id, tx);
          await endSessions(account.id, tx);
        },
      );

      // One outcome: the reset won, so the handoff is spent and the exchange
      // is the refusal it would have been had it come a second later.
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHENTICATED");
      expect(await liveSessionsOf(account.id)).toBe(0);
    });

    it("an exchange racing a reset's first sweep waits holding nothing", async () => {
      // The other half of the order: the reset's first sweep reaches a live
      // handoff before it takes the account row, so an exchange that held the
      // account row while it reached for the handoff would be the mirror of
      // the case above. The credential lock is what makes it wait first.
      const email = "exchange.races.sweep@gmail.test";
      const account = await linkedPasswordAccount(
        email,
        "sub-exchange-races-sweep",
      );
      const landing = await signIn(hosted("sub-exchange-races-sweep", email));

      const response = await whileAnEventHoldsTheAccount(
        () => redeem(landing).then((answer) => answer),
        async (tx) => {
          await lockCredentialsOf(account.id, tx);
          await sweepHandoffs(account.id, tx);
        },
        // Then the account row, and the sessions.
        async (tx) => {
          await tx.execute(
            sql`select id from ${users} where id = ${account.id} for update`,
          );
          await endSessions(account.id, tx);
        },
      );

      expect(response.status).toBe(401);
      expect(await liveSessionsOf(account.id)).toBe(0);
    });

    it("a sign-in racing a reset's first sweep waits holding nothing", async () => {
      // `D29.3`'s `security-reviewer`: the callback locks the account and then
      // mints, and the mint supersedes the older live handoff the event's
      // sweep already holds. The callback takes the credential lock before the
      // account row, so it waits where the event's other racers wait.
      const email = "signin.races.sweep@gmail.test";
      const account = await linkedPasswordAccount(
        email,
        "sub-signin-races-sweep",
      );

      // The older handoff, live when the event sweeps it.
      await signIn(hosted("sub-signin-races-sweep", email));

      const { authorizationUrl, cookie } = await start();
      const { code, state } = harness.oidc.consent(
        authorizationUrl,
        hosted("sub-signin-races-sweep", email),
      );

      const response = await whileAnEventHoldsTheAccount(
        () =>
          callback({ code, state }, cookie)
            .expect(302)
            .then((answer) => answer),
        async (tx) => {
          await lockCredentialsOf(account.id, tx);
          await sweepHandoffs(account.id, tx);
        },
        async (tx) => {
          await tx.execute(
            sql`select id from ${users} where id = ${account.id} for update`,
          );
          await endSessions(account.id, tx);
        },
      );

      // One outcome: the event left the identity, so the sign-in that waited
      // for it completes after it, with a handoff of its own.
      expect(landingOf(response).fragment.get("token")).not.toBeNull();
    });
  });

  it("keeps a password account's own login working beside all of this", async () => {
    await login(harness.app, "user", {
      email: FIXTURE_USERS.active,
      password: FIXTURE_PASSWORD,
    });
  });
});

describe("sign in with Google, registration off", () => {
  let harness: TestApp;

  beforeAll(async () => {
    harness = createTestApp({
      config: (config) => ({
        ...config,
        features: { ...config.features, userRegistration: false },
      }),
    });
    await resetAndSeed({ db: harness.db, hasher: harness.hasher });
  });

  afterAll(async () => {
    await harness.close();
  });

  it("refuses an unknown address with AUTH_FEDERATED_SIGNUP_CLOSED and writes no row", async () => {
    const email = "closed.stranger@gmail.test";
    const started = await supertest(harness.app)
      .post(START)
      .send({})
      .expect(200);
    const { code, state } = harness.oidc.consent(
      started.body.data.authorizationUrl as string,
      hosted("sub-closed-stranger", email),
    );

    const response = await supertest(harness.app)
      .get(CALLBACK)
      .query({ code, state })
      .set(
        "Cookie",
        `${OIDC_COOKIE}=${cookieValue(started, OIDC_COOKIE) ?? ""}`,
      )
      .expect(302);

    expect(landingOf(response).fragment.get("error")).toBe(
      "AUTH_FEDERATED_SIGNUP_CLOSED",
    );

    const [row] = await harness.db.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));

    expect(row).toBeUndefined();

    const [identity] = await harness.db.db
      .select({ id: federatedIdentities.id })
      .from(federatedIdentities)
      .where(eq(federatedIdentities.subject, "sub-closed-stranger"));

    expect(identity).toBeUndefined();
  });

  it("still signs an existing account in by subject", async () => {
    // The flag decides whether an account may be *made*; the `--dev`
    // customer's fixture identity is a way into one that exists.
    const started = await supertest(harness.app)
      .post(START)
      .send({})
      .expect(200);
    const { code, state } = harness.oidc.consent(
      started.body.data.authorizationUrl as string,
      hosted("dev-fixture-google-subject-customer", FIXTURE_USERS.active),
    );

    const response = await supertest(harness.app)
      .get(CALLBACK)
      .query({ code, state })
      .set(
        "Cookie",
        `${OIDC_COOKIE}=${cookieValue(started, OIDC_COOKIE) ?? ""}`,
      )
      .expect(302);

    expect(landingOf(response).fragment.get("token")).toEqual(
      expect.any(String),
    );
  });
});

describe("sign in with Google, no client configured", () => {
  let harness: TestApp;

  beforeAll(() => {
    harness = createTestApp({
      config: (config) => ({
        ...config,
        federated: { ...config.federated, google: undefined },
      }),
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  it.each([
    ["post", START],
    ["get", CALLBACK],
    ["post", EXCHANGE],
  ] as const)(
    "answers %s %s with 404 ROUTE_NOT_FOUND",
    async (method, path) => {
      const response = await supertest(harness.app)[method](path).expect(404);

      expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
    },
  );

  it("answers the link start 404 ROUTE_NOT_FOUND too, while unlink is still mounted", async () => {
    // Removing a way in needs nothing from Google, so an account that holds an
    // identity on a deployment that dropped its client can still remove it.
    await resetAndSeed({ db: harness.db, hasher: harness.hasher });

    const { accessToken } = await login(harness.app, "user", {
      email: FIXTURE_USERS.active,
      password: FIXTURE_PASSWORD,
    });

    const start = await supertest(harness.app)
      .post(LINK_START)
      .set("Authorization", bearer(accessToken))
      .send({})
      .expect(404);

    expect(start.body.error.code).toBe("ROUTE_NOT_FOUND");

    const wrong = await supertest(harness.app)
      .delete(UNLINK)
      .set("Authorization", bearer(accessToken))
      .send({ currentPassword: "not-the-password" })
      .expect(403);

    expect(wrong.body.error.code).toBe("AUTH_CURRENT_PASSWORD_INVALID");
  });
});
