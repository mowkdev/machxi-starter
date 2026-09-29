import { changeEmailBody, deleteProfileBody } from "@repo/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { profileKeys } from "@/entities/profile";
import { createSessionStore } from "@/shared/api/session-store";
import {
  API,
  createAuthHandlers,
  createAuthMockState,
} from "@/test/msw/handlers/auth.handlers";
import {
  CURRENT_PASSWORD,
  PROFILE,
  createProfileHandlers,
  createProfileMockState,
  type ProfileMockState,
} from "@/test/msw/handlers/profile.handlers";
import { fail, server } from "@repo/app-kit/testing";
import {
  createOrganizationsHandlers,
  createOrganizationsMockState,
} from "@/test/msw/handlers/organizations.handlers";
import { authenticated } from "@/test/principals";
import { renderApp, renderWithProviders } from "@/test/render";

import { ChangeEmailDialog, changeEmailFields } from "../change-email-dialog";
import { deleteAccountFields } from "../delete-account-dialog";
import { ChangePasswordDialog, ProfileDetailsForm } from "../index";

/**
 * A customer's profile on the `/user` segment: the door onto `@repo/account`,
 * bound, and the two flows only this segment has (`D12.6`, `D12.8`, a door
 * since `D22.2`; ADR-0077 §4, ADR-0027, ADR-0028, ADR-0035, ADR-0036,
 * ADR-0055 §4).
 *
 * **The details form and the change-password dialog are the package's and are
 * certified there** — what they render, send, refuse and lock is that suite's,
 * asked once for both apps. What is asked of them here is what this slice
 * *binds*, with the real things: the profile entity over `/user/profile` and
 * handlers that parse with the API's own schemas, this app's field config,
 * its catalogue's sentences, its code map and its `?? ""`. So each keeps a
 * smoke case that would fail on a door bound to the wrong value, and the cases
 * whose claim is the entity's or the segment's: the outcome toasts, the
 * principal in the session store, the session a password change spares,
 * `gcTime: 0`, and the impersonation refusal.
 *
 * **Changing the address and deleting the account did not move**, so their
 * suites are whole. Everything goes through the real ADR-0033 client, the
 * queries are by role and accessible name, and every name here comes from a
 * config rather than from this file.
 *
 * **The deletion suite is the one that leaves this file's usual shape**, and
 * for the reason the flow does: its end state is not a response but a *signed
 * out app*, which only the real route tree can show. So it is driven with
 * `renderApp` from `/account/security` — through the card, the dialog and the
 * redirect — where the others stay component renders.
 */

const NEW_PASSWORD = "AnotherPassword!456";

let state: ProfileMockState;

beforeEach(() => {
  state = createProfileMockState();
  server.use(...createProfileHandlers(state));
});

