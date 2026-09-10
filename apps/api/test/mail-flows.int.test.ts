import { accountTokens, auditEvents, users } from "@repo/db";
import { and, desc, eq, sql } from "drizzle-orm";
import supertest from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestApp, type TestApp } from "./support/app.js";
import { lastMailTo, tokenFromMail } from "./support/mail.js";
import {
  FIXTURE_PASSWORD,
  FIXTURE_USERS,
  resetAndSeed,
} from "./support/seed.js";
import { REFRESH_COOKIE, TRANSPORT_HEADER } from "./support/transport.js";

/**
 * The mail flows on the wire (ADR-0071 §3) — address verification, the flow
 * every other one in D18 is shaped after.
 *
 * What this file proves that a unit test cannot: the account, its token row and
 * its personal organization land in **one commit**; the token really is
 * single-use against a real `update … where consumed_at is null`; a refused
 * verification spends nothing because the whole thing shares one transaction;
 * and the two anonymous endpoints answer identically whatever they find, which
 * is the property ADR-0020 §Enumeration asks for and the only one a caller can
 * actually observe.
 *
 * The link is read out of the messages `createTestApp` captures, rendered by
 * the real templates. The browser tier reads the same links out of Mailpit
 * (`D18.4`); this tier reads them out of the port.
 */

const REGISTER = "/api/v1/public/auth/register";
const VERIFY = "/api/v1/public/auth/verify-email";
const RESEND = "/api/v1/public/auth/resend-verification";
const LOGIN = "/api/v1/user/auth/login";
const PASSWORD = "a-perfectly-fine-password";

