export {
  accountDisabled,
  currentPasswordInvalid,
  emailUnverified,
  federatedHandoffInvalid,
  federatedLinkRequired,
  federatedSignupClosed,
  identityTaken,
  impersonationHandoffInvalid,
  impersonationRefused,
  invalidCredentials,
  lastCredential,
  invalidRefreshToken,
  refreshReused,
  registrationConflict,
  sessionRevoked,
  tokenExpired,
  tokenInvalid,
  verificationLinkInvalid,
} from "./auth.errors.js";
export {
  createImpersonationController,
  type ImpersonationController,
  type ImpersonationControllerDeps,
} from "./auth.impersonation.controller.js";
export {
  createHandoffsRepository,
  type ConsumedHandoff,
  type ConsumeHandoffInput,
  type HandoffsRepository,
  type NewHandoffInput,
} from "./auth.impersonation.repository.js";
export {
  exchangeImpersonationSchema,
  mintImpersonationSchema,
} from "./auth.impersonation.schemas.js";
export {
  MAX_HANDOFF_USER_AGENT_LENGTH,
  createImpersonationService,
  type ImpersonationService,
  type ImpersonationServiceDeps,
  type ImpersonationTargets,
} from "./auth.impersonation.service.js";
export {
  applyAuthTransport,
  type AuthTransportOptions,
} from "./auth.transport.js";
export {
  DEFAULT_QUEUE_FACTOR,
  createHashLimiter,
  type HashLimiter,
  type HashLimiterOptions,
} from "./auth.hash-limiter.js";
export {
  toAuthResource,
  type IssuedAuthResource,
  toStaffPrincipalResource,
  toUserPrincipalResource,
} from "./auth.mapper.js";
export {
  createAuthCookies,
  readTransport,
  type AuthCookies,
  type AuthTransport,
  type RefreshCookieInput,
} from "./auth.cookies.js";
export {
  createAuthenticate,
  createRefuseImpersonated,
  readBearerToken,
  type Authenticate,
  type AuthenticateDeps,
} from "./auth.middleware.js";
export {
  createFederatedAccounts,
  createStaffPrincipalAdapter,
  createUserPrincipalAdapter,
} from "./auth.principals.js";
export {
  createSessionsRepository,
  type EndedImpersonation,
  type RevokeAllImpersonatedByInput,
  type SessionRecord,
  type SessionsRepository,
} from "./auth.repository.js";
export {
  FEDERATED_LANDING_PATH,
  createFederatedController,
  type FederatedController,
  type FederatedControllerDeps,
} from "./auth.federated.controller.js";
export {
  createFederatedSignInService,
  type FederatedCallbackInput,
  type FederatedCallbackOutcome,
  type FederatedSignInService,
  type FederatedSignInServiceDeps,
  type FederatedStart,
} from "./auth.federated.service.js";
export {
  federatedCallbackSchema,
  federatedExchangeSchema,
  federatedStartSchema,
} from "./auth.federated.schemas.js";
export {
  createAuthRouter,
  createFederatedRouter,
  createRegisterRouter,
  createVerificationRouter,
  type AuthRouterDeps,
  type FederatedRouterDeps,
  type RegisterRouterDeps,
  type VerificationRouterDeps,
} from "./auth.routes.js";
export {
  loginSchema,
  refreshSchema,
  registerSchema,
  resendVerificationSchema,
  verifyEmailSchema,
} from "./auth.schemas.js";
export { createAuthService, type AuthService } from "./auth.service.js";
export {
  MAX_USER_AGENT_LENGTH,
  REVOKE_REASONS,
  type AuthServiceDeps,
  type IssueImpersonatedSessionInput,
  type RefreshInput,
} from "./auth.types.js";
export {
  audienceFor,
  createTokenService,
  type AccessTokenClaims,
  type TokenService,
} from "./auth.tokens.js";
export {
  createAuthController,
  type AuthController,
  type AuthControllerDeps,
} from "./auth.controller.js";
export type {
  CreateFederatedPrincipalInput,
  CreatePrincipalInput,
  FederatedAccounts,
  LinkFederatedIdentityInput,
  MailablePrincipal,
  PrincipalAdapter,
  PrincipalRecord,
} from "./auth.types.js";
export { wireAuth, type WireAuthDeps } from "./wire.js";
