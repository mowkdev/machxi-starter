import {
  TOKEN_TYPE,
  errorEnvelopeSchema,
  isErrorCode,
  type AcceptedResource,
  type AuthResource,
  type CsrfResource,
  type ErrorCode,
  type ErrorDetail,
  type ImpersonateBody,
  type LoginBody,
  type RegisterBody,
  type ResendVerificationBody,
  type VerifyEmailBody,
} from "@repo/contracts";
import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from "axios";

import {
  TRANSPORT_ERROR_CODE,
  apiClientError,
  genericCodeForStatus,
  isApiClientError,
  type ApiClientError,
} from "./api-error";
import { serializeListParams } from "./list-params";
import type { SessionStore } from "./session-store";

/**
 * The API client (ADR-0033): one axios instance, three interceptors, and the
 * two recovery paths that make a memory-only access token invisible to a user.
 *
 * Everything is a `create*` factory closing over its dependencies — ADR-0009's
 * rule carried across the HTTP boundary, and the reason the whole flow is
 * testable at the wire with no server (ADR-0036).
 */

/**
 * Duplicated from `apps/api/src/core/http/cookies.ts`, deliberately.
 *
 * They cannot be imported — an app does not import from another app — and they
 * do not move to `@repo/contracts`, because ADR-0029 §Contracts made them
 * constants-not-configuration on the API side and that ADR is frozen. The
 * duplication is safe for the same reason: these names change only by
 * superseding ADR-0029, at which point ADR-0033 is revisited with it.
 */
export const CSRF_HEADER = "X-CSRF-Token";
export const TRANSPORT_HEADER = "X-Auth-Transport";

/** See `createApiClient` for why this exists at all. */
const REQUEST_TIMEOUT_MS = 15_000;

/** The exact set `core/middleware/csrf.ts` guards (ADR-0029 §CSRF). */
const CSRF_GUARDED_PATHS = [
  "/auth/refresh",
  "/auth/logout",
  "/auth/logout-all",
];

/**
 * The endpoints that opt into cookie transport (ADR-0029 §Opt-in).
 *
 * **`/auth/impersonate` joined at `D13.7`, and without it the feature does not
 * work at all.** The exchange sets the user population's cookies "exactly as
 * login does — on ADR-0029's transport opt-in, never unconditionally"
 * (ADR-0057 §3), so a client that omits the header is handed an access token
 * and no refresh cookie: the impersonated session looks alive until the first
 * reload, at which point the boot sequence has nothing to refresh from and the
 * operator lands on the sign-in screen. It is a header, not a fix — the
 * omission is invisible in every response.
 *
 * **`/auth/register` joined at `D15.6`, and for login's reason exactly**
 * (ADR-0067 §6): registration answers with login's body and creates a session
 * (`AuthResource`, ADR-0018), and the API decides where the refresh token
 * travels from this header alone (`auth.transport.ts`). Without it a newly
 * registered customer is handed an access token and no refresh cookie — signed
 * in until the first reload, and then back on the sign-in screen with an
 * account they have just created.
 */
const COOKIE_TRANSPORT_PATHS = [
  "/auth/login",
  "/auth/refresh",
  "/auth/impersonate",
  // `/auth/register` was here until ADR-0071 §3 and is deliberately gone: the
  // header exists to move a refresh token into a cookie, and registration now
  // issues no token at all. It joins the confirmation call at the step that
  // adds one, which is the request that really does start a session.
  /*
   * And that is this one. `verify-email` answers **login's body** (ADR-0071
   * §3) — the person has just proven the address and the device that opened
   * the link is signed in — so it needs the header for login's own reason:
   * without it the API puts the refresh token in the body and sets no cookie
   * (ADR-0029 §Opt-in), and the account is signed in until the first reload
   * and then back on the sign-in screen, having spent the one link it had.
   */
  "/auth/verify-email",
];

