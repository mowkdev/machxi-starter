import { changePasswordBody } from "@repo/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionStore } from "@/shared/api/session-store";
import { API } from "@/test/msw/handlers/auth.handlers";
import {
  CURRENT_PASSWORD,
  PROFILE,
  createProfileHandlers,
  createProfileMockState,
  type ProfileMockState,
} from "@/test/msw/handlers/profile.handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/render";

import {
  ChangePasswordDialog,
  changePasswordFields,
} from "../change-password-dialog";
import { ProfileDetailsForm } from "../profile-details-form";

/**
 * The two profile write flows on the `/user` segment (`D12.6`; ADR-0027,
 * ADR-0035, ADR-0036, ADR-0055 §4).
 *
 * Both go through the real ADR-0033 client to handlers that parse with the
 * API's own schemas, so "the form submits the right thing" means the thing the
 * endpoint would have accepted. The queries are by role and accessible name,
 * and every name here comes from a config rather than from this file.
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
