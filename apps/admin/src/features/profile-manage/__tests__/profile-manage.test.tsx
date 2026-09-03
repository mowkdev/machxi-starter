import { changePasswordBody } from "@repo/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { staffKeys } from "@/entities/staff";
import { createSessionStore } from "@/shared/api/session-store";
import { API } from "@/test/msw/handlers/auth.handlers";
import {
  CURRENT_PASSWORD,
  PROFILE,
  createProfileHandlers,
  createProfileMockState,
  type ProfileMockState,
} from "@/test/msw/handlers/profile.handlers";
import { server } from "@repo/app-kit/testing";
import { renderWithProviders } from "@/test/render";

import {
  ChangePasswordDialog,
  changePasswordFields,
} from "../change-password-dialog";
import { ProfileDetailsForm } from "../profile-details-form";

/**
 * The two profile write flows (`D3.9`; ADR-0027, ADR-0035, ADR-0036).
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

    expect(screen.getByLabelText("First name")).toHaveValue("Ada");
    expect(screen.getByLabelText("Last name")).toHaveValue("Admin");

    /*
     * The escalation this endpoint's missing `authorize` relies on the schema
     * to refuse (ADR-0019 section 3, ADR-0027): there is no control for either
     * of them, so the refusal is never even reached.
     */
    expect(screen.queryByLabelText("Roles")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("offers no submit until something has actually changed", async () => {
    const user = userEvent.setup();

    renderWithProviders(<ProfileDetailsForm profile={PROFILE} />);

    const save = screen.getByRole("button", { name: "Save changes" });

    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("First name"), "x");

    expect(save).toBeEnabled();
  });

  it("sends only the field the operator changed", async () => {
    const user = userEvent.setup();

    renderWithProviders(<ProfileDetailsForm profile={PROFILE} />);

    await user.clear(screen.getByLabelText("First name"));
    await user.type(screen.getByLabelText("First name"), "Adaline");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(state.seen.updated).toHaveLength(1);
    });

    // Pruned to `dirtyFields`, so the untouched last name is not re-sent — a
    // re-send would overwrite whatever a second admin changed in the meantime,
    // and it is what makes the contract's "at least one field" mean an edit.
    expect(state.seen.updated[0]).toEqual({ firstName: "Adaline" });
    expect(state.profile.lastName).toBe("Admin");
  });

  it("toasts the outcome and goes clean again", async () => {
    const user = userEvent.setup();

    renderWithProviders(<ProfileDetailsForm profile={PROFILE} />);

    await user.type(screen.getByLabelText("Last name"), "s");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText("Your profile was updated."),
    ).toBeInTheDocument();

    // The saved values are the new baseline: nothing left to submit.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Save changes" }),
      ).toBeDisabled();
    });
  });

  it("invalidates the operator's own row in the staff cache", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithProviders(
      <ProfileDetailsForm profile={PROFILE} />,
    );

    queryClient.setQueryData(staffKeys.detail(PROFILE.id), PROFILE);

    await user.type(screen.getByLabelText("First name"), "x");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    /*
     * The acting operator is a staff row too, and this write changed its names.
     * ADR-0032 stops the *entity* reaching `staffKeys`; the feature is the layer
     * that may see both, which is where the invalidation lives.
     */
    await waitFor(() => {
      expect(
        queryClient.getQueryState(staffKeys.detail(PROFILE.id))?.isInvalidated,
      ).toBe(true);
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
     * the operator cannot type into it.
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
     * The contract test a field map owes when it is not a resource's (ADR-0035,
     * amended D3.7). `changePasswordBody` is a `strictObject`, so one parse
     * proves both directions: no unknown key, nothing required left unrendered.
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
     * The inverse of the D3.7 finding. There both boxes held the *subject's*
     * credential and `new-password` would have filed somebody else's password
     * into the acting admin's vault; here both belong to the person typing, so
     * the browser is allowed to offer to save the new one.
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
    // client validates with the schema the server validates with (ADR-0011).
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
        "Your password was changed. Every other session was signed out; this one stays.",
      ),
    ).toBeInTheDocument();

    expect(state.password).toBe(NEW_PASSWORD);
    // The half of ADR-0027 the response cannot show: the other sessions ended
    // and the caller's did not. A client that signed itself out here would be
    // undoing the reason the endpoint spares it.
    expect(state.otherSessionsRevoked).toBe(2);
    expect(store.isAuthenticated()).toBe(true);
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
     * `CREDENTIAL_MUTATION`'s `gcTime: 0`, made observable (D3.9 review). A
     * settled mutation keeps its `variables` for five minutes by default, so
     * without it both plaintexts would still be reachable from here — and
     * deleting the option is otherwise a silent change that leaves the suite
     * green.
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
