import { changePasswordBody, deleteProfileBody } from "@repo/contracts";
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
import { server } from "@/test/msw/server";
import { authenticated } from "@/test/principals";
import { renderApp, renderWithProviders } from "@/test/render";

import {
  ChangePasswordDialog,
  changePasswordFields,
} from "../change-password-dialog";
import { deleteAccountFields } from "../delete-account-dialog";
import { ProfileDetailsForm } from "../profile-details-form";

/**
 * The three profile write flows on the `/user` segment (`D12.6`, `D12.8`;
 * ADR-0027, ADR-0028, ADR-0035, ADR-0036, ADR-0055 §4).
 *
 * All three go through the real ADR-0033 client to handlers that parse with the
 * API's own schemas, so "the form submits the right thing" means the thing the
 * endpoint would have accepted. The queries are by role and accessible name,
 * and every name here comes from a config rather than from this file.
 *
 * **The deletion suite is the one that leaves this file's usual shape**, and
 * for the reason the flow does: its end state is not a response but a *signed
 * out app*, which only the real route tree can show. So it is driven with
 * `renderApp` from `/account/security` — through the card, the dialog and the
 * redirect — where the other two stay component renders.
 */

const NEW_PASSWORD = "AnotherPassword!456";

let state: ProfileMockState;

beforeEach(() => {
  state = createProfileMockState();
  server.use(...createProfileHandlers(state));
});

describe("the details form", () => {
  it("renders the fields the config declares, seeded from the account", () => {
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
     */
    renderWithProviders(
      <ProfileDetailsForm
        profile={{ ...PROFILE, firstName: null, lastName: null }}
      />,
    );

    expect(screen.getByLabelText("First name")).toHaveValue("");
    expect(screen.getByLabelText("Last name")).toHaveValue("");
  });

  it("offers no submit until something has actually changed", async () => {
    const user = userEvent.setup();

    renderWithProviders(<ProfileDetailsForm profile={PROFILE} />);

    const save = screen.getByRole("button", { name: "Save changes" });

    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("First name"), "x");

    expect(save).toBeEnabled();
  });

  it("sends only the field the customer changed", async () => {
    const user = userEvent.setup();

    renderWithProviders(<ProfileDetailsForm profile={PROFILE} />);

    await user.clear(screen.getByLabelText("First name"));
    await user.type(screen.getByLabelText("First name"), "Carina");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(state.seen.updated).toHaveLength(1);
    });

    // Pruned to `dirtyFields`, so the untouched surname is not re-sent — which
    // is what makes the contract's "at least one field" mean an edit.
    expect(state.seen.updated[0]).toEqual({ firstName: "Carina" });
    expect(state.profile.lastName).toBe("Customer");
  });

  it("toasts the outcome and goes clean again", async () => {
    const user = userEvent.setup();

    renderWithProviders(<ProfileDetailsForm profile={PROFILE} />);

    await user.type(screen.getByLabelText("Last name"), "s");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    /*
     * The whole of ADR-0034's outcome path, end to end and for the first time
     * in this app: a `meta.success` **key** declared on the mutation, resolved
     * by the one global handler in `app/providers/query-client.ts`, delivered
     * to the `<Toaster>` the harness mounts. A raw `profile:outcomes.updated`
     * here would mean the translator never reached the cache.
     */
    expect(
      await screen.findByText("Your details were saved."),
    ).toBeInTheDocument();

    // The saved values are the new baseline: nothing left to submit.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Save changes" }),
      ).toBeDisabled();
    });
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

  it("lands a server refusal on the field it names", async () => {
    const user = userEvent.setup();

    server.use(
      http.patch(`${API}/profile`, () =>
        Response.json(
          {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Validation failed",
              details: [{ path: "firstName", message: "Too short" }],
            },
            meta: { requestId: "00000000-0000-7000-8000-000000000000" },
          },
          { status: 422 },
        ),
      ),
    );

    renderWithProviders(<ProfileDetailsForm profile={PROFILE} />);

    await user.type(screen.getByLabelText("First name"), "x");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    /*
     * ADR-0013 puts a zod issue's field path in `details`, and
     * `applyServerErrors` is entirely about where those paths land: beside the
     * box, not in a toast. The sentence is the *client's* — `schemaFieldRules`
     * answers a path the form can validate itself, because the wire's English
     * is the API's and not necessarily the customer's (ADR-0046 §6).
     */
    const field = await screen.findByLabelText("First name");

    await waitFor(() => {
      expect(field).toHaveAttribute("aria-invalid", "true");
    });
  });

  it("locks every field while the request is in flight", async () => {
    const user = userEvent.setup();

    // Held open, because otherwise the request settles before the assertion
    // and the test would pass on a form that never locked at all.
    server.use(
      http.patch(`${API}/profile`, async () => {
        await delay("infinite");
      }),
    );

    renderWithProviders(<ProfileDetailsForm profile={PROFILE} />);

    await user.type(screen.getByLabelText("First name"), "x");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    /*
     * The `fieldset disabled aria-busy` half of ADR-0035's submit lock — the
     * half this form assembles by hand because it is not in a dialog. Asserted
     * on the control rather than on the fieldset, because what matters is that
     * the customer cannot type into it.
     */
    await waitFor(() => {
      expect(screen.getByLabelText("First name")).toBeDisabled();
    });
  });
});