/**
 * The endpoints whose credential is in the body, so the bearer has no business
 * on them (`D13.7`, out of `security-reviewer`'s first finding).
 *
 * Both routes register **before** their segment's `authenticate` and neither
 * reads `ctx.principal`: login's credential is the password and the exchange's
 * is the handoff token (ADR-0057 §3). Until now the request interceptor
 * attached `Authorization` to every request the store had a token for, which
 * meant an operator arriving at `/impersonate` with a real customer session
 * already in this browser — the case ADR-0057 §3 decides explicitly, and the
 * one this app has a test for — posted that session's access token on a
 * request that has no use for it.
 *
 * Not exploitable against this API, which is why it is a MEDIUM and not more:
 * the route mounts no guard, so the header is read by nothing. What it is is a
 * live credential sent where it is not needed, on the one endpoint in the
 * system whose whole design is about not touching the session already in the
 * browser — and `redeemHandoff`'s own comment claims "nothing in the store is
 * read on the way out", which was false by one line.
 *
 * `/auth/register` is the third (`D15.6`): it is mounted on the `public`
 * segment behind no guard at all, its credential is the password in the body,
 * and the one screen that calls it sits behind the `_auth` layout — so a store
 * holding a token there would mean a session is already live, and posting it
 * on a request that reads no principal is the same needless send.
 */
/*
 * The verification pair are the fourth and fifth, and they join for the reason
 * the exchange did rather than registration's (ADR-0071 §3). `verify-email`'s
 * credential is the token out of the URL fragment and every way it can fail
 * answers one indistinguishable `401`; `resend-verification` has no credential
 * at all and answers `202` to everything. Both are mounted on the public
 * segment behind no guard, so a bearer sent on either is a live session
 * credential travelling where nothing reads it — and on `verify-email` that
 * bearer would belong to whoever already had this browser, on the one request
 * whose whole job is to replace them.
 */
const UNAUTHENTICATED_PATHS = [
  "/auth/login",
  "/auth/impersonate",
  "/auth/register",
  "/auth/verify-email",
  "/auth/resend-verification",
];

/**
 * The codes that end a session and are never retried (ADR-0033 §Boot, amended
 * D3.2). Three, not four: `CSRF_TOKEN_INVALID` was here and is recoverable now
 * that ADR-0030's bootstrap echoes rather than rotates.
 */
export const TERMINAL_AUTH_CODES = [
  "AUTH_REFRESH_REUSED",
  "AUTH_SESSION_REVOKED",
  "AUTH_ACCOUNT_DISABLED",
] as const satisfies readonly ErrorCode[];

export const isTerminalAuthCode = (code: ErrorCode): boolean =>
  (TERMINAL_AUTH_CODES as readonly ErrorCode[]).includes(code);

/** Flags axios attaches to a request so a retry cannot become a loop. */
interface RetryFlags {
  /** Set once a `401` has already been answered with a refresh. */
  retriedAfterRefresh?: boolean;
  /** Set once a `403 CSRF_TOKEN_INVALID` has already re-bootstrapped. */
  retriedAfterCsrf?: boolean;
}

type RetryableConfig = InternalAxiosRequestConfig & RetryFlags;

const pathOf = (config: AxiosRequestConfig): string => config.url ?? "";

const matches = (
  paths: readonly string[],
  config: AxiosRequestConfig,
): boolean => paths.some((path) => pathOf(config).startsWith(path));

/**
 * Translates whatever axios rejected with into the one client failure type.
 *
 * A response with an error envelope becomes its `code`; anything else — no
 * response at all, HTML from a proxy, a body that is not an envelope — becomes
 * `TRANSPORT_ERROR_CODE`, because callers must never have to ask whether a
 * failure arrived with an envelope.
 *
 * An envelope carrying a code *this build* does not know is the third case,
 * and since `D13.1` it is on the envelope side of that line: it degrades to
 * the generic code of the status that carried it (ADR-0057 §Consequences),
 * never to the transport code. Codes are additive (ADR-0015), so an older
 * bundle meeting a newer API is the ordinary case, not the exotic one.
 */