describe("the details form, bound to the user segment", () => {
  it("renders the fields the entity's config declares, seeded from the account", () => {
    renderWithProviders(<ProfileDetailsForm profile={PROFILE} />);

    expect(screen.getByLabelText("First name")).toHaveValue("Cara");
    expect(screen.getByLabelText("Last name")).toHaveValue("Customer");

    /*
     * The escalation this endpoint's missing `authorize` relies on the schema
     * to refuse (ADR-0019 §3, ADR-0055 §4): there is no control for either of
     * them, so the refusal is never even reached.
     */
    expect(screen.queryByLabelText("Roles")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("shows an empty box rather than the word null for a nameless account", () => {
    /*
     * The live branch this segment has and the staff mirror does not: `users`
     * names are nullable (ADR-0017), so a customer created without one is a
     * real row. A controlled input handed `null` is an uncontrolled one React
     * warns about, and one handed the string would say "null" out loud.
     *
     * Kept at the door because the `?? ""` is the door's own line: the
     * package proves the form shows what `toFormValues` answers, and this
     * proves what this slice's `toFormValues` answers for a real
     * `UserResource`.
     */
    renderWithProviders(
      <ProfileDetailsForm
        profile={{ ...PROFILE, firstName: null, lastName: null }}
      />,
    );

    expect(screen.getByLabelText("First name")).toHaveValue("");
    expect(screen.getByLabelText("Last name")).toHaveValue("");
  });

  it("saves through the profile endpoint and toasts the outcome", async () => {
    const user = userEvent.setup();

    renderWithProviders(<ProfileDetailsForm profile={PROFILE} />);

    await user.type(screen.getByLabelText("Last name"), "s");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    /*
     * The whole of ADR-0034's outcome path, end to end and for the first time
     * in this app: a `meta.success` **key** declared on the mutation, resolved
     * by the one global handler in `@repo/app-kit`'s query client, delivered
     * to the `<Toaster>` the harness mounts. A raw `profile:outcomes.updated`
     * here would mean the translator never reached the cache.
     */
    expect(
      await screen.findByText("Your details were saved."),
    ).toBeInTheDocument();

    // Parsed by the handler with `updateProfileBody`, the half of the
    // contracts pair this door binds: the body is one the endpoint accepts.
    expect(state.seen.updated).toEqual([{ lastName: "Customers" }]);
    expect(state.profile.firstName).toBe("Cara");
  });

  it("puts the renamed customer in the session store the header reads", async () => {
    const user = userEvent.setup();
    const store = createSessionStore();

    store.setSession({
      accessToken: "live-token",
      principal: {
        kind: "user",
        id: PROFILE.id,
        email: PROFILE.email,
        firstName: "Cara",
        lastName: "Customer",
        roles: ["customer"],
      },
    });

    renderWithProviders(<ProfileDetailsForm profile={PROFILE} />, { store });

    await user.clear(screen.getByLabelText("First name"));
    await user.type(screen.getByLabelText("First name"), "Carina");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    /*
     * The account control greets the customer from the *store*, not from this
     * query (ADR-0033 §The session store) — so without the `setPrincipal` in
     * `useUpdateProfile` a customer would rename themselves and go on being
     * greeted by the old name until the next refresh rotated the principal.
     */
    await waitFor(() => {
      expect(store.getSnapshot().principal?.firstName).toBe("Carina");
    });
  });
});

describe("the change-email dialog", () => {
  const NEW_EMAIL = "moved@machxi.local";

  const open = (onClose = vi.fn()) => ({
    onClose,
    ...renderWithProviders(<ChangeEmailDialog onClose={onClose} />),
  });

  it("declares a field map the endpoint's own body accepts", () => {
    /*
     * The contract test a field map owes when it is not a resource's
     * (ADR-0035). `changeEmailBody` is a `strictObject`, so one parse proves
     * both directions: no unknown key, nothing required left unrendered.
     */
    const parsed = changeEmailBody.safeParse({
      newEmail: NEW_EMAIL,
      currentPassword: CURRENT_PASSWORD,
    });

    expect(Object.keys(changeEmailFields)).toEqual([
      "newEmail",
      "currentPassword",
    ]);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("requires the current password before anything is sent", async () => {
    const user = userEvent.setup();

    open();

    await user.type(screen.getByLabelText("New email address"), NEW_EMAIL);
    await user.click(
      screen.getByRole("button", { name: "Send the confirmation link" }),
    );

    /*
     * The rule ADR-0071 §6 inherits from ADR-0027 and leans on hardest: an
     * address change redirects every future recovery link, so an access token
     * that could move one would be worth the account. The client holds the
     * same schema the API validates with (ADR-0011), so the refusal happens
     * without a request at all.
     */
    expect(
      await within(screen.getByRole("dialog")).findByText(/required/i),
    ).toBeInTheDocument();
    expect(state.seen.emailChangeRequests).toHaveLength(0);
  });

  it("sends the change and says a link is on its way, with nothing changed", async () => {
    const user = userEvent.setup();
    const { onClose } = open();

    await user.type(screen.getByLabelText("New email address"), NEW_EMAIL);
    await user.type(
      screen.getByLabelText("Current password"),
      CURRENT_PASSWORD,
    );
    await user.click(
      screen.getByRole("button", { name: "Send the confirmation link" }),
    );

    expect(
      await screen.findByText(
        "A confirmation link is on its way to the new address. Nothing changes until you follow it.",
      ),
    ).toBeInTheDocument();

    expect(state.seen.emailChangeRequests).toEqual([
      { newEmail: NEW_EMAIL, currentPassword: CURRENT_PASSWORD },
    ]);
    // The claim the whole flow rests on, asserted where a client could most
    // easily get it wrong: `202` is not `200`, and the account has not moved.
    expect(state.profile.email).toBe(PROFILE.email);
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("puts a wrong current password under the password box", async () => {
    const user = userEvent.setup();

    open();

    await user.type(screen.getByLabelText("New email address"), NEW_EMAIL);
    await user.type(screen.getByLabelText("Current password"), "not-the-one");
    await user.click(
      screen.getByRole("button", { name: "Send the confirmation link" }),
    );

    /*
     * `AUTH_CURRENT_PASSWORD_INVALID` is a `403` with no `details`, so the
     * field it belongs under is this form's decision (ADR-0027 §Contracts) —
     * and the sentence is the ADR-0034 catalogue's rather than the API's
     * developer-facing message.
     */
    expect(
      await screen.findByText("That is not your current password."),
    ).toBeInTheDocument();
    expect(state.seen.emailChangeRequests).toHaveLength(0);
  });

  it("puts a taken address under the address box", async () => {
    const user = userEvent.setup();

    state.takenEmails.push(NEW_EMAIL);
    open();

    await user.type(screen.getByLabelText("New email address"), NEW_EMAIL);
    await user.type(
      screen.getByLabelText("Current password"),
      CURRENT_PASSWORD,
    );
    await user.click(
      screen.getByRole("button", { name: "Send the confirmation link" }),
    );

    /*
     * The one refusal here that a different value would fix, so it belongs on
     * the box holding that value rather than at the top of the form —
     * `USER_EMAIL_TAKEN` is a `409` with no `details` either, and reaches the
     * field through `codeFields`.
     */
    expect(
      await screen.findByText("That email address is already in use."),
    ).toBeInTheDocument();
    expect(state.seen.emailChangeRequests).toHaveLength(0);
  });

  it("keeps no trace of the password once the mutation has settled", async () => {
    const user = userEvent.setup();
    const { queryClient, unmount } = renderWithProviders(
      <ChangeEmailDialog onClose={vi.fn()} />,
    );

    await user.type(screen.getByLabelText("New email address"), NEW_EMAIL);
    await user.type(
      screen.getByLabelText("Current password"),
      CURRENT_PASSWORD,
    );
    await user.click(
      screen.getByRole("button", { name: "Send the confirmation link" }),
    );

    await waitFor(() => {
      expect(state.seen.emailChangeRequests).toHaveLength(1);
    });

    unmount();

    /*
     * `CREDENTIAL_MUTATION`'s `gcTime: 0`, asserted the way its neighbours
     * are: the customer's password is this mutation's `variables`, and without
     * it the value would sit in the query cache for five minutes after the
     * dialog that collected it is gone.
     */
    await waitFor(() => {
      expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    });
  });
});

describe("the change-password dialog, bound to the user segment", () => {
  const open = (onClose = vi.fn()) => ({
    onClose,
    ...renderWithProviders(<ChangePasswordDialog onClose={onClose} />),
  });

  const submit = async (
    user: ReturnType<typeof userEvent.setup>,
    current = CURRENT_PASSWORD,
  ) => {
    await user.type(screen.getByLabelText("Current password"), current);
    await user.type(screen.getByLabelText("New password"), NEW_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Change password" }));
  };

  it("speaks to a customer: this app's sentences and its code map", async () => {
    const user = userEvent.setup();

    open();

    /*
     * The three sentences the door passes as keys (ADR-0077 §2): a customer
     * is told about *devices*, where an operator is told about sessions.
     */
    expect(
      screen.getByRole("dialog", { name: "Change your password" }),
    ).toHaveAccessibleDescription(
      "Signing out your other devices is the point of a password change, so it is not optional. Nothing will ask you to change it again afterwards.",
    );
    expect(
      screen.getByText(
        "Required even though you are signed in — someone who found this tab open must not be able to set a new password.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Every other device is signed out. This one stays signed in.",
      ),
    ).toBeInTheDocument();

    await submit(user, "NotMyPassword!1");

    // The refusal is the real endpoint's, and the sentence is this app's
    // `errors` catalogue's (ADR-0034) through the code map the door binds.
    expect(
      await screen.findByText("That is not your current password."),
    ).toBeInTheDocument();
    expect(state.password).toBe(CURRENT_PASSWORD);
    // Refused, and recorded as refused — `seen.changed` means accepted.
    expect(state.seen.changed).toHaveLength(0);
    expect(state.seen.refused).toHaveLength(1);
  });

  it("renders the impersonation refusal as catalogue copy", async () => {
    const user = userEvent.setup();

    /*
     * ADR-0057 §5's exclusion list, as this app meets it (`D13.7`). The API
     * refuses the takeover-enabling operations with **one code for the class**
     * — a code per operation would be enum growth with no reader — and the
     * client renders it exactly like any other refusal, over the catalogue
     * entries `D13.3` shipped with the enum.
     *
     * **Nothing in this dialog knows impersonation exists**, and that is the
     * assertion: no `principal.impersonatedBy` read, no hidden control, no
     * pre-flight check. ADR-0042's posture is that the API is the authority
     * and the client renders what it says; a button greyed out here would be a
     * second implementation of the rule that could drift from the first.
     *
     * That a code without a `codeFields` row lands at form level is the
     * package's claim since `D22.2`. What stays here is this segment's: the
     * refusal exists only on `/user`, and the sentence is this catalogue's.
     */
    server.use(
      http.post(`${API}/profile/change-password`, () =>
        fail(403, "AUTH_IMPERSONATION_REFUSED"),
      ),
    );

    open();

    await submit(user);

    // The `errors` catalogue's sentence and not the API's `error.message`,
    // which is a developer-facing English default (ADR-0013, ADR-0046 §2).
    expect(
      await screen.findByText(
        "That cannot be done while impersonating this account. The account holder has to do it themselves.",
      ),
    ).toBeInTheDocument();
    expect(state.password).toBe(CURRENT_PASSWORD);
  });

  it("changes the password, keeps this session, and says both", async () => {
    const user = userEvent.setup();
    const store = createSessionStore();

    store.setSession({ accessToken: "live-token", csrfToken: "live-csrf" });

    renderWithProviders(<ChangePasswordDialog onClose={vi.fn()} />, { store });

    await submit(user);

    expect(
      await screen.findByText(
        "Your password was changed. Every other device was signed out; this one stays.",
      ),
    ).toBeInTheDocument();

    expect(state.password).toBe(NEW_PASSWORD);
    /*
     * The half of ADR-0027 the response cannot show: the other sessions ended
     * and the caller's did not. A client that signed itself out here would be
     * undoing the reason the endpoint spares it — and it is precisely what
     * `D12.8`'s deletion *will* do, which is why this assertion is worth
     * keeping beside that one.
     */
    expect(state.otherSessionsRevoked).toBe(2);
    expect(store.isAuthenticated()).toBe(true);
  });

  it("keeps no trace of either password once the mutation has settled", async () => {
    const user = userEvent.setup();
    const { queryClient, unmount } = renderWithProviders(
      <ChangePasswordDialog onClose={vi.fn()} />,
    );

    await submit(user);

    await waitFor(() => {
      expect(state.password).toBe(NEW_PASSWORD);
    });

    unmount();

    /*
     * `CREDENTIAL_MUTATION`'s `gcTime: 0`, made observable. A settled mutation
     * keeps its `variables` for five minutes by default, so without it both
     * plaintexts would still be reachable from here — and deleting the option
     * is otherwise a silent change that leaves the suite green.
     */
    await waitFor(() => {
      expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    });
  });
});

/**
 * `DELETE /user/profile` — a customer closing their own account (`D12.8`;
 * ADR-0028's user semantics, ADR-0055 §4).
 *
 * **Driven through the real generated tree rather than as a component**, which
 * is the one place this file departs from its own pattern. The flow's end state
 * is a *signed-out app*: the store is cleared, the router is invalidated and
 * the customer is put on `/login`. A component render has no router, so
 * `useNavigate` would have nothing to navigate — the success path would be
 * either untested or tested against a stub of the very thing that has to work.
 * So the suite starts at `/account/security` and clicks the card the section
 * ships, which also means the card and the dialog are proved to be connected.
 */
describe("deleting the account", () => {
  beforeEach(() => {
    // The tree renders the shell and, after the redirect, the login screen.
    // Neither fetches today; a handler set missing the segment's auth routes
    // would fail loudly rather than quietly if that ever changes.
    server.use(
      ...createAuthHandlers(createAuthMockState()),
      /*
       * The switcher reads `GET /user/orgs` from the shell's header (`D15.5`,
       * ADR-0067 §6), so every screen behind the guard makes this request —
       * including the ones this file is about, which never mention an
       * organization. Answered rather than left unhandled, because a suite whose
       * shell is half-failed is a suite certifying a screen nobody ships.
       */
      ...createOrganizationsHandlers(createOrganizationsMockState()),
    );
  });

  const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
    const rendered = renderApp({
      initialPath: "/account/security",
      store: authenticated(),
    });

    await user.click(
      await screen.findByRole("button", { name: "Delete account" }),
    );
    await screen.findByRole("dialog");

    return rendered;
  };

  /** The submit inside the dialog — the card's button shares its wording. */
  const confirm = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete account",
      }),
    );

  it("declares a field map the endpoint's own body accepts", () => {
    /*
     * The contract test a field map owes when it is not a resource's
     * (ADR-0035). `deleteProfileBody` is a `strictObject`, so one parse proves
     * both directions at once — and the second direction is what matters most
     * here: a field naming a subject would be refused, which is the one thing
     * that could ever turn self-deletion into deleting somebody else.
     */
    const parsed = deleteProfileBody.safeParse(
      Object.fromEntries(
        Object.keys(deleteAccountFields).map((name) => [
          name,
          CURRENT_PASSWORD,
        ]),
      ),
    );

    expect(Object.keys(deleteAccountFields)).toEqual(["currentPassword"]);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("states ADR-0028's consequences rather than implying an erasure", async () => {
    const user = userEvent.setup();

    await openDialog(user);

    const dialog = within(screen.getByRole("dialog"));

    /*
     * The four sentences, asserted because deletion on this segment is *not*
     * what the word usually implies: the row survives, the address is released
     * by the partial unique index, every session ends including this one, and
     * v1 has no restore endpoint. A customer agreeing to the wrong thing is
     * the failure this dialog exists to prevent, so the copy is part of the
     * contract rather than decoration around it.
     */
    expect(
      dialog.getByText("Every device is signed out, including this one."),
    ).toBeInTheDocument();
    expect(
      dialog.getByText(
        "The account is closed and can no longer be used to sign in.",
      ),
    ).toBeInTheDocument();
    expect(
      dialog.getByText(
        "Your email address becomes free to sign up with again.",
      ),
    ).toBeInTheDocument();
    expect(
      dialog.getByText(
        "We keep the record of the account itself; it is not erased, and nothing here can reopen it.",
      ),
    ).toBeInTheDocument();
  });

  it("sends nothing until the current password is given", async () => {
    const user = userEvent.setup();

    await openDialog(user);
    await confirm(user);

    /*
     * ADR-0055 §4's re-authentication, refused by the client with the schema
     * the server validates with (ADR-0011) — so an empty box never becomes a
     * request at all. The dialog is still open afterwards, which is the other
     * half: a refusal that closed it would look exactly like a deletion.
     */
    await waitFor(() => {
      expect(screen.getByLabelText("Current password")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });
    expect(state.seen.deleted).toHaveLength(0);
    expect(state.profile.deletedAt).toBeNull();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("lands a wrong current password in the dialog, on the box that has to change", async () => {
    const user = userEvent.setup();
    const { store } = await openDialog(user);

    await user.type(
      screen.getByLabelText("Current password"),
      "NotMyPassword!1",
    );
    await confirm(user);

    /*
     * `AUTH_CURRENT_PASSWORD_INVALID` is a `403` with no `details` (ADR-0027
     * §Contracts), so it reaches the box through `codeFields` and reads as the
     * catalogue's sentence rather than as the API's developer-facing English.
     * **In the dialog**, which is the done-when's word: a refusal delivered as
     * a toast over a closed dialog would leave a customer unsure whether the
     * account is gone.
     */
    expect(
      await screen.findByText("That is not your current password."),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    /*
     * Refused, and nothing else happened: the credential check runs before any
     * state change, because half a deletion is worse than none — and the
     * session it refused is still the customer's own.
     */
    expect(state.seen.refusedDeletes).toHaveLength(1);
    expect(state.seen.deleted).toHaveLength(0);
    expect(state.profile.deletedAt).toBeNull();
    expect(state.profile.status).toBe("active");
    expect(state.allSessionsRevoked).toBe(false);
    expect(store.isAuthenticated()).toBe(true);
  });

  it("locks the dialog while the request is in flight", async () => {
    const user = userEvent.setup();

    server.use(
      http.delete(`${API}/profile`, async () => {
        await delay("infinite");
      }),
    );

    await openDialog(user);

    await user.type(
      screen.getByLabelText("Current password"),
      CURRENT_PASSWORD,
    );
    await confirm(user);

    await waitFor(() => {
      expect(screen.getByLabelText("Current password")).toBeDisabled();
    });

    /*
     * ADR-0048 §4's `dismissible={!isPending}`, and it earns more here than
     * anywhere else in the app: the request in flight is the one that ends the
     * account, so a dialog that could be escaped mid-flight would leave
     * somebody on a screen whose session is already gone.
     */
    await user.keyboard("{Escape}");

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps no trace of the password once the mutation has settled", async () => {
    const user = userEvent.setup();
    const { queryClient } = await openDialog(user);

    await user.type(
      screen.getByLabelText("Current password"),
      CURRENT_PASSWORD,
    );
    await confirm(user);

    await waitFor(() => {
      expect(state.seen.deleted).toHaveLength(1);
    });

    /*
     * `CREDENTIAL_MUTATION`'s `gcTime: 0`, made observable: a settled mutation
     * keeps its `variables` for five minutes by default, so without it the
     * plaintext would still be reachable from the cache of a tab whose account
     * no longer exists.
     */
    await waitFor(() => {
      expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    });
  });

  it("closes the account, ends this session and lands on /login", async () => {
    const user = userEvent.setup();
    const { router, store, queryClient } = await openDialog(user);

    /*
     * Seeded rather than fetched: the security section mounts no profile
     * query, and what the last assertion is about is the cache entry the
     * *profile* section would have left behind on the way here.
     */
    queryClient.setQueryData(profileKeys.detail(), PROFILE);

    await user.type(
      screen.getByLabelText("Current password"),
      CURRENT_PASSWORD,
    );
    await confirm(user);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
    });

    /*
     * Plainly `/login`, and not the guard's `?redirect=/account/security`:
     * clearing the store invalidates the router and `_dashboard` would bounce
     * the customer anyway, but landing there is stated by the feature rather
     * than left to be an emergent property of two other decisions — otherwise
     * the next person to sign in on this browser is sent to the closed
     * account's security section.
     */
    expect(router.state.location.search).toEqual({});

    /*
     * ADR-0028's user semantics on the server's side of the wire: the row
     * survives with both columns written, and **every** session went — the
     * caller's included, which is the whole difference from the password
     * change asserted above.
     */
    expect(state.seen.deleted).toHaveLength(1);
    expect(state.profile.deletedAt).not.toBeNull();
    expect(state.profile.status).toBe("disabled");
    expect(state.allSessionsRevoked).toBe(true);

    // And the client's half of it (ADR-0055 §4 as amended at `D12.4`): the
    // server cleared the cookies, this clears the token and the principal the
    // guards read.
    expect(store.isAuthenticated()).toBe(false);
    expect(store.getSnapshot().principal).toBeNull();

    /*
     * The outcome sentence, read on the screen the customer was sent to —
     * which is only possible because ADR-0034's `<Toaster>` is mounted on the
     * root route, above both layouts.
     */
    expect(
      await screen.findByText(
        "Your account is closed. You have been signed out on every device.",
      ),
    ).toBeInTheDocument();

    /*
     * The cached read of an account that no longer exists is dropped rather
     * than invalidated: a refetch would be answered `401` by the endpoint whose
     * session this same call revoked, and the entry would otherwise still be
     * sitting there for whoever signs in on this browser next.
     */
    expect(queryClient.getQueryData(profileKeys.detail())).toBeUndefined();
  });
});
