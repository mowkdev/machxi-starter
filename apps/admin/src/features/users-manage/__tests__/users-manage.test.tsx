import {
  createUserBody,
  setPasswordBody,
  type StaffRole,
} from "@repo/contracts";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API } from "@/test/msw/handlers/auth.handlers";
import { fail } from "@/test/msw/handlers/envelope";
import {
  HANDOFF_TOKEN,
  USER_ROWS,
  createUsersHandlers,
  createUsersMockState,
  type UsersMockState,
} from "@/test/msw/handlers/users.handlers";
import { server } from "@repo/app-kit/testing";
import { userResourceConfig } from "@/entities/user";
import {
  createSessionStore,
  type SessionStore,
} from "@/shared/api/session-store";
import { fieldsForVariant, initialValuesFor } from "@/shared/resource/config";
import { renderApp, renderWithProviders } from "@/test/render";
import { staffPrincipal } from "@/test/principals";

import { asCreateBody } from "../create-user-surface";
import { handoffUrl } from "../impersonate-user-dialog";
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

  store.setSession({
    accessToken: "test-access-token",
    principal: staffPrincipal(["admin"]),
  });

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

/**
 * The address change on the record surface (`D18.10`, ADR-0071 §7, ADR-0042).
 *
 * The staff suite's twin, and this one adds the claim only a drawer can make:
 * the ceremony is a **sibling** of the record surface rather than a child of
 * it, so opening it and submitting it must not save the record underneath.
 * That is not decoration — a React portal bubbles synthetic events up the
 * React tree whatever the DOM says, so nesting the two forms would have made
 * every address change a silent `PATCH` as well.
 */
