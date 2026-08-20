import { setPasswordBody } from "@repo/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { API } from "@/test/msw/handlers/auth.handlers";
import { fail } from "@/test/msw/handlers/envelope";
import {
  STAFF_ROWS,
  createStaffHandlers,
  createStaffMockState,
  type StaffMockState,
} from "@/test/msw/handlers/staff.handlers";
import {
  createSessionStore,
  type SessionStore,
} from "@/shared/api/session-store";
import { server } from "@/test/msw/server";
import { renderApp, renderWithProviders } from "@/test/render";

import { passwordFields } from "../reset-staff-password-dialog";
import { StaffDialogs } from "../staff-dialogs";
import type { StaffAction } from "../types";

/**
 * The staff write flows (`D3.7`; ADR-0027, ADR-0028, ADR-0035, ADR-0036).
 *
 * Each dialog is rendered through `StaffDialogs`, which is how the page mounts
 * it — so what is under test is the composition that ships, not a component
 * assembled by the test. Every request goes through the real ADR-0033 client to
 * MSW handlers that parse it with the API's own schemas, so "the form submits
 * the right thing" means the thing the endpoint would have accepted.
 *
 * Queries are by role and accessible name throughout (ADR-0036): a control the
 * suite cannot name is a control a screen reader cannot name either, and every
 * name below came from the resource config rather than from this file.
 */

const [ADA, MO] = STAFF_ROWS;

if (ADA === undefined || MO === undefined) throw new Error("fixture missing");

let state: StaffMockState;

const open = (action: StaffAction, onClose = vi.fn()) => {
  const result = renderWithProviders(
    <StaffDialogs action={action} onClose={onClose} />,
  );

  return { ...result, onClose };
};

/**
 * The two routed surfaces are entered **through the router** (`D4.2`,
 * ADR-0040), and that is the point rather than a mechanical consequence.
 *
 * Create and edit are addressable now: a URL is what opens them, a reload
 * restores them, and Back closes them. A test that mounted the component
 * directly would still pass while every one of those was broken — so these
 * two mount the real generated route tree at the real path, and the surface
 * appearing *is* the assertion that the route, the loader and the config's
 * shell choice all agree. The confirms below stay on `renderWithProviders`,
 * because ADR-0040 deliberately keeps them out of the URL.
 */
const signedIn = (): SessionStore => {
  const store = createSessionStore();

  store.setSession({ accessToken: "test-access-token" });

  return store;
};

const openCreate = async () => {
  const result = renderApp({ initialPath: "/staff/new", store: signedIn() });

  // Awaited, because a route resolves asynchronously: the surface being on
  // screen is what says the path matched and the shell rendered.
  await screen.findByRole("button", { name: "Create" });

  return result;
};

const openRecord = async (id: string) => {
  const result = renderApp({ initialPath: `/staff/${id}`, store: signedIn() });

  // The loader has to settle before the form exists, which is the loader being
  // asserted rather than assumed.
  await screen.findByRole("button", { name: "Save changes" });

  return result;
};

/**
 * The surface has closed when the control that submits it is gone.
 *
 * Closing is a navigation now, so there is no `onClose` spy to assert on —
 * which is a better test: it observes what the operator observes rather than
 * that a callback fired.
 */
const closed = async (submitLabel: string) => {
  await waitFor(() => {
    expect(
      screen.queryByRole("button", { name: submitLabel }),
    ).not.toBeInTheDocument();
  });
};

beforeEach(() => {
  state = createStaffMockState();
  server.use(...createStaffHandlers(state));
});

