import { beforeEach, describe, expect, it } from "vitest";

import {
  PENDING_ID,
  build,
  buildPending,
  context,
  resetClock,
} from "./auth.service.harness.js";

/**
 * The ADR-0071 flows that begin or end in a mailbox, against fake repositories
 * (ADR-0021 §Unit).
 *
 * Split out of `auth.service.test.ts` at `D20.7` together with the code they
 * exercise: `createAuthMailFlows` is composed into the service `build()`
 * returns, so every case below still calls `harness.service.<flow>` and no
 * assertion changed in the move. The fakes are the same ones, imported from
 * `auth.service.harness.ts`.
 */

beforeEach(resetClock);

/* ── register ─────────────────────────────────────────────────────────────── */

describe("register", () => {
  const body = {
    email: "new@machxi.local",
    password: "a-long-enough-password",
    firstName: "New",
    lastName: "Person",
  };

  it("creates a pending account, mails the link, and issues no session", async () => {
    // ADR-0071 §3's whole delta on ADR-0018: the account exists and cannot be
    // signed into, and the link is what changes that.
    const harness = build({
      population: "user",
      principals: [],
      canCreate: true,
    });

    await expect(
      harness.service.register(context(), body),
    ).resolves.toBeUndefined();

    const [created] = [...harness.principals.rows.values()];

    expect(created?.active, "no session, and no active account").toBe(false);
    expect(created?.pending).toBe(true);
    expect(harness.sessions.rows.size).toBe(0);
    // The first of the three paths that bring a user into existence, so it
    // creates the personal organization too (ADR-0067 §2). That the two are
    // one *commit* is `auth-register.int.test.ts`'s claim, not this one's.
    expect(harness.organizations.ensured).toEqual([created?.id]);
  });

  it("mints one `verify_email` token and puts it in the link's fragment", async () => {
    const harness = build({
      population: "user",
      principals: [],
      canCreate: true,
    });

    await harness.service.register(context(), body);

    expect(harness.accountTokens.minted).toHaveLength(1);
    expect(harness.accountTokens.minted[0]).toMatchObject({
      purpose: "verify_email",
      principalType: "user",
    });

    const [message] = harness.mail.sent;
    const token = harness.accountTokens.minted[0]?.token ?? "";

    expect(message?.to).toBe("new@machxi.local");
    // The credential travels in the fragment and nowhere else (ADR-0057 §2 as
    // ADR-0071 §1 inherits it). `templates.test.ts` asserts the shape for
    // every template; this asserts that *this* flow uses one.
    expect(message?.text).toContain(
      `https://app.example.test/verify-email#token=${token}`,
    );
    expect(message?.text.split("#token=")[0]).not.toContain(token);
  });

  it("answers even when the transport is broken, leaving the account behind", async () => {
    // The account is already committed by the time the message goes out, so a
    // rethrow would answer 500 for work that succeeded — and the retry would
    // meet the 409 the first attempt created, with no way out. The remedy is
    // `resend-verification`, which is a button, and it needs the account to
    // still be there. The `error` line the failure writes is the operational
    // half and is not asserted here: the harness logger is silent by design
    // (`context()`), and what this case is about is that the request survives.
    const harness = build({
      population: "user",
      principals: [],
      canCreate: true,
    });

    harness.mail.failWith(new Error("smtp refused the connection"));

    await expect(
      harness.service.register(context(), body),
    ).resolves.toBeUndefined();
    expect(harness.principals.rows.size).toBe(1);
  });

  it("answers a taken address with a generic conflict", async () => {
    // Never `USER_EMAIL_TAKEN`: that would make an anonymous endpoint an
    // account-existence oracle (ADR-0020 §Enumeration).
    const harness = build({
      population: "user",
      principals: [
        {
          id: "existing",
          email: "new@machxi.local",
          passwordHash: "hashed:whatever",
          active: true,
        },
      ],
      canCreate: true,
    });

    const failure = await harness.service
      .register(context(), body)
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ status: 409, code: "CONFLICT" });
    expect(JSON.stringify(failure)).not.toContain("new@machxi.local");
    expect(harness.sessions.rows.size).toBe(0);
    // Nothing minted and nothing mailed: a message to an address that already
    // has an account would tell whoever holds it that somebody tried.
    expect(harness.accountTokens.minted).toHaveLength(0);
    expect(harness.mail.sent).toHaveLength(0);
  });

  it("refuses outright for a population that cannot self-register", async () => {
    // Staff are created by an admin (ADR-0017 §Invariants). No client can
    // reach this — the public router mounts the user service — so it is a 500.
    const harness = build({ population: "staff" });

    await expect(
      harness.service.register(context(), body),
    ).rejects.toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
  });
});

