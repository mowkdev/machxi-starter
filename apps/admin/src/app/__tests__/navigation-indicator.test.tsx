import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createSessionStore,
  type SessionStore,
} from "@/shared/api/session-store";
import { API } from "@/test/msw/handlers/auth.handlers";
import { ok, server } from "@repo/app-kit/testing";
import {
  STAFF_ROWS,
  createStaffHandlers,
  createStaffMockState,
} from "@/test/msw/handlers/staff.handlers";
import enCommon from "@/shared/i18n/locales/en/common.json";
import { renderApp } from "@/test/render";
import { staffPrincipal } from "@/test/principals";

/**
 * The navigation indicator's wiring (`D10.1`, ADR-0052 §Felt navigation).
 *
 * **The package's suite proves the bar renders; this one proves the app knows
 * when to ask for it.** `AppShell` takes a boolean and has no opinion about
 * where it came from — so a shell that never receives `true` passes every
 * assertion in `packages/ui` and shows an operator nothing, which is exactly
 * the defect ADR-0052 exists to fix. The claim under test is the join:
 * `useRouterState().status === "pending"` reaching the shell through the
 * adapter, on the real generated route tree.
 *
 * **A held response rather than a timer.** The window this measures is open
 * only while the router has an unresolved match, so the test owns when it
 * closes: the record route's `ensureQueryData` (ADR-0044) awaits a detail
 * response this file never sends until it has made its assertion. Nothing
 * here is timing-dependent, and nothing sleeps.
 *
 * The name is asserted, not just the role: the bar is an *indeterminate*
 * `progressbar` and announces no value, so `UiStrings.navigating` is the whole
 * of what a screen reader is told. It is asserted **against the catalogue
 * rather than a literal**, and no further than that — `en/common.json`'s
 * `ui.navigating` and `DEFAULT_UI_STRINGS.navigating` are the same word, so
 * nothing here can tell the app's catalogue from the design system's fallback.
 * The suite that can is `ui-strings.test.tsx`, which renames the bar with the
 * locale; a default follows no language change.
 */

const [ADA] = STAFF_ROWS;

if (ADA === undefined) {
  throw new Error("fixture missing");
}

const signedIn = (): SessionStore => {
  const store = createSessionStore();

  store.setSession({
    accessToken: "test-access-token",
    principal: staffPrincipal(["admin"]),
  });

  return store;
};

beforeEach(() => {
  server.use(...createStaffHandlers(createStaffMockState()));
});

describe("the navigation indicator", () => {
  it("is absent while the router is idle", async () => {
    renderApp({ initialPath: "/staff", store: signedIn() });

    await screen.findByRole("cell", { name: ADA.email });

    /*
     * The negative case is the one that costs something if it breaks: a bar
     * that never left would sit across the top of every screen in the app,
     * claiming a navigation is running when none is.
     */
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("appears while a route's loader is unresolved, and leaves when it settles", async () => {
    const user = userEvent.setup();

    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    server.use(
      http.get(`${API}/staff/:id`, async (): Promise<Response> => {
        await held;

        return ok(ADA);
      }),
    );

    renderApp({ initialPath: "/staff", store: signedIn() });

    await screen.findByRole("cell", { name: ADA.email });

    await user.click(
      screen.getByRole("button", { name: `Row actions for ${ADA.id}` }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));

    expect(
      await screen.findByRole("progressbar", {
        name: enCommon.ui.navigating,
      }),
    ).toBeInTheDocument();

    /*
     * And the old screen is still there behind it, which is the decision
     * ADR-0052 took over a pending component: the operator keeps the list they
     * were reading and gains the feedback, rather than trading one for a
     * skeleton.
     */
    expect(screen.getByRole("cell", { name: ADA.email })).toBeInTheDocument();

    release?.();

    expect(
      await screen.findByRole("heading", { name: `Edit ${ADA.email}` }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });

    /*
     * The dialog is closed before this test unmounts: a Radix overlay left
     * open leaves its dismiss layer mutating the document, and every
     * `findBy*` in the file after it re-scans a tree that never settles
     * (ADR-0036, the `D4.5` lesson).
     */
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: `Edit ${ADA.email}` }),
      ).not.toBeInTheDocument();
    });
  });
});
