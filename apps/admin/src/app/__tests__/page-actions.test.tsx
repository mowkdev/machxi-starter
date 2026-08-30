import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { authenticatedAs } from "@/test/principals";
import { renderApp } from "@/test/render";

/**
 * Which pages get the page-header band's controls (`D11.6`, ADR-0054 §5/§6).
 *
 * `@repo/ui`'s suite proves the slot renders and renders nothing when empty;
 * `widgets/dashboard-layout`'s proves the adapter carries it. **What only this
 * file can prove is the decision** — that the app fills the slot on the pages
 * that have rows to pack and on no others — because the decision lives in the
 * route file, reading `fullHeight` (ADR-0037's per-page opt-in) rather than a
 * `staticData` field of its own. A fourth field is exactly what this assertion
 * exists to keep unnecessary.
 */

describe("the page-header band's actions", () => {
  it("puts the density toggle on a grid route", async () => {
    renderApp({ initialPath: "/staff", store: authenticatedAs() });

    await screen.findByRole("heading", { name: "Staff", level: 1 });

    const actions = document.querySelector('[data-slot="page-actions"]');

    expect(actions).toContainElement(
      screen.getByRole("button", { name: "Compact rows" }),
    );
  });

  it("leaves the band bare on a route that is not a height budget", async () => {
    // `/profile` is a document, not a grid: `fullHeight` is false, there is no
    // table under it, and a density control there would be a control with
    // nothing to act on.
    renderApp({ initialPath: "/profile", store: authenticatedAs() });

    await screen.findByRole("heading", { name: "Profile", level: 1 });

    expect(document.querySelector('[data-slot="page-actions"]')).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Compact rows" }),
    ).not.toBeInTheDocument();
  });
});
