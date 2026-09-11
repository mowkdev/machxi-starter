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
import type { FederatedAccounts } from "../auth.types.js";

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
    touchLogin: vi.fn(() => Promise.resolve()),
    identitiesOf: vi.fn(() => Promise.resolve([])),
  };

  const service = createFederatedSignInService({
    provider: {
      id: "google",
      authorizationUrl: () =>
        Promise.resolve("https://oidc.fake.test/authorize"),
      exchangeCode,
      ...provider,
    },
    transactions,
    principals: { findByEmail: () => Promise.resolve(undefined) },
    accounts,
    organizations: { ensurePersonalOrganizationFor },
    accountTokens: {} as AccountTokens,
    audit: {} as Audit,
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
    ensurePersonalOrganizationFor,
    transaction: transactions_,
  } as const;
};

const sealed = () =>
  transactions.seal({ ...REQUEST, intent: "signin", locale: undefined });

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

  it("refuses a verified address Google does not host before it asks who holds it", async () => {
    // Neither links nor creates (ADR-0072 §1, amended at `D19.1` and at
    // `D19.2`), and answers the same whether or not an account holds it.
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

    expect(
      await built.service.callback(ctx, {
        code: "a-code",
        state: "the-state",
        error: undefined,
        transaction: await sealed(),
      }),
    ).toEqual({ ok: false, code: "AUTH_FEDERATED_LINK_REQUIRED" });
    expect(built.accounts.createFederated).not.toHaveBeenCalled();
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
