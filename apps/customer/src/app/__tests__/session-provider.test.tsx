import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import { SessionProvider, apiClient } from "@/app/providers/session";
import { createBootstrap } from "@/shared/api/bootstrap";
import { createApiClient } from "@/shared/api/client";
import { createSessionStore } from "@/shared/api/session-store";
import { EN_RESOURCES, NAMESPACES, createI18n } from "@/shared/i18n";
import {
  createAuthHandlers,
  createAuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import { server } from "@repo/app-kit/testing";

/**
 * The session's binding (ADR-0077 §1 and §4).
 *
 * The gate itself — the ordering, `StrictMode`, the unreachable notice's
 * mechanics — is certified in `@repo/app-kit`, which has owned it since
 * `D22.1`. What this app states is the segment and the sentence, and these
 * are the cases that need this app to be asked: the boot sequence over this
 * app's own handlers, and the sentence under this app's own catalogue.
 *
 * This is also the one suite that mounts the provider at all: `renderApp`
 * deliberately leaves it out, because a routing test that waited on two
 * requests to assert a redirect would be asserting the boot rather than the
 * guard, and the bootstrap would overwrite the store the test passed.
 */
describe("the customer app's session", () => {
  it("lands a first-time visitor anonymous, over the real boot sequence", async () => {
    /*
     * The branch `createBootstrap` exists for: somebody who has never signed in
     * has no refresh cookie, so `GET /auth/csrf` succeeds and
     * `POST /auth/refresh` is refused. That is **not** an error — the boot ran
     * and the answer was "nobody is signed in" — and the app must render, so
     * the router can put them on `/login`.
     *
     * Uncovered until `D12.2`'s review pointed out that the handlers answered
     * every refresh with a session, which made the mock more permissive than
     * the endpoint on the one path that decides whether a stranger sees the app
     * or an error screen (ADR-0036 §The load-bearing rule).
     *
     * The segment this app binds is proved by the assertion on the app's own
     * client below; the boot itself runs over a client of the test's own, so
     * the app's singletons are never written.
     */
    expect(apiClient.instance.defaults.baseURL?.endsWith("/api/v1/user")).toBe(
      true,
    );

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

    expect(alert).toHaveTextContent(/cannot reach the service/i);
    expect(alert.textContent).not.toContain("VITE_");
  });
});