const toApiClientError = (error: unknown): ApiClientError => {
  if (!axios.isAxiosError(error)) {
    return apiClientError({
      status: 0,
      code: TRANSPORT_ERROR_CODE,
      message: error instanceof Error ? error.message : "Request failed",
    });
  }

  const { response } = error;
  // Parsed rather than duck-typed: the wire can hand back anything, and
  // `errorEnvelopeSchema` is the contract's own statement of what an error
  // looks like (ADR-0023). A body that does not match is not an envelope, and
  // saying so here is what keeps the `code` field trustworthy downstream.
  const envelope = errorEnvelopeSchema.safeParse(response?.data);

  if (response && envelope.success) {
    const { error: apiError } = envelope.data;

    /*
     * Rebuilt key by key rather than passed through. Zod infers an optional
     * field as `string | undefined`, and `exactOptionalPropertyTypes`
     * (ADR-0002) treats that as different from an absent one — so a
     * parsed detail is not assignable to the hand-written `ErrorDetail` that
     * `@repo/contracts` publishes. Omitting the absent keys is what makes the
     * two descriptions of the same wire shape agree.
     */
    const details: ErrorDetail[] | undefined = apiError.details?.map(
      (detail) => ({
        message: detail.message,
        ...(detail.path === undefined ? {} : { path: detail.path }),
        ...(detail.code === undefined ? {} : { code: detail.code }),
      }),
    );

    /*
     * **A degraded code carries no `details`** — the second half of the
     * `D13.1` fix, and the one a review found. `@repo/form`'s
     * `applyServerErrors` decides whether a wire `details[]` may be written
     * onto form fields with one test, `code === "VALIDATION_ERROR"`, and that
     * gate exists (its own comment, `D3.9`'s review) to keep a sentence
     * written for a developer off an operator's screen. Synthesising
     * `VALIDATION_ERROR` for a `400` this build cannot name would hand that
     * gate a key it was never given: the code is *ours*, not the server's, so
     * the details behind it are not the field rules the gate assumes.
     *
     * Dropping them costs nothing a caller can use — a code we cannot name is
     * a code whose `details` we cannot interpret either.
     */
    // Bound to a local so the guard narrows it: `isErrorCode` is a type
    // predicate, and TypeScript carries an aliased condition through a `const`
    // reference but not through a property read it cannot prove stable.
    const wireCode = apiError.code;
    const known = isErrorCode(wireCode);

    return apiClientError({
      status: response.status,
      code: known ? wireCode : genericCodeForStatus(response.status),
      message: apiError.message,
      ...(known && details ? { details } : {}),
    });
  }

  return apiClientError({
    status: response?.status ?? 0,
    code: TRANSPORT_ERROR_CODE,
    message: error.message,
  });
};

/**
 * Which API segment this client is pinned to (ADR-0015, ADR-0051).
 *
 * The segment is the whole of the population difference at this layer: an
 * `admin` client talks to `/api/v1/admin` and a `user` client to
 * `/api/v1/user`, and everything else in this package — the envelope, the
 * error map, the refresh single-flight, the CSRF bootstrap — is identical
 * because the API made it identical (ADR-0013, ADR-0029).
 *
 * A union rather than a free string: the two segments are decided
 * (ADR-0017's two populations) and a typo would otherwise produce a client
 * that 404s every call.
 */
