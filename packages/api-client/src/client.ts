import {
  TOKEN_TYPE,
  errorEnvelopeSchema,
  isErrorCode,
  type AuthResource,
  type CsrfResource,
  type ErrorCode,
  type ErrorDetail,
  type ImpersonateBody,
  type LoginBody,
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
 */
const COOKIE_TRANSPORT_PATHS = [
  "/auth/login",
  "/auth/refresh",
  "/auth/impersonate",
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
 */
const UNAUTHENTICATED_PATHS = ["/auth/login", "/auth/impersonate"];

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
      const isImpersonate =
        pathOf(requestConfig).startsWith("/auth/impersonate");

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
       * Refresh, login and the exchange never enter here: a `401` from refresh
       * *is* the terminal answer, a `401` from login is a wrong password, and
       * a `401` from the exchange is a spent or expired handoff — none of the
       * three is an expired access token, so recursing on any of them is a
       * loop with no exit or a refresh with nothing behind it. Each request
       * retries at most once; a second `401` after a fresh token is not
       * staleness.
       */
      if (
        failure.status === 401 &&
        !isRefresh &&
        !isLogin &&
        !isCsrf &&
        !isImpersonate
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
    redeemHandoff,
    logout,
    refreshSession,
    fetchCsrfToken,
    endSession,
  } as const;
};

export type ApiClient = ReturnType<typeof createApiClient>;
