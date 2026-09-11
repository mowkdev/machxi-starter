import type { FederatedProvider } from "@repo/contracts";

import type { RequestContext } from "../context/index.js";

/**
 * The identity-provider port (ADR-0072 §2, in ADR-0066's shape).
 *
 * A seam, like the mail port: the sign-in flow composes against this, a real
 * adapter speaks OpenID Connect to Google, and a fake answers a scripted ID
 * token so the integration tier proves the whole flow but Google itself
 * against Postgres. No auth library stands behind it — discovery, PKCE and the
 * `jose` verification are this module's own.
 */

/**
 * What the start of a sign-in generates and keeps (ADR-0072 §2).
 *
 * All three are fresh `randomToken(32)` values per attempt, carried from the
 * start to the callback in the signed transaction cookie and nowhere else:
 * `state` binds the callback to the browser that started it, `nonce` binds
 * the ID token to this attempt, and `codeVerifier` is the PKCE secret whose
 * S256 challenge rides in the authorization URL — so an intercepted
 * authorization code is useless without it.
 */
export interface OidcAuthorizationRequest {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
}

/**
 * The person the provider vouched for, read out of a **verified** ID token.
 *
 * Only what ADR-0072 §1 resolves by: the stable subject, the address and
 * whether the provider says it is verified, and the two names a created
 * account takes. `email` is `undefined` when the token carries none, or one
 * that is not an address; `emailVerified` is `true` only for the claim's
 * literal truth, so an absent or ambiguous claim never matches an account and
 * never creates one.
 */
export interface OidcIdentity {
  readonly subject: string;
  readonly email: string | undefined;
  readonly emailVerified: boolean;
  /**
   * Whether the provider is **authoritative** for the address — it hosts the
   * mailbox, so "verified" means "controls it now" rather than "controlled it
   * once" (ADR-0072 §1, amended at `D19.1`).
   *
   * Never `true` without {@link emailVerified}. For Google: a `gmail.com` or
   * `googlemail.com` address, or a Workspace one whose `hd` claim is the
   * address's own domain. Any other address Google verified only when the
   * Google account was created, and the mailbox may have changed hands since —
   * which is why linking to an existing account by address reads this, and
   * not `emailVerified`.
   */
  readonly emailAuthoritative: boolean;
  readonly givenName: string | undefined;
  readonly familyName: string | undefined;
}

/**
 * Why an exchange produced no identity. Logged by the adapter, never shown to
 * a person — the callback turns any of them into one `#error=` code — and
 * named so a log line can tell a provider outage from a forged token.
 *
 * - `provider_unreachable` — discovery, the token endpoint or the key set did
 *   not answer, or answered with something that is not what the protocol says.
 * - `code_rejected` — the token endpoint refused the code: spent, expired, or
 *   presented with the wrong PKCE verifier or redirect URI.
 * - `id_token_invalid` — the signature, `iss`, `aud`, `exp` or algorithm did
 *   not verify.
 * - `nonce_mismatch` — a valid token minted for a different attempt.
 * - `claims_invalid` — a valid token without a usable subject, or whose
 *   authorized party is not this client.
 */
export type OidcFailureReason =
  | "provider_unreachable"
  | "code_rejected"
  | "id_token_invalid"
  | "nonce_mismatch"
  | "claims_invalid";

export type OidcExchangeResult =
  | { readonly ok: true; readonly identity: OidcIdentity }
  | { readonly ok: false; readonly reason: OidcFailureReason };

export interface OidcExchangeInput {
  /** The authorization code from the callback's query. */
  readonly code: string;
  /** The PKCE verifier the start generated, read back out of the transaction cookie. */
  readonly codeVerifier: string;
  /** The nonce the start generated; the ID token must carry exactly this. */
  readonly nonce: string;
}

export interface OidcProvider {
  /** Which `FEDERATED_PROVIDERS` value an identity from this adapter is stored under. */
  readonly id: FederatedProvider;
  /**
   * Where to send the browser: the provider's authorization endpoint with the
   * client, the redirect URI, the scopes, `state`, `nonce` and the S256 PKCE
   * challenge of `codeVerifier` — never the verifier itself.
   *
   * Rejects when the provider's metadata cannot be loaded: there is no URL to
   * give, and the start is an XHR whose caller can be told so.
   */
  readonly authorizationUrl: (
    ctx: RequestContext,
    request: OidcAuthorizationRequest,
  ) => Promise<string>;
  /**
   * Redeems the code at the token endpoint and verifies the ID token it
   * returns. **Never rejects**: every failure is a value, because the caller
   * is a browser navigation that answers every refusal the same way
   * (`302 …#error=<code>`, ADR-0072 §2) and a thrown error there would be a
   * JSON 500 on a bare page.
   */
  readonly exchangeCode: (
    ctx: RequestContext,
    input: OidcExchangeInput,
  ) => Promise<OidcExchangeResult>;
}
