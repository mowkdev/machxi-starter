import { fireEvent, render, screen } from "@testing-library/react";
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
      /*
       * And carries the 240px drawer (ADR-0054 §5, `D11.3`). The wrapper is
       * the only element both halves of the drawer read the width from — the
       * gap that reserves the column and the fixed container that fills it —
       * so a consumer that set it on its own `<Sidebar>` would move one and
       * not the other. Asserted here because nothing else in the repository
       * can see the value at all.
       */
      expect(root).toHaveStyle({ "--sidebar-width": "240px" });
    });

    it("gives the page container its four structural classes in both modes, and the gutter only off the budget", () => {
      const { rerender } = renderShell({ fullHeight: true });

      /*
       * The four that are the height chain: `flex-1` is what gives `min-h-0`
       * something to override, `min-w-0` is what keeps a wide table from
       * pushing a page-level horizontal scrollbar (ADR-0048 §2).
       *
       * Asserted in **both** modes on purpose: a shell that emitted them from
       * inside the `fullHeight &&` branch — the `cn()` slip this exists to
       * catch — would pass an off-mode-only assertion and revert every
       * document-flowed page to no layout at all.
       */
      const STRUCTURE = ["flex", "min-w-0", "flex-1", "flex-col"];

      expect(pageContainer()).toHaveClass(...STRUCTURE);
      expect(pageContainer()).toHaveClass("min-h-0");
      expect(document.querySelector(INSET)).toHaveClass("h-svh");
      /*
       * Full bleed (ADR-0054 §5, `D11.3`): a band layout runs its chrome to
       * the inset's edges, so the container's own gutter goes. `not` on both
       * classes rather than a count, because the failure this guards is a
       * `p-4` left standing that insets every grid by sixteen pixels and no
       * jsdom query would notice.
       */
      expect(pageContainer()).not.toHaveClass("p-4");
      expect(pageContainer()).not.toHaveClass("gap-4");

      rerender(
        <AppShell fullHeight={false} sidebar={<Sidebar />} title="Staff">
          <p>Page content</p>
        </AppShell>,
      );

      expect(pageContainer()).toHaveClass(...STRUCTURE);
      expect(pageContainer()).not.toHaveClass("min-h-0");
      expect(document.querySelector(INSET)).not.toHaveClass("h-svh");
      /*
       * And a document page keeps them — every screen's padding and gutter,
       * the half of ADR-0048 §2 the variant does not touch.
       */
      expect(pageContainer()).toHaveClass("gap-4", "p-4");
    });

    it("keeps the header band at 56px", () => {
      renderShell();

      // ADR-0054 §5's first band. The value is a class here and a measurement
      // in `e2e/shell.spec.ts`; neither tier can do the other's half.
      expect(document.querySelector("header")).toHaveClass("h-14");
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

    /*
     * ADR-0080 §2 (`D31.1`): the shell's own toggle, reading the sidebar's
     * context. Both widths, because the two read different state — `open` on a
     * wide screen and `openMobile` on a narrow one — and a toggle that read
     * `open` everywhere would say "open" over a closed sheet on every phone.
     * `fireEvent` rather than `user-event`, per the ceiling above.
     */
    it("the drawer toggle shows and announces whether the drawer is open", () => {
      const width = window.innerWidth;

      try {
        for (const [innerWidth, startsOpen] of [
          [1024, true],
          [500, false],
        ] as const) {
          Object.defineProperty(window, "innerWidth", {
            configurable: true,
            value: innerWidth,
          });

          const { unmount } = renderShell();
          const toggle = screen.getByRole("button", { name: "Toggle Sidebar" });
          const icon = () => toggle.querySelector("svg");

          expect(toggle).toHaveAttribute("aria-expanded", String(startsOpen));
          expect(icon()).toHaveClass(
            startsOpen ? "lucide-panel-left-close" : "lucide-panel-left-open",
          );

          fireEvent.click(toggle);

          expect(toggle).toHaveAttribute("aria-expanded", String(!startsOpen));
          expect(icon()).toHaveClass(
            startsOpen ? "lucide-panel-left-open" : "lucide-panel-left-close",
          );
          // The name is the sentence, in both states: tests that find it by
          // name keep working, and the state travels in `aria-expanded`.
          expect(toggle).toHaveAccessibleName("Toggle Sidebar");

          unmount();
        }
      } finally {
        Object.defineProperty(window, "innerWidth", {
          configurable: true,
          value: width,
        });
      }
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

    /*
     * The two slots the band layout named (ADR-0054 §5, `D11.3`).
     *
     * Both directions each, for the reason the banner region gets them: an
     * empty `<p>` under the `<h1>`, or an empty actions box beside it, is a
     * line of blank space on every screen that never asked for one — and the
     * page-header band sits inside the height budget's chrome, so what it
     * reserves it takes from every grid.
     */
    it("renders the description under the title, in the page-header band", () => {
      renderShell({ description: "Everyone who can sign in to the panel." });

      const description = document.querySelector(
        '[data-slot="page-description"]',
      );

      expect(description).toHaveTextContent(
        "Everyone who can sign in to the panel.",
      );
      expect(
        document
          .querySelector('[data-slot="page-header"]')
          ?.contains(description),
      ).toBe(true);
      // A paragraph, not a second heading: the screen has exactly one `<h1>`
      // and ADR-0044's invariant is that it stays that way.
      expect(screen.getAllByRole("heading")).toHaveLength(1);
    });

    it("leaves no description node when handed none", () => {
      renderShell();

      expect(
        document.querySelector('[data-slot="page-description"]'),
      ).toBeNull();
    });

    it("places pageActions in the band, on the far side of the title", () => {
      renderShell({
        pageActions: <button type="button">Density</button>,
      });

      const actions = document.querySelector('[data-slot="page-actions"]');

      expect(
        actions?.contains(screen.getByRole("button", { name: "Density" })),
      ).toBe(true);
      expect(
        document.querySelector('[data-slot="page-header"]')?.contains(actions),
      ).toBe(true);
    });

    it("leaves no pageActions wrapper when handed none", () => {
      renderShell();

      expect(document.querySelector('[data-slot="page-actions"]')).toBeNull();
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
