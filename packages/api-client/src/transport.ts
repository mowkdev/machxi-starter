import {
  TOKEN_TYPE,
  errorEnvelopeSchema,
  isErrorCode,
  type ErrorCode,
  type ErrorDetail,
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
  type ApiClientError,
} from "./api-error";
import { serializeListParams } from "./list-params";
import type { SessionStore } from "./session-store";

/**
 * The wire itself (ADR-0033): one axios instance and its two interceptors,
 * together with the path lists and the error translation they read.
 *
 * Split out of `client.ts` at `D20.7` and otherwise unchanged — the file had
 * grown past the thousand lines the repo's own rule allows, and the cut is the
 * one the code already had: the transport does not know what a flow is, and a
 * flow does not know what an interceptor is. `client.ts` still composes them,
 * and is still the only address either is reached through.
 *
 * The response interceptor is attached separately from the instance because
 * the two recovery paths it takes — {@link attachResponseInterceptor}'s
 * `refreshSession` and `fetchCsrfToken` — are themselves requests on this
 * instance. One factory that did both would have to close over functions that
 * do not exist yet; two steps say the dependency out loud instead.
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
  /*
   * And `onboarding/accept` (ADR-0071 §8), for `verify-email`'s reason
   * exactly: it answers **login's body** — the operator has chosen the
   * password the link was mailed for and the device is signed in — so without
   * the header the API puts the refresh token in the body and sets no cookie
   * (ADR-0029 §Opt-in). The account would be signed in until the first reload
   * and then back on the sign-in screen, having spent the one link it had.
   */
  "/auth/onboarding/accept",
  /*
   * And the Google exchange (ADR-0072 §2), for `verify-email`'s reason: it
   * answers **login's body** on whichever transport the caller asks for, so
   * without the header the refresh token comes back in the body, no cookie is
   * set, and a person who has just signed in through Google is signed out by
   * their first reload.
   */
  "/auth/google/exchange",
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
/*
 * The recovery pair are the sixth and seventh (ADR-0071 §4), and unlike every
 * name above them they are on **this client's own segment** — `forgot` and
 * `reset` sit beside their segment's `login`, registered before its
 * `authenticate` and reading no principal.
 *
 * `forgot` has no credential at all and answers `202` to everything;
 * `reset`'s credential is the token out of the URL fragment, and its every
 * refusal is one indistinguishable `401`. Both are reachable from a browser
 * that already holds somebody's session — a person may perfectly well ask for
 * a link while signed in, and the link is followed wherever the mail is read —
 * so without this a live bearer would travel on requests nothing reads it on.
 *
 * The `401` half matters more than the header half here: left off this list a
 * refused link would be read as an expired access token, and the client would
 * answer a dead token with a refresh nobody asked for — signing an anonymous
 * visitor "out" of a session they never had and painting the *refresh's*
 * sentence over the reset screen's own.
 */
/*
 * The invitation lookup is the eighth (ADR-0071 §5). It is mounted on the
 * **public** segment behind no guard, its credential is the token out of the
 * URL fragment, and it reads no principal — so a bearer sent on it is a live
 * session credential travelling where nothing looks at it. The screen that
 * calls it is reached by whoever opened the mail, which very often is a
 * browser already holding somebody's session: a person who is signed in as
 * themselves and has been invited under a second address, or a shared machine.
 *
 * Its refusal is a `404` rather than a `401`, so unlike the recovery pair it
 * cannot be mistaken for an expired access token and cannot provoke a refresh
 * nobody asked for. The entry is here for the send rather than for the answer.
 */
/*
 * The onboarding accept is the ninth (ADR-0071 §8), and it is on this list
 * for **both** halves of the argument the recovery pair make. It is registered
 * above the admin segment's `authenticate` and reads no principal, so a bearer
 * on it is a live credential going where nothing looks at it — and on the one
 * request whose whole job is to replace whoever already had this browser. And
 * its every refusal is one indistinguishable `401`: left off this list, a dead
 * link would be read as an expired access token, and the client would answer
 * it with a refresh nobody asked for — painting the refresh's sentence over
 * the onboarding screen's own.
 */
/*
 * The Google pair are the tenth and eleventh (ADR-0072 §2), both on the
 * **public** segment behind no guard. `start` has no credential at all — it
 * answers anybody with an authorization URL and a transaction cookie — and
 * `exchange`'s credential is the token out of the URL fragment together with
 * the handoff binding the callback left in this browser's cookie jar. Neither
 * reads a principal, so a bearer on either is a live session travelling where
 * nothing looks at it; and `exchange` answers every refusal with one
 * indistinguishable `401`, which off this list would be read as an expired
 * access token and answered with a refresh nobody asked for.
 *
 * Matched by prefix, so these two do not catch ADR-0072 §3's *link* start,
 * `/profile/identities/google/start` on the user segment — which is
 * authenticated and must keep its bearer.
 */
const UNAUTHENTICATED_PATHS = [
  "/auth/login",
  "/auth/impersonate",
  "/auth/register",
  "/auth/verify-email",
  "/auth/resend-verification",
  "/auth/password/forgot",
  "/auth/password/reset",
  "/invitations/lookup",
  "/auth/onboarding/accept",
  "/auth/google/start",
  "/auth/google/exchange",
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

/**
 * What the axios instance is built from — this client's store, host and
 * population, and nothing else.
 */
export interface TransportDeps {
  readonly store: SessionStore;
  readonly baseUrl: string;
  readonly segment: ApiSegment;
}

/** The instance with its request interceptor already attached. */
export const createTransport = ({
  store,
  baseUrl,
  segment,
}: TransportDeps): AxiosInstance => {
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

  return instance;
};

/**
 * The two recovery paths the response interceptor takes, handed in rather than
 * built here.
 *
 * Both are requests on the very instance this interceptor is being attached to
 * — a refresh and ADR-0030's bootstrap — and both are the session's business
 * rather than the transport's, so they live in `session-lifecycle.ts` and
 * arrive here as functions. It also keeps the single-flight refresh single: the
 * in-flight promise exists in exactly one module, and this file only calls it.
 */
export interface RecoveryDeps {
  readonly endSession: () => void;
  readonly endSessionUnlessOffline: (failure: unknown) => void;
  readonly refreshSession: () => Promise<void>;
  readonly fetchCsrfToken: () => Promise<string>;
}

export const attachResponseInterceptor = (
  instance: AxiosInstance,
  {
    endSession,
    endSessionUnlessOffline,
    refreshSession,
    fetchCsrfToken,
  }: RecoveryDeps,
): void => {
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
       *
       * **Except on a route whose credential is in the body** — which used to
       * read `!isLogin` and was the very divergence the comment above says a
       * second enumeration always eventually has (`D18.6`,
       * `security-reviewer`). `/auth/login` happened to be the whole of that
       * list once; it is now seven paths, and a terminal code from any of them
       * says nothing about a session in this browser, because none of them
       * carries or reads one. Not reachable from this API — every one of those
       * routes answers a single indistinguishable code — but a proxy, a WAF or
       * edge auth in front of it can answer `AUTH_ACCOUNT_DISABLED`, and then
       * asking for a recovery link would sign out whoever else was using the
       * browser.
       */
      if (isTerminalAuthCode(failure.code) && !isUnauthenticatedRoute) {
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
};
