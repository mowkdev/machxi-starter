import { createLogger } from "@repo/logger";
import { describe, expect, it } from "vitest";

import { createRequestContext } from "../../context/index.js";
import {
  FAKE_AUTHORIZATION_ENDPOINT,
  createAuthorizationRequest,
  createFakeOidcProvider,
} from "../index.js";

/**
 * The fake the integration tier drives the callback against (ADR-0072 §2).
 *
 * Its worth is that it keeps the real provider's two promises — PKCE and the
 * nonce — and its single-use codes, so a flow that threads the wrong value out
 * of its transaction cookie fails here the way it would against Google. These
 * cases are what make that claim more than a docblock.
 */

const ctx = createRequestContext({
  requestId: "01J0000000000000000000000A",
  logger: createLogger({ level: "silent", name: "oidc-fake-test" }),
});

const ADA = {
  subject: "fake-subject-ada",
  email: "ada@gmail.com",
  emailVerified: true,
  emailAuthoritative: true,
  givenName: "Ada",
  familyName: "Lovelace",
} as const;

const started = async () => {
  const fake = createFakeOidcProvider();
  const request = createAuthorizationRequest();
  const url = await fake.provider.authorizationUrl(ctx, request);

  return { fake, request, url } as const;
};

describe("createFakeOidcProvider", () => {
  it("builds the real adapter's URL on a host nobody can reach", async () => {
    const { url, request } = await started();
    const parsed = new URL(url);

    expect(`${parsed.origin}${parsed.pathname}`).toBe(
      FAKE_AUTHORIZATION_ENDPOINT,
    );
    expect(parsed.searchParams.get("state")).toBe(request.state);
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("returns the consenting person for the right verifier and nonce, and echoes state", async () => {
    const { fake, request, url } = await started();
    const { code, state } = fake.consent(url, ADA);

    expect(state).toBe(request.state);
    await expect(
      fake.provider.exchangeCode(ctx, {
        code,
        codeVerifier: request.codeVerifier,
        nonce: request.nonce,
      }),
    ).resolves.toEqual({
      ok: true,
      identity: ADA,
    });
  });

  it("refuses the wrong PKCE verifier, as Google's token endpoint does", async () => {
    const { fake, request, url } = await started();
    const { code } = fake.consent(url, ADA);

    await expect(
      fake.provider.exchangeCode(ctx, {
        code,
        codeVerifier: createAuthorizationRequest().codeVerifier,
        nonce: request.nonce,
      }),
    ).resolves.toEqual({ ok: false, reason: "code_rejected" });
  });

  it("refuses another attempt's nonce", async () => {
    const { fake, request, url } = await started();
    const { code } = fake.consent(url, ADA);

    await expect(
      fake.provider.exchangeCode(ctx, {
        code,
        codeVerifier: request.codeVerifier,
        nonce: createAuthorizationRequest().nonce,
      }),
    ).resolves.toEqual({ ok: false, reason: "nonce_mismatch" });
  });

  it("spends a code on its first presentation", async () => {
    const { fake, request, url } = await started();
    const { code } = fake.consent(url, ADA);
    const input = {
      code,
      codeVerifier: request.codeVerifier,
      nonce: request.nonce,
    };

    await expect(fake.provider.exchangeCode(ctx, input)).resolves.toMatchObject(
      { ok: true },
    );
    await expect(fake.provider.exchangeCode(ctx, input)).resolves.toEqual({
      ok: false,
      reason: "code_rejected",
    });
  });

  it("scripts an unverified address, which is never authoritative either", async () => {
    // The flow must never link or create on it (ADR-0072 §1). Asserted as an
    // identity with the weaker answer rather than as a falsy expression, which
    // a refusal would satisfy too (`D19.1`'s `code-reviewer`).
    const { fake, request, url } = await started();
    const { code } = fake.consent(url, {
      ...ADA,
      emailVerified: false,
      emailAuthoritative: true,
    });

    await expect(
      fake.provider.exchangeCode(ctx, {
        code,
        codeVerifier: request.codeVerifier,
        nonce: request.nonce,
      }),
    ).resolves.toMatchObject({
      ok: true,
      identity: { emailVerified: false, emailAuthoritative: false },
    });
  });

  it("scripts a verified address the provider does not host", async () => {
    // The case ADR-0072 §1's amendment refuses to link by address.
    const { fake, request, url } = await started();
    const { code } = fake.consent(url, {
      ...ADA,
      email: "ada@example.org",
      emailAuthoritative: false,
    });

    await expect(
      fake.provider.exchangeCode(ctx, {
        code,
        codeVerifier: request.codeVerifier,
        nonce: request.nonce,
      }),
    ).resolves.toMatchObject({
      ok: true,
      identity: { emailVerified: true, emailAuthoritative: false },
    });
  });

  it("refuses to consent to a URL the flow did not build", () => {
    expect(() =>
      createFakeOidcProvider().consent("https://oidc.fake.test/authorize", ADA),
    ).toThrow(/not an authorization URL/);
  });
});
