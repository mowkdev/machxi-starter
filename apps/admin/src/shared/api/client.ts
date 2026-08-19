import {
  TOKEN_TYPE,
  errorEnvelopeSchema,
  type AuthResource,
  type CsrfResource,
  type ErrorCode,
  type ErrorDetail,
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

/** The endpoints that opt into cookie transport (ADR-0029 §Opt-in). */
const COOKIE_TRANSPORT_PATHS = ["/auth/login", "/auth/refresh"];

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

    return apiClientError({
      status: response.status,
      code: apiError.code,
      message: apiError.message,
      ...(details ? { details } : {}),
    });
  }

  return apiClientError({
    status: response?.status ?? 0,
    code: TRANSPORT_ERROR_CODE,
    message: error.message,
  });
};

export interface ApiClientDeps {
  readonly store: SessionStore;
  readonly baseUrl: string;
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
  onSessionEnded,
}: ApiClientDeps) => {
  const instance: AxiosInstance = axios.create({
    // The admin segment and nothing wider (ADR-0015): a path that escapes the
    // segment is a bug the base URL makes impossible to write by accident.
    baseURL: `${baseUrl}/api/v1/admin`,
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
     * Pinned here so no call site ever builds a query string by hand (ADR-0034
     * §List state). axios's default serializer would write
     * `filter[0][field]=...` for the parsed filter array, which
     * `listQuerySchema` rejects; the bracket form the API's Express parsing
     * consumes is `filter[status][in]=a,b`.
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

    if (accessToken !== null) {
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
       * Refresh and login never enter here: a `401` from refresh *is* the
       * terminal answer and a `401` from login is a wrong password, so
       * recursing on either is a loop with no exit. Each request retries at
       * most once; a second `401` after a fresh token is not staleness.
       */
      if (failure.status === 401 && !isRefresh && !isLogin && !isCsrf) {
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
    logout,
    refreshSession,
    fetchCsrfToken,
    endSession,
  } as const;
};

export type ApiClient = ReturnType<typeof createApiClient>;
