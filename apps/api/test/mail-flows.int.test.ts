import { accountTokens, auditEvents, staff, users } from "@repo/db";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import supertest from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { bearer, login } from "./support/actors.js";
import { createTestApp, type TestApp } from "./support/app.js";
import { lastMailTo, tokenFromMail } from "./support/mail.js";
import {
  FIXTURE_PASSWORD,
  FIXTURE_STAFF,
  FIXTURE_USERS,
  resetAndSeed,
  superAdmin,
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
const CHANGE_EMAIL = "/api/v1/user/profile/change-email";
const CONFIRM = "/api/v1/public/auth/confirm-email";
const PASSWORD = "a-perfectly-fine-password";

describe("address verification", () => {
  let harness: TestApp;

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ hasher: harness.hasher });
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

/**
 * Password recovery on both segments (ADR-0071 §4).
 *
 * The cases are written once and run per population, the shape
 * `auth.int.test.ts` established: one service serves both, so a claim proved
 * on one segment and not the other is a claim about an accident.
 *
 * What this proves that a unit test cannot: `forgot` answers the identical
 * `202` for four different kinds of address while mailing exactly one of them;
 * the new hash, the audit row and the revocation share **one** transaction
 * against a real database; every session of the account is gone afterwards,
 * which is the property the flow exists for; and a token minted for one
 * population finds no row at all on the other's endpoint, because the consume
 * matches the population inside its own `where`.
 *
 * The limiters are not here. `.env.test` turns both mail budgets off for the
 * suite — these cases ask for the same account's link a dozen times over — and
 * they are proved where every other mounted limiter is, in
 * `rate-limit.int.test.ts`, against an app built with the real numbers.
 */
const RESET_CASES = [
  {
    population: "staff" as const,
    base: "/api/v1/admin/auth",
    known: FIXTURE_STAFF.manager,
    /** The address this segment's `forgot` must refuse to mail. */
    closed: FIXTURE_STAFF.editor,
    /** Staff have no status meaning "the mailbox was never proven". */
    unprovable: undefined,
  },
  {
    population: "user" as const,
    base: "/api/v1/user/auth",
    known: FIXTURE_USERS.active,
    closed: FIXTURE_USERS.disabled,
    /** The seeded `pending_verification` row (ADR-0071 §3, amended `D18.1`). */
    unprovable: FIXTURE_USERS.pending,
  },
] as const;

describe.each(RESET_CASES)(
  "password reset on the $population segment",
  ({ population, base, known, closed, unprovable }) => {
    let harness: TestApp;

    beforeAll(async () => {
      harness = createTestApp();
      await resetAndSeed({ hasher: harness.hasher });
    });

    afterAll(async () => {
      await harness.close();
    });

    beforeEach(() => {
      harness.mail.length = 0;
    });

    const request = () => supertest(harness.app);
    const forgot = (email: string) =>
      request().post(`${base}/password/forgot`).send({ email });
    const reset = (body: Record<string, unknown>) =>
      request().post(`${base}/password/reset`).send(body);

    /** Asks, and hands back the token the message carried. */
    const forgotAndReadLink = async (email: string): Promise<string> => {
      await forgot(email).expect(202);

      return tokenFromMail(lastMailTo(harness, email));
    };

    /** Moves the fixture this segment recovers between statuses. */
    const setKnownStatus = async (
      status: "active" | "disabled",
    ): Promise<void> => {
      // Branched rather than picking the table into a variable: the two tables
      // are different Drizzle types and a union of them types nothing useful.
      if (population === "staff") {
        await harness.db.db
          .update(staff)
          .set({ status })
          .where(eq(staff.email, known));

        return;
      }

      await harness.db.db
        .update(users)
        .set({ status })
        .where(eq(users.email, known));
    };

    /** Puts the fixture's own password back, so later cases can sign in. */
    const restorePassword = async (): Promise<void> => {
      const token = await forgotAndReadLink(known);

      await reset({ token, newPassword: FIXTURE_PASSWORD }).expect(204);
    };

    /* ── forgot: one answer, and at most one message ─────────────────────── */

    it("answers 202 and mails exactly one link for a live account", async () => {
      const response = await forgot(known).expect(202);

      expect(response.body.data).toEqual({ accepted: true });
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(harness.mail).toHaveLength(1);
      expect(harness.mail[0]?.to).toBe(known);
    });

    it("puts the token in the fragment of a link into this segment's own app", async () => {
      const token = await forgotAndReadLink(known);
      const text = harness.mail[0]?.text ?? "";
      const [beforeHash = ""] = text.split("#token=");
      const origin =
        population === "staff"
          ? harness.config.apps.adminUrl
          : harness.config.apps.customerUrl;

      // The reset is the one flow that exists on both segments, so its link is
      // the one that has to know which app the reader signs into (ADR-0071 §2).
      expect(text).toContain(`${origin}/reset-password#token=${token}`);
      expect(
        beforeHash,
        "no server log, proxy or Referer sees it",
      ).not.toContain(token);
    });

    it("answers the same 202 for an address nobody holds, and mails nothing", async () => {
      const response = await forgot(`nobody.${population}@machxi.local`).expect(
        202,
      );

      expect(response.body.data).toEqual({ accepted: true });
      expect(harness.mail).toHaveLength(0);
    });

    it("answers the same 202 for an account that cannot sign in, and mails nothing", async () => {
      // A recovery link is a way in, and these accounts have none by decision
      // (ADR-0071 §4). The seeds carry no inactive operator, so the staff case
      // makes one — the claim is about the status rather than about which
      // fixture happens to hold it.
      if (population === "staff") {
        await harness.db.db
          .update(staff)
          .set({ status: "disabled" })
          .where(eq(staff.email, closed));
      }

      const response = await forgot(closed).expect(202);

      expect(response.body.data).toEqual({ accepted: true });
      expect(harness.mail).toHaveLength(0);
    });

    it("answers the same 202 for the other population's address, and mails nothing", async () => {
      // Containment of the **mint**, where the case below contains the consume:
      // each segment looks its address up in its own table, so a customer who
      // asks the admin segment for a link is an address nobody there holds
      // (ADR-0015's segments, ADR-0071 §4). A shared lookup would mail an
      // operator's link into a customer's mailbox and the other way round.
      const foreign =
        population === "staff" ? FIXTURE_USERS.active : FIXTURE_STAFF.manager;
      const response = await forgot(foreign).expect(202);

      expect(response.body.data).toEqual({ accepted: true });
      expect(harness.mail).toHaveLength(0);
    });

    if (unprovable !== undefined) {
      it("answers the same 202 for an address that was never proven, and mails nothing", async () => {
        // The one case a reader might expect to be mailed, and it is the one
        // that matters most: a `pending_verification` account has not confirmed
        // its mailbox, so a recovery link sent there would hand a credential to
        // an address nobody has proven belongs to the account (ADR-0071 §4).
        const response = await forgot(unprovable).expect(202);

        expect(response.body.data).toEqual({ accepted: true });
        expect(harness.mail).toHaveLength(0);
      });
    }

    it("leaves one working link however many times it is asked for", async () => {
      // A mint supersedes the live row for the pair, so asking twice cannot
      // grow a set of redeemable links (ADR-0071 §1).
      const first = await forgotAndReadLink(known);

      harness.mail.length = 0;
      const second = await forgotAndReadLink(known);

      expect(second).not.toBe(first);
      await reset({ token: first, newPassword: "Superseded!2026" }).expect(401);
      await reset({ token: second, newPassword: "Superseded!2026" }).expect(
        204,
      );
      await restorePassword();
    });

    /* ── reset: the hash, the sessions, and no session of its own ────────── */

    it("sets the new password, ends every session, and issues none", async () => {
      const NEXT = "RecoveredByMail!2026";
      const before = await login(harness.app, population, {
        email: known,
        password: FIXTURE_PASSWORD,
      });
      const token = await forgotAndReadLink(known);

      const response = await reset({ token, newPassword: NEXT }).expect(204);

      // The link proved the mailbox, not the device (ADR-0071 §4): there is no
      // transport call on this path at all, so not even a caller asking for
      // cookies gets one.
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(response.body).toEqual({});

      // Every session is gone, including one opened before the link was asked
      // for: the person may be recovering the account from somebody.
      const refused = await request()
        .post(`${base}/refresh`)
        .send({ refreshToken: before.refreshToken })
        .expect(401);

      expect(refused.body.error.code).toBe("AUTH_SESSION_REVOKED");

      await request()
        .post(`${base}/login`)
        .send({ email: known, password: FIXTURE_PASSWORD })
        .expect(401);
      await login(harness.app, population, { email: known, password: NEXT });

      const token2 = await forgotAndReadLink(known);

      await reset({ token: token2, newPassword: FIXTURE_PASSWORD }).expect(204);
    });

    it("writes an `account.password_reset` audit row attributed to the account", async () => {
      const token = await forgotAndReadLink(known);

      await reset({ token, newPassword: FIXTURE_PASSWORD }).expect(204);

      const [row] = await harness.db.db
        .select({
          event: auditEvents.event,
          actorType: auditEvents.actorType,
          actingAsId: auditEvents.actingAsId,
        })
        .from(auditEvents)
        .where(eq(auditEvents.event, "account.password_reset"))
        .orderBy(desc(auditEvents.occurredAt));

      expect(row).toMatchObject({
        event: "account.password_reset",
        // The route is anonymous, so the actor comes off the claimed row and
        // there is no impersonation to record (ADR-0058).
        actorType: population,
        actingAsId: null,
      });
    });

    it("refuses a replay with 401 and leaves the password alone", async () => {
      const token = await forgotAndReadLink(known);

      await reset({ token, newPassword: FIXTURE_PASSWORD }).expect(204);

      const replay = await reset({
        token,
        newPassword: "ReplayedLink!2026",
      }).expect(401);

      expect(replay.body.error.code).toBe("UNAUTHENTICATED");
      await login(harness.app, population, {
        email: known,
        password: FIXTURE_PASSWORD,
      });
    });

    it("refuses a token nobody minted with the same answer", async () => {
      const response = await reset({
        token: "this-token-was-never-minted",
        newPassword: "NeverMinted!2026",
      }).expect(401);

      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("spends nothing when the account can no longer be reset", async () => {
      // The consume **succeeds** and the account check then throws, so this is
      // the case that proves the transaction: the claim, the new hash, the
      // audit row and the revocations are one unit, and the throw takes all
      // four back (ADR-0071 §1, §4). The cross-segment case below refuses in
      // the `where` and therefore has nothing to roll back — a different
      // property, and this one is verification's `"spends nothing"` twin.
      const token = await forgotAndReadLink(known);

      await setKnownStatus("disabled");
      await reset({ token, newPassword: "NeverApplied!2026" }).expect(401);

      const [row] = await harness.db.db
        .select({ consumedAt: accountTokens.consumedAt })
        .from(accountTokens)
        .where(
          and(
            eq(accountTokens.purpose, "reset_password"),
            eq(accountTokens.principalType, population),
          ),
        )
        .orderBy(desc(accountTokens.createdAt));

      expect(row?.consumedAt, "a refused consume rolls its stamp back").toBe(
        null,
      );

      await setKnownStatus("active");

      // The hash and the sessions rolled back with it, so the password the
      // account had is still the password it has — and the link still works,
      // which is what "spends nothing" means to the person holding it.
      await login(harness.app, population, {
        email: known,
        password: FIXTURE_PASSWORD,
      });
      await reset({ token, newPassword: FIXTURE_PASSWORD }).expect(204);
    });

    it("refuses the other segment's token, and spends nothing", async () => {
      // `reset_password` is minted for both populations, so the consume matches
      // the population inside its own `where` (`D18.2`'s reviewers). Presented
      // to the wrong segment the token must find no row at all — and must still
      // work where it belongs, which is what proves nothing was spent.
      const other =
        population === "staff" ? "/api/v1/user/auth" : "/api/v1/admin/auth";
      const token = await forgotAndReadLink(known);

      const refused = await request()
        .post(`${other}/password/reset`)
        .send({ token, newPassword: "WrongSegment!2026" })
        .expect(401);

      expect(refused.body.error.code).toBe("UNAUTHENTICATED");
      await reset({ token, newPassword: FIXTURE_PASSWORD }).expect(204);
    });
  },
);

/**
 * A person changes their own address by proving the new one (ADR-0071 §6).
 *
 * The third flow on §1's mechanism and the first one whose two halves sit on
 * different segments: the request is authenticated and self-scoped, because
 * only the account holder may start it; the confirmation is anonymous, because
 * the link is followed from the **new** mailbox, which is very often not the
 * browser holding the session.
 *
 * What this proves that a unit test cannot: the request really changes nothing
 * — the row still holds the old address after a `202`, and the new address
 * lives only in a token's payload; the swap, the stamp and the audit row share
 * one transaction against a real database; the uniqueness question is asked
 * again at the confirmation and answered by the same `409` an hour later; a
 * refused confirmation spends nothing, so the link still works; and the
 * message the old address receives carries no link at all.
 *
 * The exclusion is not here. `refuseImpersonated` on the request route is
 * proved in `impersonation-exclusions.int.test.ts`, which owns the mint, the
 * exchange and the `impersonation.refused` audit row that every entry on
 * ADR-0057 §5's list is checked for (`D18.9`'s amendment to the plan).
 */
describe("address change", () => {
  let harness: TestApp;
  /** The account this suite moves about, looked up once. */
  let holderId = "";

  beforeAll(async () => {
    harness = createTestApp();
    await resetAndSeed({ hasher: harness.hasher });

    const [row] = await harness.db.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, FIXTURE_USERS.active));

    holderId = row?.id ?? "";
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(() => {
    harness.mail.length = 0;
  });

  const request = () => supertest(harness.app);

  /** Signs in as the holder with a password other than the fixture's. */
  const holderWith = async (
    password: string,
  ): Promise<{ token: string; email: string }> => {
    const [row] = await harness.db.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, holderId));
    const email = row?.email ?? FIXTURE_USERS.active;
    const tokens = await login(harness.app, "user", { email, password });

    return { token: tokens.accessToken, email };
  };

  /** Signs in as the holder, whatever address it currently answers to. */
  const holder = (): Promise<{ token: string; email: string }> =>
    holderWith(FIXTURE_PASSWORD);

  const changeEmail = (accessToken: string, body: Record<string, unknown>) =>
    request()
      .post(CHANGE_EMAIL)
      .set("Authorization", bearer(accessToken))
      .send(body);

  const confirm = (token: string) => request().post(CONFIRM).send({ token });

  const accountRow = async () => {
    const [row] = await harness.db.db
      .select({
        email: users.email,
        verifiedAt: users.emailVerifiedAt,
        status: users.status,
      })
      .from(users)
      .where(eq(users.id, holderId));

    return row;
  };

  /** Asks for the change and hands back the token the message carried. */
  const requestAndReadLink = async (newEmail: string): Promise<string> => {
    const { token } = await holder();

    await changeEmail(token, {
      newEmail,
      currentPassword: FIXTURE_PASSWORD,
    }).expect(202);

    return tokenFromMail(lastMailTo(harness, newEmail));
  };

  /** Puts the fixture's own address back, so later cases can sign in. */
  const restoreAddress = async (): Promise<void> => {
    const current = await accountRow();

    if (current?.email === FIXTURE_USERS.active) return;

    const link = await requestAndReadLink(FIXTURE_USERS.active);

    await confirm(link).expect(204);
  };

  /* ── the request: nothing moves ──────────────────────────────────────── */

  it("answers 202, mails the new address and changes nothing", async () => {
    const newEmail = "moved.one@machxi.local";
    const { token } = await holder();

    const response = await changeEmail(token, {
      newEmail,
      currentPassword: FIXTURE_PASSWORD,
    }).expect(202);

    expect(response.body.data).toEqual({ accepted: true });
    // No session is issued and none is ended: an address is not a credential
    // (ADR-0071 §6).
    expect(response.headers["set-cookie"]).toBeUndefined();

    // The claim the whole flow rests on.
    expect(await accountRow()).toMatchObject({
      email: FIXTURE_USERS.active,
      status: "active",
    });

    // Exactly one message, to the address nobody has proven yet — and nothing
    // to the address that still signs in.
    expect(harness.mail).toHaveLength(1);
    expect(harness.mail[0]?.to).toBe(newEmail);

    const [row] = await harness.db.db
      .select({
        purpose: accountTokens.purpose,
        consumedAt: accountTokens.consumedAt,
        payload: accountTokens.payload,
      })
      .from(accountTokens)
      .where(
        and(
          eq(accountTokens.principalId, holderId),
          eq(accountTokens.purpose, "change_email"),
        ),
      )
      .orderBy(desc(accountTokens.createdAt));

    expect(row).toMatchObject({ purpose: "change_email", consumedAt: null });
    // The address waits in the payload until somebody proves it (ADR-0071 §1).
    expect(row?.payload).toMatchObject({ newEmail });
  });

  it("puts the token in the fragment and never in the path or the query", async () => {
    const newEmail = "moved.fragment@machxi.local";
    const token = await requestAndReadLink(newEmail);
    const text = lastMailTo(harness, newEmail)?.text ?? "";
    const [beforeHash = ""] = text.split("#token=");

    expect(text).toContain(
      `${harness.config.apps.customerUrl}/confirm-email#token=${token}`,
    );
    expect(beforeHash, "no server log, proxy or Referer sees it").not.toContain(
      token,
    );
  });

  it("refuses a wrong current password with 403 and mails nothing", async () => {
    const { token } = await holder();

    const response = await changeEmail(token, {
      newEmail: "moved.wrongpass@machxi.local",
      currentPassword: "not-the-password",
    }).expect(403);

    expect(response.body.error.code).toBe("AUTH_CURRENT_PASSWORD_INVALID");
    expect(harness.mail).toHaveLength(0);
  });

  it("refuses an address a live account already holds, at the request", async () => {
    const { token } = await holder();

    const response = await changeEmail(token, {
      newEmail: FIXTURE_USERS.disabled,
      currentPassword: FIXTURE_PASSWORD,
    }).expect(409);

    expect(response.body.error.code).toBe("USER_EMAIL_TAKEN");
    expect(harness.mail).toHaveLength(0);
  });

  it("refuses an unauthenticated request outright", async () => {
    await request()
      .post(CHANGE_EMAIL)
      .send({
        newEmail: "moved.anon@machxi.local",
        currentPassword: FIXTURE_PASSWORD,
      })
      .expect(401);
  });

  /* ── the confirmation: the address moves ─────────────────────────────── */

  it("swaps the address, stamps the proof and notifies the old one", async () => {
    const before = await accountRow();
    const previous = before?.email ?? FIXTURE_USERS.active;
    const newEmail = "moved.confirmed@machxi.local";
    const link = await requestAndReadLink(newEmail);

    harness.mail.length = 0;

    const response = await confirm(link).expect(204);

    // No session either way (ADR-0071 §6): the person signed in elsewhere did
    // not stop being that person, and this device proved a mailbox rather than
    // an account.
    expect(response.headers["set-cookie"]).toBeUndefined();

    const account = await accountRow();

    expect(account?.email).toBe(newEmail);
    /*
     * The stamp **moved**, and the comparison is what makes that a claim: this
     * fixture is seeded verified, so `not.toBeNull()` would hold with the
     * column left out of the `set(...)` altogether (`D18.9`'s
     * `code-reviewer`). The column records when *this* address was proven, and
     * it was proven a moment ago.
     */
    expect(account?.verifiedAt?.getTime() ?? 0).toBeGreaterThan(
      before?.verifiedAt?.getTime() ?? 0,
    );

    // The notice, to the address the account has just left — plainly, and with
    // no link, because that mailbox no longer belongs to the account.
    const notice = lastMailTo(harness, previous);

    expect(notice?.text).toContain(newEmail);
    expect(notice?.text).not.toContain("#token=");

    // The session opened before the change still works: nothing was revoked.
    await login(harness.app, "user", {
      email: newEmail,
      password: FIXTURE_PASSWORD,
    });

    const [audited] = await harness.db.db
      .select({
        event: auditEvents.event,
        actorId: auditEvents.actorId,
        actingAsId: auditEvents.actingAsId,
        data: auditEvents.data,
      })
      .from(auditEvents)
      .where(eq(auditEvents.event, "account.email_changed"))
      .orderBy(desc(auditEvents.occurredAt));

    expect(audited).toMatchObject({
      actorId: holderId,
      actingAsId: null,
      data: { previousEmail: previous, newEmail },
    });

    await restoreAddress();
  });

  it("refuses a replay with 401 and leaves the address alone", async () => {
    const newEmail = "moved.replay@machxi.local";
    const link = await requestAndReadLink(newEmail);

    await confirm(link).expect(204);

    const replay = await confirm(link).expect(401);

    expect(replay.body.error.code).toBe("UNAUTHENTICATED");
    expect((await accountRow())?.email).toBe(newEmail);

    await restoreAddress();
  });

  it("refuses a token nobody minted with the same answer", async () => {
    const response = await confirm("this-token-was-never-minted").expect(401);

    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("refuses a verification token presented here, and spends nothing", async () => {
    // One flow can never spend another's credential: the purpose is matched
    // inside the claiming statement (ADR-0071 §1).
    const email = "moved.other.purpose@machxi.local";

    await request()
      .post(REGISTER)
      .send({ email, password: PASSWORD })
      .expect(202);

    const token = tokenFromMail(lastMailTo(harness, email));

    await confirm(token).expect(401);
    // Still redeemable where it belongs, which is what proves nothing was
    // spent.
    await request().post(VERIFY).send({ token }).expect(200);
  });

  it("refuses an address taken since the request, and spends nothing", async () => {
    // The uniqueness question is asked again inside the transaction, because
    // up to `EMAIL_CHANGE_TOKEN_TTL` may have passed since the request asked
    // it (ADR-0071 §6).
    const contested = "moved.contested@machxi.local";
    const link = await requestAndReadLink(contested);

    // Somebody else claims it in the meantime.
    await request()
      .post(REGISTER)
      .send({ email: contested, password: PASSWORD })
      .expect(202);

    const refused = await confirm(link).expect(409);

    expect(refused.body.error.code).toBe("USER_EMAIL_TAKEN");
    expect((await accountRow())?.email).toBe(FIXTURE_USERS.active);

    const [row] = await harness.db.db
      .select({ consumedAt: accountTokens.consumedAt })
      .from(accountTokens)
      .where(
        and(
          eq(accountTokens.principalId, holderId),
          eq(accountTokens.purpose, "change_email"),
        ),
      )
      .orderBy(desc(accountTokens.createdAt));

    expect(row?.consumedAt, "a refused consume rolls its stamp back").toBe(
      null,
    );
  });

  it("spends the pending link when the password changes", async () => {
    /*
     * `D18.9`'s `security-reviewer`, and it is a takeover chain rather than an
     * inconsistency. An attacker who briefly holds the password asks to move
     * the address to a mailbox of their own; the owner notices and changes the
     * password, which ends every other session — and, before this, left the
     * attacker's link redeemable for the rest of `EMAIL_CHANGE_TOKEN_TTL`. The
     * link confirms, the address moves, and the next `forgot` hands the
     * account over. The session sweep cannot see a token row, so the sweep has
     * to be told about it.
     */
    const link = await requestAndReadLink("moved.stolen@machxi.local");
    const { token, email } = await holder();

    await request()
      .post("/api/v1/user/profile/change-password")
      .set("Authorization", bearer(token))
      .send({
        currentPassword: FIXTURE_PASSWORD,
        newPassword: "ChosenByTheOwner!2026",
      })
      .expect(204);

    await confirm(link).expect(401);
    expect((await accountRow())?.email).toBe(email);

    // Put the fixture's own password back, so the cases after this one can
    // sign in.
    await request()
      .post("/api/v1/user/profile/change-password")
      .set(
        "Authorization",
        bearer((await holderWith("ChosenByTheOwner!2026")).token),
      )
      .send({
        currentPassword: "ChosenByTheOwner!2026",
        newPassword: FIXTURE_PASSWORD,
      })
      .expect(204);
  });

  it("leaves one working link however many times it is asked for", async () => {
    // A mint supersedes the live row for the pair, so a person who changes
    // their mind holds one link rather than two (ADR-0071 §1).
    const first = await requestAndReadLink("moved.first@machxi.local");
    const second = await requestAndReadLink("moved.second@machxi.local");

    expect(second).not.toBe(first);
    await confirm(first).expect(401);
    await confirm(second).expect(204);

    expect((await accountRow())?.email).toBe("moved.second@machxi.local");

    await restoreAddress();
  });

  it("an administrative reset spends every outstanding link", async () => {
    /*
     * ADR-0074 §5 (`API-09`). The reset a support operator performs because
     * the account is in somebody else's hands used to spend two purposes by
     * name, so a recovery link the intruder asked for — mailed to the
     * account's own address, which the intruder may be reading — outlived it.
     * Two links of two purposes, then the reset, then neither redeems.
     */
    const changeLink = await requestAndReadLink("moved.intruder@machxi.local");
    const { email } = await holder();

    await request()
      .post("/api/v1/user/auth/password/forgot")
      .send({ email })
      .expect(202);

    const resetLink = tokenFromMail(lastMailTo(harness, email));
    const admin = await login(harness.app, "staff", superAdmin());

    // The fixture's own password, so the reset leaves the account as the
    // cases before it found it.
    await request()
      .post(`/api/v1/admin/users/${holderId}/password`)
      .set("Authorization", bearer(admin.accessToken))
      .send({
        password: FIXTURE_PASSWORD,
        currentPassword: superAdmin().password,
      })
      .expect(204);

    await confirm(changeLink).expect(401);
    await request()
      .post("/api/v1/user/auth/password/reset")
      .send({ token: resetLink, newPassword: "NotTheOwnersChoice!2026" })
      .expect(401);

    // And the table agrees, whatever purpose a future flow adds: no row of
    // this account is redeemable.
    const live = await harness.db.db
      .select({ id: accountTokens.id })
      .from(accountTokens)
      .where(
        and(
          eq(accountTokens.principalId, holderId),
          isNull(accountTokens.consumedAt),
          gt(accountTokens.expiresAt, new Date()),
        ),
      );

    expect(live).toEqual([]);
    expect((await accountRow())?.email).toBe(email);
  });
});
