import { TRANSPORT_ERROR_CODE, apiClientError } from "./api-error";
import type { FlowDeps } from "./flows/deps";
import { createGoogleFlows } from "./flows/google";
import { createInvitationFlows } from "./flows/invitation";
import { createRecoveryFlows } from "./flows/recovery";
import { createRegistrationFlows } from "./flows/registration";
import { createSignInFlows } from "./flows/sign-in";
import { createSessionLifecycle } from "./session-lifecycle";
import type { SessionStore } from "./session-store";
import {
  attachResponseInterceptor,
  createTransport,
  type ApiSegment,
} from "./transport";

/**
 * The API client (ADR-0033): one axios instance, three interceptors, and the
 * two recovery paths that make a memory-only access token invisible to a user.
 *
 * Everything is a `create*` factory closing over its dependencies — ADR-0009's
 * rule carried across the HTTP boundary, and the reason the whole flow is
 * testable at the wire with no server (ADR-0036).
 */

/*
 * **The composition root, since `D20.7`.** The file held all of it — the
 * instance, the interceptors, the session lifecycle and twelve flows — until
 * it passed the thousand lines the repo allows a source file. Nothing moved
 * out that a caller can see: `transport.ts` has the axios instance and its
 * interceptors, `session-lifecycle.ts` the refresh, the bootstrap and the end,
 * `flows/` the twelve calls grouped by the link or the credential they spend,
 * and this file wires them together and re-exports what `index.ts` publishes.
 * The order below is the order the original read in, for the same reason it
 * read in it: the instance exists before anything can request on it, and the
 * response interceptor is attached last because its two recovery paths are
 * themselves requests.
 */

export {
  CSRF_HEADER,
  TERMINAL_AUTH_CODES,
  TRANSPORT_HEADER,
  isTerminalAuthCode,
  type ApiSegment,
} from "./transport";

export interface ApiClientDeps {
  readonly store: SessionStore;
  readonly baseUrl: string;
  /**
   * The segment this client is pinned to — `apps/admin` passes `"admin"`,
   * the customer app will pass `"user"` (D12). No default: a client whose
   * segment is implicit is one whose population is a guess, and the app that
   * builds it is the only thing that knows.
   */
  readonly segment: ApiSegment;
  /**
   * Called when a session ends for good — a terminal code, or a retry that
   * failed again. The app turns this into "clear the store and show /login";
   * the client does not know what a route is.
   */
  readonly onSessionEnded?: () => void;
}

export const createApiClient = ({
  store,
  baseUrl,
  segment,
  onSessionEnded,
}: ApiClientDeps) => {
  const instance = createTransport({ store, baseUrl, segment });

  const {
    endSession,
    endSessionUnlessOffline,
    refreshSession,
    fetchCsrfToken,
  } = createSessionLifecycle({ instance, store, onSessionEnded });

  /**
   * Where the calls that have no population go (ADR-0015).
   *
   * One expression rather than three copies of the same template literal: it
   * is a base URL the request interceptor fences to this client's own host,
   * and a fence is worth having exactly one string to check.
   */
  const publicBaseUrl = `${baseUrl}/api/v1/public`;

  /**
   * The guard the two public calls that *write the store* share.
   *
   * Extracted at `D18.4` rather than copied: `register` had it alone, and the
   * property is one property — this client's store is pinned to one population
   * and a public endpoint will answer anybody, so the check has to be here and
   * has to say the same thing in both places.
   */
  const requireUserSegment = (what: string): void => {
    if (segment !== "user") {
      throw apiClientError({
        status: 0,
        code: TRANSPORT_ERROR_CODE,
        message: `${what} is a user-segment call`,
      });
    }
  };

  const deps: FlowDeps = {
    instance,
    store,
    segment,
    publicBaseUrl,
    requireUserSegment,
    endSession,
  };

  const { login, redeemHandoff, logout } = createSignInFlows(deps);
  const { register, verifyEmail, resendVerification, confirmEmail } =
    createRegistrationFlows(deps);
  const { lookupInvitation, acceptOnboarding } = createInvitationFlows(deps);
  const { forgotPassword, resetPassword } = createRecoveryFlows(deps);
  const { startGoogleSignIn, exchangeGoogleSignIn } = createGoogleFlows(deps);

  attachResponseInterceptor(instance, {
    endSession,
    endSessionUnlessOffline,
    refreshSession,
    fetchCsrfToken,
  });

  return {
    instance,
    login,
    register,
    verifyEmail,
    resendVerification,
    confirmEmail,
    lookupInvitation,
    forgotPassword,
    resetPassword,
    acceptOnboarding,
    startGoogleSignIn,
    exchangeGoogleSignIn,
    redeemHandoff,
    logout,
    refreshSession,
    fetchCsrfToken,
    endSession,
  } as const;
};

export type ApiClient = ReturnType<typeof createApiClient>;
