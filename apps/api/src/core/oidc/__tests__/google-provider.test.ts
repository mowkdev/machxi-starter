import { createLogger } from "@repo/logger";
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
} from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { createRequestContext } from "../../context/index.js";
import {
  codeChallengeFor,
  createAuthorizationRequest,
  createGoogleOidcProvider,
  GOOGLE_ISSUER,
  type OidcExchangeResult,
} from "../index.js";

/**
 * The Google adapter against a **stubbed issuer** (ADR-0072 §2): real RS256
 * keys, a real discovery document, a real token endpoint's shape — all served
 * by an injected `fetch`, so every byte `jose` verifies is one this file
 * signed, and Google is named only as the default nobody here uses (but one
 * case, which proves its documented second issuer spelling).
 *
 * The four claims the record names — `iss`, `aud`, `nonce`, `exp` — each get
 * a refusal of their own, beside the acceptance they are refusals of.
 */

const ISSUER = "https://issuer.test";
const CLIENT_ID = "client-id.apps.test";
const CLIENT_SECRET = "the-client-secret";
const REDIRECT_URI =
  "https://api.example.com/api/v1/public/auth/google/callback";
const KEY_ID = "stub-key-1";
const NOW = new Date("2026-09-11T12:00:00.000Z");
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

let signingKey: CryptoKey;
let strangerKey: CryptoKey;
let publicJwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  const stranger = await generateKeyPair("RS256");

  signingKey = pair.privateKey;
  strangerKey = stranger.privateKey;
  publicJwk = {
    ...(await exportJWK(pair.publicKey)),
    kid: KEY_ID,
    alg: "RS256",
    use: "sig",
  };
});

interface TokenOptions {
  readonly iss?: string;
  readonly aud?: string | string[];
  readonly nonce?: string | undefined;
  readonly sub?: string;
  readonly exp?: number;
  readonly key?: CryptoKey;
  readonly claims?: Record<string, unknown>;
}