/* ── address verification (ADR-0071 §3) ───────────────────────────────────── */

describe("verifyEmail", () => {
  const linkFor = async (harness: ReturnType<typeof build>) => {
    await harness.service.resendVerification(context(), {
      email: "pending@machxi.local",
    });

    return harness.accountTokens.minted.at(-1)?.token ?? "";
  };

  it("activates the account, stamps the audit row and signs the device in", async () => {
    const harness = buildPending();
    const token = await linkFor(harness);

    const auth = await harness.service.verifyEmail(context(), { token });

    expect(auth.principal).toMatchObject({
      kind: "user",
      id: PENDING_ID,
      email: "pending@machxi.local",
    });
    expect(auth.accessToken).toBeTruthy();
    expect(harness.principals.rows.get(PENDING_ID)?.active).toBe(true);
    expect(harness.sessions.rows.size).toBe(1);
    // Attributed from the claimed row, because the route is anonymous and the
    // context carries no principal to derive from (ADR-0058).
    expect(harness.audit.entries).toContainEqual(
      expect.objectContaining({
        event: "account.verified",
        identities: { actor: { type: "user", id: PENDING_ID } },
      }),
    );
  });

  it("refuses a second redemption of the same link", async () => {
    const harness = buildPending();
    const token = await linkFor(harness);

    await harness.service.verifyEmail(context(), { token });

    await expect(
      harness.service.verifyEmail(context(), { token }),
    ).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(harness.sessions.rows.size).toBe(1);
  });

  it("refuses an unknown token with the same answer", async () => {
    // Unknown, consumed, expired, of another purpose or another population —
    // one answer, because the caller is an anonymous holder of a URL fragment.
    await expect(
      buildPending().service.verifyEmail(context(), {
        token: "nothing-minted",
      }),
    ).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  });

  it("refuses a live token whose account can no longer be activated", async () => {
    // The account was disabled between the mint and the click. The refusal is
    // what rolls the claim back, so the link is spent only by a redemption
    // that actually moved the row (ADR-0071 §1).
    const harness = buildPending();
    const token = await linkFor(harness);
    const row = harness.principals.rows.get(PENDING_ID);

    if (row !== undefined) row.pending = false;

    await expect(
      harness.service.verifyEmail(context(), { token }),
    ).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(harness.sessions.rows.size).toBe(0);
  });
});

describe("resendVerification", () => {
  it("mails the link to an account that is waiting", async () => {
    const harness = buildPending();

    await harness.service.resendVerification(context(), {
      email: "pending@machxi.local",
    });

    expect(harness.mail.sent).toHaveLength(1);
    expect(harness.mail.sent[0]?.to).toBe("pending@machxi.local");
  });

  it("resolves and mails nothing for an address nobody holds", async () => {
    // The whole point: an unknown address and a pending one are one answer,
    // and the only difference is a message in a mailbox the caller has to own.
    const harness = buildPending();

    await expect(
      harness.service.resendVerification(context(), {
        email: "stranger@machxi.local",
      }),
    ).resolves.toBeUndefined();
    expect(harness.mail.sent).toHaveLength(0);
    expect(harness.accountTokens.minted).toHaveLength(0);
  });

  it("resolves and mails nothing for an account that is already active", async () => {
    const harness = build({
      population: "user",
      canCreate: true,
      principals: [
        {
          id: PENDING_ID,
          email: "pending@machxi.local",
          passwordHash: "hashed:correct-horse-battery",
          active: true,
        },
      ],
    });

    await expect(
      harness.service.resendVerification(context(), {
        email: "pending@machxi.local",
      }),
    ).resolves.toBeUndefined();
    expect(harness.mail.sent).toHaveLength(0);
  });

  it("leaves one working link however many times it is pressed", async () => {
    // The mint supersedes the live row for the pair (ADR-0071 §1), so the
    // first link is dead by the time the second arrives.
    const harness = buildPending();

    await harness.service.resendVerification(context(), {
      email: "pending@machxi.local",
    });

    const first = harness.accountTokens.minted.at(-1)?.token ?? "";

    await harness.service.resendVerification(context(), {
      email: "pending@machxi.local",
    });

    const second = harness.accountTokens.minted.at(-1)?.token ?? "";

    expect(second).not.toBe(first);
    await expect(
      harness.service.verifyEmail(context(), { token: first }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      harness.service.verifyEmail(context(), { token: second }),
    ).resolves.toMatchObject({ principal: { id: PENDING_ID } });
  });
});
