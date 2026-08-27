import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  RecordSurface,
  type RecordSurfaceProps,
  type RecordSurfaceSize,
  type RecordSurfaceVariant,
} from "@repo/ui/compositions/record-surface";

/**
 * The record container's structure, per variant (ADR-0048 §4 §5, `D8.8`).
 *
 * **What this suite can claim and what it cannot.** jsdom lays nothing out, so
 * nothing here proves a long form actually scrolls its body while the title
 * stays put — that is `D8.12`'s browser walk. What it proves is the structure
 * that makes it possible: header and footer as siblings *outside* the element
 * carrying `overflow-y-auto`, the row template on the column the primitives
 * lay out, and the dialog's viewport bound on `DialogContent` itself rather
 * than on the column, where it would bound nothing.
 *
 * The controlled mount is asserted **declaratively** — content present under
 * `open`, gone after a rerender with `open={false}` — because the package
 * harness has no `user-event` (ADR-0047 §Component-conventions). A dismissal
 * gesture actually firing `onOpenChange` is the consuming app's to assert.
 */

const renderSurface = (props: Partial<RecordSurfaceProps> = {}) =>
  render(
    <RecordSurface title="Edit record" variant="dialog" {...props}>
      <p>Body content</p>
    </RecordSurface>,
  );

const surfaceBody = (): HTMLElement =>
  document.querySelector<HTMLElement>('[data-slot="surface-body"]')!;

const column = (): HTMLElement =>
  document.querySelector<HTMLElement>('[data-slot="surface-column"]')!;

