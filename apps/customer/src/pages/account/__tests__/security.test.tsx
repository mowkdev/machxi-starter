import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  API,
  GOOGLE_AUTHORIZATION_URL,
  createAuthHandlers,
  createAuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import { fail } from "@/test/msw/handlers/envelope";
import {
  createOrganizationsHandlers,
  createOrganizationsMockState,
} from "@/test/msw/handlers/organizations.handlers";
import {
  CURRENT_PASSWORD,
  PROFILE,
  bothWaysProfile,
  createProfileHandlers,
  createProfileMockState,
  googleOnlyProfile,
  type ProfileMockState,
} from "@/test/msw/handlers/profile.handlers";
import { server } from "@repo/app-kit/testing";
import type { AppFeatures } from "@/shared/config";
import type { UserProfileResource } from "@repo/contracts";
import { authenticated } from "@/test/principals";
import { renderApp } from "@/test/render";

/**
 * The ways into an account, as the customer app draws them (`D19.5`;
 * ADR-0072 §3, §4).
 *
 * The security section's **Sign-in methods** card, and the rule that follows a
 * passwordless account around the account area: while `hasPassword` is false
 * the three current-password ceremonies — change the password, change the
 * address, delete the account — are replaced by one sentence and the "Set a
 * password" control. Driven through the real route tree, because the card
 * reads the build's flag off the router's context and the notices arrive as
 * history state from `/auth/google`.
 */

const GOOGLE_ON: AppFeatures = { userRegistration: true, googleSignIn: true };

const SET_PASSWORD_FIRST =
  "This asks for your current password, and your account does not have one yet. Set a password first.";

let state: ProfileMockState;

const withProfile = (profile: UserProfileResource) => {
  state = createProfileMockState(profile);
  server.use(...createProfileHandlers(state));
};

