# ADR-0033: Browser API client and session — axios, in-memory tokens, single-flight refresh

- Status: accepted
- Date: 2026-08-19

> Owned by D3 (admin panel); D3.4 implements it. This is the client-side counterpart of [ADR-0029](0029-browser-token-transport.md), which is frozen with D2 — nothing here changes what the API does, only how a browser app is required to use it.

## Context

[ADR-0029](0029-browser-token-transport.md) moved the refresh token into an `httpOnly` cookie and left the access token in JavaScript memory, on purpose: the browser half of that design is a client that holds a fifteen-minute credential in a variable and lets the browser carry the thirty-day one. D2 built the server half. The client half — which HTTP library, where the tokens live in the page, what happens when two requests hit a `401` at once, what a page reload does — is what the `admin` app ([ADR-0022](0022-frontend-apps.md)) cannot be built without, and none of it is decided anywhere.

**The deployment premise comes first, because it decides the client's shape.** The blueprint's reference deployment is subdomains — `admin.example.com` against `api.example.com` — cross-host, same-site. ADR-0029 §Deployment constraints records exactly what that costs: `SameSite=Strict` happily sends the refresh cookie between the two, but `document.cookie` returns only cookies of the document's **own host**, so the app can never read the `__Host-machxi.csrf` cookie the API set. After a reload the only credential left is a cookie the client must echo but cannot see, and ADR-0029's answer was to name the missing endpoint and defer it. ADR-0030 (authored alongside this one) adds it: `GET /api/v1/{user,admin}/auth/csrf` — unauthenticated, sets or rotates `__Host-machxi.csrf`, and returns `{ csrfToken }` in the envelope.

That premise pins the first rule of this ADR before anything is chosen: **the client never reads `document.cookie`.** Every CSRF token it holds arrived in a response body — `AuthResource.csrfToken` on login and refresh (ADR-0029 §CSRF, amended D2.5), or ADR-0030's bootstrap. A client written that way has one code path whether it is deployed same-host or cross-host, which is the difference between a blueprint and a demo that works on one topology.

What the client must *speak* is already decided and typed: the envelope ([ADR-0012](0012-response-envelope.md)), the error-code union ([ADR-0013](0013-error-model.md)), the list metadata an admin table renders ([ADR-0014](0014-pagination-filtering-sorting.md)), and the segment it talks to ([ADR-0015](0015-route-segments-and-versioning.md)) — all shipped by `@repo/contracts` ([ADR-0023](0023-shared-contracts-package.md)), which both frontend apps already depend on by decision. What remains is everything between `fetch` and those types.

## Decision

### Where it lives, and how it is written

The client is `apps/admin/src/shared/api`, in the FSD shared layer that ADR-0032 defines — infrastructure with no knowledge of any feature. It is **not** a workspace package yet: `web` is Next.js, whose server components and route handlers put cookies and requests on a different footing, and an abstraction extracted before its second consumer exists is a guess. Extraction is a later decision, taken when `web` is built.

Everything is functional — `create*` factories closing over their state, `as const` returns, types via `ReturnType` — which is [ADR-0009](0009-api-modular-layering.md)'s rule carried across the HTTP boundary. The API's architecture does not bind the frontend by fiat; it binds it because the rule's reasons (no `this`, no hierarchies, seams that are just function parameters) are not server-side reasons.

```
apps/admin/src/shared/
  config/
    index.ts            # the only reader of import.meta.env, zod-validated
  api/
    api-error.ts        # apiClientError(), isApiClientError() — the branded failure type
    session-store.ts    # createSessionStore() — tokens in memory, observable
    client.ts           # createApiClient(deps) — axios instance + interceptors
    bootstrap.ts        # bootstrapSession() — the reload path (§Boot)
    context.tsx         # ApiProvider, useApiClient, useSession (added D3.4)
```

**Amended 2026-08-19 (D3.4).** `context.tsx` is the fifth file, and it is here rather than beside the provider that supplies it because ADR-0032's dependency rule put it here: a feature may not import from `app`, so a `useApiClient` exported from `app/providers` would be unusable by the login form that needs it — and the boundaries lint refused it rather than letting it through. Hooks that reach the client are part of the client's surface; `app` keeps constructing the singletons and deciding when they are ready. Nothing in `context.tsx` constructs anything, which is what lets a test wrap a component in a client built for that test with no module mocking. `useSession` deliberately returns `{ principal, isAuthenticated }` and **not** the tokens: the store's whole argument is minimising what a script can walk away with, and `client.ts` is the only code that needs them.

