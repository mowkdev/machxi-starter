import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createSessionStore,
  type SessionStore,
} from "@/shared/api/session-store";
import { API, PRINCIPAL } from "@/test/msw/handlers/auth.handlers";
import { fail } from "@/test/msw/handlers/envelope";
import {
  CURRENT_PASSWORD,
  PROFILE,
  createProfileHandlers,
  createProfileMockState,
  type ProfileMockState,
} from "@/test/msw/handlers/profile.handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

/**
 * The profile screen end to end (`D3.9`; ADR-0027, ADR-0033, ADR-0035).
 *
 * Mounted through the **real route tree**, because half of what this step
 * builds is outside the page: the `_dashboard` guard, the shell around it and
 * the sidebar footer that names whoever is signed in. A hand-built tree would
 * quietly replace exactly those.
 *
 * The join this file exists to hold is the last assertion: the store is where
 * session identity lives (ADR-0033), the page is where it is edited, and
 * nothing else notices unless the update writes back to the store.
 */

let state: ProfileMockState;

const signedIn = (): SessionStore => {
  const store = createSessionStore();

  store.setSession({
    accessToken: "test-access-token",
    csrfToken: "test-csrf",
    principal: PRINCIPAL,
  });

  return store;
};

const openProfile = (store: SessionStore = signedIn()) =>
  renderApp({ initialPath: "/profile", store });

/**
 * Queries scoped to the page rather than the document.
 *
 * The operator's own email is on screen twice — once as the account's identity
 * and once in the sidebar footer that now names them — which is the step
 * working rather than a duplicate to remove. `main` is the `SidebarInset`, so
 * this asks about the page and the unscoped queries ask about the shell.
 */
const page = async () => within(await screen.findByRole("main"));

beforeEach(() => {
  state = createProfileMockState();
  server.use(...createProfileHandlers(state));
});

describe("the profile page", () => {
  it("renders the account the API returns, not the principal in memory", async () => {
    openProfile();

    const account = await page();

    expect(await account.findByText(PROFILE.email)).toBeInTheDocument();
    // `status`, `roles` and `lastLoginAt` reach the screen only through
    // `GET /admin/profile` — the wire principal carries none of them.
    expect(account.getByText("Active")).toBeInTheDocument();
    expect(account.getByText("Super admin")).toBeInTheDocument();
  });

  it("puts a failed read where the account would have been, with a retry", async () => {
    const user = userEvent.setup();

    server.use(http.get(`${API}/profile`, () => fail(503, "INTERNAL_ERROR")));

    openProfile();

    // ADR-0034's silent-query bargain: no toast, and therefore an error panel
    // in the place the data would have been (amended D3.7).
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong on the server. Try again.",
    );

    server.use(...createProfileHandlers(state));
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await (await page()).findByText(PROFILE.email)).toBeInTheDocument();
  });

  it("names the signed-in operator in the sidebar footer", async () => {
    openProfile();

    const account = await screen.findByRole("button", { name: "Account" });

    // The name and the address come from the store, which is what makes this
    // free of a request in the shell (ADR-0033 §The session store).
    expect(account).toHaveTextContent("Ada Admin");
    expect(account).toHaveTextContent(PRINCIPAL.email);
  });

  it("keeps the footer honest when the operator renames themselves", async () => {
    const user = userEvent.setup();
    const store = signedIn();

    openProfile(store);

    await user.clear(await screen.findByLabelText("First name"));
    await user.type(screen.getByLabelText("First name"), "Adaline");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    /*
     * The whole reason `useUpdateProfile` writes the principal back. Without
     * it the store still holds the name the session started with, and the
     * corner of every screen shows it until the next token refresh.
     */
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Account" })).toHaveTextContent(
        "Adaline Admin",
      );
    });
    expect(store.getPrincipal()?.firstName).toBe("Adaline");
  });

  it("is reachable from the account menu, not only from the nav", async () => {
    const user = userEvent.setup();

    renderApp({ initialPath: "/", store: signedIn() });

    await user.click(await screen.findByRole("button", { name: "Account" }));
    await user.click(await screen.findByRole("menuitem", { name: "Profile" }));

    // The menu that ends the session is also the one that opens the account it
    // belongs to — the footer is the current-principal block ADR-0032 names,
    // and a name with nowhere to click is half of one.
    // By text, not by role: `CardTitle` is a `div` in the generated shadcn
    // primitive (ADR-0031 keeps those byte-identical to upstream), so the only
    // heading on a dashboard screen is the shell's own `h1`.
    expect(await (await page()).findByText("Your account")).toBeInTheDocument();
  });

  it("reaches the change-password dialog from the password card", async () => {
    const user = userEvent.setup();

    openProfile();

    await user.click(
      await screen.findByRole("button", { name: "Change password" }),
    );

    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).getByRole("heading", { name: "Change your password" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByLabelText("Current password"),
    ).toBeInTheDocument();
  });

  it("changes the password without ending the session that did it", async () => {
    const user = userEvent.setup();
    const store = signedIn();

    openProfile(store);

    await user.click(
      await screen.findByRole("button", { name: "Change password" }),
    );

    const dialog = await screen.findByRole("dialog");

    await user.type(
      within(dialog).getByLabelText("Current password"),
      CURRENT_PASSWORD,
    );
    await user.type(
      within(dialog).getByLabelText("New password"),
      "AnotherPassword!456",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Change password" }),
    );

    await waitFor(() => {
      expect(state.password).toBe("AnotherPassword!456");
    });

    // ADR-0027 spares the caller's session because the caller proved ownership,
    // and the client must not undo that: still signed in, still on this screen.
    expect(store.isAuthenticated()).toBe(true);
    expect(await (await page()).findByText(PROFILE.email)).toBeInTheDocument();
  });
});
