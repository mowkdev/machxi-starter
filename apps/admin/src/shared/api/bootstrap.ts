import type { ApiClient } from "./client";

/**
 * The reload path (ADR-0033 §Boot).
 *
 * A page load starts with an empty store — that is the price of memory-only
 * tokens, paid on purpose — so the only credential a reloaded page still holds
 * is a cookie it cannot read. Two requests turn that back into a session:
 *
 * 1. `GET /auth/csrf` (ADR-0030) — the one request in the flow that cannot
 *    itself require a CSRF token. It hands back the cookie's current value,
 *    which on a cross-host deployment is the only copy this client will ever
 *    see.
 * 2. `POST /auth/refresh` with that value in `X-CSRF-Token`. Success hydrates
 *    the store — access token, rotated CSRF token, principal — **before any
 *    protected route renders**.
 *
 * A visitor with no cookie fails step 2 cheaply and lands `anonymous`, which is
 * the correct answer rather than an error to report: `refreshBody` with neither
 * cookie nor body token is a `400` (ADR-0029 §Contracts), and a first-time
 * visitor is not a failure.
 *
 * Failure of step 1 is different in kind and is **not** swallowed: if the
 * bootstrap itself cannot be reached, the API is down or misconfigured, and
 * reporting that as "anonymous" would send an operator to a login screen that
 * cannot work either.
 */
export type BootstrapOutcome = "authenticated" | "anonymous";

export const createBootstrap =
  (client: ApiClient) => async (): Promise<BootstrapOutcome> => {
    await client.fetchCsrfToken();

    try {
      await client.refreshSession();
      return "authenticated";
    } catch {
      client.endSession();
      return "anonymous";
    }
  };