### Configuration: `import.meta.env` behind one module

[ADR-0004](0004-configuration-and-environment.md)'s discipline, mapped to Vite: `import.meta.env` is read in exactly one module, `shared/config`, parsed with a zod schema, frozen, and imported everywhere else as a typed object. A missing or malformed `VITE_API_URL` fails the build of the config module loudly, not the first request quietly.

```ts
// apps/admin/src/shared/config/index.ts — the only import.meta.env reader
const envSchema = z.object({
  VITE_API_URL: z.string().url(), // e.g. http://localhost:4000 — no trailing path
});
export const config = Object.freeze(envSchema.parse(import.meta.env));
```

`apps/admin/.env.example` documents `VITE_API_URL`, committed with the local default. One thing said honestly rather than discovered later: **`VITE_*` variables are compile-time public** — Vite inlines them into the served bundle, so nothing secret may ever be added to this schema. That is not a weakness of this design; it is what "configuration of a browser app" means, and writing it down is what keeps a future API key out of the file.

Inlining has an [ADR-0026](0026-task-graph-caching-and-serialisation.md) consequence: the variable is an input to the cached `build` task, so **`turbo.json` declares `VITE_API_URL` in the admin `build` (and `dev`) task's `env`** — undeclared, a changed API URL would replay a stale bundle from cache, the exact silent-default failure D2.1 recorded for the `db:*` tasks. The test tasks stay out of it by construction: the harness pins a fixed value inside the repository ([ADR-0036](0036-admin-testing-strategy.md)), so no test task reads the environment at all.

### The axios instance

axios 1.x, from a factory:

```ts
// apps/admin/src/shared/api/client.ts
export const createApiClient = ({ store, baseUrl }: { store: SessionStore; baseUrl: string }) => {
  const instance = axios.create({
    baseURL: `${baseUrl}/api/v1/admin`,
    withCredentials: true,
  });
  // interceptors below
  return { /* … */ } as const;
};
```

- **`baseURL` is the admin segment and nothing wider.** The admin app talks to `/api/v1/admin` only (ADR-0015); a path that escapes the segment is a bug the base URL makes impossible to write by accident.
- **`withCredentials: true`, always.** The refresh cookie travels on `/auth/refresh` and the CSRF cookie on everything; a credentialed cross-origin request is the entire point of `cors({ credentials: true })` on the API side (ADR-0029 §Consequences).

### The session store

A closure-based module holding the access token, the CSRF token and the authenticated principal **in memory only** — ADR-0029's design, finished: the server put the durable credential where JavaScript cannot reach it, and this store is the client refusing to undo that by writing its half somewhere durable. **`localStorage` and `sessionStorage` are never used**, for the reason ADR-0029 exists at all: anything a script can read after the fact, an XSS reads too, and the whole trade of D2.5 was reducing what an XSS walks away with.

**Amended 2026-08-19 (D3.1).** That sentence is scoped to credentials, and saying so is worth more than leaving it to be read charitably. The rule is: **no access token, no CSRF token and no principal is ever written to `localStorage`, `sessionStorage` or a cookie the client sets itself** — nothing whose disclosure moves an attacker forward. Non-credential display state is not covered and may be persisted: `D3.1`'s theme preference is a `localStorage` key, and `@repo/ui`'s generated `sidebar.tsx` writes the sidebar's open/closed state to a cookie of its own. Neither weakens the trade — an XSS that reads either learns which colours the operator prefers — and the paragraph above still forbids the thing that matters. What does still hold unconditionally is §Context's other rule: the client never *reads* `document.cookie`, because on the reference deployment there is nothing there to read.

```ts
// apps/admin/src/shared/api/session-store.ts
export const createSessionStore = () => {
  let accessToken: string | null = null;
  let csrfToken: string | null = null;
  let principal: PrincipalResource | null = null;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };

  return {
    getAccessToken: () => accessToken,
    getCsrfToken: () => csrfToken,
    getPrincipal: () => principal,
    isAuthenticated: () => accessToken !== null,
    setSession: (next: { accessToken?: string; csrfToken?: string; principal?: PrincipalResource }) => { /* assign present fields */ notify(); },
    clear: () => { accessToken = null; csrfToken = null; principal = null; notify(); },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  } as const;
};
export type SessionStore = ReturnType<typeof createSessionStore>;
```

