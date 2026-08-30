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

    it("keeps the Card shape the shipped page shell has, as a frame", () => {
      renderSurface({ variant: "page" });

      /*
       * Not a bare box: the variant renders neither a Dialog nor a Sheet, so
       * it supplies its own element, and ADR-0048 §4 names the `Card` shape.
       * A `div` would strip the border, background, shadow and radius from the
       * page surface — a visual regression neither suite could see.
       */
      const surface = document.querySelector('[data-slot="record-surface"]');

      expect(surface).toHaveAttribute("data-slot", "record-surface");
      expect(surface).toHaveClass("rounded-xl", "border", "bg-card");
      /*
       * **And nothing but a frame since `D11.5`** (ADR-0054 §7): the card's
       * own `py-6` and its inert `gap-6` are gone, because the bands run edge
       * to edge and carry their own gutters. `p-0` is asserted rather than
       * `not.toHaveClass("py-6")` for the reason the merge works: `p-0` is
       * what *displaces* the primitive's padding through `cn`, so the class
       * that has to be present is the one under test.
       */
      expect(surface).toHaveClass("p-0", "gap-0", "overflow-hidden");
      expect(surface).not.toHaveClass("py-6");
      // The column supplies no gutter of its own: the bands took theirs.
      expect(column()).not.toHaveClass("px-6");
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

    it("makes the drawer's column the drawer's height, and only the drawer's", () => {
      const { unmount } = renderSurface({ variant: "drawer" });

      /*
       * `SheetContent` is `flex flex-col` on a definite height and a flex
       * child is `flex: 0 1 auto` — it shrinks under overflow but never grows,
       * so without this the column ends where the last field does and the
       * footer band floats mid-drawer over bare background (`D11.5`,
       * ADR-0054 §7: "full-height … between static bands").
       */
      expect(column()).toHaveClass("flex-1");

      unmount();
      renderSurface({ variant: "dialog" });

      /*
       * And not the dialog's: its parent is a grid whose
       * `grid-rows-[minmax(0,1fr)]` track already stretches the column, and a
       * `flex-1` on a grid item is a class that means nothing where it sits.
       */
      expect(column()).not.toHaveClass("flex-1");
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

    it("renders no footer row when handed no footer", () => {
      renderSurface();

      expect(
        document.querySelector('[data-slot="surface-footer"]'),
      ).not.toBeInTheDocument();
    });
  });

  /**
   * The three bands (`D11.5`, ADR-0054 §7).
   *
   * The heights are floors here and numbers in `test:e2e` — the split of
   * labour `D11.4` wrote for the grid's bands, and for the same reason: jsdom
   * lays nothing out, so what this tier can prove is that the component emits
   * the class and that the primitive's own value lost the merge. Whether
   * Tailwind generated the rule, and whether the band really measures 60,
   * belongs to a browser.
   */
  describe("the band anatomy", () => {
    /*
     * The primitive behind each variant, because the `data-slot` names are the
     * primitives' and not the variants': the drawer's header is Radix's sheet.
     */
    const SLOT = { dialog: "dialog", drawer: "sheet" } as const;

    it.each(["dialog", "drawer"] as const)(
      "gives the %s a 60px title bar closed by a rule",
      (variant) => {
        renderSurface({ description: "The record's meta line", variant });

        const slot = SLOT[variant];
        const band = document.querySelector(`[data-slot="${slot}-header"]`);

        /*
         * A floor rather than a height, which is the rule the grid's bands
         * ship under: a title is data — `recordLabel` is an email on both
         * shipped record routes — and a fixed height on a band holding a
         * string of unknown length is a band that clips it.
         */
        expect(band).toHaveClass("min-h-15", "border-b", "px-6");
        /*
         * `p-0` is the class that displaces `SheetHeader`'s own `p-4` through
         * `cn` — without it the two variants land at different gutters from
         * one constant, which is exactly the drift the shared band exists to
         * prevent, and `px-6` alone would not remove it (different merge
         * group).
         */
        expect(band).toHaveClass("p-0");
        expect(band).not.toHaveClass("p-4");

        // §3's rungs: a 16/22 title over a 12px meta line.
        expect(
          document.querySelector(`[data-slot="${slot}-title"]`),
        ).toHaveClass("text-base", "leading-[22px]", "font-semibold");
        expect(
          document.querySelector(`[data-slot="${slot}-description"]`),
        ).toHaveClass("text-xs", "leading-4");
      },
    );

    it.each(["dialog", "drawer", "page"] as const)(
      "gives the %s's body 24px on every side",
      (variant) => {
        renderSurface({ variant });

        /*
         * One number for all three, because the surfaces are siblings in the
         * reference: it replaces the drawer's `px-4`, the dialog's inherited
         * `p-6` from the primitive it just lost, and the page's `px-6` on the
         * column.
         */
        expect(surfaceBody()).toHaveClass("p-6");
      },
    );

    it("retires the dialog's cancelled-out paint room", () => {
      renderSurface({ variant: "dialog" });

      /*
       * `p-1 -m-1` existed because a scrolling body clips ink overflow at its
       * padding box and a `w-full` field sat exactly on that edge, shaving
       * `Input`'s `focus-visible:ring-[3px]` (`D8.11`). With 24px of padding
       * the ring has eight times the room it needs, so the hack is dead
       * weight — and `-m-1` left standing beside `p-6` would pull the row's
       * border box back over the content the padding just protected.
       */
      expect(surfaceBody()).not.toHaveClass("-m-1");
      expect(surfaceBody()).toHaveClass("overflow-y-auto", "p-6");
    });

    it.each(["dialog", "drawer", "page"] as const)(
      "gives the %s a 64px footer band on --muted under a rule",
      (variant) => {
        renderSurface({ footer: <button type="button">Save</button>, variant });

        expect(
          document.querySelector('[data-slot="surface-footer"]'),
        ).toHaveClass(
          "min-h-16",
          "items-center",
          "border-t",
          "bg-muted",
          "px-6",
        );
      },
    );
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
      /*
       * `md` is 600px since `D11.5` (ADR-0054 §7) — the one width the redesign
       * moves, and a bracket value because Tailwind's ladder has nothing
       * between `lg` (512) and `2xl` (672).
       */
      dialog: {
        sm: "sm:max-w-sm",
        md: "sm:max-w-[600px]",
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

    it("strips the dialog frame's own padding, gap and radius rung", () => {
      renderSurface({ variant: "dialog" });

      const content = document.querySelector('[data-slot="dialog-content"]');

      /*
       * The bands run edge to edge (ADR-0054 §7, `D11.5`), so the primitive's
       * `p-6` would inset the title's rule and the footer's ground by 24px and
       * its `gap-4` would open a seam between three surfaces meant to meet.
       * `rounded-xl` is §2's radius assignment arriving at the surface that
       * owns the shape — the CLI's own `rounded-lg` is 6, and the dialog's
       * rung is 8.
       */
      expect(content).toHaveClass(
        "p-0",
        "gap-0",
        "rounded-xl",
        "overflow-hidden",
      );
      /*
       * `overflow-hidden` is not tidiness: the footer band paints `--muted` to
       * the frame's edge, and without the clip it squares off the two bottom
       * corners the radius just rounded.
       */
      expect(content).not.toHaveClass("p-6");
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
