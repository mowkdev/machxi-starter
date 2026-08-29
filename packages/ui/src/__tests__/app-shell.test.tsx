import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppShell } from "@repo/ui/compositions/app-shell";

/**
 * The shell's geometry, asserted where jsdom can still see it (ADR-0048 §2 §5,
 * ADR-0047 §Component-conventions, `D8.3`).
 *
 * **The class strings are the assertions, and that is deliberate.** jsdom lays
 * nothing out, so nothing here can prove the height budget *works*; what it can
 * prove is that every link of ADR-0037's three-element chain is still emitted
 * by the one component that now owns all three. A shell that dropped `h-svh`
 * from the inset, or `flex-1` from the container, would render identically in
 * this harness and break every grid in a browser. The browser walk is still the
 * proof of the layout; this suite is the proof that the inputs to it are there.
 *
 * `gap-4 p-4` is asserted for the same reason: it is every screen's padding and
 * gutter, an assertion on four of the six classes would let the shell drop it
 * invisibly, and no test that queried by role would notice.
 *
 * The harness ceiling applies unchanged — no router, no form, no MSW, no
 * `user-event`. Nothing here needs one: the shell is presentation.
 */

/*
 * A landmark with an accessible name rather than a `data-testid`: the ceiling
 * in ADR-0047 §Component-conventions is roles, accessible names and
 * `data-slot`/`data-*`, and a bespoke test id is none of the three. The real
 * consumer's node is `apps/admin`'s `<Sidebar>`, which is a landmark too.
 */
const Sidebar = () => <aside aria-label="Drawer">The drawer</aside>;

const INSET = '[data-slot="sidebar-inset"]';

/** The inset's children in order, named the way the shell names them. */
const insetChildren = (): string[] =>
  [...document.querySelector(INSET)!.children].map(
    (el) => el.getAttribute("data-slot") ?? el.tagName.toLowerCase(),
  );

const renderShell = (props: Partial<Parameters<typeof AppShell>[0]> = {}) =>
  render(
    <AppShell sidebar={<Sidebar />} title="Staff" {...props}>
      <p>Page content</p>
    </AppShell>,
  );

const pageContainer = (): HTMLElement =>
  document.querySelector<HTMLElement>('[data-slot="page-container"]')!;