describe("the change-password dialog", () => {
  const open = (onClose = vi.fn()) => ({
    onClose,
    ...renderWithProviders(<ChangePasswordDialog onClose={onClose} />),
  });

  it("declares a field map the endpoint's own body accepts", () => {
    /*
     * The contract test a field map owes when it is not a resource's
     * (ADR-0035). `changePasswordBody` is a `strictObject`, so one parse proves
     * both directions: no unknown key, nothing required left unrendered.
     */
    const parsed = changePasswordBody.safeParse(
      Object.fromEntries(
        Object.keys(changePasswordFields).map((name) => [
          name,
          name === "currentPassword" ? CURRENT_PASSWORD : NEW_PASSWORD,
        ]),
      ),
    );

    expect(Object.keys(changePasswordFields)).toEqual([
      "currentPassword",
      "newPassword",
    ]);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("tells the browser the truth about whose passwords these are", () => {
    open();

    /*
     * Both boxes hold the credential of the person typing, so the browser is
     * allowed to offer to save the new one — the "save this password?" prompt
     * is the correct outcome here rather than a third party's credential
     * leaking into somebody else's vault, which is why the admin's two
     * administrative reset forms refuse the same hints.
     */
    expect(screen.getByLabelText("Current password")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    expect(screen.getByLabelText("New password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
  });

  it("refuses a new password equal to the current one before anything is sent", async () => {
    const user = userEvent.setup();

    open();

    await user.type(
      screen.getByLabelText("Current password"),
      CURRENT_PASSWORD,
    );
    await user.type(screen.getByLabelText("New password"), CURRENT_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Change password" }));

    // `changePasswordBody`'s own refinement, rendered by the client because the
    // client validates with the schema the server validates with (ADR-0011),
    // and read out of `@repo/form`'s `form` namespace — this app's first.
    expect(
      await screen.findByText(
        "The new password must differ from the current one",
      ),
    ).toBeInTheDocument();
    expect(state.seen.changed).toHaveLength(0);
  });

  it("lands a wrong current password on the box that has to change", async () => {
    const user = userEvent.setup();

    open();

    await user.type(
      screen.getByLabelText("Current password"),
      "NotMyPassword!1",
    );
    await user.type(screen.getByLabelText("New password"), NEW_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Change password" }));

    /*
     * `AUTH_CURRENT_PASSWORD_INVALID` is a `403` with no `details` — the
     * condition belongs to the credential check, not to a field (ADR-0027
     * §Contracts) — so it reaches the right box through `codeFields` rather
     * than through a path, and reads as the ADR-0034 catalogue sentence rather
     * than as the API's developer-facing message.
     */
    expect(
      await screen.findByText("That is not your current password."),
    ).toBeInTheDocument();
    expect(state.password).toBe(CURRENT_PASSWORD);
    // Refused, and recorded as refused — `seen.changed` means accepted.
    expect(state.seen.changed).toHaveLength(0);
    expect(state.seen.refused).toHaveLength(1);
  });

  it("changes the password, keeps this session, and says both", async () => {
    const user = userEvent.setup();
    const store = createSessionStore();

    store.setSession({ accessToken: "live-token", csrfToken: "live-csrf" });

    renderWithProviders(<ChangePasswordDialog onClose={vi.fn()} />, { store });

    await user.type(
      screen.getByLabelText("Current password"),
      CURRENT_PASSWORD,
    );
    await user.type(screen.getByLabelText("New password"), NEW_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Change password" }));

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

  it("locks the dialog while the request is in flight", async () => {
    const user = userEvent.setup();

    server.use(
      http.post(`${API}/profile/change-password`, async () => {
        await delay("infinite");
      }),
    );

    open();

    await user.type(
      screen.getByLabelText("Current password"),
      CURRENT_PASSWORD,
    );
    await user.type(screen.getByLabelText("New password"), NEW_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Change password" }));

    /*
     * ADR-0048 §4's `dismissible={!isPending}`: a form that locks its fields
     * and then lets you close the window has not locked anything, so the shell
     * withholds `onOpenChange`, Escape and the corner button rather than
     * offering a close it would refuse.
     */
    await waitFor(() => {
      expect(screen.getByLabelText("Current password")).toBeDisabled();
    });

    await user.keyboard("{Escape}");

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps no trace of either password once the mutation has settled", async () => {
    const user = userEvent.setup();
    const { queryClient, unmount } = renderWithProviders(
      <ChangePasswordDialog onClose={vi.fn()} />,
    );

    await user.type(
      screen.getByLabelText("Current password"),
      CURRENT_PASSWORD,
    );
    await user.type(screen.getByLabelText("New password"), NEW_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Change password" }));

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

  it("closes once the change has landed", async () => {
    const user = userEvent.setup();
    const { onClose } = open();

    await user.type(
      screen.getByLabelText("Current password"),
      CURRENT_PASSWORD,
    );
    await user.type(screen.getByLabelText("New password"), NEW_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
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
    server.use(...createAuthHandlers(createAuthMockState()));
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
