import { randomToken, sha256Base64url } from "@repo/crypto";

import type { OidcAuthorizationRequest } from "./oidc.types.js";

/**
 * The scopes every authorization request asks for (ADR-0072 §2): the OIDC
 * identity, the address the linking rule reads, and the names a created
 * account takes. Nothing that reaches into a person's Google data.
 */
export const OIDC_SCOPES = "openid email profile";

/**
 * Where the provider sends the browser back (ADR-0072 §2) — appended to
 * `API_PUBLIC_URL` to make the redirect URI registered, exactly, in the
 * provider's console and stated once in `docs/deploy.md`. The public router
 * mounts the route at this path; the two are one fact written twice, and the
 * integration tier's callback requests are what hold them together.
 */
export const OIDC_CALLBACK_PATH = "/api/v1/public/auth/google/callback";

/** `${API_PUBLIC_URL}${OIDC_CALLBACK_PATH}`, for the adapter and the fake alike. */
export const oidcRedirectUri = (apiPublicUrl: string): string =>
  `${apiPublicUrl}${OIDC_CALLBACK_PATH}`;

/**
 * A fresh `state`, `nonce` and PKCE verifier for one sign-in attempt.
 *
 * `randomToken(32)` for each — 256 bits, base64url, 43 characters, which is
 * inside RFC 7636's 43–128 and entirely in its unreserved alphabet, so the
 * verifier needs no further encoding.
 */
export const createAuthorizationRequest = (): OidcAuthorizationRequest => ({
  state: randomToken(32),
  nonce: randomToken(32),
  codeVerifier: randomToken(32),
});

/**
 * The PKCE `S256` challenge of a verifier (RFC 7636 §4.2):
 * `BASE64URL(SHA256(ASCII(verifier)))`, unpadded — exactly what
 * `sha256Base64url` computes. `plain` is never offered.
 */
export const codeChallengeFor = (codeVerifier: string): string =>
  sha256Base64url(codeVerifier);

/**
 * The authorization URL both adapters build, so the fake cannot drift from
 * the real one in what it puts on the wire.
 *
 * Parameters are **set** on the endpoint rather than replacing its query,
 * because a provider may publish an authorization endpoint that already
 * carries one.
 */
export const buildAuthorizationUrl = (
  authorizationEndpoint: string,
  {
    clientId,
    redirectUri,
    request,
  }: {
    readonly clientId: string;
    readonly redirectUri: string;
    readonly request: OidcAuthorizationRequest;
  },
): string => {
  const url = new URL(authorizationEndpoint);

  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", OIDC_SCOPES);
  url.searchParams.set("state", request.state);
  url.searchParams.set("nonce", request.nonce);
  url.searchParams.set(
    "code_challenge",
    codeChallengeFor(request.codeVerifier),
  );
  url.searchParams.set("code_challenge_method", "S256");

  return url.toString();
};