beforeEach(() => {
  server.use(
    ...createAuthHandlers(createAuthMockState()),
    ...createOrganizationsHandlers(createOrganizationsMockState()),
  );
  withProfile(PROFILE);
  vi.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const open = (path = "/account/security") => ({
  user: userEvent.setup(),
  ...renderApp({
    initialPath: path,
    store: authenticated(),
    features: GOOGLE_ON,
  }),
});

/** A row of the card, by the name of the way in it is about. */
const row = async (name: "Password" | "Google") =>
  within(await screen.findByRole("group", { name }));

const deletionCard = () =>
  within(screen.getByRole("region", { name: "Delete account" }));

describe("the sign-in methods card", () => {
  it("offers Change password and Link Google on a password-only account", async () => {
    open();

    const password = await row("Password");
    const google = await row("Google");

    expect(
      password.getByRole("button", { name: "Change password" }),
    ).toBeInTheDocument();
    expect(
      password.queryByRole("button", { name: "Set a password" }),
    ).toBeNull();
    expect(google.getByText("Not linked")).toBeInTheDocument();
    expect(
      google.getByRole("button", { name: "Link Google" }),
    ).toBeInTheDocument();
    expect(google.queryByRole("button", { name: "Unlink" })).toBeNull();
  });

  it("offers Set a password, and no unlink, on a Google-only account", async () => {
    withProfile(googleOnlyProfile());
    open();

    const password = await row("Password");
    const google = await row("Google");

    expect(
      password.getByRole("button", { name: "Set a password" }),
    ).toBeInTheDocument();
    // The change-password dialog would ask for a password that does not
    // exist, so nothing opens it (ADR-0072 §3).
    expect(
      screen.queryByRole("button", { name: "Change password" }),
    ).toBeNull();
    expect(
      google.getByText("Linked to cara.customer@gmail.test"),
    ).toBeInTheDocument();
    // The last way in is not offered for removal: the API would refuse it
    // `409 AUTH_LAST_CREDENTIAL`, and the row says why instead.
    expect(google.queryByRole("button", { name: "Unlink" })).toBeNull();
    expect(
      google.getByText(
        "Google is the only way into this account. Set a password before you unlink it.",
      ),
    ).toBeInTheDocument();
  });

  it("offers Change password and Unlink on an account with both", async () => {
    withProfile(bothWaysProfile());
    open();

    const password = await row("Password");
    const google = await row("Google");

    expect(
      password.getByRole("button", { name: "Change password" }),
    ).toBeInTheDocument();
    expect(google.getByRole("button", { name: "Unlink" })).toBeInTheDocument();
    expect(google.queryByRole("button", { name: "Link Google" })).toBeNull();
  });

  it("offers no link in a build without the flag, and still shows a linked identity", async () => {
    const GOOGLE_OFF = { userRegistration: true, googleSignIn: false };
    const first = renderApp({
      initialPath: "/account/security",
      store: authenticated(),
      features: GOOGLE_OFF,
    });

    await row("Password");
    expect(screen.queryByRole("group", { name: "Google" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Link Google" })).toBeNull();

    first.unmount();

    // Removing a way in needs nothing from Google, so unlink stays.
    withProfile(bothWaysProfile());
    renderApp({
      initialPath: "/account/security",
      store: authenticated(),
      features: GOOGLE_OFF,
    });

    expect(
      (await row("Google")).getByRole("button", { name: "Unlink" }),
    ).toBeInTheDocument();
  });

  it("posts set-link for Set a password and swaps to the check-your-mail sentence", async () => {
    withProfile(googleOnlyProfile());
    const { user } = open();

    await user.click(
      (await row("Password")).getByRole("button", { name: "Set a password" }),
    );

    expect(
      await screen.findByText(
        `Check your inbox: a link for choosing a password is on its way to ${PROFILE.email}. It can be used once and expires.`,
      ),
    ).toBeInTheDocument();
    expect(state.seen.setLinks).toBe(1);
    // Nothing about the account changed: the password is chosen from the
    // mailed link, on `/reset-password`, and never on this screen.
    expect(state.profile.hasPassword).toBe(false);
    expect(
      (await row("Password")).queryByRole("button", { name: "Set a password" }),
    ).toBeNull();
  });

  it("renders a set-link refusal beside the control, which stays pressable", async () => {
    withProfile(googleOnlyProfile());
    server.use(
      http.post(`${API}/profile/password/set-link`, () =>
        fail(429, "RATE_LIMITED"),
      ),
    );
    const { user } = open();

    const password = await row("Password");

    await user.click(password.getByRole("button", { name: "Set a password" }));

    expect(await password.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Wait a moment and try again.",
    );
    expect(
      password.getByRole("button", { name: "Set a password" }),
    ).toBeEnabled();
  });

  it("posts the link start and sends the browser where it answers", async () => {
    const { user } = open();

    await user.click(
      (await row("Google")).getByRole("button", { name: "Link Google" }),
    );

    await waitFor(() => {
      expect(window.open).toHaveBeenCalledWith(
        GOOGLE_AUTHORIZATION_URL,
        "_self",
      );
    });
    expect(state.seen.linkStarts).toEqual([{ locale: "en" }]);
  });

  it("shows the notice on arriving from a finished link that the server lists", async () => {
    withProfile(bothWaysProfile());
    renderApp({
      initialPath: "/auth/google#linked=google",
      store: authenticated(),
      features: GOOGLE_ON,
    });

    expect(
      await screen.findByText(
        "Google is linked. You can sign in with it from now on.",
      ),
    ).toBeInTheDocument();
  });
});

describe("the unlink dialog", () => {
  const openDialog = async () => {
    withProfile(bothWaysProfile());
    const opened = open();

    await opened.user.click(
      (await row("Google")).getByRole("button", { name: "Unlink" }),
    );

    return { ...opened, dialog: within(await screen.findByRole("dialog")) };
  };

  const submit = async (
    user: ReturnType<typeof userEvent.setup>,
    password: string,
  ) => {
    const dialog = within(screen.getByRole("dialog"));

    await user.type(dialog.getByLabelText("Current password"), password);
    await user.click(dialog.getByRole("button", { name: "Unlink Google" }));
  };

  it("keeps itself open with the sentence under the box on a wrong password", async () => {
    const { user } = await openDialog();

    await submit(user, "not-my-password");

    expect(
      await within(screen.getByRole("dialog")).findByText(
        "That is not your current password.",
      ),
    ).toBeInTheDocument();
    expect(state.seen.unlinked).toHaveLength(0);
    expect(state.profile.identities).toHaveLength(1);
  });

  it("keeps itself open with the catalogue's sentence on 409 AUTH_LAST_CREDENTIAL", async () => {
    // A stale screen: the card offered unlink, and the server has since
    // learned the account has no password.
    const { user } = await openDialog();

    server.use(
      http.delete(`${API}/profile/identities/:provider`, () =>
        fail(409, "AUTH_LAST_CREDENTIAL"),
      ),
    );

    await submit(user, CURRENT_PASSWORD);

    expect(
      await within(screen.getByRole("dialog")).findByText(
        "Google is the only way into this account. Set a password first, then you can unlink it.",
      ),
    ).toBeInTheDocument();
  });

  it("posts the current password, closes on 204 and the row is gone", async () => {
    const { user } = await openDialog();

    await submit(user, CURRENT_PASSWORD);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    expect(state.seen.unlinked).toEqual([
      { currentPassword: CURRENT_PASSWORD },
    ]);
    const google = await row("Google");

    expect(await google.findByText("Not linked")).toBeInTheDocument();
    expect(
      google.getByRole("button", { name: "Link Google" }),
    ).toBeInTheDocument();
  });
});

describe("a passwordless account's current-password ceremonies", () => {
  it("replaces Change email on the profile section with the sentence and the control", async () => {
    withProfile(googleOnlyProfile());
    open("/account/profile");

    expect(await screen.findByText(SET_PASSWORD_FIRST)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change email" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Set a password" }),
    ).toBeInTheDocument();
  });

  it("offers Change email once the account has a password", async () => {
    open("/account/profile");

    expect(
      await screen.findByRole("button", { name: "Change email" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(SET_PASSWORD_FIRST)).toBeNull();
  });

  it("replaces Delete account with the sentence and the control", async () => {
    withProfile(googleOnlyProfile());
    open();

    await row("Password");

    const deletion = deletionCard();

    expect(deletion.getByText(SET_PASSWORD_FIRST)).toBeInTheDocument();
    expect(
      deletion.getByRole("button", { name: "Set a password" }),
    ).toBeInTheDocument();
    expect(
      deletion.queryByRole("button", { name: "Delete account" }),
    ).toBeNull();
  });

  it("offers Delete account once the account has a password", async () => {
    open();

    await row("Password");

    const deletion = deletionCard();

    expect(
      deletion.getByRole("button", { name: "Delete account" }),
    ).toBeInTheDocument();
    expect(deletion.queryByText(SET_PASSWORD_FIRST)).toBeNull();
  });
});