describe("RecordSurface", () => {
  describe("the structural pins the shipped suites name shells by", () => {
    it("renders a Radix dialog under the dialog variant", () => {
      renderSurface({ variant: "dialog" });

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Edit record" }),
      ).toBeInTheDocument();
    });

    it("renders the sheet primitive, still modal, under the drawer variant", () => {
      renderSurface({ variant: "drawer" });

      const sheet = document.querySelector('[data-slot="sheet-content"]');

      expect(sheet).toBeInTheDocument();
      /*
       * Still modal: `pages/users`' hidden-row assertion rests on Radix's
       * `aria-hidden` over the rest of the document, so a drawer that stopped
       * being modal would break a suite that never mentions this component.
       */
      expect(screen.getByRole("dialog")).toBe(sheet);
      expect(
        screen.getByRole("heading", { name: "Edit record" }),
      ).toBeInTheDocument();
    });

    it("renders neither, and no heading, under the page variant", () => {
      renderSurface({ variant: "page" });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(
        document.querySelector('[data-slot="sheet-content"]'),
      ).not.toBeInTheDocument();
      /*
       * The shell's `<h1>` carries the record's label here (ADR-0048 §2), so a
       * heading of its own would be the duplicate `D4.2` found by testing the
       * shells against each other.
       */
      expect(screen.queryByRole("heading")).not.toBeInTheDocument();
      expect(screen.getByText("Body content")).toBeInTheDocument();
    });

    it("keeps the Card shape the shipped page shell has", () => {
      renderSurface({ variant: "page" });

      /*
       * Not a bare box: the variant renders neither a Dialog nor a Sheet, so
       * it supplies its own element, and ADR-0048 §4 names the `Card` shape.
       * A `div` would strip the border, background, shadow and vertical
       * rhythm from the shipped page surface when `D8.9` adopts this — a
       * visual regression neither suite could see.
       */
      const surface = document.querySelector('[data-slot="record-surface"]');

      expect(surface).toHaveAttribute("data-slot", "record-surface");
      expect(surface).toHaveClass("rounded-xl", "border", "bg-card", "py-6");
      // `CardContent`'s gutter, on the column, because the column is the
      // Card's only direct child under the inversion.
      expect(column()).toHaveClass("px-6");
    });

    it("renders the page variant's description as a lede, not a heading", () => {
      renderSurface({ description: "What this record is", variant: "page" });

      const lede = screen.getByText("What this record is");

      expect(lede).toHaveAttribute("data-slot", "surface-lede");
      expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    });
  });

  describe("the three rows", () => {
    /*
     * Both variants, not just the default one. The shipped defect this whole
     * deliverable is named for is the **drawer's**: `app-form-surface.tsx` put
     * `overflow-y-auto` on the entire `SheetContent` with `SheetHeader` inside
     * it, so a long form scrolled its own title away. Asserting only the
     * dialog would leave the one variant that had the bug as the one variant
     * whose fix is unpinned.
     */
    it.each(["dialog", "drawer"] as const)(
      "keeps header and footer outside the %s's scrolling element",
      (variant) => {
        renderSurface({ footer: <button type="button">Save</button>, variant });

        const body = surfaceBody();

        expect(body).toHaveClass("overflow-y-auto", "min-h-0");

        const heading = screen.getByRole("heading", { name: "Edit record" });
        const footer = screen.getByRole("button", { name: "Save" });

        /*
         * The whole point of the container: a body that scrolls while the
         * title and Save stay put. Containment is what jsdom can see of it.
         */
        expect(body.contains(heading)).toBe(false);
        expect(body.contains(footer)).toBe(false);
        expect(body).toHaveTextContent("Body content");
      },
    );

    it("gives the column the row template and min-h-0 under dialog and drawer", () => {
      for (const variant of ["dialog", "drawer"] as const) {
        const { unmount } = renderSurface({ variant });

        expect(column()).toHaveClass(
          "grid",
          "min-h-0",
          "grid-rows-[auto_1fr_auto]",
        );

        unmount();
      }
    });

    it("gives the page column no scroll row and no min-h-0", () => {
      renderSurface({ variant: "page" });

      expect(column()).toHaveClass("flex", "flex-col");
      expect(column()).not.toHaveClass("min-h-0");
      /*
       * An `overflow-y-auto min-h-0` body inside an unbounded parent is inert
       * — it would scroll nothing and fix nothing (ADR-0048 §4).
       */
      expect(surfaceBody()).not.toHaveClass("overflow-y-auto");
    });

    it("pads the drawer's body and footer rows, which SheetContent does not", () => {
      renderSurface({
        footer: <button type="button">Save</button>,
        variant: "drawer",
      });

      // Both: gutters on the body alone leave the actions flush to the edge.
      expect(surfaceBody()).toHaveClass("px-4");
      expect(
        document.querySelector('[data-slot="surface-footer"]'),
      ).toHaveClass("px-4", "pb-4");
    });

    it("renders no footer row when handed no footer", () => {
      renderSurface();

      expect(
        document.querySelector('[data-slot="surface-footer"]'),
      ).not.toBeInTheDocument();
    });

    it("gives the footerless drawer's body the bottom gutter the footer would have carried", () => {
      renderSurface({ variant: "drawer" });

      /*
       * A detail view or a long confirmation hands this container no footer,
       * and the body is then the drawer's last row. `SheetContent` supplies no
       * gutters, so without this the content sits flush to the bottom edge.
       */
      expect(surfaceBody()).toHaveClass("px-4", "pb-4");
    });
  });

  describe("the size tokens", () => {
    const CONTENT: Record<RecordSurfaceVariant, string> = {
      dialog: '[data-slot="dialog-content"]',
      drawer: '[data-slot="sheet-content"]',
      page: '[data-slot="record-surface"]',
    };

    const EXPECTED: Record<
      RecordSurfaceVariant,
      Record<RecordSurfaceSize, string>
    > = {
      dialog: {
        sm: "sm:max-w-sm",
        md: "sm:max-w-lg",
        lg: "sm:max-w-2xl",
        xl: "sm:max-w-4xl",
        full: "sm:max-w-[calc(100%-2rem)]",
      },
      /*
       * `w-full` restored on every drawer token. Without it the assertion
       * passes on a container that dropped the class, and `SheetContent`'s own
       * `w-3/4` would take over on mobile — a width regression no other test
       * here could see.
       */
      drawer: {
        sm: "w-full sm:max-w-sm",
        md: "w-full sm:max-w-lg",
        lg: "w-full sm:max-w-2xl",
        xl: "w-full sm:max-w-4xl",
        full: "w-full sm:max-w-none",
      },
      page: {
        sm: "max-w-md",
        md: "max-w-2xl",
        lg: "max-w-4xl",
        xl: "max-w-6xl",
        full: "max-w-none",
      },
    };

    it.each(["dialog", "drawer", "page"] as const)(
      "maps every token to a distinct class on the %s variant's content element",
      (variant) => {
        const seen = new Set<string>();

        for (const size of ["sm", "md", "lg", "xl", "full"] as const) {
          const { unmount } = renderSurface({ size, variant });
          const content = document.querySelector(CONTENT[variant]);

          expect(content).toHaveClass(...EXPECTED[variant][size].split(" "));
          /*
           * From the **rendered** element, not from the table above. Adding
           * the expectation to the set would make `seen.size` five by
           * construction — a tautology dressed as a distinctness check.
           */
          seen.add(content?.className ?? "");

          unmount();
        }

        /*
         * Five distinct rendered class lists. Two tokens mapping to the same
         * string is the failure this catches, and it is a live risk: three of
         * these five values are also the primitives' own defaults, so a token
         * that resolved to `""` would still satisfy the per-token assertion
         * above.
         */
        expect(seen.size).toBe(5);
      },
    );

    it("puts the dialog's viewport bound on DialogContent, with the track that reaches the column", () => {
      renderSurface({ variant: "dialog" });

      const content = document.querySelector('[data-slot="dialog-content"]');

      /*
       * On the parent, not the column: `DialogContent` carries no `max-h` at
       * all, so a bound on the column would bound nothing. And
       * `grid-rows-[minmax(0,1fr)]` beside it, because `DialogContent` is a
       * grid whose implicit track is `auto` — without it the column's `1fr`
       * body row resolves against content height and `overflow-y-auto` never
       * engages. Asserted as explicitly as the bound: it is the half that
       * makes the bound reach anything (ADR-0048 §4).
       */
      expect(content).toHaveClass(
        "max-h-[calc(100svh-2rem)]",
        "grid-rows-[minmax(0,1fr)]",
      );
      expect(column()).not.toHaveClass("max-h-[calc(100svh-2rem)]");
    });

    it("restores on the dialog's header the gap the wrap makes inert", () => {
      renderSurface({ variant: "dialog" });

      /*
       * `DialogContent` is `grid … gap-4 p-6` and its children were the header
       * and the app's form; under the inversion the column is its only child,
       * so that `gap-4` goes inert exactly the way `FieldSet`'s `gap-6` does —
       * and it was the header-to-fields distance. `DialogHeader` has no
       * padding of its own, so without this the title sits flush against the
       * first field (`D8.11`, ADR-0048 §4).
       *
       * Pinned here rather than left to the browser walk because it is a class
       * on a specific element and therefore the one half of this geometry
       * jsdom *can* see. The other two variants need no equivalent: the
       * shipped drawer set `gap-0` and leans on `SheetHeader`'s own `p-4`, and
       * the `page` lede carries `mb-6`.
       */
      expect(document.querySelector('[data-slot="dialog-header"]')).toHaveClass(
        "mb-4",
      );
    });

    it("gives the dialog's scrolling body paint room the fields do not move into", () => {
      renderSurface({ variant: "dialog" });

      /*
       * A scroll container clips **ink** overflow at its padding box, and
       * `overflow-y-auto` makes one on both axes — CSS Overflow 3 computes a
       * `visible` `overflow-x` to `auto` beside it. `Input`'s
       * `focus-visible:ring-[3px]` is a box-shadow painted outside the border
       * box and neither `FieldGroup` nor `Field` supplies a gutter, so without
       * this a `w-full` field's focus and `aria-invalid` rings are shaved off
       * on every side (`D8.11`, ADR-0048 §4).
       *
       * **Both classes, because either alone is a bug**: `p-1` without `-m-1`
       * moves every field 4px inwards from where the shipped dialog puts it,
       * and `-m-1` without `p-1` pulls the row's border box in over the
       * content it was meant to protect.
       */
      expect(surfaceBody()).toHaveClass("p-1", "-m-1");
      // The drawer needs none: its `px-4` gutters are already paint room.
      expect(surfaceBody()).toHaveClass("overflow-y-auto");
    });
  });

  describe("the inversion", () => {
    it("hands the column's classes and rows to the render prop", () => {
      renderSurface({
        column: ({ className, children }) => (
          <form className={className} data-testid="app-form">
            {children}
          </form>
        ),
        footer: <button type="submit">Save</button>,
      });

      const form = screen.getByTestId("app-form");

      expect(form.tagName).toBe("FORM");
      expect(form).toHaveClass("grid", "min-h-0", "grid-rows-[auto_1fr_auto]");

      /*
       * All three rows inside the element the app supplied — which is what
       * makes a `type="submit"` button work in a *fixed* footer, and the
       * reason the container asks for the element instead of supplying one.
       */
      expect(
        form.contains(screen.getByRole("heading", { name: "Edit record" })),
      ).toBe(true);
      expect(form.contains(surfaceBody())).toBe(true);
      expect(form.contains(screen.getByRole("button", { name: "Save" }))).toBe(
        true,
      );

      // The container's own div is not rendered beside it.
      expect(
        document.querySelector('[data-slot="surface-column"]'),
      ).not.toBeInTheDocument();
    });

    it("renders its own div when given no column", () => {
      renderSurface();

      expect(column().tagName).toBe("DIV");
    });
  });

  describe("the mounts", () => {
    it("renders content under open and removes it when open goes false", () => {
      const { rerender } = render(
        <RecordSurface open title="Edit record" variant="dialog">
          <p>Body content</p>
        </RecordSurface>,
      );

      expect(screen.getByText("Body content")).toBeInTheDocument();

      rerender(
        <RecordSurface open={false} title="Edit record" variant="dialog">
          <p>Body content</p>
        </RecordSurface>,
      );

      expect(screen.queryByText("Body content")).not.toBeInTheDocument();
    });

    it("is open by default, because the routed mount closes by navigating", () => {
      renderSurface();

      expect(screen.getByText("Body content")).toBeInTheDocument();
    });

    it("hides the close button when dismissal is refused", () => {
      const { unmount } = renderSurface({ dismissible: false });

      expect(screen.queryByRole("button", { name: "Close" })).toBeNull();

      unmount();
      renderSurface({ dismissible: true });

      expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    });
  });
});
