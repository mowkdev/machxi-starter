import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SessionProvider } from "@/app/providers/session";
import { createApiClient } from "@/shared/api/client";
import { createSessionStore } from "@/shared/api/session-store";

/**
 * The loading gate (ADR-0033 §Boot).
 *
 * The gate is the whole reason this component exists: a protected route that
 * rendered before the refresh landed would read an empty store, and the
 * `_dashboard` guard would bounce a signed-in operator to `/login` on every
 * reload. So what is asserted is the *ordering* — nothing below renders until
 * the boot sequence settles — rather than any particular markup.
 */

const setup = (bootstrap: () => Promise<"authenticated" | "anonymous">) => {
  const store = createSessionStore();
  const client = createApiClient({ store, baseUrl: "http://api.test" });

  return render(
    <SessionProvider
      bootstrap={bootstrap}
      client={client}
      fallback={<p>Starting…</p>}
      store={store}
    >
      <p>Protected content</p>
    </SessionProvider>,
  );
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

  it("says so when the API cannot be reached at all", async () => {
    // A rejection means `GET /auth/csrf` itself failed — the API is down or
    // misconfigured. Reporting that as "anonymous" would send an operator to a
    // login screen that cannot work either.
    setup(() => Promise.reject(new Error("boom")));

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(/not reachable/i);
    await waitFor(() => {
      expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    });
  });
});
