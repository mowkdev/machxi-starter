import { setPasswordBody } from "@repo/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { API } from "@/test/msw/handlers/auth.handlers";
import { fail } from "@/test/msw/handlers/envelope";
import {
  USER_ROWS,
  createUsersHandlers,
  createUsersMockState,
  type UsersMockState,
} from "@/test/msw/handlers/users.handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/render";

import { passwordFields } from "../reset-user-password-dialog";
import type { UserAction } from "../types";
import { UserDialogs } from "../user-dialogs";

/**
 * The users write flows (`D3.8`; ADR-0027, ADR-0028, ADR-0035, ADR-0036).
 *
 * The staff suite already covers what the *machinery* does — the submit lock,
 * the registry, the code-to-field map, the confirm that stays open while
 * pending. Repeating all of that here would test D3.6 twice and D3.8 once. So
 * what this file asserts is the part that is genuinely this resource's: the
 * three meanings of an empty name box, the soft delete, and the `USER_DELETED`
 * refusals a deleted subject answers every write with.
 */

const [CARA, PAT, GONE] = USER_ROWS;

if (CARA === undefined || PAT === undefined || GONE === undefined)
  throw new Error("fixture missing");

let state: UsersMockState;

const open = (action: UserAction, onClose = vi.fn()) => {
  const result = renderWithProviders(
    <UserDialogs action={action} onClose={onClose} />,
  );

  return { ...result, onClose };
};

beforeEach(() => {
  state = createUsersMockState();
  server.use(...createUsersHandlers(state));
});

describe("the create dialog", () => {
  it("renders the create variant, and no roles control", () => {
    open({ kind: "create" });

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Initial password")).toBeInTheDocument();
    expect(screen.getByLabelText("First name")).toBeInTheDocument();
    // `status` is in both variants here, unlike staff — `createUserBody` takes
    // one where `createStaffBody` does not.
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    // And roles is a column, not a field: one role in v1, nothing to choose.
    expect(
      screen.queryByRole("group", { name: "Roles" }),
    ).not.toBeInTheDocument();
  });

  it("omits an untouched optional field rather than sending it empty", async () => {
    const user = userEvent.setup();
    const { onClose } = open({ kind: "create" });

    await user.type(screen.getByLabelText("Email"), "new@example.test");
    await user.type(
      screen.getByLabelText("Initial password"),
      "DevPassword!123",
    );
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    /*
     * The whole point of the create dialog's resolver. `createUserBody` rejects
     * `""` (`nameSchema` is `.trim().min(1)`) and rejects `null` (only the
     * *update* body is nullable), so the only way to say "the operator left
     * this blank" is an absent key — and no HTML control can hold "absent".
     * The form's state is converted into the request body *before* validation,
     * so the schema judges what will actually be sent rather than a shape that
     * could never be. `status` goes the same way, leaving the server's own
     * default standing rather than this form asserting one.
     */
    expect(state.seen.created[0]).toEqual({
      email: "new@example.test",
      password: "DevPassword!123",
    });
  });

  it("sends a name the operator actually typed", async () => {
    const user = userEvent.setup();

    open({ kind: "create" });

    await user.type(screen.getByLabelText("Email"), "named@example.test");
    await user.type(
      screen.getByLabelText("Initial password"),
      "DevPassword!123",
    );
    await user.type(screen.getByLabelText("First name"), "Nina");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(state.seen.created[0]).toEqual({
        email: "named@example.test",
        password: "DevPassword!123",
        firstName: "Nina",
      });
    });
  });

  it("re-registers the address a deleted account released", async () => {
    const user = userEvent.setup();
    const { onClose } = open({ kind: "create" });

    /*
     * ADR-0028's partial unique index (`where deleted_at is null`) in the one
     * place a client can observe it: the soft-deleted row still holds this
     * address, and creating it again succeeds because only a *live* row counts.
     */
    await user.type(screen.getByLabelText("Email"), GONE.email);
    await user.type(
      screen.getByLabelText("Initial password"),
      "DevPassword!123",
    );
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("lands USER_EMAIL_TAKEN on the email field", async () => {
    const user = userEvent.setup();

    open({ kind: "create" });

    await user.type(screen.getByLabelText("Email"), CARA.email);
    await user.type(
      screen.getByLabelText("Initial password"),
      "DevPassword!123",
    );
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(
      await screen.findByText("Another user already uses that email address."),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText("Email")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });
  });
});

