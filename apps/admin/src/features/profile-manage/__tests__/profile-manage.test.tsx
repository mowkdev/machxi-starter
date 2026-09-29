import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { staffKeys } from "@/entities/staff";
import { createSessionStore } from "@/shared/api/session-store";
import {
  CURRENT_PASSWORD,
  PROFILE,
  createProfileHandlers,
  createProfileMockState,
  type ProfileMockState,
} from "@/test/msw/handlers/profile.handlers";
import { server } from "@repo/app-kit/testing";
import { renderWithProviders } from "@/test/render";

import { ChangePasswordDialog, ProfileDetailsForm } from "../index";

/**
 * The operator's profile door, bound (`D3.9`, a door since `D22.2`; ADR-0077
 * §4, ADR-0027, ADR-0036).
 *
 * **The two forms are `@repo/account`'s and are certified there** — what they
 * render, send, refuse and lock is that package's suite, asked once for both
 * apps. What is asked here is what this slice *binds*, with the real things:
 * the profile entity over `/admin/profile` and handlers that parse with the
 * API's own schemas, this app's field config, its catalogue's sentences, its
 * code map, and the one thing only this segment has — the acting operator is
 * also a row in `/admin/staff`, so both writes invalidate it.
 *
 * So each form keeps a smoke case that would fail on a door bound to the
 * wrong value, and the cases whose claim is the entity's: the outcome toasts,
 * the session a password change spares, and `gcTime: 0`.
 */

const NEW_PASSWORD = "AnotherPassword!456";

let state: ProfileMockState;

beforeEach(() => {
  state = createProfileMockState();
  server.use(...createProfileHandlers(state));
});

describe("the details form, bound to the admin segment", () => {
  it("renders the fields the entity's config declares, seeded from the account", () => {
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

  it("saves through the profile endpoint and toasts the outcome", async () => {
    const user = userEvent.setup();

    renderWithProviders(<ProfileDetailsForm profile={PROFILE} />);

    await user.type(screen.getByLabelText("Last name"), "s");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    // The entity's `meta.success`, in this app's catalogue's words.
    expect(
      await screen.findByText("Your profile was updated."),
    ).toBeInTheDocument();

    // Parsed by the handler with `updateStaffProfileBody`, the half of the
    // contracts pair this door binds: the body is one the endpoint accepts.
    expect(state.seen.updated).toEqual([{ lastName: "Admins" }]);
    expect(state.profile.firstName).toBe("Ada");
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
     * that may see both, which is where the invalidation lives — bound as the
     * form's `useAfterSave`.
     */
    await waitFor(() => {
      expect(
        queryClient.getQueryState(staffKeys.detail(PROFILE.id))?.isInvalidated,
      ).toBe(true);
    });
  });
});

describe("the change-password dialog, bound to the admin segment", () => {
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

  it("speaks to an operator: this app's sentences and its code map", async () => {
    const user = userEvent.setup();

    open();

    /*
     * The three sentences the door passes as keys (ADR-0077 §2): an operator
     * is told about *sessions*, where a customer is told about devices.
     */
    expect(
      screen.getByRole("dialog", { name: "Change your password" }),
    ).toHaveAccessibleDescription(
      "Signing out your other sessions is the point of a password change, so it is not optional. Nothing forces a change again afterwards.",
    );
    expect(
      screen.getByText(
        "Required even though you are signed in — a stolen session must not be able to set a new password.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Every other session is signed out. This one stays signed in.",
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

  it("changes the password, keeps this session, and says both", async () => {
    const user = userEvent.setup();
    const store = createSessionStore();

    store.setSession({ accessToken: "live-token", csrfToken: "live-csrf" });

    renderWithProviders(<ChangePasswordDialog onClose={vi.fn()} />, { store });

    await submit(user);

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

  it("invalidates the operator's own row after a password change too", async () => {
    const user = userEvent.setup();
    const { queryClient } = open();

    queryClient.setQueryData(staffKeys.detail(PROFILE.id), PROFILE);

    await submit(user);

    // The password write stamps `updatedAt` on the same row (ADR-0034
    // §Invalidation, amended D3.9) — bound as the dialog's `useAfterChange`.
    await waitFor(() => {
      expect(
        queryClient.getQueryState(staffKeys.detail(PROFILE.id))?.isInvalidated,
      ).toBe(true);
    });
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
});