describe("address verification", () => {
  let harness: TestApp;

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ db: harness.db, hasher: harness.container.hasher });
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(() => {
    // Each case reads "the message this flow sent", so the capture starts
    // empty rather than being searched by index.
    harness.mail.length = 0;
  });

  const request = () => supertest(harness.app);

  const register = (email: string, body: Record<string, unknown> = {}) =>
    request()
      .post(REGISTER)
      .send({ email, password: PASSWORD, ...body });

  /** Registers, and hands back the token the message carried. */
  const registerAndReadLink = async (email: string): Promise<string> => {
    await register(email).expect(202);

    return tokenFromMail(lastMailTo(harness, email));
  };

  const accountRow = async (email: string) => {
    const [row] = await harness.db.db
      .select({
        id: users.id,
        status: users.status,
        verifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.email, email));

    return row;
  };

  const tokenRows = async (principalId: string) =>
    harness.db.db
      .select({
        id: accountTokens.id,
        purpose: accountTokens.purpose,
        tokenHash: accountTokens.tokenHash,
        consumedAt: accountTokens.consumedAt,
      })
      .from(accountTokens)
      .where(eq(accountTokens.principalId, principalId));

  /* ── registration ─────────────────────────────────────────────────────── */

  it("answers 202 with no session and mails exactly one link", async () => {
    const email = "verify.happy@machxi.local";
    const response = await register(email).expect(202);

    expect(response.body.data).toEqual({ accepted: true });
    expect(response.headers["set-cookie"]).toBeUndefined();

    const account = await accountRow(email);

    expect(account).toMatchObject({
      status: "pending_verification",
      verifiedAt: null,
    });

    expect(harness.mail).toHaveLength(1);
    expect(harness.mail[0]?.to).toBe(email);

    const rows = await tokenRows(account?.id ?? "");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      purpose: "verify_email",
      consumedAt: null,
    });
    // Only the hash is stored: a database read must never yield a usable
    // credential (ADR-0071 §1).
    expect(rows[0]?.tokenHash).not.toBe(
      tokenFromMail(lastMailTo(harness, email)),
    );
  });

  it("puts the token in the fragment and never in the path or the query", async () => {
    const email = "verify.fragment@machxi.local";
    const token = await registerAndReadLink(email);
    const text = harness.mail[0]?.text ?? "";
    const [beforeHash = ""] = text.split("#token=");

    expect(text).toContain(`/verify-email#token=${token}`);
    expect(beforeHash, "no server log, proxy or Referer sees it").not.toContain(
      token,
    );
  });

  it("leaves no second account and mails nothing when the address is taken", async () => {
    await register(FIXTURE_USERS.active).expect(409);

    // Still exactly the seeded row, and no token minted for it: a message to
    // an address that already has an account would tell whoever holds it that
    // somebody tried to take it.
    const [counted] = await harness.db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.email, FIXTURE_USERS.active));

    expect(counted?.total).toBe(1);
    expect(harness.mail).toHaveLength(0);
  });

  /* ── the link ─────────────────────────────────────────────────────────── */

  it("verifies once, activating the account and signing the device in", async () => {
    const email = "verify.once@machxi.local";
    const token = await registerAndReadLink(email);

    const response = await request().post(VERIFY).send({ token }).expect(200);

    expect(response.body.data.principal).toMatchObject({
      kind: "user",
      email,
      roles: ["customer"],
    });
    expect(response.body.data.refreshToken).toBeTruthy();

    // The session works immediately — that is what login's body is for.
    await request()
      .get("/api/v1/user/auth/me")
      .set(
        "Authorization",
        `Bearer ${response.body.data.accessToken as string}`,
      )
      .expect(200);

    const account = await accountRow(email);

    expect(account?.status).toBe("active");
    expect(account?.verifiedAt).not.toBeNull();
  });

  it("places the refresh cookie for a client that asked for cookie transport", async () => {
    // Login's body on login's transports, exactly as the impersonation
    // exchange places them (ADR-0071 §3).
    const email = "verify.cookie@machxi.local";
    const token = await registerAndReadLink(email);

    const response = await request()
      .post(VERIFY)
      .set(TRANSPORT_HEADER, "cookie")
      .send({ token })
      .expect(200);

    const cookies = response.headers["set-cookie"] as unknown as string[];

    expect(cookies.some((cookie) => cookie.startsWith(REFRESH_COOKIE))).toBe(
      true,
    );
    expect(response.body.data.refreshToken).toBeUndefined();
  });

  it("writes an `account.verified` audit row attributed to the account", async () => {
    const email = "verify.audit@machxi.local";
    const token = await registerAndReadLink(email);

    await request().post(VERIFY).send({ token }).expect(200);

    const account = await accountRow(email);
    const [row] = await harness.db.db
      .select({
        event: auditEvents.event,
        actorType: auditEvents.actorType,
        actorId: auditEvents.actorId,
        actingAsId: auditEvents.actingAsId,
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.event, "account.verified"),
          eq(auditEvents.actorId, account?.id ?? ""),
        ),
      )
      .orderBy(desc(auditEvents.occurredAt));

    expect(row).toMatchObject({
      event: "account.verified",
      actorType: "user",
      // The route is anonymous, so both identities come off the claimed row
      // and there is no impersonation to record (ADR-0058).
      actingAsId: null,
    });
  });

  it("refuses a second verification with 401 and leaves the session alone", async () => {
    const email = "verify.replay@machxi.local";
    const token = await registerAndReadLink(email);

    await request().post(VERIFY).send({ token }).expect(200);

    const replay = await request().post(VERIFY).send({ token }).expect(401);

    expect(replay.body.error.code).toBe("UNAUTHENTICATED");
    expect(replay.headers["set-cookie"]).toBeUndefined();
  });

  it("refuses a token nobody minted with the same answer", async () => {
    const response = await request()
      .post(VERIFY)
      .send({ token: "this-token-was-never-minted" })
      .expect(401);

    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("spends nothing when the account can no longer be activated", async () => {
    // The account was disabled between the mint and the click. The activation
    // moves no row, the service throws, and the transaction takes the token's
    // `consumed_at` back with it (ADR-0071 §1) — so the link is spent only by
    // a redemption that actually did something.
    const email = "verify.disabled@machxi.local";
    const token = await registerAndReadLink(email);
    const account = await accountRow(email);

    await harness.db.db
      .update(users)
      .set({ status: "disabled" })
      .where(eq(users.id, account?.id ?? ""));

    await request().post(VERIFY).send({ token }).expect(401);

    const rows = await tokenRows(account?.id ?? "");

    expect(rows[0]?.consumedAt, "a refused consume rolls its stamp back").toBe(
      null,
    );
  });

  /* ── login before the address is proven ───────────────────────────────── */

  it("answers a correct password on a pending account with 403 AUTH_EMAIL_UNVERIFIED", async () => {
    const email = "verify.login@machxi.local";

    await register(email).expect(202);

    const response = await request()
      .post(LOGIN)
      .send({ email, password: PASSWORD })
      .expect(403);

    expect(response.body.error.code).toBe("AUTH_EMAIL_UNVERIFIED");
  });

  it("answers a wrong password on the same account with 401 AUTH_INVALID_CREDENTIALS", async () => {
    // The status is only ever consulted after the password verifies, so an
    // unverified account is indistinguishable from an unknown address to
    // anybody who does not already hold the password (ADR-0020 §Enumeration).
    const email = "verify.login.wrong@machxi.local";

    await register(email).expect(202);

    const response = await request()
      .post(LOGIN)
      .send({ email, password: "not-the-password" })
      .expect(401);

    expect(response.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("keeps AUTH_ACCOUNT_DISABLED for a disabled fixture", async () => {
    const response = await request()
      .post(LOGIN)
      .send({ email: FIXTURE_USERS.disabled, password: FIXTURE_PASSWORD })
      .expect(403);

    expect(response.body.error.code).toBe("AUTH_ACCOUNT_DISABLED");
  });

  it("lets the verified account log in with the password it chose", async () => {
    const email = "verify.then.login@machxi.local";
    const token = await registerAndReadLink(email);

    await request().post(VERIFY).send({ token }).expect(200);
    await request().post(LOGIN).send({ email, password: PASSWORD }).expect(200);
  });

  /* ── resend ───────────────────────────────────────────────────────────── */

  it("answers 202 and mails a link for an address that is waiting", async () => {
    const email = "verify.resend@machxi.local";

    await register(email).expect(202);
    harness.mail.length = 0;

    const response = await request().post(RESEND).send({ email }).expect(202);

    expect(response.body.data).toEqual({ accepted: true });
    expect(harness.mail).toHaveLength(1);
    expect(harness.mail[0]?.to).toBe(email);
  });

  it("answers the same 202 for an address nobody holds, and mails nothing", async () => {
    const response = await request()
      .post(RESEND)
      .send({ email: "nobody-here@machxi.local" })
      .expect(202);

    expect(response.body.data).toEqual({ accepted: true });
    expect(harness.mail).toHaveLength(0);
  });

  it("answers the same 202 for an account that is already active", async () => {
    const response = await request()
      .post(RESEND)
      .send({ email: FIXTURE_USERS.active })
      .expect(202);

    expect(response.body.data).toEqual({ accepted: true });
    expect(harness.mail).toHaveLength(0);
  });

  it("leaves one working link however many times it is pressed", async () => {
    // A mint supersedes the live row for the pair, so "resend" cannot grow a
    // set of redeemable links (ADR-0071 §1).
    const email = "verify.supersede@machxi.local";
    const first = await registerAndReadLink(email);

    await request().post(RESEND).send({ email }).expect(202);

    const second = tokenFromMail(lastMailTo(harness, email));

    expect(second).not.toBe(first);
    await request().post(VERIFY).send({ token: first }).expect(401);
    await request().post(VERIFY).send({ token: second }).expect(200);
  });

  it("re-sends for the `pending_verification` fixture the seeds carry", async () => {
    // The one seeded row `email_verified_at` is deliberately null on
    // (ADR-0071 §3, amended `D18.1`), so a fresh clone has an account this
    // whole flow can be walked against.
    await request()
      .post(RESEND)
      .send({ email: FIXTURE_USERS.pending })
      .expect(202);

    const token = tokenFromMail(lastMailTo(harness, FIXTURE_USERS.pending));

    await request().post(VERIFY).send({ token }).expect(200);
    await request()
      .post(LOGIN)
      .send({ email: FIXTURE_USERS.pending, password: FIXTURE_PASSWORD })
      .expect(200);
  });
});

/**
 * The verification endpoints exist even where self-registration does not
 * (ADR-0071 §3).
 *
 * `FEATURE_USER_REGISTRATION` is a decision about *signing up*, and a
 * deployment that switches it off after somebody has signed up must not turn
 * the link already in their mailbox into a `404`.
 */
describe("verification with self-registration switched off", () => {
  let harness: TestApp;

  beforeAll(() => {
    harness = createTestApp({
      config: (config) => ({
        ...config,
        features: { ...config.features, userRegistration: false },
      }),
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  it("still mounts both verification routes", async () => {
    await supertest(harness.app)
      .post(REGISTER)
      .send({ email: "nobody@machxi.local", password: PASSWORD })
      .expect(404);

    await supertest(harness.app)
      .post(RESEND)
      .send({ email: "nobody@machxi.local" })
      .expect(202);

    const response = await supertest(harness.app)
      .post(VERIFY)
      .send({ token: "this-token-was-never-minted" })
      .expect(401);

    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });
});