describe("the address change on the record surface", () => {
  const openRecordAs = async (roles: readonly StaffRole[], id: string) => {
    const store = createSessionStore();

    store.setSession({
      accessToken: "test-access-token",
      principal: staffPrincipal(roles),
    });

    const result = renderApp({ initialPath: `/users/${id}`, store });

    await screen.findByRole("button", { name: "Save changes" });

    return result;
  };

  it("is absent for an admin and present for a super admin", async () => {
    await openRecordAs(["admin"], CARA.id);

    expect(
      screen.queryByRole("button", { name: "Change address" }),
      "an admin reaches this surface and may reset a password on it, and must still not be offered a control the API answers 403 to",
    ).not.toBeInTheDocument();

    cleanup();

    await openRecordAs(["super_admin"], CARA.id);

    expect(
      await screen.findByRole("button", { name: "Change address" }),
    ).toBeInTheDocument();
    // Read out beside the control, because the form has no field for it:
    // `updateUserBody` never had one, and that is now load-bearing. Named by
    // its label rather than by the address, which the drawer's title carries
    // too.
    expect(screen.getByText("Email address")).toBeInTheDocument();
  });

  it("sends the new address, and saves nothing else on the way", async () => {
    const user = userEvent.setup();

    await openRecordAs(["super_admin"], CARA.id);

    /*
     * The record form is dirtied **first**, and that is what makes the two
     * assertions at the end mean anything (`D18.10`'s `code-reviewer`). On a
     * pristine form the nested arrangement would have taken `onSubmit`'s
     * empty-diff branch — no `PATCH`, a silent `close()` — so
     * `state.seen.updated` would have been empty in both worlds and the test
     * would have passed against the bug it exists to catch.
     */
    await user.type(await screen.findByLabelText("First name"), "!");

    await user.click(screen.getByRole("button", { name: "Change address" }));

    await user.type(
      await screen.findByLabelText("New email address"),
      "moved@example.test",
    );
    await user.type(
      screen.getByLabelText("Your own current password"),
      "DevPassword!123",
    );

    const dialog = screen.getByRole("dialog", {
      name: `Change the address for ${CARA.email}`,
    });

    await user.click(
      within(dialog).getByRole("button", { name: "Change address" }),
    );

    await waitFor(() => {
      expect(state.seen.emails[0]).toEqual({
        id: CARA.id,
        body: {
          email: "moved@example.test",
          currentPassword: "DevPassword!123",
        },
      });
    });

    // The drawer behind it is untouched, on both counts a nested form would
    // fail: no `PATCH` was sent, and the surface is still open — the nested
    // path navigates away even when it has nothing to save.
    expect(state.seen.updated).toEqual([]);
    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).toBeInTheDocument();
  });

  it("puts the operator's own wrong password under the box that fixes it", async () => {
    const user = userEvent.setup();

    await openRecordAs(["super_admin"], CARA.id);

    await user.click(screen.getByRole("button", { name: "Change address" }));

    await user.type(
      await screen.findByLabelText("New email address"),
      "moved@example.test",
    );
    await user.type(
      screen.getByLabelText("Your own current password"),
      "not-the-operators-password",
    );

    const dialog = screen.getByRole("dialog", {
      name: `Change the address for ${CARA.email}`,
    });

    await user.click(
      within(dialog).getByRole("button", { name: "Change address" }),
    );

    // `403 AUTH_CURRENT_PASSWORD_INVALID` carries no `details` — it belongs to
    // the credential check rather than to a request field — and the operator's
    // question is still "what do I retype?" (ADR-0027 §Contracts).
    await waitFor(() => {
      expect(
        screen.getByLabelText("Your own current password"),
      ).toHaveAttribute("aria-invalid", "true");
    });
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

/**
 * The impersonation mint, from the confirm to the tab it opens (`D13.8`,
 * `D17.2`; ADR-0057 §1/§2, ADR-0070 §1–§3).
 *
 * **What this tier can and cannot see.** It drives the whole of this app's
 * half — the tab is opened inside the click, the mint is requested for the
 * right target, the token comes back, the tab is disowned and sent to a URL
 * with the token in the *fragment*, and the credential is dropped from memory
 * the moment the mutation settles. What it cannot see is anything on the other
 * side of that navigation: jsdom opens no second document, MSW cannot show a
 * `Set-Cookie`, and the customer app is a different bundle. `D13.7`'s suites
 * drive the redemption from the fragment; `D17.3` walks the pair of tabs in a
 * browser.
 */
describe("opening the customer app as a user", () => {
  /**
   * The tab `window.open` hands back, instrumented.
   *
   * A stub rather than a second jsdom window, because jsdom's `window.open`
   * answers `null` and cannot be made to answer anything else — and because
   * what is worth asserting is not what a second document does but what this
   * one *says* to the handle, and in **which order**. Writes are recorded
   * through setters.
   *
   * **What it cannot catch, stated rather than implied** (`D17.2`, code
   * review, correcting this comment's first draft): a set-only accessor reads
   * back as `undefined`, and so does an absent property — only *calling* an
   * absent member throws. So a member the dialog starts reading is answered
   * falsy here until somebody adds it, which is why `closed` below is present
   * with a value rather than left off.
   */
  const stubTab = (closed = false) => {
    const order: string[] = [];
    const openerWrites: unknown[] = [];
    const hrefWrites: string[] = [];
    const close = vi.fn(() => {
      order.push("close");
    });
    const handle = {
      /*
       * A real `Window` answers this, and the dialog reads it: a handle whose
       * context has been discarded is not `null`, and writing to it is a
       * no-op. Defaulted rather than omitted so the stub cannot pass the
       * dialog's test by being silently `undefined`.
       */
      closed,
      set opener(value: unknown) {
        openerWrites.push(value);
        order.push("opener");
      },
      location: {
        set href(value: string) {
          hrefWrites.push(value);
          order.push("href");
        },
      },
      close,
    };

    return {
      order,
      openerWrites,
      hrefWrites,
      close,
      // The one place this file lies to the compiler: a `Window` is not
      // constructible here, and what the dialog touches of one is these four
      // members.
      handle: handle as unknown as Window,
    };
  };

  let tab: ReturnType<typeof stubTab>;
  /** Set by the one case that drives ADR-0070 §3's refused open. */
  let openRefused: boolean;
  /** How many mints the mock had seen when each `window.open` ran. */
  let mintsWhenOpened: number[];

  /** What this document asked to open, and with what target. */
  const opens = (): { url: string; target: string }[] =>
    vi.mocked(window.open).mock.calls.map(([url, target]) => ({
      url: String(url),
      target: String(target),
    }));

  beforeEach(() => {
    tab = stubTab();
    openRefused = false;
    mintsWhenOpened = [];

    /*
     * A spy on the *real* method rather than a seam invented for the test —
     * this harness has no `vi.mock` anywhere and is not about to start for a
     * navigation (ADR-0036). It is spyable at all because both paths go
     * through `window.open`: `Location`'s own members are `[LegacyUnforgeable]`
     * and cannot be redefined in jsdom any more than in a browser, so
     * `window.location.assign` would have needed the indirection module this
     * harness refuses.
     *
     * Each call records how many mints the mock had seen at the moment it ran,
     * which is how ADR-0070 §1's order — open first, mint second — is asserted
     * rather than assumed.
     */
    vi.spyOn(window, "open").mockImplementation(() => {
      mintsWhenOpened.push(state.seen.minted.length);

      return openRefused ? null : tab.handle;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the tab in the click's own call stack, carrying no URL", async () => {
    open({ kind: "impersonate", user: CARA });

    /*
     * `fireEvent` rather than `userEvent`, and it is the assertion rather than
     * a shortcut (`D17.2`, code review). `fireEvent.click` dispatches
     * synchronously and returns, so everything asserted before the first
     * `await` below is what ran **inside the click's own call stack** — which
     * is the property ADR-0070 §1 decides and the one a popup blocker checks.
     * `userEvent.click` is awaited, so by the time it resolves a `window.open`
     * moved into a microtask, a `setTimeout` or the mint's `onSuccess` would
     * have run too and every ordering assertion would still pass.
     */
    fireEvent.click(screen.getByRole("button", { name: "Impersonate" }));

    // One open, carrying no URL — the address does not exist yet.
    expect(opens()).toEqual([{ url: "", target: "_blank" }]);
    // And the mint has not even left: nothing awaited it into being.
    expect(state.seen.minted).toEqual([]);

    /*
     * Opening after the awaited round trip is the case ADR-0057 §7 rejected:
     * the activation may be spent by then and a blocked open is *silent*,
     * leaving the operator with a success toast, no tab and a live credential
     * they can neither spend nor see.
     */
    await waitFor(() => {
      expect(tab.hrefWrites).toHaveLength(1);
    });

    // The mint that followed was asked for this row and no other.
    expect(state.seen.minted).toEqual([CARA.id]);
    expect(opens()).toHaveLength(1);
  });

  it("disowns the tab before sending it to the fragment", async () => {
    const user = userEvent.setup();

    open({ kind: "impersonate", user: CARA });

    await user.click(screen.getByRole("button", { name: "Impersonate" }));

    await waitFor(() => {
      expect(tab.hrefWrites).toHaveLength(1);
    });

    /*
     * `opener = null` **before** the location is assigned (ADR-0070 §2): the
     * tab is `about:blank` and same-origin at that moment, so the write is
     * permitted, and a disowned browsing context stays disowned across the
     * navigation that follows. In the other order the customer origin would
     * arrive holding a handle on the admin panel in every deployment whose
     * static server does not send `Cross-Origin-Opener-Policy` — the dev
     * server among them, which is why the write is not left to the header.
     */
    expect(tab.order).toEqual(["opener", "href"]);
    expect(tab.openerWrites).toEqual([null]);

    const url = new URL(String(tab.hrefWrites[0]));

    /*
     * The origin is configuration (`VITE_CUSTOMER_APP_URL`, pinned by
     * `vitest.config.ts`), the path is the route `D13.7` built, and the token
     * is in the **fragment** — which is the security property rather than a
     * formatting choice: a query parameter would put a live credential in the
     * customer app's server logs and in the next navigation's `Referer`, and a
     * fragment is never transmitted (ADR-0057 §2).
     */
    expect(url.origin).toBe("http://customer.test");
    expect(url.pathname).toBe("/impersonate");
    expect(url.search).toBe("");
    expect(new URLSearchParams(url.hash.slice(1)).get("token")).toBe(
      HANDOFF_TOKEN,
    );
  });

  it("closes the confirm and keeps no handoff once the tab is on its way", async () => {
    const user = userEvent.setup();
    const { queryClient, onClose } = open({ kind: "impersonate", user: CARA });

    await user.click(screen.getByRole("button", { name: "Impersonate" }));

    await waitFor(() => {
      expect(tab.hrefWrites).toHaveLength(1);
    });

    /*
     * The panel stays on screen now, so the dialog has no reason to — which is
     * the visible half of ADR-0070 §1 and the reason `D13.8`'s "no `onClose()`
     * first" no longer applies. The confirm closing is also what makes a second
     * press impossible on this path: there is nothing left to press.
     */
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    /*
     * And the tab it handed the credential to is **not** closed behind it,
     * which is the one thing this path must not do and which no other case
     * would notice (`D17.2`, code review).
     */
    expect(tab.close).not.toHaveBeenCalled();

    /*
     * The handoff is not left lying in memory either. TanStack Query keeps a
     * settled mutation's `data` for `gcTime`, so without `CREDENTIAL_MUTATION`
     * a one-time credential with a sixty-second life would be readable from
     * `getMutationCache()` for five minutes — four of them after it is dead,
     * one of them while it is not. This is the same assertion `D3.9` makes
     * about a submitted password, made about a returned token.
     *
     * Here the dialog's own `reset()` is what does it: this harness's
     * `onClose` is a spy, so the observer never actually goes and `gcTime: 0`
     * has nothing to evict on. In the app it would go — the fallback case
     * below is where the reset is load-bearing in production too.
     */
    await waitFor(() => {
      expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    });
  });

  it("falls back to this tab when the open itself is refused", async () => {
    const user = userEvent.setup();

    // An extension, a policy, a kiosk profile: `window.open` answers `null`
    // even inside a click (ADR-0070 §3).
    openRefused = true;

    const { queryClient, onClose } = open({ kind: "impersonate", user: CARA });

    await user.click(screen.getByRole("button", { name: "Impersonate" }));

    await waitFor(() => {
      expect(opens()).toHaveLength(2);
    });

    /*
     * The behaviour ADR-0070 replaces, kept as the fallback and named by a
     * test rather than by a comment: the blank open still ran inside the click
     * and still carried no URL, and the `_self` navigation followed the mint.
     * `mintsWhenOpened` is what says "after": the second call saw the mint the
     * first did not.
     */
    expect(opens()).toEqual([
      { url: "", target: "_blank" },
      { url: handoffUrl(HANDOFF_TOKEN), target: "_self" },
    ]);
    expect(mintsWhenOpened).toEqual([0, 1]);

    // This document is the one leaving, so the dialog stays: closing it would
    // flash the grid behind it for the duration of a navigation.
    expect(onClose).not.toHaveBeenCalled();

    /*
     * **And this is the path where `reset()` is load-bearing in production**
     * (`D17.2`, code review). `gcTime: 0` evicts a mutation when its last
     * observer goes; here the dialog deliberately stays mounted through the
     * navigation, so nothing evicts it, and in the browser where an extension
     * refuses the `_self` navigation too, "for as long as the document
     * survives" is indefinite. Drop the `reset()` from this branch and this
     * assertion is the one that goes red.
     */
    await waitFor(() => {
      expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    });
  });

  it("takes the credential itself when the tab it opened is already gone", async () => {
    const user = userEvent.setup();

    /*
     * The operator shut the blank tab while the mint was in flight, or an
     * extension opened it and closed it again. A discarded browsing context is
     * **not** `null` — the handle is live and every write to it is a no-op —
     * so a `tab === null` test alone would end here with the dialog closed, a
     * spent budget entry, an `impersonation.minted` row and a live credential
     * nobody can reach: the exact outcome ADR-0070 §3 exists to prevent
     * (`D17.2`, security review).
     */
    tab = stubTab(true);

    const { onClose } = open({ kind: "impersonate", user: CARA });

    await user.click(screen.getByRole("button", { name: "Impersonate" }));

    await waitFor(() => {
      expect(opens()).toHaveLength(2);
    });

    // The same fallback the refused open takes: this document leaves with it.
    expect(opens()[1]).toEqual({
      url: handoffUrl(HANDOFF_TOKEN),
      target: "_self",
    });
    expect(tab.order).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes the tab it opened if it goes away before the mint answers", () => {
    const { unmount } = open({ kind: "impersonate", user: CARA });

    fireEvent.click(screen.getByRole("button", { name: "Impersonate" }));

    /*
     * The dialog leaves while the mint is in flight — Back, on a route change
     * the modal backdrop does not block. TanStack Query runs no `mutate`-scoped
     * callback for an observer that has gone, so neither `onSuccess` nor
     * `onError` will ever fire: without the unmount cleanup the blank tab would
     * outlive the panel that opened it, with nothing in it and no way back to
     * it (`D17.2`, code review). Synchronous throughout — the mint has not
     * answered, which is the whole case.
     */
    unmount();

    expect(tab.close).toHaveBeenCalledTimes(1);
    expect(tab.hrefWrites).toEqual([]);
  });

  it("cannot be fired twice while this tab is on its way", async () => {
    const user = userEvent.setup();

    /*
     * The fallback path, because it is the only one where the dialog outlives
     * the navigation — on the new-tab path the confirm has already closed. A
     * navigation is not instant and a settled mutation re-enables its own
     * button, so without the dialog holding itself busy this second press
     * would mint again: a second request against ADR-0057 §1's per-actor
     * budget, a second live credential, and a second `impersonation.minted`
     * row against the operator's name for one intention.
     */
    openRefused = true;

    open({ kind: "impersonate", user: CARA });

    const confirm = screen.getByRole("button", { name: "Impersonate" });

    await user.click(confirm);

    await waitFor(() => {
      expect(opens()).toHaveLength(2);
    });

    expect(confirm).toBeDisabled();
    await user.click(confirm);

    expect(state.seen.minted).toEqual([CARA.id]);
    expect(opens()).toHaveLength(2);
  });

  it("builds the address the customer app parses, and only that", () => {
    /*
     * The two halves of the handoff link, asserted against the shape
     * `useRedeemHandoff` reads on the other side — `new URLSearchParams(hash)`.
     * A token that ever contained a `+`, a `/` or a `=` must survive the round
     * trip, and a template literal is what would not make it.
     */
    expect(handoffUrl("a+b/c=")).toBe(
      "http://customer.test/impersonate#token=a%2Bb%2Fc%3D",
    );
  });

  it("keeps the operator where they are when the mint is refused", async () => {
    const user = userEvent.setup();
    const { onClose } = open({ kind: "impersonate", user: GONE });

    await user.click(screen.getByRole("button", { name: "Impersonate" }));

    /*
     * A deleted account is refused before a token exists (ADR-0057 §1), and the
     * refusal renders as catalogue copy like any other code. The confirm stays
     * open — `ConfirmDialog`'s contract — so the sentence arrives while the
     * operator is still looking at what they asked for, and nothing navigates.
     */
    expect(
      await screen.findByText("That user is deleted and cannot be changed."),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(tab.hrefWrites).toEqual([]);

    /*
     * And the tab the click opened is closed again (ADR-0070 §1). A blank tab
     * left standing behind a refusal would be the operator's only evidence
     * that anything happened, and the sentence above is the better one.
     */
    expect(tab.close).toHaveBeenCalledTimes(1);

    /*
     * The latch lifts with the refusal: nothing is leaving, so the operator can
     * press again — pick the wrong row, be told, pick another. Leaving it
     * latched would strand them in a modal whose only exit is Cancel.
     */
    expect(screen.getByRole("button", { name: "Impersonate" })).toBeEnabled();
  });

  it("refuses an account that is present but not active", async () => {
    const user = userEvent.setup();

    // `pending_verification`, which is neither deleted nor active — the third
    // of the mint's three refusals, and the one with no domain code of its own
    // because `AUTH_ACCOUNT_DISABLED` would be a lie about whose account it is.
    open({ kind: "impersonate", user: PAT });

    await user.click(screen.getByRole("button", { name: "Impersonate" }));

    /*
     * The catalogue's sentence for a bare `CONFLICT`, and it is **generic**:
     * ADR-0057 §1 argues for these three refusals being distinguishable partly
     * so that "an operator who is told 'that account is disabled' does not open
     * a support ticket about a broken button", and what the operator is
     * actually told is this. The API's choice of code is right by ADR-0013 —
     * nothing branches on it and `AUTH_ACCOUNT_DISABLED` would be a lie about
     * whose account was refused — and the copy is what the choice costs. The
     * ADR now says so at §1; giving it a domain code is an API change to an
     * already-built step and a scoping call, so it is the operator's.
     */
    expect(
      await screen.findByText(
        "That conflicts with something that already exists.",
      ),
    ).toBeInTheDocument();
    expect(tab.hrefWrites).toEqual([]);
    expect(tab.close).toHaveBeenCalledTimes(1);
  });

  it("says the four things the button cannot", async () => {
    open({ kind: "impersonate", user: CARA });

    const dialog = await screen.findByRole("alertdialog");

    /*
     * The confirm is where an operator learns what impersonation does *not* do
     * to them and what it does to the record — none of it discoverable from a
     * menu item. Asserted as fragments rather than the whole sentence, so a
     * rewrite of the copy is free while a silent deletion of any of the facts
     * is not.
     *
     * **Where it opens is the fourth**, and it is new with ADR-0070 §1: the
     * copy this replaces began "This tab moves to the customer app", which the
     * pre-opened tab made false. An operator who is told the panel goes away
     * and then finds it still there has been told the wrong thing about a
     * screen carrying somebody else's account.
     */
    expect(within(dialog).getByText(/new tab/)).toBeInTheDocument();
    expect(within(dialog).getByText(/untouched/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/refused while you are there/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/recorded against both of you/),
    ).toBeInTheDocument();
  });

  it("has no string the pseudo-locale cannot reach", async () => {
    /*
     * `D13.7`'s review finding 6, applied here rather than rediscovered: the
     * ADR-0046 §14 route walk visits every *route* under an ordinary session,
     * and this copy lives behind a row menu inside a dialog, so nothing in that
     * walk would ever have accented it. The lens is driven directly instead.
     */
    renderWithProviders(
      <UserDialogs
        action={{ kind: "impersonate", user: CARA }}
        onClose={vi.fn()}
      />,
      { pseudo: true },
    );

    const dialog = await screen.findByRole("alertdialog");

    /*
     * The **description** is in this list and was missing from the first draft
     * (`adr-reviewer`), which made the case skip the largest new string in the
     * step — the one carrying the three facts the case above asserts — while
     * claiming to be the reason that string is covered at all. It is neither a
     * heading nor a button, so `getAllByRole` never saw it.
     *
     * Reached through `aria-describedby` rather than by its text, because
     * under the lens the text is exactly what has changed — a `getByText`
     * matcher written in English is a query that passes only when the
     * assertion would fail.
     */
    const describedBy = dialog.getAttribute("aria-describedby");
    const description =
      describedBy === null ? null : document.getElementById(describedBy);

    expect(description).not.toBeNull();

    for (const node of [
      within(dialog).getByRole("heading"),
      description as HTMLElement,
      ...within(dialog).getAllByRole("button"),
    ])
      expect(node.textContent ?? "").toMatch(/\[.*\]/u);
  });

  it("greys the mint on a row the API is certain to refuse", async () => {
    const user = userEvent.setup();

    renderApp({ initialPath: "/users", store: signedIn() });

    await screen.findByRole("cell", { name: PAT.email });

    await user.click(
      screen.getByRole("button", { name: `Row actions for ${PAT.id}` }),
    );

    /*
     * `pending_verification`: present, not deleted, not active. The one entry
     * in this menu that predicts a refusal rather than deferring to the API,
     * and `use-user-row-actions.ts` carries the argument for why this action
     * splits from the four beside it — the permissive direction protects a
     * containment control mid-incident, and impersonation is not one.
     *
     * Asserted through `aria-disabled` because that is what a Radix menu item
     * sets; the entry is *visible* and refuses, which is the difference from
     * the manager case one file over, where it is absent entirely.
     */
    const item = within(await screen.findByRole("menu")).getByRole("menuitem", {
      name: "Impersonate",
    });

    expect(item).toHaveAttribute("aria-disabled", "true");

    await user.click(item);

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(state.seen.minted).toEqual([]);
  });
});
