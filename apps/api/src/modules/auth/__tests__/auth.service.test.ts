import { sha256Base64url } from "@repo/crypto";
import { beforeEach, describe, expect, it } from "vitest";

import type { Principal } from "../../../core/context/index.js";
import { createMailTemplates } from "../../../core/mail/index.js";
import { createHashLimiter } from "../auth.hash-limiter.js";
import { createAuthService } from "../auth.service.js";
import { createTokenService } from "../auth.tokens.js";
import {
  GRACE_SEC,
  IMPERSONATION_TTL_SEC,
  MAX_SESSIONS_PER_PRINCIPAL,
  PENDING_ID,
  REFRESH_TTL_SEC,
  STAFF_ID,
  advance,
  build,
  buildPending,
  clock,
  context,
  createFakeAccountTokens,
  createFakeMail,
  login,
  now,
  resetClock,
  type FakePrincipal,
} from "./auth.service.harness.js";

/**
 * The ADR-0018 flows, against fake repositories (ADR-0021 §Unit).
 *
 * No database and no Express: what is under test is the *decision sequence* —
 * which check runs before which, what gets revoked, and which code comes back
 * — and every one of those is a rule the ADR states. `now` is injected, so the
 * rotation grace window and expiry are exercised at exact instants instead of
 * with sleeps.
 */

beforeEach(resetClock);

/* ── login ────────────────────────────────────────────────────────────────── */

describe("login", () => {
  it("returns the token pair, the expiries and the principal", async () => {
    const harness = build();
    const auth = await login(harness, "correct-horse-battery");

    expect(auth.tokenType).toBe("Bearer");
    expect(auth.refreshToken).toBe("refresh-token-1");
    expect(auth.accessTokenExpiresAt).toBe("2026-08-18T12:15:00.000Z");
    expect(auth.refreshTokenExpiresAt).toBe("2026-08-18T13:00:00.000Z");
    expect(auth.principal).toMatchObject({ kind: "staff", id: STAFF_ID });
  });

  it("stores only the hash of the refresh token", async () => {
    // A database read must never yield a usable credential (ADR-0018).
    const harness = build();
    const auth = await login(harness, "correct-horse-battery");
    const [session] = [...harness.sessions.rows.values()];

    expect(session?.refreshTokenHash).toBe(sha256Base64url(auth.refreshToken));
    expect(session?.refreshTokenHash).not.toBe(auth.refreshToken);
  });

  it("records the audit trail and the last login", async () => {
    const harness = build();

    await login(harness, "correct-horse-battery");

    expect(harness.principals.events.touchedLastLogin).toBe(1);
    expect(harness.sessions.rows.size).toBe(1);
  });

  it("refuses a wrong password with the generic code", async () => {
    const harness = build();

    await expect(login(harness, "wrong")).rejects.toMatchObject({
      status: 401,
      code: "AUTH_INVALID_CREDENTIALS",
    });
  });

  it("answers an unknown email identically, having verified against a dummy", async () => {
    // Same code, same status — and the same work, so the response time does
    // not answer "does this address exist?" (ADR-0018 §Login step 2).
    const harness = build();

    const failure = await harness.service
      .login(context(), { email: "nobody@machxi.local", password: "whatever" })
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    expect(harness.hasher.calls.dummy).toBe(1);
    expect(harness.hasher.calls.verify).toBe(1);
  });

  it("treats a null password hash as no password login, not as any password", async () => {
    const harness = build({
      principals: [
        {
          id: STAFF_ID,
          email: "admin@machxi.local",
          passwordHash: null,
          active: true,
        },
      ],
    });

    await expect(login(harness, "anything")).rejects.toMatchObject({
      code: "AUTH_INVALID_CREDENTIALS",
    });
    expect(harness.hasher.calls.dummy).toBe(1);
  });

  it("checks the password before the account status", async () => {
    // Reversing these two would let anyone learn that an address exists and is
    // disabled, without knowing its password.
    const harness = build({
      principals: [
        {
          id: STAFF_ID,
          email: "admin@machxi.local",
          passwordHash: "hashed:correct-horse-battery",
          active: false,
        },
      ],
    });

    await expect(login(harness, "wrong")).rejects.toMatchObject({
      code: "AUTH_INVALID_CREDENTIALS",
    });

    await expect(login(harness, "correct-horse-battery")).rejects.toMatchObject(
      {
        status: 403,
        code: "AUTH_ACCOUNT_DISABLED",
      },
    );
  });

  it("creates no session for a refused login", async () => {
    const harness = build();

    await login(harness, "wrong").catch(() => undefined);

    expect(harness.sessions.rows.size).toBe(0);
  });

  it("upgrades a hash that was made with older parameters", async () => {
    const harness = build();

    harness.hasher.setNeedsRehash(true);
    await login(harness, "correct-horse-battery");

    expect(harness.principals.events.passwordHashUpdates).toEqual([
      "hashed:correct-horse-battery",
    ]);
  });

  it("does not rehash when the parameters already match", async () => {
    const harness = build();

    await login(harness, "correct-horse-battery");

    expect(harness.principals.events.passwordHashUpdates).toEqual([]);
  });
});

