export {
  OIDC_SCOPES,
  buildAuthorizationUrl,
  codeChallengeFor,
  createAuthorizationRequest,
} from "./authorization.js";
export {
  FAKE_AUTHORIZATION_ENDPOINT,
  createFakeOidcProvider,
  type FakeOidcClaims,
  type FakeOidcProvider,
  type FakeOidcProviderDeps,
} from "./fake-oidc-provider.js";
export {
  GOOGLE_ISSUER,
  createGoogleOidcProvider,
  type GoogleOidcProviderDeps,
} from "./google-oidc-provider.js";
export type {
  OidcAuthorizationRequest,
  OidcExchangeInput,
  OidcExchangeResult,
  OidcFailureReason,
  OidcIdentity,
  OidcProvider,
} from "./oidc.types.js";