export type ApiSegment = "admin" | "user";

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
  const instance: AxiosInstance = axios.create({
    // One segment and nothing wider (ADR-0015): a path that escapes the
    // segment is a bug the base URL makes impossible to write by accident.
    // Which segment is the caller's (ADR-0051) — the rule is unchanged, only
    // the constant became a parameter.
    baseURL: `${baseUrl}/api/v1/${segment}`,
    // The refresh cookie travels on /auth/refresh and the CSRF cookie on
    // everything; a credentialed cross-origin request is the entire point of
    // `cors({ credentials: true })` on the API side.
    withCredentials: true,
    /*
     * axios has no default timeout, so a connection that is accepted and never
     * answered hangs forever — and during the boot sequence that means the
     * loading gate waits forever too, which is a spinner that never resolves
     * into either the app or the unreachable screen. A ceiling turns that into
     * a rejection the gate can report.
     *
     * Fifteen seconds is well past any healthy response (the API's own slowest
     * path is an argon2 hash at ~130ms) and well inside an operator's patience.
     * It bounds the wait; it does not cancel the work the server may already
     * have done.
     */
    timeout: REQUEST_TIMEOUT_MS,
    /*
     * Pinned here so no call site ever builds a query string by hand (ADR-0043
     * §List state). axios's default serializer would write
     * `filter[0][field]=...` for the parsed filter array, which
     * `listQuerySchema` rejects; the language's own form is
     * `filter[status][in]=a,b`, and since `D5.1` it has exactly one writer —
     * `@repo/contracts`' `stringifyListSearch`, which also spells the address
     * bar, so this request and that URL are the same string.
     */
    paramsSerializer: serializeListParams,
  });

  instance.interceptors.request.use((requestConfig) => {
    /*
     * `baseURL` only applies to a relative path, so an absolute one escapes
     * every rule below it at once: it would carry the bearer and, with
     * `withCredentials`, the cookies to an origin this app has no business
     * talking to, and it would silently miss `CSRF_GUARDED_PATHS` — a
     * `/auth/refresh` written absolutely would lose its CSRF header while
     * keeping its token. Nothing constructs URLs from server data today; this
     * is the fence that keeps that true as features accrue.
     */
    if (
      /^[a-z][a-z0-9+.-]*:/i.test(pathOf(requestConfig)) ||
      pathOf(requestConfig).startsWith("//")
    ) {
      throw apiClientError({
        status: 0,
        code: TRANSPORT_ERROR_CODE,
        message: "Absolute URLs are not allowed on the API client",
      });
    }

    /*
     * The same fence, on the key the same value can arrive by (`D15.6`, out of
     * `security-reviewer`).
     *
     * `register` establishes a per-request `baseURL` override as a supported
     * pattern — it is how the one call that leaves its segment reaches
     * `/api/v1/public` — and a `baseURL` *is* an absolute URL, entering by a
     * field the test above never reads. Everything the check above is written
     * to prevent would come back through it: the cookies and, off
     * {@link UNAUTHENTICATED_PATHS}, the bearer, sent to an origin this app has
     * no business talking to. Nothing builds one from server data today; this
     * keeps that true as the override gets a second caller.
     */
    if (
      requestConfig.baseURL !== undefined &&
      !requestConfig.baseURL.startsWith(`${baseUrl}/api/v1/`)
    ) {
      throw apiClientError({
        status: 0,
        code: TRANSPORT_ERROR_CODE,
        message: "A request may not leave this API client's own base URL",
      });
    }

    const accessToken = store.getAccessToken();
    const csrfToken = store.getCsrfToken();

    if (
      accessToken !== null &&
      !matches(UNAUTHENTICATED_PATHS, requestConfig)
    ) {
      requestConfig.headers.set(
        "Authorization",
        `${TOKEN_TYPE} ${accessToken}`,
      );
    }

    // Only on the three endpoints the guard actually covers. Attaching it more
    // widely would leak nothing but would misstate the contract.
    if (csrfToken !== null && matches(CSRF_GUARDED_PATHS, requestConfig)) {
      requestConfig.headers.set(CSRF_HEADER, csrfToken);
    }

    if (matches(COOKIE_TRANSPORT_PATHS, requestConfig)) {
      requestConfig.headers.set(TRANSPORT_HEADER, "cookie");
    }

    return requestConfig;
  });

  const endSession = (): void => {
    store.clear();
    onSessionEnded?.();
  };

  /**
   * Ends the session unless the recovery attempt simply never got an answer.
   *
   * `status: 0` is a dropped connection, a captive portal, a DNS failure —
   * no evidence at all about the session, whose refresh cookie is still good
   * and whose server-side row is untouched. Logging the operator out over it
   * costs them their in-flight work to fix nothing, and a forced logout is a
   * real availability bug rather than a safe default.
   */
  const endSessionUnlessOffline = (failure: unknown): void => {
    if (isApiClientError(failure) && failure.status === 0) return;
    endSession();
  };

  /*
   * Single-flight refresh: one shared in-flight promise, and every request that
   * meets a `401` while it is pending queues behind the *same* one.
   *
   * Without it a dashboard that fires five requests on mount turns one expired
   * token into five concurrent refreshes — and refresh rotates (ADR-0018), so
   * four of them replay a just-rotated token. Inside the grace window that is
   * tolerated; outside it, it is reuse detection and the session is revoked.
   * The client must not be a machine for triggering its own reuse alarm.
   */
  let inflightRefresh: Promise<void> | null = null;

  const runRefresh = async (): Promise<void> => {
    const { data } = await instance.post<{ data: AuthResource }>(
      "/auth/refresh",
      {},
    );
    const resource = data.data;

    store.setSession({
      accessToken: resource.accessToken,
      principal: resource.principal,
      ...(resource.csrfToken ? { csrfToken: resource.csrfToken } : {}),
    });
  };

  const refreshSession = (): Promise<void> =>
    (inflightRefresh ??= runRefresh().finally(() => {
      inflightRefresh = null;
    }));

  /**
   * Signs in and hydrates the store.
   *
   * It lives here rather than in the login feature for the same reason
   * `refreshSession` does: this response's whole purpose is to start a session,
   * and the module that owns the session's memory is the one that should write
   * it. A feature that hydrated the store itself would be a second writer.
   *
   * The request interceptor has already asked for cookie transport, so
   * `refreshToken` is absent from the body by design and `csrfToken` is
   * present (ADR-0029 §Opt-in).
   */
  const login = async (credentials: LoginBody): Promise<AuthResource> => {
    const { data } = await instance.post<{ data: AuthResource }>(
      "/auth/login",
      credentials,
    );
    const resource = data.data;

    store.setSession({
      accessToken: resource.accessToken,
      principal: resource.principal,
      ...(resource.csrfToken ? { csrfToken: resource.csrfToken } : {}),
    });

    return resource;
  };

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

  /**
   * Registers an account (`D15.6`, ADR-0067 §6; ADR-0071 §3 for the answer).
   *
   * **It starts no session, and that is the point.** Registration answered
   * `201` with login's body until ADR-0071 §3; it now answers `202` and issues
   * nothing, because an address nobody has proven is not an account anybody
   * may be signed into. What signs a device in is the confirmation link, which
   * arrives in a mailbox and lands on the app's own confirmation route — whose
   * client call belongs to the step that builds that screen.
   *
   * So this writes **nothing** to the store, and writing nothing is the whole
   * of the change. Hydrating from a `202` would put `undefined` where the
   * access token and the principal go, which is not "no session" but a broken
   * one — a shape the boot sequence has no branch for, on a client that would
   * then believe it was signed in.
   *
   * It still lives here, beside `login`, because the segment rule below is
   * about this package's own memory and is unchanged by the answer.
   *
   * **The first call in this package that left its segment, and it says so in
   * one place.** Registration is mounted on `/api/v1/public` (ADR-0015): it is
   * the endpoint for somebody who has no population yet, so it cannot live
   * under `/user`, and the base URL this client is pinned to would send it to
   * a path that does not exist. The override is per request and the path stays
   * relative, so the path-keyed rules still apply — the CSRF list and
   * {@link COOKIE_TRANSPORT_PATHS} match on the request's own `url` rather
   * than on the resolved address — and the override itself is fenced to this
   * client's own host by the interceptor, which grew that check for this call
   * (`D15.6`, `security-reviewer`). ADR-0071 §3's confirmation pair are the
   * second and third, on the same override.
   *
   * **A `user`-segment call, refused on any other client** — see
   * {@link requireUserSegment}, which is where this file reads its own
   * segment. Unlike `redeemHandoff`,
   * which is a `404` by construction because the API registers that route on
   * one segment only, this endpoint is public by design and would answer
   * anybody. What would be wrong is not the request but the write — a `user`
   * principal hydrated into the store an admin app's guards read — and the
   * server has nothing to say about it, so the check has to be here. It is a
   * guard on **this client's own population**, which this factory was handed,
   * rather than a second opinion about the API's.
   *
   * The endpoint exists only when `FEATURE_USER_REGISTRATION` is on; with it
   * off the path answers `404 ROUTE_NOT_FOUND` rather than a `403` that would
   * confirm the feature (ADR-0004), and that code reaches the caller as any
   * other refusal does.
   */
  const register = async (body: RegisterBody): Promise<void> => {
    requireUserSegment("Registration");

    await instance.post<{ data: AcceptedResource }>("/auth/register", body, {
      baseURL: publicBaseUrl,
    });
  };

  /**
   * Turns a confirmation link into a session (ADR-0071 §3).
   *
   * **`register`'s other half, and the one that actually signs a device in.**
   * The endpoint consumes the single-use token, makes the account `active`
   * with its address stamped proven, and answers **login's body** — so this
   * writes the store for `login`'s own reason: the module that owns the
   * session's memory is the one that writes it, and a feature that hydrated it
   * would be a second writer of the state this package exists to keep to one.
   * The `/verify-email` screen therefore hands over a token and gets an
   * `AuthResource` back, exactly as the sign-in form does.
   *
   * The token is the credential and the request is unauthenticated, which
   * {@link UNAUTHENTICATED_PATHS} makes true rather than merely states: a
   * browser that already holds somebody's session must not put that bearer on
   * the one request whose whole job is to replace it. The request interceptor
   * has asked for cookie transport ({@link COOKIE_TRANSPORT_PATHS}), so
   * `refreshToken` is absent from the response and `csrfToken` is present
   * (ADR-0029 §Opt-in) — the same shape login gets, and without it the account
   * is signed in until the first reload with its one link already spent.
   *
   * Every way it can fail answers one indistinguishable `401` (ADR-0071 §3),
   * so there is nothing here to branch on and it does not try to. The store is
   * written only on success: a refused confirmation leaves whatever session
   * the browser had exactly as it was, rather than half-writing over it.
   *
   * **A `user`-segment call for `register`'s reason exactly**, and refused on
   * any other client. The route is mounted on `/api/v1/public` and would
   * answer anybody; what would be wrong is the *write* — a `user` principal
   * hydrated into the store an admin app's guards read — and the server has
   * nothing to say about it, so the check has to be here.
   */
  const verifyEmail = async (token: string): Promise<AuthResource> => {
    requireUserSegment("Address verification");

    const body: VerifyEmailBody = { token };
    const { data } = await instance.post<{ data: AuthResource }>(
      "/auth/verify-email",
      body,
      { baseURL: publicBaseUrl },
    );
    const resource = data.data;

    store.setSession({
      accessToken: resource.accessToken,
      principal: resource.principal,
      ...(resource.csrfToken ? { csrfToken: resource.csrfToken } : {}),
    });

    return resource;
  };

  /**
   * Asks for the confirmation link again (ADR-0071 §3).
   *
   * **No segment guard, and its absence is the decision.** The two guards
   * above are about this package's *memory* — they exist because a `user`
   * principal must not be hydrated into an admin app's store — and this call
   * writes nothing at all. It answers `202` for every address, known or not
   * (ADR-0020 §Enumeration), so there is no resource to be handed to the wrong
   * client either. Guarding it would be a check with no failure to prevent.
   *
   * The locale travels in the body because no account is known to be acting:
   * the answer must not depend on whether an address has one, so the server
   * cannot look up a stored locale to write in (ADR-0071 §2, ADR-0046).
   */
  const resendVerification = async (
    body: ResendVerificationBody,
  ): Promise<void> => {
    await instance.post<{ data: AcceptedResource }>(
      "/auth/resend-verification",
      body,
      { baseURL: publicBaseUrl },
    );
  };

  /**
   * Redeems an impersonation handoff token for a session (`D13.7`,
   * ADR-0057 §3, §7).
   *
   * **It lives here, beside `login`, for `login`'s own reason**: this
   * response's whole purpose is to start a session, and the module that owns
   * the session's memory is the one that writes it. A feature that hydrated
   * the store itself would be a second writer of the state this package keeps
   * to one — the rule the D3.9 review wrote down and `useSetPrincipal` is the
   * single narrow exception to. The `/impersonate` screen therefore hands over
   * a token and gets an `AuthResource` back, exactly as the sign-in form does.
   *
   * The token is the credential and the request is unauthenticated, so nothing
   * in the store is read on the way out — which is true because
   * {@link UNAUTHENTICATED_PATHS} makes it true, and was false by one line
   * until `D13.7`'s review. The request interceptor has already asked for
   * cookie transport, so `refreshToken` is absent from the response and
   * `csrfToken` is present (ADR-0029 §Opt-in) — the same shape login gets.
   *
   * **On an `admin`-segment client this function is a `404` by construction**,
   * and that is the server's property rather than a check here: `auth.routes.ts`
   * registers the route only when the factory's population is `user`, because
   * an admin-segment twin would be a way to turn a URL fragment into a staff
   * session (ADR-0057 §3). A guard on `segment` in this file would be a second
   * implementation of a rule the authority already enforces, and the weaker of
   * the two; it is named here so a reader does not conclude the symbol's
   * presence on both clients means the endpoint exists on both.
   *
   * Every failure the endpoint has answers one indistinguishable `401`
   * (ADR-0057 §3), which is a code an already-shipped bundle renders without
   * any change; there is nothing for this function to branch on, and it does
   * not try to.
   *
   * The store is written only on success. A refused exchange leaves whatever
   * session the browser already had exactly as it was — the pre-existing real
   * customer session ADR-0057 §3 declines to disturb — rather than half-writing
   * an identity over it.
   */
  const redeemHandoff = async (token: string): Promise<AuthResource> => {
    const body: ImpersonateBody = { token };
    const { data } = await instance.post<{ data: AuthResource }>(
      "/auth/impersonate",
      body,
    );
    const resource = data.data;

    store.setSession({
      accessToken: resource.accessToken,
      principal: resource.principal,
      ...(resource.csrfToken ? { csrfToken: resource.csrfToken } : {}),
    });

    return resource;
  };

  /**
   * Ends the session on the server, then locally.
   *
   * The local clear is unconditional, including when the request fails: a
   * client that cannot reach the API must still end what it controls, and the
   * server-side session — unreachable in that moment — dies at its TTL or at
   * reuse detection, which is the best an offline logout can do (ADR-0033).
   */
  const logout = async (): Promise<void> => {
    try {
      await instance.post("/auth/logout");
    } finally {
      endSession();
    }
  };

  /** ADR-0030's bootstrap: the one call that cannot itself need a CSRF token. */
  const fetchCsrfToken = async (): Promise<string> => {
    const { data } = await instance.get<{ data: CsrfResource }>("/auth/csrf");

    store.setSession({ csrfToken: data.data.csrfToken });
    return data.data.csrfToken;
  };

  instance.interceptors.response.use(
    // `204` resolves to `undefined` by decision — logout and deletes have no
    // body. Otherwise the envelope is kept whole: ADR-0014's `meta.pagination`
    // exists so a table can render its own state without re-parsing its query,
    // and unwrapping lists to a bare array would force every table to rebuild
    // what the server already said.
    (response) => {
      // `204` carries no body, and axios leaves `data` as `""`. Making it
      // `undefined` is ADR-0033 §Response translation's rule and stops a caller
      // from reading an empty string as though it were a resource.
      if (response.status === 204) response.data = undefined;
      return response;
    },
    async (error: unknown) => {
      const failure = toApiClientError(error);
      const requestConfig = axios.isAxiosError(error)
        ? (error.config as RetryableConfig | undefined)
        : undefined;

      if (!requestConfig) throw failure;

      const isRefresh = pathOf(requestConfig).startsWith("/auth/refresh");
      const isLogin = pathOf(requestConfig).startsWith("/auth/login");
      /*
       * The bootstrap is the third "never recurse on this" endpoint, and the
       * retry flags cannot bound it: `fetchCsrfToken` builds a *fresh* config
       * each time, so the flag is always unset. A `403` on `/auth/csrf` would
       * recurse without limit, and a `401` on it raised from inside a refresh's
       * own retry would await `inflightRefresh` — the promise it is
       * running inside — and deadlock the boot gate. Neither is reachable
       * from this API (the route is unauthenticated and unguarded), but a proxy
       * or edge auth in front of it can answer either.
       */
      const isCsrf = pathOf(requestConfig).startsWith("/auth/csrf");
      /*
       * The fourth, and it joins the list for `login`'s reason rather than the
       * bootstrap's (`D13.7`, ADR-0057 §3).
       *
       * The exchange is **unauthenticated** — the handoff token is the whole
       * credential — and every way it can fail answers one indistinguishable
       * `401`. Left off this list, a refused exchange would be read as an
       * expired access token: the client would fire a refresh nobody asked
       * for, and on the ordinary path — an operator with no customer session
       * in this browser — that refresh answers `401` too, so the caller is
       * rejected with the *refresh's* failure instead of the exchange's and
       * `endSession` fires over a session that never existed. A dead handoff
       * is not staleness, and there is nothing to retry it with.
       */
      /**
       * The whole of {@link UNAUTHENTICATED_PATHS}, read rather than
       * re-enumerated (`D15.6`, out of both reviewers finding the same thing).
       *
       * `isLogin` and `isImpersonate` used to be spelled out here and happened
       * to be that list; `/auth/register` joined the list and did **not** join
       * this test, which is the divergence a second enumeration always
       * eventually has. The property is one property — a route whose
       * credential is in the body has no access token to have expired — so it
       * is asked once, of the list that states it.
       *
       * Not reachable from this API for registration, exactly as `isCsrf`'s
       * comment says of its own path: the public router mounts no guard, so
       * the API cannot answer `401` there. A proxy, a WAF or edge auth in
       * front of it can, and then an anonymous visitor on `/register` would
       * fire a refresh nobody asked for, be signed out of a session they never
       * had, and read the refresh's sentence over their sign-up.
       */
      const isUnauthenticatedRoute = matches(
        UNAUTHENTICATED_PATHS,
        requestConfig,
      );

      /*
       * A terminal code ends the session wherever it appears. These are the
       * dead-cookie states ADR-0029 §Consequences records: the server killed
       * the session but could not clear the browser's cookie, so retrying only
       * replays a dead thirty-day credential until it expires.
       */
      if (isTerminalAuthCode(failure.code) && !isLogin) {
        endSession();
        throw failure;
      }

      /*
       * `403 CSRF_TOKEN_INVALID` is recoverable, and only since D3.2: the
       * bootstrap echoes the cookie's current value instead of rotating it, so
       * a re-bootstrap presents something genuinely fresher. It happens with no
       * attacker in sight — one `__Host-machxi.csrf` at `Path=/` is shared by
       * every tab, so a login in a second tab strands this one's copy — and
       * ending the session over it would be a logout for no reason.
       *
       * Bounded to one attempt: a second `403` is not staleness (a shadowed
       * duplicate cookie survives any number of re-bootstraps) and ends it.
       */
      if (failure.code === "CSRF_TOKEN_INVALID" && !isCsrf) {
        if (requestConfig.retriedAfterCsrf) {
          // The retry presented the cookie's current value and was refused
          // anyway, so this is not staleness — a shadowed duplicate cookie
          // survives any number of re-bootstraps (ADR-0029: `readCookie` fails
          // closed on one). Terminal, which is where the D3.2 amendment put the
          // boundary between recoverable and not.
          endSession();
          throw failure;
        }

        requestConfig.retriedAfterCsrf = true;
        try {
          await fetchCsrfToken();
        } catch (bootstrapFailure) {
          endSessionUnlessOffline(bootstrapFailure);
          throw failure;
        }
        return instance.request(requestConfig);
      }

      /*
       * `401` means the access token died — fifteen minutes is the design — and
       * the client's job is to make that invisible.
       *
       * Refresh, the bootstrap and every route whose credential is in the body
       * never enter here: a `401` from refresh *is* the terminal answer, a
       * `401` from login is a wrong password, one from the exchange is a spent
       * or expired handoff, and one from registration is something in front of
       * the API rather than the API — none of them is an expired access token,
       * so recursing on any of them is a loop with no exit or a refresh with
       * nothing behind it. Each request retries at most once; a second `401`
       * after a fresh token is not staleness.
       */
      if (
        failure.status === 401 &&
        !isRefresh &&
        !isCsrf &&
        !isUnauthenticatedRoute
      ) {
        if (requestConfig.retriedAfterRefresh) {
          // A `401` carrying a token the refresh just minted is not staleness.
          // Retrying again is how an outage becomes a request storm, and
          // pretending the session is alive strands the operator on a screen
          // whose every request fails — so it ends here (ADR-0036 names
          // "a second 401 after retry" among the states that must land logged
          // out).
          endSession();
          throw failure;
        }

        requestConfig.retriedAfterRefresh = true;
        try {
          await refreshSession();
        } catch (refreshFailure) {
          endSessionUnlessOffline(refreshFailure);
          throw refreshFailure;
        }
        return instance.request(requestConfig);
      }

      // A `401` from refresh *is* the terminal answer (ADR-0033).
      if (failure.status === 401 && isRefresh) endSession();

      throw failure;
    },
  );

  return {
    instance,
    login,
    register,
    verifyEmail,
    resendVerification,
    redeemHandoff,
    logout,
    refreshSession,
    fetchCsrfToken,
    endSession,
  } as const;
};

export type ApiClient = ReturnType<typeof createApiClient>;