The two tokens are separate fields because they exist at different moments: after ADR-0030's bootstrap the store holds a CSRF token and no access token, and that intermediate state is exactly what the boot sequence (below) passes through. **The principal lives here too, by decision**: `AuthResource` carries it on both login and refresh, and it is session identity — who is signed in — not server state, so it belongs to the store rather than the query cache ([ADR-0034](0034-server-state-and-notifications.md) owns the latter). The sidebar's current-principal block (ADR-0032) reads it from here; richer or fresher account data is a `/profile` query, cached like any other server state. `isAuthenticated()` is derived — the access token's presence *is* the authenticated state — and is the predicate the ADR-0032 route guard calls. `subscribe` exists because two things observe the store — that router guard, which must know "authenticated or not" before a protected route renders, and React, via `useSyncExternalStore`. The store knows about neither.

**Amended 2026-08-20 (D3.9): one writer for the session, one narrow writer for the principal.** `client.ts` is the only thing that sets tokens, and it sets the principal alongside them at login, at refresh and at the bootstrap — a feature that hydrated a session itself would be a second writer of the same state. `D3.9` adds the one exception, and states it here so it stays an exception: `useSetPrincipal` (`shared/api/context`) replaces **the principal and nothing else**, and exactly one caller uses it — `useUpdateProfile`, after `PATCH /admin/profile` has returned the account's new names. The paragraph above already anticipated the case ("richer or fresher account data is a `/profile` query"); what it did not say is where that answer goes when it is *the same* data the store holds. Without this the operator renames themselves and the sidebar keeps the old name until the next token refresh, and the alternative — having the shell fetch `/admin/profile` on every protected screen — puts a request in a layout to render a label already in memory. The hook hands out no store, so nothing gains a way to read a token or end a session that did not already have one; it takes a **staff** principal, since this client is pinned to the admin segment; and it refuses to write when the store holds no access token, because logout is reachable from the sidebar while a save is in flight and a cleared store must stay cleared.

Two things it is worth being exact about, since it writes the whole principal rather than two names. It replaces `roles` as well — read fresh from `GET /admin/profile`, so **the store's `roles` are the account's, not the access token's claims**, and those two can differ by up to one token lifetime (ADR-0018 §Authenticated request). Nothing in `apps/admin` gates on `principal.roles` today, so this is a difference with no consequence; the day a client-side authorization vocabulary arrives it must decide which of the two it is reading, because "what this operator may do" is the token's answer and "what this account is" is the database's. **Amended 2026-08-20 (D3.10).** [ADR-0042](0042-client-side-authorization.md), written in that step and assigned to D4, is that vocabulary and answers it: it reads the store's principal, with the divergence bounded by ADR-0017 revoking sessions on a role write.

### Request interceptors: what each request carries

Three headers, attached by a request interceptor reading the store:

- **`Authorization: Bearer <accessToken>`** — on every request, whenever the store holds one. The scheme is `TOKEN_TYPE` from `@repo/contracts`.
- **`X-CSRF-Token: <csrfToken>`** — on the three cookie-driven endpoints and only those: `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-all`. That is the exact set `core/middleware/csrf.ts` guards (ADR-0029 §CSRF); attaching it more widely would leak nothing but would misstate the contract.
- **`X-Auth-Transport: cookie`** — on `login` and `refresh`. On login it is the opt-in that puts the refresh token in the cookie and `csrfToken` in the body (ADR-0029 §Opt-in); on refresh the presented cookie is already the opt-in (ADR-0029, amended D2.5) and the header is the client stating its intent rather than relying on the fallback rule.

The header names are declared as constants in `shared/api`, duplicating the values in `apps/api/src/core/http/cookies.ts`. They cannot be imported — an app does not import from another app — and they do not move to `@repo/contracts` here, because ADR-0029 §Contracts deliberately made them constants-not-configuration on the API side and that ADR is frozen. The duplication is safe for the same reason: those names change only by superseding ADR-0029, at which point this ADR is revisited with it.

### Response translation: the envelope in, `ApiClientError` out

A response interceptor is where ADR-0012 stops being the API's shape and starts being the client's:

