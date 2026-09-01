import { createUserBody, setPasswordBody } from "@repo/contracts";
import { screen, waitFor, within } from "@testing-library/react";
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
import { server } from "@/test/msw/server";
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
 * The impersonation mint, from the confirm to the address bar (`D13.8`,
 * ADR-0057 §1/§2/§7).
 *
 * **What this tier can and cannot see.** It drives the whole of this app's
 * half — the mint is requested for the right target, the token comes back, the
 * URL is built with the token in the *fragment*, and the credential is dropped
 * from memory the moment the mutation settles. What it cannot see is anything
 * on the other side of that navigation: jsdom does not follow it, MSW cannot
 * show a `Set-Cookie`, and the customer app is a different bundle. `D13.7`'s
 * suites drive the redemption from the fragment; `D13.9` walks the pair in a
 * browser.
 */
describe("opening the customer app as a user", () => {
  /**
   * The addresses this tab was sent to, and the targets it was sent with.
   *
   * A spy on the *real* method rather than a seam invented for the test — this
   * harness has no `vi.mock` anywhere and is not about to start for a
   * navigation. It is spyable at all because the dialog navigates through
   * `window.open(…, "_self")`: `Location`'s own members are
   * `[LegacyUnforgeable]`, so `window.location.assign` cannot be redefined in
   * jsdom any more than it can in a browser.
   */
  const navigations = (): { url: string; target: string }[] =>
    vi.mocked(window.open).mock.calls.map(([url, target]) => ({
      url: String(url),
      target: String(target),
    }));

  beforeEach(() => {
    vi.spyOn(window, "open").mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mints for the chosen user and lands on the customer app with the token in the fragment", async () => {
    const user = userEvent.setup();
    const { queryClient } = open({ kind: "impersonate", user: CARA });

    await user.click(screen.getByRole("button", { name: "Impersonate" }));

    await waitFor(() => {
      expect(navigations()).toHaveLength(1);
    });

    // The mint was asked for this row and no other.
    expect(state.seen.minted).toEqual([CARA.id]);

    const [navigation] = navigations();

    // `_self`, so this is the browsing context that already exists rather than
    // a popup a blocker could refuse without saying so.
    expect(navigation?.target).toBe("_self");

    const url = new URL(String(navigation?.url));

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

    /*
     * And the handoff is not left lying in memory. TanStack Query keeps a
     * settled mutation's `data` for `gcTime`, so without `CREDENTIAL_MUTATION`
     * a one-time credential with a sixty-second life would be readable from
     * `getMutationCache()` for five minutes — four of them after it is dead,
     * one of them while it is not. This is the same assertion `D3.9` makes
     * about a submitted password, made about a returned token.
     *
     * **`gcTime: 0` alone does not get there here, which is what this case
     * caught.** Eviction waits for the last observer, and every other
     * credential mutation in this app loses its observer by closing its dialog
     * on success — this one deliberately stays mounted through the navigation,
     * so the dialog resets the mutation itself once the token has been spent.
     */
    await waitFor(() => {
      expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    });
  });

  it("cannot be fired twice while the browser is on its way", async () => {
    const user = userEvent.setup();

    open({ kind: "impersonate", user: CARA });

    const confirm = screen.getByRole("button", { name: "Impersonate" });

    await user.click(confirm);

    await waitFor(() => {
      expect(navigations()).toHaveLength(1);
    });

    /*
     * A navigation is not instant and a settled mutation re-enables its own
     * button, so without the dialog holding itself busy this second press
     * would mint again — a second request against ADR-0057 §1's per-actor
     * budget, a second live credential, and a second `impersonation.minted`
     * row against the operator's name for one intention.
     */
    expect(confirm).toBeDisabled();
    await user.click(confirm);

    expect(state.seen.minted).toEqual([CARA.id]);
    expect(navigations()).toHaveLength(1);
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
    expect(navigations()).toEqual([]);
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
    expect(navigations()).toEqual([]);
  });

  it("says the three things the button cannot", async () => {
    open({ kind: "impersonate", user: CARA });

    const dialog = await screen.findByRole("alertdialog");

    /*
     * The confirm is where an operator learns what impersonation does *not* do
     * to them and what it does to the record — none of it discoverable from a
     * menu item. Asserted as three fragments rather than the whole sentence, so
     * a rewrite of the copy is free while a silent deletion of any of the three
     * facts is not.
     */
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
