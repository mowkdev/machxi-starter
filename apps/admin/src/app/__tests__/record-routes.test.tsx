import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createSessionStore,
  type SessionStore,
} from "@/shared/api/session-store";
import {
  STAFF_ROWS,
  createStaffHandlers,
  createStaffMockState,
} from "@/test/msw/handlers/staff.handlers";
import {
  USER_ROWS,
  createUsersHandlers,
  createUsersMockState,
} from "@/test/msw/handlers/users.handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

/**
 * Record routes (`D4.2`, ADR-0040), asserted through the real generated route
 * tree.
 *
 * This is the suite the whole step rests on, and it is deliberately *not* about
 * forms — the two feature suites already cover what a record surface does once
 * it is on screen. What is under test here is the claim ADR-0040 was written to
 * make: that an edit surface is **addressable**. Every assertion below is one
 * an operator would phrase as a complaint about D3 — "I cannot send someone
 * this record", "a refresh threw away what I had open", "Back does nothing",
 * "I lost my page and my filters" — and none of them can be made against a
 * component rendered directly, which is why they are made against a router on a
 * memory history.
 *
 * The two resources are both here on purpose: `staff` opens a dialog and
 * `users` opens a drawer, and every test below passes identically for both,
 * because the URL is surface-independent. That property is the reason
 * `editSurface` can be a one-line config change.
 */

const [ADA, MO] = STAFF_ROWS;
const [CARA] = USER_ROWS;

if (ADA === undefined || MO === undefined || CARA === undefined) {
  throw new Error("fixture missing");
}

const signedIn = (): SessionStore => {
  const store = createSessionStore();

  store.setSession({ accessToken: "test-access-token" });

  return store;
};

const open = (initialPath: string) =>
  renderApp({ initialPath, store: signedIn() });

beforeEach(() => {
  server.use(
    ...createStaffHandlers(createStaffMockState()),
    ...createUsersHandlers(createUsersMockState()),
  );
});

describe("a record is reachable by its URL", () => {
  it("loads a staff record from a deep link, with no list visit first", async () => {
    open(`/staff/${MO.id}`);

    /*
     * The whole ADR-0040 premise in one assertion: nothing put this record in
     * the cache, no grid row was clicked, and the surface still arrives filled.
     * The route's `ensureQueryData` fetched it after the `_dashboard` guard
     * ran — which is what makes "look at this account" a link somebody can be
     * sent, in a session that has never seen the list.
     */
    expect(await screen.findByLabelText("First name")).toHaveValue(
      MO.firstName,
    );
    expect(
      screen.getByRole("heading", { name: `Edit ${MO.email}` }),
    ).toBeInTheDocument();
  });

  it("loads a user record from a deep link, into that resource's drawer", async () => {
    open(`/users/${CARA.id}`);

    expect(await screen.findByLabelText("First name")).toHaveValue(
      CARA.firstName ?? "",
    );
    // Same URL shape, same form, different frame — the config's only effect.
    expect(
      document.querySelector('[data-slot="sheet-content"]'),
    ).not.toBeNull();
  });

  it("shows the error surface for an id the API does not know", async () => {
    open("/staff/11111111-1111-4111-8111-111111111111");

    /*
     * ADR-0040 asks for exactly two things here, and both are asserted: the
     * failure is *rendered* rather than left as a blank overlay over a live
     * grid, and it offers the way back to the list. The message itself comes
     * from the ADR-0034 catalogue, so a `404` reads the way every other refusal
     * in this app reads.
     */
    expect(
      await screen.findByRole("heading", {
        name: "That record could not be opened",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to staff" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save changes" }),
    ).not.toBeInTheDocument();
  });
});

describe("the list state survives the round trip", () => {
  it("keeps the operator's view while a record is open, and on the way back", async () => {
    const user = userEvent.setup();

    /*
     * A view that is not the default. `limit` rather than `offset` because the
     * fixture is two rows deep — a deep link to page two of a two-row list is
     * a stranded offset, which `AppGrid` correctly repairs by navigating, and
     * that repair would be doing the work this test means to attribute to
     * `retainSearchParams`.
     */
    const { router } = open("/staff?limit=50");

    await screen.findByRole("cell", { name: MO.email });

    await user.click(
      screen.getByRole("button", { name: `Row actions for ${MO.id}` }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));

    expect(
      await screen.findByRole("heading", { name: `Edit ${MO.email}` }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    /*
     * Back on the list, and back on *that* list. `retainSearchParams` is what
     * carries the search across both navigations; without it this returns to
     * page one of the default sort and the operator loses their place — the
     * ADR's own example of what the middleware exists to prevent.
     */
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: `Edit ${MO.email}` }),
      ).not.toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe("/staff");
    expect(router.state.location.search.limit).toBe(50);
  });
});

describe("navigation closes and reopens the surface", () => {
  it("closes on Back and reopens on Forward", async () => {
    const user = userEvent.setup();

    const { router } = open("/staff");

    await screen.findByRole("cell", { name: ADA.email });

    await user.click(screen.getByRole("link", { name: "New staff member" }));
    expect(
      await screen.findByRole("heading", { name: "New staff member" }),
    ).toBeInTheDocument();

    /*
     * The gesture ADR-0034 taught operators to trust, finally doing something
     * to the most prominent surface on screen. In D3 this did nothing at all:
     * the dialog was page state, invisible to history.
     *
     * The router's own history, not `window.history` — the app under test runs
     * on a memory history, which `window` knows nothing about.
     */
    void router.history.back();

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "New staff member" }),
      ).not.toBeInTheDocument();
    });

    void router.history.forward();

    expect(
      await screen.findByRole("heading", { name: "New staff member" }),
    ).toBeInTheDocument();
  });
});
