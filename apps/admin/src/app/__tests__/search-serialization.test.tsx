import { screen, waitFor, within } from "@testing-library/react";
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
  type StaffMockState,
} from "@/test/msw/handlers/staff.handlers";
import { server } from "@repo/app-kit/testing";
import { renderApp } from "@/test/render";
import { staffPrincipal } from "@/test/principals";

/**
 * What the address bar actually says (ADR-0043, `D5.2`) — asserted **at the
 * seam**, through the real router, and not on the codec.
 *
 * This is `D4.7`'s lesson being spent rather than quoted. A search term could
 * not be cleared for an entire deliverable while every pure function involved
 * was correct, because the defect lived between two of them and every suite
 * asserted one side or the other. The codec's own round trip (`D5.1`,
 * `@repo/contracts`) is necessary and proves nothing about a router: what a
 * caller depends on is that an operator's click produces a URL, and that the
 * URL produces the same grid on a cold load.
 *
 * So every assertion here goes through `renderApp` — the real generated route
 * tree, the real `validateSearch`, the real middleware — and reads
 * `router.state.location.searchStr`, which is the string a browser would show.
 */

const authenticated = (): SessionStore => {
  const store = createSessionStore();

  store.setSession({
    accessToken: "test-access-token",
    principal: staffPrincipal(["admin"]),
  });

  return store;
};

let state: StaffMockState;

const openStaff = (initialPath = "/staff") => {
  state = createStaffMockState(STAFF_ROWS);
  server.use(...createStaffHandlers(state));

  return renderApp({ initialPath, store: authenticated() });
};

/** The last query the API was actually asked for. */
const lastList = () => state.seen.list.at(-1);

beforeEach(() => {
  server.use(...createStaffHandlers(createStaffMockState()));
});

describe("the address bar", () => {
  it("is empty on the canonical first page", async () => {
    const { router } = openStaff();

    await screen.findByRole("cell", { name: "ada@machxi.local" });

    // `stripSearchParams` still owns this: a param equal to its default is not
    // worth spelling, so `/staff` is the first page and carries nothing.
    expect(router.state.location.searchStr).toBe("");
  });

  it("spells an operator's sort and filter in the API's own language", async () => {
    const user = userEvent.setup();
    const { router } = openStaff();

    await screen.findByRole("cell", { name: "ada@machxi.local" });

    await user.click(screen.getByRole("button", { name: "Email" }));
    await waitFor(() => {
      expect(lastList()?.sort).toEqual([{ field: "email", direction: "asc" }]);
    });

    await user.click(screen.getByRole("button", { name: "Filter by Email" }));

    const dialog = within(await screen.findByRole("dialog"));

    await user.type(
      dialog.getByRole("textbox", { name: "Filter by Email" }),
      "ada",
    );
    await user.click(dialog.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(lastList()?.filters).toEqual([
        { field: "email", op: "like", value: "%ada%" },
      ]);
    });

    /*
     * The whole string, asserted as one. Before this step the same state read
     * `?sort=%5B%7B%22field%22%3A%22email%22...` — a per-parameter assertion
     * would have passed just as happily on that, which is why the readability
     * of the whole is what gets pinned.
     *
     * The `%25` is the point of the one escaping rule: ADR-0039 wraps the
     * operator's term in a LIKE pattern, and its `%` must stay encoded while
     * the brackets do not.
     */
    expect(router.state.location.searchStr).toBe(
      "?sort=email&filter[email][like]=%25ada%25",
    );
  });

  it("carries a search term as `q`, and drops it when it is cleared", async () => {
    const user = userEvent.setup();
    const { router } = openStaff();

    await screen.findByRole("cell", { name: "ada@machxi.local" });

    await user.type(screen.getByRole("searchbox"), "eve");
    await waitFor(
      () => {
        expect(router.state.location.searchStr).toBe("?q=eve");
      },
      { timeout: 2000 },
    );

    await user.clear(screen.getByRole("searchbox"));

    // The `D4.7` requirement, now standing on a different implementation of
    // the URL: an empty term is an absent key, not `q=`.
    await waitFor(
      () => {
        expect(router.state.location.searchStr).toBe("");
      },
      { timeout: 2000 },
    );
  });

  it("produces the same grid when it is loaded cold", async () => {
    /*
     * The other half of the seam. The string above is a *link* — the thing an
     * operator sends a colleague — so the test that matters is that a router
     * which has never seen the interaction reads it back into the same request.
     */
    openStaff(
      "/staff?offset=20&limit=50&sort=-email&filter[status]=active&q=ann",
    );

    await waitFor(() => {
      expect(lastList()).toMatchObject({
        offset: 20,
        limit: 50,
        sort: [{ field: "email", direction: "desc" }],
        filters: [{ field: "status", op: "eq", value: "active" }],
        q: "ann",
      });
    });
  });

  it("reads a hand-typed URL with percent-encoded brackets", async () => {
    // A URL that has been through a mail client, a chat window or a shell.
    openStaff("/staff?filter%5Bstatus%5D%5Bin%5D=active,invited");

    await waitFor(() => {
      expect(lastList()?.filters).toEqual([
        { field: "status", op: "in", value: ["active", "invited"] },
      ]);
    });
  });

  it("leaves a search param this language does not define exactly as it was", async () => {
    /*
     * The codec is installed on the *router*, so it is on every route. What
     * bounds the blast radius is that it touches only the names
     * `LIST_QUERY_PARAMS` defines — and the guard's redirect is the one other
     * search param this app has.
     */
    const { router } = renderApp({
      initialPath: "/staff",
      store: createSessionStore(),
    });

    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(router.state.location.searchStr).toBe("?redirect=%2Fstaff");
  });

  it("spells the other resource's URL the same way", async () => {
    /*
     * The language is the router's, not a resource's — `shared/api/search-params`
     * never learns what a "staff" is. Asserted rather than assumed, because the
     * codec is installed once and a resource-shaped bug here would be invisible
     * on the screen that was walked.
     */
    state = createStaffMockState(STAFF_ROWS);
    server.use(...createStaffHandlers(state));

    const { router } = renderApp({
      initialPath: "/users?limit=50&sort=-email&filter[status]=active",
      store: authenticated(),
    });

    await screen.findByRole("heading", { name: "Users" });

    expect(router.state.location.searchStr).toBe(
      "?limit=50&sort=-email&filter[status]=active",
    );
  });

  it("still walks grid states with Back", async () => {
    const user = userEvent.setup();
    const { router } = openStaff();

    await screen.findByRole("cell", { name: "ada@machxi.local" });

    await user.click(screen.getByRole("button", { name: "Email" }));
    await waitFor(() => {
      expect(router.state.location.searchStr).toBe("?sort=email");
    });

    router.history.back();

    // Navigation is the state change (ADR-0032/0043), and it still is: the
    // spelling changed, the history semantics did not.
    await waitFor(() => {
      expect(router.state.location.searchStr).toBe("");
    });
  });
});
