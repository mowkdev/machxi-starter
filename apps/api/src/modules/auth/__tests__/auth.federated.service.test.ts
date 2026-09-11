import { createLogger } from "@repo/logger";
import { describe, expect, it, vi } from "vitest";

import type { Audit } from "../../../core/audit/index.js";
import { createRequestContext } from "../../../core/context/index.js";
import {
  createOidcTransactionCodec,
  type OidcProvider,
} from "../../../core/oidc/index.js";
import type { AccountTokens } from "../../../core/tokens/index.js";
import { createFederatedSignInService } from "../auth.federated.service.js";
import type { SessionRecord } from "../auth.repository.js";
import type { FederatedAccounts, PrincipalRecord } from "../auth.types.js";

/**
 * The start and the callback's edges (ADR-0072 §2), with plain-object fakes
 * (ADR-0021). The resolution itself — subject, address, creation — is proved
 * against Postgres in `federated-identity.int.test.ts`; what is cheaper to
 * pin here is what happens **before** it and **around** it: that a callback
 * this browser did not start never reaches the provider, which refusal a
 * provider outage becomes, and that a real fault is not folded into a
 * sentence.
 */

const ctx = createRequestContext({
  requestId: "01J0000000000000000000000F",
  logger: createLogger({ level: "silent", name: "federated-service-test" }),
});

const transactions = createOidcTransactionCodec({
  secret: "unit-test-signing-key-at-least-32-characters",
  appId: "machxi",
  issuer: "machxi-api-test",
});

const REQUEST = { state: "the-state", nonce: "the-nonce", codeVerifier: "v" };

const GOOGLE_HOSTED = {
  subject: "s",
  email: "a@gmail.test",
  emailVerified: true,
  emailAuthoritative: true,
  givenName: undefined,
  familyName: undefined,
} as const;

/** An `active` account as the adapter answers it, for the cases that need one. */
const account = (id: string, email: string): PrincipalRecord => ({
  id,
  email,
  passwordHash: "argon2-hash",
  active: true,
  awaitingEmailVerification: false,
  roles: ["customer"],
  resource: {
    kind: "user",
    id,
    email,
    firstName: null,
    lastName: null,
    roles: ["customer"],
  },
});

/** The session a link was asked from, live unless a case says otherwise. */
const liveSession = (
  overrides: Partial<SessionRecord> = {},
): SessionRecord => ({
  id: "the-session",
  principalType: "user",
  principalId: "the-caller",
  refreshTokenHash: "h",
  previousRefreshTokenHash: null,
  refreshTokenExpiresAt: new Date(Date.now() + 3_600_000),
  rotatedAt: null,
  revokedAt: null,
  impersonatedByStaffId: null,
  ...overrides,
});

const build = (provider: Partial<OidcProvider> = {}) => {
  const exchangeCode = vi.fn<OidcProvider["exchangeCode"]>(() =>
    Promise.resolve({ ok: false, reason: "code_rejected" }),
  );
  /** Whether the last transaction's callback rejected — i.e. rolled back. */
  const transactions_ = { rolledBack: false, executor: { tx: true } };
  const ensurePersonalOrganizationFor = vi.fn(() =>
    Promise.resolve("personal-org-id"),
  );
  const accounts: FederatedAccounts = {
    findBySubject: vi.fn(() => Promise.resolve(undefined)),
    createFederated: vi.fn(() => Promise.resolve(undefined)),
    link: vi.fn(() => Promise.resolve(false)),
    touchLogin: vi.fn(() => Promise.resolve(true)),
    identitiesOf: vi.fn(() => Promise.resolve([])),
    unlinkAll: vi.fn(() => Promise.resolve([])),
    unlinkLinkedAfter: vi.fn(() => Promise.resolve([])),
    lockAccount: vi.fn(() => Promise.resolve()),
  };
  const principals = {
    findByEmail: vi.fn<(email: string) => Promise<PrincipalRecord | undefined>>(
      () => Promise.resolve(undefined),
    ),
    findById: vi.fn<(id: string) => Promise<PrincipalRecord | undefined>>(() =>
      Promise.resolve(account("the-caller", "caller@example.test")),
    ),
  };
  const sessions = {
    findById: vi.fn<(id: string) => Promise<SessionRecord | undefined>>(() =>
      Promise.resolve(liveSession()),
    ),
  };
  const record = vi.fn(() => Promise.resolve());

  const service = createFederatedSignInService({
    provider: {
      id: "google",
      authorizationUrl: () =>
        Promise.resolve("https://oidc.fake.test/authorize"),
      exchangeCode,
      ...provider,
    },
    transactions,
    principals,
    sessions,
    accounts,
    organizations: { ensurePersonalOrganizationFor },
    accountTokens: {
      mint: () =>
        Promise.resolve({ token: "a-handoff", expiresAt: new Date() }),
    } as unknown as AccountTokens,
    audit: { record } as unknown as Audit,
    registrationOpen: true,
    handoffTtlSec: 60,
    transaction: async (fn) => {
      transactions_.rolledBack = false;

      try {
        return await fn(transactions_.executor as never);
      } catch (error) {
        transactions_.rolledBack = true;
        throw error;
      }
    },
    newAuthorizationRequest: () => REQUEST,
  });

  return {
    service,
    exchangeCode,
    accounts,
    principals,
    sessions,
    record,
    ensurePersonalOrganizationFor,
    transaction: transactions_,
  } as const;
};