- **`204`** resolves to `undefined` — logout and deletes have no body by decision.
- **A success envelope** resolves typed as the contracts envelope. For lists, `meta.pagination`, `meta.sort` and `meta.filters` are **kept, not discarded**: ADR-0014 emits them precisely so an admin table can render its state without re-parsing its own query, and a client that unwraps lists down to a bare array would force every table to reconstruct what the server already said.
- **An error envelope** rejects with an `ApiClientError` — a branded, functional error mirroring ADR-0013's `AppError` on the other side of the wire. The name is deliberately not `ApiError`: `@repo/contracts` already exports an `ApiError` interface — the envelope's `error` object — which this same module imports when parsing envelopes, and a second type of that name would guarantee import confusion.

```ts
// apps/admin/src/shared/api/api-error.ts
export interface ApiClientErrorData {
  status: number;                       // the HTTP status that carried it
  code: ErrorCode;                      // the @repo/contracts union
  message: string;
  details?: readonly ErrorDetail[];
}
export type ApiClientError = Error & Readonly<ApiClientErrorData> & { readonly [API_CLIENT_ERROR]: true };

export const apiClientError = (data: ApiClientErrorData): ApiClientError => { /* new Error + Object.assign + brand */ };
export const isApiClientError = (e: unknown): e is ApiClientError => typeof e === "object" && e !== null && API_CLIENT_ERROR in e;
```

Callers branch with `isApiClientError(e)` and switch on `e.code` — never on message strings, never on classes. That is ADR-0013's no-`instanceof` rule for ADR-0013's own reason, which is *stronger* in a bundled SPA: `instanceof` across chunks and library boundaries is exactly where it breaks. `code` is typed as the union, so an exhaustiveness check in a `switch` is a compile error the day the API adds a code the client does not handle — and per the union's own contract, an unrecognised code at runtime is treated as a generic failure of whatever status carried it.

Every rejection out of the client satisfies `isApiClientError`, including failures that carry no envelope at all — the network is down, a gateway answered HTML. Callers get one failure type or the abstraction is not one. The exact `code` mapping for envelope-less failures is D3.4's to pin under that invariant; it is noted in §Consequences rather than guessed here.

### 401 and the single-flight refresh

A `401` means the access token died — fifteen minutes is the design (ADR-0018) — and the client's job is to make that invisible. The rule is **single-flight**: one shared in-flight refresh promise; every request that meets a `401` while it is pending queues behind the *same* promise and retries once with the new token.

```ts
let inflight: Promise<void> | null = null;
const refreshSession = (): Promise<void> =>
  (inflight ??= runRefresh().finally(() => { inflight = null; }));
```

- Without it, a dashboard that fires five requests on mount turns one expired token into five concurrent refreshes — and refresh **rotates** (ADR-0018 §Refresh), so four of them replay a just-rotated token. Inside `REFRESH_ROTATION_GRACE_SEC` that is tolerated; outside it, it is reuse detection and the session is revoked. The client must not be a machine for triggering its own reuse alarm.
- **Each request retries at most once.** A second `401` after a fresh token is not staleness, and looping on it is how outages become request storms.
- **Refresh itself and login never trigger the interceptor.** A `401` from refresh *is* the terminal answer, and a `401` from login is a wrong password; recursing on either is a loop with no exit.
- **A failed refresh clears the store and surfaces "unauthenticated".** The router guard (ADR-0032) observes the cleared store and redirects to `/login`, preserving the attempted location so login can return there.

Only `401` triggers this. ADR-0027 made `AUTH_CURRENT_PASSWORD_INVALID` a `403` for precisely this client — "a `401` would send every client interceptor that treats `401` as 'the session died' to the login screen over a typo". This interceptor is the one that sentence was written about, and it honours the split by never treating a `403` as a dead session.

### Boot: csrf, then refresh, then render

A page load starts with an empty store — that is the price of memory-only tokens, paid on purpose. The sequence:

```ts
// apps/admin/src/shared/api/bootstrap.ts
const bootstrapSession = async (): Promise<"authenticated" | "anonymous"> => {
  const { csrfToken } = await getCsrf();          // GET /auth/csrf  (ADR-0030)
  store.setSession({ csrfToken });
  try {
    await refreshSession();                        // POST /auth/refresh — cookie + X-CSRF-Token
    return "authenticated";
  } catch {
    store.clear();
    return "anonymous";
  }
};
```