/** An ID token as the stubbed issuer would mint it, with any one claim overridable. */
const idToken = ({
  iss = ISSUER,
  aud = CLIENT_ID,
  nonce,
  sub = "110169484474386276334",
  exp = NOW_SEC + 300,
  key = signingKey,
  claims = {},
}: TokenOptions) =>
  new SignJWT({
    email: "ada@gmail.example",
    email_verified: true,
    given_name: "Ada",
    family_name: "Lovelace",
    ...(nonce === undefined ? {} : { nonce }),
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
    .setIssuer(iss)
    .setAudience(aud)
    .setSubject(sub)
    .setIssuedAt(NOW_SEC - 10)
    .setExpirationTime(exp)
    .sign(key);

/**
 * The stubbed issuer: discovery, the key set and the token endpoint, and a
 * record of what the adapter sent to each.
 */
const createIssuer = ({
  issuer = ISSUER,
  documentIssuer = issuer,
  tokenStatus = 200,
}: {
  readonly issuer?: string;
  readonly documentIssuer?: string;
  readonly tokenStatus?: number;
} = {}) => {
  let nextIdToken = "";
  const calls: { url: string; init: RequestInit | undefined }[] = [];

  const fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });

    const json = (body: unknown, status = 200) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );

    if (url === `${issuer}/.well-known/openid-configuration`) {
      return json({
        issuer: documentIssuer,
        authorization_endpoint: `${issuer}/o/oauth2/v2/auth`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/certs`,
      });
    }

    if (url === `${issuer}/certs`) return json({ keys: [publicJwk] });

    if (url === `${issuer}/token`) {
      return tokenStatus === 200
        ? json({ access_token: "never-kept", id_token: nextIdToken })
        : json({ error: "invalid_grant" }, tokenStatus);
    }

    return json({ error: "not found" }, 404);
  });

  return {
    fetch,
    calls,
    willIssue: (token: string) => {
      nextIdToken = token;
    },
    tokenRequests: () =>
      calls
        .filter((call) => call.url === `${issuer}/token`)
        .map((call) => new URLSearchParams(String(call.init?.body))),
    discoveryCount: () =>
      calls.filter((call) => call.url.endsWith("/openid-configuration")).length,
  } as const;
};

const build = (
  issuer: ReturnType<typeof createIssuer>,
  options: { readonly issuerUrl?: string } = {},
) =>
  createGoogleOidcProvider({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
    issuer: options.issuerUrl ?? ISSUER,
    fetch: issuer.fetch,
    now: () => NOW,
  });

const context = () => {
  const ctx = createRequestContext({
    requestId: "01J0000000000000000000000A",
    logger: createLogger({ level: "silent", name: "oidc-test" }),
  });

  return { ctx, warn: vi.spyOn(ctx.logger, "warn") } as const;
};

/** Runs one exchange for `token`, with `nonce` as the attempt's own. */
const exchange = async (
  token: string,
  nonce: string,
  issuer = createIssuer(),
): Promise<OidcExchangeResult> => {
  issuer.willIssue(token);

  return build(issuer).exchangeCode(context().ctx, {
    code: "the-code",
    codeVerifier: "the-verifier",
    nonce,
  });
};

describe("createGoogleOidcProvider — the authorization URL", () => {
  it("carries state, nonce and an S256 PKCE challenge, and never the verifier", async () => {
    const issuer = createIssuer();
    const request = createAuthorizationRequest();

    const url = new URL(
      await build(issuer).authorizationUrl(context().ctx, request),
    );

    // The endpoint discovery named, not one this adapter assumed.
    expect(`${url.origin}${url.pathname}`).toBe(`${ISSUER}/o/oauth2/v2/auth`);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(
      codeChallengeFor(request.codeVerifier),
    );
    expect(url.searchParams.get("state")).toBe(request.state);
    expect(url.searchParams.get("nonce")).toBe(request.nonce);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    // The verifier is the PKCE secret: it stays in the transaction cookie,
    // and the URL — which sits in the browser bar and Google's logs — holds
    // only its hash.
    expect(url.toString()).not.toContain(request.codeVerifier);
  });

  it("computes the RFC 7636 challenge, BASE64URL(SHA256(verifier)), unpadded", () => {
    // Appendix B's own test vector.
    expect(
      codeChallengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    ).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("draws fresh, unguessable values for every attempt", () => {
    const first = createAuthorizationRequest();
    const second = createAuthorizationRequest();

    expect(first.state).not.toBe(second.state);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.codeVerifier).not.toBe(second.codeVerifier);
    // 43 base64url characters: 256 bits, inside RFC 7636's 43–128.
    expect(first.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("caches discovery once it succeeds", async () => {
    const issuer = createIssuer();
    const provider = build(issuer);

    await provider.authorizationUrl(
      context().ctx,
      createAuthorizationRequest(),
    );
    await provider.authorizationUrl(
      context().ctx,
      createAuthorizationRequest(),
    );

    expect(issuer.discoveryCount()).toBe(1);
  });

  it("does not cache a failed discovery, so an outage is not permanent", async () => {
    const issuer = createIssuer();
    const provider = build(issuer);

    issuer.fetch.mockImplementationOnce(() =>
      Promise.reject(new TypeError("fetch failed")),
    );

    await expect(
      provider.authorizationUrl(context().ctx, createAuthorizationRequest()),
    ).rejects.toThrow();
    await expect(
      provider.authorizationUrl(context().ctx, createAuthorizationRequest()),
    ).resolves.toContain(`${ISSUER}/o/oauth2/v2/auth`);
  });

  it("refuses a discovery document that names another issuer", async () => {
    // OIDC Discovery §4.3: a document fetched for one issuer that claims to
    // be another describes somebody else.
    const issuer = createIssuer({ documentIssuer: "https://evil.test" });

    await expect(
      build(issuer).authorizationUrl(
        context().ctx,
        createAuthorizationRequest(),
      ),
    ).rejects.toThrow(/another issuer/);
  });
});

describe("createGoogleOidcProvider — the ID token", () => {
  it("accepts a token from the stubbed issuer carrying this attempt's nonce", async () => {
    const issuer = createIssuer();
    const result = await exchange(
      await idToken({ nonce: "the-nonce" }),
      "the-nonce",
      issuer,
    );

    expect(result).toEqual({
      ok: true,
      identity: {
        subject: "110169484474386276334",
        email: "ada@gmail.example",
        emailVerified: true,
        // Verified, but not an address Google hosts: see the cases below.
        emailAuthoritative: false,
        givenName: "Ada",
        familyName: "Lovelace",
      },
    });

    // The code was redeemed with the verifier, the secret and the same
    // redirect URI the authorization request named — which is what Google's
    // token endpoint checks the PKCE binding against.
    const [form] = issuer.tokenRequests();

    expect(form?.get("grant_type")).toBe("authorization_code");
    expect(form?.get("code")).toBe("the-code");
    expect(form?.get("code_verifier")).toBe("the-verifier");
    expect(form?.get("client_id")).toBe(CLIENT_ID);
    expect(form?.get("client_secret")).toBe(CLIENT_SECRET);
    expect(form?.get("redirect_uri")).toBe(REDIRECT_URI);
  });

  it("refuses a token carrying another attempt's nonce", async () => {
    await expect(
      exchange(await idToken({ nonce: "somebody-elses" }), "the-nonce"),
    ).resolves.toEqual({ ok: false, reason: "nonce_mismatch" });
  });

  it("refuses a token carrying no nonce at all", async () => {
    await expect(
      exchange(await idToken({ nonce: undefined }), "the-nonce"),
    ).resolves.toEqual({ ok: false, reason: "nonce_mismatch" });
  });

  it("refuses a token issued to another client — the wrong aud", async () => {
    await expect(
      exchange(
        await idToken({ nonce: "the-nonce", aud: "another-client" }),
        "the-nonce",
      ),
    ).resolves.toEqual({ ok: false, reason: "id_token_invalid" });
  });

  it("refuses a token from another issuer — the wrong iss", async () => {
    // Signed with the right key, so the only thing wrong is who it claims to
    // be from: this is the refusal `issuer` exists for.
    await expect(
      exchange(
        await idToken({ nonce: "the-nonce", iss: "https://evil.test" }),
        "the-nonce",
      ),
    ).resolves.toEqual({ ok: false, reason: "id_token_invalid" });
  });

  it("refuses an expired token, past the clock tolerance", async () => {
    await expect(
      exchange(
        await idToken({ nonce: "the-nonce", exp: NOW_SEC - 60 }),
        "the-nonce",
      ),
    ).resolves.toEqual({ ok: false, reason: "id_token_invalid" });
  });

  it("refuses a token signed by a key the issuer never published", async () => {
    await expect(
      exchange(
        await idToken({ nonce: "the-nonce", key: strangerKey }),
        "the-nonce",
      ),
    ).resolves.toEqual({ ok: false, reason: "id_token_invalid" });
  });

  it("refuses a token whose authorized party is another client", async () => {
    // OIDC Core §3.1.3.7: with several audiences the `azp` says who the
    // token was issued to, and it has to be us.
    await expect(
      exchange(
        await idToken({
          nonce: "the-nonce",
          aud: [CLIENT_ID, "another-client"],
          claims: { azp: "another-client" },
        }),
        "the-nonce",
      ),
    ).resolves.toEqual({ ok: false, reason: "claims_invalid" });
  });

  it("refuses a token with several audiences and no authorized party", async () => {
    // `jose` accepts any audience list that merely contains our id; the
    // other entries are audiences we do not trust, so §3.1.3.7 wants `azp`
    // to name us (`D19.1`'s `security-reviewer`).
    await expect(
      exchange(
        await idToken({
          nonce: "the-nonce",
          aud: [CLIENT_ID, "another-client"],
        }),
        "the-nonce",
      ),
    ).resolves.toEqual({ ok: false, reason: "claims_invalid" });

    // And the same list is accepted when the authorized party is us.
    await expect(
      exchange(
        await idToken({
          nonce: "the-nonce",
          aud: [CLIENT_ID, "another-client"],
          claims: { azp: CLIENT_ID },
        }),
        "the-nonce",
      ),
    ).resolves.toMatchObject({ ok: true });
  });

  it("reads an unverified, absent or malformed claim as no verified address — and still an identity", async () => {
    // ADR-0072 §1: an unverified claim never matches and never creates. The
    // token is still a valid sign-in for its subject, so what is asserted is
    // an identity with the weaker answer, not a refusal — a refusal would
    // pass a looser assertion too (`D19.1`'s `code-reviewer`).
    for (const claims of [
      { email_verified: false },
      { email_verified: "false" },
      { email_verified: undefined },
      { email_verified: null },
      { email_verified: 1 },
    ]) {
      await expect(
        exchange(await idToken({ nonce: "the-nonce", claims }), "the-nonce"),
      ).resolves.toMatchObject({
        ok: true,
        identity: { emailVerified: false, emailAuthoritative: false },
      });
    }

    const malformed = await exchange(
      await idToken({
        nonce: "the-nonce",
        claims: { email: "not-an-address", email_verified: true },
      }),
      "the-nonce",
    );

    expect(malformed).toMatchObject({
      ok: true,
      identity: { email: undefined, emailVerified: false },
    });
  });

  it("reports Google authoritative for the addresses it hosts (ADR-0072 §1, amended)", async () => {
    // A consumer address Google hosts outright, and a Workspace address whose
    // `hd` is its own domain — case-insensitively, as a domain is.
    for (const claims of [
      { email: "ada@gmail.com" },
      { email: "ada@googlemail.com" },
      { email: "ada@example.org", hd: "example.org" },
      { email: "Ada@Example.ORG", hd: "example.org" },
    ]) {
      await expect(
        exchange(await idToken({ nonce: "the-nonce", claims }), "the-nonce"),
      ).resolves.toMatchObject({
        ok: true,
        identity: { emailVerified: true, emailAuthoritative: true },
      });
    }
  });

  it("reports verified but not authoritative for every other address", async () => {
    // Google checked these mailboxes once, when the Google account was made;
    // linking by address must not read that as control today. An `hd` that
    // names another domain is no better than none, and an unverified gmail
    // address is not authoritative either.
    for (const [claims, verified] of [
      [{ email: "ada@example.org" }, true],
      [{ email: "ada@example.org", hd: "other.example" }, true],
      [{ email: "ada@gmail.com.example.org" }, true],
      [{ email: "ada@gmail.com", email_verified: false }, false],
    ] as const) {
      await expect(
        exchange(await idToken({ nonce: "the-nonce", claims }), "the-nonce"),
      ).resolves.toMatchObject({
        ok: true,
        identity: { emailVerified: verified, emailAuthoritative: false },
      });
    }
  });

  it("accepts Google's documented second issuer spelling for Google alone", async () => {
    // `iss` is `accounts.google.com` or `https://accounts.google.com`, by
    // Google's own documentation; the alias is scoped to that issuer.
    const issuer = createIssuer({ issuer: GOOGLE_ISSUER });

    issuer.willIssue(
      await idToken({ nonce: "the-nonce", iss: "accounts.google.com" }),
    );

    await expect(
      build(issuer, { issuerUrl: GOOGLE_ISSUER }).exchangeCode(context().ctx, {
        code: "the-code",
        codeVerifier: "the-verifier",
        nonce: "the-nonce",
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("answers a code the token endpoint refused as code_rejected, and logs no secret", async () => {
    const issuer = createIssuer({ tokenStatus: 400 });
    const { ctx, warn } = context();

    issuer.willIssue("unused");

    await expect(
      build(issuer).exchangeCode(ctx, {
        code: "the-code",
        codeVerifier: "the-verifier",
        nonce: "the-nonce",
      }),
    ).resolves.toEqual({ ok: false, reason: "code_rejected" });

    const logged = JSON.stringify(warn.mock.calls);

    expect(logged).toContain("code_rejected");
    expect(logged).not.toContain(CLIENT_SECRET);
    expect(logged).not.toContain("the-verifier");
    expect(logged).not.toContain("the-code");
  });

  it("answers an unreachable provider as a value, never a rejection", async () => {
    // The callback is a navigation that answers every refusal with the same
    // redirect; a throw there would be a JSON 500 on a bare page.
    const issuer = createIssuer();

    issuer.fetch.mockImplementation(() =>
      Promise.reject(new TypeError("fetch failed")),
    );

    await expect(
      build(issuer).exchangeCode(context().ctx, {
        code: "the-code",
        codeVerifier: "the-verifier",
        nonce: "the-nonce",
      }),
    ).resolves.toEqual({ ok: false, reason: "provider_unreachable" });
  });
});