const sealed = () =>
  transactions.seal({ ...REQUEST, intent: "signin", locale: undefined });

/** A link transaction, as the profile's start seals it (ADR-0072 §3). */
const sealedLink = () =>
  transactions.seal({
    ...REQUEST,
    intent: "link",
    userId: "the-caller",
    sessionId: "the-session",
    locale: undefined,
  });

const callbackWith = async (transaction: string) => ({
  code: "a-code",
  state: "the-state",
  error: undefined,
  transaction,
});

describe("createFederatedSignInService", () => {
  it("seals the attempt's own state, nonce and verifier into the start's transaction", async () => {
    const { service } = build();
    const started = await service.start(ctx, { locale: "lv" });

    expect(started.authorizationUrl).toBe("https://oidc.fake.test/authorize");
    expect(await transactions.open(started.transaction)).toEqual({
      ...REQUEST,
      intent: "signin",
      locale: "lv",
    });
  });

  it("answers a start 503 when the provider's metadata cannot be loaded", async () => {
    const { service } = build({
      authorizationUrl: () => Promise.reject(new Error("discovery down")),
    });

    await expect(service.start(ctx, {})).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("never asks the provider about a callback whose state is not the cookie's", async () => {
    const { service, exchangeCode } = build();

    const outcome = await service.callback(ctx, {
      code: "a-code",
      state: "not-the-state",
      error: undefined,
      transaction: await sealed(),
    });

    expect(outcome).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("never asks the provider when the cookie is missing or not ours", async () => {
    const { service, exchangeCode } = build();

    for (const transaction of [undefined, "not-a-transaction"]) {
      expect(
        await service.callback(ctx, {
          code: "a-code",
          state: "the-state",
          error: undefined,
          transaction,
        }),
      ).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    }

    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("hands the provider the cookie's verifier and nonce, and nothing the query said", async () => {
    const { service, exchangeCode } = build();

    await service.callback(ctx, {
      code: "a-code",
      state: "the-state",
      error: undefined,
      transaction: await sealed(),
    });

    expect(exchangeCode).toHaveBeenCalledWith(ctx, {
      code: "a-code",
      codeVerifier: "v",
      nonce: "the-nonce",
    });
  });

  it("tells an outage from a refusal", async () => {
    const outage = build({
      exchangeCode: () =>
        Promise.resolve({ ok: false, reason: "provider_unreachable" }),
    });
    const refused = build({
      exchangeCode: () =>
        Promise.resolve({ ok: false, reason: "id_token_invalid" }),
    });
    const input = async () => ({
      code: "a-code",
      state: "the-state",
      error: undefined,
      transaction: await sealed(),
    });

    expect(await outage.service.callback(ctx, await input())).toEqual({
      ok: false,
      code: "SERVICE_UNAVAILABLE",
    });
    expect(await refused.service.callback(ctx, await input())).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
  });

  it("rolls the account and its organization back when the link loses a race after them", async () => {
    // The one refusal that follows writes (`D19.2`'s `code-reviewer`): the
    // subject was linked by a concurrent callback between the first read and
    // this insert. The throw, inside the transaction, is what takes the
    // account and its personal organization back out.
    const built = build({
      exchangeCode: () =>
        Promise.resolve({ ok: true, identity: GOOGLE_HOSTED }),
    });

    vi.mocked(built.accounts.createFederated).mockResolvedValueOnce({
      id: "new-user",
      email: GOOGLE_HOSTED.email,
      passwordHash: null,
      active: true,
      awaitingEmailVerification: false,
      roles: ["customer"],
      resource: {
        kind: "user",
        id: "new-user",
        email: GOOGLE_HOSTED.email,
        firstName: null,
        lastName: null,
        roles: ["customer"],
      },
    });

    const outcome = await built.service.callback(ctx, {
      code: "a-code",
      state: "the-state",
      error: undefined,
      transaction: await sealed(),
    });

    expect(outcome).toEqual({ ok: false, code: "CONFLICT" });
    expect(built.ensurePersonalOrganizationFor).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ id: "new-user" }),
      built.transaction.executor,
    );
    expect(built.transaction.rolledBack).toBe(true);
  });

  it("creates on a verified address Google does not host when nobody holds it", async () => {
    // The `D19.2` narrowing, withdrawn at `D19.4` (ADR-0072 §1's last
    // amendment): a reset now removes every identity, so the mailbox
    // recovers such an account and creation reads the claim alone.
    const built = build({
      exchangeCode: () =>
        Promise.resolve({
          ok: true,
          identity: {
            ...GOOGLE_HOSTED,
            email: "a@lapsed-domain.test",
            emailAuthoritative: false,
          },
        }),
    });

    await built.service.callback(ctx, await callbackWith(await sealed()));

    expect(built.accounts.createFederated).toHaveBeenCalledWith(
      expect.objectContaining({ email: "a@lapsed-domain.test" }),
      built.transaction.executor,
    );
  });

  it("refuses a verified address Google does not host when an account holds it, and links nothing", async () => {
    // Authority stays on the address match (ADR-0072 §1, amended at `D19.1`).
    const built = build({
      exchangeCode: () =>
        Promise.resolve({
          ok: true,
          identity: {
            ...GOOGLE_HOSTED,
            email: "held@lapsed-domain.test",
            emailAuthoritative: false,
          },
        }),
    });

    built.principals.findByEmail.mockResolvedValueOnce(
      account("the-holder", "held@lapsed-domain.test"),
    );

    expect(
      await built.service.callback(ctx, await callbackWith(await sealed())),
    ).toEqual({ ok: false, code: "AUTH_FEDERATED_LINK_REQUIRED" });
    expect(built.accounts.link).not.toHaveBeenCalled();
    expect(built.accounts.createFederated).not.toHaveBeenCalled();
  });

  /* ── the link intent (ADR-0072 §3) ────────────────────────────────────── */

  it("seals the caller's account and session into a link start", async () => {
    const { service } = build();
    const linkCtx = createRequestContext({
      requestId: "01J0000000000000000000000L",
      logger: createLogger({ level: "silent", name: "federated-link-test" }),
    });

    linkCtx.principal = {
      kind: "user",
      id: "the-caller",
      roles: ["customer"],
      sessionId: "the-session",
    };

    const started = await service.startLink(linkCtx, {});

    expect(await transactions.open(started.transaction)).toMatchObject({
      intent: "link",
      userId: "the-caller",
      sessionId: "the-session",
    });
  });

  it("links the provider's subject to the caller and answers linked", async () => {
    const built = build({
      exchangeCode: () =>
        Promise.resolve({ ok: true, identity: GOOGLE_HOSTED }),
    });

    vi.mocked(built.accounts.link).mockResolvedValueOnce(true);

    expect(
      await built.service.callback(ctx, await callbackWith(await sealedLink())),
    ).toEqual({ ok: true, kind: "linked", provider: "google" });
    expect(built.accounts.link).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "the-caller", subject: "s" }),
      built.transaction.executor,
    );
    expect(built.record).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        event: "account.identity_linked",
        data: { provider: "google", via: "link" },
      }),
      built.transaction.executor,
    );
  });

  it("locks the account row before it reads the session that asked", async () => {
    // ADR-0072 §3, amended after `D19.4`: a reset of the account holds the
    // same lock, so a link that reads its session only once it has the lock
    // reads the reset's revocation rather than the moment before it.
    const built = build({
      exchangeCode: () =>
        Promise.resolve({ ok: true, identity: GOOGLE_HOSTED }),
    });

    vi.mocked(built.accounts.link).mockResolvedValueOnce(true);

    await built.service.callback(ctx, await callbackWith(await sealedLink()));

    const lock = vi.mocked(built.accounts.lockAccount).mock;

    expect(lock.calls).toEqual([["the-caller", built.transaction.executor]]);
    expect(lock.invocationCallOrder[0]).toBeLessThan(
      built.sessions.findById.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it.each([
    ["revoked", { revokedAt: new Date() }],
    ["expired", { refreshTokenExpiresAt: new Date(Date.now() - 1000) }],
    ["impersonated", { impersonatedByStaffId: "a-staff-member" }],
    ["another account's", { principalId: "somebody-else" }],
  ] as const)(
    "refuses a link whose session is %s, before it reads the account",
    async (_name, overrides) => {
      // The session check is `D19.4`'s amendment to §3: a reset that ends the
      // session must not be followed by a link that session started.
      const built = build({
        exchangeCode: () =>
          Promise.resolve({ ok: true, identity: GOOGLE_HOSTED }),
      });

      built.sessions.findById.mockResolvedValueOnce(liveSession(overrides));

      expect(
        await built.service.callback(
          ctx,
          await callbackWith(await sealedLink()),
        ),
      ).toEqual({ ok: false, code: "UNAUTHENTICATED" });
      expect(built.principals.findById).not.toHaveBeenCalled();
      expect(built.accounts.link).not.toHaveBeenCalled();
    },
  );

  it("answers linked, writing nothing, when the subject is already the caller's", async () => {
    const built = build({
      exchangeCode: () =>
        Promise.resolve({ ok: true, identity: GOOGLE_HOSTED }),
    });

    vi.mocked(built.accounts.findBySubject).mockResolvedValueOnce({
      identityId: "the-identity",
      principal: account("the-caller", "caller@example.test"),
    });

    expect(
      await built.service.callback(ctx, await callbackWith(await sealedLink())),
    ).toEqual({ ok: true, kind: "linked", provider: "google" });
    expect(built.accounts.link).not.toHaveBeenCalled();
    expect(built.record).not.toHaveBeenCalled();
  });

  it("refuses a subject another account holds with AUTH_IDENTITY_TAKEN", async () => {
    const built = build({
      exchangeCode: () =>
        Promise.resolve({ ok: true, identity: GOOGLE_HOSTED }),
    });

    vi.mocked(built.accounts.findBySubject).mockResolvedValueOnce({
      identityId: "the-identity",
      principal: account("somebody-else", "else@example.test"),
    });

    expect(
      await built.service.callback(ctx, await callbackWith(await sealedLink())),
    ).toEqual({ ok: false, code: "AUTH_IDENTITY_TAKEN" });
    expect(built.accounts.link).not.toHaveBeenCalled();
  });

  it("lets a real fault through to the error handler rather than into the fragment", async () => {
    const { service, accounts } = build({
      exchangeCode: () =>
        Promise.resolve({ ok: true, identity: GOOGLE_HOSTED }),
    });

    vi.mocked(accounts.findBySubject).mockRejectedValueOnce(
      new Error("connection reset"),
    );

    await expect(
      service.callback(ctx, {
        code: "a-code",
        state: "the-state",
        error: undefined,
        transaction: await sealed(),
      }),
    ).rejects.toThrow("connection reset");
  });
});
