import {
  auditEvents,
  federatedIdentities,
  organizationMemberships,
  organizations,
  users,
} from "@repo/db";
import { and, eq } from "drizzle-orm";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FakeOidcClaims } from "../src/core/oidc/index.js";
import { bearer, login } from "./support/actors.js";
import { createTestApp, type TestApp } from "./support/app.js";
import { registerVerified } from "./support/mail.js";
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
 * then creation behind the registration flag — decides against real rows;
 * creation lands the account, its grant, its personal organization and its
 * identity in one commit; and the handoff is a real `account_tokens` row that
 * a second exchange cannot spend.
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
    await resetAndSeed({ db: harness.db, hasher: harness.container.hasher });
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

  it("creates nothing for a verified address Google does not host, with the same answer as for a held one", async () => {
    // Creation reads authority too (ADR-0072 §1, amended at `D19.2`): the
    // mailbox's previous holder must not be able to make an account whose
    // rightful owner's password reset would leave them signing in by subject.
    const email = "lapsed.domain@example.test";
    const landing = await signIn(
      hosted("sub-lapsed-domain", email, { emailAuthoritative: false }),
    );

    expect(landing.fragment.get("error")).toBe("AUTH_FEDERATED_LINK_REQUIRED");
    expect(await userRow(email)).toBeUndefined();
    expect(await identityBySubject("sub-lapsed-domain")).toBeUndefined();
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
    await resetAndSeed({ db: harness.db, hasher: harness.container.hasher });
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
});
