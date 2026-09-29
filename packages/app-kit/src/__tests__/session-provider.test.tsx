import { createApiClient, createSessionStore } from "@repo/api-client";
import { createI18n } from "@repo/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import { http } from "msw";
import { StrictMode } from "react";
import { I18nextProvider } from "react-i18next";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createAppSession, type AppSessionOptions } from "../providers/session";
import { fail, ok } from "../testing/envelope";
import { server } from "../testing/msw-server";

/**
 * The loading gate (ADR-0033 §Boot, ADR-0030 for the CSRF half), certified in
 * the package that owns it since `D22.1` (ADR-0077 §1 and §4).
 *
 * The gate is the whole reason the provider exists: a protected route that
 * rendered before the refresh landed would read an empty store, and the app's
 * guard would bounce a signed-in person to `/login` on every reload. So what
 * is asserted is the *ordering* — nothing below renders until the boot
 * sequence settles — rather than any particular markup.
 *
 * These cases were each app's `session-provider.test.tsx`, where the four they
 * shared ran twice. Each app keeps a smoke test of its own binding: the
 * segment it states and the sentence it passes.
 */

const BASE_URL = "http://api.test";

/** The two sentences the apps pass, as the shapes they take. */
const WITH_VARIABLE = {
  fallback: "The API is not reachable. Check that {{variable}} points at it.",
  values: { variable: "VITE_API_URL" },
} as const;

const PLAIN = {
  fallback: "We cannot reach the service. Try again in a moment.",
} as const;

const sessionFor = (options: Partial<AppSessionOptions> = {}) =>
  createAppSession({
    segment: "admin",
    baseUrl: BASE_URL,
    unreachable: WITH_VARIABLE,
    ...options,
  });

const setup = (
  bootstrap: () => Promise<"authenticated" | "anonymous">,
  {
    strict = false,
    options = {},
  }: { strict?: boolean; options?: Partial<AppSessionOptions> } = {},
) => {
  const { SessionProvider } = sessionFor(options);
  const store = createSessionStore();
  const client = createApiClient({
    store,
    baseUrl: BASE_URL,
    segment: options.segment ?? "admin",
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

/*
 * The kit's own harness mocks no network, because nothing else in the kit
 * fetches. This file is the exception — one case runs the real boot sequence
 * — so it owns the server's lifecycle for its own duration.
 */
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

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
     * effect shipped a permanently blank screen while every test stayed green.
     * React runs the effect, runs its cleanup, then runs it again; the pending
     * promise must resolve into handlers that are still live.
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
    // misconfigured. Reporting that as "anonymous" would send someone to a
    // login screen that cannot work either.
    setup(() => Promise.reject(new Error("boom")));

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(/not reachable/i);
    await waitFor(() => {
      expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    });
  });
});

describe("createAppSession", () => {
  it("the session provider is bound by segment", async () => {
    /*
     * The one word an app states, followed to the wire. The real boot
     * sequence runs against handlers mounted on one segment only, so a
     * session bound to the other would fall through to
     * `onUnhandledRequest: "error"` and land on the unreachable notice.
     */
    for (const segment of ["admin", "user"] as const) {
      const seen: string[] = [];

      server.use(
        http.get(`${BASE_URL}/api/v1/${segment}/auth/csrf`, ({ request }) => {
          seen.push(new URL(request.url).pathname);

          return ok({ csrfToken: "csrf-token" });
        }),
        http.post(
          `${BASE_URL}/api/v1/${segment}/auth/refresh`,
          ({ request }) => {
            seen.push(new URL(request.url).pathname);

            return fail(401, "UNAUTHENTICATED");
          },
        ),
      );

      const { SessionProvider, apiClient, sessionStore } = sessionFor({
        segment,
      });

      expect(apiClient.instance.defaults.baseURL).toBe(
        `${BASE_URL}/api/v1/${segment}`,
      );

      const { unmount } = render(
        <SessionProvider fallback={<p>Starting…</p>}>
          <p>Protected content</p>
        </SessionProvider>,
      );

      expect(await screen.findByText("Protected content")).toBeInTheDocument();
      expect(sessionStore.isAuthenticated()).toBe(false);
      expect(seen).toEqual([
        `/api/v1/${segment}/auth/csrf`,
        `/api/v1/${segment}/auth/refresh`,
      ]);

      unmount();
      server.resetHandlers();
    }
  });

  it("gives every session its own store, client and ended-handler", () => {
    const first = sessionFor();
    const second = sessionFor({ segment: "user" });

    expect(first.sessionStore).not.toBe(second.sessionStore);
    expect(first.apiClient).not.toBe(second.apiClient);

    const firstEnded = vi.fn();
    const secondEnded = vi.fn();

    first.onSessionEnded(firstEnded);
    second.onSessionEnded(secondEnded);

    // The handler is bound late — after the client that calls it was built —
    // and it is the session's own: ending one announces to one.
    first.apiClient.endSession();

    expect(firstEnded).toHaveBeenCalledTimes(1);
    expect(secondEnded).not.toHaveBeenCalled();
  });

  it("interpolates the values the app passes into its own sentence", async () => {
    // No i18next instance is mounted, which is the state this screen is
    // normally in: the sentence is the app's bundled English.
    setup(() => Promise.reject(new Error("boom")));

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(
      "The API is not reachable. Check that VITE_API_URL points at it.",
    );
  });

  it("names nothing the app did not pass", async () => {
    setup(() => Promise.reject(new Error("boom")), {
      options: { unreachable: PLAIN },
    });

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(PLAIN.fallback);
    expect(alert.textContent).not.toContain("VITE_");
  });

  it("reads the sentence from a mounted instance when there is one", async () => {
    const i18n = createI18n({
      resources: {
        en: {
          common: {
            boot: { unreachable: "Unreachable, says {{variable}}." },
          },
        },
      },
      namespaces: ["common"],
      locale: "en",
      storageKeyPrefix: "kit.test",
    });

    const { SessionProvider } = sessionFor();

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

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unreachable, says VITE_API_URL.",
    );
  });
});