describe("AppShell", () => {
  describe("the ADR-0037 height chain", () => {
    it("roots itself in the SidebarProvider that carries the min-h-svh floor", () => {
      const { container } = renderShell();

      const root = container.firstElementChild;

      expect(root).toHaveAttribute("data-slot", "sidebar-wrapper");
      expect(root).toHaveClass("min-h-svh");
    });

    it("gives the page container its six unconditional classes in both modes, and min-h-0 and h-svh in only one", () => {
      const { rerender } = renderShell({ fullHeight: true });

      /*
       * All six, not four. `flex-1` is what gives `min-h-0` something to
       * override, `min-w-0` is what keeps a wide table from pushing a
       * page-level horizontal scrollbar, and `gap-4 p-4` is the whole app's
       * spacing (ADR-0048 §2).
       *
       * Asserted in **both** modes on purpose: a shell that emitted the six
       * from inside the `fullHeight &&` branch — the `cn()` slip this exists
       * to catch — would pass an off-mode-only assertion and revert every
       * document-flowed page to no padding at all.
       */
      const SIX = ["flex", "min-w-0", "flex-1", "flex-col", "gap-4", "p-4"];

      expect(pageContainer()).toHaveClass(...SIX);
      expect(pageContainer()).toHaveClass("min-h-0");
      expect(document.querySelector(INSET)).toHaveClass("h-svh");

      rerender(
        <AppShell fullHeight={false} sidebar={<Sidebar />} title="Staff">
          <p>Page content</p>
        </AppShell>,
      );

      expect(pageContainer()).toHaveClass(...SIX);
      expect(pageContainer()).not.toHaveClass("min-h-0");
      expect(document.querySelector(INSET)).not.toHaveClass("h-svh");
    });

    it("keeps both machine-readable attributes on one element, empty-string on and absent off", () => {
      const { rerender } = renderShell({ fullHeight: true });

      /*
       * The value is pinned rather than merely asserted present: the consuming
       * app's three routing tests use a valueless `toHaveAttribute`, which
       * would accept a `"true"` just as silently (ADR-0048 §2).
       */
      expect(pageContainer()).toHaveAttribute("data-full-height", "");

      rerender(
        <AppShell fullHeight={false} sidebar={<Sidebar />} title="Staff">
          <p>Page content</p>
        </AppShell>,
      );

      expect(pageContainer()).toHaveAttribute("data-slot", "page-container");
      expect(pageContainer()).not.toHaveAttribute("data-full-height");
    });

    it("keeps every chrome row above the page container, as an in-flow sibling", () => {
      renderShell({ banner: <p>Pseudo-locale is on.</p> });

      /*
       * The whole inset in order, not a per-row parent check. A `parentElement`
       * assertion holds just as well for a page-header row rendered *after*
       * the container, and the ordering is the property that matters: a row
       * inside the `min-h-0` box, or below it, takes height from every grid,
       * and jsdom would not say so.
       */
      expect(insetChildren()).toEqual([
        "banner-region",
        "header",
        "page-header",
        "page-container",
      ]);

      for (const slot of ["banner-region", "page-header"]) {
        expect(document.querySelector(`[data-slot="${slot}"]`)).toHaveClass(
          "shrink-0",
        );
      }

      expect(document.querySelector("header")).toHaveClass("shrink-0");
    });
  });

  describe("the slots", () => {
    it("renders the title as the screen's single heading", () => {
      renderShell();

      const headings = screen.getAllByRole("heading");

      expect(headings).toHaveLength(1);
      expect(headings[0]).toHaveAccessibleName("Staff");
      expect(headings[0]?.tagName).toBe("H1");
    });

    it("puts the drawer, the trigger and the page inside the shell", () => {
      renderShell();

      expect(
        screen.getByRole("complementary", { name: "Drawer" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Toggle Sidebar" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Page content")).toBeInTheDocument();
      /*
       * The page is inside the container rather than merely on the screen —
       * the adapter's own test at `D8.4` asserts the same relation from the
       * other side.
       */
      expect(pageContainer()).toHaveTextContent("Page content");
    });

    it("places breadcrumbs and headerEnd in the header beside the trigger", () => {
      renderShell({
        breadcrumbs: <nav aria-label="breadcrumb">Staff</nav>,
        headerEnd: <button type="button">Account</button>,
      });

      const header = document.querySelector("header");

      expect(
        header?.contains(
          screen.getByRole("navigation", { name: "breadcrumb" }),
        ),
      ).toBe(true);
      expect(
        header?.contains(screen.getByRole("button", { name: "Account" })),
      ).toBe(true);
    });

    it("renders the banner it is handed", () => {
      renderShell({ banner: <p>Pseudo-locale is on.</p> });

      expect(screen.getByText("Pseudo-locale is on.")).toBeInTheDocument();
    });

    it("leaves no node at all when handed no banner", () => {
      renderShell();

      /*
       * Exhaustively, not by `data-slot` lookup: an element that reserved
       * space would shift every grid page's height budget (ADR-0048 §3), and
       * a query for the region's own slot name passes just as happily against
       * an empty wrapper carrying some other slot or none at all.
       */
      expect(insetChildren()).toEqual([
        "header",
        "page-header",
        "page-container",
      ]);
    });

    it("renders no headerEnd wrapper when handed no account menu", () => {
      renderShell();

      expect(
        document.querySelector("header")?.querySelector("div.ml-auto"),
      ).toBeNull();
    });
  });

  /*
   * The navigation indicator (`D10.1`, ADR-0052 §Felt navigation).
   *
   * Both directions again, and for a sharper reason than the banner's: this
   * slot toggles on **every** navigation, so a bar that took height would
   * hand two pixels back and forth to every grid on every click. That is why
   * the geometry assertion here is `absolute` and the inset's child order
   * rather than a class count — out of flow is the property, and jsdom will
   * never say so on its own.
   */
  describe("the navigation indicator", () => {
    it("renders an indeterminate progressbar across the top of the inset while navigating", () => {
      renderShell({ navigating: true });

      const bar = screen.getByRole("progressbar");

      /*
       * Indeterminate is the absence of a value, not a value of zero: a
       * `progressbar` carrying `aria-valuenow` claims to know how far along a
       * router is, which nothing here does.
       */
      expect(bar).not.toHaveAttribute("aria-valuenow");
      expect(bar).toHaveAccessibleName("Navigating");
      expect(bar).toHaveClass("absolute", "inset-x-0", "top-0");
      expect(bar).toHaveAttribute("data-slot", "navigation-indicator");

      /*
       * First child of the inset and out of flow, so the header, the page
       * header and the page container keep the whole height budget — the
       * chrome rule this one slot is deliberately exempt from.
       */
      expect(insetChildren()).toEqual([
        "navigation-indicator",
        "header",
        "page-header",
        "page-container",
      ]);
    });

    it("leaves no node at all when it is not navigating, in either spelling", () => {
      const { rerender } = renderShell({ navigating: false });

      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
      expect(insetChildren()).toEqual([
        "header",
        "page-header",
        "page-container",
      ]);

      /*
       * The default, not only the explicit `false`: every consumer that has
       * not learned about this prop yet passes through this branch, and a
       * `navigating = true` default would put a permanent bar on all of them.
       */
      rerender(
        <AppShell sidebar={<Sidebar />} title="Staff">
          <p>Page content</p>
        </AppShell>,
      );

      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });
  });
});
