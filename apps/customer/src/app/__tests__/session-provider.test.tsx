import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";

import { SessionProvider } from "@/app/providers/session";
import { createBootstrap } from "@/shared/api/bootstrap";
import { createApiClient } from "@/shared/api/client";
import { createSessionStore } from "@/shared/api/session-store";
import { EN_RESOURCES, NAMESPACES, createI18n } from "@/shared/i18n";
import {
  createAuthHandlers,
  createAuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import { server } from "@/test/msw/server";

/**
 * The loading gate (ADR-0033 §Boot, ADR-0030 for the CSRF half).
 *
 * The gate is the whole reason this component exists: a protected route that
 * rendered before the refresh landed would read an empty store, and the
 * `_dashboard` guard would bounce a signed-in customer to `/login` on every
 * reload. So what is asserted is the *ordering* — nothing below renders until
 * the boot sequence settles — rather than any particular markup.
 *
 * This is also the one suite that mounts the provider at all: `renderApp`
 * deliberately leaves it out, because a routing test that waited on two
 * requests to assert a redirect would be asserting the boot rather than the
 * guard, and the bootstrap would overwrite the store the test passed.
 */

const setup = (
  bootstrap: () => Promise<"authenticated" | "anonymous">,
  { strict = false }: { strict?: boolean } = {},
) => {
  const store = createSessionStore();
  const client = createApiClient({
    store,
    baseUrl: "http://api.test",
    segment: "user",
  });

  const tree = (
    <SessionProvider
      bootstrap={bootstrap}
      client={client}
      fallback={<p>Starting…</p>}
      store={store}
    >
      <p>Protected content</p>
    </SessionProvider>
  );

  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
};

describe("SessionProvider", () => {
  it("holds the children back until the boot sequence settles", async () => {
    let release: ((outcome: "authenticated") => void) | undefined;
    const bootstrap = vi.fn(
      () =>
        new Promise<"authenticated">((resolve) => {
          release = resolve;
        }),
    );

    setup(bootstrap);

    expect(screen.getByText("Starting…")).toBeInTheDocument();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();

    release?.("authenticated");

    expect(await screen.findByText("Protected content")).toBeInTheDocument();
  });

  it("renders the app for a visitor with no session", async () => {
    // `anonymous` is a successful outcome, not a failure: the boot sequence ran
    // and the answer was "nobody is signed in". The router takes it from there.
    setup(() => Promise.resolve("anonymous"));

    expect(await screen.findByText("Protected content")).toBeInTheDocument();
  });

  it("renders under StrictMode, which double-invokes the effect", async () => {
    /*
     * `main.tsx` mounts the app inside `StrictMode`, and no other suite renders
     * that way — which is exactly how a latch that returned early from the
     * effect once shipped a permanently blank screen in the admin while every
     * test stayed green. React runs the effect, runs its cleanup, then runs it
     * again; the pending promise must resolve into handlers that are still
     * live. The finding is inherited with the code, so the suite that caught it
     * is inherited too.
     */
    const bootstrap = vi.fn(() =>
      Promise.resolve<"authenticated">("authenticated"),
    );

    setup(bootstrap, { strict: true });

    expect(await screen.findByText("Protected content")).toBeInTheDocument();
    // The request is shared across the double-invoke; only the handlers repeat.
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it("says so when the API cannot be reached at all", async () => {
    // A rejection means `GET /auth/csrf` itself failed — the API is down or
    // misconfigured. Reporting that as "anonymous" would send a customer to a
    // sign-in screen that cannot work either.
    setup(() => Promise.reject(new Error("boom")));

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(/cannot reach the service/i);
    await waitFor(() => {
      expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    });
  });

  it("lands a first-time visitor anonymous, over the real boot sequence", async () => {
    /*
     * The branch `createBootstrap` exists for, and the one every other case
     * here stubs past: somebody who has never signed in has no refresh cookie,
     * so `GET /auth/csrf` succeeds and `POST /auth/refresh` is refused. That is
     * **not** an error — the boot ran and the answer was "nobody is signed in"
     * — and the app must render, so the router can put them on `/login`.
     *
     * Uncovered until `D12.2`'s review pointed out that the handlers answered
     * every refresh with a session, which made the mock more permissive than
     * the endpoint on the one path that decides whether a stranger sees the app
     * or an error screen (ADR-0036 §The load-bearing rule).
     */
    const state = createAuthMockState();
    state.hasRefreshCookie = false;
    server.use(...createAuthHandlers(state));

    const store = createSessionStore();
    const client = createApiClient({
      store,
      baseUrl: "http://api.test",
      segment: "user",
    });

    render(
      <SessionProvider
        bootstrap={createBootstrap(client)}
        client={client}
        fallback={<p>Starting…</p>}
        store={store}
      >
        <p>Protected content</p>
      </SessionProvider>,
    );

    expect(await screen.findByText("Protected content")).toBeInTheDocument();
    expect(store.isAuthenticated()).toBe(false);
    // The CSRF bootstrap still happened: ADR-0030's token is what lets an
    // anonymous visitor post a login at all.
    expect(state.csrfCalls).toBe(1);
    expect(state.refreshCalls).toBe(1);
  });

  it("names no environment variable to the person reading it", async () => {
    /*
     * The one line that differs from the admin's notice, asserted so it stays
     * different. The admin interpolates `VITE_API_URL` because its reader runs
     * the panel; this app's reader is a customer, for whom a build-time
     * variable name is noise at best and a hint about our infrastructure at
     * worst.
     *
     * It renders under a real instance rather than the bare-context fallback,
     * because that is the path the running app takes and the path a translated
     * sentence could reintroduce the variable through.
     */
    const i18n = createI18n({
      resources: { en: EN_RESOURCES },
      namespaces: NAMESPACES,
      locale: "en",
    });

    render(
      <I18nextProvider i18n={i18n.instance}>
        <SessionProvider
          bootstrap={() => Promise.reject(new Error("boom"))}
          fallback={<p>Starting…</p>}
        >
          <p>Protected content</p>
        </SessionProvider>
      </I18nextProvider>,
    );

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).not.toContain("VITE_");
  });
});