describe("the create surface", () => {
  it("renders exactly the fields the config puts in the create variant", async () => {
    await openCreate();

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Initial password")).toBeInTheDocument();
    expect(screen.getByLabelText("First name")).toBeInTheDocument();
    expect(screen.getByLabelText("Last name")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Roles" })).toBeInTheDocument();

    /*
     * `status` is placed in the JSX and absent from the screen, because the
     * config says `variants: ["edit"]` — the create endpoint takes no status
     * (ADR-0018 creates staff `active`). One placement, two forms, and the
     * config is what decides.
     */
    expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
  });

  it("starts from the config's initial values", async () => {
    await openCreate();

    // `roles: { initialValue: ["editor"] }` — declared once, on the resource.
    expect(screen.getByRole("checkbox", { name: "Editor" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Admin" })).not.toBeChecked();
  });

  it("validates with the contract's own schema before anything is sent", async () => {
    const user = userEvent.setup();

    await openCreate();

    await user.type(screen.getByLabelText("Email"), "ada@machxi.local");
    // Six characters: under `MIN_PASSWORD_LENGTH`, so `createStaffBody`
    // refuses it — the same object the API validates with (ADR-0011/0023).
    await user.type(screen.getByLabelText("Initial password"), "short");
    await user.type(screen.getByLabelText("First name"), "Ada");
    await user.type(screen.getByLabelText("Last name"), "Admin");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Initial password")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });
    expect(state.seen.created).toHaveLength(0);
  });

  it("sends the created staff member and closes", async () => {
    const user = userEvent.setup();
    await openCreate();

    await user.type(screen.getByLabelText("Email"), "new@machxi.local");
    await user.type(
      screen.getByLabelText("Initial password"),
      "DevPassword!123",
    );
    await user.type(screen.getByLabelText("First name"), "New");
    await user.type(screen.getByLabelText("Last name"), "Operator");
    await user.click(screen.getByRole("checkbox", { name: "Manager" }));
    await user.click(screen.getByRole("button", { name: "Create" }));

    await closed("Create");
    expect(state.seen.created[0]).toEqual({
      email: "new@machxi.local",
      password: "DevPassword!123",
      firstName: "New",
      lastName: "Operator",
      // The multi-checkbox seeded from config, plus the box the operator ticked.
      roles: ["editor", "manager"],
    });
  });

  it("lands STAFF_EMAIL_TAKEN on the email field, not at the top of the form", async () => {
    const user = userEvent.setup();
    await openCreate();

    // `ada@machxi.local` already exists in the fixture, so the handler answers
    // the real `409` — a conflict with no `details`, which is exactly the case
    // the config's `errorFields` exists for.
    await user.type(screen.getByLabelText("Email"), ADA.email);
    await user.type(
      screen.getByLabelText("Initial password"),
      "DevPassword!123",
    );
    await user.type(screen.getByLabelText("First name"), "Ada");
    await user.type(screen.getByLabelText("Last name"), "Admin");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(
      await screen.findByText(
        "Another staff member already uses that email address.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText("Email")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });
    // Still open: a refused submit must leave the operator on their work.
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  it("shows a detail naming a field this variant does not render", async () => {
    const user = userEvent.setup();

    server.use(
      http.post(`${API}/staff`, () =>
        /*
         * `status` is a real field of the resource and is **edit-only**, so the
         * create form does not render it. The regression this guards: passing
         * `applyServerErrors` the resource's whole field map made it call
         * `setError("status")` on a control that is not on screen, report that
         * something landed, and skip the `root.server` fallback — a submit that
         * failed and said why to nobody. Each dialog now passes its own
         * variant's names, so a detail it cannot place is shown at the top of
         * the form.
         */
        fail(400, "VALIDATION_ERROR", "Invalid", [
          { path: "status", message: "Status is not accepted here" },
        ]),
      ),
    );

    await openCreate();

    await user.type(screen.getByLabelText("Email"), "new@machxi.local");
    await user.type(
      screen.getByLabelText("Initial password"),
      "DevPassword!123",
    );
    await user.type(screen.getByLabelText("First name"), "New");
    await user.type(screen.getByLabelText("Last name"), "Operator");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(
      await screen.findByText(
        "Some of the details are not valid. Check the form and try again.",
      ),
    ).toBeInTheDocument();
  });

  it("disables every field while the request is in flight", async () => {
    const user = userEvent.setup();

    server.use(
      http.post(`${API}/staff`, async () => {
        // Never settles, so the pending state is observable rather than raced.
        await delay("infinite");
      }),
    );

    await openCreate();

    await user.type(screen.getByLabelText("Email"), "new@machxi.local");
    await user.type(
      screen.getByLabelText("Initial password"),
      "DevPassword!123",
    );
    await user.type(screen.getByLabelText("First name"), "New");
    await user.type(screen.getByLabelText("Last name"), "Operator");
    await user.click(screen.getByRole("button", { name: "Create" }));

    // All three halves of the ADR-0035 submit lock at once: RHF's `disabled`,
    // the `FieldSet`, and the button.
    await waitFor(() => {
      expect(screen.getByLabelText("Email")).toBeDisabled();
    });
    expect(screen.getByLabelText("Initial password")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Editor" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});

describe("the edit surface", () => {
  it("renders the edit variant, seeded from the record the loader fetched", async () => {
    await openRecord(MO.id);

    expect(await screen.findByLabelText("First name")).toHaveValue("Mo");
    expect(screen.getByRole("checkbox", { name: "Manager" })).toBeChecked();
    // Present because the config says `variants: ["edit"]`…
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    // …and absent because `updateStaffBody` has no room for either.
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Initial password")).not.toBeInTheDocument();
  });

  it("sends only what the operator changed", async () => {
    const user = userEvent.setup();
    await openRecord(MO.id);

    const lastName = await screen.findByLabelText("Last name");

    await user.clear(lastName);
    await user.type(lastName, "Moderator");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await closed("Save changes");
    /*
     * Not `{ firstName, lastName, roles, status }`. Pruning to RHF's
     * `dirtyFields` (ADR-0035) is what stops a re-send of every seeded value
     * overwriting a field a second admin changed in the meantime — and what
     * makes the contract's "at least one field" refinement measure a real edit.
     */
    expect(state.seen.updated[0]).toEqual({
      id: MO.id,
      body: { lastName: "Moderator" },
    });
  });

  it("offers nothing to save until something changes", async () => {
    const user = userEvent.setup();

    await openRecord(MO.id);

    const save = screen.getByRole("button", { name: "Save changes" });

    expect(save).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "Admin" }));

    await waitFor(() => {
      expect(save).toBeEnabled();
    });
  });

  it("shows a refusal the form cannot attribute to a field", async () => {
    const user = userEvent.setup();

    server.use(
      http.patch(`${API}/staff/:id`, () => fail(409, "STAFF_LAST_SUPER_ADMIN")),
    );

    await openRecord(ADA.id);

    const status = await screen.findByLabelText("Status");

    await user.click(status);
    await user.click(await screen.findByRole("option", { name: "Disabled" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    // No `details`, no code map entry: it belongs to the operation, so it lands
    // at the top of the form where a submit failure is looked for — the path
    // `applyServerErrors` exists to guarantee is never silent.
    expect(
      await screen.findByText(
        "This is the last super admin. Promote someone else first.",
      ),
    ).toBeInTheDocument();
  });
});

describe("the administrative password reset", () => {
  it("declares exactly the fields setPasswordBody accepts", () => {
    /*
     * The config-versus-contract test an *action* form owes, and the reason
     * ADR-0035 (amended D3.7) lets one declare its field map in the feature
     * that owns the interaction: the map is not the resource's, but it answers
     * to a `@repo/contracts` schema exactly as a resource's does. `strictObject`
     * makes this one parse prove both directions — nothing missing, nothing the
     * endpoint would reject as unknown.
     */
    const parsed = setPasswordBody.safeParse(
      Object.fromEntries(
        Object.keys(passwordFields).map((name) => [name, "DevPassword!123"]),
      ),
    );

    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("never offers the subject's password to the browser as the operator's own", () => {
    open({ kind: "reset-password", staff: MO });

    /*
     * A `new-password` box beside a `current-password` one is the signature a
     * browser reads as "this person is changing their own password", and the
     * "Save password?" prompt that follows would file somebody else's
     * credential into this operator's password manager and sync it off the
     * machine. Only the actor's own box may say `current-password`.
     */
    expect(screen.getByLabelText("New password")).toHaveAttribute(
      "autocomplete",
      "off",
    );
    expect(screen.getByLabelText("Your own current password")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
  });

  it("asks for the subject's new password and the actor's own", () => {
    open({ kind: "reset-password", staff: MO });

    expect(screen.getByLabelText("New password")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Your own current password"),
    ).toBeInTheDocument();
  });

  it("sends both passwords and closes", async () => {
    const user = userEvent.setup();
    const { onClose } = open({ kind: "reset-password", staff: MO });

    await user.type(screen.getByLabelText("New password"), "NewPassword!123");
    await user.type(
      screen.getByLabelText("Your own current password"),
      "DevPassword!123",
    );
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(state.seen.passwords[0]).toEqual({
      id: MO.id,
      body: { password: "NewPassword!123", currentPassword: "DevPassword!123" },
    });
  });

  it("puts a wrong actor password on the box the operator must retype", async () => {
    const user = userEvent.setup();
    const { onClose } = open({ kind: "reset-password", staff: MO });

    await user.type(screen.getByLabelText("New password"), "NewPassword!123");
    await user.type(
      screen.getByLabelText("Your own current password"),
      "NotMyPassword!1",
    );
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    // ADR-0027's `403 AUTH_CURRENT_PASSWORD_INVALID` carries no field path, so
    // without the code map it would land form-level — on a form whose obvious
    // answer is the second box.
    expect(
      await screen.findByText("That is not your current password."),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByLabelText("Your own current password"),
      ).toHaveAttribute("aria-invalid", "true");
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("the confirms", () => {
  it("deletes only after the operator confirms", async () => {
    const user = userEvent.setup();
    const { onClose } = open({ kind: "delete", staff: MO });

    const dialog = screen.getByRole("alertdialog");

    expect(within(dialog).getByText(`Delete ${MO.email}?`)).toBeInTheDocument();
    expect(state.seen.deleted).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(state.seen.deleted).toEqual([MO.id]);
  });

  it("toasts a refusal the client deliberately did not pre-guess", async () => {
    const user = userEvent.setup();

    // Self-deletion, the last super admin and the rank rule are all the
    // service's (ADR-0028); the menu offers the action and the API answers.
    server.use(http.delete(`${API}/staff/:id`, () => fail(403, "FORBIDDEN")));

    const { onClose } = open({ kind: "delete", staff: ADA });

    await user.click(screen.getByRole("button", { name: "Delete" }));

    // A confirm has no field for a refusal to land on, so this one keeps
    // ADR-0034's error toast where the forms suppress theirs.
    expect(
      await screen.findByText("You do not have permission to do that."),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("signs a staff member out everywhere", async () => {
    const user = userEvent.setup();
    const { onClose } = open({ kind: "revoke-sessions", staff: MO });

    await user.click(
      screen.getByRole("button", { name: "Sign out everywhere" }),
    );

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(state.seen.revoked).toEqual([MO.id]);
  });
});
