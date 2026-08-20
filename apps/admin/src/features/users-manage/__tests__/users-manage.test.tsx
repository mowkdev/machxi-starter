import { createUserBody, setPasswordBody } from "@repo/contracts";
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
import { userResourceConfig } from "@/entities/user";
import {
  createSessionStore,
  type SessionStore,
} from "@/shared/api/session-store";
import { fieldsForVariant, initialValuesFor } from "@/shared/resource/config";
import { renderApp, renderWithProviders } from "@/test/render";

import { asCreateBody } from "../create-user-surface";
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

/**
 * The record surfaces are entered through the router (`D4.2`, ADR-0040), and
 * this resource is where the *shell* claim is worth something: `users` declares
 * `editSurface: "drawer"`, so everything below renders in a `Sheet` while the
 * staff suite's identical assertions render in a `Dialog`. Neither suite says
 * which — they ask for controls by accessible name, and the same form answers
 * from inside either frame. That is the ADR's "one config line, no other
 * change" being tested rather than described.
 */
const signedIn = (): SessionStore => {
  const store = createSessionStore();

  store.setSession({ accessToken: "test-access-token" });

  return store;
};

const openCreate = async () => {
  const result = renderApp({ initialPath: "/users/new", store: signedIn() });

  await screen.findByRole("button", { name: "Create" });

  return result;
};

const openRecord = async (id: string) => {
  const result = renderApp({ initialPath: `/users/${id}`, store: signedIn() });

  await screen.findByRole("button", { name: "Save changes" });

  return result;
};

/** Closing is a navigation, so the assertion is that the control is gone. */
const closed = async (submitLabel: string) => {
  await waitFor(() => {
    expect(
      screen.queryByRole("button", { name: submitLabel }),
    ).not.toBeInTheDocument();
  });
};

beforeEach(() => {
  state = createUsersMockState();
  server.use(...createUsersHandlers(state));
});

describe("the state-to-body conversion", () => {
  /*
   * The unit half of what the create dialog's resolver does, kept beside the
   * converter rather than in the entity suite: `asCreateBody` belongs to this
   * feature, and an entity test reaching up into a feature would invert
   * ADR-0032's direction even where the lint exempts it.
   */
  it("converts an untouched create form into a body the endpoint accepts", () => {
    /*
     * The claim the D3.8 amendment to ADR-0035 actually makes, asserted end to
     * end: the form's *state* is not the body, and the conversion is what makes
     * the difference legal. A blank form plus the two required answers has to
     * parse — if `asCreateBody` stopped dropping the `null` names or the
     * unanswered `status`, this is where it would show.
     */
    const blank = initialValuesFor(userResourceConfig.fields, "create");
    const body = asCreateBody({
      ...blank,
      email: "new.customer@example.test",
      password: "DevPassword!123",
    });

    expect(body).toEqual({
      email: "new.customer@example.test",
      password: "DevPassword!123",
    });
    expect(createUserBody.safeParse(body).success).toBe(true);
  });

  it.each(
    fieldsForVariant(userResourceConfig.fields, "create").map(([n]) => n),
  )("never lets the create form send %s as null", (name) => {
    /*
     * The precondition `asCreateBody` rests on: it drops every `null` a
     * `nullable` field produces, which is only correct while `createUserBody`
     * has no nullable field of its own. The day one is added, "clear this"
     * would silently become "not provided" and the server's default would be
     * applied to a request the operator did not make — so the assumption is
     * pinned rather than left in a comment.
     */
    expect(
      createUserBody.safeParse({
        email: "new.customer@example.test",
        password: "DevPassword!123",
        [name]: null,
      }).success,
    ).toBe(false);
  });
});

describe("the create surface", () => {
  it("renders the create variant, and no roles control", async () => {
    await openCreate();

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

  it("never offers the new account's password to the browser as the operator's own", async () => {
    await openCreate();

    /*
     * The riskier of the app's two password forms, and the one that had no test
     * until the D3.8 review asked for it: an `email` field beside a
     * `type="password"` one is the sign-up signature a browser answers with
     * "Save password?" — which would file the new customer's initial credential
     * into the acting operator's password manager and sync it off the machine.
     */
    expect(screen.getByLabelText("Initial password")).toHaveAttribute(
      "autocomplete",
      "off",
    );
  });

  it("omits an untouched optional field rather than sending it empty", async () => {
    const user = userEvent.setup();
    await openCreate();

    await user.type(screen.getByLabelText("Email"), "new@example.test");
    await user.type(
      screen.getByLabelText("Initial password"),
      "DevPassword!123",
    );
    await user.click(screen.getByRole("button", { name: "Create" }));

    await closed("Create");
    /*
     * The whole point of the create surface's resolver. `createUserBody` rejects
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

    await openCreate();

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
    await openCreate();

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

    await closed("Create");
  });

  it("lands USER_EMAIL_TAKEN on the email field", async () => {
    const user = userEvent.setup();

    await openCreate();

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

describe("the edit surface", () => {
  it("renders a null name as an empty control, not as the string null", async () => {
    await openRecord(PAT.id);

    expect(await screen.findByLabelText("First name")).toHaveValue("");
  });

  it("clears a name with null, which is a different request from leaving it", async () => {
    const user = userEvent.setup();
    await openRecord(CARA.id);

    const firstName = await screen.findByLabelText("First name");

    await user.clear(firstName);
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await closed("Save changes");
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
    await openRecord(GONE.id);

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

  it("refuses a deleted subject once the actor is verified", async () => {
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

  it("refuses a second delete instead of reporting it as done", async () => {
    const user = userEvent.setup();
    const { onClose } = open({ kind: "delete", user: GONE });

    /*
     * The flow `useUserRowActions` exists to justify. It leaves **Delete**
     * enabled on a row that already carries `deletedAt`, on the argument that
     * the API is the enforcement point — so this is the one path where the
     * client and the server must be seen to agree. The service refuses a second
     * delete with `409` rather than moving the timestamp ("already deleted" is
     * a conflict, not a no-op to report as success, ADR-0028), and until the
     * D3.8 review the mock answered `204` — certifying the opposite of
     * production on precisely the flow the design rests on.
     */
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(
      await screen.findByText("That user is deleted and cannot be changed."),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
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