1. `GET /auth/csrf` (ADR-0030) — the one request in the flow that cannot itself require a CSRF token. It sets or rotates the cookie and hands the client the matching body copy, which is the only copy this client will ever use.
2. `POST /auth/refresh` with the token in `X-CSRF-Token`. Success hydrates the store — access token, rotated CSRF token and principal from `AuthResource` — **before any protected route renders**; the app shell holds a loading gate until `bootstrapSession` resolves, and the router guard never sees a half-bootstrapped store.
3. Failure lands on `/login`. **Three** codes are terminal and are never retried, and this list is canonical — ADR-0036's suites assert it. `AUTH_REFRESH_REUSED`, `AUTH_SESSION_REVOKED` and `AUTH_ACCOUNT_DISABLED` are the dead-cookie states ADR-0029 §Consequences records: the server killed the session but could not clear the browser's cookie, so the browser would replay a dead thirty-day credential until it expires, and treating them as "logged out, go to `/login`" is the handling that consequence was left open for.

   **Amended 2026-08-19 (D3.2).** A fourth code, `CSRF_TOKEN_INVALID`, was listed here as terminal on two grounds, and building [ADR-0030](0030-csrf-bootstrap-endpoint.md)'s endpoint falsified both. **It is recoverable: re-bootstrap once and retry once, and only a second failure is terminal.**

   - _"There is nothing fresher to present."_ True while the bootstrap rotated on every call — a second `GET /auth/csrf` would have minted a third value and proved nothing. D3.2 made it **idempotent**: it echoes the cookie the caller already holds and mints only when there is none, so a re-bootstrap now returns *the cookie's current value*. That is precisely something fresher, and it is the value the failing check wanted.
   - _"A retry spends `RATE_LIMIT_REFRESH_MAX`."_ This was already wrong when written, which is the more useful half of the finding. ADR-0029 §Consequences (amended D2.5) narrowed the refresh limiter to count **only `401`** — `requestWasSuccessful: (_req, res) => res.statusCode !== 401` — for exactly the reason that a `403` CSRF failure or a `400` empty body must not spend a visitor's budget. A `403` costs nothing, so the retry is free.

   And the condition arises with no attacker in sight, which is why leaving it terminal would have been a real defect rather than a conservative choice: `__Host-machxi.csrf` is one cookie at `Path=/` shared by every tab and both populations (ADR-0029, amended D2.5), so a login in a second tab rotates it while this tab still holds the old value in memory. The operator's next action here would end their session for no reason. The retry is bounded — one extra `GET /auth/csrf`, one repeat of the original request, then terminal — so the loop the terminal list exists to prevent is still prevented; a second `403` means the mismatch is not staleness (a shadowed duplicate cookie, which `readCookie` fails closed on, survives any number of re-bootstraps) and the session ends as before.

A visitor with no cookie at all fails step 2 cheaply (`400` — `refreshBody` with neither cookie nor body token is a validation error, ADR-0029 §Contracts) and lands anonymous, which is the correct answer, not an error to report.

**Amended 2026-08-19 (D3.4): there is a third outcome, and step 1 is where it comes from.** The sequence above swallows a failed *refresh* into `anonymous`; it must not swallow a failed *bootstrap*. If `GET /auth/csrf` itself cannot be reached the API is down or misconfigured, and reporting that as "not signed in" sends an operator to a login screen that cannot work either. So `bootstrapSession` lets that rejection propagate, and the shell's loading gate renders an unreachable state instead of the app. The gate holding until the sequence *settles* — rather than until it succeeds — is what makes the third outcome expressible at all. It is a terminal screen today, with no retry affordance; a transient blip at load therefore needs a manual reload, which is a known rough edge rather than a decision.

### Logout

`POST /auth/logout` with the CSRF header; the server revokes the session and clears both cookies (ADR-0029 §The cookie). The client then clears the store and redirects to `/login`. The clear is unconditional — a client that cannot reach the API must still end what it controls locally; the server-side session, unreachable in that moment, dies at its TTL or at reuse detection, which is the best an offline logout can do.

### Development runs the deployed shape

**No Vite dev proxy — deliberately.** `apps/admin/.env.example` sets `VITE_API_URL=http://localhost:4000` and the dev server at `:3001` makes direct cross-origin calls, exercising the real machinery production depends on: CORS preflights against `CORS_ORIGINS` (whose default already allows `http://localhost:3001` — ADR-0004, ADR-0022), credentialed requests, and `Secure` cookies — which work because browsers treat `localhost` as a trustworthy origin, the same fact ADR-0029 §The cookie leaned on to keep `Secure` unconditional. A misconfigured CORS origin or a cookie attribute that breaks the flow fails on a developer's machine on day one, in the same way it would fail in production.