/* ── refresh ──────────────────────────────────────────────────────────────── */

describe("refresh", () => {
  it("rotates the pair and kills the token it replaced", async () => {
    const harness = build();
    const first = await login(harness, "correct-horse-battery");

    advance(GRACE_SEC + 1);

    const second = await harness.service.refresh(context(), {
      refreshToken: first.refreshToken,
    });

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.principal).toMatchObject({ id: STAFF_ID });

    // Replaying the first token is now outside the grace window: reuse.
    advance(GRACE_SEC + 1);

    await expect(
      harness.service.refresh(context(), {
        refreshToken: first.refreshToken,
      }),
    ).rejects.toMatchObject({ code: "AUTH_REFRESH_REUSED" });
  });

  it("slides the refresh expiry forward", async () => {
    const harness = build();
    const first = await login(harness, "correct-horse-battery");

    advance(600);

    const second = await harness.service.refresh(context(), {
      refreshToken: first.refreshToken,
    });

    expect(new Date(second.refreshTokenExpiresAt).getTime()).toBe(
      clock.getTime() + REFRESH_TTL_SEC * 1000,
    );
  });

  it("serves a retry inside the grace window instead of calling it reuse", async () => {
    // Two tabs, or a lost response. Both callers end up with a working pair.
    const harness = build();
    const first = await login(harness, "correct-horse-battery");

    await harness.service.refresh(context(), {
      refreshToken: first.refreshToken,
    });

    advance(GRACE_SEC - 1);

    const retry = await harness.service.refresh(context(), {
      refreshToken: first.refreshToken,
    });

    expect(retry.refreshToken).toBeTruthy();
    expect([...harness.sessions.rows.values()][0]?.revokedAt).toBeNull();
  });

  it("revokes the session when a rotated token is replayed after the window", async () => {
    // The token is assumed stolen: the legitimate holder's session is exactly
    // what an attacker would use next (ADR-0018 §Refresh step 4).
    const harness = build();
    const first = await login(harness, "correct-horse-battery");

    await harness.service.refresh(context(), {
      refreshToken: first.refreshToken,
    });

    advance(GRACE_SEC + 1);

    await expect(
      harness.service.refresh(context(), {
        refreshToken: first.refreshToken,
      }),
    ).rejects.toMatchObject({ status: 401, code: "AUTH_REFRESH_REUSED" });

    expect([...harness.sessions.rows.values()][0]?.revokedAt).not.toBeNull();
  });

  it("treats a stale token from a logged-out session as revoked, not as theft", async () => {
    // The commonest client bug there is: a tab that kept a token across a
    // logout. Logging it as reuse at `warn` would make the signal that is
    // supposed to mean "a token was stolen" mean nothing (ADR-0020 §Audit
    // trail). The check runs before the reuse branch, so nothing is revoked
    // twice either.
    const harness = build();
    const first = await login(harness, "correct-horse-battery");

    await harness.service.refresh(context(), {
      refreshToken: first.refreshToken,
    });
    await harness.service.logout(context(principalOf("session-1")));

    advance(GRACE_SEC + 1);

    await expect(
      harness.service.refresh(context(), {
        refreshToken: first.refreshToken,
      }),
    ).rejects.toMatchObject({ code: "AUTH_SESSION_REVOKED" });
  });

  it("does not revoke another population's session when its rotated token is replayed", async () => {
    // The population check has to run before the reuse branch, because that
    // branch has a side effect: revoking a *user* session from the admin
    // segment is both a distinguishable code and a cross-segment state change
    // (ADR-0019 §1).
    const staffHarness = build({ population: "staff" });
    const first = await login(staffHarness, "correct-horse-battery");

    await staffHarness.service.refresh(context(), {
      refreshToken: first.refreshToken,
    });

    const userService = createAuthService({
      population: "user",
      principals: staffHarness.principals.adapter,
      sessions: staffHarness.sessions.repository,
      audit: staffHarness.audit.audit,
      hasher: staffHarness.hasher.hasher,
      tokens: createTokenService({
        secret: "unit-test-signing-key-at-least-32-characters",
        appId: "machxi",
        issuer: "machxi-api-test",
        accessTtlSec: 900,
        now,
      }),
      hashLimiter: createHashLimiter({ maxConcurrent: 4 }),
      refreshTtlSec: REFRESH_TTL_SEC,
      rotationGraceSec: GRACE_SEC,
      maxSessionsPerPrincipal: MAX_SESSIONS_PER_PRINCIPAL,
      impersonationSessionTtlSec: IMPERSONATION_TTL_SEC,
      // Neither of the flows under test here mints or mails anything;
      // the dependencies are required so a wiring mistake cannot be silent.
      accountTokens: createFakeAccountTokens().tokens,
      mail: createFakeMail().mail,
      mailTemplates: createMailTemplates({
        customerUrl: "https://app.example.test",
        adminUrl: "https://admin.example.test",
      }),
      transaction: (fn) => fn(undefined as never),
      now,
    });

    advance(GRACE_SEC + 1);

    await expect(
      userService.refresh(context(), { refreshToken: first.refreshToken }),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_REFRESH_TOKEN" });

    expect([...staffHarness.sessions.rows.values()][0]?.revokedAt).toBeNull();
  });

  it("refuses an unknown token", async () => {
    const harness = build();

    await expect(
      harness.service.refresh(context(), { refreshToken: "never-issued" }),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_REFRESH_TOKEN" });
  });

  it("refuses a revoked session", async () => {
    const harness = build();
    const auth = await login(harness, "correct-horse-battery");

    await harness.service.logout(
      context({
        kind: "staff",
        id: STAFF_ID,
        roles: ["admin"],
        sessionId: "session-1",
      }),
    );

    await expect(
      harness.service.refresh(context(), {
        refreshToken: auth.refreshToken,
      }),
    ).rejects.toMatchObject({ code: "AUTH_SESSION_REVOKED" });
  });

  it("refuses an expired session", async () => {
    const harness = build();
    const auth = await login(harness, "correct-horse-battery");

    advance(REFRESH_TTL_SEC + 1);

    await expect(
      harness.service.refresh(context(), {
        refreshToken: auth.refreshToken,
      }),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_REFRESH_TOKEN" });
  });

  it("refuses a token belonging to the other population", async () => {
    // Indistinguishable from an unknown token, so the difference cannot be
    // used to probe (ADR-0019).
    const staffHarness = build({ population: "staff" });
    const auth = await login(staffHarness, "correct-horse-battery");

    const userService = createAuthService({
      population: "user",
      principals: staffHarness.principals.adapter,
      // Same store, so the row genuinely exists — only its population differs.
      sessions: staffHarness.sessions.repository,
      audit: staffHarness.audit.audit,
      hasher: staffHarness.hasher.hasher,
      tokens: createTokenService({
        secret: "unit-test-signing-key-at-least-32-characters",
        appId: "machxi",
        issuer: "machxi-api-test",
        accessTtlSec: 900,
        now,
      }),
      hashLimiter: createHashLimiter({ maxConcurrent: 4 }),
      refreshTtlSec: REFRESH_TTL_SEC,
      rotationGraceSec: GRACE_SEC,
      maxSessionsPerPrincipal: MAX_SESSIONS_PER_PRINCIPAL,
      impersonationSessionTtlSec: IMPERSONATION_TTL_SEC,
      // Neither of the flows under test here mints or mails anything;
      // the dependencies are required so a wiring mistake cannot be silent.
      accountTokens: createFakeAccountTokens().tokens,
      mail: createFakeMail().mail,
      mailTemplates: createMailTemplates({
        customerUrl: "https://app.example.test",
        adminUrl: "https://admin.example.test",
      }),
      transaction: (fn) => fn(undefined as never),
      now,
    });

    await expect(
      userService.refresh(context(), { refreshToken: auth.refreshToken }),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_REFRESH_TOKEN" });
  });

  it("revokes every session when the account is no longer active", async () => {
    const harness = build();
    const auth = await login(harness, "correct-horse-battery");
    const row = harness.principals.rows.get(STAFF_ID);

    if (row !== undefined) row.active = false;

    await expect(
      harness.service.refresh(context(), {
        refreshToken: auth.refreshToken,
      }),
    ).rejects.toMatchObject({ status: 403, code: "AUTH_ACCOUNT_DISABLED" });

    expect([...harness.sessions.rows.values()][0]?.revokedAt).not.toBeNull();
  });

  it("revokes the session when the account was deleted outright", async () => {
    // `sessions` has no foreign key to either population, so nothing else
    // cleans this up (ADR-0018).
    const harness = build();
    const auth = await login(harness, "correct-horse-battery");

    harness.principals.rows.delete(STAFF_ID);

    await expect(
      harness.service.refresh(context(), {
        refreshToken: auth.refreshToken,
      }),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_REFRESH_TOKEN" });

    expect([...harness.sessions.rows.values()][0]?.revokedAt).not.toBeNull();
  });
});

/* ── logout, me ───────────────────────────────────────────────────────────── */

const principalOf = (sessionId: string): Principal => ({
  kind: "staff",
  id: STAFF_ID,
  roles: ["admin"],
  sessionId,
});

describe("logout", () => {
  it("revokes only the current session", async () => {
    const harness = build();

    await login(harness, "correct-horse-battery");
    await login(harness, "correct-horse-battery");

    await harness.service.logout(context(principalOf("session-1")));

    const rows = [...harness.sessions.rows.values()];

    expect(rows[0]?.revokedAt).not.toBeNull();
    expect(rows[1]?.revokedAt).toBeNull();
  });

  it("revokes every session on logout-all", async () => {
    const harness = build();

    await login(harness, "correct-horse-battery");
    await login(harness, "correct-horse-battery");

    await harness.service.logoutAll(context(principalOf("session-1")));

    expect(
      [...harness.sessions.rows.values()].every(
        (row) => row.revokedAt !== null,
      ),
    ).toBe(true);
  });

  it("refuses to act without a principal", async () => {
    const harness = build();

    await expect(harness.service.logout(context())).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe("me", () => {
  it("re-reads the principal rather than trusting the token's claims", async () => {
    const harness = build();
    const row = harness.principals.rows.get(STAFF_ID);

    if (row !== undefined) row.email = "renamed@machxi.local";

    await expect(
      harness.service.me(context(principalOf("session-1"))),
    ).resolves.toMatchObject({ email: "renamed@machxi.local" });
  });

  it("revokes the sessions of an account that was disabled mid-token", async () => {
    // Refusing alone would leave the refresh token alive to mint a new access
    // token 15 minutes later.
    const harness = build();

    await login(harness, "correct-horse-battery");

    const row = harness.principals.rows.get(STAFF_ID);

    if (row !== undefined) row.active = false;

    await expect(
      harness.service.me(context(principalOf("session-1"))),
    ).rejects.toMatchObject({ code: "AUTH_SESSION_REVOKED" });

    expect([...harness.sessions.rows.values()][0]?.revokedAt).not.toBeNull();
  });
});

/* ── address verification (ADR-0071 §3) ───────────────────────────────────── */

describe("login on an account whose address is unproven", () => {
  const attempt = (harness: ReturnType<typeof build>, password: string) =>
    harness.service.login(context(), {
      email: "pending@machxi.local",
      password,
    });

  it("answers 403 AUTH_EMAIL_UNVERIFIED for the right password", async () => {
    // Distinguishable from `AUTH_ACCOUNT_DISABLED` on purpose, and only
    // reachable once the password has verified: the caller has already proven
    // they hold the account, so ADR-0020 §Enumeration has nothing left to
    // protect and the client can offer to send the link again.
    await expect(
      attempt(buildPending(), "correct-horse-battery"),
    ).rejects.toMatchObject({ status: 403, code: "AUTH_EMAIL_UNVERIFIED" });
  });

  it("answers 401 AUTH_INVALID_CREDENTIALS for the wrong one", async () => {
    // The status check never runs, so an unverified account is indistinguishable
    // from an unknown address to anyone who does not hold the password.
    await expect(
      attempt(buildPending(), "not-the-password"),
    ).rejects.toMatchObject({ status: 401, code: "AUTH_INVALID_CREDENTIALS" });
  });

  it("keeps AUTH_ACCOUNT_DISABLED for an account that is merely disabled", async () => {
    const harness = build({
      population: "user",
      canCreate: true,
      principals: [
        {
          id: PENDING_ID,
          email: "pending@machxi.local",
          passwordHash: "hashed:correct-horse-battery",
          active: false,
        },
      ],
    });

    await expect(
      attempt(harness, "correct-horse-battery"),
    ).rejects.toMatchObject({ status: 403, code: "AUTH_ACCOUNT_DISABLED" });
  });
});

/* ── impersonation (ADR-0057 §4) ──────────────────────────────────────────── */

const CUSTOMER_ID = "33333333-3333-7333-8333-333333333333";
const ACTOR_ID = "44444444-4444-7444-8444-444444444444";

/**
 * A `user` service wired the way the container wires it: the customer
 * population's principals, and the staff adapter as `impersonators`.
 */
const buildImpersonation = (
  overrides: {
    readonly targetActive?: boolean;
    readonly actorActive?: boolean;
    readonly actors?: FakePrincipal[];
  } = {},
) =>
  build({
    population: "user",
    principals: [
      {
        id: CUSTOMER_ID,
        email: "customer@machxi.local",
        passwordHash: "hashed:correct-horse-battery",
        active: overrides.targetActive ?? true,
      },
    ],
    impersonators: overrides.actors ?? [
      {
        id: ACTOR_ID,
        email: "operator@machxi.local",
        passwordHash: "hashed:correct-horse-battery",
        active: overrides.actorActive ?? true,
      },
    ],
  });

const openImpersonated = (harness: ReturnType<typeof build>) =>
  harness.service.issueImpersonatedSession(context(), {
    principalId: CUSTOMER_ID,
    staffId: ACTOR_ID,
  });

describe("issueImpersonatedSession", () => {
  it("anchors a fixed end at the exchange, not the sliding refresh TTL", async () => {
    // The delta ADR-0057 §4 makes to ADR-0018, at the instant it is made.
    // `IMPERSONATION_TTL_SEC` is deliberately unlike `REFRESH_TTL_SEC`, so an
    // implementation that reached for the wrong constant fails here.
    const auth = await openImpersonated(buildImpersonation());

    expect(auth.refreshTokenExpiresAt).toBe("2026-08-18T12:30:00.000Z");
  });

  it("marks the session with its actor and names both identities on the wire", async () => {
    const harness = buildImpersonation();
    const auth = await openImpersonated(harness);
    const [session] = [...harness.sessions.rows.values()];

    expect(session?.impersonatedByStaffId).toBe(ACTOR_ID);
    expect(auth.principal).toMatchObject({
      kind: "user",
      id: CUSTOMER_ID,
      impersonatedBy: { id: ACTOR_ID, email: "operator@machxi.local" },
    });
  });

  it("caps the access token at the session's end", async () => {
    // No JWT outlives the session it names (ADR-0057 §4). The cap only bites
    // late in the window — the access TTL is 15 minutes and the session 30 —
    // so the moment worth testing is a rotation 20 minutes in, where an
    // uncapped token would run 5 minutes past a session nobody is
    // impersonating through any more.
    const harness = buildImpersonation();
    const opened = await openImpersonated(harness);

    expect(opened.accessTokenExpiresAt).toBe("2026-08-18T12:15:00.000Z");

    advance(20 * 60);

    const rotated = await harness.service.refresh(context(), {
      refreshToken: opened.refreshToken,
    });

    expect(rotated.accessTokenExpiresAt).toBe(rotated.refreshTokenExpiresAt);
    expect(rotated.accessTokenExpiresAt).toBe("2026-08-18T12:30:00.000Z");
  });

  it("refuses when the minting staff member is gone", async () => {
    // The exchange's judgement, and deliberately not refresh's: a session
    // whose actor cannot be resolved is one the banner could never name, and
    // ADR-0057 §7 makes that banner unremovable.
    const harness = buildImpersonation({ actors: [] });

    await expect(openImpersonated(harness)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(harness.sessions.rows.size).toBe(0);
  });

  it("refuses when the minting staff member is inactive", async () => {
    const harness = buildImpersonation({ actorActive: false });

    await expect(openImpersonated(harness)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(harness.sessions.rows.size).toBe(0);
  });

  it("refuses when the target went inactive after the mint", async () => {
    // A minute passes between the mint and the exchange at most, and "the
    // account was disabled in that minute" must not open anyway.
    const harness = buildImpersonation({ targetActive: false });

    await expect(openImpersonated(harness)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(harness.sessions.rows.size).toBe(0);
  });

  it("refuses on a service with no staff adapter at all", async () => {
    // The staff population's instance, which the container builds without
    // `impersonators` on purpose: a staff session is never impersonated, and
    // this is what makes that a property of the wiring (ADR-0057 §4).
    const harness = build({
      population: "user",
      principals: [
        {
          id: CUSTOMER_ID,
          email: "customer@machxi.local",
          passwordHash: "hashed:correct-horse-battery",
          active: true,
        },
      ],
    });

    await expect(openImpersonated(harness)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });
});

describe("refreshing an impersonated session", () => {
  it("rotates the pair without moving the end", async () => {
    const harness = buildImpersonation();
    const opened = await openImpersonated(harness);

    advance(60);

    const rotated = await harness.service.refresh(context(), {
      refreshToken: opened.refreshToken,
    });

    expect(rotated.refreshTokenExpiresAt).toBe(opened.refreshTokenExpiresAt);
    expect(rotated.refreshToken).not.toBe(opened.refreshToken);
    expect(rotated.principal).toMatchObject({
      impersonatedBy: { id: ACTOR_ID },
    });
  });

  it("still dies at that end, however many times it rotated", async () => {
    const harness = buildImpersonation();
    const opened = await openImpersonated(harness);

    advance(IMPERSONATION_TTL_SEC + 1);

    await expect(
      harness.service.refresh(context(), {
        refreshToken: opened.refreshToken,
      }),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_REFRESH_TOKEN" });
  });

  it("leaves an ordinary session's expiry sliding", async () => {
    // The supersession's terms: every ADR-0018 behaviour outside the two named
    // deltas must show no diff, and this is the one the delta sits next to.
    const harness = build();
    const opened = await login(harness, "correct-horse-battery");

    advance(60);

    const rotated = await harness.service.refresh(context(), {
      refreshToken: opened.refreshToken,
    });

    expect(rotated.refreshTokenExpiresAt).toBe("2026-08-18T13:01:00.000Z");
    expect(opened.refreshTokenExpiresAt).toBe("2026-08-18T13:00:00.000Z");
  });
});

describe("ending an impersonated session", () => {
  /** The principal `authenticate` builds from an impersonated access token. */
  const impersonatedPrincipal = (sessionId: string): Principal => ({
    kind: "user",
    id: CUSTOMER_ID,
    roles: ["customer"],
    sessionId,
    impersonatedBy: ACTOR_ID,
  });

  it("revokes with impersonation_ended and audits it, not as an ordinary logout", async () => {
    // The distinction the trail exists for (ADR-0057 §6): "the customer signed
    // out" and "a support operator finished acting as them" are different
    // events, and `logout` is the same endpoint for both.
    const harness = buildImpersonation();

    await openImpersonated(harness);
    await harness.service.logout(context(impersonatedPrincipal("session-1")));

    expect([...harness.sessions.rows.values()][0]?.revokedAt).not.toBeNull();
    expect(harness.audit.entries).toEqual([
      {
        event: "impersonation.ended",
        identities: {
          actor: { type: "staff", id: ACTOR_ID },
          actingAs: { type: "user", id: CUSTOMER_ID },
        },
        data: { sessionId: "session-1", reason: "logout" },
      },
    ]);
  });

  it("names the staff member as the actor, never the customer", async () => {
    // The inversion ADR-0058 warns about: mapping `ctx.principal` onto `actor`
    // compiles, passes, and makes the one query an incident runs return
    // nothing.
    const harness = buildImpersonation();

    await openImpersonated(harness);
    await harness.service.logout(context(impersonatedPrincipal("session-1")));

    expect(harness.audit.entries[0]?.identities?.actor.type).toBe("staff");
  });

  it("does not end the session when the audit row cannot be written", async () => {
    // `record`'s lifecycle discipline (ADR-0058): the revoke and the row share
    // a transaction, so an impersonation cannot end untraceably. The fakes
    // have no atomicity, so what this pins is that the writer is *awaited* and
    // its failure reaches the caller.
    const harness = buildImpersonation();

    await openImpersonated(harness);
    harness.audit.failWith(new Error("audit_events is unreachable"));

    await expect(
      harness.service.logout(context(impersonatedPrincipal("session-1"))),
    ).rejects.toThrow("audit_events is unreachable");
  });

  it("writes nothing and revokes as an ordinary logout on a real session", async () => {
    // The supersession's terms: an ordinary session must show no diff.
    const harness = build();

    await login(harness, "correct-horse-battery");
    await harness.service.logout(context(principalOf("session-1")));

    expect(harness.audit.entries).toEqual([]);
  });
});

describe("revoking a staff member's sessions", () => {
  /**
   * ADR-0057 §6, out of `D13.4`'s `security-reviewer` pass: the sessions a
   * staff member is *impersonating through* are `principal_type = 'user'`
   * rows, so every revocation the API had — disable, delete, forced logout —
   * missed them entirely and left an operator revoked for cause with a
   * full-access customer session.
   */
  it("reaches the impersonated rows the principal predicate cannot see", async () => {
    const harness = buildImpersonation();

    await openImpersonated(harness);

    // The staff-population service over the same session store — which is how
    // the container wires them: one `sessions` repository, two services.
    const staffService = createAuthService({
      population: "staff",
      principals: harness.principals.adapter,
      sessions: harness.sessions.repository,
      audit: harness.audit.audit,
      hasher: harness.hasher.hasher,
      tokens: createTokenService({
        secret: "unit-test-signing-key-at-least-32-characters",
        appId: "machxi",
        issuer: "machxi-api-test",
        accessTtlSec: 900,
        now,
      }),
      hashLimiter: createHashLimiter({ maxConcurrent: 4 }),
      refreshTtlSec: REFRESH_TTL_SEC,
      rotationGraceSec: GRACE_SEC,
      maxSessionsPerPrincipal: MAX_SESSIONS_PER_PRINCIPAL,
      impersonationSessionTtlSec: IMPERSONATION_TTL_SEC,
      // Neither of the flows under test here mints or mails anything;
      // the dependencies are required so a wiring mistake cannot be silent.
      accountTokens: createFakeAccountTokens().tokens,
      mail: createFakeMail().mail,
      mailTemplates: createMailTemplates({
        customerUrl: "https://app.example.test",
        adminUrl: "https://admin.example.test",
      }),
      transaction: (fn) => fn(undefined as never),
      now,
    });

    const revoked = await staffService.revokeSessionsFor(context(), {
      principalId: ACTOR_ID,
      reason: "account_disabled",
    });

    // Zero of the staff member's *own* sessions — they had none — and the
    // impersonated row is gone anyway, which is the property.
    expect(revoked).toBe(0);
    expect([...harness.sessions.rows.values()][0]?.revokedAt).not.toBeNull();

    // And it left a trail. Without this the exit control produced a complete
    // `minted → exchanged → ended` and an operator revoked *for cause* — the
    // case the sweep exists for — produced silence (ADR-0058).
    expect(harness.audit.entries).toEqual([
      {
        event: "impersonation.ended",
        identities: {
          actor: { type: "staff", id: ACTOR_ID },
          actingAs: { type: "user", id: CUSTOMER_ID },
        },
        data: { sessionId: "session-1", reason: "account_disabled" },
      },
    ]);
  });

  it("leaves an ordinary session of the same population alone", async () => {
    // The equality is on `impersonated_by_staff_id`, which is null on every
    // ordinary row, so nothing outside the delta can be reached by it.
    const harness = build({ population: "staff" });

    await login(harness, "correct-horse-battery");

    await harness.service.revokeSessionsFor(context(), {
      principalId: "99999999-9999-7999-8999-999999999999",
      reason: "account_disabled",
    });

    expect([...harness.sessions.rows.values()][0]?.revokedAt).toBeNull();
  });

  it("does not sweep on the user population, where the column is never a subject", async () => {
    const harness = buildImpersonation();

    await openImpersonated(harness);

    // The customer's *own* id, through the user-population service: the
    // impersonated row is that customer's, so the first predicate already
    // matches it and the second never runs.
    const revoked = await harness.service.revokeSessionsFor(context(), {
      principalId: CUSTOMER_ID,
      reason: "logout_all",
    });

    expect(revoked).toBe(1);
  });

  it("still counts and revokes the staff member's own sessions", async () => {
    // The sweep is additive: the number every caller reports is unchanged.
    const harness = build({ population: "staff" });

    await login(harness, "correct-horse-battery");

    const revoked = await harness.service.revokeSessionsFor(context(), {
      principalId: STAFF_ID,
      reason: "admin_revoke",
    });

    expect(revoked).toBe(1);
  });
});