describe("the edit dialog", () => {
  it("renders a null name as an empty control, not as the string null", async () => {
    open({ kind: "edit", user: PAT });

    expect(await screen.findByLabelText("First name")).toHaveValue("");
  });

  it("clears a name with null, which is a different request from leaving it", async () => {
    const user = userEvent.setup();
    const { onClose } = open({ kind: "edit", user: CARA });

    const firstName = await screen.findByLabelText("First name");

    await user.clear(firstName);
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    // `null` and not `""`: the column is nullable, "unset it" is a legal
    // request, and `nameSchema` would refuse the empty string.
    expect(state.seen.updated[0]).toEqual({
      id: CARA.id,
      body: { firstName: null },
    });
    // `lastName` was not touched, so it is not in the body at all — the third
    // meaning, and the one that stops this overwriting a concurrent edit.
    expect(state.seen.updated[0]?.body).not.toHaveProperty("lastName");
  });

  it("shows the USER_DELETED refusal rather than pre-guessing it", async () => {
    const user = userEvent.setup();

    // The row carries `deletedAt`, and the menu still offered the action; the
    // API is the enforcement point and this is what it says (ADR-0028).
    open({ kind: "edit", user: GONE });

    const firstName = await screen.findByLabelText("First name");

    await user.clear(firstName);
    await user.type(firstName, "Renamed");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText("That user is deleted and cannot be changed."),
    ).toBeInTheDocument();
  });
});

describe("the administrative password reset", () => {
  it("declares exactly the fields setPasswordBody accepts", () => {
    const parsed = setPasswordBody.safeParse(
      Object.fromEntries(
        Object.keys(passwordFields).map((name) => [name, "DevPassword!123"]),
      ),
    );

    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("never offers the subject's password to the browser as the operator's own", () => {
    open({ kind: "reset-password", user: CARA });

    expect(screen.getByLabelText("New password")).toHaveAttribute(
      "autocomplete",
      "off",
    );
    expect(screen.getByLabelText("Your own current password")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
  });

  it("sends both passwords and closes", async () => {
    const user = userEvent.setup();
    const { onClose } = open({ kind: "reset-password", user: CARA });

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
      id: CARA.id,
      body: { password: "NewPassword!123", currentPassword: "DevPassword!123" },
    });
  });

  it("refuses a deleted subject before it ever checks the actor", async () => {
    const user = userEvent.setup();
    const { onClose } = open({ kind: "reset-password", user: GONE });

    await user.type(screen.getByLabelText("New password"), "NewPassword!123");
    await user.type(
      screen.getByLabelText("Your own current password"),
      "DevPassword!123",
    );
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(
      await screen.findByText("That user is deleted and cannot be changed."),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("the confirms", () => {
  it("says what a soft delete actually does", async () => {
    const user = userEvent.setup();
    const { onClose } = open({ kind: "delete", user: CARA });

    const dialog = screen.getByRole("alertdialog");

    /*
     * Not "this cannot be undone", which is the staff dialog's sentence and
     * would be a lie here: the row survives, and the address is released for
     * re-registration. Copy is per-call precisely so the two can differ.
     */
    expect(
      within(dialog).getByText(/available to register again/),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(state.seen.deleted).toEqual([CARA.id]);
    // The row survives with the marker set — ADR-0028's read path, which the
    // grid then has to render.
    expect(
      state.rows.find((row) => row.id === CARA.id)?.deletedAt,
    ).not.toBeNull();
  });

  it("surfaces a refusal it deliberately did not pre-guess", async () => {
    const user = userEvent.setup();

    server.use(http.delete(`${API}/users/:id`, () => fail(403, "FORBIDDEN")));

    const { onClose } = open({ kind: "delete", user: CARA });

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(
      await screen.findByText("You do not have permission to do that."),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("signs a user out everywhere", async () => {
    const user = userEvent.setup();
    const { onClose } = open({ kind: "revoke-sessions", user: CARA });

    await user.click(
      screen.getByRole("button", { name: "Sign out everywhere" }),
    );

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(state.seen.revoked).toEqual([CARA.id]);
  });
});
