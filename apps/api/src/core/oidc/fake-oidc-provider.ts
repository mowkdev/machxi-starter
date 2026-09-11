import { randomToken } from "@repo/crypto";

import type { RequestContext } from "../context/index.js";
import { buildAuthorizationUrl, codeChallengeFor } from "./authorization.js";
import type {
  OidcAuthorizationRequest,
  OidcExchangeInput,
  OidcExchangeResult,
  OidcProvider,
} from "./oidc.types.js";

/**
 * Where the fake sends a browser. `.test` is reserved (RFC 2606), so no
 * authorization URL this builds can reach anybody.
 */
export const FAKE_AUTHORIZATION_ENDPOINT = "https://oidc.fake.test/authorize";

/**
 * What the fake's "person at the provider" consents as.
 *
 * **Both address claims are stated, never defaulted** (`D19.1`'s
 * `security-reviewer`). The real adapter reads an absent claim as the weaker
 * answer, so a fake that defaulted either to `true` would let a test written
 * as "Google did not say" link or create an account — the path ADR-0072 §1
 * forbids — and pass. `emailAuthoritative` is `true` only alongside
 * `emailVerified`, as it is in the real adapter.
 */
export interface FakeOidcClaims {
  readonly subject: string;
  readonly email?: string;
  readonly emailVerified: boolean;
  /** Whether the provider hosts the mailbox (ADR-0072 §1, amended): a gmail.com address, or a Workspace one. */
  readonly emailAuthoritative: boolean;
  readonly givenName?: string;
  readonly familyName?: string;
}

export interface FakeOidcProviderDeps {
  readonly clientId?: string;
  readonly redirectUri?: string;
}

/**
 * The fake behind {@link OidcProvider} (ADR-0072 §2, ADR-0066's shape): what
 * the integration tier drives the callback against, so the whole flow but
 * Google itself is proved against Postgres. Not a stub that answers "yes" —
 * it keeps the two promises the real provider keeps, because those are what
 * the flow's own binding rests on:
 *
 * - **PKCE.** A code redeems only with the verifier whose `S256` challenge
 *   was on the authorization URL, as Google's token endpoint insists.
 * - **The nonce.** The identity comes back only for the nonce that URL
 *   carried, as the real adapter's check on the ID token insists.
 *
 * And codes are single-use, as Google's are. A caller that passed the wrong
 * verifier or nonce out of its transaction cookie therefore fails here
 * exactly as it would against Google.
 *
 * `consent` is the person at the provider: it reads the authorization URL the
 * flow produced, records who is consenting, and returns the `code` and
 * `state` Google would put on the callback.
 */
export const createFakeOidcProvider = ({
  clientId = "fake-client-id",
  redirectUri = "http://localhost:4000/api/v1/public/auth/google/callback",
}: FakeOidcProviderDeps = {}) => {
  const grants = new Map<
    string,
    {
      readonly claims: FakeOidcClaims;
      readonly nonce: string;
      readonly codeChallenge: string;
    }
  >();

  const provider: OidcProvider = {
    id: "google",

    authorizationUrl: (
      _ctx: RequestContext,
      request: OidcAuthorizationRequest,
    ): Promise<string> =>
      Promise.resolve(
        buildAuthorizationUrl(FAKE_AUTHORIZATION_ENDPOINT, {
          clientId,
          redirectUri,
          request,
        }),
      ),

    exchangeCode: (
      _ctx: RequestContext,
      { code, codeVerifier, nonce }: OidcExchangeInput,
    ): Promise<OidcExchangeResult> => {
      const grant = grants.get(code);

      // Spent on first presentation, right or wrong, as a real code is.
      grants.delete(code);

      if (
        grant === undefined ||
        codeChallengeFor(codeVerifier) !== grant.codeChallenge
      ) {
        return Promise.resolve({ ok: false, reason: "code_rejected" });
      }

      if (grant.nonce !== nonce) {
        return Promise.resolve({ ok: false, reason: "nonce_mismatch" });
      }

      const { claims } = grant;
      const emailVerified = claims.email !== undefined && claims.emailVerified;

      return Promise.resolve({
        ok: true,
        identity: {
          subject: claims.subject,
          email: claims.email,
          emailVerified,
          emailAuthoritative: emailVerified && claims.emailAuthoritative,
          givenName: claims.givenName,
          familyName: claims.familyName,
        },
      });
    },
  };

  const consent = (
    authorizationUrl: string,
    claims: FakeOidcClaims,
  ): { readonly code: string; readonly state: string } => {
    const params = new URL(authorizationUrl).searchParams;
    const state = params.get("state");
    const nonce = params.get("nonce");
    const codeChallenge = params.get("code_challenge");

    // A test that hands this something the flow did not build is a broken
    // test, not a refusal to simulate: say so loudly.
    if (
      state === null ||
      nonce === null ||
      codeChallenge === null ||
      params.get("code_challenge_method") !== "S256"
    ) {
      throw new Error(
        "createFakeOidcProvider.consent: not an authorization URL this flow built",
      );
    }

    const code = randomToken(16);

    grants.set(code, { claims, nonce, codeChallenge });

    return { code, state };
  };

  return { provider, consent } as const;
};

export type FakeOidcProvider = ReturnType<typeof createFakeOidcProvider>;