## Consequences

- **Every page load costs two round-trips before the first authenticated render** — csrf, then refresh — behind a loading gate in the shell. That is the price of memory-only tokens, and it was paid knowingly: the alternative is a token an XSS can read after the fact.
- **Multi-tab works without coordination.** Each tab holds its own store and bootstraps independently; two tabs refreshing near-simultaneously race on rotation, and `REFRESH_ROTATION_GRACE_SEC` (default 30s, ADR-0018 §Refresh) exists to absorb exactly that replay. No `BroadcastChannel`, no shared worker — the grace window is the synchronisation mechanism, and it lives on the server where it is enforced rather than merely hoped for.
- **The client is coupled to the envelope and the error union.** That is not a cost to mitigate; it is the point of `@repo/contracts` (ADR-0023) — one parser for every endpoint, exhaustive `code` handling checked by the compiler, and an additive new code degrading to "generic failure of that status" instead of breaking.
- **The whole flow is testable without a server.** Every decision here — single-flight, boot, terminal codes, header attachment — is observable at the HTTP boundary, which is what lets MSW (ADR-0036) exercise it in the unit tier. **Amended 2026-08-19 (D3.2):** the `CSRF_TOKEN_INVALID` recovery above is in that set and is scripted the same way — a handler that answers `403` once, then a counted `GET /auth/csrf`, then the retry succeeding.
- **Two header names are duplicated** from `apps/api/src/core/http/cookies.ts` into `shared/api`. They are wire contract under a frozen ADR, so the copies cannot drift silently — but whoever supersedes ADR-0029 must find this ADR too, and this sentence is the pointer.
- **One detail is left to D3.4 under a stated invariant:** the `code` assigned to envelope-less failures (network down, non-JSON responses). Whatever it is, the rejection must satisfy `isApiClientError`, or callers grow a second failure branch this ADR exists to prevent.

  **Amended 2026-08-19 (D3.4): it is `SERVICE_UNAVAILABLE`,** taken from the existing `@repo/contracts` union rather than invented. From the browser's side a dead socket, a DNS failure and a proxy returning HTML are indistinguishable from an API that is not there, which is what that code already means; a client-only member of a union the contracts package defines for the *API's* answers would make the union describe two different things. `status` is the discriminator that keeps the two readings apart: **`0` means no answer arrived**, and a real `503` carries `503`. That distinction is load-bearing rather than cosmetic — D3.4's client uses it to decide *not* to end a session when a refresh simply got no answer, because a dropped connection is no evidence at all that the session died, and logging an operator out over one costs them their in-flight work to fix nothing.
- The session dies with the tab. A reload is a bootstrap, a closed tab is a logout-in-effect, and nothing about the session survives in storage for a later audit or attacker to find.

## Alternatives considered

- **A `fetch` or `ky` wrapper instead of axios.** Entirely viable — the envelope translation and single-flight logic are library-agnostic. axios is chosen for mature, composable interceptors (the seam every decision above hangs on) and team familiarity; that is a stated preference, not a claim of necessity, and the factory boundary is what keeps the choice replaceable.
- **Refresh token in memory, `body` transport.** Zero cookie machinery, no CSRF, no bootstrap round-trips — and a thirty-day credential in JavaScript, which is precisely what ADR-0029 rejected for first-party browser apps. `body` transport remains what mobile clients and Postman use; it is not what a browser app in this repository uses.
- **Tokens in `localStorage`.** Survives reloads, deleting the entire boot sequence. Rejected because any XSS reads it at leisure — it would spend everything D2.5 built on the server to save two round-trips.
- **A Vite dev proxy for same-origin development.** Comfortable, and it hides the CORS and credentialed-cookie path that the reference deployment stands on: a broken `CORS_ORIGINS`, a wrong `withCredentials`, a cookie attribute that fails cross-host — all invisible until staging. Rejected so that development fails the way production would.
- **Extract `@repo/api-client` now.** Premature with one consumer; `web`'s Next.js constraints (route handlers, server components) will bend the design, and bending it with both apps in view is the cheaper order. Revisited when `web` is built.
