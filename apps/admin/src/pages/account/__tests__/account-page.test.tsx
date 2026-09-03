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
import { server } from "@repo/app-kit/testing";
import { renderApp } from "@/test/render";

/**
 * The account area's two built sections end to end (`D3.9`, moved at `D11.9`;
 * ADR-0027, ADR-0033, ADR-0035, ADR-0053).
 *
 * Mounted through the **real route tree**, because half of what this proves is
 * outside the page: the `_dashboard` guard, the shell around it and the
 * header's account menu that names whoever is signed in. A hand-built tree
 * would quietly replace exactly those.
 *
 * The join this file exists to hold is the rename assertion: the store is
 * where session identity lives (ADR-0033), the page is where it is edited, and
 * nothing else notices unless the update writes back to the store.
 *
 * **`D11.9` moved the file and split the addresses.** Every case that used to
 * open `/profile` opens the section that now holds the card it is about — the
 * summary and the details form at `/account/profile`, the password card and
 * its dialog at `/account/security` — which is ADR-0053 §1's section rule
 * asserted by where each test has to go to find its own subject. One
 * assertion changed rather than moved, and the review caught what that cost;
 * the note on it is at the bottom of this file. The routes themselves (the deep links, the two redirects and the
 * per-section titles) are `app/__tests__/routing.test.tsx`'s, where the rest of
 * the route tree is asserted.
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
  renderApp({ initialPath: "/account/profile", store });

const openSecurity = (store: SessionStore = signedIn()) =>
  renderApp({ initialPath: "/account/security", store });

/**
 * Queries scoped to the account summary rather than the document.
 *
 * The operator's own email is on screen twice — once as the account's identity
 * and once in the account menu that names them — which is the step working
 * rather than a duplicate to remove. **The landmark stopped separating them at
 * `D8.5`**: `main` is the `SidebarInset` and the menu moved into the header
 * *inside* it, so a query scoped to `main` matches both and `findByText`
 * throws. The anchor is the account card's own named region instead
 * (`role="region"` + `aria-labelledby`, `pages/account/index.tsx`), which asks
 * about the summary while the unscoped queries ask about the shell.
 */
const page = async () =>
  within(await screen.findByRole("region", { name: "Your account" }));

beforeEach(() => {
  state = createProfileMockState();
  server.use(...createProfileHandlers(state));
});

describe("the account area", () => {
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

  it("names the signed-in operator in the header's account menu", async () => {
    openProfile();

    const account = await screen.findByRole("button", { name: "Account" });

    // The name and the address come from the store, which is what makes this
    // free of a request in the shell (ADR-0033 §The session store).
    expect(account).toHaveTextContent("Ada Admin");
    expect(account).toHaveTextContent(PRINCIPAL.email);
  });

  it("keeps the account menu honest when the operator renames themselves", async () => {
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

  it("is reachable from the account menu, which is now the only way in", async () => {
    const user = userEvent.setup();

    renderApp({ initialPath: "/", store: signedIn() });

    await user.click(await screen.findByRole("button", { name: "Account" }));
    await user.click(await screen.findByRole("menuitem", { name: "Account" }));

    // The menu that ends the session is also the one that opens the account it
    // belongs to — the menu is the current-principal block, which ADR-0049
    // moved from the sidebar's footer to the shell's header, and a name with
    // nowhere to click is half of one.
    // On the account's own data, not on the region's name: since `D8.5` the
    // `page()` anchor is computed *from* the card's title, so asserting that
    // title back would pass on the helper's own lookup and prove no
    // navigation at all.
    //
    // Since `D11.10` the item points at `/account` and the sidebar has no
    // account entry at all (ADR-0053 §3), so this walk is the whole route in:
    // the trigger, one item, the index route's redirect, and a section on
    // screen. The title of this case says "only way in" and that is what the
    // sidebar assertion in `app/__tests__/routing.test.tsx` holds up.
    expect(await (await page()).findByText(PROFILE.email)).toBeInTheDocument();
  });

  it("reaches the change-password dialog from the password card", async () => {
    const user = userEvent.setup();

    openSecurity();

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

    openSecurity(store);

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

    /*
     * ADR-0027 spares the caller's session because the caller proved
     * ownership, and the client must not undo that: still signed in, still on
     * this screen. The screen is the security section now, so the
     * surviving-session claim is made on the shell heading this route drives
     * rather than on the summary two addresses away — `CardTitle` is a `div`
     * and not a heading at all.
     *
     * **The settle above this is the server's, and these two need the
     * client's** (`D11.9` review). `state.password` changes when the request
     * reaches the handler, which can be before the client has processed the
     * response at all — so a bare query taken there is asking about a screen
     * that has not finished reacting. The dialog closing is the observable end
     * of `onSuccess`, after it has wiped the plaintext from the form, and it
     * is what makes "still signed in, still here" a claim about the settled
     * state rather than about an instant in the middle of one.
     */
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(store.isAuthenticated()).toBe(true);
    expect(
      screen.getByRole("heading", { level: 1, name: "Security" }),
    ).toBeInTheDocument();
  });
});
